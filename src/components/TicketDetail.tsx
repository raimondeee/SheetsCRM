"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import type { Ticket, ThreadMessage } from "@/lib/types";
import { DEFAULT_STATUSES } from "@/lib/types";
import { buildGmailMessageUrl, buildGmailComposeUrl, openGmailComposePopup } from "@/lib/gmail-urls";
import { buildClaimSalesforceSearchUrl, buildSalesforceUnifiedSearchUrl } from "@/lib/salesforce";
import {
  buildNovaListingUrl,
  buildNovaHostPerformanceUrl,
  buildNovaProfileUrl,
  buildNovaReservationUrl,
} from "@/lib/nova-urls";
import {
  intakeAirbnbUserIdFromTicket,
  resolveSalesforceSearchQuery,
} from "@/lib/airbnb-user-id";
import { ADMIN_LOGOUT_URL, buildBecomeUserUrl, isNumericUserId } from "@/lib/become-user-url";
import type { MarketManager } from "@/lib/market-managers";
import { resolveMarketManagerEmail } from "@/lib/market-managers";
import type { SetupModalTab } from "./SetupModal";
import { MixmaxTemplatePicker, type MixmaxTemplateApplyPayload } from "./MixmaxTemplatePicker";
import { ComposeAttachmentList, ThreadAttachmentList } from "./CollapsibleAttachmentList";
import { SendArchivePanel } from "./SendArchivePanel";
import { TrustEscalationsModal } from "./TrustEscalationsModal";
import { RedactMessageConfirmModal } from "./RedactMessageConfirmModal";
import { ResetGmailLinkConfirmModal } from "./ResetGmailLinkConfirmModal";
import { LinkedCaseEditModal } from "./LinkedCaseEditModal";
import { ReplyDraftEditor, type ReplyDraftEditorHandle } from "./ReplyDraftEditor";
import { ThreadMessageBody } from "./ThreadMessageBody";
import { EmailRecipientInput } from "./EmailRecipientInput";
import {
  buildEmailSubject,
  EMAIL_SUBJECT_PREFIX,
  emailSubjectSuffixFromStored,
  isEmailSubjectSuffixFilled,
  stripEmailSubjectPrefix,
} from "@/lib/email-subject";
import { isRichTextEmpty, normalizeDraftHtml, plainTextToHtml, stripHtmlToText } from "@/lib/html-utils";
import { parseFirstName } from "@/lib/mixmax-variables";
import { shouldShowResponseSla } from "@/lib/sla-display";
import {
  PENDING_WITHOUT_EMAIL_HOURS_OPTIONS,
  pendingWithoutEmailAdminNote,
  RESOLVED_WITHOUT_EMAIL_NOTE,
  type PendingWithoutEmailHours,
} from "@/lib/admin-notes";
import {
  REQUIRED_FIELD_MISSING_MESSAGE,
  hasAirbnbUserIdForResolve,
  type TicketActionRequiredField,
  type TicketActionValidation,
} from "@/lib/ticket-action-validation";
import {
  MAX_OUTBOUND_ATTACHMENTS,
} from "@/lib/gmail-attachments";
import {
  validateReplyAttachmentFiles,
} from "@/lib/outbound-attachments";
import { activeExternalTools, type ExternalToolLink } from "@/lib/external-tools";
import { buildSheetCellUrl } from "@/lib/sheet-urls";
import {
  parseLinkedCase,
} from "@/lib/linked-cases";
import { threadLinkNoticeNeedsBackfill } from "@/lib/gmail-thread-link";
import {
  formatConversationForClipboard,
  buildGleanServiceChatUrl,
  GLEAN_THREAD_SUMMARY_PROMPT,
  GLEAN_RESPONSE_PROMPT,
  GLEAN_ESCALATION_PROMPT,
} from "@/lib/conversation-export";
import { normalizeStatusId } from "@/lib/status-mapper";
import {
  formatCrmRowRef,
  logCrmError,
  logCrmTiming,
} from "@/lib/crm-debug-log";
import { CrmTicketLogPanel } from "./CrmTicketLogPanel";
import { usePersistedBoolean } from "@/hooks/usePersistedBoolean";
import { loadReplyDraft, saveReplyDraft } from "@/lib/reply-drafts";
import {
  clearAdminNoteDraft,
  loadAdminNoteDraft,
  saveAdminNoteDraft,
} from "@/lib/admin-note-drafts";
import type { QueuedSendPayload } from "@/lib/queued-send";
import { fetchComposePrefs, saveComposePrefs } from "@/lib/ticket-compose-prefs";
import {
  appendRecipient,
  buildOutboundBcc,
  buildOutboundCc,
  deriveThreadCcRecipients,
  mergeRecipientLists,
  parseRecipientList,
  removeRecipient,
} from "@/lib/email-recipients";
import {
  ArrowDownToLine,
  ArrowUpToLine,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  Copy,
  ExternalLink,
  Link2Off,
  LineChart,
  Loader2,
  LogOut,
  Mail,
  Maximize2,
  Minimize2,
  PanelRightClose,
  Pencil,
  CircleCheck,
  Paperclip,
  Send,
  Sparkles,
  ShieldAlert,
  Undo2,
  UserRound,
  Wrench,
  X,
} from "lucide-react";
type ComposePanelView = "split" | "draft-full" | "conversation-full";

interface TicketDetailProps {
  ticket: Ticket | null;
  initialResponseHours: number;
  contactReasonOptions: string[];
  onStatusChange: (rowId: string, status: string) => Promise<void>;
  onSubjectChange: (rowId: string, subject: string) => void | Promise<void>;
  onContactReasonChange: (rowId: string, contactReason: string) => void;
  onAppendAdminNote: (rowId: string, note: string) => Promise<void>;
  onAdminNotesChange?: (rowId: string, adminNotes: string) => void;
  onAirbnbUserIdChange: (rowId: string, airbnbUserId: string) => Promise<void>;
  onReservationCodeChange: (rowId: string, reservationCode: string) => Promise<void>;
  onClaimNumberChange: (rowId: string, claimNumber: string) => Promise<void>;
  onListingIdChange: (rowId: string, listingId: string) => Promise<void>;
  onSlaChange: (rowId: string, hours: number) => void;
  onClearInitialResponseSla: (rowId: string) => Promise<void>;
  onResyncFromSheet?: (rowId: string) => Promise<void>;
  onIgnoreCoverTicket?: (rowId: string) => Promise<void>;
  onThreadUpdate: () => void;
  onGmailLinkChange: (rowId: string, gmailOpenUrl: string | null) => void;
  onForceNewGmailThreadChange?: (rowId: string, enabled: boolean) => void;
  sendQueueBusy?: boolean;
  isSending?: boolean;
  sendError?: string | null;
  onQueueSend: (payload: QueuedSendPayload) => void;
  pendingSendUndo?: {
    active: boolean;
    secondsLeft: number;
    label: string | null;
    status: "pending" | "resolved" | "unchanged";
    attachmentCount: number;
    onUndo: () => void;
  };
  composeClearedRowId?: string | null;
  onClearSendError?: () => void;
  onSetStatusWithoutEmail: (
    rowId: string,
    status: string,
    options?: { adminNote?: string; pendingHours?: number; airbnbUserId?: string; closeTicket?: boolean }
  ) => Promise<void>;
  onLinkedCaseChange: (rowId: string, index: 0 | 1 | 2, url: string) => Promise<void>;
  externalTools?: ExternalToolLink[];
  ticketUiFields?: { slotId: string; label: string; value: string }[];
  onUiFieldChange?: (rowId: string, slotId: string, value: string) => Promise<void>;
  columnLabels?: {
    airbnbUserId?: string | null;
    columnD?: string | null;
    reservationCode?: string | null;
    claimNumber?: string | null;
    listingId?: string | null;
  };
  onOpenSetup?: (tab?: SetupModalTab) => void;
  marketManagersVersion?: number;
  sheetUrl?: string | null;
}

function attachmentIdsKey(message: ThreadMessage): string {
  return (message.attachments ?? []).map((att) => att.id).join("\0");
}

function threadMessagesLookEqual(a: ThreadMessage[], b: ThreadMessage[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i]!;
    const right = b[i]!;
    if (
      left.id !== right.id ||
      left.body !== right.body ||
      left.direction !== right.direction ||
      left.sentAt !== right.sentAt ||
      left.subject !== right.subject ||
      left.from !== right.from ||
      left.to !== right.to ||
      left.cc !== right.cc ||
      attachmentIdsKey(left) !== attachmentIdsKey(right)
    ) {
      return false;
    }
  }
  return true;
}

function isSelectingInside(container: HTMLElement | null): boolean {
  if (!container) return false;
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return false;
  if (!selection.toString()) return false;
  const anchor = selection.anchorNode;
  return Boolean(anchor && container.contains(anchor));
}

