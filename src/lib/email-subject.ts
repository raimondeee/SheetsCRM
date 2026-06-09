export const EMAIL_SUBJECT_PREFIX = "Form Submission Response - ";

export function stripEmailSubjectPrefix(subject: string): string {
  const trimmed = subject.trim();
  if (!trimmed.toLowerCase().startsWith(EMAIL_SUBJECT_PREFIX.toLowerCase())) {
    return trimmed;
  }
  return trimmed.slice(EMAIL_SUBJECT_PREFIX.length).trimStart();
}

export function buildEmailSubject(suffix: string): string {
  const trimmed = suffix.trim();
  return trimmed ? `${EMAIL_SUBJECT_PREFIX}${trimmed}` : EMAIL_SUBJECT_PREFIX.trim();
}

export function ensureEmailSubjectPrefix(subject: string): string {
  const suffix = stripEmailSubjectPrefix(subject);
  return buildEmailSubject(suffix);
}
