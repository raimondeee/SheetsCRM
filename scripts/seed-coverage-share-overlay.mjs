/**
 * Build or seed per-teammate SheetsCRM share overlays from the exporter's
 * Team Coverage + primary sheet mapping.
 *
 * List recipients:
 *   node scripts/seed-coverage-share-overlay.mjs --source-db data/overlay.db --list \
 *     --self-label "Robert"
 *
 * Seed one recipient overlay:
 *   node scripts/seed-coverage-share-overlay.mjs --source-db data/overlay.db \
 *     --dest-db ../out/Alex/data/overlay.db --recipient-key cover-1 \
 *     --self-label "Robert"
 */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";

const MAX_COVER_SHEETS = 10;

function argValue(flag) {
  const idx = process.argv.indexOf(flag);
  if (idx < 0 || idx + 1 >= process.argv.length) return null;
  return process.argv[idx + 1];
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function coverSheetSlotId(index) {
  return `cover-${index + 1}`;
}

function createEmptyCoverEntries() {
  return Array.from({ length: MAX_COVER_SHEETS }, (_, index) => ({
    id: coverSheetSlotId(index),
    label: "",
    enabled: false,
    config: null,
  }));
}

function readJsonRow(db, id) {
  const row = db.prepare("SELECT config_json FROM sheet_config WHERE id = ?").get(id);
  if (!row?.config_json) return null;
  try {
    return JSON.parse(row.config_json);
  } catch {
    return null;
  }
}

function cloneSheetConfig(config, id) {
  const now = new Date().toISOString();
  return {
    ...structuredClone(config),
    id,
    manuallyMapped: true,
    createdAt: config.createdAt || now,
    updatedAt: now,
  };
}

function loadRoster(sourceDbPath, selfLabel) {
  if (!fs.existsSync(sourceDbPath)) {
    throw new Error(`Source overlay DB not found: ${sourceDbPath}`);
  }

  const db = new Database(sourceDbPath, { readonly: true });
  try {
    const defaultConfig = readJsonRow(db, "default");
    const coverStore = readJsonRow(db, "cover_sheets");
    const coverEntries = Array.isArray(coverStore?.entries) ? coverStore.entries : [];

    const members = [];

    if (defaultConfig?.spreadsheetId) {
      members.push({
        key: "self",
        label: selfLabel,
        sheetUrl: defaultConfig.sheetUrl || "",
        spreadsheetId: defaultConfig.spreadsheetId,
        sheetName: defaultConfig.sheetName || "",
        config: defaultConfig,
      });
    }

    for (const entry of coverEntries) {
      const config = entry?.config;
      if (!config?.spreadsheetId) continue;
      const label =
        (typeof entry.label === "string" && entry.label.trim()) ||
        config.sheetName ||
        entry.id ||
        "Teammate";
      members.push({
        key: entry.id,
        label,
        sheetUrl: config.sheetUrl || "",
        spreadsheetId: config.spreadsheetId,
        sheetName: config.sheetName || "",
        config,
      });
    }

    return members;
  } finally {
    db.close();
  }
}

function buildRecipientOverlay(members, recipientKey) {
  const recipient = members.find((m) => m.key === recipientKey);
  if (!recipient) {
    throw new Error(`Recipient not found: ${recipientKey}`);
  }

  const primary = cloneSheetConfig(recipient.config, "default");
  const others = members.filter((m) => m.key !== recipientKey);
  const covers = createEmptyCoverEntries();

  others.slice(0, MAX_COVER_SHEETS).forEach((member, index) => {
    const slotId = coverSheetSlotId(index);
    covers[index] = {
      id: slotId,
      label: member.label,
      enabled: true,
      config: cloneSheetConfig(member.config, slotId),
    };
  });

  return { primary, covers, recipient };
}

function writeOverlayDb(destDbPath, primary, covers) {
  fs.mkdirSync(path.dirname(destDbPath), { recursive: true });
  if (fs.existsSync(destDbPath)) fs.unlinkSync(destDbPath);
  for (const suffix of ["-wal", "-shm"]) {
    const side = `${destDbPath}${suffix}`;
    if (fs.existsSync(side)) fs.unlinkSync(side);
  }

  const db = new Database(destDbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS sheet_config (
        id TEXT PRIMARY KEY,
        config_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    const now = new Date().toISOString();
    const upsert = db.prepare(
      `INSERT INTO sheet_config (id, config_json, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         config_json = excluded.config_json,
         updated_at = excluded.updated_at`
    );
    upsert.run("default", JSON.stringify(primary), now);
    upsert.run("cover_sheets", JSON.stringify({ entries: covers }), now);
  } finally {
    db.close();
  }
}

function slugify(label) {
  return (
    String(label || "teammate")
      .normalize("NFKD")
      .replace(/[^\w\s-]+/g, "")
      .trim()
      .replace(/[\s_]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "teammate"
  );
}

const sourceDb = argValue("--source-db");
const selfLabel = argValue("--self-label") || "Team host";
const listMode = hasFlag("--list");
const destDb = argValue("--dest-db");
const recipientKey = argValue("--recipient-key");

if (!sourceDb) {
  console.error(
    "Usage:\n" +
      "  node scripts/seed-coverage-share-overlay.mjs --source-db data/overlay.db --list [--self-label Name]\n" +
      "  node scripts/seed-coverage-share-overlay.mjs --source-db data/overlay.db --dest-db PATH --recipient-key KEY [--self-label Name]"
  );
  process.exit(1);
}

const members = loadRoster(path.resolve(sourceDb), selfLabel);

if (listMode) {
  const payload = members.map((m) => ({
    key: m.key,
    label: m.label,
    slug: slugify(m.label),
    sheetUrl: m.sheetUrl,
    spreadsheetId: m.spreadsheetId,
    sheetName: m.sheetName,
  }));
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

if (!destDb || !recipientKey) {
  console.error("Seed mode requires --dest-db and --recipient-key");
  process.exit(1);
}

const { primary, covers, recipient } = buildRecipientOverlay(members, recipientKey);
writeOverlayDb(path.resolve(destDb), primary, covers);

process.stdout.write(
  `${JSON.stringify(
    {
      ok: true,
      recipient: {
        key: recipient.key,
        label: recipient.label,
        slug: slugify(recipient.label),
        sheetUrl: primary.sheetUrl,
      },
      coverCount: covers.filter((c) => c.enabled && c.config).length,
      destDb: path.resolve(destDb),
    },
    null,
    2
  )}\n`
);
