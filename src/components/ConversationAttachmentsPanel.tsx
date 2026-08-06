"use client";

import type { ThreadMessage } from "@/lib/types";
import { formatFileSize } from "@/lib/gmail-attachments";
import { ThreadAttachmentDownloadButton } from "./CollapsibleAttachmentList";

interface ConversationAttachmentsPanelProps {
  messages: ThreadMessage[];
  rowId: string;
  rowNumber: number;
  fillHeight?: boolean;
}

interface ChronologicalAttachment {
  key: string;
  id: string;
  filename: string;
  sizeBytes: number;
  sentAt: string;
  direction: ThreadMessage["direction"];
  from: string;
  to: string;
  downloadHref: string;
}

function senderLabel(msg: Pick<ChronologicalAttachment, "direction" | "from" | "to">): string {
  if (msg.direction === "outbound") return `You → ${msg.to}`;
  if (msg.direction === "inbound") return msg.from;
  return msg.from || msg.direction;
}

function collectAttachments(
  messages: ThreadMessage[],
  rowId: string
): ChronologicalAttachment[] {
  const items: ChronologicalAttachment[] = [];
  for (const msg of messages) {
    if (!msg.attachments?.length) continue;
    for (const att of msg.attachments) {
        items.push({
          key: `${msg.id}:${att.id}`,
          id: att.id,
          filename: att.filename,
          sizeBytes: att.sizeBytes,
          sentAt: msg.sentAt,
          direction: msg.direction,
          from: msg.from,
          to: msg.to,
          downloadHref: `/api/tickets/${encodeURIComponent(rowId)}/thread/attachments/${encodeURIComponent(att.id)}`,
        });
    }
  }
  return items;
}

export function ConversationAttachmentsPanel({
  messages,
  rowId,
  rowNumber,
  fillHeight = false,
}: ConversationAttachmentsPanelProps) {
  const attachments = collectAttachments(messages, rowId);
  const totalBytes = attachments.reduce((sum, item) => sum + item.sizeBytes, 0);

  return (
    <div
      className={
        fillHeight
          ? "flex h-full flex-col overflow-hidden p-2.5 pb-1.25"
          : "overflow-y-auto p-2.5 pb-1.25"
      }
    >
      <div className={`crm-notes-panel ${fillHeight ? "flex min-h-0 flex-1 flex-col" : ""}`}>
        <div
          className={`crm-notes-content text-sm ${fillHeight ? "crm-notes-content-compose" : ""}`}
        >
          {attachments.length === 0 ? (
            <p className="text-xs text-zendesk-muted">No attachments in this conversation yet.</p>
          ) : (
            <div className="space-y-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-zendesk-muted">
                {attachments.length} file{attachments.length === 1 ? "" : "s"}
                {totalBytes > 0 ? ` · ${formatFileSize(totalBytes)}` : ""}
              </p>
              <ul className="space-y-2">
                {attachments.map((item) => (
                  <li
                    key={item.key}
                    className="rounded border border-amber-200 bg-amber-50/50 px-2 py-1.5"
                  >
                    <div className="mb-1 flex items-baseline justify-between gap-2 text-[10px] text-zendesk-muted">
                      <span className="min-w-0 truncate" title={senderLabel(item)}>
                        {senderLabel(item)}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {new Date(item.sentAt).toLocaleString()}
                      </span>
                    </div>
                    <ThreadAttachmentDownloadButton
                      item={{
                        id: item.id,
                        filename: item.filename,
                        sizeBytes: item.sizeBytes,
                        downloadHref: item.downloadHref,
                      }}
                      rowNumber={rowNumber}
                    />
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
