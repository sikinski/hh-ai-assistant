import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

// Свой Chromium с отдельным профилем: вход в hh.ru делается один раз, куки живут в профиле.
// Окно обычное, его можно свернуть, но не закрывать — в нём же решается капча и вход.
// Профиль лежит в папке HH: смотритель по ней находит и закрывает Chromium, оставшийся от упавшего HH.
export const PROFILE_DIR = fileURLToPath(new URL('../data/browser-profile', import.meta.url));

export class BrowserBusyError extends Error {}

let contextPromise = null;

// Chromium держит в профиле ссылку SingletonLock → «hostname-pid». Если тот процесс жив — профиль занят.
function getProfileOwnerPid() {
    try {
        const pid = Number(fs.readlinkSync(`${PROFILE_DIR}/SingletonLock`).split('-').pop());

        if (!pid) {
            return null;
        }

        process.kill(pid, 0);
        return pid;
    } catch {
        return null;
    }
}

export function openBrowser() {
    if (!contextPromise) {
        const owner = getProfileOwnerPid();

        if (owner) {
            return Promise.reject(
                new BrowserBusyError(`Профиль браузера HH занят (Chromium, pid ${owner}) — ассистент уже запущен?`),
            );
        }

        fs.mkdirSync(PROFILE_DIR, { recursive: true });
    }

    contextPromise ??= chromium
        .launchPersistentContext(PROFILE_DIR, {
            headless: false,
            viewport: null,
            locale: 'ru-RU',
            timezoneId: 'Asia/Yekaterinburg',
            ignoreDefaultArgs: ['--enable-automation'],
            args: [
                '--disable-blink-features=AutomationControlled',
                // Свёрнутое окно Chrome «усыпляет» — без этих флагов страницы грузятся рывками.
                '--disable-background-timer-throttling',
                '--disable-renderer-backgrounding',
                '--disable-backgrounding-occluded-windows',
            ],
        })
        .then((context) => {
            // Закрыли окно руками — при следующем запросе откроем заново.
            context.on('close', () => {
                contextPromise = null;
            });
            return context;
        })
        .catch((error) => {
            contextPromise = null;

            if (/ProcessSingleton|SingletonLock|already in use/i.test(error.message)) {
                throw new BrowserBusyError('Профиль браузера HH уже открыт другим процессом');
            }

            throw error;
        });

    return contextPromise;
}

// Одна вкладка на всё: так hh видит одного человека, а не десяток параллельных окон.
export async function getPage() {
    const context = await openBrowser();

    return context.pages()[0] ?? (await context.newPage());
}

export async function closeBrowser() {
    const context = await contextPromise?.catch(() => null);

    contextPromise = null;
    await context?.close().catch(() => {});
}
