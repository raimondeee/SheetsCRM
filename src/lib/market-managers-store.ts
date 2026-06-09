import fs from "fs";
import path from "path";
import type { MarketManagerDirectory } from "./market-managers";
import { sortMarketManagers } from "./market-managers";

const FILE_PATH =
  process.env.MARKET_MANAGERS_PATH ||
  path.join(process.cwd(), "data", "market-managers.json");

function ensureDataDir(): void {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

export function loadMarketManagerDirectory(): MarketManagerDirectory {
  ensureDataDir();
  if (!fs.existsSync(FILE_PATH)) {
    const empty: MarketManagerDirectory = {
      updatedAt: new Date().toISOString(),
      managers: [],
    };
    fs.writeFileSync(FILE_PATH, JSON.stringify(empty, null, 2));
    return empty;
  }

  const raw = fs.readFileSync(FILE_PATH, "utf8");
  const parsed = JSON.parse(raw) as MarketManagerDirectory;
  return {
    updatedAt: parsed.updatedAt ?? new Date().toISOString(),
    managers: sortMarketManagers(parsed.managers ?? []),
  };
}

export function saveMarketManagerDirectory(
  managers: MarketManagerDirectory["managers"]
): MarketManagerDirectory {
  ensureDataDir();
  const payload: MarketManagerDirectory = {
    updatedAt: new Date().toISOString(),
    managers: sortMarketManagers(
      managers.filter((m) => m.name.trim() && m.email.trim())
    ),
  };
  fs.writeFileSync(FILE_PATH, JSON.stringify(payload, null, 2));
  return payload;
}
