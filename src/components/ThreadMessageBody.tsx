"use client";

import type { MouseEvent } from "react";
import { looksLikeHtml, sanitizeEmailHtml } from "@/lib/html-utils";

interface ThreadMessageBodyProps {
  body: string;
  className?: string;
}

function openThreadLinkInNewTab(event: MouseEvent<HTMLElement>) {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest("a");
  if (!anchor || !anchor.href) return;
  // Let modified clicks / middle-click use the browser default (already target=_blank).
  if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return;
  }
  if (event.button !== 0) return;
  event.preventDefault();
  window.open(anchor.href, "_blank", "noopener,noreferrer");
}

/**
 * Render a CRM thread message body.
 * HTML bodies keep draft/Gmail spacing + formatting; plain text uses pre-wrap.
 * Links always open in a new tab.
 */
export function ThreadMessageBody({ body, className = "" }: ThreadMessageBodyProps) {
  const trimmed = body.trim();
  if (!trimmed) return null;

  if (looksLikeHtml(trimmed)) {
    return (
      <div
        className={`thread-message-body mt-2 text-sm ${className}`.trim()}
        dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(trimmed) }}
        onClick={openThreadLinkInNewTab}
      />
    );
  }

  return (
    <p className={`mt-2 whitespace-pre-wrap text-sm ${className}`.trim()}>{body}</p>
  );
}
