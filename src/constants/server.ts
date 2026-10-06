// The Folio server this app works with: accounts, AI, voices, OCR, sync and
// downloads all come from it.
//
// locked: true  - the app only ever uses `url`. There's no server address to
//                 enter in Settings → Server, and a saved connection to any
//                 other server is ignored.
// locked: false - people can connect to any Folio server; `url` is filled in
//                 as the suggestion.
export const FOLIO_SERVER = {
  url: "https://folio.armorclub.org",
  locked: true,
};
