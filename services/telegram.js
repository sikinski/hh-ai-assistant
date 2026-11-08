import { Api, InlineKeyboard } from 'grammy';

import { prisma } from '../db/db.js';

// Бот общий со смотрителем (MAIN_ASSISTANT): токен и чат те же, что в его .env.
// Обновления бота читает только смотритель — два читателя у одного токена Telegram не пускает.
// Поэтому HH лишь отправляет сообщения, а нажатия своих кнопок получает от смотрителя
// через POST /bot/callback и /bot/command (routes/bot.js).
const token = process.env.MAIN_BOT_TOKEN?.trim();
const chatId = process.env.MAIN_BOT_CHAT_ID?.trim();

const api = token ? new Api(token) : null;

export function isTelegramConfigured() {
    return Boolean(api && chatId);
}

// Кнопки с этим префиксом смотритель пересылает в HH: fwd:hh:<действие>:<параметр>.
const CALLBACK_PREFIX = 'fwd:hh:';

// Лимит Telegram — 4096 символов на сообщение, оставляем запас под оформление.
const MAX_LETTER_LENGTH = 2500;
const MAX_REASON_LENGTH = 500;
const MAX_TITLE_LENGTH = 300;

// Экранируем текст для parse_mode: 'HTML'.
export function escapeHtml(text) {
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
                '📋 Откликов на hh пока нет.\n\n' +
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
        ? `📋 <b>Отклики HH: ${total}</b> · стр. ${currentPage} из ${pagesCount}`
        : `📋 <b>Отклики HH: ${total}</b>`;

    let keyboard;

    if (pagesCount > 1) {
        keyboard = new InlineKeyboard();

        for (let number = 1; number <= pagesCount; number++) {
            keyboard.text(number === currentPage ? `· ${number} ·` : String(number), `${CALLBACK_PREFIX}apps:${number}`);

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

// Кнопка «📋 Отклики HH» внизу бота смотрителя.
export async function sendMyApplications() {
    const { text, keyboard } = await buildApplicationsPage(1);

    await api.sendMessage(chatId, text, {
        parse_mode: 'HTML',
        reply_markup: keyboard,
        link_preview_options: { is_disabled: true },
    });
}

// Нажатие кнопки под сообщением HH. Возвращает текст всплывашки для смотрителя.
export async function handleCallback(data, messageId) {
    const [action, param] = String(data).slice(CALLBACK_PREFIX.length).split(':');

    // «Пропустить»: помечаем вакансию и убираем сообщение из чата.
    if (action === 'skip') {
        await prisma.vacancy.update({
            where: { hhId: param },
            data: { isSkipped: true },
        });

        await api.deleteMessage(chatId, messageId);

        return { text: 'Вакансия пропущена' };
    }

    // «Я отправила отклик»: запоминаем дату и убираем вакансию из чата.
    if (action === 'applied') {
        const vacancy = await prisma.vacancy.findUnique({
            where: { hhId: param },
        });

        if (!vacancy) {
            return { text: 'Вакансия не найдена в базе', alert: true };
        }

        // Повторное нажатие не перезаписывает дату отклика.
        if (!vacancy.appliedAt) {
            await prisma.vacancy.update({
                where: { hhId: param },
                data: { appliedAt: new Date() },
            });
        }

        await api.deleteMessage(chatId, messageId);

        return { text: 'Отклик сохранён в «Отклики HH»' };
    }

    // Листание списка откликов кнопками с номерами страниц.
    if (action === 'apps') {
        const { text, keyboard } = await buildApplicationsPage(Number(param));

        try {
            await api.editMessageText(chatId, messageId, text, {
                parse_mode: 'HTML',
                reply_markup: keyboard,
                link_preview_options: { is_disabled: true },
            });
        } catch (error) {
            // Нажали на текущую страницу — Telegram не даёт «изменить» на тот же текст.
            if (!error.description?.includes('message is not modified')) {
                throw error;
            }
        }

        return { text: '' };
    }

    return { text: 'Неизвестная кнопка', alert: true };
}

// Отправляем подходящую вакансию в Telegram.
export async function sendVacancyToTelegram(vacancy) {
    if (!isTelegramConfigured()) {
        throw new Error('Не заданы MAIN_BOT_TOKEN и MAIN_BOT_CHAT_ID в файле .env');
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
        .text('✅ Я отправила отклик', `${CALLBACK_PREFIX}applied:${vacancy.hhId}`)
        .text('⏭ Пропустить', `${CALLBACK_PREFIX}skip:${vacancy.hhId}`);

    const sentMessage = await api.sendMessage(chatId, `🟦 <b>HH</b>\n${message}`, {
        reply_markup: keyboard,
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
    });

    return sentMessage.message_id;
}
