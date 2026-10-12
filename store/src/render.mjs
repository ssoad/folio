// Renders store pages (frames, the feature graphic, the icon) to PNGs at
// exact pixel sizes, in a headless Chrome started by build.sh with
// --remote-debugging-port=9555 --allow-file-access-from-files.
//
//   node store/src/render.mjs  (reads the job list below)
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const STORE = path.resolve(HERE, "..");
const OUT = path.join(STORE, "google-play");
const PORT = process.env.RENDER_PORT || 9555;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The screenshot list lives in frames/shots.js (a browser script)
const sandbox = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(HERE, "frames/shots.js"), "utf8"), sandbox);
const { SHOTS, DEVICES } = sandbox.window;

const COVERS = path.join(STORE, "build/covers");
const jobs = [
  // The sample books' covers (into build/, for the EPUBs and the graphics)
  ...Array.from({ length: 9 }, (_, i) => ({ page: `books/cover.html#${i}`, w: 600, h: 900, out: `${i}.png`, dir: COVERS })),
  { page: "graphics/icon.html", w: 512, h: 512, out: "icon-512.png" },
  { page: "graphics/feature.html", w: 1024, h: 500, out: "feature-graphic-1024x500.png" },
  ...SHOTS.map((shot, i) => ({
    page: `frames/frame.html#${i}`,
    w: DEVICES[shot.device].w,
    h: DEVICES[shot.device].h,
    out: shot.out + ".png",
  })),
];
// Which jobs: names or parts of them (`covers`, `phone/`, `icon`), all if none
const only = process.argv.slice(2).map((o) => (o === "covers" ? "cover:" : o));
jobs.forEach((job) => job.dir && (job.key = "cover:" + job.out));

const target = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: "PUT" })).json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
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
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? reject(new Error(method + ": " + m.error.message)) : resolve(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
const evaluate = async (expression) =>
  (await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })).result.value;

for (const job of jobs) {
  if (only.length && !only.some((o) => (job.key || job.out).includes(o))) continue;
  await send("Emulation.setDeviceMetricsOverride", { width: job.w, height: job.h, deviceScaleFactor: 1, mobile: false });
  await send("Page.navigate", { url: "file://" + path.join(HERE, job.page) });
  // A new hash on the same file doesn't reload it
  await sleep(150);
  await send("Page.reload", {});
  await sleep(300);
  // Fonts and every image loaded
  await evaluate(`(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.complete ? null : new Promise((r) => { img.onload = img.onerror = r; })));
    return true;
  })()`);
  await sleep(400);
  const { data } = await send("Page.captureScreenshot", {
    format: "png",
    clip: { x: 0, y: 0, width: job.w, height: job.h, scale: 1 },
  });
  const file = path.join(job.dir || OUT, job.out);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.from(data, "base64"));
  console.log("rendered", job.out);
}
await send("Target.closeTarget", { targetId: target.id }).catch(() => {});
ws.close();
