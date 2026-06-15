import fs from "fs";
import path from "path";

export type EnvFieldType = "text" | "url" | "number" | "boolean" | "textarea";

export interface EnvFieldDefinition {
  key: string;
  label: string;
  description: string;
  secret: boolean;
  type: EnvFieldType;
  placeholder?: string;
  group: string;
}

export const ENV_FIELD_GROUPS = [
  "Google sign-in",
  "Google service account (optional)",
  "App",
  "Sheet & Salesforce",
  "Integrations",
  "Local paths",
] as const;

export const MANAGED_ENV_FIELDS: EnvFieldDefinition[] = [
  {
    key: "GOOGLE_CLIENT_ID",
    label: "Google Client ID",
    description: "OAuth Web client ID from Google Cloud Console.",
    secret: true,
    type: "text",
    group: "Google sign-in",
  },
  {
    key: "GOOGLE_CLIENT_SECRET",
    label: "Google Client Secret",
    description: "OAuth client secret. Never shared after you save it here.",
    secret: true,
    type: "text",
    group: "Google sign-in",
  },
  {
    key: "GOOGLE_SERVICE_ACCOUNT_EMAIL",
    label: "Service account email",
    description: "Optional fallback if OAuth is not used.",
    secret: false,
    type: "text",
    group: "Google service account (optional)",
  },
  {
    key: "GOOGLE_PRIVATE_KEY",
    label: "Service account private key",
    description: "Paste the full PEM key. Stored locally in .env only.",
    secret: true,
    type: "textarea",
    group: "Google service account (optional)",
  },
  {
    key: "NEXT_PUBLIC_APP_URL",
    label: "App URL",
    description: "Usually http://localhost:3000 for local dev.",
    secret: false,
    type: "url",
    placeholder: "http://localhost:3000",
    group: "App",
  },
  {
    key: "NEXT_PUBLIC_AUTO_REFRESH_SECONDS",
    label: "Auto-refresh interval (seconds)",
    description: "How often the CRM polls the sheet and threads.",
    secret: false,
    type: "number",
    placeholder: "60",
    group: "App",
  },
  {
    key: "USE_MOCK_DATA",
    label: "Use mock ticket data",
    description: "Set to true when Google credentials are not configured yet.",
    secret: false,
    type: "boolean",
    group: "App",
  },
  {
    key: "DEFAULT_SHEET_URL",
    label: "Default sheet URL",
    description: "Used until a sheet is configured in Setup.",
    secret: false,
    type: "url",
    group: "Sheet & Salesforce",
  },
  {
    key: "SALESFORCE_SEARCH_BASE_URL",
    label: "Salesforce search base URL",
    description: "Base URL for Column D unified search links.",
    secret: false,
    type: "url",
    group: "Sheet & Salesforce",
  },
  {
    key: "NEXT_PUBLIC_SALESFORCE_SEARCH_BASE_URL",
    label: "Salesforce search URL (public)",
    description: "Optional override exposed to the browser.",
    secret: false,
    type: "url",
    group: "Sheet & Salesforce",
  },
  {
    key: "MIXMAX_API_TOKEN",
    label: "Mixmax API token",
    description: "Mixmax Settings → Integrations → API token.",
    secret: true,
    type: "text",
    group: "Integrations",
  },
  {
    key: "GMAIL_SENDER_EMAIL",
    label: "Gmail sender email (legacy)",
    description: "Not needed when using Sign in with Google.",
    secret: false,
    type: "text",
    group: "Integrations",
  },
  {
    key: "OVERLAY_DB_PATH",
    label: "Overlay database path",
    description: "SQLite file for CRM overlay data.",
    secret: false,
    type: "text",
    placeholder: "./data/overlay.db",
    group: "Local paths",
  },
  {
    key: "MARKET_MANAGERS_PATH",
    label: "Market managers JSON path",
    description: "Local file for the MM email directory.",
    secret: false,
    type: "text",
    placeholder: "./data/market-managers.json",
    group: "Local paths",
  },
];

const MANAGED_KEYS = new Set(MANAGED_ENV_FIELDS.map((f) => f.key));

function envFilePath(): string {
  return path.join(process.cwd(), ".env");
}

function exampleEnvPath(): string {
  return path.join(process.cwd(), ".env.example");
}

