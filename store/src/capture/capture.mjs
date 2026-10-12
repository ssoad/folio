// Drives Folio (the dev server, `yarn start`) in a headless Chrome started
// with --remote-debugging-port=9444 and a fresh profile, and saves the raw
// screens the store images are made from into store/build/raw/.
//
//   node store/src/capture/capture.mjs <step> [<step> ...]
//
// Steps run in order; see STEPS below. build.sh runs them all.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(HERE, "../..");
const RAW = path.join(STORE, "build/raw");
const BOOKS = path.join(STORE, "build/books");
const APP = process.env.FOLIO_URL || "http://localhost:3000";
const PORT = process.env.CHROME_PORT || 9444;
fs.mkdirSync(RAW, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── DevTools connection ──────────────────────────────────────────────────
const targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json();
let page = targets.find((t) => t.type === "page");
if (!page) {
  page = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
}
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let nextId = 0;
const pending = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m);
    pending.delete(m.id);
  }
};
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (m) => (m.error ? reject(new Error(method + ": " + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const evaluate = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async (expression, timeout = 15000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await evaluate(`!!(${expression})`)) return;
    await sleep(200);
  }
  throw new Error("Timed out waiting for " + expression);
};
const shot = async (name) => {
  // Let animations settle first
  await sleep(1400);
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync(path.join(RAW, name + ".png"), Buffer.from(data, "base64"));
  console.log("saved", name);
};
const click = (selector, text) =>
  evaluate(`(() => {
    const els = [...document.querySelectorAll(${JSON.stringify(selector)})];
    const el = ${text ? `els.find((e) => e.textContent.trim() === ${JSON.stringify(text)})` : "els[0]"};
    if (!el) throw new Error("No element " + ${JSON.stringify(selector + " " + (text || ""))});
    el.click();
    return true;
  })()`);
// A real tap at a point (for the reader, whose taps come from touch events)
const tap = async (x, y) => {
  await send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
  await sleep(60);
  await send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
};

// ── Devices ──────────────────────────────────────────────────────────────
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 15; Pixel 8a) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36";
const phone = async () => {
  await send("Emulation.setDeviceMetricsOverride", { width: 412, height: 892, deviceScaleFactor: 3, mobile: true });
  await send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await send("Emulation.setUserAgentOverride", { userAgent: ANDROID_UA, platform: "Linux armv8l" });
};
const tablet = async (width, height) => {
  await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1.5, mobile: false });
  await send("Emulation.setTouchEmulationEnabled", { enabled: false });
  await send("Emulation.setUserAgentOverride", { userAgent: "" });
};
const open = async (hash = "#/manager/home") => {
  await send("Page.navigate", { url: APP + "/" + hash });
  // A new hash alone doesn't reload, and settings are read at start
  await sleep(300);
  await send("Page.reload", { ignoreCache: false });
  await sleep(2500);
  await waitFor(`document.querySelector(".manager, .viewer, .onboarding")`, 30000);
};
const setReaderConfig = (values) =>
  evaluate(`(() => {
    const rc = JSON.parse(localStorage.getItem("readerConfig") || "{}");
    Object.assign(rc, ${JSON.stringify(values)});
    localStorage.setItem("readerConfig", JSON.stringify(rc));
    return true;
  })()`);

const openBook = async (title) => {
  await click(".book-item-title", title);
  await sleep(400);
  // The cover opens it; the title only names it
  await evaluate(`(() => {
    const item = [...document.querySelectorAll(".book-list-item")].find((e) => e.querySelector(".book-item-title")?.textContent.trim() === ${JSON.stringify(title)});
    item.querySelector(".book-item-cover").click();
    return true;
  })()`);
  await waitFor(`location.hash.includes("/epub/")`, 15000);
  await waitFor(`document.querySelector("iframe") && document.querySelector("iframe").contentDocument && document.querySelector("iframe").contentDocument.body && document.querySelector("iframe").contentDocument.body.innerText.length > 200`, 20000);
  await sleep(1500);
};

// Wide windows open books in a new tab; this opens the reader's address in
// this one instead
const openBookHere = async (title) => {
  const key = await evaluate(`(async () => {
    const db = await new Promise((res) => { const r = indexedDB.open("localforage"); r.onsuccess = () => res(r.result); });
    const books = await new Promise((res) => { const q = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("books"); q.onsuccess = () => res(q.result); });
    return books.find((b) => b.name === ${JSON.stringify(title)}).key;
  })()`);
  await send("Page.navigate", { url: `${APP}/#/epub/${key}?title=${encodeURIComponent(title)}&file=${key}` });
  await sleep(300);
  await send("Page.reload", {});
  await waitFor(`document.querySelector("iframe") && document.querySelector("iframe").contentDocument && document.querySelector("iframe").contentDocument.body && document.querySelector("iframe").contentDocument.body.innerText.length > 200`, 30000);
  await sleep(1500);
};

