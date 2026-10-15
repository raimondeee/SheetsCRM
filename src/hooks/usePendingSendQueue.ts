"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearReplyDraft, saveReplyDraft } from "@/lib/reply-drafts";
import { readFilesAsAttachmentPayload } from "@/lib/outbound-attachments";
import {
  markSendArchiveCancelled,
  markSendArchiveFailed,
  markSendArchiveSent,
  newSendArchiveId,
  recordQueuedSend,
} from "@/lib/send-archive";

import type { QueuedSendPayload, StatusAfterSend } from "@/lib/queued-send";
import type { CloseOutcomeAnswers } from "@/lib/close-outcome";
import { playOutboundSendSound } from "@/lib/notification-sounds";

export type { QueuedSendPayload, StatusAfterSend };

const UNDO_SEND_SECONDS = 10;

async function readSendResponse(res: Response): Promise<{ error?: string }> {
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return {};
  try {
    return (await res.json()) as { error?: string };
  } catch {
    return {};
  }
}

function sendFailureMessage(res: Response, data: { error?: string }, fallback: string): string {
  const raw = typeof data.error === "string" ? data.error.trim() : "";
  const looksTruncated = /unexpected end of json|unterminated string|not valid json/i.test(raw);
  if (raw && !looksTruncated) return raw;
  if (res.status === 413 || looksTruncated) {
    return "This email is too large to send. Try a smaller attachment.";
  }
  if (res.status >= 400) return raw || `Failed to send email (${res.status})`;
  return raw || fallback;
}

interface UsePendingSendQueueOptions {
  onTicketSent: (
    rowId: string,
    status: StatusAfterSend,
    closeOutcome?: CloseOutcomeAnswers
  ) => Promise<void>;
  onAdvanceAfterSend: (rowId: string, statusAfterSend: StatusAfterSend) => boolean;
  onShowInboxVictory: () => void;
  onRestoreSentTicket: (rowId: string, compose?: QueuedSendPayload) => void;
  onThreadUpdate: () => void;
  /** Fires after a successful send (Send only / Pending / Resolved). */
  onSendSucceeded?: (status: StatusAfterSend) => void;
}

