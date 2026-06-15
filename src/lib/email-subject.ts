export const EMAIL_SUBJECT_PREFIX = "Form Submission Response - ";

const EMAIL_SUBJECT_PREFIX_TRIMMED = EMAIL_SUBJECT_PREFIX.trim();

export function stripEmailSubjectPrefix(subject: string): string {
  let trimmed = subject.trim();
  if (!trimmed) return "";

  const variants = [EMAIL_SUBJECT_PREFIX, EMAIL_SUBJECT_PREFIX_TRIMMED];
  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of variants) {
      if (trimmed.toLowerCase().startsWith(prefix.toLowerCase())) {
        trimmed = trimmed.slice(prefix.length).trimStart();
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

export function isCompleteEmailSubject(subject: string): boolean {
  return isEmailSubjectSuffixFilled(stripEmailSubjectPrefix(subject));
}

/** Suffix for the compose input from a stored full subject or draft value. */
export function emailSubjectSuffixFromStored(subject: string): string {
  const suffix = stripEmailSubjectPrefix(subject);
  return isEmailSubjectSuffixFilled(suffix) ? suffix : "";
}

export function buildEmailSubject(suffix: string): string {
  const trimmed = suffix.trim();
  if (!trimmed) return "";
  return `${EMAIL_SUBJECT_PREFIX}${trimmed}`;
}

/** Suffix saved in CRM overlay (empty when the agent has not set a subject). */
export function crmSubjectLabelFromStored(crmSubject: string | null | undefined): string {
  if (!crmSubject?.trim()) return "";
  return emailSubjectSuffixFromStored(crmSubject);
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

export function ensureEmailSubjectPrefix(subject: string): string {
  const suffix = stripEmailSubjectPrefix(subject);
  return buildEmailSubject(suffix);
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
