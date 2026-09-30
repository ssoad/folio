<div align="center">
  <img src="./src/assets/images/folio-mark.svg" width="88px" height="88px"/>
</div>

<h1 align="center">Folio</h1>

<h3 align="center">A cross-platform ebook reader with its own server</h3>

<div align="center">

[Releases](https://github.com/ssoad/folio/releases) | [Server setup](./httpserver/README.md) | [Issues](https://github.com/ssoad/folio/issues)

</div>

Folio reads your books locally on Windows, macOS, Linux and the web. It has no
central cloud and no accounts: sync, AI, voices, OCR and downloads come from a
Folio server you run yourself.

## Features

- Format support:
  - EPUB (**.epub**)
  - PDF (**.pdf**)
  - DRM-free Mobipocket (**.mobi**) and Kindle (**.azw3**, **.azw**)
  - Plain-text (**.txt**)
  - FictionBook (**.fb2**)
  - Comic book archive (**.cbr**, **.cbz**, **.cbt**, **.cb7**)
  - Rich text (**.md**, **.docx**)
  - HyperText (**.html**, **.xml**, **.xhtml**, **.mhtml**, **.htm**)
- Sync and back up your library with **WebDAV**, **S3-compatible storage**, **FTP**, **SFTP**, **SMB**, **MEGA**, a local folder or your Folio server, and with **Google Drive**, **OneDrive**, **Dropbox**, **Box**, **pCloud** and **Yandex Disk** through OAuth apps you register
- Import books from the same sources
- AI translation, dictionary, assistant, book summaries and full-book translation with the model your server runs, or any model you add yourself
- Natural voices, multi-voice reading and OCR for scanned PDFs through your server
- Sync reading progress with **KOReader**
- Sync notes and highlights to **Readwise**, **Notion**, **Obsidian**, **Joplin**, and more
- Local MDX dictionaries, word sync to **Anki** and **Eudic**
- Protect your library with a password, PIN, Windows Hello or Touch ID
- Export books, notes and highlights (**CSV**, **Markdown**, **HTML**, **TXT**, **PDF**)
- Share your library as an **OPDS** feed
- 50+ built-in plugins for translation, dictionaries and text-to-speech, plus custom plugins
- Vertical layout, reading statistics, library snapshots
- **Paddle** and **Tesseract** OCR built in
- Single-column, two-column or continuous scrolling layouts
- Bookmarks, notes and highlights; font, spacing, colour, margin and brightness settings; night mode

## Server

Everything beyond reading local books comes from the Folio server in
[`httpserver/`](./httpserver). Run it with Docker, then open
**Settings → Server** in the app and enter its address and access token.
See the [server guide](./httpserver/README.md) for AI, voices, cloud drives
and downloadable assets.

## Develop

Make sure that you have installed yarn and git

1. Download the repo

   ```
   git clone https://github.com/ssoad/folio.git
   ```

2. Enter desktop mode

   ```
   yarn
   yarn dev
   ```

3. Enter web mode

   ```
   yarn
   yarn start
   ```

## Android

The Android app wraps the web build with [Capacitor](https://capacitorjs.com)
(`android/`, configured in `capacitor.config.json`). It needs the Android SDK
and JDK 21.

```bash
yarn android:apk    # build a debug APK: android/app/build/outputs/apk/debug/
yarn android:run    # build and run on a connected device or emulator
yarn android:open   # open the project in Android Studio (release signing, Play Store)
```

After changing web code, `yarn android:sync` rebuilds it and copies it into the
app. Icons come from `scripts/generate-brand-assets.py`.

## Translation

### Edit current language

1. Select your target language from the following list.

2. Click the view button to examine the source file. The untranslated terms are listed at the bottom of each file.

3. Translate the terms to your target language based on the given English reference

4. Submit the translation file or snippets to [this link](https://github.com/ssoad/folio/issues/new?labels=submit+translation&template=submit_translation.yml). Pull requests are also welcome.

| Language(A-Z)   | Code  | View                                    |
| --------------- | ----- | --------------------------------------- |
| Amharic         | am    | [View](./src/assets/locales/am.json)    |
| Arabic          | ar    | [View](./src/assets/locales/ar.json)    |
| Armenian        | hy    | [View](./src/assets/locales/hy.json)    |
| Bengali         | bn    | [View](./src/assets/locales/bn.json)    |
| Bulgarian       | bg    | [View](./src/assets/locales/bg.json)    |
| Chinese (CN)    | zh-CN | [View](./src/assets/locales/zh-CN.json) |
| Chinese (MO)    | zh-MO | [View](./src/assets/locales/zh-MO.json) |
| Chinese (TW)    | zh-TW | [View](./src/assets/locales/zh-TW.json) |
| Czech           | cs    | [View](./src/assets/locales/cs.json)    |
| Danish          | da    | [View](./src/assets/locales/da.json)    |
| Dutch           | nl    | [View](./src/assets/locales/nl.json)    |
| English         | en    | [View](./src/assets/locales/en.json)    |
| Finnish         | fi    | [View](./src/assets/locales/fi.json)    |
| French          | fr    | [View](./src/assets/locales/fr.json)    |
| German          | de    | [View](./src/assets/locales/de.json)    |
| Greek           | el    | [View](./src/assets/locales/el.json)    |
| Hindi           | hi    | [View](./src/assets/locales/hi.json)    |
| Hungarian       | hu    | [View](./src/assets/locales/hu.json)    |
| Indonesian      | id    | [View](./src/assets/locales/id.json)    |
| Interlingue     | ie    | [View](./src/assets/locales/ie.json)    |
| Irish           | ga    | [View](./src/assets/locales/ga.json)    |
| Italian         | it    | [View](./src/assets/locales/it.json)    |
| Japanese        | ja    | [View](./src/assets/locales/ja.json)    |
| Korean          | ko    | [View](./src/assets/locales/ko.json)    |
| Persian         | fa    | [View](./src/assets/locales/fa.json)    |
| Polish          | pl    | [View](./src/assets/locales/pl.json)    |
| Portuguese      | pt    | [View](./src/assets/locales/pt.json)    |
| Portuguese (BR) | pt-BR | [View](./src/assets/locales/pt-BR.json) |
| Romanian        | ro    | [View](./src/assets/locales/ro.json)    |
| Russian         | ru    | [View](./src/assets/locales/ru.json)    |
| Slovenian       | sl    | [View](./src/assets/locales/sl.json)    |
| Spanish         | es    | [View](./src/assets/locales/es.json)    |
| Swedish         | sv    | [View](./src/assets/locales/sv.json)    |
| Tamil           | ta    | [View](./src/assets/locales/ta.json)    |
| Thai            | th    | [View](./src/assets/locales/th.json)    |
| Tagalog         | tl    | [View](./src/assets/locales/tl.json)    |
| Tibetan         | bo    | [View](./src/assets/locales/bo.json)    |
| Turkish         | tr    | [View](./src/assets/locales/tr.json)    |
| Ukrainian       | uk    | [View](./src/assets/locales/uk.json)    |
| Vietnamese      | vi    | [View](./src/assets/locales/vi.json)    |

### Add new language

1. If you can't find your target language in the list above, download the [English source file](./src/assets/locales/en.json).

2. When you're finished translating, submit the file to [this link](https://github.com/ssoad/folio/issues/new?labels=submit+translation&template=submit_translation.yml). Pull requests are also welcome.

## License

Folio is a modified version of [Koodo Reader](https://github.com/koodo-reader/koodo-reader)
and, like it, is licensed under the [GNU Affero General Public License v3.0](./LICENSE).
