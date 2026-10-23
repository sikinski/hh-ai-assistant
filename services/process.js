import { prisma } from '../db/db.js';
import { fetchHhVacancies, fetchHhVacancyDetails, getMaxMonthlySalaryRub } from './hh.js';
import { analyzeVacancy } from './ai.js';
import { isLlmConfigured } from './llm.js';
import { sendVacancyToTelegram, isTelegramConfigured } from './telegram.js';
import {
    HH_FILTERS,
    HH_MAX_PAGES,
    HH_MAX_RESPONSES,
    HH_MIN_SALARY,
    ANALYZE_BATCH_SIZE,
    MAX_ANALYZE_ERRORS,
    MIN_MATCH_SCORE,
} from '../config.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Пауза между запросами к hh.ru, чтобы не нагружать сайт.
const HH_REQUEST_DELAY = 1500;

// Сколько неотправленных подходящих вакансий пытаемся доставить за один запуск.
const NOTIFY_BATCH_SIZE = 20;

// Причина отсева без ИИ или null, если вакансию стоит показать ИИ.
function getPrefilterReason(vacancy) {
    if (vacancy.responsesCount !== null && vacancy.responsesCount > HH_MAX_RESPONSES) {
        return `Отсеяна: ${vacancy.responsesCount} откликов (больше ${HH_MAX_RESPONSES})`;
    }

    const maxSalary = getMaxMonthlySalaryRub(vacancy.compensation);

    if (HH_MIN_SALARY && maxSalary !== null && maxSalary < HH_MIN_SALARY) {
        return `Отсеяна: зарплата до ${maxSalary} ₽ (меньше ${HH_MIN_SALARY} ₽)`;
    }

    return null;
}

export async function syncVacancies() {
    let fetched = 0;
    let added = 0;
    let prefiltered = 0;
    let skipped = 0;
    let totalAvailable = 0;
    let pagesProcessed = 0;

    for (let page = 0; page < HH_MAX_PAGES; page++) {
        const result = await fetchHhVacancies(HH_FILTERS, page);

        totalAvailable = result.total;
        fetched += result.vacancies.length;
        pagesProcessed++;

        let addedOnPage = 0;

        for (const { compensation, ...vacancy } of result.vacancies) {
            const prefilterReason = getPrefilterReason({ ...vacancy, compensation });

            try {
                await prisma.vacancy.create({
                    data: prefilterReason
                        ? { ...vacancy, isRelevant: false, aiReason: prefilterReason }
                        : vacancy,
                });

                added++;
                addedOnPage++;

                if (prefilterReason) {
                    prefiltered++;
                }
            } catch (error) {
                if (error.code === 'P2002') {
                    skipped++;
                } else {
                    throw error;
                }
            }
        }

        // Выдача отсортирована по дате: если на странице нет новых,
        // дальше будут только уже известные — не тратим запросы.
        const isLastPage = (page + 1) * 20 >= result.total;

        if (addedOnPage === 0 || isLastPage) {
            break;
        }

        await sleep(HH_REQUEST_DELAY);
    }

    return {
        pagesProcessed,
        fetched,
        added,
        prefiltered,
        skipped,
        totalAvailable,
    };
}

