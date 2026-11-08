import { handleCallback, sendMyApplications, isTelegramConfigured } from '../services/telegram.js';

// Сюда смотритель (MAIN_ASSISTANT) пересылает нажатия кнопок HH в общем боте.
// Сервер слушает только 127.0.0.1, так что снаружи эти адреса недоступны.
export default async function botRoutes(app) {
    // Inline-кнопка под сообщением HH: { data: "fwd:hh:…", messageId }.
    app.post('/bot/callback', async (request) => {
        const { data, messageId } = request.body ?? {};

        if (!isTelegramConfigured()) {
            return { text: 'У HH не задан бот в .env', alert: true };
        }

        try {
            return await handleCallback(data, messageId);
        } catch (error) {
            app.log.error({ err: error, data }, 'Не удалось обработать кнопку Telegram');
            return { text: 'Не получилось, смотри лог HH', alert: true };
        }
    });

    // Кнопка внизу бота смотрителя: { command: "applications" }.
    app.post('/bot/command', async (request) => {
        const { command } = request.body ?? {};

        if (command === 'applications') {
            await sendMyApplications();
            return { status: 'ok' };
        }

        return { status: 'unknown' };
    });
}
