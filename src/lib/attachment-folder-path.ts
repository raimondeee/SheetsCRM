/**
 * On-disk attachment downloads root for local macOS installs.
 *
 * Layer: server path helpers (Node `os` / `fs` / optional osascript picker)
 *
 * Default: `~/Documents/SheetsCRM-Attachments`. Agents can pick a different root
 * in Preferences; choice is stored in `data/attachment-folder-config.json`.
 * Ticket files save into `Row {n}/` under that root. Finder open uses the
 * `crmfolder://` helper against the same path.
 */

import { execFileSync } from "child_process";
import { homedir } from "os";
import path from "path";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "fs";
import {
  ATTACHMENT_DOWNLOADS_ROOT_DISPLAY,
  ATTACHMENT_DOWNLOADS_ROOT_NAME,
  rowAttachmentFolderName,
} from "./attachment-folder-shared";

export {
  ATTACHMENT_DOWNLOADS_ROOT_NAME,
  ATTACHMENT_DOWNLOADS_ROOT_DISPLAY,
  rowAttachmentFolderName,
} from "./attachment-folder-shared";

interface AttachmentFolderConfig {
  /** Absolute path override; null/omitted = use default Documents location. */
  customRootPath: string | null;
}

function configFilePath(): string {
  return path.join(process.cwd(), "data", "attachment-folder-config.json");
}

function readConfig(): AttachmentFolderConfig {
  const filePath = configFilePath();
  if (!existsSync(filePath)) return { customRootPath: null };
  try {
    const raw = JSON.parse(readFileSync(filePath, "utf8")) as Partial<AttachmentFolderConfig>;
    const custom =
      typeof raw.customRootPath === "string" && raw.customRootPath.trim()
        ? path.resolve(raw.customRootPath.trim())
        : null;
    return { customRootPath: custom };
  } catch {
    return { customRootPath: null };
  }
}

