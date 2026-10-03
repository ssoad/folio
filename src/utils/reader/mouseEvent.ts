import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { exitWebReader, isCompact, isTouchDevice } from "../platform";
import { isElectron } from "react-device-detect";
import { getIframeDoc, getIframeWin } from "./docUtil";
import {
  handleExitFullScreen,
  handleFullScreen,
  isReadingAidMode,
  sleep,
  throttle,
} from "../common";
import Hammer from "hammerjs";
import TTSUtil from "./ttsUtil";
import {
  getShortcutConfig,
  isNextPageKey,
  isPrevPageKey,
  matchShortcut,
  ShortcutAction,
} from "./shortcutUtil";
declare var window: any;

let throttleTime =
  (ConfigService.getReaderConfig("animation") || "none") !== "none"
    ? 1000
    : 100;

export const getSelection = (format: string, bookKey?: string) => {
  let docs = getIframeDoc(format, bookKey);
  let text = "";
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    let sel = doc.getSelection();
    if (!sel || sel.rangeCount === 0) continue;
    // In Electron/Chromium, Selection.toString() includes text inside
    // user-select:none elements (e.g. <rt>/<rp> ruby annotations), even though
    // they are not visually highlighted. Clone the selected ranges into a
    // fragment, strip the ruby annotations, and read back the text so it
    // matches the visual selection (consistent with the CSS rule on <rt>).
    let fragment = doc.createDocumentFragment();
    for (let r = 0; r < sel.rangeCount; r++) {
      fragment.appendChild(sel.getRangeAt(r).cloneContents());
    }
    fragment.querySelectorAll("rt, rp").forEach((el) => el.remove());
    text = (fragment.textContent || "").trim();
    if (text) {
      break;
    }
  }

  return text;
};

export const getSelectionSentence = (
  format: string,
  bookKey?: string
): string => {
  let docs = getIframeDoc(format, bookKey);
  for (let i = 0; i < docs.length; i++) {
    let doc = docs[i];
    if (!doc) continue;
    let sel = doc.getSelection();
    if (!sel || !sel.toString().trim()) continue;
    try {
      let range = sel.getRangeAt(0);
      let container = range.commonAncestorContainer;
      // Walk up to a text-containing element
      let el: Node | null =
        container.nodeType === Node.TEXT_NODE
          ? container.parentElement
          : container;
      let fullText = (el as Element)?.textContent || "";
      let selectedText = sel.toString().trim();
      // Split on sentence-ending punctuation to find the sentence
      let sentences = fullText.split(/(?<=[.!?。！？])\s*/);
      for (let s of sentences) {
        if (s.includes(selectedText)) {
          return s.trim();
        }
      }
      // Fallback: return the whole text content of the container
      return fullText.trim();
    } catch {
      // ignore
    }
  }
  return "";
};

const clickEvent = () =>
  new MouseEvent("click", {
    view: window,
    bubbles: true,
    cancelable: true,
  });

export const searchInTheBook = (
  keyword: string,
  format: string,
  isSearch: boolean
) => {
  let leftPanel = document.querySelector(".left-panel");
  if (!leftPanel) return;
  leftPanel.dispatchEvent(clickEvent());
  const focusEvent = new MouseEvent("focus", {
    view: window,
    bubbles: true,
    cancelable: true,
  });
  let searchBox: any = document.querySelector(".header-search-box");
  searchBox.dispatchEvent(focusEvent);
  let searchIcon = document.querySelector(".header-search-icon");
  searchIcon?.dispatchEvent(clickEvent());
  if (isSearch) {
    searchBox.value = getSelection(format) || keyword;
  }
  const keyEvent: any = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    keyCode: 13,
  } as any);
  searchBox.dispatchEvent(keyEvent);
};

export const triggerPopupOptionClick = (optionName: string) => {
  const option = document.querySelector(`.${optionName}-option`);
  if (!option) return;
  option.dispatchEvent(clickEvent());
};

const SELECTION_SHORTCUT_OPTIONS: Array<{
  shortcut: ShortcutAction;
  optionName: string;
}> = [
  { shortcut: "selectionTranslate", optionName: "translation" },
  { shortcut: "selectionDict", optionName: "dict" },
  { shortcut: "selectionNote", optionName: "note" },
  { shortcut: "selectionHighlight", optionName: "highlight" },
  { shortcut: "selectionSpeak", optionName: "speaker" },
  { shortcut: "selectionSearch", optionName: "search-book" },
];

