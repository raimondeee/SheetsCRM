/**
 * Chrome/Edge File System Access API helpers for saving ticket attachments into
 * a user-chosen root folder as `Row {n}/{filename}`.
 *
 * Directory handles are stored in IndexedDB (not server preferences) because they
 * cannot be serialized to JSON.
 */

type WellKnownDirectory =
  | "desktop"
  | "documents"
  | "downloads"
  | "music"
  | "pictures"
  | "videos";

type DirectoryPickerOptions = {
  mode?: "read" | "readwrite";
  startIn?: FileSystemHandle | WellKnownDirectory;
  id?: string;
};

type OpenFilePickerOptions = {
  multiple?: boolean;
  startIn?: FileSystemHandle | WellKnownDirectory;
  id?: string;
};

type FsPermissionDescriptor = { mode?: "read" | "readwrite" };
type FsPermissionState = PermissionState | "prompt";

type DirectoryHandleWithPermission = FileSystemDirectoryHandle & {
  queryPermission: (descriptor?: FsPermissionDescriptor) => Promise<FsPermissionState>;
  requestPermission: (descriptor?: FsPermissionDescriptor) => Promise<FsPermissionState>;
};

declare global {
  interface Window {
    showDirectoryPicker?: (
      options?: DirectoryPickerOptions
    ) => Promise<FileSystemDirectoryHandle>;
    showOpenFilePicker?: (
      options?: OpenFilePickerOptions
    ) => Promise<FileSystemFileHandle[]>;
  }
}

const DB_NAME = "sheetscrm_fs";
const DB_VERSION = 1;
const STORE_NAME = "handles";
const HANDLE_KEY = "attachmentRoot";
const FOLDER_NAME_KEY = "sheetscrm_attachment_folder_name";

function canUseFolderPicker(): boolean {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export function isAttachmentFolderPickerSupported(): boolean {
  return canUseFolderPicker();
}

export function rowAttachmentFolderName(rowNumber: number): string {
  return `Row ${rowNumber}`;
}

export function readAttachmentFolderDisplayName(): string | null {
  if (typeof window === "undefined") return null;
  try {
    const name = localStorage.getItem(FOLDER_NAME_KEY)?.trim();
    return name || null;
  } catch {
    return null;
  }
}

function writeAttachmentFolderDisplayName(name: string | null): void {
  try {
    if (!name) localStorage.removeItem(FOLDER_NAME_KEY);
    else localStorage.setItem(FOLDER_NAME_KEY, name);
  } catch {
    /* ignore quota / private mode */
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => resolve(request.result);
  });
}

async function idbGetHandle(): Promise<FileSystemDirectoryHandle | null> {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const request = store.get(HANDLE_KEY);
      request.onerror = () => reject(request.error ?? new Error("Failed to read folder handle"));
      request.onsuccess = () => {
        const value = request.result;
        resolve(value instanceof FileSystemDirectoryHandle ? value : null);
      };
    });
  } finally {
    db.close();
  }
}

async function idbSetHandle(handle: FileSystemDirectoryHandle | null): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const request = handle ? store.put(handle, HANDLE_KEY) : store.delete(HANDLE_KEY);
      request.onerror = () => reject(request.error ?? new Error("Failed to store folder handle"));
      request.onsuccess = () => resolve();
    });
  } finally {
    db.close();
  }
}

async function ensureReadWritePermission(
  handle: FileSystemDirectoryHandle
): Promise<boolean> {
  const dir = handle as DirectoryHandleWithPermission;
  const opts: FsPermissionDescriptor = { mode: "readwrite" };
  const query = await dir.queryPermission(opts);
  if (query === "granted") return true;
  const requested = await dir.requestPermission(opts);
  return requested === "granted";
}

export async function getAttachmentDownloadFolderInfo(): Promise<{ name: string } | null> {
  if (!canUseFolderPicker()) return null;
  const handle = await idbGetHandle();
  if (!handle) {
    writeAttachmentFolderDisplayName(null);
    return null;
  }
  writeAttachmentFolderDisplayName(handle.name);
  return { name: handle.name };
}

export async function pickAttachmentDownloadFolder(): Promise<{ name: string }> {
  if (!canUseFolderPicker()) {
    throw new Error("Folder picker requires Chrome or Edge.");
  }
  const handle = await window.showDirectoryPicker!({ mode: "readwrite" });
  const allowed = await ensureReadWritePermission(handle);
  if (!allowed) {
    throw new Error("Permission to write to that folder was denied.");
  }
  await idbSetHandle(handle);
  writeAttachmentFolderDisplayName(handle.name);
  return { name: handle.name };
}

