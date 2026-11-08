
import 'dotenv/config';
import Fastify from 'fastify';

import healthRoutes from './routes/health.js';
import hhRoutes from './routes/hh.js';
import aiRoutes from './routes/ai.js';
import botRoutes from './routes/bot.js';

import { processVacancies } from './services/process.js';
import { closeBrowser } from './services/browser.js';
import { PORT, CHECK_INTERVAL_MS } from './config.js';

const app = Fastify({
    logger: true,
});

let isProcessing = false;

async function runScheduledCheck() {
    if (isProcessing) {
        app.log.info('Предыдущая проверка ещё выполняется, пропускаем запуск');
        return;
    }

    isProcessing = true;

    try {
        app.log.info('Запуск автоматической проверки hh.ru');

        const result = await processVacancies(app);

        app.log.info(
            {
                added: result.sync.added,
                prefiltered: result.sync.prefiltered,
                analyzed: result.analysis.analyzed,
                failed: result.analysis.failed,
                notified: result.analysis.notified,
                remaining: result.analysis.remaining,
            },
            'Автоматическая проверка завершена',
        );
    } catch (error) {
        app.log.error({ err: error }, 'Ошибка автоматической проверки hh.ru');
    } finally {
        isProcessing = false;
    }
}

// Смотритель останавливает HH через SIGTERM: закрываем Chromium, иначе профиль останется занят.
async function shutdown() {
    await closeBrowser();
    await app.close();
    process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

await app.register(healthRoutes);
await app.register(hhRoutes);
await app.register(aiRoutes);
await app.register(botRoutes);

try {
    await app.listen({
        port: PORT,
        host: '127.0.0.1',
    });

    await runScheduledCheck();

    setInterval(() => {
        void runScheduledCheck();
    }, CHECK_INTERVAL_MS);
} catch (error) {
    app.log.error(error);
    await app.close();
    process.exit(1);
}