export const READING_PANEL_TOGGLE_EVENT = "folio-reading-panel-toggle";

export const openReadingPanel = (
  position: "left" | "right" | "top" | "bottom"
) => {
  const panel = document.querySelector(`.${position}-panel`);
  if (!panel) return;
  panel.dispatchEvent(clickEvent());
};

export const toggleReadingPanel = (
  position: "left" | "right" | "top" | "bottom"
) => {
  window.dispatchEvent(
    new CustomEvent(READING_PANEL_TOGGLE_EVENT, {
      detail: { position },
    })
  );
};

export const openTableOfContents = () => {
  openReadingPanel("left");
};

const READING_PANEL_SHORTCUTS: Array<{
  shortcut: ShortcutAction;
  position: "left" | "right" | "top" | "bottom";
}> = [
  { shortcut: "openLeftPanel", position: "left" },
  { shortcut: "openRightPanel", position: "right" },
  { shortcut: "openTopPanel", position: "top" },
  { shortcut: "openBottomPanel", position: "bottom" },
];

// Taps on the page (phones, tablets): the outer thirds turn the page, the
// middle shows or hides the reader bars
export const READER_CHROME_TOGGLE_EVENT = "folio-reader-chrome-toggle";
// Asks the reader's top bar to leave the book (Android back button)
export const READER_EXIT_EVENT = "folio-reader-exit";
const TAP_TURN_ZONE = 0.3;
const TAP_MAX_MOVE = 10;
const TAP_MAX_TIME = 350;
const tapBoundDocs = new WeakSet<Document>();

// The drawing layer (fabric canvases on every PDF page) takes every touch,
// so on touch screens it would stop the page from scrolling even when
// nobody is drawing. It only takes touches while drawing mode is on.
const PASSIVE_DRAWING_CLASS = "folio-not-drawing";
const PASSIVE_DRAWING_STYLE = `html.${PASSIVE_DRAWING_CLASS} .canvas-container,
html.${PASSIVE_DRAWING_CLASS} .canvas-container canvas {
  pointer-events: none !important;
  touch-action: auto !important;
}`;
let isDrawingMode = false;
const applyDrawingMode = (doc: Document) => {
  if (!doc?.documentElement) return;
  if (!doc.getElementById("folio-drawing-mode")) {
    const style = doc.createElement("style");
    style.id = "folio-drawing-mode";
    style.textContent = PASSIVE_DRAWING_STYLE;
    (doc.head || doc.documentElement).appendChild(style);
  }
  doc.documentElement.classList.toggle(PASSIVE_DRAWING_CLASS, !isDrawingMode);
};
export const setDrawingMode = (
  isDrawing: boolean,
  format: string,
  bookKey: string
) => {
  isDrawingMode = isDrawing;
  if (!(isCompact() || isTouchDevice())) return;
  for (const doc of getIframeDoc(format, bookKey)) {
    if (doc) applyDrawingMode(doc);
  }
};
const handleReaderTap = async (
  event: MouseEvent,
  rendition: any,
  doc: Document,
  readerMode: string,
  key: string
) => {
  // The engine prevents the default of every click, so that can't be used to
  // tell taps it handles
  const target = event.target as Element | null;
  if (
    doc.getSelection()?.toString() ||
    target?.closest?.("a, button, input, textarea, select, audio, video")
  ) {
    return;
  }
  // The iframe can be wider than the screen (paginated books), so measure
  // against the app window
  const frame = doc.defaultView?.frameElement;
  const x = (frame ? frame.getBoundingClientRect().left : 0) + event.clientX;
  const ratio = x / window.innerWidth;
  if (readerMode !== "scroll" && ratio < TAP_TURN_ZONE) {
    if (lock) return;
    lock = true;
    await rendition.prev();
    handleLocation(key, rendition);
    setTimeout(() => (lock = false), throttleTime);
  } else if (readerMode !== "scroll" && ratio > 1 - TAP_TURN_ZONE) {
    if (lock) return;
    lock = true;
    await rendition.next();
    handleLocation(key, rendition);
    setTimeout(() => (lock = false), throttleTime);
  } else {
    // A tap on a highlight or note opens the engine's popup instead
    await sleep(150);
    const popup = document.querySelector(".popup-menu-container");
    if (popup && getComputedStyle(popup).display !== "none") return;
    window.dispatchEvent(new CustomEvent(READER_CHROME_TOGGLE_EVENT));
  }
};

