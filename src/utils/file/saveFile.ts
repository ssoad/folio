// Saves a file the app made (an export, a backup, an annotated PDF).
//
// Browsers and the desktop app download it (file-saver). The Android app's
// WebView has no downloads, so there it's written to the app's cache and
// handed to the system share sheet: save it to Files or Drive, or send it.

import { saveAs as browserSaveAs } from "file-saver";
import { isNativeApp } from "../platform";

const toBase64 = (blob: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });

// Names safe for the file system
const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 180) || "Folio";

export const saveAs = async (data: Blob | string, name: string) => {
  const blob =
    typeof data === "string" ? new Blob([data], { type: "text/plain" }) : data;
  if (!isNativeApp()) {
    browserSaveAs(blob, name);
    return;
  }
  const [{ Filesystem, Directory }, { Share }] = await Promise.all([
    import("@capacitor/filesystem"),
    import("@capacitor/share"),
  ]);
  const path = "exports/" + safeName(name);
  const { uri } = await Filesystem.writeFile({
    path,
    data: await toBase64(blob),
    directory: Directory.Cache,
    recursive: true,
  });
  try {
    await Share.share({ title: name, files: [uri] });
  } catch (error) {
    // Closing the share sheet without choosing isn't a failure
    if (!/cancel/i.test(String((error as Error)?.message || error))) throw error;
  }
};
