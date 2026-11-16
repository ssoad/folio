// Syncs ink (strokes, text boxes, sticky notes) with the chosen data source,
// after the library sync. Ink is one file, config/ink.json, holding every
// book's ink; this device's copy and the cloud's are merged item by item
// (inkStore.mergeInk), so drawing on two devices keeps both.

import { ConfigService } from "../../assets/lib/kookit-extra-browser.min";
import { isElectron } from "react-device-detect";
import SyncService from "../storage/syncService";
import { getCloudConfig } from "../file/common";
import { getStorageLocation } from "../common";
import {
  InkBook,
  InkDeleted,
  inkBookKeys,
  loadBookDeleted,
  loadBookInk,
  mergeInk,
  saveBookDeleted,
  saveBookInk,
} from "./inkStore";
import { refreshInk } from "./markMode";

declare var window: any;

const FILE_NAME = "ink.json";
const FOLDER = "config";

type InkFile = {
  version: 1;
  books: Record<string, { ink: InkBook; deleted: InkDeleted }>;
};

const emptyFile = (): InkFile => ({ version: 1, books: {} });

const parseFile = (text: string): InkFile => {
  try {
    const data = JSON.parse(text);
    if (data && typeof data.books === "object") return data as InkFile;
  } catch {
    // Unreadable: start again from this device's ink
  }
  return emptyFile();
};

const download = async (): Promise<InkFile> => {
  if (isElectron) {
    const service = ConfigService.getItem("defaultSyncOption");
    if (!service) return emptyFile();
    const tokenConfig = await getCloudConfig(service);
    const ok = await window.electronAPI.invoke("cloud-download", {
      ...tokenConfig,
      fileName: FILE_NAME,
      service,
      type: FOLDER,
      storagePath: getStorageLocation(),
    });
    const fs = window.electronAPI.fs;
    const file = getStorageLocation() + "/" + FOLDER + "/" + FILE_NAME;
    if (!ok || !fs.existsSync(file)) return emptyFile();
    return parseFile(fs.readFileSync(file, "utf-8"));
  }
  const syncUtil = await SyncService.getSyncUtil();
  try {
    const buffer: ArrayBuffer = await syncUtil.downloadFile(FILE_NAME, FOLDER);
    if (!buffer) return emptyFile();
    return parseFile(new TextDecoder().decode(buffer));
  } catch {
    // Not there yet (first sync)
    return emptyFile();
  }
};

const upload = async (data: InkFile) => {
  const text = JSON.stringify(data);
  if (isElectron) {
    const service = ConfigService.getItem("defaultSyncOption");
    if (!service) return;
    const tokenConfig = await getCloudConfig(service);
    const fs = window.electronAPI.fs;
    const folder = getStorageLocation() + "/" + FOLDER;
    if (!fs.existsSync(folder)) fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(folder + "/" + FILE_NAME, text);
    await window.electronAPI.invoke("cloud-upload", {
      ...tokenConfig,
      fileName: FILE_NAME,
      service,
      type: FOLDER,
      storagePath: getStorageLocation(),
    });
    return;
  }
  const syncUtil = await SyncService.getSyncUtil();
  await syncUtil.uploadFile(
    FILE_NAME,
    FOLDER,
    new Blob([text], { type: "application/json" })
  );
};

/** Merges this device's ink with the cloud's, both ways */
export const syncInkData = async () => {
  if (!ConfigService.getItem("defaultSyncOption")) return;
  const cloud = await download();
  const keys = new Set([...Object.keys(cloud.books), ...inkBookKeys()]);
  const merged = emptyFile();
  keys.forEach((key) => {
    const local = { ink: loadBookInk(key), deleted: loadBookDeleted(key) };
    const remote = cloud.books[key] || { ink: {}, deleted: {} };
    const result = mergeInk(local, remote);
    saveBookInk(key, result.ink);
    saveBookDeleted(key, result.deleted);
    if (Object.keys(result.ink).length || Object.keys(result.deleted).length) {
      merged.books[key] = result;
    }
  });
  await upload(merged);
  refreshInk();
};
