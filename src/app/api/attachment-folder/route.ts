import { NextResponse } from "next/server";
import {
  attachmentRowFolderExists,
  buildCrmFolderUrl,
  ensureAttachmentDownloadsRoot,
  ensureAttachmentRowFolder,
  getAttachmentFolderStatus,
  getAttachmentRowFolderPath,
  pickAttachmentDownloadsRootViaOsascript,
  resetAttachmentDownloadsRootToDefault,
  setCustomAttachmentDownloadsRoot,
} from "@/lib/attachment-folder-path";
import { rowAttachmentFolderName } from "@/lib/attachment-folder-shared";

export const dynamic = "force-dynamic";

function folderPayload() {
  return getAttachmentFolderStatus();
}

/**
 * Resolve the configured attachments folder path and a crmfolder:// URL for Finder.
 * Query: rowNumber (optional), createRowFolder=1 to mkdir the Row {n} subfolder.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const rowRaw = searchParams.get("rowNumber");
    const createRowFolder = searchParams.get("createRowFolder") === "1";

    const rootPath = ensureAttachmentDownloadsRoot();
    const status = getAttachmentFolderStatus();
    let openPath = rootPath;
    let opened: "row" | "root" = "root";
    let rowFolderExists = false;

    if (rowRaw != null && rowRaw !== "") {
      const rowNumber = Number(rowRaw);
      if (!Number.isFinite(rowNumber)) {
        return NextResponse.json({ error: "Invalid rowNumber" }, { status: 400 });
      }
      rowFolderExists = attachmentRowFolderExists(rowNumber);
      if (createRowFolder || rowFolderExists) {
        openPath = createRowFolder
          ? ensureAttachmentRowFolder(rowNumber)
          : getAttachmentRowFolderPath(rowNumber);
        opened = "row";
        rowFolderExists = true;
      }
    }

    const pathHint =
      opened === "row"
        ? `${status.displayRoot}/${rowAttachmentFolderName(Number(rowRaw))}`
        : status.displayRoot;

    return NextResponse.json({
      ...status,
      openPath,
      rowPath: rowRaw != null && rowRaw !== "" ? getAttachmentRowFolderPath(Number(rowRaw)) : null,
      opened,
      rowFolderExists,
      pathHint,
      crmfolderUrl: buildCrmFolderUrl(openPath),
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to resolve attachment folder";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/**
 * Manage the downloads root:
 * - `{ "action": "pick" }` — macOS folder dialog, save custom root
 * - `{ "action": "reset" }` — restore ~/Documents/SheetsCRM-Attachments
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: string;
      path?: string;
    };
    const action = body.action?.trim();

    if (action === "pick") {
      try {
        const chosen = pickAttachmentDownloadsRootViaOsascript();
        const updated = setCustomAttachmentDownloadsRoot(chosen);
        return NextResponse.json({
          ...folderPayload(),
          ...updated,
          openPath: updated.rootPath,
          pathHint: updated.displayRoot,
          crmfolderUrl: buildCrmFolderUrl(updated.rootPath),
        });
      } catch (error) {
        if (error instanceof Error && error.name === "AttachmentFolderPickCancelled") {
          return NextResponse.json({ error: "cancelled", cancelled: true }, { status: 400 });
        }
        throw error;
      }
    }

    if (action === "reset") {
      const updated = resetAttachmentDownloadsRootToDefault();
      return NextResponse.json({
        ...folderPayload(),
        ...updated,
        openPath: updated.rootPath,
        pathHint: updated.displayRoot,
        crmfolderUrl: buildCrmFolderUrl(updated.rootPath),
      });
    }

    if (action === "set" && typeof body.path === "string") {
      const updated = setCustomAttachmentDownloadsRoot(body.path);
      return NextResponse.json({
        ...folderPayload(),
        ...updated,
        openPath: updated.rootPath,
        pathHint: updated.displayRoot,
        crmfolderUrl: buildCrmFolderUrl(updated.rootPath),
      });
    }

    return NextResponse.json(
      { error: 'Expected action "pick", "reset", or "set"' },
      { status: 400 }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to update attachment folder";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
