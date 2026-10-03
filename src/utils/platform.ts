// Where Folio is running; no app imports, so any module can use it

// Phones and narrow windows get the compact layout (see utils/responsive)
export const COMPACT_MAX_WIDTH = 768;

export const isCompact = () =>
  window.innerWidth <= COMPACT_MAX_WIDTH || isNativeApp() || isTouchDevice();

// The Android app (Capacitor)
export const isNativeApp = () =>
  !!(window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.();

export const isTouchDevice = () =>
  !!window.matchMedia?.("(pointer: coarse)").matches;

// Books open in this window instead of a new one where extra windows don't
// fit: the Android app, phones and touch tablets
export const readsInSameWindow = () =>
  isNativeApp() || isCompact() || isTouchDevice();

export const LIBRARY_HASH = "#/manager/home";

// Leaves a book in the web build and the Android app; the library syncs
// what was read when it shows again
export const exitWebReader = (setFinished: () => void) => {
  setFinished();
  if (readsInSameWindow()) {
    document.title = "Folio";
    window.location.hash = LIBRARY_HASH;
  } else {
    window.close();
  }
};

// Two pages side by side don't fit a phone: show one; the saved preference
// still applies on wider screens
export const effectiveReaderMode = (mode: string) =>
  mode === "double" && window.innerWidth <= COMPACT_MAX_WIDTH ? "single" : mode;
