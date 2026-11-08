// Highlights that read well in every theme.
//
// The engine draws a highlight as an element with the class "kookit-note"
// and a pastel background: a span around the text in reflowable books, a
// box over the text in PDFs (blended with "multiply", like marker ink).
// Pastel works on light and sepia pages, but on dark pages it either
// vanished (multiply by black is black) or put light text on a pale band.
// On dark pages each highlight takes a deep version of its colour instead:
// behind the text in books, and blended with "screen" over PDF pages, which
// keeps the band coloured and the white text white. The original colour is
// remembered on the element, so a switch back to a light theme restores it.

const parseColor = (color: string): [number, number, number] | null => {
  const hex = color.match(/#([\da-f]{2})([\da-f]{2})([\da-f]{2})/i);
  if (hex) {
    return [parseInt(hex[1], 16), parseInt(hex[2], 16), parseInt(hex[3], 16)];
  }
  const rgb = color.match(/rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : null;
};

// The same hue, deep enough to sit under light text on a dark page
export const darkHighlightColor = (color: string, alpha = 1) => {
  const rgb = parseColor(color);
  if (!rgb) return color;
  const [r, g, b] = rgb.map((v) => v / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let hue = 0;
  if (max !== min) {
    const d = max - min;
    hue =
      max === r
        ? ((g - b) / d + (g < b ? 6 : 0)) * 60
        : max === g
          ? ((b - r) / d + 2) * 60
          : ((r - g) / d + 4) * 60;
  }
  // Greys (no hue) stay grey; colours get enough saturation to show
  const saturation = max === min ? 0 : 65;
  return `hsla(${Math.round(hue)}, ${saturation}%, 32%, ${alpha})`;
};

const ORIGINAL = "folioBg";
const ORIGINAL_BLEND = "folioBlend";

export const syncHighlightColors = (doc: Document, isDark: boolean) => {
  doc.querySelectorAll<HTMLElement>(".kookit-note").forEach((note) => {
    const style = note.style;
    if (note.dataset[ORIGINAL] === undefined) {
      // A highlight drawn as a background (not an underline style)
      if (!style.background && !style.backgroundColor) return;
      note.dataset[ORIGINAL] = style.background || style.backgroundColor;
      note.dataset[ORIGINAL_BLEND] = style.mixBlendMode || "";
    }
    // Applied already for this theme (browsers rewrite colours, so the
    // style can't be compared)
    const mode = isDark ? "dark" : "light";
    if (note.dataset.folioMode === mode) return;
    note.dataset.folioMode = mode;
    const original = note.dataset[ORIGINAL]!;
    // PDF highlights are boxes laid over the page; book highlights wrap text
    const isOverlay = note.tagName === "DIV";
    if (isDark) {
      style.background = darkHighlightColor(original, isOverlay ? 1 : 0.9);
      style.mixBlendMode = isOverlay ? "screen" : "normal";
    } else {
      style.background = original;
      style.mixBlendMode = note.dataset[ORIGINAL_BLEND] || "";
    }
  });
};
