/** Context from the intake sheet ticket used to fill Mixmax template placeholders. */
export interface MixmaxTemplateContext {
  fullName: string;
  email: string;
}

export function parseFirstName(fullName: string): string {
  const trimmed = fullName.trim();
  if (!trimmed) return "";
  return trimmed.split(/\s+/)[0] ?? "";
}

function resolveVariable(key: string, context: MixmaxTemplateContext): string {
  const normalized = key.toLowerCase().replace(/\s+/g, " ").trim();

  if (/first\s*name/.test(normalized)) return parseFirstName(context.fullName);
  if (/^(full\s*)?name$/.test(normalized) || normalized === "name") {
    return context.fullName.trim();
  }
  if (/email|e-?mail/.test(normalized)) return context.email.trim();

  return "";
}

/**
 * Resolves Mixmax-style placeholders, e.g. {{first name | there:}} or {{First Name}}.
 * Uses intake sheet name/email when the Mixmax API does not resolve them in snippets.
 */
export function resolveMixmaxVariables(text: string, context: MixmaxTemplateContext): string {
  if (!text) return text;

  return text.replace(/\{\{([^}]+)\}\}/g, (match, inner: string) => {
    const pipeIndex = inner.indexOf("|");
    const varPart = (pipeIndex >= 0 ? inner.slice(0, pipeIndex) : inner).trim();
    const fallbackRaw = (pipeIndex >= 0 ? inner.slice(pipeIndex + 1) : "").trim();
    const fallback = fallbackRaw.replace(/:+$/, "").trim();

    const value = resolveVariable(varPart, context);
    return value || fallback || match;
  });
}
