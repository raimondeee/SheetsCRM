import fs from "fs";
import path from "path";
import type { MarketManagerDirectory } from "./market-managers";
import { sortMarketManagers } from "./market-managers";

const FILE_PATH =
  process.env.MARKET_MANAGERS_PATH ||
  path.join(process.cwd(), "data", "market-managers.json");

const EXAMPLE_PATH = path.join(process.cwd(), "data", "market-managers.example.json");

function ensureDataDir(): void {
  const dir = path.dirname(FILE_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function emptyDirectory(): MarketManagerDirectory {
  return {
    updatedAt: new Date().toISOString(),
    managers: [],
  };
}

function seedFromExampleIfPresent(): MarketManagerDirectory {
  if (fs.existsSync(EXAMPLE_PATH)) {
    try {
      const raw = fs.readFileSync(EXAMPLE_PATH, "utf8");
      const parsed = JSON.parse(raw) as MarketManagerDirectory;
      return {
        updatedAt: new Date().toISOString(),
        managers: sortMarketManagers(parsed.managers ?? []),
      };
    } catch {
      // fall through to empty
    }
  }
  return emptyDirectory();
}

export function loadMarketManagerDirectory(): MarketManagerDirectory {
  ensureDataDir();
  if (!fs.existsSync(FILE_PATH)) {
    const seeded = seedFromExampleIfPresent();
    fs.writeFileSync(FILE_PATH, JSON.stringify(seeded, null, 2));
    return seeded;
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
