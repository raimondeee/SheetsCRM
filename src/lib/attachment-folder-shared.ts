/** Shared attachment-folder naming (safe for client and server). */

export const ATTACHMENT_DOWNLOADS_ROOT_NAME = "SheetsCRM-Attachments";

/** Display / on-disk name for the standard downloads root under Documents. */
export const ATTACHMENT_DOWNLOADS_ROOT_DISPLAY = `Documents/${ATTACHMENT_DOWNLOADS_ROOT_NAME}`;

export function rowAttachmentFolderName(rowNumber: number): string {
  return `Row ${rowNumber}`;
}
