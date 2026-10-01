import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
declare var window: any;

// Books whose cover the user picked themselves. They stay visible even with
// "Disable PDF cover" on, and "Use first page" removes the book from the list.
const CUSTOM_COVER_LIST = "customCoverBooks";

export const isCustomCover = (key: string) =>
  ConfigService.getAllListConfig(CUSTOM_COVER_LIST).includes(key);

export const setCustomCover = (key: string, isCustom: boolean) => {
  if (isCustom) {
    if (!isCustomCover(key)) ConfigService.setListConfig(key, CUSTOM_COVER_LIST);
  } else {
    ConfigService.deleteListConfig(key, CUSTOM_COVER_LIST);
  }
};

// Renders the first page of a PDF to a JPEG data URL, the same default
// cover the importer gives PDFs. Returns "" when the PDF can't be rendered
// (encrypted, damaged, or pdf.js not loaded).
export const renderPdfFirstPage = async (
  buffer: ArrayBuffer,
  width = 600
): Promise<string> => {
  const pdfjsLib = window.pdfjsLib;
  if (!pdfjsLib || !buffer) return "";
  // pdf.js hands the data to its worker, which detaches the buffer: copy it
  const task = pdfjsLib.getDocument({ data: new Uint8Array(buffer.slice(0)) });
  try {
    const pdf = await task.promise;
    const page = await pdf.getPage(1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: width / base.width });
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const context = canvas.getContext("2d");
    if (!context) return "";
    // Transparent pages would turn black in a JPEG
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: context, viewport }).promise;
    return canvas.toDataURL("image/jpeg", 0.85);
  } catch (error) {
    console.error("renderPdfFirstPage error:", error);
    return "";
  } finally {
    task.destroy();
  }
};
