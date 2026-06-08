import fs from "fs";
import path from "path";

const DB_PATH = process.env.OVERLAY_DB_PATH || path.join(process.cwd(), "data", "overlay.db");

const dir = path.dirname(DB_PATH);
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

console.log(`Overlay DB ready at ${DB_PATH}`);
