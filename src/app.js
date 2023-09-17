import puppeteer from "puppeteer";
import { intro, outro, confirm, text, group, spinner } from "@clack/prompts";
import axios from "axios";
import fs from "fs-extra";
import path from "path";

class App {
  constructor() {
    intro("Настройка BigBlueButton бота");
  }
  async init() {
    this.settings = await group({
      url: () => text({ message: "Введите URL BigBlueButton" }),
      downloadSlides: () => confirm({ message: "Скачать презентацию?" }),
      saveNotes: () => confirm({ message: "Сохранять заметки?" }),
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
      setTimeout(async () => {
        const exportPdf = await page.waitForSelector(
          "#layout > div:nth-child(2) > div > div > iframe"
        );

        const exportPdfLink = new URL(
          await exportPdf?.evaluate((el) => {
            return el.getAttribute("src");
          })
        );

        console.log(`Ссылка заметок: ${exportPdfLink.toString()}`);

        const pdfExport = `${
          this.url.origin
        }/pad/p/${exportPdfLink.searchParams.get("padName")}/export/pdf${
          this.url.search
        }`; //https://test26.bigbluebutton.org/pad/p/g.bH65ceYnYNgryQI7%24notes/export/pdf?sessionToken=qktqh1o7mhws8bwo

        console.log("Ссылка экспорта PDF:", pdfExport);

        console.log("Начинаю сохранять заметки");

        const client = await page.target().createCDPSession();
        await client.send("Page.setDownloadBehavior", {
          behavior: "allow",
          downloadPath: path.resolve(`${this.settings.savePath}/notes/`),
        });

        this.currNoteId = 0;
        setInterval(async () => {
          const s = spinner();
          s.start("Сохраняю заметку");
          try {
            await page.evaluate((url) => {
              window.open(url);
            }, pdfExport);

            this.currNoteId += 1;

            setTimeout(() => {
              fs.renameSync(
                `${this.settings.savePath}/notes/Shared_Notes.pdf`,
                `${this.settings.savePath}/notes/${this.currNoteId}.pdf`
              );
              s.stop(`Заметка ${this.currNoteId} сохранена`);
            }, 5000);
          } catch (e) {
            console.log(e);
            s.stop(`Заметка ${this.currNoteId} не сохранена`);
          }
        }, 300000);
      }, 4000);
    }
  }

  async download_svgs(base_url) {
    intro("Скачиваю слайды");
    let id = 0;

    while (true) {
      const s = spinner();
      s.start(`Скачиваю слайд ${id}`);
      id += 1;
      try {
        const r = await axios.get(`${base_url}/${id}`, { timeout: 2000 });
        await fs.outputFile(
          `${this.settings.savePath}/slides/${id}.svg`,
          r.data
        );
        s.stop(`Слайд ${id} скачан`);
      } catch (e) {
        s.stop(`Слайд ${id} не найден`);
        break;
      }
    }
    outro("Скачивание завершено");
  }
}

const app = new App();
app.init();
