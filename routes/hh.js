import { syncVacancies, processVacancies } from '../services/process.js';

export default async function hhRoutes(app) {
    app.post('/sync', async () => {
        const result = await syncVacancies();

        return {
            status: 'ok',
            ...result,
        };
    });

    app.post('/process', async () => {
        return await processVacancies(app);
    });
}
