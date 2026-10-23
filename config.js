import 'dotenv/config';

// Секреты лежат в .env, всё остальное настраивается здесь.

export const PORT = 3002;

// Как часто проверять новые вакансии.
export const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// Параметры страницы поиска hh.ru/search/vacancy.
// React/Angular отсеивает ИИ, а не запрос: иначе потеряем Vue-вакансии,
// где React упомянут как плюс.
export const HH_FILTERS = {
    // Язык запросов hh: OR, AND, NOT, кавычки, NAME: — поиск в названии.
    // Фронтенд/фуллстек в названии И Vue/Nuxt где угодно в вакансии,
    // без чужого стека и джунов в названии, без React-вакансий, где нет Vue.
    text:
        'NAME:(Frontend OR Фронтенд OR Front-end OR Fullstack OR Фулстек OR Full-stack ' +
        'OR Vue OR Nuxt OR JavaScript OR Веб-разработчик) AND (Vue OR Nuxt OR Vue.js) ' +
        'NOT NAME:(PHP OR Laravel OR Yii OR Python OR Django OR FastAPI OR Java OR Golang OR Go ' +
        'OR "C#" OR .NET OR Ruby OR Angular OR Битрикс OR Bitrix OR 1С OR Junior OR Джуниор ' +
        'OR Стажер OR Стажёр OR DevOps OR QA OR Тестировщик OR Mobile) ' +
        'NOT (NAME:React NOT NAME:(Vue OR Nuxt))',
    // 113 — вся Россия.
    areas: ['113'],
    // noExperience | between1And3 | between3And6 | moreThan6
    experience: ['between1And3', 'between3And6'],
    // REMOTE | HYBRID | ON_SITE | FIELD_WORK
    workFormat: ['REMOTE'],
};

// Сколько страниц выдачи (по 20 вакансий) смотреть за одну проверку.
export const HH_MAX_PAGES = 3;

// Отсев до ИИ — экономим запросы к нейросети.
// Больше откликов — вакансию не показываем.
export const HH_MAX_RESPONSES = 500;
// Зарплата в рублях указана и её максимум ниже — не показываем.
export const HH_MIN_SALARY = 80000;

// Модель Groq для hh. Лимит у Groq считается отдельно для каждой модели,
// поэтому берём не ту, что у kwork-бота (openai/gpt-oss-120b).
export const GROQ_MODEL = 'qwen/qwen3.8-27b';

// Сколько вакансий анализировать за одну проверку.
export const ANALYZE_BATCH_SIZE = 5;

// После стольких неудачных попыток анализа вакансия больше не берётся.
export const MAX_ANALYZE_ERRORS = 3;

// С какой оценки ИИ (0–100) вакансия приходит в Telegram.
export const MIN_MATCH_SCORE = 60;
