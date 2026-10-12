// The store screenshots: which raw screen, the canvas, and the words over
// it. frame.html renders one by its index (frame.html#3); build.sh renders
// them all into store/google-play/.
window.SHOTS = [
  // Phone, 1080 x 1920
  { out: "phone/01-library", raw: "phone-library", device: "phone", theme: "light",
    title: "Your library,\nbeautifully kept", sub: "Covers, progress and shelves for every book you own." },
  { out: "phone/02-reading", raw: "phone-reader-sepia", device: "phone", theme: "light",
    title: "Made for\nlong reads", sub: "Calm pages in light, sepia or dark, with no clutter." },
  { out: "phone/03-highlights", raw: "phone-reader-highlight", device: "phone", theme: "light",
    title: "Highlight\nwhat matters", sub: "Mark passages in colour, add notes, copy and look up." },
  { out: "phone/04-display", raw: "phone-reader-display", device: "phone", theme: "light",
    title: "Make every\npage yours", sub: "Text size, themes, scroll or pages, a tap away." },
  { out: "phone/05-listen-ask", raw: "phone-onboarding-3", device: "phone", theme: "dark",
    title: "Listen, ask,\ntranslate", sub: "Natural voices, an AI helper for any passage, instant translation." },
  { out: "phone/06-sync", raw: "phone-onboarding-4", device: "phone", theme: "dark",
    title: "On every device,\nand private", sub: "Books, notes and progress sync, encrypted in Folio Cloud." },
  { out: "phone/07-dark", raw: "phone-library-dark", device: "phone", theme: "dark",
    title: "Easy on the\neyes at night", sub: "A dark theme for the library and the page." },
  { out: "phone/08-formats", raw: "phone-reader-dark", device: "phone", theme: "dark",
    title: "Every format\nyou read", sub: "EPUB, PDF, MOBI, AZW3, comics, TXT, FB2 and more." },

  // 10-inch tablet, 1920 x 1200
  { out: "tablet-10/01-library", raw: "tablet10-library", device: "tablet10", theme: "light",
    title: "Your library, beautifully kept", sub: "Covers, progress and shelves for every book you own." },
  { out: "tablet-10/02-reading", raw: "tablet10-reader", device: "tablet10", theme: "light",
    title: "Turn real pages", sub: "A two-page spread, highlights and notes, made for the big screen." },
  { out: "tablet-10/03-dark", raw: "tablet10-library-dark", device: "tablet10", theme: "dark",
    title: "Easy on the eyes at night", sub: "A dark theme for the library and the page." },

  // 7-inch tablet, 1200 x 1920
  { out: "tablet-7/01-library", raw: "tablet7-library", device: "tablet7", theme: "light",
    title: "Your library,\nbeautifully kept", sub: "Covers, progress and shelves for every book you own." },
  { out: "tablet-7/02-reading", raw: "tablet7-reader", device: "tablet7", theme: "light",
    title: "Made for\nlong reads", sub: "Highlights, notes and calm pages." },
  { out: "tablet-7/03-dark", raw: "tablet7-library-dark", device: "tablet7", theme: "dark",
    title: "Easy on the\neyes at night", sub: "A dark theme for the library and the page." },
];

// Canvas and device geometry (px): screen width, bezel, corner radius, top
window.DEVICES = {
  phone: { w: 1080, h: 1920, screen: 608, bezel: 16, radius: 70, top: 486, status: 46 },
  tablet10: { w: 1920, h: 1200, screen: 1400, bezel: 22, radius: 44, top: 222, status: 34 },
  tablet7: { w: 1200, h: 1920, screen: 860, bezel: 22, radius: 52, top: 400, status: 38 },
};
