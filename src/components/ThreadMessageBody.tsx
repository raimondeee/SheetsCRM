"use client";

import { memo, type MouseEvent } from "react";
import { looksLikeHtml, sanitizeEmailHtml } from "@/lib/html-utils";

interface ThreadMessageBodyProps {
  body: string;
  className?: string;
}

function hasActiveTextSelection(container: HTMLElement): boolean {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (!selection.toString()) return false;
  const anchor = selection.anchorNode;
  return Boolean(anchor && container.contains(anchor));
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
  // Selecting text that includes a link must not navigate / clear the selection.
  if (hasActiveTextSelection(event.currentTarget)) return;
  event.preventDefault();
  window.open(anchor.href, "_blank", "noopener,noreferrer");
}

/**
 * Render a CRM thread message body.
 * HTML bodies keep draft/Gmail spacing + formatting; plain text uses pre-wrap.
 * Links always open in a new tab.
 */
function ThreadMessageBodyComponent({ body, className = "" }: ThreadMessageBodyProps) {
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

export const ThreadMessageBody = memo(ThreadMessageBodyComponent);
