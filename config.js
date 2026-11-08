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
    // HYBRID — hh иногда так помечает удалёнку; офисный гибрид отсеет ИИ.
    workFormat: ['REMOTE', 'HYBRID'],
};

// Второй поиск — всё про ИИ и нейросети. Стек, уровень и опыт тут не важны,
// поэтому фильтра по опыту нет: неподходящее отсеет ИИ.
// Без «агент»/«agentic»: hh склоняет их до «агента по недвижимости».
export const HH_AI_FILTERS = {
    ...HH_FILTERS,
    text:
        '(NAME:(AI OR ИИ OR LLM OR GPT OR ChatGPT OR нейросет* OR нейронн* OR промпт* OR prompt OR ML OR RAG ' +
        'OR генеративн* OR n8n OR вайбкод* OR "vibe coding" OR "вайб кодинг") ' +
        'OR "vibe coding" OR вайбкод* OR "вайб кодинг" OR "Claude Code" OR LangChain) ' +
        'NOT NAME:(Junior OR Джуниор OR Стажер OR Стажёр OR Intern OR продаж* OR Sales OR бухгалтер* ' +
        'OR риэлтор* OR риелтор* OR недвижимост* OR страхов* OR "Call Center")',
    experience: [],
};

// Третий поиск — разработка на любом стеке (React, Angular, бэкенд…), где ИИ есть в тексте вакансии:
// с нейросетями пишу на любом стеке. «Engineer»/«Инженер» не берём: hh тащит «помощника инженера».
export const HH_DEV_AI_FILTERS = {
    ...HH_FILTERS,
    text:
        'NAME:(Frontend OR Фронтенд OR Front-end OR Fullstack OR Фулстек OR Full-stack OR Backend OR Бэкенд ' +
        'OR Back-end OR React OR Angular OR Node OR Python OR Разработчик OR Developer OR Программист ' +
        'OR "Software Engineer") ' +
        'AND (LLM OR нейросет* OR ChatGPT OR OpenAI OR Claude OR Cursor OR "vibe coding" OR вайбкод* ' +
        'OR LangChain OR RAG OR "AI-ассистент*" OR "ИИ-ассистент*" OR "искусственного интеллекта" ' +
        'OR "AI-агент*" OR "ИИ-агент*" OR генеративн*) ' +
        'NOT NAME:(Junior OR Джуниор OR Стажер OR Стажёр OR Intern OR 1С OR Битрикс OR Bitrix OR QA ' +
        'OR Тестировщик OR DevOps OR Аналитик)',
    experience: [],
};

// Все поиски по очереди. Вакансия, найденная несколькими, сохраняется один раз.
export const HH_SEARCHES = [
    { name: 'Vue/Nuxt', filters: HH_FILTERS },
    { name: 'ИИ', filters: HH_AI_FILTERS },
    { name: 'Любой стек + ИИ', filters: HH_DEV_AI_FILTERS },
];

// Сколько страниц выдачи (по 20 вакансий) смотреть за одну проверку — в каждом поиске.
export const HH_MAX_PAGES = 3;

// Отсев до ИИ — экономим запросы к нейросети.
// Больше откликов — вакансию не показываем. На удалённых фронтенд-вакансиях
// обычно 1000–3000 откликов, отсекаем только совсем безнадёжные.
export const HH_MAX_RESPONSES = 3000;
// Зарплата в рублях указана и её максимум ниже — не показываем.
export const HH_MIN_SALARY = 80000;

// Нейросети по порядку: кончился лимит у одной — берётся следующая.
// Лимит Groq считается отдельно для каждой модели, но ключ общий с kwork, TG и geekjob:
// gpt-oss-20b/120b — их основные модели, поэтому идут после своей qwen.
// OpenRouter (:free) — ключ общий с TG и hostaway, ~50 запросов в сутки на всех.
// json: false — модель не понимает response_format, JSON просим только в промпте.
export const LLM_PROVIDERS = {
    groq: { url: 'https://api.groq.com/openai/v1/chat/completions', keyEnv: 'GROQ_API_KEY' },
    openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', keyEnv: 'OPENROUTER_API_KEY' },
};

export const LLM_MODELS = [
    { provider: 'groq', model: 'qwen/qwen3.8-27b' },
    { provider: 'groq', model: 'openai/gpt-oss-20b' },
    { provider: 'groq', model: 'openai/gpt-oss-120b' },
    { provider: 'openrouter', model: 'google/gemma-4-31b-it:free' },
    { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free', json: false },
];

// Сколько вакансий анализировать за одну проверку.
export const ANALYZE_BATCH_SIZE = 5;

// После стольких неудачных попыток анализа вакансия больше не берётся.
export const MAX_ANALYZE_ERRORS = 3;

// С какой оценки ИИ (0–100) вакансия приходит в Telegram.
export const MIN_MATCH_SCORE = 60;