// Анализирует очередную порцию вакансий, которые ещё не оценивал ИИ.
// Сначала берём вакансии с меньшим числом откликов — там выше шанс.
export async function analyzePendingVacancies(app) {
    // Без ключа нейросети просто копим вакансии — проанализируем, когда ключ появится.
    if (!isLlmConfigured()) {
        app.log.warn('Ключ нейросети не задан в .env — анализ пропущен');
        return { found: 0, analyzed: 0, failed: 0, remaining: null, results: [] };
    }

    const vacancies = await prisma.vacancy.findMany({
        where: {
            isRelevant: null,
            isSkipped: false,
            analyzeErrors: { lt: MAX_ANALYZE_ERRORS },
        },
        orderBy: [
            { responsesCount: { sort: 'asc', nulls: 'last' } },
            { publishedAt: 'desc' },
        ],
        take: ANALYZE_BATCH_SIZE,
    });

    let analyzed = 0;
    let failed = 0;
    const results = [];

    for (let vacancy of vacancies) {
        try {
            if (!vacancy.description) {
                const details = await fetchHhVacancyDetails(vacancy.hhId);
                await sleep(HH_REQUEST_DELAY);

                vacancy = await prisma.vacancy.update({
                    where: { id: vacancy.id },
                    data: {
                        description: details.description,
                        keySkills: details.keySkills,
                        ...(details.isArchived && {
                            isRelevant: false,
                            aiReason: 'Вакансия уже в архиве',
                        }),
                    },
                });

                if (details.isArchived) {
                    continue;
                }
            }

            const analysis = await analyzeVacancy(vacancy);
            const isRelevant = analysis.isRelevant && analysis.score >= MIN_MATCH_SCORE;

            await prisma.vacancy.update({
                where: { id: vacancy.id },
                data: {
                    isRelevant,
                    matchScore: analysis.score,
                    aiReason: analysis.reason,
                    requirements: analysis.requirements.join('\n'),
                    coverLetter: isRelevant ? analysis.coverLetter : null,
                },
            });

            analyzed++;

            results.push({
                hhId: vacancy.hhId,
                title: vacancy.title,
                isRelevant,
                score: analysis.score,
                reason: analysis.reason,
            });
        } catch (error) {
            // Лимит нейросети — не вина вакансии: не считаем попытку
            // и откладываем остальные до следующей проверки.
            if (error.status === 429) {
                app.log.warn({ hhId: vacancy.hhId }, 'Лимит нейросети исчерпан, анализ отложен');
                break;
            }

            failed++;

            await prisma.vacancy.update({
                where: { id: vacancy.id },
                data: { analyzeErrors: { increment: 1 } },
            });

            app.log.error(
                { err: error, hhId: vacancy.hhId },
                'Не удалось проанализировать вакансию',
            );
        }
    }

    const remaining = await prisma.vacancy.count({
        where: {
            isRelevant: null,
            isSkipped: false,
            analyzeErrors: { lt: MAX_ANALYZE_ERRORS },
        },
    });

    return {
        found: vacancies.length,
        analyzed,
        failed,
        remaining,
        results,
    };
}

// Отправляет в Telegram подходящие вакансии, которые ещё не были доставлены.
// Если отправка не удалась, вакансия останется в очереди до следующего запуска.
export async function notifyPendingVacancies(app) {
    // Без Telegram вакансии ждут в базе и уйдут, когда бот будет настроен.
    if (!isTelegramConfigured()) {
        app.log.warn('TELEGRAM_BOT_TOKEN или TELEGRAM_CHAT_ID не заданы — отправка пропущена');
        return { notified: 0, failed: 0 };
    }

    const vacancies = await prisma.vacancy.findMany({
        where: {
            isRelevant: true,
            notifiedAt: null,
            isSkipped: false,
        },
        orderBy: { discoveredAt: 'asc' },
        take: NOTIFY_BATCH_SIZE,
    });

    let notified = 0;
    let failed = 0;

    for (const vacancy of vacancies) {
        try {
            await sendVacancyToTelegram(vacancy);

            await prisma.vacancy.update({
                where: { id: vacancy.id },
                data: { notifiedAt: new Date() },
            });

            notified++;
        } catch (error) {
            failed++;

            app.log.error(
                { err: error, hhId: vacancy.hhId },
                'Не удалось отправить вакансию в Telegram',
            );
        }
    }

    return { notified, failed };
}

export async function processVacancies(app) {
    const sync = await syncVacancies();
    const analysis = await analyzePendingVacancies(app);
    const notification = await notifyPendingVacancies(app);

    return {
        status: 'ok',
        sync,
        analysis: {
            ...analysis,
            notified: notification.notified,
            notifyFailed: notification.failed,
        },
    };
}
