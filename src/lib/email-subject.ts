/** Default CRM compose subject prefix when Setup has not overridden it. */
export const DEFAULT_EMAIL_SUBJECT_PREFIX = "Form Submission Response - ";

/** @deprecated Prefer DEFAULT_EMAIL_SUBJECT_PREFIX or a sheet-config prefix. */
export const EMAIL_SUBJECT_PREFIX = DEFAULT_EMAIL_SUBJECT_PREFIX;

/**
 * Normalize a typed Setup prefix.
 * - `""` (empty string) = prefix disabled (no fixed text)
 * - `null` / `undefined` / whitespace = use the default prefix
 * - any other text = custom prefix (trailing space added for suffix join)
 */
export function normalizeEmailSubjectPrefix(prefix: string | null | undefined): string {
  if (prefix === "") return "";
  const trimmed = (prefix ?? "").trim();
  if (!trimmed) return DEFAULT_EMAIL_SUBJECT_PREFIX;
  return `${trimmed} `;
}

/** True when Setup has explicitly disabled the fixed subject prefix. */
export function isEmailSubjectPrefixDisabled(prefix: string | null | undefined): boolean {
  return prefix === "";
}

function prefixStripVariants(prefix: string | null | undefined): string[] {
  const configured = normalizeEmailSubjectPrefix(prefix);
  const variants = [
    configured,
    configured.trim(),
    DEFAULT_EMAIL_SUBJECT_PREFIX,
    DEFAULT_EMAIL_SUBJECT_PREFIX.trim(),
  ];
  return [...new Set(variants.filter(Boolean))];
}

export function stripEmailSubjectPrefix(
  subject: string,
  prefix?: string | null
): string {
  let trimmed = subject.trim();
  if (!trimmed) return "";

  const variants = prefixStripVariants(prefix);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of variants) {
      if (trimmed.toLowerCase().startsWith(candidate.toLowerCase())) {
        trimmed = trimmed.slice(candidate.length).trimStart();
        changed = true;
        break;
      }
    }
  }

  return trimmed;
}

export function isEmailSubjectSuffixFilled(suffix: string): boolean {
  return suffix.trim().length > 0;
}

export function isCompleteEmailSubject(
  subject: string,
  prefix?: string | null
): boolean {
  return isEmailSubjectSuffixFilled(stripEmailSubjectPrefix(subject, prefix));
}

/** Suffix for the compose input from a stored full subject or draft value. */
export function emailSubjectSuffixFromStored(
  subject: string,
  prefix?: string | null
): string {
  const suffix = stripEmailSubjectPrefix(subject, prefix);
  return isEmailSubjectSuffixFilled(suffix) ? suffix : "";
}

export function buildEmailSubject(suffix: string, prefix?: string | null): string {
  const trimmed = suffix.trim();
  if (!trimmed) return "";
  const normalized = normalizeEmailSubjectPrefix(prefix);
  return normalized ? `${normalized}${trimmed}` : trimmed;
}

/** Suffix saved in CRM overlay (empty when the agent has not set a subject). */
export function crmSubjectLabelFromStored(
  crmSubject: string | null | undefined,
  prefix?: string | null
): string {
  if (!crmSubject?.trim()) return "";
  return emailSubjectSuffixFromStored(crmSubject, prefix);
}

/** Primary title line in the ticket list — CRM suffix only, not sheet intake subject. */
export function ticketListPrimaryLine(ticket: {
  crmSubjectLabel: string;
  headerField: string;
  contactReason: string;
}): string {
  const crmLabel = ticket.crmSubjectLabel.trim();
  if (crmLabel) return crmLabel;
  const header = ticket.headerField.trim();
  if (header) return header;
  const reason = ticket.contactReason.trim();
  if (reason) return reason;
  return "No subject";
}

export function ensureEmailSubjectPrefix(
  subject: string,
  prefix?: string | null
): string {
  const suffix = stripEmailSubjectPrefix(subject, prefix);
  return buildEmailSubject(suffix, prefix);
}

/**
 * Whether linking a Gmail thread may set the ticket subject from the thread.
 * Allowed when the CRM never saved a subject (blank line or sheet-only / unedited).
 */
export function shouldSetSubjectFromLinkedGmailThread(
  crmSubject: string | null | undefined
): boolean {
  return !crmSubject?.trim();
}
