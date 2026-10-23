import { Bot, InlineKeyboard, Keyboard } from 'grammy';

import { prisma } from '../db/db.js';

// Получаем токен бота и ID Telegram-чата из переменных окружения.
const token = process.env.TELEGRAM_BOT_TOKEN;
const chatId = process.env.TELEGRAM_CHAT_ID;

// Без токена бот не создаётся: ассистент работает дальше и копит вакансии.
export const bot = token ? new Bot(token) : null;

export function isTelegramConfigured() {
    return Boolean(bot && chatId);
}

// Лимит Telegram — 4096 символов на сообщение, оставляем запас под оформление.
const MAX_LETTER_LENGTH = 2500;
const MAX_REASON_LENGTH = 500;
const MAX_TITLE_LENGTH = 300;

// Экранируем текст для parse_mode: 'HTML'.
function escapeHtml(text) {
    return String(text)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

// Обрезаем слишком длинный текст, чтобы сообщение не отклонил Telegram.
function truncate(text, maxLength) {
    const value = String(text);

    return value.length > maxLength
        ? `${value.slice(0, maxLength)}… (текст обрезан)`
        : value;
}

// Постоянная кнопка внизу чата.
const MY_APPLICATIONS_BUTTON = '📋 Мои отклики';

const mainKeyboard = new Keyboard()
    .text(MY_APPLICATIONS_BUTTON)
    .resized()
    .persistent();

// Сколько откликов на одной странице списка и номеров страниц в одном ряду кнопок.
const APPLICATIONS_PAGE_SIZE = 10;
const PAGE_BUTTONS_PER_ROW = 8;

// Даты показываем по Челябинску.
const TIME_ZONE = 'Asia/Yekaterinburg';

// Страница списка «Мои отклики»: название-ссылка и дата, внизу кнопки 1, 2, 3…
async function buildApplicationsPage(page) {
    const total = await prisma.vacancy.count({
        where: { appliedAt: { not: null } },
    });

    if (total === 0) {
        return {
            text:
                '📋 Откликов пока нет.\n\n' +
                'Когда откликнешься на hh.ru, нажми «✅ Я отправила отклик» под вакансией.',
            keyboard: undefined,
        };
    }

    const pagesCount = Math.ceil(total / APPLICATIONS_PAGE_SIZE);
    const currentPage = Math.min(Math.max(page, 1), pagesCount);

    const applications = await prisma.vacancy.findMany({
        where: { appliedAt: { not: null } },
        orderBy: { appliedAt: 'desc' },
        skip: (currentPage - 1) * APPLICATIONS_PAGE_SIZE,
        take: APPLICATIONS_PAGE_SIZE,
        select: { title: true, url: true, appliedAt: true },
    });

    const lines = applications.map((application, index) => {
        const number = (currentPage - 1) * APPLICATIONS_PAGE_SIZE + index + 1;
        const date = application.appliedAt.toLocaleDateString('ru-RU', { timeZone: TIME_ZONE });
        const href = escapeHtml(application.url).replaceAll('"', '&quot;');

        return `${number}. <a href="${href}">${escapeHtml(truncate(application.title, 150))}</a> — ${date}`;
    });

    const header = pagesCount > 1
        ? `📋 <b>Мои отклики: ${total}</b> · стр. ${currentPage} из ${pagesCount}`
        : `📋 <b>Мои отклики: ${total}</b>`;

    let keyboard;

    if (pagesCount > 1) {
        keyboard = new InlineKeyboard();

        for (let number = 1; number <= pagesCount; number++) {
            keyboard.text(number === currentPage ? `· ${number} ·` : String(number), `apps:${number}`);

            if (number % PAGE_BUTTONS_PER_ROW === 0) {
                keyboard.row();
            }
        }
    }

    return {
        text: [header, '', ...lines].join('\n'),
        keyboard,
    };
}

async function sendMyApplications(ctx) {
    try {
        const { text, keyboard } = await buildApplicationsPage(1);

        await ctx.reply(text, {
            parse_mode: 'HTML',
            reply_markup: keyboard,
            link_preview_options: { is_disabled: true },
        });
    } catch (error) {
        console.error('Ошибка при получении списка откликов:', error);
        await ctx.reply('Не удалось загрузить список откликов. Попробуй ещё раз.');
    }
}

// Обработчики команд и кнопок.
function registerHandlers() {
    // Пускаем к боту только владельца (TELEGRAM_CHAT_ID).
    // /myid доступна всем: она нужна, чтобы узнать свой ID при настройке.
    bot.use(async (ctx, next) => {
        if (ctx.message?.text?.startsWith('/myid')) {
            await next();
            return;
        }

        const currentChatId = ctx.chat?.id ?? ctx.from?.id;

        if (chatId && String(currentChatId) === String(chatId)) {
            await next();
            return;
        }

        if (ctx.callbackQuery) {
            await ctx.answerCallbackQuery({ text: 'Нет доступа' });
        }
    });

    // Кнопка «Пропустить»: помечаем вакансию и убираем сообщение из чата.
    bot.callbackQuery(/^skip:(.+)$/, async (ctx) => {
        const hhId = ctx.match[1];

        try {
            await prisma.vacancy.update({
                where: { hhId },
                data: { isSkipped: true },
            });

            await ctx.answerCallbackQuery({
                text: 'Вакансия пропущена',
            });

            await ctx.deleteMessage();
        } catch (error) {
            console.error('Ошибка при пропуске вакансии:', error);

            await ctx.answerCallbackQuery({
                text: 'Не удалось пропустить вакансию',
                show_alert: true,
            });
        }
    });

    // Кнопка «Я отправила отклик»: запоминаем дату и убираем вакансию из чата.
    bot.callbackQuery(/^applied:(.+)$/, async (ctx) => {
        const hhId = ctx.match[1];

        try {
            const vacancy = await prisma.vacancy.findUnique({
                where: { hhId },
            });

            if (!vacancy) {
                await ctx.answerCallbackQuery({
                    text: 'Вакансия не найдена в базе',
                    show_alert: true,
                });
                return;
            }

            // Повторное нажатие не перезаписывает дату отклика.
            if (!vacancy.appliedAt) {
                await prisma.vacancy.update({
                    where: { hhId },
                    data: { appliedAt: new Date() },
                });
            }

            await ctx.answerCallbackQuery({
                text: 'Отклик сохранён в «Мои отклики»',
            });

            await ctx.deleteMessage();
        } catch (error) {
            console.error('Ошибка при сохранении отклика:', error);

            await ctx.answerCallbackQuery({
                text: 'Не удалось сохранить отклик',
                show_alert: true,
            });
        }
    });

    // Листание списка «Мои отклики» кнопками с номерами страниц.
    bot.callbackQuery(/^apps:(\d+)$/, async (ctx) => {
        const page = Number(ctx.match[1]);

        try {
            const { text, keyboard } = await buildApplicationsPage(page);

            await ctx.editMessageText(text, {
                parse_mode: 'HTML',
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
            });

            await ctx.answerCallbackQuery();
        } catch (error) {
            // Нажали на текущую страницу — Telegram не даёт «изменить» на тот же текст.
            if (error.description?.includes('message is not modified')) {
                await ctx.answerCallbackQuery();
                return;
            }

            console.error('Ошибка при листании откликов:', error);

            await ctx.answerCallbackQuery({
                text: 'Не удалось открыть страницу',
                show_alert: true,
            });
        }
    });

    // Кнопка «Мои отклики» внизу чата.
    bot.hears(MY_APPLICATIONS_BUTTON, sendMyApplications);

    // Команда /myapplications.
    bot.command('myapplications', sendMyApplications);

    // Команда /start.
    bot.command('start', async (ctx) => {
        await ctx.reply(
            'Привет! Я HH Assistant 🤖\n\n' +
            'Каждые полчаса проверяю новые вакансии на hh.ru и присылаю подходящие: ' +
            'что требуют и черновик сопроводительного письма.\n\n' +
            'Откликаешься ты сама на hh.ru: нажми на текст письма в сообщении — он скопируется целиком. ' +
            'После отклика нажми «✅ Я отправила отклик» — вакансия попадёт в «📋 Мои отклики».',
            {
                reply_markup: mainKeyboard,
            }
        );
    });

    // Команда /myid.
    bot.command('myid', async (ctx) => {
        await ctx.reply(`Твой Telegram ID: ${ctx.from.id}`);
    });

    // Глобальный обработчик ошибок grammY.
    bot.catch((error) => {
        console.error('Ошибка Telegram-бота:', error);
    });
}

if (bot) {
    registerHandlers();
}

// Запускаем Telegram-бота и настраиваем команды.
export async function startTelegramBot() {
    if (!bot) {
        console.warn('TELEGRAM_BOT_TOKEN не задан в .env — Telegram-бот не запущен');
        return;
    }

    // Настройка команд не должна блокировать запуск бота.
    try {
        await bot.api.setMyCommands([
            { command: 'start', description: 'Запустить бота' },
            { command: 'myapplications', description: 'Мои отклики' },
            { command: 'myid', description: 'Показать Telegram ID' },
        ]);
    } catch (error) {
        console.error(
            'Не удалось настроить команды Telegram, продолжаем запуск:',
            error.message
        );
    }

    // Запускаем получение сообщений и обработку команд.
    await bot.start({
        onStart: (botInfo) => {
            console.log(`Telegram-бот @${botInfo.username} запущен`);
        },
    });
}

// Отправляем подходящую вакансию в Telegram.
export async function sendVacancyToTelegram(vacancy) {
    if (!isTelegramConfigured()) {
        throw new Error('Не заданы TELEGRAM_BOT_TOKEN и TELEGRAM_CHAT_ID в файле .env');
    }

    const conditions = [vacancy.workFormat, vacancy.employment, vacancy.experience && `опыт ${vacancy.experience}`]
        .filter(Boolean)
        .join(' · ');

    const requirements = (vacancy.requirements || '')
        .split('\n')
        .filter(Boolean)
        .map((item) => `• ${escapeHtml(item)}`);

    const message = [
        `💼 <b>${escapeHtml(truncate(vacancy.title, MAX_TITLE_LENGTH))}</b>`,
        `🏢 ${escapeHtml(vacancy.company || 'Компания не указана')}${vacancy.area ? ` · ${escapeHtml(vacancy.area)}` : ''}`,
        `💰 ${escapeHtml(vacancy.salary || 'Зарплата не указана')}`,
        conditions ? `🗂 ${escapeHtml(conditions)}` : null,
        `👥 Откликов: ${vacancy.responsesCount ?? '—'} · ⭐ Совпадение: ${vacancy.matchScore ?? '—'}/100`,
        vacancy.letterRequired && '📝 Сопроводительное письмо обязательно',
        '',
        '🧩 <b>Что требуют:</b>',
        ...(requirements.length ? requirements : ['Не определено']),
        '',
        '🧠 <b>Почему подходит:</b>',
        escapeHtml(truncate(vacancy.aiReason || 'Причина не указана', MAX_REASON_LENGTH)),
        '',
        // <pre> копируется целиком одним нажатием на текст. Отдельной кнопки нет:
        // нативная кнопка копирования Telegram берёт не больше 256 символов.
        '✍️ <b>Черновик сопроводительного</b> (нажми на текст — скопируется):',
        `<pre>${escapeHtml(truncate(vacancy.coverLetter || 'Черновик отсутствует', MAX_LETTER_LENGTH))}</pre>`,
    ]
        .filter((line) => line !== false && line !== null && line !== undefined)
        .join('\n');

    // Действия: открыть, отметить отклик, пропустить.
    const keyboard = new InlineKeyboard()
        .url('🔗 Открыть вакансию', vacancy.url)
        .row()
        .text('✅ Я отправила отклик', `applied:${vacancy.hhId}`)
        .text('⏭ Пропустить', `skip:${vacancy.hhId}`);

    const sentMessage = await bot.api.sendMessage(chatId, message, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });

    return sentMessage.message_id;
}
