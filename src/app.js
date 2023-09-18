#!usr/bin/env node

import puppeteer from "puppeteer";
import {
  intro,
  outro,
  confirm,
  text,
  group,
  spinner,
  select,
} from "@clack/prompts";
import axios from "axios";
import fs from "fs-extra";
import path from "path";

class App {
  constructor() {
    intro("Настройка BigBlueButton бота");
  }
  async init() {
    this.settings = await group({
      url: () =>
        text({ message: "Введите ссылку с которой можно попасть на Вебинар" }),
      downloadSlides: () => confirm({ message: "Скачать презентацию?" }),
      saveNotes: () => confirm({ message: "Сохранять заметки?" }),
      savedNotesFormat: () =>
        select({
          message: "Формат заметок?",
          initialValue: { value: "pdf", label: "PDF" },
          options: [
            { value: "pdf", label: "PDF" },
            { value: "doc", label: "Word" },
            { value: "html", label: "HTML" },
            { value: "txt", label: "Текст" },
            { value: "odt", label: "ODF (Open Document Format)" },
            { value: "etherpad", label: "Etherpad" },
          ],
        }),
      savePath: ({ results }) => {
        if (results.downloadSlides || results.saveNotes)
          return text({
            message: "Введите путь куда сохранять данные",
            initialValue: `./saves/${Date.now()}`,
          });
      },
    });

    outro("Настройка BigBlueButton бота завершена");

    const browser = await puppeteer.launch({
      headless: false,
    });
    const page = await browser.newPage();

    await page.goto(this.settings.url);

    // может в версии чгу нормально будет работать, но в тестовой нужно создавать новую сессию каждый раз иначе не заходит
    await intro("Настройка в браузере");
    const result = await confirm({
      message: "Вошел?",
    });
    await outro("Настройка в браузере завершена");

    this.url = new URL(page.url());

    if (!result) return;

    if (this.settings.downloadSlides) {
      const slideEl = await page.waitForSelector(
        "#slide-background-shape_image"
      );

      const slideData = await slideEl?.evaluate((el) => {
        return el.getAttribute("src");
      });

      if (slideEl) {
        const slidesBase = slideData.split("/").slice(0, -1).join("/");
        await this.download_svgs(slidesBase);
      } else {
        console.log("Не найден элемент презентации, ее нельзя скачать");
      }
    }

    await page.click(".sc-ANeCo"); // кнопка заметок (может быть с другим классом в версии чгу)

    if (this.settings.saveNotes) {
      fs.mkdirSync(`${this.settings.savePath}/notes`, { recursive: true });

      setTimeout(async () => {
        const exportPdf = await page.waitForSelector(
          "#layout > div:nth-child(2) > div > div > iframe"
        );

        const padLink = new URL(
          await exportPdf?.evaluate((el) => {
            return el.getAttribute("src");
          })
        );

        console.log(`Ссылка заметок: ${padLink.toString()}`);

        const notesExportLink = `${
          this.url.origin
        }/pad/p/${padLink.searchParams.get("padName")}/export/${
          this.settings.savedNotesFormat
        }${this.url.search}`;

        console.log(
          `Ссылка экспорта ${this.settings.savedNotesFormat}:`,
          notesExportLink
        );

        intro("Начинаю сохранять заметки");

        const client = await page.target().createCDPSession();
        await client.send("Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: path.resolve(`${this.settings.savePath}/notes/`),
        });

        this.currNoteId = 0;

        const s = spinner();
        s.start("Начинаю сохранять заметки");

        fs.watch(`${this.settings.savePath}/notes`, (event, filename) => {
          if (
            event === "change" &&
            filename === `Shared_Notes.${this.settings.savedNotesFormat}`
          ) {
            try {
              fs.renameSync(
                `${this.settings.savePath}/notes/Shared_Notes.${this.settings.savedNotesFormat}`,
                `${this.settings.savePath}/notes/${this.currNoteId}.${this.settings.savedNotesFormat}`
              );
              s.message(`Заметка ${this.currNoteId} сохранена`);
            } catch (e) {
              s.message(
                `Заметка ${this.currNoteId} не сохранена (ошибка в переименовывании) (${e.message})`
              );
            }
          }
        });

        this.save_notes(notesExportLink, s, page);
        setInterval(() => {
          this.save_notes(notesExportLink, s, page);
        }, 300000);
      }, 4000);
    }
  }

  async save_notes(pdfExport, s, page) {
    try {
      await page.evaluate((url) => {
        window.open(url);
      }, pdfExport);

      this.currNoteId += 1;
      s.message(`Сохраняю заметку ${this.currNoteId}`);
    } catch (e) {
      s.stop(`Заметка ${this.currNoteId} не сохранена (${e.message})`);
    }
  }

  async download_svgs(base_url) {
    intro("Скачиваю слайды");
    let id = 0;
    const s = spinner();

    s.start("Начинаю скачивание слайдов");

    while (true) {
      id += 1;

      s.message(`Скачиваю слайд (${id}/${id - 1})`);

      try {
        const r = await axios.get(`${base_url}/${id}`);
        await fs.outputFile(
          `${this.settings.savePath}/slides/${id}.svg`,
          r.data
        );
        s.message(`Слайд ${id} скачан (${id}/${id})`);
      } catch (e) {
        s.message(`Слайд ${id} не найден (${id}/${id}), заканчиваю`);
        break;
      }
    }

    s.stop(`Скачивание слайдов завершено (${id}/${id})`);
    outro("Скачивание завершено");
  }
}

const app = new App();
app.init();