export function TicketDetail({
  ticket,
  initialResponseHours,
  contactReasonOptions,
  onStatusChange,
  onSubjectChange,
  onContactReasonChange,
  onAppendAdminNote,
  onAdminNotesChange,
  onAirbnbUserIdChange,
  onReservationCodeChange,
  onClaimNumberChange,
  onListingIdChange,
  onSlaChange,
  onClearInitialResponseSla,
  onResyncFromSheet,
  onIgnoreCoverTicket,
  onThreadUpdate,
  onGmailLinkChange,
  onForceNewGmailThreadChange,
  sendQueueBusy = false,
  isSending = false,
  sendError = null,
  onQueueSend,
  pendingSendUndo,
  composeClearedRowId = null,
  onClearSendError,
  onSetStatusWithoutEmail,
  onLinkedCaseChange,
  externalTools = [],
  ticketUiFields = [],
  onUiFieldChange,
  columnLabels,
  onOpenSetup,
  marketManagersVersion = 0,
  sheetUrl = null,
}: TicketDetailProps) {
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [redactingMessageId, setRedactingMessageId] = useState<string | null>(null);
  const [redactConfirmMessage, setRedactConfirmMessage] = useState<ThreadMessage | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [subjectSuffix, setSubjectSuffix] = useState("");
  const [actionValidation, setActionValidation] = useState<TicketActionValidation | null>(null);
  const [pressedActionButton, setPressedActionButton] = useState<string | null>(null);
  const [newAdminNote, setNewAdminNote] = useState("");
  const [addingNote, setAddingNote] = useState(false);
  const [adminNoteError, setAdminNoteError] = useState<string | null>(null);
  const [airbnbUserIdDraft, setAirbnbUserIdDraft] = useState("");
  const [uiFieldDrafts, setUiFieldDrafts] = useState<Record<string, string>>({});
  const [emailCopied, setEmailCopied] = useState(false);
  const [conversationCopied, setConversationCopied] = useState(false);
  const [gleanOpenedKind, setGleanOpenedKind] = useState<
    "summary" | "response" | "escalation" | null
  >(null);
  const [savingUserId, setSavingUserId] = useState(false);
  const replyEditorRef = useRef<ReplyDraftEditorHandle>(null);
  const conversationPanelRef = useRef<HTMLDivElement>(null);
  const shouldScrollConversationToNewestRef = useRef(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const [replyAttachments, setReplyAttachments] = useState<Array<{ id: string; file: File }>>(
    []
  );
  const [attachmentsJustAdded, setAttachmentsJustAdded] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const [mixmaxAttachmentsLoading, setMixmaxAttachmentsLoading] = useState(false);
  const [ccMarketManager, setCcMarketManager] = useState(false);
  const [ccDraft, setCcDraft] = useState("");
  const [bccDraft, setBccDraft] = useState("");
  const [ccFieldOpen, setCcFieldOpen] = useState(false);
  const [bccFieldOpen, setBccFieldOpen] = useState(false);
  const ccFieldRef = useRef<HTMLDivElement>(null);
  const bccFieldRef = useRef<HTMLDivElement>(null);
  const [replyFocused, setReplyFocused] = useState(false);
  const [composeTab, setComposeTab] = useState<"reply" | "admin-notes" | "crm-log">("reply");
  const [composePanelView, setComposePanelView] = useState<ComposePanelView>("split");
  const [markingStatusOnly, setMarkingStatusOnly] = useState<string | null>(null);
  const [markingPendingHours, setMarkingPendingHours] = useState<number | null>(null);
  const [pendingMenuOpen, setPendingMenuOpen] = useState(false);
  const pendingMenuRef = useRef<HTMLDivElement>(null);
  const [statusOnlyError, setStatusOnlyError] = useState<string | null>(null);
  const [statusChangeError, setStatusChangeError] = useState<string | null>(null);
  const [statusChanging, setStatusChanging] = useState(false);
  const [mixmaxExpanded, setMixmaxExpanded] = useState(false);
  const [sendArchiveExpanded, setSendArchiveExpanded] = useState(false);
  const [trustEscalationsOpen, setTrustEscalationsOpen] = useState(false);
  const internalToolsOverlayOpen = mixmaxExpanded || sendArchiveExpanded;
  const [headerDetailsOpen, setHeaderDetailsOpen] = usePersistedBoolean(
    "crm.ticketHeaderDetailsOpen",
    false
  );
  const [internalToolsCollapsed, setInternalToolsCollapsed] = usePersistedBoolean(
    "crm.internalToolsCollapsed",
    false
  );
  const [marketManagers, setMarketManagers] = useState<MarketManager[]>([]);
  const [marketManagersLoaded, setMarketManagersLoaded] = useState(false);
  const [clearingInitialSla, setClearingInitialSla] = useState(false);
  const [resyncConfirmOpen, setResyncConfirmOpen] = useState(false);
  const [resyncingFromSheet, setResyncingFromSheet] = useState(false);
  const [ignoreConfirmOpen, setIgnoreConfirmOpen] = useState(false);
  const [ignoringCoverTicket, setIgnoringCoverTicket] = useState(false);
  const [ignoreCoverError, setIgnoreCoverError] = useState<string | null>(null);
  const [resyncError, setResyncError] = useState<string | null>(null);

  useEffect(() => {
    setResyncConfirmOpen(false);
    setResyncError(null);
  }, [ticket?.rowId]);

  useEffect(() => {
    if (!attachmentsJustAdded) return;
    const timer = window.setTimeout(() => setAttachmentsJustAdded(false), 3000);
    return () => window.clearTimeout(timer);
  }, [attachmentsJustAdded, replyAttachments.length]);

  const [userIdSaveError, setUserIdSaveError] = useState<string | null>(null);
  const airbnbUserIdFieldRef = useRef<HTMLLIElement>(null);
  const [gmailOpenUrl, setGmailOpenUrl] = useState<string | null>(null);
  const [forceNewGmailThreadOnSend, setForceNewGmailThreadOnSend] = useState(false);
  const [resetGmailLinkConfirmOpen, setResetGmailLinkConfirmOpen] = useState(false);
  const [resettingGmailLink, setResettingGmailLink] = useState(false);
  const [backfillingLinkNoticeId, setBackfillingLinkNoticeId] = useState<string | null>(null);
  const threadLoadGenerationRef = useRef(0);
  const isMountedRef = useRef(true);
  const onThreadUpdateRef = useRef(onThreadUpdate);
  const onGmailLinkChangeRef = useRef(onGmailLinkChange);
  const onForceNewGmailThreadChangeRef = useRef(onForceNewGmailThreadChange);
  const replyBodyRef = useRef(replyBody);
  const subjectSuffixRef = useRef(subjectSuffix);
  const ccDraftRef = useRef(ccDraft);
  const bccDraftRef = useRef(bccDraft);
  const newAdminNoteRef = useRef(newAdminNote);
  const ticketRowIdRef = useRef(ticket?.rowId ?? null);
  const replyAttachmentsCountRef = useRef(0);

  useEffect(() => {
    replyBodyRef.current = replyBody;
    subjectSuffixRef.current = subjectSuffix;
    ccDraftRef.current = ccDraft;
    bccDraftRef.current = bccDraft;
    newAdminNoteRef.current = newAdminNote;
    ticketRowIdRef.current = ticket?.rowId ?? null;
  }, [replyBody, subjectSuffix, ccDraft, bccDraft, newAdminNote, ticket?.rowId]);

  useEffect(() => {
    replyAttachmentsCountRef.current = replyAttachments.length;
  }, [replyAttachments.length]);

  useEffect(() => {
    onThreadUpdateRef.current = onThreadUpdate;
  }, [onThreadUpdate]);

  useEffect(() => {
    onGmailLinkChangeRef.current = onGmailLinkChange;
  }, [onGmailLinkChange]);

  useEffect(() => {
    onForceNewGmailThreadChangeRef.current = onForceNewGmailThreadChange;
  }, [onForceNewGmailThreadChange]);

  useEffect(() => {
    setForceNewGmailThreadOnSend(ticket?.forceNewGmailThreadOnSend ?? false);
  }, [ticket?.rowId, ticket?.forceNewGmailThreadOnSend]);

  useEffect(() => {
    let cancelled = false;
    setMarketManagersLoaded(false);
    (async () => {
      try {
        const res = await fetch("/api/market-managers");
        const data = await res.json();
        if (!cancelled && !data.error) {
          setMarketManagers(data.managers ?? []);
        }
      } finally {
        if (!cancelled) setMarketManagersLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [marketManagersVersion]);

  useEffect(() => {
    if (!pendingMenuOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (pendingMenuRef.current?.contains(event.target as Node)) return;
      setPendingMenuOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [pendingMenuOpen]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, [ticket?.rowId]);

  const loadThread = useCallback(
    async (reason: "ticket-open" | "timer" | "admin-note") => {
      if (!ticket) return;
      const generation = threadLoadGenerationRef.current;
      const ticketRowId = ticket.rowId;
      const rowNumber = ticket.rowNumber;
      const storedGmailUrl = ticket.gmailOpenUrl;
      if (reason !== "timer") {
        setThreadLoading(true);
      }
      const params = new URLSearchParams({
        email: ticket.requesterEmail,
        subject: ticket.subject,
        timestamp: ticket.timestamp,
      });
      const started = performance.now();
      try {
        const res = await fetch(
          `/api/tickets/${encodeURIComponent(ticketRowId)}/thread?${params.toString()}&_=${Date.now()}`,
          { cache: "no-store", credentials: "same-origin" }
        );
        const data = await res.json();
        const duration = performance.now() - started;
        if (generation !== threadLoadGenerationRef.current) return;

        const messageCount = Array.isArray(data.messages) ? data.messages.length : 0;
        const awaitingNewThread =
          data.forceNewGmailThreadOnSend === true || ticket.forceNewGmailThreadOnSend;
        const nextUrl = awaitingNewThread
          ? null
          : (typeof data.gmailOpenUrl === "string" ? data.gmailOpenUrl : null) ??
            storedGmailUrl;
        const detailParts = [
          formatCrmRowRef(rowNumber, ticketRowId),
          reason,
          `HTTP ${res.status}`,
          `${messageCount} msgs`,
          awaitingNewThread
            ? "awaiting new Gmail thread"
            : nextUrl
              ? "Gmail linked"
              : "no Gmail link",
        ];
        if (typeof data.warning === "string" && data.warning.trim()) {
          detailParts.push(data.warning.trim());
        }
        if (data.statusReopened) detailParts.push("status reopened");

        const detail = detailParts.join(" · ");
        const shouldLog =
          reason === "ticket-open" ||
          duration > 1000 ||
          Boolean(data.warning) ||
          Boolean(data.statusReopened) ||
          !res.ok;

        if (!res.ok) {
          logCrmError("Thread sync failed", detail);
        } else if (shouldLog) {
          logCrmTiming("Thread sync", duration, detail);
        }

        const loadedMessages = (data.messages ?? []) as ThreadMessage[];
        // Avoid rewriting conversation DOM while the agent is selecting text (timer sync),
        // and skip setState when content is unchanged so selection doesn't jump.
        const selectingConversation = isSelectingInside(conversationPanelRef.current);
        if (!(reason === "timer" && selectingConversation)) {
          setMessages((prev) =>
            threadMessagesLookEqual(prev, loadedMessages) ? prev : loadedMessages
          );
        }
        if (loadedMessages.length > 0 && !(reason === "timer" && selectingConversation)) {
          const threadCc = deriveThreadCcRecipients(loadedMessages, {
            requesterEmail: ticket.requesterEmail,
          });
          if (threadCc) {
            setCcDraft((prev) => mergeRecipientLists(prev, threadCc));
            setCcFieldOpen(true);
          }
        }
        setGmailOpenUrl(nextUrl);
        setForceNewGmailThreadOnSend(awaitingNewThread);
        if (nextUrl && nextUrl !== storedGmailUrl) {
          onGmailLinkChangeRef.current(ticketRowId, nextUrl);
        }
        if (awaitingNewThread !== ticket.forceNewGmailThreadOnSend) {
          onForceNewGmailThreadChangeRef.current?.(ticketRowId, awaitingNewThread);
        }
        if (data.statusReopened) onThreadUpdateRef.current();
      } catch (error) {
        if (generation !== threadLoadGenerationRef.current) return;
        setGmailOpenUrl(storedGmailUrl);
        logCrmError(
          "Thread sync failed",
          `${formatCrmRowRef(rowNumber, ticketRowId)} · ${reason} — ${
            error instanceof Error ? error.message : "network error"
          }`
        );
      } finally {
        if (generation === threadLoadGenerationRef.current) {
          setThreadLoading(false);
        }
      }
    },
    [ticket?.rowId, ticket?.rowNumber, ticket?.requesterEmail, ticket?.subject, ticket?.gmailOpenUrl, ticket?.forceNewGmailThreadOnSend]
  );

  useLayoutEffect(() => {
    threadLoadGenerationRef.current += 1;
    shouldScrollConversationToNewestRef.current = true;
    setMessages([]);
    setThreadLoading(Boolean(ticket?.rowId));
  }, [ticket?.rowId]);

  useEffect(() => {
    setGmailOpenUrl(ticket?.gmailOpenUrl ?? null);
    setForceNewGmailThreadOnSend(ticket?.forceNewGmailThreadOnSend ?? false);
  }, [ticket?.rowId, ticket?.gmailOpenUrl, ticket?.forceNewGmailThreadOnSend]);

  useEffect(() => {
    if (!ticket) {
      setMessages([]);
      setThreadLoading(false);
      setGmailOpenUrl(null);
      setReplyBody("");
      setSubjectSuffix("");
      setNewAdminNote("");
      setAddingNote(false);
      setAdminNoteError(null);
      setAirbnbUserIdDraft("");
      setUiFieldDrafts({});
      setEmailCopied(false);
      setReplyFocused(false);
      setComposeTab("reply");
      setComposePanelView("split");
      setReplyAttachments([]);
      setAttachmentError(null);
      setMixmaxAttachmentsLoading(false);
      setCcDraft("");
      setBccDraft("");
      setCcFieldOpen(false);
      setBccFieldOpen(false);
      setCcMarketManager(false);
      return;
    }

    setComposeTab("reply");
    setComposePanelView("split");
    setMixmaxExpanded(false);
    setReplyAttachments([]);
    setAttachmentError(null);
    setMixmaxAttachmentsLoading(false);
    setAddingNote(false);
    setAdminNoteError(null);
    setSavingUserId(false);
    setMarkingStatusOnly(null);
    setStatusChanging(false);
    setClearingInitialSla(false);
    setStatusOnlyError(null);
    onClearSendError?.();
    setStatusChangeError(null);
    const saved = loadReplyDraft(ticket.rowId);
    setReplyBody(saved?.body ? normalizeDraftHtml(saved.body) : "");
    setNewAdminNote(loadAdminNoteDraft(ticket.rowId) ?? "");
    setSubjectSuffix(
      ticket.forceNewGmailThreadOnSend
        ? saved?.subject
          ? emailSubjectSuffixFromStored(saved.subject)
          : ""
        : saved?.subject
          ? emailSubjectSuffixFromStored(saved.subject)
          : emailSubjectSuffixFromStored(ticket.subject)
    );
    setActionValidation(null);
    setPressedActionButton(null);
    setCcDraft(saved?.cc ?? "");
    setBccDraft(saved?.bcc ?? "");
    setCcFieldOpen(Boolean(saved?.cc?.trim()));
    setBccFieldOpen(Boolean(saved?.bcc?.trim()));
    void fetchComposePrefs(ticket.rowId).then((prefs) => {
      setCcMarketManager(prefs.ccMarketManager);
    });
    setAirbnbUserIdDraft(ticket.crmAirbnbUserId ?? "");
    setUiFieldDrafts(ticket.uiFields ?? {});
    setEmailCopied(false);
    setReplyFocused(Boolean(saved?.body && !isRichTextEmpty(saved.body)));
  }, [ticket?.rowId]);

  useEffect(() => {
    if (!ticket || composeClearedRowId !== ticket.rowId) return;
    setReplyBody("");
    setReplyAttachments([]);
    setAttachmentError(null);
    setMixmaxAttachmentsLoading(false);
    setCcDraft("");
    setBccDraft("");
    setCcFieldOpen(false);
    setBccFieldOpen(false);
    setSubjectSuffix(emailSubjectSuffixFromStored(ticket.subject));
    setReplyFocused(false);
  }, [composeClearedRowId, ticket?.rowId, ticket?.subject]);

  useEffect(() => {
    if (!ticket) return;
    setAirbnbUserIdDraft(ticket.crmAirbnbUserId ?? "");
    setUserIdSaveError(null);
  }, [ticket?.rowId, ticket?.airbnbUserId]);

  useEffect(() => {
    if (!ticket) return;
    setUiFieldDrafts(ticket.uiFields ?? {});
  }, [ticket?.rowId, ticket?.uiFields]);

  useEffect(() => {
    if (!ticket) return;
    void loadThread("ticket-open");
  }, [ticket?.rowId, ticket?.requesterEmail, ticket?.subject, loadThread]);

  useEffect(() => {
    if (!ticket) return;

    const timeout = setTimeout(() => {
      saveReplyDraft(ticket.rowId, {
        body: normalizeDraftHtml(replyBody),
        subject: buildEmailSubject(subjectSuffix),
        cc: ccDraft,
        bcc: bccDraft,
      });
    }, 300);

    return () => {
      clearTimeout(timeout);
      saveReplyDraft(ticket.rowId, {
        body: normalizeDraftHtml(replyBody),
        subject: buildEmailSubject(subjectSuffix),
        cc: ccDraft,
        bcc: bccDraft,
      });
    };
  }, [ticket?.rowId, replyBody, subjectSuffix, ccDraft, bccDraft]);

  useEffect(() => {
    if (!ticket) return;

    const timeout = setTimeout(() => {
      saveAdminNoteDraft(ticket.rowId, newAdminNote);
    }, 300);

    return () => {
      clearTimeout(timeout);
      saveAdminNoteDraft(ticket.rowId, newAdminNote);
    };
  }, [ticket?.rowId, newAdminNote]);

  useEffect(() => {
    if (!ticket) return;

    function flushDraftsToStorage() {
      // Prefer live editor HTML — React replyBodyRef can lag behind contentEditable.
      const flushed = replyEditorRef.current?.flush();
      const body = normalizeDraftHtml(flushed ?? replyBodyRef.current);
      replyBodyRef.current = body;
      const rowId = ticketRowIdRef.current;
      if (!rowId) return;
      saveReplyDraft(rowId, {
        body,
        subject: buildEmailSubject(subjectSuffixRef.current),
        cc: ccDraftRef.current,
        bcc: bccDraftRef.current,
      });
      saveAdminNoteDraft(rowId, newAdminNoteRef.current);
    }

    function hasUnsavedComposeWork(): boolean {
      const flushed = replyEditorRef.current?.flush();
      const body = normalizeDraftHtml(flushed ?? replyBodyRef.current);
      replyBodyRef.current = body;
      return (
        !isRichTextEmpty(body) ||
        replyAttachmentsCountRef.current > 0 ||
        Boolean(ccDraftRef.current.trim()) ||
        Boolean(bccDraftRef.current.trim())
      );
    }

    function onPageHide() {
      flushDraftsToStorage();
    }

    function onVisibilityChange() {
      if (document.visibilityState === "hidden") flushDraftsToStorage();
    }

    function onBeforeUnload(event: BeforeUnloadEvent) {
      flushDraftsToStorage();
      if (!hasUnsavedComposeWork()) return;
      // Browser shows a generic leave confirmation (Sheets-style).
      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("pagehide", onPageHide);
    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("pagehide", onPageHide);
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [ticket?.rowId]);

  useEffect(() => {
    if (!ticket) return;
    const intervalMs =
      (Number(process.env.NEXT_PUBLIC_AUTO_REFRESH_SECONDS) || 60) * 1000;
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void loadThread("timer");
    }, intervalMs);
    return () => clearInterval(id);
  }, [ticket?.rowId, loadThread]);

  const gmailThreadUrl = gmailOpenUrl;
  const awaitingNewGmailThread = forceNewGmailThreadOnSend;
  const showResetGmailLinkButton = Boolean(
    gmailThreadUrl ||
      ticket?.gmailLinkArchivedAt ||
      messages.some(
        (m) =>
          (m.direction === "inbound" || m.direction === "outbound") &&
          Boolean(m.gmailMessageId || m.gmailThreadId)
      )
  );

  const marketManagerEmail = useMemo(
    () => (ticket ? resolveMarketManagerEmail(ticket.marketManager, marketManagers) : null),
    [ticket, marketManagers]
  );

  const sheetRowUrl = useMemo(() => {
    if (!ticket || !sheetUrl) return null;
    return buildSheetCellUrl(sheetUrl, ticket.rowNumber, "C");
  }, [ticket, sheetUrl]);

  const marketManagerMissingFromDirectory = Boolean(
    marketManagersLoaded && ticket?.marketManager.trim() && !marketManagerEmail
  );

  const contactReasonSelectOptions = useMemo(() => {
    const options = new Set(contactReasonOptions);
    if (ticket?.contactReason.trim()) options.add(ticket.contactReason.trim());
    return [...options].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [contactReasonOptions, ticket?.contactReason]);

  useLayoutEffect(() => {
    if (!shouldScrollConversationToNewestRef.current) return;
    if (threadLoading) return;
    const container = conversationPanelRef.current;
    if (!container) {
      shouldScrollConversationToNewestRef.current = false;
      return;
    }
    const lastId = messages[messages.length - 1]?.id;
    const escaped = lastId
      ? typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(lastId)
        : lastId.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
      : null;
    const target = escaped
      ? container.querySelector<HTMLElement>(`[data-thread-msg-id="${escaped}"]`)
      : container.querySelector<HTMLElement>("[data-original-request]");
    if (target) {
      const containerRect = container.getBoundingClientRect();
      const elementRect = target.getBoundingClientRect();
      const nextTop = container.scrollTop + (elementRect.top - containerRect.top);
      container.scrollTo({ top: Math.max(0, nextTop), behavior: "auto" });
    }
    shouldScrollConversationToNewestRef.current = false;
  }, [messages, threadLoading, ticket?.rowId]);

  if (!ticket) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zendesk-muted">
        Select a ticket to view details
      </main>
    );
  }

  async function saveSubject() {
    if (!ticket) return;
    const fullSubject = buildEmailSubject(subjectSuffix);
    if (!subjectSuffix.trim() || fullSubject === ticket.subject) return;
    onSubjectChange(ticket.rowId, fullSubject);
  }

  async function addAdminNote() {
    if (!ticket || !newAdminNote.trim() || addingNote) return;
    const ticketRowId = ticket.rowId;
    setAddingNote(true);
    setAdminNoteError(null);
    try {
      await onAppendAdminNote(ticketRowId, newAdminNote.trim());
      if (ticket?.rowId !== ticketRowId) return;
      clearAdminNoteDraft(ticketRowId);
      setNewAdminNote("");
      await loadThread("admin-note");
    } catch (error) {
      if (ticket?.rowId !== ticketRowId) return;
      setAdminNoteError(
        error instanceof Error ? error.message : "Failed to add admin note"
      );
    } finally {
      if (ticket?.rowId === ticketRowId) {
        setAddingNote(false);
      }
    }
  }

  async function copyConversationToClipboard() {
    if (!ticket) return;
    const text = formatConversationForClipboard({ ticket, messages });
    try {
      await navigator.clipboard.writeText(text);
      setConversationCopied(true);
      window.setTimeout(() => setConversationCopied(false), 2000);
    } catch {
      window.alert("Could not copy conversation to clipboard.");
    }
  }

  async function openGleanWithPrompt(
    prompt: string,
    kind: "summary" | "response" | "escalation"
  ) {
    if (!ticket) return;
    const thread = formatConversationForClipboard({ ticket, messages });
    const gleanUrl = buildGleanServiceChatUrl(prompt);

    try {
      await navigator.clipboard.writeText(thread);
    } catch {
      window.alert("Could not copy conversation to clipboard.");
      return;
    }

    const popup = window.open(gleanUrl, "_blank", "noopener,noreferrer");
    if (!popup) {
      window.alert(
        "Your browser blocked the Glean popup. Allow popups for SheetsCRM and try again."
      );
      return;
    }

    setGleanOpenedKind(kind);
    window.setTimeout(() => setGleanOpenedKind(null), 2000);
  }

  async function saveAirbnbUserId() {
    if (!ticket) return;
    const trimmed = airbnbUserIdDraft.trim();
    if (trimmed === (ticket.crmAirbnbUserId ?? "").trim()) return;
    setSavingUserId(true);
    setUserIdSaveError(null);
    try {
      await onAirbnbUserIdChange(ticket.rowId, trimmed);
    } catch (error) {
      setUserIdSaveError(error instanceof Error ? error.message : "Failed to save user ID");
    } finally {
      setSavingUserId(false);
    }
  }

  function handleAttachmentPick(event: ChangeEvent<HTMLInputElement>) {
    const picked = [...(event.target.files ?? [])];
    event.target.value = "";
    if (picked.length === 0) return;

    const existingFiles = replyAttachments.map((entry) => entry.file);
    const { accepted, error } = validateReplyAttachmentFiles(existingFiles, picked);
    if (error) {
      setAttachmentError(error);
      return;
    }

    setAttachmentError(null);
    setReplyAttachments((prev) => [
      ...prev,
      ...accepted.map((file) => ({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        file,
      })),
    ]);
    setAttachmentsJustAdded(true);
    clearActionFieldError("compose");
  }

  function removeReplyAttachment(id: string) {
    setReplyAttachments((prev) => prev.filter((entry) => entry.id !== id));
    setAttachmentError(null);
  }

  const subjectReady = isEmailSubjectSuffixFilled(subjectSuffix);
  const hasComposeContent = !isRichTextEmpty(replyBody) || replyAttachments.length > 0;
  const subjectFieldError = actionValidation?.fields.includes("subject") ?? false;
  const composeFieldError = actionValidation?.fields.includes("compose") ?? false;
  const airbnbUserIdFieldError = actionValidation?.fields.includes("airbnbUserId") ?? false;

  const ACTION_BUTTON_PRESS_MS = 180;

  function flashActionPress(buttonId: string) {
    setPressedActionButton(buttonId);
    window.setTimeout(() => {
      setPressedActionButton((current) => (current === buttonId ? null : current));
    }, ACTION_BUTTON_PRESS_MS);
  }

  function actionButtonClass(buttonId: string, baseClass: string) {
    const pressed = pressedActionButton === buttonId;
    return `${baseClass} crm-action-button${pressed ? " crm-action-button-pressed" : ""}`;
  }

  function clearActionFieldError(field: TicketActionRequiredField) {
    setActionValidation((current) => {
      if (!current?.fields.includes(field)) return current;
      const fields = current.fields.filter((item) => item !== field);
      return fields.length ? { ...current, fields } : null;
    });
  }

  function getManualAirbnbUserId(): string {
    return airbnbUserIdDraft.trim() || ticket?.crmAirbnbUserId?.trim() || "";
  }

  function getEffectiveAirbnbUserId(): string {
    if (!ticket) return "";
    const manual = getManualAirbnbUserId();
    if (manual) return manual;
    return intakeAirbnbUserIdFromTicket(ticket);
  }

  function collectSendValidation(): TicketActionValidation | null {
    const fields: TicketActionRequiredField[] = [];
    if (!subjectReady) fields.push("subject");
    if (!hasComposeContent) fields.push("compose");
    if (!fields.length) return null;
    return { message: REQUIRED_FIELD_MISSING_MESSAGE, fields };
  }

  function collectResolvedValidation(): TicketActionValidation | null {
    if (hasAirbnbUserIdForResolve(getEffectiveAirbnbUserId())) return null;
    return {
      message: REQUIRED_FIELD_MISSING_MESSAGE,
      fields: ["airbnbUserId"],
    };
  }

  function collectSendResolvedValidation(): TicketActionValidation | null {
    const fields = new Set<TicketActionRequiredField>();
    for (const field of collectSendValidation()?.fields ?? []) fields.add(field);
    for (const field of collectResolvedValidation()?.fields ?? []) fields.add(field);
    if (!fields.size) return null;
    return { message: REQUIRED_FIELD_MISSING_MESSAGE, fields: [...fields] };
  }

  function showActionValidation(validation: TicketActionValidation) {
    setActionValidation(validation);
    if (validation.fields.includes("airbnbUserId")) {
      airbnbUserIdFieldRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
    if (validation.fields.includes("compose") && composeTab !== "reply") {
      switchComposeTab("reply");
    }
  }

  async function ensureAirbnbUserIdBeforeResolve(): Promise<boolean> {
    if (!ticket) return false;
    const effective = getEffectiveAirbnbUserId();
    if (!hasAirbnbUserIdForResolve(effective)) return false;
    setSavingUserId(true);
    setUserIdSaveError(null);
    try {
      await onAirbnbUserIdChange(ticket.rowId, effective);
    } catch (error) {
      setUserIdSaveError(error instanceof Error ? error.message : "Failed to save user ID");
      return false;
    } finally {
      setSavingUserId(false);
    }
    return true;
  }

  async function setStatusWithoutEmail(
    status: "pending" | "resolved",
    options?: { adminNote?: string; pendingHours?: PendingWithoutEmailHours; closeTicket?: boolean },
    buttonId?: string
  ) {
    if (buttonId) flashActionPress(buttonId);
    if (!ticket || markingStatusOnly || markingPendingHours !== null || sendQueueBusy) {
      return;
    }
    if (status === "resolved") {
      const validation = collectResolvedValidation();
      if (validation) {
        showActionValidation(validation);
        return;
      }
      const saved = await ensureAirbnbUserIdBeforeResolve();
      if (!saved) {
        const retryValidation = collectResolvedValidation();
        if (retryValidation) showActionValidation(retryValidation);
        return;
      }
    }
    setActionValidation(null);
    if (status === "pending" && options?.pendingHours) {
      setMarkingPendingHours(options.pendingHours);
    } else {
      setMarkingStatusOnly(status);
    }
    setPendingMenuOpen(false);
    setStatusOnlyError(null);
    try {
      await onSetStatusWithoutEmail(ticket.rowId, status, {
        ...options,
        ...(status === "resolved"
          ? { airbnbUserId: getEffectiveAirbnbUserId() }
          : {}),
      });
    } catch (error) {
      setStatusOnlyError(
        error instanceof Error ? error.message : "Failed to update ticket status"
      );
    } finally {
      setMarkingStatusOnly(null);
      setMarkingPendingHours(null);
    }
  }

  function queueSend(
    statusAfterSend: "pending" | "resolved" | "unchanged",
    buttonId: string
  ) {
    flashActionPress(buttonId);
    if (!ticket || sendQueueBusy) return;
    const validation =
      statusAfterSend === "resolved"
        ? collectSendResolvedValidation()
        : collectSendValidation();
    if (validation) {
      showActionValidation(validation);
      return;
    }
    setActionValidation(null);
    onClearSendError?.();

    void (async () => {
      if (statusAfterSend === "resolved") {
        const saved = await ensureAirbnbUserIdBeforeResolve();
        if (!saved) {
          const retryValidation = collectSendResolvedValidation() ?? collectResolvedValidation();
          if (retryValidation) showActionValidation(retryValidation);
          return;
        }
      }

      onQueueSend({
        ticketRowId: ticket.rowId,
        to: ticket.requesterEmail,
        subject: buildEmailSubject(subjectSuffix),
        message: normalizeDraftHtml(replyEditorRef.current?.flush() ?? replyBody),
        cc: buildOutboundCc(ccDraft, {
          extra: ccMarketManager ? marketManagerEmail : null,
        }),
        bcc: buildOutboundBcc(bccDraft),
        statusAfterSend,
        attachmentFiles: replyAttachments.map((entry) => entry.file),
        intakeTimestamp: ticket.timestamp,
        label: ticket.requesterName || ticket.requesterEmail,
      });
    })();
  }

  const salesforceSearchQuery = ticket ? resolveSalesforceSearchQuery(ticket) : "";
  const salesforceSearchUrl = buildSalesforceUnifiedSearchUrl(salesforceSearchQuery);
  const intakeAirbnbUserId = ticket ? intakeAirbnbUserIdFromTicket(ticket) : "";
  const configuredExternalTools = activeExternalTools(externalTools);
  const novaReservationUrl = buildNovaReservationUrl(ticket.reservationCode);
  const claimSearchUrl = buildClaimSalesforceSearchUrl(ticket.claimNumber);
  const novaListingUrl = buildNovaListingUrl(ticket.listingId);
  const becomeUserId = getEffectiveAirbnbUserId();
  const becomeUserUrl = buildBecomeUserUrl(becomeUserId);
  const novaProfileUrl = buildNovaProfileUrl(becomeUserId);
  const novaHostPerformanceUrl = buildNovaHostPerformanceUrl(becomeUserId);
  const becomeUserIdInvalid =
    becomeUserId.trim().length > 0 && !isNumericUserId(becomeUserId);

  function applyTemplate(template: MixmaxTemplateApplyPayload) {
    if (!ticket) return;

    if (template.attachmentsLoading !== undefined) {
      setMixmaxAttachmentsLoading(template.attachmentsLoading);
    }

    const applyingContent =
      template.subject !== undefined || template.body !== undefined;
    if (applyingContent) {
      if (composeTab !== "reply") {
        switchComposeTab("reply");
      }
    }

    if (template.subject?.trim()) {
      const suffix = stripEmailSubjectPrefix(template.subject.trim());
      setSubjectSuffix(suffix);
      onSubjectChange(ticket.rowId, buildEmailSubject(suffix));
    }
    if (template.body?.trim()) {
      const body = normalizeDraftHtml(template.body);
      const currentHtml = replyEditorRef.current?.flush() ?? replyBody;
      if (isRichTextEmpty(currentHtml)) {
        replyEditorRef.current?.replaceHtml(body);
        setReplyBody(body);
      } else {
        replyEditorRef.current?.insertHtmlAtCursor(body);
      }
    }
    if (template.attachmentFiles?.length) {
      const existingFiles = replyAttachments.map((entry) => entry.file);
      const { accepted, error } = validateReplyAttachmentFiles(
        existingFiles,
        template.attachmentFiles
      );
      if (error) {
        setAttachmentError(error);
      } else if (accepted.length > 0) {
        setAttachmentError(null);
        setReplyAttachments((prev) => [
          ...prev,
          ...accepted.map((file) => ({
            id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            file,
          })),
        ]);
        setAttachmentsJustAdded(true);
        clearActionFieldError("compose");
      }
    }
    if (template.attachmentWarning) {
      setAttachmentError(template.attachmentWarning);
    }
    if (applyingContent) {
      setReplyFocused(true);
      requestAnimationFrame(() => {
        replyEditorRef.current?.focus();
      });
    }
  }

  function insertGreetingForRequester() {
    if (!ticket) return;
    const firstName = parseFirstName(ticket.requesterName);
    if (!firstName) return;

    const greetingHtml = plainTextToHtml(`Hello ${firstName},`);

    if (composeTab !== "reply") {
      switchComposeTab("reply");
    }

    const currentHtml = replyEditorRef.current?.flush() ?? replyBody;
    if (isRichTextEmpty(currentHtml)) {
      replyEditorRef.current?.replaceHtml(greetingHtml);
      setReplyBody(greetingHtml);
    } else {
      replyEditorRef.current?.insertHtmlAtCursor(greetingHtml);
    }

    setReplyFocused(true);
    clearActionFieldError("compose");
    requestAnimationFrame(() => {
      replyEditorRef.current?.focus();
    });
  }

  useEffect(() => {
    if (composePanelView === "split") return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setComposePanelView("split");
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [composePanelView]);

  function openReplyDraftExpanded() {
    replyEditorRef.current?.flush();
    if (composeTab !== "reply") {
      setComposeTab("reply");
    }
    setComposePanelView("draft-full");
    setReplyFocused(true);
  }

  function closeReplyDraftExpanded() {
    replyEditorRef.current?.flush();
    setComposePanelView("split");
  }

  function saveCurrentReplyDraft() {
    const rowId = ticketRowIdRef.current;
    if (!rowId) return;

    // Conversation fullscreen unmounts the editor. Save the editor's live DOM
    // synchronously instead of relying on React's pending state update.
    const body = normalizeDraftHtml(replyEditorRef.current?.flush() ?? replyBodyRef.current);
    replyBodyRef.current = body;
    setReplyBody(body);
    saveReplyDraft(rowId, {
      body,
      subject: buildEmailSubject(subjectSuffixRef.current),
      cc: ccDraftRef.current,
      bcc: bccDraftRef.current,
    });
  }

  function openConversationExpanded() {
    saveCurrentReplyDraft();
    setComposePanelView("conversation-full");
  }

  function closeConversationExpanded() {
    setComposePanelView("split");
  }

  function switchComposeTab(tab: "reply" | "admin-notes" | "crm-log") {
    if (tab !== "reply") {
      replyEditorRef.current?.flush();
      if (composePanelView === "draft-full") {
        setComposePanelView("split");
      }
    }
    setComposeTab(tab);
  }

  function openRecipientField(field: "cc" | "bcc") {
    if (field === "cc") {
      setCcFieldOpen(true);
      requestAnimationFrame(() => {
        ccFieldRef.current?.querySelector("input")?.focus();
      });
      return;
    }
    setBccFieldOpen(true);
    requestAnimationFrame(() => {
      bccFieldRef.current?.querySelector("input")?.focus();
    });
  }

  function collapseRecipientFields() {
    setCcFieldOpen(false);
    setBccFieldOpen(false);
  }

  function alignMessageToConversationTop(
    element: HTMLElement,
    behavior: ScrollBehavior = "smooth"
  ) {
    const container = conversationPanelRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const nextTop = container.scrollTop + (elementRect.top - containerRect.top);
    container.scrollTo({ top: Math.max(0, nextTop), behavior });
  }

  function findThreadMessageElement(messageId: string): HTMLElement | null {
    const container = conversationPanelRef.current;
    if (!container) return null;
    const escaped =
      typeof CSS !== "undefined" && typeof CSS.escape === "function"
        ? CSS.escape(messageId)
        : messageId.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
    return container.querySelector<HTMLElement>(`[data-thread-msg-id="${escaped}"]`);
  }

  function scrollConversationToOldest(behavior: ScrollBehavior = "smooth") {
    const container = conversationPanelRef.current;
    if (!container) return;
    const firstId = messages[0]?.id;
    const target = firstId
      ? findThreadMessageElement(firstId)
      : container.querySelector<HTMLElement>("[data-original-request]");
    if (target) alignMessageToConversationTop(target, behavior);
  }

  function scrollConversationToNewest(behavior: ScrollBehavior = "smooth") {
    const container = conversationPanelRef.current;
    if (!container) return;
    const lastId = messages[messages.length - 1]?.id;
    const target = lastId
      ? findThreadMessageElement(lastId)
      : container.querySelector<HTMLElement>("[data-original-request]");
    if (target) alignMessageToConversationTop(target, behavior);
  }

  function toggleReplyDraftExpanded() {
    if (composePanelView === "draft-full") {
      closeReplyDraftExpanded();
      return;
    }
    openReplyDraftExpanded();
  }

  function toggleConversationExpanded() {
    if (composePanelView === "conversation-full") {
      closeConversationExpanded();
      return;
    }
    openConversationExpanded();
  }

  function renderEmailDraftComposePanel() {
    const ccRecipients = parseRecipientList(ccDraft);
    const bccRecipients = parseRecipientList(bccDraft);
    const ccHasRecipients = ccRecipients.length > 0;
    const bccHasRecipients = bccRecipients.length > 0;
    const canCollapseRecipients =
      (ccFieldOpen || bccFieldOpen) && (ccHasRecipients || bccHasRecipients);

    return (
      <div className="flex min-h-0 flex-1 flex-col">
                  <div className="shrink-0 border-b border-zendesk-border bg-white text-xs">
                    <label className="flex items-center gap-2 border-b border-zendesk-border/60 px-2.5 py-1">
                      <span className="w-9 shrink-0 text-zendesk-muted">To</span>
                      <span className="min-w-0 flex-1 truncate text-zendesk-navy">
                        {ticket.requesterEmail || "—"}
                      </span>
                      <span className="flex shrink-0 items-center gap-1">
                          {!ccFieldOpen && (
                            <button
                              type="button"
                              onClick={() => openRecipientField("cc")}
                              disabled={sendQueueBusy}
                              title={
                                ccHasRecipients
                                  ? `Show Cc · ${ccDraft}`
                                  : "Add Cc recipients"
                              }
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50 ${
                                ccHasRecipients
                                  ? "text-zendesk-navy"
                                  : "text-zendesk-muted hover:text-zendesk-navy"
                              }`}
                            >
                              {ccHasRecipients
                                ? `Cc · ${ccRecipients.length}`
                                : "Cc"}
                            </button>
                          )}
                          {!bccFieldOpen && (
                            <button
                              type="button"
                              onClick={() => openRecipientField("bcc")}
                              disabled={sendQueueBusy}
                              title={
                                bccHasRecipients
                                  ? `Show Bcc · ${bccDraft}`
                                  : "Add Bcc recipients"
                              }
                              className={`rounded px-1.5 py-0.5 text-[11px] font-medium hover:bg-gray-100 disabled:opacity-50 ${
                                bccHasRecipients
                                  ? "text-zendesk-navy"
                                  : "text-zendesk-muted hover:text-zendesk-navy"
                              }`}
                            >
                              {bccHasRecipients
                                ? `Bcc · ${bccRecipients.length}`
                                : "Bcc"}
                            </button>
                          )}
                          {canCollapseRecipients && (
                            <button
                              type="button"
                              onClick={collapseRecipientFields}
                              disabled={sendQueueBusy}
                              title="Hide Cc/Bcc fields (keeps recipients)"
                              aria-label="Hide Cc and Bcc fields without removing recipients"
                              className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-medium text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy disabled:opacity-50"
                            >
                              <ChevronUp className="h-3.5 w-3.5" aria-hidden />
                              Hide
                            </button>
                          )}
                        </span>
                    </label>
                    {ccFieldOpen && (
                      <div ref={ccFieldRef}>
                        <EmailRecipientInput
                          label="Cc"
                          value={ccDraft}
                          onChange={setCcDraft}
                          marketManagers={marketManagers}
                          placeholder="Add Cc recipients…"
                          disabled={sendQueueBusy}
                        />
                      </div>
                    )}
                    {bccFieldOpen && (
                      <div ref={bccFieldRef}>
                        <EmailRecipientInput
                          label="Bcc"
                          value={bccDraft}
                          onChange={setBccDraft}
                          marketManagers={marketManagers}
                          placeholder="Add Bcc recipients…"
                          disabled={sendQueueBusy}
                        />
                      </div>
                    )}
                  </div>
                  <div className="flex min-h-0 flex-1 flex-col px-2.5 pt-2">
                    <ReplyDraftEditor
                      key={ticket.rowId}
                      ref={replyEditorRef}
                      value={replyBody}
                      onChange={(html) => {
                        setReplyBody(html);
                        if (!isRichTextEmpty(html) || replyAttachments.length > 0) {
                          clearActionFieldError("compose");
                        }
                      }}
                      focused={replyFocused || composePanelView === "draft-full"}
                      onFocusChange={setReplyFocused}
                      fillAvailable
                      alwaysExpand
                      placeholder="Draft a reply here, or pick a Mixmax template from the sidebar…"
                      onDraftInGmail={openDraftInGmail}
                    />
                  </div>
                  <div
                    className={`shrink-0 space-y-1 border-t px-2.5 pt-1 pb-0.5 transition-colors ${
                      replyAttachments.length > 0
                        ? `border-amber-300 bg-amber-50/80 ${
                            attachmentsJustAdded ? "ring-2 ring-inset ring-amber-400" : ""
                          }`
                        : "border-zendesk-border/60"
                    }`}
                  >
                    <input
                      ref={attachmentInputRef}
                      type="file"
                      multiple
                      accept="image/*,.pdf,.txt,.csv"
                      className="hidden"
                      onChange={handleAttachmentPick}
                    />
                    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <div className="min-w-0 flex-1">
                        <label className="flex items-center gap-2 text-xs leading-tight">
                          <input
                            type="checkbox"
                            checked={ccMarketManager}
                            onChange={(e) => handleCcMarketManagerChange(e.target.checked)}
                            disabled={!marketManagerEmail}
                            className="rounded border-zendesk-border"
                          />
                          <span>
                            CC Market Manager
                            {ticket.marketManager && (
                              <span className="text-zendesk-muted"> ({ticket.marketManager})</span>
                            )}
                          </span>
                        </label>
                        {marketManagerMissingFromDirectory && (
                          <p className="pl-6 text-[11px] leading-snug text-amber-800">
                            Market manager{" "}
                            <span className="font-medium">{ticket.marketManager.trim()}</span> is not
                            in the directory.{" "}
                            {onOpenSetup ? (
                              <button
                                type="button"
                                onClick={() => onOpenSetup("managers")}
                                className="font-medium text-amber-950 underline underline-offset-2 hover:text-amber-900"
                              >
                                Open Settings
                              </button>
                            ) : (
                              "Open Settings"
                            )}{" "}
                            to add them under Market managers.
                          </p>
                        )}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                        {replyAttachments.length > 0 ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-900">
                            <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            {replyAttachments.length} attachment
                            {replyAttachments.length === 1 ? "" : "s"}
                          </span>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => attachmentInputRef.current?.click()}
                          disabled={
                            sendQueueBusy ||
                            replyAttachments.length >= MAX_OUTBOUND_ATTACHMENTS
                          }
                          className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-xs font-medium disabled:opacity-50 ${
                            replyAttachments.length > 0
                              ? "border-amber-300 bg-amber-100 text-amber-900 hover:bg-amber-200"
                              : "border-zendesk-border bg-white text-zendesk-navy hover:bg-gray-100"
                          }`}
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {replyAttachments.length > 0 ? "Add more" : "Attach files"}
                        </button>
                        <span className="text-[10px] leading-none text-zendesk-muted">
                          Up to {MAX_OUTBOUND_ATTACHMENTS} files, 20MB each
                        </span>
                      </div>
                    </div>
                    {replyAttachments.length > 0 && (
                      <ComposeAttachmentList
                        items={replyAttachments.map((entry) => ({
                          id: entry.id,
                          name: entry.file.name,
                          sizeBytes: entry.file.size,
                        }))}
                        onRemove={removeReplyAttachment}
                        disabled={sendQueueBusy}
                      />
                    )}
                    {mixmaxAttachmentsLoading && (
                      <p className="inline-flex items-center gap-1.5 text-xs text-zendesk-muted">
                        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" aria-hidden />
                        Importing Mixmax template attachments…
                      </p>
                    )}
                    {attachmentError && (
                      <p className="text-xs leading-snug text-red-600">{attachmentError}</p>
                    )}
                    <div className="relative space-y-1.5 pt-1">
                      {actionValidation && (
                        <p className="text-center text-[10px] font-medium text-red-600">
                          {actionValidation.message}
                        </p>
                      )}
                      {pendingSendUndo?.active && (
                        <div className="pointer-events-none absolute inset-0 z-30 flex items-end justify-end">
                          <div className="pointer-events-auto m-0 flex max-w-xs flex-col items-end gap-1 rounded-lg border border-amber-500 bg-amber-300 px-3 py-2 shadow-lg shadow-amber-900/25">
                            <button
                              type="button"
                              onClick={pendingSendUndo.onUndo}
                              className="flex items-center gap-2 rounded border border-amber-700 bg-amber-100 px-3 py-1.5 text-xs font-semibold text-amber-950 hover:bg-amber-50"
                            >
                              <Undo2 className="h-3.5 w-3.5" />
                              Undo ({pendingSendUndo.secondsLeft}s)
                            </button>
                            <p className="text-right text-[10px] font-medium leading-snug text-amber-950">
                              {pendingSendUndo.label ?? "Ticket"} →{" "}
                              {pendingSendUndo.status === "resolved"
                                ? "Resolved"
                                : pendingSendUndo.status === "pending"
                                  ? "Pending"
                                  : "Send only"}
                              {pendingSendUndo.attachmentCount > 0 && (
                                <span>
                                  {" "}
                                  · {pendingSendUndo.attachmentCount} attachment
                                  {pendingSendUndo.attachmentCount === 1 ? "" : "s"}
                                </span>
                              )}
                            </p>
                          </div>
                        </div>
                      )}
                      <div className="flex w-full flex-wrap items-end justify-between gap-x-4 gap-y-2.5 pt-0.5">
                      <div className="flex flex-wrap items-end gap-3.5">
                      <button
                        type="button"
                        onClick={() => queueSend("unchanged", "send-only")}
                        disabled={sendQueueBusy || isSending}
                        title="Send reply without changing ticket status"
                        className={actionButtonClass(
                          "send-only",
                          "flex items-center gap-1 rounded border border-zendesk-green bg-white px-2.5 py-1 text-xs font-medium text-zendesk-green hover:bg-green-50 disabled:opacity-50"
                        )}
                      >
                        <Send className="h-4 w-4" />
                        {isSending ? "Sending..." : "Send only"}
                      </button>
                      <button
                        type="button"
                        onClick={() => queueSend("pending", "send-pending")}
                        disabled={sendQueueBusy || isSending}
                        className={actionButtonClass(
                          "send-pending",
                          "flex items-center gap-1 rounded bg-zendesk-green px-2.5 py-1 text-xs font-medium text-white disabled:opacity-50"
                        )}
                      >
                        <Send className="h-4 w-4" />
                        {isSending ? "Sending..." : "Send/Pending"}
                      </button>
                      <div ref={pendingMenuRef} className="relative inline-flex">
                        <button
                          type="button"
                          onClick={() => {
                            flashActionPress("set-pending");
                            setPendingMenuOpen((open) => !open);
                          }}
                          disabled={
                            markingStatusOnly !== null ||
                            markingPendingHours !== null ||
                            sendQueueBusy
                          }
                          title="Set status to Pending without sending an email"
                          className={actionButtonClass(
                            "set-pending",
                            "flex items-center gap-1 rounded-l border border-zendesk-border bg-white px-2.5 py-1 text-xs font-medium text-zendesk-navy hover:bg-gray-100 disabled:opacity-50"
                          )}
                        >
                          <CircleCheck className="h-4 w-4" />
                          {markingPendingHours !== null ? "Setting…" : "Set to Pending"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            flashActionPress("set-pending-menu");
                            setPendingMenuOpen((open) => !open);
                          }}
                          disabled={
                            markingStatusOnly !== null ||
                            markingPendingHours !== null ||
                            sendQueueBusy
                          }
                          aria-expanded={pendingMenuOpen}
                          aria-label="Choose pending duration"
                          className={actionButtonClass(
                            "set-pending-menu",
                            "rounded-r border border-l-0 border-zendesk-border bg-white px-1 py-1 text-xs text-zendesk-navy hover:bg-gray-100 disabled:opacity-50"
                          )}
                        >
                          <ChevronDown
                            className={`h-3.5 w-3.5 transition-transform ${pendingMenuOpen ? "rotate-180" : ""}`}
                          />
                        </button>
                        {pendingMenuOpen && (
                          <div className="absolute bottom-full left-0 z-20 mb-1 min-w-[10rem] rounded border border-zendesk-border bg-white py-1 shadow-md">
                            {PENDING_WITHOUT_EMAIL_HOURS_OPTIONS.map((hours) => (
                              <button
                                key={hours}
                                type="button"
                                onClick={() =>
                                  void setStatusWithoutEmail(
                                    "pending",
                                    {
                                      pendingHours: hours,
                                      adminNote: pendingWithoutEmailAdminNote(hours),
                                    },
                                    `set-pending-${hours}h`
                                  )
                                }
                                className="block w-full px-3 py-1.5 text-left text-xs text-zendesk-navy hover:bg-gray-100"
                              >
                                Pending {hours}h
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={() => queueSend("resolved", "send-resolved")}
                        disabled={sendQueueBusy || isSending}
                        className={actionButtonClass(
                          "send-resolved",
                          "flex items-center gap-1 rounded border border-[#FF5A5F] bg-[#FF5A5F] px-2.5 py-1 text-xs font-medium text-white hover:bg-[#e84e53] disabled:opacity-50"
                        )}
                      >
                        <Send className="h-4 w-4" />
                        {isSending ? "Sending..." : "Send/Resolved"}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          void setStatusWithoutEmail(
                            "resolved",
                            {
                              adminNote: RESOLVED_WITHOUT_EMAIL_NOTE,
                              closeTicket: true,
                            },
                            "set-resolved"
                          )
                        }
                        disabled={
                          markingStatusOnly !== null ||
                          markingPendingHours !== null ||
                          sendQueueBusy ||
                          (ticket.status === "resolved" && ticket.resolvedClosed)
                        }
                        title="Resolve and close without sending an email — thank-you replies will not reopen"
                        className={actionButtonClass(
                          "set-resolved",
                          "flex items-center gap-1 rounded border border-zendesk-border bg-white px-2.5 py-1 text-xs font-medium text-zendesk-navy hover:bg-gray-100 disabled:opacity-50"
                        )}
                      >
                        <CircleCheck className="h-4 w-4" />
                        {markingStatusOnly === "resolved" ? "Closing…" : "Resolve & Close"}
                      </button>
                      </div>
                      <div className="ml-auto flex shrink-0 flex-col items-end gap-1">
                        <div className="flex flex-wrap items-center justify-end gap-2">
                          {showResetGmailLinkButton && !awaitingNewGmailThread && (
                            <button
                              type="button"
                              onClick={() => setResetGmailLinkConfirmOpen(true)}
                              disabled={resettingGmailLink || sendQueueBusy || isSending}
                              title="Remove the Gmail link and send the next reply as a new email thread"
                              className="flex items-center gap-1 rounded border border-violet-300 bg-violet-50 px-2.5 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                            >
                              <Link2Off className="h-4 w-4" />
                              {resettingGmailLink ? "Resetting…" : "Unlink & new thread"}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={openInGmail}
                            disabled={!gmailThreadUrl}
                            title={
                              gmailThreadUrl
                                ? "Open this email thread in Gmail"
                                : ticket.gmailLinkArchivedAt
                                  ? "Gmail link was archived — re-link from Unread Gmail if the customer replies"
                                  : awaitingNewGmailThread
                                    ? "Send your reply to create a new Gmail thread"
                                    : "No linked Gmail thread for this ticket"
                            }
                            className="flex items-center gap-1 rounded border border-zendesk-border bg-white px-2.5 py-1 text-xs font-medium text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
                          >
                            <Mail className="h-4 w-4" />
                            Open in Gmail
                          </button>
                        </div>
                        {ticket.gmailLinkArchivedAt && (
                          <p className="max-w-xs text-right text-[10px] leading-snug text-zendesk-muted">
                            Gmail link archived{" "}
                            {new Date(ticket.gmailLinkArchivedAt).toLocaleDateString()}. Thread
                            history is kept locally; bind again if the customer replies on the old
                            thread.
                          </p>
                        )}
                      </div>
                      </div>
                      {statusOnlyError && (
                        <p className="text-xs text-red-600">{statusOnlyError}</p>
                      )}
                      {sendError && <p className="text-xs text-red-600">{sendError}</p>}
                    </div>
                  </div>
      </div>
    );
  }

  function composeTabButton(
    tab: "reply" | "admin-notes" | "crm-log",
    label: string
  ) {
    const active = composeTab === tab;
    return (
      <button
        type="button"
        onClick={() => switchComposeTab(tab)}
        className={`-mb-px border-b-2 px-2.5 py-1.5 text-xs font-medium ${
          active
            ? "border-zendesk-green text-zendesk-navy"
            : "border-transparent text-zendesk-muted hover:text-zendesk-navy"
        }`}
      >
        {label}
      </button>
    );
  }

  function openInGmail() {
    if (!ticket || !gmailThreadUrl) return;
    window.open(gmailThreadUrl, "_blank", "noopener,noreferrer");
  }

  async function performBackfillLinkHistory(msg: ThreadMessage) {
    if (!ticket || backfillingLinkNoticeId) return;
    if (!ticket.requesterEmail.trim()) {
      window.alert("Add a requester email on this ticket before importing Gmail history.");
      return;
    }

    setBackfillingLinkNoticeId(msg.id);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticket.rowId)}/thread/backfill`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messageId: msg.id,
            requesterEmail: ticket.requesterEmail,
          }),
        }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to import thread history");
      }
      setMessages((data.messages as ThreadMessage[]) ?? []);
      onThreadUpdate();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to import thread history");
    } finally {
      setBackfillingLinkNoticeId(null);
    }
  }

  async function performResetGmailLink() {
    if (!ticket || resettingGmailLink) return;
    setResettingGmailLink(true);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticket.rowId)}/thread/reset-gmail`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error ?? "Failed to reset Gmail link");
      }
      setMessages((data.messages as ThreadMessage[]) ?? []);
      setGmailOpenUrl(null);
      setForceNewGmailThreadOnSend(true);
      setSubjectSuffix("");
      saveReplyDraft(ticket.rowId, {
        body: replyBodyRef.current,
        subject: "",
        cc: ccDraftRef.current,
        bcc: bccDraftRef.current,
      });
      onGmailLinkChange(ticket.rowId, null);
      onForceNewGmailThreadChange?.(ticket.rowId, true);
      await onSubjectChange(ticket.rowId, "");
      setResetGmailLinkConfirmOpen(false);
      onThreadUpdate();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to reset Gmail link");
    } finally {
      setResettingGmailLink(false);
    }
  }

  function openDraftInGmail() {
    if (!ticket) return;
    const html = replyEditorRef.current?.flush() ?? replyBody;
    const plainBody = stripHtmlToText(html);
    const url = buildGmailComposeUrl({
      to: ticket.requesterEmail,
      cc:
        buildOutboundCc(ccDraft, {
          extra: ccMarketManager ? marketManagerEmail : null,
        }) ?? undefined,
      bcc: buildOutboundBcc(bccDraft) ?? undefined,
      subject: buildEmailSubject(subjectSuffix),
      body: plainBody,
    });
    const popup = openGmailComposePopup(url);
    if (!popup) {
      window.alert(
        "Your browser blocked the Gmail compose popup. Allow popups for SheetsCRM and try again."
      );
    }
  }

  async function performRedactMessage(msg: ThreadMessage) {
    if (!ticket || redactingMessageId) return;

    setRedactingMessageId(msg.id);
    try {
      const res = await fetch(
        `/api/tickets/${encodeURIComponent(ticket.rowId)}/thread/messages/${encodeURIComponent(msg.id)}/redact`,
        { method: "POST", credentials: "same-origin" }
      );
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to redact message");
      }
      setMessages(Array.isArray(data.messages) ? data.messages : []);
      if (typeof data.adminNotes === "string") {
        onAdminNotesChange?.(ticket.rowId, data.adminNotes);
      }
      setRedactConfirmMessage(null);
      onThreadUpdate();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Failed to redact message");
    } finally {
      setRedactingMessageId(null);
    }
  }

  function requestRedactMessage(msg: ThreadMessage) {
    if (!ticket || redactingMessageId) return;
    setRedactConfirmMessage(msg);
  }

  function handleCcMarketManagerChange(checked: boolean) {
    if (!ticket) return;
    setCcMarketManager(checked);
    if (marketManagerEmail) {
      setCcDraft((prev) =>
        checked
          ? appendRecipient(prev, marketManagerEmail)
          : removeRecipient(prev, marketManagerEmail)
      );
    }
    void saveComposePrefs(ticket.rowId, { ccMarketManager: checked });
  }

  return (
    <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b border-zendesk-border px-3 py-1.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div
              className={`flex overflow-hidden rounded border focus-within:border-zendesk-green ${
                subjectFieldError
                  ? "crm-field-required-missing border-red-300"
                  : "border-zendesk-border"
              }`}
            >
              <span className="shrink-0 border-r border-zendesk-border bg-gray-50 px-2 py-1 text-[10px] font-medium text-zendesk-muted">
                {EMAIL_SUBJECT_PREFIX}
              </span>
              <input
                type="text"
                value={subjectSuffix}
                onChange={(e) => {
                  setSubjectSuffix(e.target.value);
                  if (isEmailSubjectSuffixFilled(e.target.value)) {
                    clearActionFieldError("subject");
                  }
                }}
                required
                aria-label="Email subject"
                aria-invalid={subjectFieldError}
                onBlur={saveSubject}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.currentTarget.blur();
                  }
                }}
                className="min-w-0 flex-1 px-2 py-1 text-sm font-medium outline-none"
                placeholder="Subject (required)…"
              />
            </div>
            {subjectFieldError && (
              <p className="mt-0.5 text-[10px] text-red-600">Add subject details before sending.</p>
            )}
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              {ticket.requesterName ? (
                <button
                  type="button"
                  onClick={insertGreetingForRequester}
                  className="text-sm font-semibold text-zendesk-navy hover:underline"
                  title={`Insert "Hello ${parseFirstName(ticket.requesterName)}," in email draft`}
                  aria-label={`Insert greeting for ${parseFirstName(ticket.requesterName)} in email draft`}
                >
                  {ticket.requesterName}
                </button>
              ) : (
                <span className="text-sm font-semibold text-zendesk-navy">—</span>
              )}
              <span className="text-zendesk-muted" aria-hidden>
                ·
              </span>
              <span className="flex items-center gap-1 text-sm text-zendesk-navy">
                {ticket.requesterEmail ? (
                  <a href={`mailto:${ticket.requesterEmail}`} className="hover:underline">
                    {ticket.requesterEmail}
                  </a>
                ) : (
                  <span className="text-zendesk-muted">—</span>
                )}
                {ticket.requesterEmail && (
                  <button
                    type="button"
                    onClick={async () => {
                      await navigator.clipboard.writeText(ticket.requesterEmail);
                      setEmailCopied(true);
                      window.setTimeout(() => setEmailCopied(false), 1500);
                    }}
                    className="rounded p-0.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                    aria-label="Copy email address"
                    title={emailCopied ? "Copied" : "Copy email"}
                  >
                    <Copy className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
              {ticketUiFields.map((field) =>
                onUiFieldChange ? (
                  <span key={field.slotId} className="contents">
                    <span className="text-zendesk-muted" aria-hidden>
                      ·
                    </span>
                    <label className="flex min-w-0 items-center gap-1.5">
                      <span className="shrink-0 text-xs text-zendesk-muted">{field.label}</span>
                      <input
                        type="text"
                        value={uiFieldDrafts[field.slotId] ?? field.value}
                        onChange={(e) =>
                          setUiFieldDrafts((prev) => ({
                            ...prev,
                            [field.slotId]: e.target.value,
                          }))
                        }
                        onBlur={async () => {
                          if (!ticket) return;
                          const next = (uiFieldDrafts[field.slotId] ?? field.value).trim();
                          if (next === field.value.trim()) return;
                          await onUiFieldChange(ticket.rowId, field.slotId, next);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") e.currentTarget.blur();
                        }}
                        className="min-w-[6rem] max-w-[14rem] rounded border border-zendesk-border px-1.5 py-0.5 text-sm outline-none focus:border-zendesk-green"
                        placeholder="—"
                        aria-label={field.label}
                      />
                    </label>
                  </span>
                ) : null
              )}
              <span className="text-zendesk-muted" aria-hidden>
                ·
              </span>
              <span className="text-xs text-zendesk-muted">
                {ticket.coverSourceLabel ? (
                  <span
                    className="mr-1.5 rounded bg-violet-100 px-1.5 py-px text-[10px] font-semibold text-violet-800 ring-1 ring-violet-200"
                    title="Teammate cover sheet"
                  >
                    {ticket.coverSourceLabel}
                  </span>
                ) : null}
                {sheetRowUrl ? (
                  <a
                    href={sheetRowUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-0.5 hover:text-zendesk-navy hover:underline"
                    title="Open in Sheets (column C)"
                    aria-label={`Open row ${ticket.rowNumber} in Sheets (column C)`}
                  >
                    Row {ticket.rowNumber}
                    <ExternalLink className="h-3 w-3 shrink-0 opacity-70" aria-hidden />
                  </a>
                ) : (
                  <>Row {ticket.rowNumber}</>
                )}
                {ticket.needsInitialResponse && (
                  <span className="ml-1.5 rounded bg-red-100 px-1 py-px font-semibold text-red-700">
                    {initialResponseHours}h+
                  </span>
                )}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <button
              type="button"
              onClick={() => setHeaderDetailsOpen((open) => !open)}
              className="mt-0.5 flex items-center gap-0.5 rounded border border-zendesk-border px-2 py-1 text-[10px] font-medium text-zendesk-muted hover:bg-gray-100"
              aria-expanded={headerDetailsOpen}
            >
              Details
              <ChevronDown
                className={`h-3 w-3 transition-transform ${headerDetailsOpen ? "rotate-180" : ""}`}
              />
            </button>
            <div className="flex flex-wrap items-center justify-end gap-1">
              <button
                type="button"
                onClick={() => void openGleanWithPrompt(GLEAN_THREAD_SUMMARY_PROMPT, "summary")}
                className="inline-flex items-center gap-0.5 rounded border border-zendesk-border px-2 py-1 text-[10px] font-medium text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                title={
                  gleanOpenedKind === "summary"
                    ? "Opened Glean — paste the copied thread into chat"
                    : "Copy thread to clipboard and open Glean with summary prompt"
                }
                aria-label={
                  gleanOpenedKind === "summary"
                    ? "Opened Glean — paste the copied thread into chat"
                    : "Copy thread to clipboard and open Glean with summary prompt"
                }
              >
                <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                {gleanOpenedKind === "summary" ? "Opened" : "Glean Summary"}
              </button>
              <button
                type="button"
                onClick={() => void openGleanWithPrompt(GLEAN_RESPONSE_PROMPT, "response")}
                className="inline-flex items-center gap-0.5 rounded border border-zendesk-border px-2 py-1 text-[10px] font-medium text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                title={
                  gleanOpenedKind === "response"
                    ? "Opened Glean — paste the copied thread into chat"
                    : "Copy thread to clipboard and open Glean with response prompt"
                }
                aria-label={
                  gleanOpenedKind === "response"
                    ? "Opened Glean — paste the copied thread into chat"
                    : "Copy thread to clipboard and open Glean with response prompt"
                }
              >
                <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                {gleanOpenedKind === "response" ? "Opened" : "Glean Response"}
              </button>
              <button
                type="button"
                onClick={() => void openGleanWithPrompt(GLEAN_ESCALATION_PROMPT, "escalation")}
                className="inline-flex items-center gap-0.5 rounded border border-zendesk-border px-2 py-1 text-[10px] font-medium text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                title={
                  gleanOpenedKind === "escalation"
                    ? "Opened Glean — paste the copied thread into chat"
                    : "Copy thread to clipboard and open Glean with escalation prompt"
                }
                aria-label={
                  gleanOpenedKind === "escalation"
                    ? "Opened Glean — paste the copied thread into chat"
                    : "Copy thread to clipboard and open Glean with escalation prompt"
                }
              >
                <Sparkles className="h-3 w-3 shrink-0" aria-hidden />
                {gleanOpenedKind === "escalation" ? "Opened" : "Glean Escalation"}
              </button>
              <button
                type="button"
                onClick={() => void copyConversationToClipboard()}
                className="inline-flex items-center gap-0.5 rounded border border-zendesk-border px-2 py-1 text-[10px] font-medium text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
                title={
                  conversationCopied
                    ? "Copied full conversation"
                    : "Copy full conversation to clipboard"
                }
                aria-label={
                  conversationCopied
                    ? "Copied full conversation"
                    : "Copy full conversation to clipboard"
                }
              >
                <Copy className="h-3 w-3 shrink-0" aria-hidden />
                {conversationCopied ? "Copied" : "Copy thread"}
              </button>
            </div>
          </div>
        </div>
        {headerDetailsOpen && (
          <div className="mt-1.5 space-y-1.5 border-t border-zendesk-border/60 pt-1.5">
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
              {ticket.coverSourceLabel && onResyncFromSheet ? (
                <div className="flex flex-wrap items-center gap-2">
                  {!resyncConfirmOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        setResyncError(null);
                        setResyncConfirmOpen(true);
                      }}
                      className="rounded border border-violet-200 px-1.5 py-px font-semibold text-violet-800 hover:bg-violet-50"
                    >
                      Resync from sheet
                    </button>
                  ) : (
                    <>
                      <span className="text-zendesk-muted">
                        Reload sheet values and discard CRM overrides for this cover ticket?
                      </span>
                      <button
                        type="button"
                        disabled={resyncingFromSheet}
                        onClick={async () => {
                          const ticketRowId = ticket.rowId;
                          setResyncingFromSheet(true);
                          setResyncError(null);
                          try {
                            await onResyncFromSheet(ticketRowId);
                            if (ticket?.rowId !== ticketRowId) return;
                            setResyncConfirmOpen(false);
                          } catch (error) {
                            if (ticket?.rowId !== ticketRowId) return;
                            setResyncError(
                              error instanceof Error
                                ? error.message
                                : "Failed to resync from sheet"
                            );
                          } finally {
                            if (ticket?.rowId === ticketRowId) {
                              setResyncingFromSheet(false);
                            }
                          }
                        }}
                        className="rounded border border-violet-300 bg-violet-100 px-1.5 py-px font-semibold text-violet-900 hover:bg-violet-200 disabled:opacity-50"
                      >
                        {resyncingFromSheet ? "Resyncing…" : "Confirm resync"}
                      </button>
                      <button
                        type="button"
                        disabled={resyncingFromSheet}
                        onClick={() => {
                          setResyncConfirmOpen(false);
                          setResyncError(null);
                        }}
                        className="rounded border border-zendesk-border px-1.5 py-px text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
                      >
                        Cancel
                      </button>
                    </>
                  )}
                  {resyncError ? (
                    <span className="text-red-600">{resyncError}</span>
                  ) : null}
                  {onIgnoreCoverTicket &&
                  normalizeStatusId(ticket.status) !== "resolved" ? (
                    <>
                      {!ignoreConfirmOpen ? (
                        <button
                          type="button"
                          onClick={() => {
                            setIgnoreCoverError(null);
                            setIgnoreConfirmOpen(true);
                          }}
                          className="rounded border border-violet-200 px-1.5 py-px font-semibold text-violet-800 hover:bg-violet-50"
                        >
                          Ignore ticket
                        </button>
                      ) : (
                        <>
                          <span className="text-zendesk-muted">
                            Mark resolved in your inbox only? Their sheet will not be updated.
                          </span>
                          <button
                            type="button"
                            disabled={ignoringCoverTicket}
                            onClick={async () => {
                              const ticketRowId = ticket.rowId;
                              setIgnoringCoverTicket(true);
                              setIgnoreCoverError(null);
                              try {
                                await onIgnoreCoverTicket(ticketRowId);
                                if (ticket?.rowId !== ticketRowId) return;
                                setIgnoreConfirmOpen(false);
                              } catch (error) {
                                if (ticket?.rowId !== ticketRowId) return;
                                setIgnoreCoverError(
                                  error instanceof Error
                                    ? error.message
                                    : "Failed to ignore ticket"
                                );
                              } finally {
                                if (ticket?.rowId === ticketRowId) {
                                  setIgnoringCoverTicket(false);
                                }
                              }
                            }}
                            className="rounded border border-violet-300 bg-violet-100 px-1.5 py-px font-semibold text-violet-900 hover:bg-violet-200 disabled:opacity-50"
                          >
                            {ignoringCoverTicket ? "Ignoring…" : "Confirm ignore"}
                          </button>
                          <button
                            type="button"
                            disabled={ignoringCoverTicket}
                            onClick={() => {
                              setIgnoreConfirmOpen(false);
                              setIgnoreCoverError(null);
                            }}
                            className="rounded border border-zendesk-border px-1.5 py-px text-zendesk-muted hover:bg-gray-100 disabled:opacity-50"
                          >
                            Cancel
                          </button>
                        </>
                      )}
                      {ignoreCoverError ? (
                        <span className="text-red-600">{ignoreCoverError}</span>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ) : null}
              {ticket.needsInitialResponse && (
                <button
                  type="button"
                  onClick={async () => {
                    setClearingInitialSla(true);
                    try {
                      await onClearInitialResponseSla(ticket.rowId);
                    } finally {
                      setClearingInitialSla(false);
                    }
                  }}
                  disabled={clearingInitialSla}
                  className="rounded border border-red-200 px-1.5 py-px font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
                >
                  {clearingInitialSla ? "Clearing…" : `Clear ${initialResponseHours}h business SLA`}
                </button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-[10px]">
                <span className="text-zendesk-muted">Status</span>
                <select
                  value={normalizeStatusId(ticket.status)}
                  disabled={statusChanging}
                  onChange={async (e) => {
                    const nextStatus = e.target.value;
                    setStatusChangeError(null);
                    setStatusChanging(true);
                    try {
                      await onStatusChange(ticket.rowId, nextStatus);
                    } catch (error) {
                      setStatusChangeError(
                        error instanceof Error ? error.message : "Failed to update status"
                      );
                    } finally {
                      setStatusChanging(false);
                    }
                  }}
                  className="rounded border border-zendesk-border px-1.5 py-px text-[10px] disabled:opacity-50"
                >
                  {DEFAULT_STATUSES.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.label}
                    </option>
                  ))}
                </select>
                {statusChangeError && (
                  <span className="text-red-600">{statusChangeError}</span>
                )}
              </label>
              <label className="flex items-center gap-1 text-[10px]">
                <span className="text-zendesk-muted">Reason</span>
                <select
                  value={ticket.contactReason}
                  onChange={(e) => onContactReasonChange(ticket.rowId, e.target.value)}
                  className="max-w-[10rem] rounded border border-zendesk-border px-1.5 py-px text-[10px]"
                >
                  <option value="">—</option>
                  {contactReasonSelectOptions.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </label>
              {shouldShowResponseSla(ticket) && (
                <label className="flex items-center gap-1 text-[10px]">
                  <span className="text-zendesk-muted">Response SLA</span>
                  <select
                    value={ticket.slaHours}
                    onChange={(e) => onSlaChange(ticket.rowId, Number(e.target.value))}
                    className="rounded border border-zendesk-border px-1.5 py-px text-[10px]"
                  >
                    {[4, 8, 24, 48, 72].map((h) => (
                      <option key={h} value={h}>
                        {h}h
                      </option>
                    ))}
                  </select>
                </label>
              )}
              <NovaSheetLinkField
                label={columnLabels?.reservationCode || "Reso"}
                value={ticket.reservationCode}
                href={novaReservationUrl}
                maxDisplayLength={10}
                onSave={(value) => onReservationCodeChange(ticket.rowId, value)}
              />
              <NovaSheetLinkField
                label={columnLabels?.claimNumber || "Claims"}
                value={ticket.claimNumber}
                href={claimSearchUrl}
                openInLabel="Salesforce"
                maxDisplayLength={14}
                onSave={(value) => onClaimNumberChange(ticket.rowId, value)}
              />
              <NovaSheetLinkField
                label={columnLabels?.listingId || "Listing"}
                value={ticket.listingId}
                href={novaListingUrl}
                onSave={(value) => onListingIdChange(ticket.rowId, value)}
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1">
        <div className="relative flex min-h-0 min-w-0 flex-1 flex-col border-r border-zendesk-border">
          <div
            className={
              composePanelView === "conversation-full"
                ? "absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden border border-zendesk-border bg-white shadow-[0_8px_24px_rgba(23,73,77,0.12)]"
                : composePanelView === "draft-full"
                  ? "flex min-h-0 flex-1 flex-col overflow-hidden"
                  : "flex min-h-0 flex-1 flex-col"
            }
          >
            <div className="flex shrink-0 items-center border-b border-zendesk-border bg-gray-50 px-2.5 py-1">
              <span className="text-[10px] font-semibold uppercase text-zendesk-muted">
                Conversation
              </span>
              <div className="ml-auto flex items-center gap-0.5">
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    scrollConversationToOldest();
                  }}
                  title="Jump to oldest message"
                  aria-label="Jump to oldest message"
                  className="rounded p-1 text-zendesk-muted hover:bg-white/80 hover:text-zendesk-navy"
                >
                  <ArrowUpToLine className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    scrollConversationToNewest();
                  }}
                  title="Jump to newest message"
                  aria-label="Jump to newest message"
                  className="rounded p-1 text-zendesk-muted hover:bg-white/80 hover:text-zendesk-navy"
                >
                  <ArrowDownToLine className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    toggleConversationExpanded();
                  }}
                  title={
                    composePanelView === "conversation-full"
                      ? "Show email draft"
                      : "Expand conversation"
                  }
                  aria-label={
                    composePanelView === "conversation-full"
                      ? "Show email draft"
                      : "Expand conversation"
                  }
                  className="rounded p-1 text-zendesk-muted hover:bg-white/80 hover:text-zendesk-navy"
                >
                  {composePanelView === "conversation-full" ? (
                    <Minimize2 className="h-3.5 w-3.5" />
                  ) : (
                    <Maximize2 className="h-3.5 w-3.5" />
                  )}
                </button>
              </div>
            </div>
            <div ref={conversationPanelRef} className="min-h-0 flex-1 overflow-y-auto px-2.5 py-2">
            {awaitingNewGmailThread && (
              <div className="mb-2 rounded border border-violet-300 bg-violet-50 px-3 py-2 text-xs text-violet-950">
                <p className="font-medium">Next send starts a new Gmail thread</p>
                <p className="mt-1 text-violet-900/90">
                  The wrong Gmail link and subject were cleared. Send your reply when ready — it
                  will not reply to the old thread, and your draft body is unchanged.
                </p>
              </div>
            )}
            <div
              data-original-request
              className="mb-2 rounded border border-zendesk-border bg-white p-2.5"
            >
              <p className="text-xs font-semibold text-zendesk-muted">Original request</p>
              <p className="mt-2 whitespace-pre-wrap text-sm">{ticket.description}</p>
              <p className="mt-2 text-xs text-zendesk-muted">{ticket.timestamp}</p>
            </div>
            {threadLoading && messages.length === 0 && (
              <p className="py-2 text-xs text-zendesk-muted">Loading conversation…</p>
            )}
            {messages.map((msg) => {
              if (msg.direction === "redacted") {
                return (
                  <div
                    key={msg.id}
                    data-thread-msg-id={msg.id}
                    className="mb-2 rounded border border-amber-300 bg-amber-50 p-2.5"
                  >
                    <div className="flex justify-between gap-2 text-xs font-semibold text-amber-900">
                      <span className="inline-flex items-center gap-1">
                        <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                        Message redacted
                      </span>
                      <span>{new Date(msg.sentAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-amber-950">{msg.body}</p>
                    {gmailThreadUrl && (
                      <a
                        href={gmailThreadUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-amber-900 underline hover:text-amber-950"
                      >
                        Open thread in Gmail to delete the message
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>
                );
              }

              if (msg.direction === "admin_note") {
                return (
                  <div
                    key={msg.id}
                    data-thread-msg-id={msg.id}
                    className="mb-2 rounded border border-amber-200 bg-amber-50 p-2.5"
                  >
                    <div className="flex justify-between gap-2 text-xs font-semibold text-amber-900">
                      <span>Admin note · {msg.from}</span>
                      <span>{new Date(msg.sentAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-amber-950">{msg.body}</p>
                  </div>
                );
              }

              if (msg.direction === "system") {
                return (
                  <div
                    key={msg.id}
                    data-thread-msg-id={msg.id}
                    className="mb-2 rounded border border-violet-200 bg-violet-50 p-2.5"
                  >
                    <div className="flex justify-between gap-2 text-xs text-zendesk-muted">
                      <span>SheetsCRM</span>
                      <span>{new Date(msg.sentAt).toLocaleString()}</span>
                    </div>
                    <p className="mt-2 text-sm">{msg.body}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {threadLinkNoticeNeedsBackfill(msg.subject, msg.body) && (
                        <button
                          type="button"
                          onClick={() => void performBackfillLinkHistory(msg)}
                          disabled={Boolean(backfillingLinkNoticeId) || sendQueueBusy}
                          className="inline-flex items-center gap-1 rounded border border-violet-300 bg-white px-2 py-1 text-xs font-medium text-violet-900 hover:bg-violet-100 disabled:opacity-50"
                        >
                          {backfillingLinkNoticeId === msg.id
                            ? "Importing…"
                            : "Import full thread history"}
                        </button>
                      )}
                      {gmailThreadUrl && (
                        <a
                          href={gmailThreadUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                          View full history in Gmail
                          <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={msg.id}
                  data-thread-msg-id={msg.id}
                  className={`mb-2 rounded border p-2.5 ${
                    msg.direction === "outbound"
                      ? "ml-4 border-zendesk-border bg-blue-50"
                      : "mr-4 border-zendesk-border bg-white"
                  }`}
                >
                  <div className="flex justify-between gap-2 text-xs text-zendesk-muted">
                    <span>
                      {msg.direction === "outbound" ? "You" : msg.from}
                      {msg.direction === "outbound" ? ` → ${msg.to}` : " replied"}
                    </span>
                    <span>{new Date(msg.sentAt).toLocaleString()}</span>
                  </div>
                  <p className="mt-1 text-xs font-medium text-zendesk-muted">{msg.subject}</p>
                  {msg.cc && (
                    <p className="mt-1 text-xs text-zendesk-muted">CC: {msg.cc}</p>
                  )}
                  {(msg.body !== "(attachment only)" || !msg.attachments?.length) && (
                    <ThreadMessageBody body={msg.body} />
                  )}
                  {msg.attachments && msg.attachments.length > 0 && (
                    <ThreadAttachmentList
                      rowNumber={ticket.rowNumber}
                      items={msg.attachments.map((att) => ({
                        id: att.id,
                        filename: att.filename,
                        sizeBytes: att.sizeBytes,
                        downloadHref: `/api/tickets/${encodeURIComponent(ticket.rowId)}/thread/attachments/${encodeURIComponent(att.id)}`,
                      }))}
                    />
                  )}
                  {msg.gmailMessageId && (
                    <a
                      href={buildGmailMessageUrl(msg.gmailMessageId)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      Open in Gmail
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => requestRedactMessage(msg)}
                      disabled={redactingMessageId === msg.id}
                      title="Remove this message from the CRM and block Gmail re-import"
                      className="inline-flex items-center gap-1 rounded border border-amber-300 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
                    >
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      {redactingMessageId === msg.id ? "Redacting…" : "Redact & stop re-sync"}
                    </button>
                  </div>
                </div>
              );
            })}
            </div>
          </div>
          <div
            className={
              composePanelView === "conversation-full"
                ? "hidden"
                : composePanelView === "draft-full"
                  ? "absolute inset-0 z-40 flex min-h-0 flex-col overflow-hidden border border-zendesk-border bg-white shadow-[0_-8px_24px_rgba(23,73,77,0.12)]"
                  : `flex min-h-0 flex-1 flex-col overflow-hidden border-t bg-white ${
                      composeFieldError
                        ? "crm-field-required-missing border-red-300"
                        : "border-zendesk-border"
                    }`
            }
          >
            <div className="relative z-10 flex shrink-0 items-center border-b border-zendesk-border bg-slate-100 px-2.5">
              {composeTabButton("reply", "Email draft")}
              {composeTabButton("admin-notes", "Admin notes")}
              {composeTabButton("crm-log", "CRM log")}
              <button
                type="button"
                onMouseDown={(event) => {
                  event.preventDefault();
                  toggleReplyDraftExpanded();
                }}
                title={composePanelView === "draft-full" ? "Minimize email draft" : "Expand email draft"}
                aria-label={
                  composePanelView === "draft-full" ? "Minimize email draft" : "Expand email draft"
                }
                className="ml-auto rounded p-1.5 text-zendesk-muted hover:bg-white/80 hover:text-zendesk-navy"
              >
                {composePanelView === "draft-full" ? (
                  <Minimize2 className="h-3.5 w-3.5" />
                ) : (
                  <Maximize2 className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <div
                className={`absolute inset-0 flex flex-col ${
                  composeTab === "reply" ? "z-10" : "pointer-events-none invisible z-0"
                }`}
                aria-hidden={composeTab !== "reply"}
              >
                {renderEmailDraftComposePanel()}
              </div>
              <div
                className={`absolute inset-0 overflow-hidden ${
                  composeTab === "admin-notes" ? "" : "pointer-events-none invisible"
                }`}
                aria-hidden={composeTab !== "admin-notes"}
              >
                <div className="flex h-full flex-col overflow-hidden p-2.5 pb-1.25">
                  <div className="crm-notes-panel flex min-h-0 flex-1 flex-col">
                    <div className="crm-notes-content crm-notes-content-compose whitespace-pre-wrap text-sm">
                      {ticket.adminNotes || (
                        <span className="text-zendesk-muted">No notes yet.</span>
                      )}
                    </div>
                    <div className="mt-3 shrink-0 flex gap-2">
                      <input
                        type="text"
                        value={newAdminNote}
                        onChange={(e) => setNewAdminNote(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") addAdminNote();
                        }}
                        placeholder="Add a note…"
                        className="min-w-0 flex-1 rounded border border-zendesk-border bg-white px-3 py-2 text-sm outline-none focus:border-zendesk-green"
                      />
                      <button
                        type="button"
                        onClick={addAdminNote}
                        disabled={addingNote || !newAdminNote.trim()}
                        className="shrink-0 rounded bg-zendesk-green px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        {addingNote ? "Adding…" : "Add"}
                      </button>
                    </div>
                    {adminNoteError && (
                      <p className="mt-1 shrink-0 text-xs text-red-600">{adminNoteError}</p>
                    )}
                    <p className="mt-1 shrink-0 text-[10px] text-zendesk-muted">
                      Appends as • MM/DD/YYYY - your note to the sheet
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={`absolute inset-0 overflow-hidden ${
                  composeTab === "crm-log" ? "" : "pointer-events-none invisible"
                }`}
                aria-hidden={composeTab !== "crm-log"}
              >
                <CrmTicketLogPanel rowId={ticket.rowId} fillHeight />
              </div>
            </div>
          </div>
        </div>

        {internalToolsCollapsed ? (
          <aside className="flex w-11 shrink-0 flex-col border-l border-zendesk-border bg-zendesk-sidebar">
            <button
              type="button"
              onClick={() => setInternalToolsCollapsed(false)}
              title="Expand internal tools"
              aria-label="Expand internal tools"
              className="flex h-10 items-center justify-center border-b border-zendesk-border text-zendesk-muted hover:bg-white/60 hover:text-zendesk-navy"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <div
              className="flex flex-1 flex-col items-center gap-2 py-2"
              title="Internal tools — expand to use"
            >
              <Wrench className="h-4 w-4 text-zendesk-muted" />
            </div>
          </aside>
        ) : (
        <aside className="relative flex w-44 shrink-0 flex-col overflow-hidden bg-zendesk-sidebar xl:w-52">
          <div className="flex shrink-0 items-center justify-between border-b border-zendesk-border px-2.5 py-1.5">
            <h3
              className="text-[10px] font-semibold uppercase text-zendesk-muted"
              data-help-tour="internal-tools"
            >
              Internal tools
            </h3>
            <button
              type="button"
              onClick={() => setInternalToolsCollapsed(true)}
              title="Collapse internal tools"
              aria-label="Collapse internal tools"
              className="rounded p-1 text-zendesk-muted hover:bg-white/60 hover:text-zendesk-navy"
            >
              <PanelRightClose className="h-3.5 w-3.5" />
            </button>
          </div>
          <div
            className={`flex min-h-0 flex-1 flex-col overflow-y-auto p-2.5 pb-1 transition-opacity duration-200 ${
              internalToolsOverlayOpen ? "pointer-events-none overflow-hidden opacity-25" : ""
            }`}
          >
            <ul className="space-y-2">
              <li className="rounded border border-zendesk-border bg-white p-2">
                {salesforceSearchUrl ? (
                  <a
                    href={salesforceSearchUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-sm font-medium text-blue-600 hover:underline"
                  >
                    Salesforce Search
                    <ExternalLink className="h-3 w-3 shrink-0" />
                  </a>
                ) : (
                  <p className="text-sm text-zendesk-muted">
                    No form User ID or manual override to search
                  </p>
                )}
              </li>
              <li
                ref={airbnbUserIdFieldRef}
                className={`rounded border bg-white p-2 ${
                  airbnbUserIdFieldError
                    ? "crm-field-required-missing border-red-300"
                    : "border-zendesk-border"
                }`}
              >
                <label className="block text-[10px]">
                  <span className="font-medium text-zendesk-muted">
                    {columnLabels?.airbnbUserId || "Manual User ID override"}
                  </span>
                  <input
                    type="text"
                    value={airbnbUserIdDraft}
                    onChange={(e) => {
                      setAirbnbUserIdDraft(e.target.value);
                      if (hasAirbnbUserIdForResolve(e.target.value)) {
                        clearActionFieldError("airbnbUserId");
                      }
                    }}
                    onBlur={saveAirbnbUserId}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") e.currentTarget.blur();
                    }}
                    placeholder={intakeAirbnbUserId ? `Form: ${intakeAirbnbUserId}` : "Override form User ID…"}
                    className="mt-1 w-full rounded border border-zendesk-border px-2 py-1 font-mono text-xs outline-none focus:border-zendesk-green"
                  />
                  {(savingUserId || userIdSaveError) && (
                    <span
                      className={`mt-1 block text-[10px] ${
                        userIdSaveError ? "text-red-600" : "text-zendesk-muted"
                      }`}
                    >
                      {savingUserId
                        ? `Saving to ${columnLabels?.airbnbUserId || "mapped sheet column"}…`
                        : userIdSaveError}
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      if (novaProfileUrl) {
                        window.open(novaProfileUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    disabled={!novaProfileUrl}
                    data-help-tour="nova-profile"
                    title={
                      novaProfileUrl
                        ? "Open user profile in Nova"
                        : "Enter a numeric user ID for Nova profile"
                    }
                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-zendesk-border bg-white px-2 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UserRound className="h-3.5 w-3.5" />
                    Nova profile
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (novaHostPerformanceUrl) {
                        window.open(novaHostPerformanceUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    disabled={!novaHostPerformanceUrl}
                    data-help-tour="host-performance"
                    title={
                      novaHostPerformanceUrl
                        ? "Open host performance in Nova"
                        : "Enter a numeric user ID for Nova host performance"
                    }
                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-zendesk-border bg-white px-2 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <LineChart className="h-3.5 w-3.5" />
                    Host Performance
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (becomeUserUrl) {
                        window.open(becomeUserUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                    disabled={!becomeUserUrl}
                    data-help-tour="become-user"
                    title={
                      becomeUserUrl
                        ? "Open Become User in admin.airbnb.com"
                        : becomeUserIdInvalid
                          ? "User ID must be numeric only (emails and text are not supported)"
                          : "Enter a numeric user ID first"
                    }
                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-violet-700 bg-violet-600 px-2 py-1.5 text-xs font-medium text-white hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <UserRound className="h-3.5 w-3.5" />
                    Become user
                  </button>
                  <button
                    type="button"
                    onClick={() => window.open(ADMIN_LOGOUT_URL, "_blank", "noopener,noreferrer")}
                    data-help-tour="logout"
                    title="Log out of all users in admin.airbnb.com"
                    className="mt-1.5 flex w-full items-center justify-center gap-1.5 rounded border border-zendesk-border bg-white px-2 py-1.5 text-xs font-medium text-zendesk-navy hover:bg-gray-100"
                  >
                    <LogOut className="h-3.5 w-3.5" />
                    Log out
                  </button>
                </label>
              </li>
              <li className="rounded border border-zendesk-border bg-white p-2">
                <p className="text-xs font-medium text-zendesk-navy" data-help-tour="linked-cases">
                  Linked cases
                </p>
                <p className="mt-0.5 text-[10px] text-zendesk-muted">
                  Label · URL
                </p>
                <ul className="mt-2 space-y-1">
                  {ticket.linkedCases.map((value, index) => (
                    <li key={index}>
                      <LinkedCaseField
                        slot={index + 1}
                        value={value}
                        onSave={(next) => onLinkedCaseChange(ticket.rowId, index as 0 | 1 | 2, next)}
                      />
                    </li>
                  ))}
                </ul>
              </li>
              <li className="rounded border border-zendesk-border bg-white p-2">
                <p className="text-xs font-medium text-zendesk-navy" data-help-tour="external-tools">
                  External tools
                </p>
                <p className="mt-0.5 text-[10px] text-zendesk-muted">
                  Configure in Preferences
                </p>
                {configuredExternalTools.length > 0 ? (
                  <ul className="mt-2 space-y-1">
                    {configuredExternalTools.map((tool, index) => (
                      <li key={index}>
                        <a
                          href={tool.href}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline"
                        >
                          {tool.label}
                          <ExternalLink className="h-3 w-3 shrink-0" />
                        </a>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-2 text-[10px] text-zendesk-muted">
                    No shortcuts yet — add label and URL in Preferences → External tools.
                  </p>
                )}
              </li>
            </ul>
          </div>

          <MixmaxTemplatePicker
            templateContext={{
              fullName: ticket.requesterName,
              email: ticket.requesterEmail,
            }}
            onApply={applyTemplate}
            onExpandedChange={(open) => {
              setMixmaxExpanded(open);
              if (open) setSendArchiveExpanded(false);
            }}
          />
          <div className="shrink-0 border-t border-zendesk-border bg-zendesk-sidebar p-3">
            <button
              type="button"
              onClick={() => setTrustEscalationsOpen(true)}
              title="Trust Escalations — choose the right escalation path"
              aria-label="Trust Escalations"
              data-help-tour="trust-escalations"
              className="flex w-full items-start gap-1.5 text-left"
            >
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-zendesk-teal" />
              <span className="block text-xs font-semibold uppercase text-zendesk-muted">
                Trust escalations
              </span>
            </button>
          </div>
          <SendArchivePanel
            onExpandedChange={(open) => {
              setSendArchiveExpanded(open);
              if (open) setMixmaxExpanded(false);
            }}
          />
          {trustEscalationsOpen && (
            <TrustEscalationsModal onClose={() => setTrustEscalationsOpen(false)} />
          )}
        </aside>
        )}
      </div>

      {redactConfirmMessage && (
        <RedactMessageConfirmModal
          messageSummary={redactConfirmMessage.subject || "Message"}
          messageWhen={new Date(redactConfirmMessage.sentAt).toLocaleString()}
          busy={redactingMessageId === redactConfirmMessage.id}
          onCancel={() => {
            if (!redactingMessageId) setRedactConfirmMessage(null);
          }}
          onConfirm={() => void performRedactMessage(redactConfirmMessage)}
        />
      )}
      {resetGmailLinkConfirmOpen && (
        <ResetGmailLinkConfirmModal
          busy={resettingGmailLink}
          onCancel={() => {
            if (!resettingGmailLink) setResetGmailLinkConfirmOpen(false);
          }}
          onConfirm={() => void performResetGmailLink()}
        />
      )}
    </main>
  );
}

function LinkedCaseField({
  slot,
  value,
  onSave,
}: {
  slot: number;
  value: string;
  onSave: (value: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const parsed = parseLinkedCase(value);
  const hasLink = Boolean(parsed.url);

  async function copyUrl() {
    if (!parsed.url) return;
    await navigator.clipboard.writeText(parsed.url);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  return (
    <>
      <div className="flex min-w-0 items-start gap-1 text-xs">
        <span className="mt-0.5 w-3.5 shrink-0 text-[10px] text-zendesk-muted">{slot}.</span>
        {hasLink ? (
          <a
            href={parsed.url!}
            target="_blank"
            rel="noopener noreferrer"
            title={parsed.url!}
            className="min-w-0 flex-1 truncate text-sm font-medium text-blue-600 hover:underline"
          >
            {parsed.label || "Link"}
          </a>
        ) : parsed.label ? (
          <span className="min-w-0 flex-1 truncate text-sm text-zendesk-muted" title={parsed.label}>
            {parsed.label}
          </span>
        ) : (
          <span className="min-w-0 flex-1 text-sm text-zendesk-muted">—</span>
        )}
        {hasLink && (
          <button
            type="button"
            onClick={copyUrl}
            title={copied ? "Copied!" : "Copy URL"}
            aria-label={copied ? "Copied" : "Copy URL"}
            className="shrink-0 rounded p-0.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        <button
          type="button"
          onClick={() => setEditOpen(true)}
          title={`Edit linked case ${slot}`}
          aria-label={`Edit linked case ${slot}`}
          className="shrink-0 rounded p-0.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </div>
      {editOpen && (
        <LinkedCaseEditModal
          slot={slot}
          value={value}
          onSave={onSave}
          onClose={() => setEditOpen(false)}
        />
      )}
    </>
  );
}

function NovaSheetLinkField({
  label,
  value,
  href,
  maxDisplayLength,
  openInLabel = "Nova",
  onSave,
}: {
  label: string;
  value: string;
  href: string | null;
  maxDisplayLength?: number;
  openInLabel?: string;
  onSave?: (value: string) => void | Promise<void>;
}) {
  const [copied, setCopied] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const trimmed = value.trim();

  useEffect(() => {
    if (!isEditing) setDraft(value);
  }, [value, isEditing]);

  const displayValue =
    maxDisplayLength && trimmed.length > maxDisplayLength
      ? `${trimmed.slice(0, maxDisplayLength)}…`
      : trimmed || "—";

  async function copyValue() {
    if (!trimmed) return;
    await navigator.clipboard.writeText(trimmed);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  }

  async function saveDraft() {
    const next = draft.trim();
    if (next === trimmed) {
      setIsEditing(false);
      return;
    }
    await onSave?.(next);
    setIsEditing(false);
  }

  return (
    <label className="flex items-center gap-1.5 text-xs">
      <span className="text-zendesk-muted">{label}</span>
      <span className="flex items-center gap-1">
        {isEditing ? (
          <input
            type="text"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={() => void saveDraft()}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setDraft(value);
                setIsEditing(false);
              }
            }}
            autoFocus
            className="w-28 rounded border border-zendesk-green px-1.5 py-0.5 font-mono text-xs outline-none"
          />
        ) : href ? (
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            title={
              trimmed
                ? `Open in ${openInLabel} (${label}): ${trimmed}`
                : `Open in ${openInLabel} (${label})`
            }
            className="rounded border border-zendesk-border bg-white px-1.5 py-0.5 font-mono text-xs text-blue-600 hover:bg-gray-100 hover:underline"
          >
            {displayValue}
          </a>
        ) : (
          <span
            className="rounded border border-zendesk-border px-1.5 py-0.5 font-mono text-xs text-zendesk-muted"
            title={trimmed || undefined}
          >
            {displayValue}
          </span>
        )}
        {trimmed && !isEditing && (
          <button
            type="button"
            onClick={copyValue}
            title={copied ? "Copied!" : `Copy ${label}`}
            aria-label={copied ? "Copied" : `Copy ${label} to clipboard`}
            className="rounded border border-zendesk-border p-1 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
          >
            <Copy className="h-3.5 w-3.5" />
          </button>
        )}
        {onSave && !isEditing && (
          <button
            type="button"
            onClick={() => setIsEditing(true)}
            title={`Edit ${label}`}
            aria-label={`Edit ${label}`}
            className="rounded border border-zendesk-border p-1 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
        )}
      </span>
    </label>
  );
}
