/** Static wellness / productivity content from public/jsons and breakschedule.rtf. */

export type WellnessContentSourceId =
  | "interesting_facts_100"
  | "airbnb"
  | "bizarre_laws_100"
  | "brain_teasers_100"
  | "movie_quotes_better_100"
  | "positive_affirmations_100"
  | "riddles_100"
  | "tech_workplace_origins_100"
  | "world_records_100";

export type WellnessContentKind =
  | "fact"
  | "riddle"
  | "teaser"
  | "quote"
  | "affirmation"
  | "law"
  | "record"
  | "story";

export type WellnessContentItem = {
  sourceId: WellnessContentSourceId;
  sourceTitle: string;
  kind: WellnessContentKind;
  /** Short label above the body (category, location, movie, topic, …). */
  eyebrow?: string;
  body: string;
  /** Hidden until the user clicks Reveal (riddles / brain teasers). */
  answer?: string;
  meta?: string;
};

export type WellnessContentSourceMeta = {
  id: WellnessContentSourceId;
  label: string;
  description: string;
  file: string;
};

export const WELLNESS_CONTENT_SOURCES: WellnessContentSourceMeta[] = [
  {
    id: "interesting_facts_100",
    label: "Interesting facts",
    description: "General trivia and surprising facts",
    file: "interesting_facts_100.json",
  },
  {
    id: "airbnb",
    label: "Airbnb facts",
    description: "Company and travel industry trivia",
    file: "airbnb.json",
  },
  {
    id: "bizarre_laws_100",
    label: "Bizarre laws",
    description: "Odd laws from around the world",
    file: "bizarre_laws_100.json",
  },
  {
    id: "brain_teasers_100",
    label: "Brain teasers",
    description: "Puzzles with a revealable answer",
    file: "brain_teasers_100.json",
  },
  {
    id: "movie_quotes_better_100",
    label: "Movie quotes",
    description: "Memorable lines from films",
    file: "movie_quotes_better_100.json",
  },
  {
    id: "positive_affirmations_100",
    label: "Positive affirmations",
    description: "Short encouraging statements",
    file: "positive_affirmations_100.json",
  },
  {
    id: "riddles_100",
    label: "Riddles",
    description: "Riddles with a revealable answer",
    file: "riddles_100.json",
  },
  {
    id: "tech_workplace_origins_100",
    label: "Tech workplace origins",
    description: "How everyday tech and office norms started",
    file: "tech_workplace_origins_100.json",
  },
  {
    id: "world_records_100",
    label: "World records",
    description: "Unusual record-holding feats",
    file: "world_records_100.json",
  },
];

const SOURCE_IDS = new Set(WELLNESS_CONTENT_SOURCES.map((s) => s.id));

export function isWellnessContentSourceId(value: string): value is WellnessContentSourceId {
  return SOURCE_IDS.has(value as WellnessContentSourceId);
}

