import 'dotenv/config';

import { GROQ_MODEL } from '../config.js';

// Groq: ключ тот же, что у kwork-бота, а модель своя (config.js → GROQ_MODEL).
// Лимит Groq считается отдельно для каждой модели, поэтому боты не делят его.

const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';

const groqKey = process.env.GROQ_API_KEY?.trim();

export function isLlmConfigured() {
    return Boolean(groqKey);
}

function httpError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Минутный лимит (8 000 токенов) сбрасывается быстро — такую паузу просто пережидаем.
// Если Groq просит ждать дольше, значит кончился суточный лимит.
const MAX_RATE_LIMIT_WAIT_SECONDS = 70;
const MAX_RATE_LIMIT_RETRIES = 3;

// Отправляет диалог в нейросеть и возвращает текст ответа.
export async function chat(messages, { temperature = 0.3 } = {}) {
    if (!groqKey) {
        throw new Error('Не задан GROQ_API_KEY в .env');
    }

    let response;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
        response = await fetch(GROQ_CHAT_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${groqKey}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages,
                temperature,
                response_format: { type: 'json_object' },
            }),
        });

        const retryAfter = Number.parseFloat(response.headers.get('retry-after'));

        if (
            response.status !== 429 ||
            !Number.isFinite(retryAfter) ||
            retryAfter > MAX_RATE_LIMIT_WAIT_SECONDS ||
            attempt === MAX_RATE_LIMIT_RETRIES
        ) {
            break;
        }

        await sleep((retryAfter + 1) * 1000);
    }

    // 429 здесь — суточный лимит: process.js отложит анализ до следующей проверки.
    if (!response.ok) {
        throw httpError(`Groq вернул HTTP ${response.status}: ${await response.text()}`, response.status);
    }

    const data = await response.json();

    return data.choices?.[0]?.message?.content;
}

// Достаёт JSON из ответа модели, даже если она обернула его в ```json или добавила текст.
export function extractJson(text) {
    if (!text) {
        throw new Error('Нейросеть вернула пустой ответ');
    }

    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');

    if (start === -1 || end <= start) {
        throw new Error('В ответе нейросети нет JSON');
    }

    return JSON.parse(text.slice(start, end + 1));
}