function ensureEnvFileExists(): void {
  const target = envFilePath();
  if (fs.existsSync(target)) return;
  if (fs.existsSync(exampleEnvPath())) {
    fs.copyFileSync(exampleEnvPath(), target);
    return;
  }
  fs.writeFileSync(target, "# SheetsCRM local environment\n", "utf8");
}

/** Parse .env contents into key → value (handles quoted values and \\n). */
export function parseEnvFile(content: string): Map<string, string> {
  const result = new Map<string, string>();
  const lines = content.split(/\r?\n/);
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      i += 1;
      continue;
    }

    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) {
      i += 1;
      continue;
    }

    const key = match[1];
    let raw = match[2];

    if (raw.startsWith('"')) {
      let combined = raw.slice(1);
      while (!combined.endsWith('"') && i + 1 < lines.length) {
        i += 1;
        combined += `\n${lines[i]}`;
      }
      if (combined.endsWith('"')) {
        combined = combined.slice(0, -1);
      }
      raw = combined.replace(/\\n/g, "\n").replace(/\\"/g, '"');
    } else if (raw.startsWith("'")) {
      raw = raw.slice(1, -1);
    }

    result.set(key, raw);
    i += 1;
  }

  return result;
}

function formatEnvValue(value: string): string {
  if (!value) return "";
  if (/[\n\r"#'\s=]/.test(value)) {
    return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
  }
  return value;
}

export function serializeEnvUpdates(updates: Record<string, string>): string {
  return Object.entries(updates)
    .map(([key, value]) => `${key}=${formatEnvValue(value)}`)
    .join("\n");
}

/** Merge updates into .env, preserving comments and unrelated keys. */
export function writeEnvUpdates(updates: Record<string, string>): void {
  const allowed = Object.fromEntries(
    Object.entries(updates).filter(([key]) => MANAGED_KEYS.has(key))
  );
  if (Object.keys(allowed).length === 0) return;

  ensureEnvFileExists();
  const filePath = envFilePath();
  const original = fs.readFileSync(filePath, "utf8");
  const lines = original.split(/\r?\n/);
  const updatedKeys = new Set<string>();
  const output: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)=/);
    if (match && allowed[match[1]] !== undefined) {
      output.push(`${match[1]}=${formatEnvValue(allowed[match[1]])}`);
      updatedKeys.add(match[1]);
      continue;
    }
    output.push(line);
  }

  const appended: string[] = [];
  for (const [key, value] of Object.entries(allowed)) {
    if (!updatedKeys.has(key)) {
      appended.push(`${key}=${formatEnvValue(value)}`);
    }
  }

  if (appended.length > 0) {
    if (output.length > 0 && output[output.length - 1] !== "") {
      output.push("");
    }
    output.push("# Added via SheetsCRM environment settings");
    output.push(...appended);
  }

  fs.writeFileSync(filePath, `${output.join("\n").replace(/\n*$/, "\n")}`, "utf8");

  for (const [key, value] of Object.entries(allowed)) {
    process.env[key] = value;
  }
}

export function maskEnvValue(value: string, secret: boolean): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!secret) return trimmed;

  if (trimmed.length <= 8) return "••••••••";
  if (trimmed.includes("BEGIN PRIVATE KEY")) return "-----BEGIN PRIVATE KEY----- ••••";
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`;
}

export interface EnvFieldStatus {
  key: string;
  label: string;
  description: string;
  secret: boolean;
  type: EnvFieldType;
  group: string;
  placeholder?: string;
  isSet: boolean;
  displayValue: string | null;
}

export function getEnvFieldStatuses(): EnvFieldStatus[] {
  ensureEnvFileExists();
  const fromFile = parseEnvFile(fs.readFileSync(envFilePath(), "utf8"));

  return MANAGED_ENV_FIELDS.map((field) => {
    const runtime = process.env[field.key] ?? "";
    const stored = fromFile.get(field.key) ?? "";
    const value = runtime || stored;
    const isSet = value.trim().length > 0;

    return {
      ...field,
      isSet,
      displayValue: isSet ? maskEnvValue(value, field.secret) : null,
    };
  });
}

export function isLocalEnvEditorRequest(request: Request): boolean {
  const host = (request.headers.get("host") ?? "").toLowerCase();
  return /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host);
}