export const NAV_TAB_TOGGLE_EVENT = "folio-nav-tab-toggle";
export const toggleNavTab = (tab: string) => {
  window.dispatchEvent(
    new CustomEvent(NAV_TAB_TOGGLE_EVENT, {
      detail: { tab },
    })
  );
};

const NAV_TAB_SHORTCUTS: Array<{
  shortcut: ShortcutAction;
  tab: string;
}> = [
  { shortcut: "openBookmarkList", tab: "bookmarks" },
  { shortcut: "openNoteList", tab: "notes" },
  { shortcut: "openHighlightList", tab: "highlights" },
  { shortcut: "openToc", tab: "contents" },
];
let lock = false; //prevent from clicking too fasts

const arrowKeys = async (
  rendition: any,
  event: any,
  readerMode: string,
  format: string,
  bookKey: string
) => {
  if (
    event.target.tagName.toLowerCase() === "textarea" ||
    event.target.tagName.toLowerCase() === "input"
  ) {
    return;
  }
  if (readerMode === "scroll" && isReadingAidMode(format, bookKey)) {
    // 段落模式下拦截滚动模式的原生滚动按键，改为逐段导航
    const shortcutConfig = getShortcutConfig();
    if (matchShortcut(event, shortcutConfig.prevPage)) {
      event.preventDefault();
      await rendition.prev();
      handleShortcut(event, format, bookKey, rendition);
      return;
    }
    if (matchShortcut(event, shortcutConfig.nextPage)) {
      event.preventDefault();
      await rendition.next();
      handleShortcut(event, format, bookKey, rendition);
      return;
    }
  }
  if (isPrevPageKey(event, readerMode)) {
    event.preventDefault();
    await rendition.prev();
  } else if (isNextPageKey(event, readerMode)) {
    event.preventDefault();
    await rendition.next();
  }
  handleShortcut(event, format, bookKey, rendition);
};

const mouseChrome = async (rendition: any, deltaY: number) => {
  if (deltaY < 0) {
    await rendition.prev();
  }
  if (deltaY > 0) {
    await rendition.next();
  }
};

const handleShortcut = (
  event: any,
  format: string,
  bookKey: string,
  rendition?: any
) => {
  const shortcuts = getShortcutConfig();
  if (matchShortcut(event, shortcuts.bossKey)) {
    if (isElectron) {
      event.preventDefault();
      window.electronAPI.invoke("hide-reader", "ping");
    }
  }
  if (matchShortcut(event, shortcuts.exitReader)) {
    if (ConfigService.getReaderConfig("isFullscreen") === "yes") {
      ConfigService.setReaderConfig("isFullscreen", "no");
      handleExitFullScreen();
    } else {
      ConfigService.setReaderConfig("isFullscreen", "no");
      window.speechSynthesis && window.speechSynthesis.cancel();
      TTSUtil.pauseAudio();
      if (isElectron) {
        if (ConfigService.getReaderConfig("isOpenInMain") === "yes") {
          window.electronAPI.invoke("exit-tab", "ping");
        } else {
          window.electronAPI.invoke("exit-reader", "ping");
        }
      } else {
        exitWebReader(() =>
          ConfigService.setReaderConfig("isFinishWebReading", "yes")
        );
      }
    }
  }
  if (matchShortcut(event, shortcuts.toggleFullscreen)) {
    event.preventDefault();
    const entering = ConfigService.getReaderConfig("isFullscreen") !== "yes";
    entering ? handleFullScreen() : handleExitFullScreen();
    ConfigService.setReaderConfig("isFullscreen", entering ? "yes" : "no");
  }
  if (matchShortcut(event, shortcuts.toggleFishMode)) {
    if (isElectron && ConfigService.getReaderConfig("isMergeWord")) {
      event.preventDefault();
      ConfigService.setReaderConfig(
        "isMergeWord",
        ConfigService.getReaderConfig("isMergeWord") === "yes" ? "no" : "yes"
      );
      window.electronAPI.invoke("switch-moyu", "ping");
    }
  }
  if (matchShortcut(event, shortcuts.searchInBook)) {
    event.preventDefault();
    searchInTheBook("", "", false);
  }
  for (const { shortcut, position } of READING_PANEL_SHORTCUTS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      event.preventDefault();
      toggleReadingPanel(position);
      break;
    }
  }
  for (const { shortcut, tab } of NAV_TAB_SHORTCUTS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      event.preventDefault();
      toggleNavTab(tab);
      break;
    }
  }
  if (matchShortcut(event, shortcuts.createBookmark)) {
    event.preventDefault();
    const bookmarkBtn = document.querySelector(".add-bookmark-button");
    bookmarkBtn?.dispatchEvent(clickEvent());
  }
  if (rendition && matchShortcut(event, shortcuts.prevChapter)) {
    event.preventDefault();
    rendition.prevChapter();
  }
  if (rendition && matchShortcut(event, shortcuts.nextChapter)) {
    event.preventDefault();
    rendition.nextChapter();
  }
  for (const { shortcut, optionName } of SELECTION_SHORTCUT_OPTIONS) {
    if (matchShortcut(event, shortcuts[shortcut])) {
      if (getSelection(format, bookKey)) {
        event.preventDefault();
        triggerPopupOptionClick(optionName);
      }
      break;
    }
  }
};

