import { Capacitor } from "@capacitor/core";
import { App } from "@capacitor/app";
import { Filesystem } from "@capacitor/filesystem";
import toast from "react-hot-toast";
import i18n from "../i18n";
import store from "../store";
import BookUtil from "./file/bookUtil";
import DatabaseService from "./storage/databaseService";
import { SplashScreen } from "@capacitor/splash-screen";
import { StatusBar, Style } from "@capacitor/status-bar";
import { LIBRARY_HASH } from "./platform";
import { isDrawerOpen, setDrawerOpen } from "./responsive";

// Android app (Capacitor) integration: the system back button, a status bar
// that follows the app's theme, and books opened from other apps ("Open with
// Folio"). Does nothing in Electron or a browser.

// Dispatched on the Android back button. A screen that handles it (closes a
// dialog or sheet, leaves the reader) calls preventDefault(); otherwise the
// app goes back a page, or to the background from the library.
export const NATIVE_BACK_EVENT = "folio-native-back";

const handleBackButton = () => {
  if (isDrawerOpen()) {
    setDrawerOpen(false);
    return;
  }
  const event = new CustomEvent(NATIVE_BACK_EVENT, { cancelable: true });
  window.dispatchEvent(event);
  if (event.defaultPrevented) return;
  if (!window.location.hash.startsWith(LIBRARY_HASH)) {
    window.location.hash = LIBRARY_HASH;
    return;
  }
  App.minimizeApp();
};

const parseRgb = (color: string) => {
  const match = color.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)/);
  return match ? match.slice(1, 4).map(Number) : null;
};

const toHex = (rgb: number[]) =>
  "#" + rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");

// Matches the status bar to the page behind it, with icons that stay readable
let lastStatusColor = "";
const syncStatusBar = () => {
  const rgb = parseRgb(getComputedStyle(document.body).backgroundColor);
  if (!rgb) return;
  const color = toHex(rgb);
  if (color === lastStatusColor) return;
  lastStatusColor = color;
  const luminance = (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  StatusBar.setBackgroundColor({ color }).catch(() => {});
  // Style.Dark means light icons, for dark backgrounds
  StatusBar.setStyle({ style: luminance < 0.5 ? Style.Dark : Style.Light }).catch(
    () => {}
  );
};

// ── Books opened from other apps ─────────────────────────────────────────────

const MIME_BY_EXTENSION: Record<string, string> = {
  epub: "application/epub+zip",
  pdf: "application/pdf",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  txt: "text/plain",
};

// content:// URIs rarely carry a file name; the last path segment usually
// does (e.g. .../document/primary%3ADownload%2FBook.epub)
const fileNameFromUri = (uri: string) => {
  const decoded = decodeURIComponent(uri.split("?")[0]);
  const name = decoded.split(/[/:]/).pop() || "";
  return name.includes(".") ? name : "";
};

// The file type from its first bytes when the name has no extension
const sniffExtension = (bytes: Uint8Array) => {
  const head = String.fromCharCode(...Array.from(bytes.slice(0, 64)));
  if (head.startsWith("%PDF")) return "pdf";
  if (head.startsWith("PK") && head.includes("mimetypeapplication/epub+zip"))
    return "epub";
  if (head.slice(60, 68) === "BOOKMOBI") return "mobi";
  return "";
};

// The import function is registered when the library first shows
const waitForImport = async () => {
  for (let i = 0; i < 50; i++) {
    const importBook = store.getState().book.importBookFunc;
    // The placeholder takes no arguments; the real one takes the file
    if (importBook && importBook.length > 0) return importBook;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return null;
};

const openSharedFile = async (uri: string) => {
  const toastId = "open-shared-file";
  try {
    toast.loading(i18n.t("Importing"), { id: toastId });
    const { data } = await Filesystem.readFile({ path: uri });
    const binary = atob(typeof data === "string" ? data : await data.text());
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    let name = fileNameFromUri(uri);
    if (!name) {
      const extension = sniffExtension(bytes);
      if (!extension) throw new Error(i18n.t("Unsupported file format"));
      name = "Book." + extension;
    }
    const extension = name.split(".").pop()!.toLowerCase();
    const file = new File([bytes], name, {
      type: MIME_BY_EXTENSION[extension] || "application/octet-stream",
    });
    if (!window.location.hash.startsWith(LIBRARY_HASH)) {
      window.location.hash = LIBRARY_HASH;
    }
    const importBook = await waitForImport();
    if (!importBook) throw new Error(i18n.t("Import failed"));
    toast.dismiss(toastId);
    await importBook(file);
  } catch (error) {
    toast.error(error instanceof Error ? error.message : String(error), {
      id: toastId,
    });
  }
};

// folio://open-book?bookKey=... (the book's "Copy link")
const openBookLink = async (url: string) => {
  const bookKey = new URL(url.replace("folio://", "https://folio/"))
    .searchParams.get("bookKey");
  const book = bookKey && (await DatabaseService.getRecord(bookKey, "books"));
  if (book) {
    BookUtil.redirectBook(book);
  } else {
    window.location.hash = LIBRARY_HASH;
  }
};

const handleOpenUrl = (url: string) => {
  if (url.startsWith("content://") || url.startsWith("file://")) {
    openSharedFile(url);
  } else if (url.startsWith("folio://open-book")) {
    openBookLink(url);
  }
};

export const initNative = () => {
  if (!Capacitor.isNativePlatform()) return;
  App.addListener("backButton", handleBackButton);
  App.addListener("appUrlOpen", ({ url }) => handleOpenUrl(url));
  App.getLaunchUrl()
    .then((launch) => launch?.url && handleOpenUrl(launch.url))
    .catch(() => {});
  // Theme changes restyle <html> and <body>
  const observer = new MutationObserver(syncStatusBar);
  for (const element of [document.documentElement, document.body]) {
    observer.observe(element, {
      attributes: true,
      attributeFilter: ["class", "style", "data-theme"],
    });
  }
  window.addEventListener("hashchange", () => setTimeout(syncStatusBar, 300));
  syncStatusBar();
  // Android shows the splash until the app has drawn its first frame
  const hideSplash = () =>
    requestAnimationFrame(() =>
      requestAnimationFrame(() => SplashScreen.hide().catch(() => {}))
    );
  if (document.readyState === "complete") {
    hideSplash();
  } else {
    window.addEventListener("load", hideSplash, { once: true });
  }
};