function writeConfig(config: AttachmentFolderConfig): void {
  const filePath = configFilePath();
  mkdirSync(path.dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
}

export function getDefaultAttachmentDownloadsRootPath(): string {
  return path.join(homedir(), "Documents", ATTACHMENT_DOWNLOADS_ROOT_NAME);
}

/** Absolute root currently in use (custom if set, otherwise default). */
export function getAttachmentDownloadsRootPath(): string {
  const custom = readConfig().customRootPath;
  if (custom) return custom;
  return getDefaultAttachmentDownloadsRootPath();
}

export function isUsingDefaultAttachmentDownloadsRoot(): boolean {
  return readConfig().customRootPath == null;
}

/** Friendly display path (`~/…` when under home). */
export function formatAttachmentPathForDisplay(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  const home = homedir();
  if (resolved === getDefaultAttachmentDownloadsRootPath()) {
    return `~/${ATTACHMENT_DOWNLOADS_ROOT_DISPLAY}`;
  }
  if (resolved === home) return "~";
  if (resolved.startsWith(home + path.sep)) {
    return `~${resolved.slice(home.length)}`;
  }
  return resolved;
}

export function getAttachmentDownloadsRootDisplay(): string {
  return formatAttachmentPathForDisplay(getAttachmentDownloadsRootPath());
}

export function getAttachmentFolderStatus(): {
  rootPath: string;
  displayRoot: string;
  defaultRootPath: string;
  defaultDisplayRoot: string;
  isDefault: boolean;
} {
  const rootPath = getAttachmentDownloadsRootPath();
  return {
    rootPath,
    displayRoot: formatAttachmentPathForDisplay(rootPath),
    defaultRootPath: getDefaultAttachmentDownloadsRootPath(),
    defaultDisplayRoot: `~/${ATTACHMENT_DOWNLOADS_ROOT_DISPLAY}`,
    isDefault: isUsingDefaultAttachmentDownloadsRoot(),
  };
}

function assertDirectoryPath(absolutePath: string): string {
  const resolved = path.resolve(absolutePath);
  if (!existsSync(resolved)) {
    mkdirSync(resolved, { recursive: true });
  }
  const stat = statSync(resolved);
  if (!stat.isDirectory()) {
    throw new Error(`Not a folder: ${resolved}`);
  }
  return resolved;
}

/** Persist a custom root (creates the folder if needed). */
export function setCustomAttachmentDownloadsRoot(absolutePath: string): {
  rootPath: string;
  displayRoot: string;
  isDefault: boolean;
} {
  const resolved = assertDirectoryPath(absolutePath);
  const defaultRoot = getDefaultAttachmentDownloadsRootPath();
  if (resolved === defaultRoot) {
    writeConfig({ customRootPath: null });
  } else {
    writeConfig({ customRootPath: resolved });
  }
  return {
    rootPath: getAttachmentDownloadsRootPath(),
    displayRoot: getAttachmentDownloadsRootDisplay(),
    isDefault: isUsingDefaultAttachmentDownloadsRoot(),
  };
}

/** Clear custom root and return to ~/Documents/SheetsCRM-Attachments. */
export function resetAttachmentDownloadsRootToDefault(): {
  rootPath: string;
  displayRoot: string;
  isDefault: boolean;
} {
  writeConfig({ customRootPath: null });
  const rootPath = ensureAttachmentDownloadsRoot();
  return {
    rootPath,
    displayRoot: getAttachmentDownloadsRootDisplay(),
    isDefault: true,
  };
}

/**
 * macOS folder picker via AppleScript (local CRM only).
 * Throws with message "cancelled" when the user dismisses the dialog.
 */
export function pickAttachmentDownloadsRootViaOsascript(): string {
  if (process.platform !== "darwin") {
    throw new Error("Choosing a folder is only available on macOS.");
  }
  try {
    const out = execFileSync(
      "osascript",
      [
        "-e",
        'POSIX path of (choose folder with prompt "Choose SheetsCRM attachment downloads folder")',
      ],
      { encoding: "utf8", timeout: 120_000 }
    ).trim();
    if (!out) throw new Error("No folder selected");
    return path.resolve(out.replace(/\/+$/, ""));
  } catch (error) {
    const err = error as Error & { status?: number; stderr?: Buffer | string };
    const detail = `${err.message || ""} ${String(err.stderr || "")}`;
    // macOS returns "User canceled." when the dialog is dismissed.
    if (/user canceled|cancelled/i.test(detail)) {
      const cancel = new Error("cancelled");
      cancel.name = "AttachmentFolderPickCancelled";
      throw cancel;
    }
    throw error instanceof Error ? error : new Error(String(error));
  }
}

export function getAttachmentRowFolderPath(rowNumber: number): string {
  return path.join(getAttachmentDownloadsRootPath(), rowAttachmentFolderName(rowNumber));
}

export function ensureAttachmentDownloadsRoot(): string {
  const root = getAttachmentDownloadsRootPath();
  mkdirSync(root, { recursive: true });
  return root;
}

export function ensureAttachmentRowFolder(rowNumber: number): string {
  const root = ensureAttachmentDownloadsRoot();
  const rowPath = path.join(root, rowAttachmentFolderName(rowNumber));
  mkdirSync(rowPath, { recursive: true });
  return rowPath;
}

export function attachmentRowFolderExists(rowNumber: number): boolean {
  return existsSync(getAttachmentRowFolderPath(rowNumber));
}

/** Build a crmfolder:// URL for an absolute filesystem path. */
export function buildCrmFolderUrl(absolutePath: string): string {
  return `crmfolder://${encodeURI(absolutePath)}`;
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

function uniqueFilenameOnDisk(dir: string, filename: string): string {
  const safe = sanitizeFilename(filename);
  const { stem, ext } = splitFilename(safe);
  let candidate = safe;
  let n = 1;
  while (existsSync(path.join(dir, candidate))) {
    candidate = `${stem} (${n})${ext}`;
    n += 1;
  }
  return candidate;
}

/**
 * Write attachment bytes into `{configuredRoot}/Row {n}/`.
 * Same folder Finder opens via crmfolder://.
 */
export function saveBufferToAttachmentRowFolder(
  rowNumber: number,
  filename: string,
  data: Buffer | Uint8Array
): {
  absolutePath: string;
  rootPath: string;
  rowFolder: string;
  filename: string;
  pathHint: string;
} {
  if (!Number.isFinite(rowNumber)) {
    throw new Error("Invalid row number for attachment folder");
  }
  const rootPath = ensureAttachmentDownloadsRoot();
  const rowDir = ensureAttachmentRowFolder(rowNumber);
  const unique = uniqueFilenameOnDisk(rowDir, filename);
  const absolutePath = path.join(rowDir, unique);
  writeFileSync(absolutePath, data);
  const rowFolder = rowAttachmentFolderName(rowNumber);
  const displayRoot = formatAttachmentPathForDisplay(rootPath);
  return {
    absolutePath,
    rootPath,
    rowFolder,
    filename: unique,
    pathHint: `${displayRoot}/${rowFolder}/${unique}`,
  };
}
