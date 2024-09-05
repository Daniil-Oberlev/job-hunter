import fs from "fs";
import path from "path";
import puppeteer, { Page } from "puppeteer";
import { fileURLToPath } from "url";

// Конфигурация
const COVER_LETTER =
  "Меня зовут { ИМЯ }, я активно развиваюсь во { СФЕРА ДЕЯТЕЛЬНОСТИ } разработке и хотел бы предложить свою кандидатуру. У меня есть опыт работы, и я уверен, что смогу успешно справиться с задачами на этой позиции.";
const SEARCH_URL = "https://hh.ru/search/vacancy?text=";
const HH_LOGIN = "{ НОМЕР ТЕЛЕФОН ИЛИ ПОЧТА }";

// Получаем путь к текущему модулю
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Пути для логов
const successLogPath = path.resolve(__dirname, "../logs/success.log");
const errorLogPath = path.resolve(__dirname, "../logs/error.log");

// Селекторы
export const SELECTORS = {
  LOGIN_INPUT: 'input[name="login"]',
  CONTINUE_BUTTON: 'button[data-qa="account-signup-submit"]',
  RESPONSE_BUTTON: 'a[data-qa="vacancy-response-link-top"]',
  POPUP_SUBMIT_BUTTON: 'button[data-qa="vacancy-response-submit-popup"]',
  TEXTAREA: 'textarea[data-qa="vacancy-response-popup-form-letter-input"]',
  RELOCATION_WARNING_BUTTON: 'button[data-qa="relocation-warning-confirm"]',
};

// Логирование
export function logToFileSync(filePath: string, message: string) {
  fs.appendFileSync(filePath, `${new Date().toISOString()} - ${message}\n`);
}

// Задержка
export async function delay(time: number) {
  return new Promise((resolve) => setTimeout(resolve, time));
}

// Вход в аккаунт
export async function login(page: Page) {
  await page.goto("https://hh.ru/account/login", { waitUntil: "networkidle2" });
  await page.type(SELECTORS.LOGIN_INPUT, HH_LOGIN, { delay: 100 });

  const continueButton = await page.waitForSelector(SELECTORS.CONTINUE_BUTTON, {
    visible: true,
  });
  await continueButton?.click();

  console.log("Капча ожидается. Пожалуйста, решите её вручную.");
  await page.waitForNavigation({ waitUntil: "networkidle2" });

  const isLoggedIn = await page.evaluate(
    () => !!document.querySelector('a[data-qa="mainmenu_myResumes"]')
  );
  if (!isLoggedIn) {
    throw new Error("Не удалось войти в аккаунт. Проверьте логин и пароль.");
  }
  console.log("Успешный вход в аккаунт.");
}

// Обработка попапа с предупреждением о релокации
async function handleRelocationWarning(page: Page) {
  const relocationButton = await page.$(SELECTORS.RELOCATION_WARNING_BUTTON);
  if (relocationButton) {
    await relocationButton.click();
    console.log(
      "Нажата кнопка 'Все равно откликнуться' для иностранной вакансии."
    );
    await delay(1000);
  }
}

// Обработка вакансии
async function processVacancy(page: Page, vacancyUrl: string) {
  try {
    // Переход на страницу вакансии
    await page.goto(vacancyUrl, { waitUntil: "domcontentloaded" }); // Измените на domcontentloaded

    // Ожидание кнопки отклика
    const responseButton = await page.waitForSelector(
      SELECTORS.RESPONSE_BUTTON,
      { timeout: 15000 } // Увеличьте таймаут
    );
    if (responseButton) {
      await responseButton.click();
      await delay(1000);

      // Проверяем наличие кнопки для предупреждения о релокации
      await handleRelocationWarning(page);

      // Ожидаем секунду
      await delay(1000);

      // Проверяем наличие поля для сопроводительного письма
      const textarea = await page.$(SELECTORS.TEXTAREA);
      if (textarea) {
        await page.evaluate((text) => {
          const input = document.querySelector(
            SELECTORS.TEXTAREA
          ) as HTMLTextAreaElement;
          if (input) input.value = text;
        }, COVER_LETTER);

        const popupSubmitButton = await page.$(SELECTORS.POPUP_SUBMIT_BUTTON);
        if (popupSubmitButton) {
          await popupSubmitButton.click();
          logToFileSync(
            successLogPath,
            `Отправлено сопроводительное письмо для вакансии: ${vacancyUrl}`
          );
          console.log(
            `Отправлено сопроводительное письмо для вакансии: ${vacancyUrl}`
          );
        } else {
          logToFileSync(
            errorLogPath,
            `Не отправлено из-за отсутствия кнопки отправки: ${vacancyUrl}`
          );
          console.log(
            `Не отправлено из-за отсутствия кнопки отправки: ${vacancyUrl}`
          );
        }
      } else {
        logToFileSync(
          errorLogPath,
          `Не требуется сопроводительное письмо для вакансии: ${vacancyUrl}`
        );
        console.log(
          `Не требуется сопроводительное письмо для вакансии: ${vacancyUrl}`
        );
      }
    } else {
      logToFileSync(
        errorLogPath,
        `Кнопка отклика не найдена для вакансии: ${vacancyUrl}`
      );
      console.log(`Кнопка отклика не найдена для вакансии: ${vacancyUrl}`);
    }
  } catch (error) {
    logToFileSync(
      errorLogPath,
      `Ошибка при обработке вакансии ${vacancyUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(
      `Ошибка при обработке вакансии ${vacancyUrl}: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

// Запуск поиска вакансий
export async function startJobSearch(jobType: string) {
  const searchUrl = `${SEARCH_URL}${encodeURIComponent(jobType)}`;
  const browser = await puppeteer.launch({
    headless: false, // Change to true for production
    args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  page.setViewport({ width: 1280, height: 800 });

  try {
    await login(page);
    console.log(`Переход на страницу поиска: ${searchUrl}`);
    await page.goto(searchUrl, { waitUntil: "networkidle2" });

    const vacancyLinks = await page.$$eval(
      'a[data-qa="serp-item__title"]',
      (links) => links.map((link) => link.getAttribute("href"))
    );
    console.log("Найденные ссылки на вакансии:", vacancyLinks);

    // Последовательная обработка вакансий
    for (const link of vacancyLinks) {
      if (link) {
        const vacancyUrl = link.startsWith("http")
          ? link
          : new URL(link, "https://hh.ru").toString();
        console.log("Открываем вакансию по ссылке:", vacancyUrl);
        await processVacancy(page, vacancyUrl);
      }
    }
  } catch (error) {
    logToFileSync(
      errorLogPath,
      `Произошла ошибка: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    console.error(
      `Произошла ошибка: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  } finally {
    await browser.close();
  }
}

// Запуск поиска вакансий
startJobSearch("JavaScript developer");