export async function clearAttachmentDownloadFolder(): Promise<void> {
  await idbSetHandle(null);
  writeAttachmentFolderDisplayName(null);
}

function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[/\\?%*:|"<>]/g, "_").trim();
  return base || "attachment";
}

function splitFilename(filename: string): { stem: string; ext: string } {
  const trimmed = filename.trim() || "attachment";
  const dot = trimmed.lastIndexOf(".");
  if (dot <= 0) return { stem: trimmed, ext: "" };
  return { stem: trimmed.slice(0, dot), ext: trimmed.slice(dot) };
}

async function uniqueFilenameInDir(
  dir: FileSystemDirectoryHandle,
  filename: string
): Promise<string> {
  const safe = sanitizeFilename(filename);
  const { stem, ext } = splitFilename(safe);
  let candidate = safe;
  let n = 1;
  while (true) {
    try {
      await dir.getFileHandle(candidate);
      candidate = `${stem} (${n})${ext}`;
      n += 1;
    } catch {
      return candidate;
    }
  }
}

/**
 * Saves into `{root}/Row {rowNumber}/{filename}` when a folder is configured.
 * Returns null when no folder is set (caller should fall back to browser download).
 */
export async function saveBlobToAttachmentFolder(params: {
  rowNumber: number;
  filename: string;
  blob: Blob;
}): Promise<{ rootName: string; rowFolder: string; filename: string } | null> {
  if (!canUseFolderPicker() || !Number.isFinite(params.rowNumber)) return null;

  const root = await idbGetHandle();
  if (!root) return null;

  const allowed = await ensureReadWritePermission(root);
  if (!allowed) {
    throw new Error(
      "Attachment folder permission expired. Choose the folder again in Preferences."
    );
  }

  const rowFolder = rowAttachmentFolderName(params.rowNumber);
  const rowDir = await root.getDirectoryHandle(rowFolder, { create: true });
  const filename = await uniqueFilenameInDir(rowDir, params.filename);
  const fileHandle = await rowDir.getFileHandle(filename, { create: true });
  const writable = await fileHandle.createWritable();
  try {
    await writable.write(params.blob);
  } finally {
    await writable.close();
  }

  writeAttachmentFolderDisplayName(root.name);
  return { rootName: root.name, rowFolder, filename };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/**
 * Opens a system file/folder picker starting at the ticket's `Row {n}` folder when
 * that subfolder already exists; otherwise starts at the configured root.
 *
 * Browsers cannot reveal folders in Finder/Explorer, so this is the closest
 * equivalent via the File System Access API `startIn` option.
 */
export async function openAttachmentDownloadFolder(params?: {
  rowNumber?: number;
}): Promise<{ opened: "row" | "root"; pathHint: string }> {
  if (!canUseFolderPicker()) {
    throw new Error("Opening the attachment folder requires Chrome or Edge.");
  }

  const root = await idbGetHandle();
  if (!root) {
    throw new Error("No attachment folder configured. Choose one in Preferences.");
  }

  const allowed = await ensureReadWritePermission(root);
  if (!allowed) {
    throw new Error(
      "Attachment folder permission expired. Choose the folder again in Preferences."
    );
  }

  writeAttachmentFolderDisplayName(root.name);

  let target: FileSystemDirectoryHandle = root;
  let opened: "row" | "root" = "root";
  let pathHint = root.name;

  const rowNumber = params?.rowNumber;
  if (rowNumber != null && Number.isFinite(rowNumber)) {
    const rowFolder = rowAttachmentFolderName(rowNumber);
    try {
      target = await root.getDirectoryHandle(rowFolder, { create: false });
      opened = "row";
      pathHint = `${root.name}/${rowFolder}`;
    } catch {
      // Row folder has not been created yet (no downloads for this row).
    }
  }

  try {
    // Prefer the open-file picker so the dialog shows the folder's contents for browsing.
    if (typeof window.showOpenFilePicker === "function") {
      await window.showOpenFilePicker({
        startIn: target,
        multiple: true,
        id: "sheetscrm-attachment-browse",
      });
    } else {
      // Discard the result — this is browse-only, not a root-folder change.
      await window.showDirectoryPicker!({
        startIn: target,
        mode: "read",
        id: "sheetscrm-attachment-browse",
      });
    }
  } catch (error) {
    // Closing the dialog without selecting is the normal "done browsing" path.
    if (!isAbortError(error)) throw error;
  }

  return { opened, pathHint };
}
