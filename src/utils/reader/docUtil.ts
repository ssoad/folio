import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";

export const getIframeDoc = (format: string, bookKey?: string) => {
  let pageArea = document.getElementById("page-area");

  if (!pageArea) return [];
  let iframes = Array.from(pageArea.getElementsByTagName("iframe"));
  if (iframes.length === 0) return [];

  let docs: Document[] = [];
  for (let iframe of iframes) {
    let doc = iframe.contentDocument;
    if (doc) {
      docs.push(doc);
      let subIframes = doc.querySelectorAll("iframe");
      subIframes.forEach((sub) => {
        if (sub.contentDocument) docs.push(sub.contentDocument);
      });
    }
  }
  return docs;
};
export const getIframeWin = () => {
  let pageArea = document.getElementById("page-area");
  if (!pageArea) return null;
  let iframe = pageArea.getElementsByTagName("iframe")[0];
  if (!iframe) return null;
  return iframe;
};

export const clearIframeSelection = (format: string, bookKey?: string) => {
  const docs = getIframeDoc(format, bookKey);
  for (let i = 0; i < docs.length; i++) {
    const doc = docs[i];
    if (!doc) continue;
    try {
      doc.getSelection()?.empty?.();
      doc.getSelection()?.removeAllRanges?.();
    } catch (e) {}
  }
  try {
    window.getSelection()?.empty?.();
    window.getSelection()?.removeAllRanges?.();
  } catch (e) {}
};
