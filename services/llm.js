import 'dotenv/config';

import { LLM_PROVIDERS, LLM_MODELS } from '../config.js';

// Несколько нейросетей по очереди (config.js → LLM_MODELS).
// Кончился лимит у модели — запоминаем до какого времени, и берём следующую.
// Модели провайдера без ключа в .env просто пропускаются.

const keyOf = (provider) => process.env[LLM_PROVIDERS[provider]?.keyEnv]?.trim();
const available = () => LLM_MODELS.filter((m) => keyOf(m.provider));

export function isLlmConfigured() {
    return available().length > 0;
}

function httpError(message, status) {
    const error = new Error(message);
    error.status = status;
    return error;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Минутный лимит сбрасывается быстро — такую паузу пережидаем на той же модели.
// Если просят ждать дольше — это суточный лимит: модель уходит «на отдых», берём следующую.
const MAX_RATE_LIMIT_WAIT_SECONDS = 70;
const MAX_RATE_LIMIT_RETRIES = 3;
// Если провайдер не сказал, сколько ждать, — не трогаем модель час
const DEFAULT_COOLDOWN_MS = 60 * 60 * 1000;

// "provider:model" → до какого времени модель упирается в лимит
const cooldownUntil = new Map();

async function request({ provider, model, json = true }, messages, temperature) {
    const key = keyOf(provider);
    let response;

    for (let attempt = 0; attempt <= MAX_RATE_LIMIT_RETRIES; attempt++) {
        response = await fetch(LLM_PROVIDERS[provider].url, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${key}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                model,
                messages,
                temperature,
                ...(json && { response_format: { type: 'json_object' } }),
            }),
            signal: AbortSignal.timeout(120_000),
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

    if (response.status === 429) {
        const retryAfter = Number.parseFloat(response.headers.get('retry-after'));
        const ms = Number.isFinite(retryAfter) ? retryAfter * 1000 : DEFAULT_COOLDOWN_MS;
        cooldownUntil.set(`${provider}:${model}`, Date.now() + ms);
    }

    if (!response.ok) {
        const text = (await response.text()).slice(0, 300);
        throw httpError(`${provider}:${model} вернул HTTP ${response.status}: ${text}`, response.status);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
        throw new Error(`${provider}:${model} вернул пустой ответ`);
    }

    return content;
}

// Отправляет диалог в нейросеть и возвращает текст ответа.
// Если все модели упёрлись в лимит — ошибка со status 429: process.js отложит анализ до следующей проверки.
export async function chat(messages, { temperature = 0.3 } = {}) {
    const models = available();

    if (!models.length) {
        throw new Error('Не задан ни один ключ нейросети в .env (GROQ_API_KEY, OPENROUTER_API_KEY)');
    }

    const now = Date.now();
    const ready = models.filter((m) => (cooldownUntil.get(`${m.provider}:${m.model}`) ?? 0) <= now);

    if (!ready.length) {
        throw httpError('Все нейросети упёрлись в лимит', 429);
    }

    let lastError;
    let allLimited = true;

    for (const m of ready) {
        try {
            return await request(m, messages, temperature);
        } catch (error) {
            lastError = error;
            if (error.status !== 429) {
                allLimited = false;
            }
            // Любая ошибка модели (лимит, 5xx, модель убрали) — пробуем следующую
            console.warn(`Нейросеть ${m.provider}:${m.model}: ${error.message.slice(0, 200)} — пробую следующую`);
        }
    }

    throw allLimited ? httpError('Все нейросети упёрлись в лимит', 429) : lastError;
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
