
import { analyzePendingVacancies } from '../services/process.js';

export default async function aiRoutes(app) {
    app.post('/analyze', async () => {
        return {
            status: 'ok',
            ...(await analyzePendingVacancies(app)),
        };
    });
}
