
import { prisma } from '../db/db.js';

export default async function healthRoutes(app) {
    app.get('/', async () => {
        return {
            message: 'HH Assistant is running!',
        };
    });

    app.get('/db-test', async () => {
        const count = await prisma.vacancy.count();

        return {
            status: 'ok',
            database: 'connected',
            vacancies: count,
        };
    });
}