const gesture = async (rendition: any, type: string) => {
  if (type === "panleft" || type === "panup") {
    await rendition.next();
  }
  if (type === "panright" || type === "pandown") {
    await rendition.prev();
  }
};

const handleLocation = (key: string, rendition: any) => {
  let position = rendition.getPosition();
  ConfigService.setObjectConfig(key, position, "recordLocation");
};
export const scrollChapter = async (
  element: any,
  rendition: any,
  deltaY: number
) => {
  if (deltaY < 0) {
    if (element.scrollTop === 0) {
      await rendition.prev();
    }
  }
  if (deltaY > 0) {
    var scrollHeight = element.scrollHeight;
    var scrollTop = element.scrollTop;
    var clientHeight = element.clientHeight;
    if (Math.abs(scrollTop + clientHeight - scrollHeight) < 10) {
      await rendition.next();
    }
  }
};
let lastScaleTime = 0;
export const bindHtmlEvent = (
  rendition: any,
  doc: any,
  key: string = "",
  readerMode: string = "",
  format: string = "",
  handleScale: (scale: string) => void,
  renderBookFunc: () => void
) => {
  doc.addEventListener(
    "keydown",
    async (event) => {
      if (lock) return;
      lock = true;
      await arrowKeys(rendition, event, readerMode, format, key);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );

  doc.addEventListener(
    "wheel",
    async (event) => {
      if (event.ctrlKey && readerMode !== "double") {
        const currentTime = Date.now();
        if (currentTime - lastScaleTime < 1500) {
          return;
        }
        lastScaleTime = currentTime;
        event.preventDefault();
        let scale = parseFloat(ConfigService.getReaderConfig("scale") || "1");
        if (event.deltaY < 0) {
          ConfigService.setReaderConfig("scale", scale + 0.1 + "");
        } else {
          ConfigService.setReaderConfig("scale", scale - 0.1 + "");
        }
        handleScale(ConfigService.getReaderConfig("scale") || "1");
        renderBookFunc();
        return;
      }
      if (lock) return;
      lock = true;
      if (readerMode === "scroll") {
        if (Math.abs(event.deltaX) === 0 && isReadingAidMode(format, key)) {
          // 段落模式下阻止原生滚动导致遮罩漂移，改为逐段导航
          event.preventDefault();
          await mouseChrome(rendition, event.deltaY);
        } else {
          await sleep(200);
          await rendition.record();
          if (
            Math.abs(event.deltaX) === 0 &&
            ConfigService.getReaderConfig("isDisableAutoScroll") !== "yes"
          ) {
            let srollElement = document.getElementById("page-area");
            await scrollChapter(srollElement, rendition, event.deltaY);
          }
        }
      } else {
        if (Math.abs(event.deltaX) === 0) {
          await mouseChrome(rendition, event.deltaY);
        }
      }
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );

  window.addEventListener(
    "keydown",
    async (event) => {
      if (lock) return;
      lock = true;
      await arrowKeys(rendition, event, readerMode, format, key);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );

  // Swipes turn pages when switched on, and by default on touch screens
  const touchSetting = ConfigService.getReaderConfig("isTouch");
  if (touchSetting === "yes" || (touchSetting !== "no" && isTouchDevice())) {
    const mc = new Hammer(doc);
    mc.get('pinch').set({ enable: true });
    mc.on("panleft panright panup pandown", async (event: any) => {
      if (readerMode === "scroll") {
        return;
      }
      if (lock || event.pointerType === "mouse") return;
      lock = true;
      await gesture(rendition, event.type);
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    });
    
    let lastPinchTime = 0;
    mc.on("pinchin pinchout", (event: any) => {
      const currentTime = Date.now();
      if (currentTime - lastPinchTime < 300) return;
      lastPinchTime = currentTime;
      
      let scale = parseFloat(ConfigService.getReaderConfig("scale") || "1");
      if (event.type === "pinchin") {
        scale = Math.max(0.5, scale - 0.1);
      } else {
        scale = Math.min(4, scale + 0.1);
      }
      ConfigService.setReaderConfig("scale", scale + "");
      handleScale(scale + "");
      renderBookFunc();
    });
  }

  if (isCompact() || isTouchDevice()) applyDrawingMode(doc);
  if ((isCompact() || isTouchDevice()) && !tapBoundDocs.has(doc)) {
    // The engine renders again on resize and page changes; one listener per
    // document, or a tap would toggle the bars twice
    tapBoundDocs.add(doc);
    // Some pages (PDF canvases) never get a click after a touch, so taps
    // are read from the touch itself; the click that may follow is ignored
    let touchStart: { x: number; y: number; time: number } | null = null;
    let lastTouchTap = 0;
    doc.addEventListener(
      "touchstart",
      (event: TouchEvent) => {
        const touch = event.touches.length === 1 ? event.touches[0] : null;
        touchStart = touch
          ? { x: touch.clientX, y: touch.clientY, time: Date.now() }
          : null;
      },
      { passive: true }
    );
    doc.addEventListener(
      "touchend",
      (event: TouchEvent) => {
        const start = touchStart;
        touchStart = null;
        const touch = event.changedTouches[0];
        if (!start || !touch) return;
        const moved = Math.hypot(
          touch.clientX - start.x,
          touch.clientY - start.y
        );
        // Swipes, scrolls and long presses (text selection) aren't taps
        if (moved > TAP_MAX_MOVE || Date.now() - start.time > TAP_MAX_TIME) {
          return;
        }
        lastTouchTap = Date.now();
        handleReaderTap(
          { clientX: touch.clientX, target: event.target } as MouseEvent,
          rendition,
          doc,
          readerMode,
          key
        );
      },
      { passive: true }
    );
    doc.addEventListener("click", (event: MouseEvent) => {
      if (Date.now() - lastTouchTap < 700) return;
      handleReaderTap(event, rendition, doc, readerMode, key);
    });
  }

  doc.addEventListener(
    "touchend",
    async () => {
      if (lock) return;
      lock = true;
      if (readerMode === "scroll") {
        await sleep(200);
        await rendition.record();
      }
      handleLocation(key, rendition);
      setTimeout(() => (lock = false), throttleTime);
    },
    { passive: false }
  );
};
export const htmlMouseEvent = (
  rendition: any,
  key: string,
  readerMode: string,
  format: string,
  handleScale: (scale: string) => void,
  renderBookFunc: () => void
) => {
  rendition.on("rendered", () => {
    let iframe = getIframeWin();
    if (!iframe) return;
    iframe?.focus();
    let docs = getIframeDoc(format, key);
    for (let i = 0; i < docs.length; i++) {
      let doc = docs[i];
      if (!doc) continue;
      bindHtmlEvent(
        rendition,
        doc,
        key,
        readerMode,
        format,
        handleScale,
        renderBookFunc
      );
    }
    lock = false;
  });
};
