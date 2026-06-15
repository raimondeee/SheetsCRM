"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { clearReplyDraft } from "@/lib/reply-drafts";
import { readFilesAsAttachmentPayload } from "@/lib/outbound-attachments";
import {
  markSendArchiveCancelled,
  markSendArchiveFailed,
  markSendArchiveSent,
  newSendArchiveId,
  recordQueuedSend,
} from "@/lib/send-archive";

import type { QueuedSendPayload } from "@/lib/queued-send";

export type { QueuedSendPayload };

const UNDO_SEND_SECONDS = 10;

interface UsePendingSendQueueOptions {
  onTicketSent: (rowId: string, status: "pending" | "resolved") => Promise<void>;
  onAdvanceAfterSend: (
    rowId: string,
    statusAfterSend: "pending" | "resolved"
  ) => boolean;
  onShowInboxVictory: () => void;
  onRestoreSentTicket: (rowId: string) => void;
  onThreadUpdate: () => void;
}

export function usePendingSendQueue({
  onTicketSent,
  onAdvanceAfterSend,
  onShowInboxVictory,
  onRestoreSentTicket,
  onThreadUpdate,
}: UsePendingSendQueueOptions) {
  const [pendingSend, setPendingSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [undoSecondsLeft, setUndoSecondsLeft] = useState(0);
  const [pendingSendStatus, setPendingSendStatus] = useState<"pending" | "resolved">("pending");
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

  useEffect(() => {
    onTicketSentRef.current = onTicketSent;
    onAdvanceAfterSendRef.current = onAdvanceAfterSend;
    onShowInboxVictoryRef.current = onShowInboxVictory;
    onRestoreSentTicketRef.current = onRestoreSentTicket;
    onThreadUpdateRef.current = onThreadUpdate;
  }, [onTicketSent, onAdvanceAfterSend, onShowInboxVictory, onRestoreSentTicket, onThreadUpdate]);

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
    setQueuedSendLabel(null);
    setQueuedAttachmentCount(0);
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
      const data = await res.json();
      if (!isMountedRef.current) return;
      if (!res.ok || data.error) {
        const message = data.error ?? "Failed to send email";
        if (pendingArchiveIdRef.current) {
          markSendArchiveFailed(pendingArchiveIdRef.current, message);
          pendingArchiveIdRef.current = null;
        }
        setSendError({ rowId: ticketRowId, message });
        onRestoreSentTicketRef.current(ticketRowId);
        return;
      }

      if (pendingArchiveIdRef.current) {
        markSendArchiveSent(pendingArchiveIdRef.current);
        pendingArchiveIdRef.current = null;
      }
      clearReplyDraft(ticketRowId);
      await onTicketSentRef.current(ticketRowId, statusAfterSend);
      if (!isMountedRef.current) return;
      onThreadUpdateRef.current();
      if (showVictoryAfterSend) {
        pendingVictoryRef.current = false;
        onShowInboxVictoryRef.current();
      }
    } catch (error) {
      if (!isMountedRef.current) return;
      const message = error instanceof Error ? error.message : "Failed to send email";
      const rowId = payload.ticketRowId;
      if (pendingArchiveIdRef.current) {
        markSendArchiveFailed(pendingArchiveIdRef.current, message);
        pendingArchiveIdRef.current = null;
      }
      setSendError({ rowId, message });
      onRestoreSentTicketRef.current(rowId);
    } finally {
      if (isMountedRef.current) {
        setSending(false);
        setSendingTicketRowId(null);
      }
    }
  }, []);

  const queueSend = useCallback(
    (payload: QueuedSendPayload) => {
      if (pendingPayloadRef.current || sending) return;

      setSendError(null);
      pendingPayloadRef.current = payload;
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

      const advanced = onAdvanceAfterSendRef.current(
        payload.ticketRowId,
        payload.statusAfterSend
      );
      pendingVictoryRef.current = !advanced;

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
    const queuedRowId = pendingPayloadRef.current?.ticketRowId;
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
    if (queuedRowId) onRestoreSentTicketRef.current(queuedRowId);
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