export function usePendingSendQueue({
  onTicketSent,
  onAdvanceAfterSend,
  onShowInboxVictory,
  onRestoreSentTicket,
  onThreadUpdate,
  onSendSucceeded,
}: UsePendingSendQueueOptions) {
  const [pendingSend, setPendingSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const [pendingSendStatus, setPendingSendStatus] = useState<StatusAfterSend>("pending");
  const [queuedSendLabel, setQueuedSendLabel] = useState<string | null>(null);
  const [queuedAttachmentCount, setQueuedAttachmentCount] = useState(0);
  const [queuedTicketRowId, setQueuedTicketRowId] = useState<string | null>(null);
  const [sendingTicketRowId, setSendingTicketRowId] = useState<string | null>(null);
  const [sendError, setSendError] = useState<{ rowId: string; message: string } | null>(null);

  const pendingPayloadRef = useRef<QueuedSendPayload | null>(null);
  const pendingArchiveIdRef = useRef<string | null>(null);
  const pendingVictoryRef = useRef(false);
  const sendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMountedRef = useRef(true);

  const onTicketSentRef = useRef(onTicketSent);
  const onAdvanceAfterSendRef = useRef(onAdvanceAfterSend);
  const onShowInboxVictoryRef = useRef(onShowInboxVictory);
  const onRestoreSentTicketRef = useRef(onRestoreSentTicket);
  const onThreadUpdateRef = useRef(onThreadUpdate);
  const onSendSucceededRef = useRef(onSendSucceeded);

  useEffect(() => {
    onTicketSentRef.current = onTicketSent;
    onAdvanceAfterSendRef.current = onAdvanceAfterSend;
    onShowInboxVictoryRef.current = onShowInboxVictory;
    onRestoreSentTicketRef.current = onRestoreSentTicket;
    onThreadUpdateRef.current = onThreadUpdate;
    onSendSucceededRef.current = onSendSucceeded;
  }, [
    onTicketSent,
    onAdvanceAfterSend,
    onShowInboxVictory,
    onRestoreSentTicket,
    onThreadUpdate,
    onSendSucceeded,
  ]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  const executeSend = useCallback(async () => {
    const payload = pendingPayloadRef.current;
    if (!payload) return;

    setSending(true);
    setSendingTicketRowId(payload.ticketRowId);
    setPendingSend(false);
    setUndoSecondsLeft(0);
    setQueuedTicketRowId(null);
    setSendError(null);

    try {
      pendingPayloadRef.current = null;
      const showVictoryAfterSend = pendingVictoryRef.current;
      const { statusAfterSend, ticketRowId, attachmentFiles, intakeTimestamp, label: _label, ...sendBody } =
        payload;
      const attachments =
        attachmentFiles.length > 0
          ? await readFilesAsAttachmentPayload(attachmentFiles)
          : undefined;
      const res = await fetch(`/api/tickets/${encodeURIComponent(ticketRowId)}/thread`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...sendBody,
          status: statusAfterSend,
          intakeTimestamp,
          ...(attachments?.length ? { attachments } : {}),
        }),
      });
      const data = await readSendResponse(res);
      if (!isMountedRef.current) return;
      if (!res.ok || data.error) {
        const message = sendFailureMessage(res, data, "Failed to send email");
        if (pendingArchiveIdRef.current) {
          markSendArchiveFailed(pendingArchiveIdRef.current, message);
          pendingArchiveIdRef.current = null;
        }
        setSendError({ rowId: ticketRowId, message });
        onRestoreSentTicketRef.current(ticketRowId, payload);
        return;
      }

      if (pendingArchiveIdRef.current) {
        markSendArchiveSent(pendingArchiveIdRef.current);
        pendingArchiveIdRef.current = null;
      }
      void clearReplyDraft(ticketRowId);
      await onTicketSentRef.current(ticketRowId, statusAfterSend, payload.closeOutcome);
      onSendSucceededRef.current?.(statusAfterSend);
      if (!isMountedRef.current) return;
      onThreadUpdateRef.current();
      if (showVictoryAfterSend) {
        pendingVictoryRef.current = false;
        onShowInboxVictoryRef.current();
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      let message = error instanceof Error ? error.message : "Failed to send email";
      if (/failed to fetch|networkerror|load failed/i.test(message)) {
        message =
          "Could not send this email. Check your connection, or try a smaller attachment.";
      }
      const rowId = payload.ticketRowId;
      if (pendingArchiveIdRef.current) {
        markSendArchiveFailed(pendingArchiveIdRef.current, message);
        pendingArchiveIdRef.current = null;
      }
      setSendError({ rowId, message });
      onRestoreSentTicketRef.current(rowId, payload);
    } finally {
      if (isMountedRef.current) {
        setSending(false);
        setSendingTicketRowId(null);
        setQueuedSendLabel(null);
        setQueuedAttachmentCount(0);
      }
    }
  }, []);

  const queueSend = useCallback(
    (payload: QueuedSendPayload) => {
      if (pendingPayloadRef.current || sending) return;

      playOutboundSendSound();
      setSendError(null);
      pendingPayloadRef.current = payload;
      // Persist the flushed compose before auto-advance unmounts the editor, so
      // Undo (or a failed send) can reload the exact message that was queued.
      void saveReplyDraft(payload.ticketRowId, {
        body: payload.message,
        subject: payload.subject,
        cc: payload.cc ?? "",
        bcc: payload.bcc ?? "",
      });
      setPendingSendStatus(payload.statusAfterSend);
      setQueuedSendLabel(payload.label);
      setQueuedAttachmentCount(payload.attachmentFiles.length);
      setQueuedTicketRowId(payload.ticketRowId);
      setPendingSend(true);
      setUndoSecondsLeft(UNDO_SEND_SECONDS);

      const archiveId = newSendArchiveId();
      pendingArchiveIdRef.current = archiveId;
      void recordQueuedSend(payload, archiveId).catch(() => {
        /* archive is best-effort */
      });

      if (payload.statusAfterSend === "unchanged") {
        pendingVictoryRef.current = false;
      } else {
        const advanced = onAdvanceAfterSendRef.current(
          payload.ticketRowId,
          payload.statusAfterSend
        );
        pendingVictoryRef.current = !advanced;
      }

      if (countdownRef.current) clearInterval(countdownRef.current);
      countdownRef.current = setInterval(() => {
        setUndoSecondsLeft((seconds) => {
          if (seconds <= 1) {
            if (countdownRef.current) clearInterval(countdownRef.current);
            return 0;
          }
          return seconds - 1;
        });
      }, 1000);

      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      sendTimerRef.current = setTimeout(() => {
        if (countdownRef.current) clearInterval(countdownRef.current);
        void executeSend();
      }, UNDO_SEND_SECONDS * 1000);
    },
    [executeSend, sending]
  );

  const undoSend = useCallback(() => {
    const payload = pendingPayloadRef.current;
    if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (pendingArchiveIdRef.current) {
      markSendArchiveCancelled(pendingArchiveIdRef.current);
      pendingArchiveIdRef.current = null;
    }
    pendingPayloadRef.current = null;
    setPendingSend(false);
    setQueuedSendLabel(null);
    setQueuedAttachmentCount(0);
    setUndoSecondsLeft(0);
    setQueuedTicketRowId(null);
    pendingVictoryRef.current = false;
    if (payload) onRestoreSentTicketRef.current(payload.ticketRowId, payload);
  }, []);

  const clearSendError = useCallback((rowId?: string) => {
    setSendError((current) => {
      if (!current) return null;
      if (rowId && current.rowId !== rowId) return current;
      return null;
    });
  }, []);

  return {
    pendingSend,
    sending,
    sendQueueBusy: pendingSend || sending,
    undoSecondsLeft,
    pendingSendStatus,
    queuedSendLabel,
    queuedAttachmentCount,
    queuedTicketRowId,
    sendingTicketRowId,
    sendError,
    queueSend,
    undoSend,
    clearSendError,
  };
}
