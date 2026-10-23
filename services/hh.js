// Публичный API поиска hh.ru с апреля 2026 отвечает 403 без токена работодателя,
// поэтому читаем данные, которые сайт встраивает в страницу
// (<template id="HH-Lux-InitialState"> с JSON внутри).

const HH_URL = 'https://hh.ru';

const USER_AGENT =
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/130.0 Safari/537.36';

const EXPERIENCE_LABELS = {
    noExperience: 'без опыта',
    between1And3: '1–3 года',
    between3And6: '3–6 лет',
    moreThan6: 'более 6 лет',
};

const WORK_FORMAT_LABELS = {
    REMOTE: 'удалённо',
    HYBRID: 'гибрид',
    ON_SITE: 'офис',
    FIELD_WORK: 'разъездная',
};

const EMPLOYMENT_LABELS = {
    FULL: 'полная занятость',
    PART: 'частичная занятость',
    PROJECT: 'проектная работа',
    FLY_IN_FLY_OUT: 'вахта',
    SIDE_JOB: 'подработка',
};

function decodeHtmlEntities(text) {
    return text
        .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
        .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
        .replaceAll('&quot;', '"')
        .replaceAll('&lt;', '<')
        .replaceAll('&gt;', '>')
        .replaceAll('&nbsp;', ' ')
        .replaceAll('&amp;', '&');
}

// HTML описания вакансии → читаемый текст со списками и абзацами.
function htmlToText(html) {
    const text = String(html ?? '')
        .replace(/<li[^>]*>/gi, '\n- ')
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/(p|div|ul|ol|h\d)>/gi, '\n')
        .replace(/<[^>]+>/g, '');

    return decodeHtmlEntities(text)
        .replace(/[ \t]+/g, ' ')
        .replace(/\n\s*\n\s*/g, '\n\n')
        .trim();
}

async function fetchInitialState(url) {
    const response = await fetch(url, {
        headers: {
            'User-Agent': USER_AGENT,
            Accept: 'text/html,application/xhtml+xml',
            'Accept-Language': 'ru-RU,ru;q=0.9',
        },
    });

    if (!response.ok) {
        throw new Error(`hh.ru вернул HTTP ${response.status} для ${url}`);
    }

    const html = await response.text();
    const match = html.match(/<template[^>]*id="HH-Lux-InitialState"[^>]*>([\s\S]*?)<\/template>/);

    if (!match) {
        // Обычно это капча или изменилась вёрстка hh.ru.
        throw new Error(`На странице hh.ru не найдены данные: ${url}`);
    }

    return JSON.parse(decodeHtmlEntities(match[1]));
}

function formatSalary(compensation) {
    if (!compensation || (!compensation.from && !compensation.to)) {
        return null;
    }

    const currency = compensation.currencyCode === 'RUR' ? '₽' : compensation.currencyCode;
    const format = (value) => value.toLocaleString('ru-RU');
    const range = [
        compensation.from ? `от ${format(compensation.from)}` : null,
        compensation.to ? `до ${format(compensation.to)}` : null,
    ].filter(Boolean).join(' ');
    const tax = compensation.gross ? ' до вычета налогов' : ' на руки';
    const mode = compensation.mode && compensation.mode !== 'MONTH' ? ' (не помесячно)' : '';

    return `${range} ${currency}${tax}${mode}`;
}

// Максимальная месячная зарплата в рублях или null, если сравнить нельзя.
export function getMaxMonthlySalaryRub(compensation) {
    if (
        !compensation ||
        compensation.currencyCode !== 'RUR' ||
        (compensation.mode && compensation.mode !== 'MONTH')
    ) {
        return null;
    }

    return compensation.to ?? compensation.from ?? null;
}

function mapSearchItem(item) {
    const workFormats = item.workFormats?.[0]?.workFormatsElement ?? [];

    return {
        hhId: String(item.vacancyId),
        title: item.name,
        url: item.links?.desktop ?? `${HH_URL}/vacancy/${item.vacancyId}`,
        company: item.company?.visibleName ?? item.company?.name ?? null,
        area: item.area?.name ?? null,
        salary: formatSalary(item.compensation),
        experience: EXPERIENCE_LABELS[item.workExperience] ?? item.workExperience ?? null,
        workFormat: workFormats.map((format) => WORK_FORMAT_LABELS[format] ?? format).join(', ') || null,
        employment: EMPLOYMENT_LABELS[item.employmentForm] ?? item.employmentForm ?? null,
        responsesCount: Number.isInteger(item.responsesCount) ? item.responsesCount : null,
        letterRequired: item['@responseLetterRequired'] === true,
        publishedAt: item.publicationTime?.$ ? new Date(item.publicationTime.$) : null,
    };
}

// Одна страница выдачи поиска. page начинается с 0, как на hh.ru.
export async function fetchHhVacancies(filters, page = 0) {
    const params = new URLSearchParams({
        text: filters.text,
        order_by: 'publication_time',
        items_on_page: '20',
        page: String(page),
    });

    for (const area of filters.areas) params.append('area', area);
    for (const experience of filters.experience) params.append('experience', experience);
    for (const format of filters.workFormat) params.append('work_format', format);

    const state = await fetchInitialState(`${HH_URL}/search/vacancy?${params}`);
    const result = state.vacancySearchResult;

    if (!result || !Array.isArray(result.vacancies)) {
        throw new Error('Не удалось разобрать выдачу поиска hh.ru');
    }

    return {
        total: result.totalResults ?? 0,
        vacancies: result.vacancies.map((item) => ({
            ...mapSearchItem(item),
            // Сырые данные о зарплате нужны для отсева, в базу не пишем.
            compensation: item.compensation ?? null,
        })),
    };
}

// Полное описание и ключевые навыки со страницы вакансии.
export async function fetchHhVacancyDetails(hhId) {
    const state = await fetchInitialState(`${HH_URL}/vacancy/${hhId}`);
    const vacancy = state.vacancyView?.vacancyFull?.vacancy;

    if (!vacancy) {
        throw new Error(`Не удалось разобрать страницу вакансии ${hhId}`);
    }

    return {
        description: htmlToText(vacancy.description),
        keySkills: Array.isArray(vacancy.keySkills) ? vacancy.keySkills.map(String) : [],
        isArchived: vacancy.status?.archived === true || vacancy.closedForApplicants === true,
    };
}
