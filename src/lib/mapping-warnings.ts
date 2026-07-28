/** Fingerprint helpers so agents can dismiss sticky column-mapping warnings. */

export function mappingWarningsFingerprint(warnings: string[]): string {
  return [...warnings]
    .map((warning) => warning.trim())
    .filter(Boolean)
    .sort()
    .join("\n");
}

export function filterActiveMappingWarnings(
  warnings: string[],
  dismissedFingerprint: string | null | undefined
): string[] {
  const cleaned = warnings.map((w) => w.trim()).filter(Boolean);
  if (cleaned.length === 0) return [];
  const fingerprint = mappingWarningsFingerprint(cleaned);
  if (dismissedFingerprint && dismissedFingerprint === fingerprint) return [];
  return cleaned;
}
