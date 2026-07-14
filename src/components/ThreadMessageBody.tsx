"use client";

import { looksLikeHtml, sanitizeEmailHtml } from "@/lib/html-utils";

interface ThreadMessageBodyProps {
  body: string;
  className?: string;
}

/**
 * Render a CRM thread message body.
 * HTML bodies keep draft/Gmail spacing + formatting; plain text uses pre-wrap.
 */
export function ThreadMessageBody({ body, className = "" }: ThreadMessageBodyProps) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (looksLikeHtml(trimmed)) {
    return (
      <div
        className={`thread-message-body mt-2 text-sm ${className}`.trim()}
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(trimmed) }}
      />
    );
  }

  return (
    <p className={`mt-2 whitespace-pre-wrap text-sm ${className}`.trim()}>{body}</p>
  );
}
