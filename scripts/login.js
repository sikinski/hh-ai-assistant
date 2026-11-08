// Вход руками: открывает окно Chromium с профилем ассистента на странице входа hh.ru.
// Войди (код придёт на почту или в SMS), потом закрой окно — вход сохранится в профиле.
// Пока работает ассистент (npm start), этот скрипт не запустится — профиль занят;
// тогда просто войди в уже открытом окне Chromium ассистента.
import { openBrowser, closeBrowser, BrowserBusyError } from '../services/browser.js';

try {
    const context = await openBrowser();
    const page = context.pages()[0] ?? (await context.newPage());

    await page.goto('https://hh.ru/account/login');

    console.log('Войди в hh.ru в открытом окне Chromium. Когда закончишь — закрой окно.');

    await new Promise((resolve) => context.on('close', resolve));
} catch (error) {
    if (error instanceof BrowserBusyError) {
        console.log(`${error.message}\nВойди в hh.ru прямо в окне Chromium ассистента.`);
    } else {
        throw error;
    }
} finally {
    await closeBrowser();
}