export function wellnessContentUrl(file: string): string {
  return `/jsons/${encodeURIComponent(file)}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function str(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function parseItemsFromPayload(
  source: WellnessContentSourceMeta,
  payload: unknown
): WellnessContentItem[] {
  const root = asRecord(payload);
  if (!root) return [];
  const sourceTitle = str(root.title) || source.label;

  const push = (
    kind: WellnessContentKind,
    rows: unknown,
    map: (row: Record<string, unknown>) => Omit<WellnessContentItem, "sourceId" | "sourceTitle" | "kind"> | null
  ): WellnessContentItem[] => {
    if (!Array.isArray(rows)) return [];
    const out: WellnessContentItem[] = [];
    for (const row of rows) {
      const rec = asRecord(row);
      if (!rec) continue;
      const mapped = map(rec);
      if (!mapped?.body) continue;
      out.push({
        sourceId: source.id,
        sourceTitle,
        kind,
        ...mapped,
      });
    }
    return out;
  };

  switch (source.id) {
    case "interesting_facts_100":
      return push("fact", root.facts, (row) => {
        const body = str(row.fact);
        if (!body) return null;
        return { eyebrow: str(row.category) || undefined, body };
      });
    case "airbnb":
      return push("fact", root.airbnb_facts, (row) => {
        const body = str(row.fact);
        if (!body) return null;
        return { eyebrow: str(row.category) || undefined, body };
      });
    case "bizarre_laws_100":
      return push("law", root.laws, (row) => {
        const body = str(row.law);
        if (!body) return null;
        return { eyebrow: str(row.location) || undefined, body };
      });
    case "brain_teasers_100":
      return push("teaser", root.puzzles, (row) => {
        const body = str(row.teaser);
        if (!body) return null;
        return { body, answer: str(row.answer) || undefined };
      });
    case "movie_quotes_better_100":
      return push("quote", root.quotes, (row) => {
        const body = str(row.quote);
        if (!body) return null;
        return {
          eyebrow: str(row.movie) || undefined,
          body,
          meta: str(row.character) || undefined,
        };
      });
    case "positive_affirmations_100":
      return push("affirmation", root.affirmations, (row) => {
        const body = str(row.affirmation);
        if (!body) return null;
        return { body };
      });
    case "riddles_100":
      return push("riddle", root.riddles, (row) => {
        const body = str(row.riddle);
        if (!body) return null;
        return { body, answer: str(row.answer) || undefined };
      });
    case "tech_workplace_origins_100":
      return push("story", root.stories, (row) => {
        const body = str(row.fact);
        if (!body) return null;
        return { eyebrow: str(row.topic) || undefined, body };
      });
    case "world_records_100":
      return push("record", root.records, (row) => {
        const body = str(row.fact);
        if (!body) return null;
        return { eyebrow: str(row.record) || undefined, body };
      });
    default:
      return [];
  }
}

const cache = new Map<WellnessContentSourceId, Promise<WellnessContentItem[]>>();

export async function loadWellnessContentSource(
  sourceId: WellnessContentSourceId
): Promise<WellnessContentItem[]> {
  const existing = cache.get(sourceId);
  if (existing) return existing;

  const meta = WELLNESS_CONTENT_SOURCES.find((s) => s.id === sourceId);
  if (!meta) return [];

  const promise = (async () => {
    try {
      const res = await fetch(wellnessContentUrl(meta.file), { cache: "force-cache" });
      if (!res.ok) return [];
      const payload: unknown = await res.json();
      return parseItemsFromPayload(meta, payload);
    } catch {
      return [];
    }
  })();

  cache.set(sourceId, promise);
  return promise;
}

export async function loadWellnessContentPool(
  sourceIds: WellnessContentSourceId[]
): Promise<WellnessContentItem[]> {
  const unique = [...new Set(sourceIds.filter(isWellnessContentSourceId))];
  if (unique.length === 0) return [];
  const batches = await Promise.all(unique.map((id) => loadWellnessContentSource(id)));
  return batches.flat();
}

export function pickRandomWellnessItem(
  pool: WellnessContentItem[],
  avoidKey?: string | null
): WellnessContentItem | null {
  if (pool.length === 0) return null;
  if (pool.length === 1) return pool[0]!;
  const filtered = avoidKey
    ? pool.filter((item) => wellnessItemKey(item) !== avoidKey)
    : pool;
  const list = filtered.length > 0 ? filtered : pool;
  return list[Math.floor(Math.random() * list.length)]!;
}

export function wellnessItemKey(item: WellnessContentItem): string {
  return `${item.sourceId}:${item.kind}:${item.body.slice(0, 48)}`;
}

export function wellnessKindLabel(kind: WellnessContentKind): string {
  switch (kind) {
    case "fact":
      return "Fact";
    case "riddle":
      return "Riddle";
    case "teaser":
      return "Brain teaser";
    case "quote":
      return "Movie quote";
    case "affirmation":
      return "Affirmation";
    case "law":
      return "Bizarre law";
    case "record":
      return "World record";
    case "story":
      return "Origin story";
    default:
      return "Break";
  }
}

/** Schedules from public/breakschedule.rtf (Pomodoro / movement protocols). */
export type PomodoroScheduleId = "25-5" | "50-10" | "52-17" | "25-1";

export type PomodoroSchedule = {
  id: PomodoroScheduleId;
  label: string;
  nickname: string;
  workMinutes: number;
  breakMinutes: number;
  movement: string;
  dailyActivity: string;
  benefit: string;
};

export const POMODORO_SCHEDULES: PomodoroSchedule[] = [
  {
    id: "25-5",
    label: "25 / 5",
    nickname: "Gold Standard",
    workMinutes: 25,
    breakMinutes: 5,
    movement: "5 min walk per break",
    dailyActivity: "16 snacks (≈80 mins active time)",
    benefit:
      "Maximal glucose control: drops post-meal blood sugar spikes by ~58% and keeps blood pressure down all day.",
  },
  {
    id: "50-10",
    label: "50 / 10",
    nickname: "Hourly Sync",
    workMinutes: 50,
    breakMinutes: 10,
    movement: "10 min walk/stretch per break",
    dailyActivity: "8 snacks (≈80 mins active time)",
    benefit:
      "Sustained energy: exceeds the 5-min/hour threshold; excellent for loosening hip flexors and mental fatigue.",
  },
  {
    id: "52-17",
    label: "52 / 17",
    nickname: "Ultradian Flow",
    workMinutes: 52,
    breakMinutes: 17,
    movement: "15 min walk + 2 min stretch",
    dailyActivity: "6 snacks (≈102 mins active time)",
    benefit:
      "Full autonomic reset: long enough for HRV recovery, outdoor light exposure, and brisk walks.",
  },
  {
    id: "25-1",
    label: "25 / 1",
    nickname: "Micro-Snack",
    workMinutes: 25,
    breakMinutes: 1,
    movement: "1 min mobility per break",
    dailyActivity: "16 snacks (≈16 mins active time)",
    benefit:
      "Minimum viable dose: mitigates blood pressure increases while keeping friction extremely low.",
  },
];

export function getPomodoroSchedule(id: PomodoroScheduleId): PomodoroSchedule {
  return POMODORO_SCHEDULES.find((s) => s.id === id) ?? POMODORO_SCHEDULES[0]!;
}

export function isPomodoroScheduleId(value: string): value is PomodoroScheduleId {
  return POMODORO_SCHEDULES.some((s) => s.id === value);
}