// ── Steps ────────────────────────────────────────────────────────────────
const STEPS = {
  // A new install: no books, no settings, no history
  async reset() {
    await send("Page.navigate", { url: "about:blank" });
    await send("Storage.clearDataForOrigin", { origin: APP, storageTypes: "all" });
    await sleep(500);
  },

  // Onboarding, as a new install shows it
  async onboarding() {
    await phone();
    await open("");
    await waitFor(`document.querySelector(".onboarding")`);
    for (let i = 1; i <= 4; i++) {
      await sleep(900);
      await shot(`phone-onboarding-${i}`);
      if (i < 4) await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight" })), true`);
    }
    await evaluate(`window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })), true`);
    await sleep(800);
  },

  // The sample library, through the Import button's file input
  async import() {
    await phone();
    // The web version's "keep your data in a folder" prompt; the app has none
    await evaluate(`localStorage.setItem("isUseLocal", "no"), true`);
    await open();
    const files = fs.readdirSync(BOOKS).filter((f) => f.endsWith(".epub")).map((f) => path.join(BOOKS, f));
    const { root } = await send("DOM.getDocument", { depth: -1, pierce: true });
    const { nodeId } = await send("DOM.querySelector", { nodeId: root.nodeId, selector: ".import-from-local input[type=file]" });
    await send("DOM.setFileInputFiles", { nodeId, files });
    await waitFor(`document.querySelectorAll(".book-list-item").length >= ${files.length}`, 120000);
    await sleep(2000);
    console.log("imported", files.length);
  },

  // Some reading, so the library shows progress and "Continue reading":
  // positions as the reader saves them, most recent first
  async progress() {
    await phone();
    await open();
    await evaluate(`(async () => {
      const db = await new Promise((res) => { const r = indexedDB.open("localforage"); r.onsuccess = () => res(r.result); });
      const books = await new Promise((res) => { const q = db.transaction("keyvaluepairs").objectStore("keyvaluepairs").get("books"); q.onsuccess = () => res(q.result); });
      const read = { "Pride and Prejudice": 0.34, "Moby-Dick": 0.12, "The Time Machine": 0.68, "The Great Gatsby": 1 };
      const records = JSON.parse(localStorage.getItem("recordLocation") || "{}");
      const now = Math.floor(Date.now() / 1000);
      const order = [];
      Object.entries(read).forEach(([title, percentage], i) => {
        const book = books.find((b) => b.name === title);
        if (!book) return;
        records[book.key] = Object.assign(records[book.key] || {}, {
          text: "", chapterTitle: "Chapter 1", chapterDocIndex: "0", chapterHref: "", count: "0", page: "",
          percentage: String(percentage), xpath: "/body/DocFragment[1]/body/h2", timestamp: now - i * 3600,
        });
        order.push(book.key);
      });
      localStorage.setItem("recordLocation", JSON.stringify(records));
      const recent = JSON.parse(localStorage.getItem("recentBooks") || "[]").filter((k) => !order.includes(k));
      localStorage.setItem("recentBooks", JSON.stringify(order.concat(recent)));
      return order.length;
    })()`);
  },

  async library() {
    await phone();
    await setReaderConfig({ appSkin: "light" });
    await open();
    await waitFor(`document.querySelectorAll(".book-list-item").length > 0`);
    await evaluate(`document.querySelector(".book-list-container-parent").scrollTop = 0, true`);
    await shot("phone-library");
  },

  async libraryDark() {
    await phone();
    await setReaderConfig({ appSkin: "night" });
    await open();
    await waitFor(`document.querySelectorAll(".book-list-item").length > 0`);
    await shot("phone-library-dark");
    await setReaderConfig({ appSkin: "light" });
  },

  async listView() {
    await phone();
    await open();
    await click(".library-filter-bar .card-list-mode:nth-child(3)");
    await sleep(800);
    await shot("phone-library-details");
    await click(".library-filter-bar .card-list-mode:nth-child(1)");
  },

  async reader() {
    await phone();
    await open();
    await openBook("Pride and Prejudice");
    await shot("phone-reader");
    // Bars
    await tap(206, 446);
    await sleep(900);
    await shot("phone-reader-bars");
    // Display sheet: the text size and theme
    await click(".reader-compact-toolbar button:nth-child(2)");
    await sleep(900);
    await shot("phone-reader-display");
    // Sepia for the rest
    await evaluate(`[...document.querySelectorAll(".display-sheet-theme")].find((e) => e.textContent.includes("Sepia")).click(), true`);
    await sleep(1200);
    await evaluate(`(document.querySelector(".display-sheet-backdrop.is-open") || {}).click?.(), true`);
    await sleep(900);
    await shot("phone-reader-sepia");
  },

  // A highlight on the page, and a passage selected with the colour pill
  async highlight() {
    await phone();
    await open();
    await openBook("Pride and Prejudice");
    const select = (paragraph, from, to) =>
      evaluate(`(() => {
        const frame = document.querySelector("iframe");
        const doc = frame.contentDocument;
        const p = [...doc.querySelectorAll("p")][${paragraph}];
        const text = p.firstChild;
        const range = doc.createRange();
        range.setStart(text, ${from});
        range.setEnd(text, Math.min(${to}, text.length));
        const sel = doc.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
        doc.dispatchEvent(new Event("selectionchange"));
        const r = range.getBoundingClientRect();
        const f = frame.getBoundingClientRect();
        doc.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: r.right, clientY: r.bottom }));
        return [f.left + r.left, f.top + r.top];
      })()`);
    // The famous first line, highlighted in yellow
    await select(0, 0, 200);
    await sleep(1200);
    await evaluate(`(() => {
      // The pill's colours act on pointerdown
      const color = document.querySelectorAll(".popup-pill-color")[1];
      if (!color) return false;
      const opts = { bubbles: true, pointerType: "touch", isPrimary: true };
      color.dispatchEvent(new PointerEvent("pointerdown", opts));
      color.dispatchEvent(new PointerEvent("pointerup", opts));
      return true;
    })()`);
    // Let the highlight draw before selecting again
    await sleep(2500);
    await evaluate(`document.querySelector("iframe").contentDocument.getSelection().removeAllRanges(), true`);
    await sleep(800);
    // Another passage, selected, with the pill open
    await select(2, 0, 200);
    await sleep(1500);
    await shot("phone-reader-highlight");
    // Keep that one too, for the Highlights page
    await evaluate(`(() => {
      const color = document.querySelectorAll(".popup-pill-color")[2];
      const opts = { bubbles: true, pointerType: "touch", isPrimary: true };
      color.dispatchEvent(new PointerEvent("pointerdown", opts));
      color.dispatchEvent(new PointerEvent("pointerup", opts));
      return true;
    })()`);
    await sleep(1000);
  },

  // The reader at night: Dark theme, bars showing
  async readerDark() {
    await phone();
    await setReaderConfig({ appSkin: "night" });
    await open();
    await openBook("Pride and Prejudice");
    await tap(206, 446);
    await sleep(600);
    await click(".reader-compact-toolbar button:nth-child(2)");
    await sleep(900);
    await evaluate(`[...document.querySelectorAll(".display-sheet-theme")].find((e) => e.textContent.includes("Dark")).click(), true`);
    await sleep(1200);
    await evaluate(`(document.querySelector(".display-sheet-backdrop.is-open") || {}).click?.(), true`);
    await sleep(900);
    await tap(206, 446);
    await sleep(900);
    await shot("phone-reader-dark");
    // Back to the light page for the other shots
    await click(".reader-compact-toolbar button:nth-child(2)");
    await sleep(900);
    await evaluate(`[...document.querySelectorAll(".display-sheet-theme")].find((e) => e.textContent.includes("Sepia")).click(), true`);
    await sleep(800);
    await setReaderConfig({ appSkin: "light" });
  },

  // Tablets (the wide layout): library, and a book open
  async tablet() {
    for (const [name, w, h, scale] of [["tablet10", 1280, 800, "1.45"], ["tablet7", 800, 1280, "1.3"]]) {
      await tablet(w, h);
      // Larger covers, and no "connect a server" banner in the header
      await setReaderConfig({ appSkin: "light", cardScale: scale, isHidePro: "yes" });
      await open();
      await waitFor(`document.querySelectorAll(".book-list-item").length > 0`);
      await shot(`${name}-library`);
      await setReaderConfig({ appSkin: "night" });
      await open();
      await shot(`${name}-library-dark`);
      await setReaderConfig({ appSkin: "light" });
      await open();
      await openBookHere("Pride and Prejudice");
      // The pointer resting on the page edge would raise the progress tip
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: w / 2, y: h / 2 });
      await shot(`${name}-reader`);
    }
  },

  // Everything highlighted, from the drawer
  async highlights() {
    await phone();
    await open();
    await click(".header-drawer-button");
    await sleep(700);
    await click(".side-menu-selector span", "Highlights");
    await sleep(1500);
    await shot("phone-highlights");
  },
};

for (const step of process.argv.slice(2)) {
  if (!STEPS[step]) throw new Error("Unknown step " + step + "; steps: " + Object.keys(STEPS).join(", "));
  console.log("→", step);
  await STEPS[step]();
}
ws.close();
