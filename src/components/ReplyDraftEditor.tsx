"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { compactDraftBlockSpacing, isRichTextEmpty } from "@/lib/html-utils";
import {
  Bold,
  ChevronDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  Link2,
  List,
  ListOrdered,
  Mail,
  Underline,
} from "lucide-react";

const FONT_SIZES = [
  { label: "Small", value: "13px" },
  { label: "Normal", value: "14px" },
  { label: "Large", value: "16px" },
  { label: "X-Large", value: "18px" },
] as const;

export interface ReplyDraftEditorHandle {
  focus: () => void;
  /** Sync contentEditable DOM into parent state; returns current HTML. */
  flush: () => string;
  /** Insert HTML at the saved cursor, or at the end if the editor is not focused. */
  insertHtmlAtCursor: (html: string) => void;
}

interface ReplyDraftEditorProps {
  value: string;
  onChange: (html: string) => void;
  focused: boolean;
  onFocusChange: (focused: boolean) => void;
  placeholder?: string;
  /** Fill space between header and send actions instead of a fixed expanded height. */
  fillAvailable?: boolean;
  onDraftInGmail?: () => void;
}

function ToolbarButton({
  title,
  onMouseDown,
  onClick,
  children,
}: {
  title: string;
  onMouseDown?: () => void;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onMouseDown={(event) => {
        onMouseDown?.();
        event.preventDefault();
      }}
      onClick={onClick}
      className="rounded p-1.5 text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
    >
      {children}
    </button>
  );
}

function normalizeLinkHref(url: string): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (/^(https?:\/\/|mailto:)/i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

function findAnchorFromSelection(editor: HTMLElement): HTMLAnchorElement | null {
  const selection = window.getSelection();
  if (!selection?.rangeCount) return null;
  let node: Node | null = selection.anchorNode;
  while (node && node !== editor) {
    if (node.nodeName === "A") return node as HTMLAnchorElement;
    node = node.parentNode;
  }
  return null;
}

function findAnchorInRange(range: Range, editor: HTMLElement): HTMLAnchorElement | null {
  const anchors = editor.querySelectorAll("a");
  for (const anchor of anchors) {
    if (range.intersectsNode(anchor)) return anchor;
  }
  return null;
}

function isRangeValidInEditor(range: Range, editor: HTMLElement): boolean {
  return (
    range.startContainer.isConnected &&
    range.endContainer.isConnected &&
    editor.contains(range.commonAncestorContainer)
  );
}

function placeCaretAfter(node: Node) {
  const selection = window.getSelection();
  if (!selection) return;
  const after = document.createRange();
  after.setStartAfter(node);
  after.collapse(true);
  selection.removeAllRanges();
  selection.addRange(after);
}

function wrapRangeWithLink(range: Range, href: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";

  if (range.collapsed) {
    anchor.textContent = href.replace(/^https?:\/\//i, "");
    range.insertNode(anchor);
    return anchor;
  }

  try {
    range.surroundContents(anchor);
  } catch {
    const contents = range.extractContents();
    anchor.appendChild(contents);
    range.insertNode(anchor);
  }

  return anchor;
}

function linkShortcutLabel(): string {
  if (typeof navigator === "undefined") return "Ctrl+K";
  return /mac/i.test(navigator.platform) ? "⌘K" : "Ctrl+K";
}

export const ReplyDraftEditor = forwardRef<ReplyDraftEditorHandle, ReplyDraftEditorProps>(
  function ReplyDraftEditor(
    { value, onChange, focused, onFocusChange, placeholder, fillAvailable = false, onDraftInGmail },
    ref
  ) {
    const composerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const sizeMenuRef = useRef<HTMLDivElement>(null);
    const linkDialogRef = useRef<HTMLDivElement>(null);
    const linkUrlInputRef = useRef<HTMLInputElement>(null);
    const savedSelectionRef = useRef<Range | null>(null);
    const linkDialogOpenRef = useRef(false);
    const lastValueRef = useRef(value);
    const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState("");
    const [linkHasSelection, setLinkHasSelection] = useState(false);

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;

      if (document.activeElement === editor) {
        // Parent re-rendered during typing (e.g. ticket refresh) — keep live DOM + cursor.
        lastValueRef.current = editor.innerHTML;
        return;
      }

      if (value === lastValueRef.current) return;
      const normalized = compactDraftBlockSpacing(value);
      lastValueRef.current = normalized;
      if (editor.innerHTML !== normalized) {
        editor.innerHTML = normalized;
        updateEmptyState(normalized);
      }
      if (normalized !== value) {
        onChange(normalized);
      }
    }, [value, onChange]);

    useEffect(() => {
      if (!sizeMenuOpen && !linkDialogOpen) return;

      function handlePointerDown(event: MouseEvent) {
        const target = event.target as Node;
        if (sizeMenuOpen && sizeMenuRef.current?.contains(target)) return;
        if (linkDialogOpen && linkDialogRef.current?.contains(target)) return;
        setSizeMenuOpen(false);
        setLinkDialogOpen(false);
      }

      document.addEventListener("mousedown", handlePointerDown);
      return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [sizeMenuOpen, linkDialogOpen]);

    useEffect(() => {
      linkDialogOpenRef.current = linkDialogOpen;
    }, [linkDialogOpen]);

    useEffect(() => {
      if (!linkDialogOpen) return;
      linkUrlInputRef.current?.focus();
      linkUrlInputRef.current?.select();
    }, [linkDialogOpen]);

    function updateEmptyState(html: string) {
      editorRef.current?.setAttribute("data-empty", isRichTextEmpty(html) ? "true" : "false");
    }

    function saveSelection() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !editorRef.current) return;

      const range = selection.getRangeAt(0);
      if (!editorRef.current.contains(range.commonAncestorContainer)) return;
      savedSelectionRef.current = range.cloneRange();
    }

    function restoreSelection(): boolean {
      const saved = savedSelectionRef.current;
      const editor = editorRef.current;
      const selection = window.getSelection();
      if (!saved || !editor || !selection || !isRangeValidInEditor(saved, editor)) return false;

      const range = saved.cloneRange();
      selection.removeAllRanges();
      selection.addRange(range);
      return editor.contains(selection.anchorNode);
    }

    function ensureEditorFocus() {
      onFocusChange(true);
      editorRef.current?.focus();
      if (!restoreSelection()) {
        const selection = window.getSelection();
        if (!selection || !editorRef.current) return;

        const range = document.createRange();
        range.selectNodeContents(editorRef.current);
        range.collapse(isRichTextEmpty(editorRef.current.innerHTML));
        selection.removeAllRanges();
        selection.addRange(range);
        savedSelectionRef.current = range.cloneRange();
      }
    }

    function syncContent() {
      const html = editorRef.current?.innerHTML ?? "";
      lastValueRef.current = html;
      updateEmptyState(html);
      onChange(html);
      saveSelection();
    }

    function insertHtmlAtCursor(html: string) {
      const normalized = compactDraftBlockSpacing(html);
      const editor = editorRef.current;
      if (!normalized || !editor) return;

      onFocusChange(true);
      editor.focus();

      if (!restoreSelection()) {
        const selection = window.getSelection();
        if (selection) {
          const range = document.createRange();
          range.selectNodeContents(editor);
          range.collapse(false);
          selection.removeAllRanges();
          selection.addRange(range);
          savedSelectionRef.current = range.cloneRange();
        }
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      const beforeRange = document.createRange();
      beforeRange.selectNodeContents(editor);
      beforeRange.setEnd(range.startContainer, range.startOffset);
      const beforeContainer = document.createElement("div");
      beforeContainer.appendChild(beforeRange.cloneContents());
      const hasContentBefore = !isRichTextEmpty(beforeContainer.innerHTML);

      let toInsert = normalized;
      if (hasContentBefore && range.collapsed) {
        toInsert = `<br><br>${normalized}`;
      }

      if (!range.collapsed) {
        range.deleteContents();
      }

      document.execCommand("insertHTML", false, toInsert);
      syncContent();
    }

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
      flush: () => {
        syncContent();
        return editorRef.current?.innerHTML ?? "";
      },
      insertHtmlAtCursor,
    }));

    function runCommand(command: string, commandValue?: string) {
      ensureEditorFocus();
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, commandValue);
      syncContent();
    }

    function insertList(ordered: boolean) {
      ensureEditorFocus();
      const command = ordered ? "insertOrderedList" : "insertUnorderedList";
      document.execCommand("styleWithCSS", false, "true");
      const worked = document.execCommand(command);

      const hasList = Boolean(editorRef.current?.querySelector("ul, ol"));
      if (!worked || !hasList) {
        const tag = ordered ? "ol" : "ul";
        const selection = window.getSelection();
        const text = selection?.toString() || "";
        const itemHtml = text
          ? `<${tag}><li>${text}</li></${tag}>`
          : `<${tag}><li><br></li></${tag}>`;
        document.execCommand("insertHTML", false, itemHtml);
      }

      syncContent();
    }

    function openLinkDialog() {
      saveSelection();
      const editor = editorRef.current;
      const selection = window.getSelection();
      const selectedText = selection?.toString() ?? "";
      const existingAnchor = editor ? findAnchorFromSelection(editor) : null;

      setLinkHasSelection(selectedText.trim().length > 0);
      setLinkUrl(existingAnchor?.getAttribute("href") ?? "");
      setSizeMenuOpen(false);
      setLinkDialogOpen(true);
    }

    function applyLink() {
      const href = normalizeLinkHref(linkUrl);
      if (!href) {
        setLinkDialogOpen(false);
        return;
      }

      const editor = editorRef.current;
      const saved = savedSelectionRef.current;
      if (!editor || !saved || !isRangeValidInEditor(saved, editor)) {
        setLinkDialogOpen(false);
        return;
      }

      const range = saved.cloneRange();
      editor.focus();

      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range.cloneRange());
      }

      const existingAnchor = findAnchorInRange(range, editor) ?? findAnchorFromSelection(editor);
      if (existingAnchor) {
        existingAnchor.href = href;
        existingAnchor.target = "_blank";
        existingAnchor.rel = "noopener noreferrer";
        placeCaretAfter(existingAnchor);
      } else {
        const anchor = wrapRangeWithLink(range, href);
        placeCaretAfter(anchor);
      }

      setLinkDialogOpen(false);
      setLinkUrl("");
      syncContent();
    }

    function handleEditorKeyDown(event: KeyboardEvent<HTMLDivElement>) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openLinkDialog();
      }
    }

    function applyFontSize(size: string) {
      ensureEditorFocus();
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      const range = selection.getRangeAt(0);
      if (selection.isCollapsed) {
        document.execCommand(
          "insertHTML",
          false,
          `<span style="font-size: ${size}">&#8203;</span>`
        );
      } else {
        const span = document.createElement("span");
        span.style.fontSize = size;
        try {
          range.surroundContents(span);
        } catch {
          document.execCommand(
            "insertHTML",
            false,
            `<span style="font-size: ${size}">${range.toString()}</span>`
          );
        }
      }

      setSizeMenuOpen(false);
      syncContent();
    }

    function handleComposerBlur(event: FocusEvent<HTMLDivElement>) {
      const next = event.relatedTarget as Node | null;
      if (next && composerRef.current?.contains(next)) return;
      if (linkDialogOpenRef.current) return;
      syncContent();
      onFocusChange(false);
      setSizeMenuOpen(false);
      setLinkDialogOpen(false);
    }

    const collapsedHeight = "4.5rem";
    const expandedHeight = "16rem";
    const useFlexFill = fillAvailable && focused;

    return (
      <div
        ref={composerRef}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={handleComposerBlur}
        className={`flex w-full flex-col ${
          fillAvailable ? (focused ? "min-h-0 flex-1" : "mt-auto shrink-0") : "shrink-0"
        }`}
      >
        <div
          className={`overflow-hidden transition-[height,flex] duration-200 ease-out ${
            useFlexFill ? "min-h-[4.5rem] flex-1" : ""
          }`}
          style={
            useFlexFill
              ? undefined
              : { height: focused ? expandedHeight : collapsedHeight }
          }
        >
          <div
            ref={editorRef}
            contentEditable
            suppressContentEditableWarning
            spellCheck
            role="textbox"
            aria-multiline="true"
            data-placeholder={placeholder}
            data-empty="true"
            onInput={syncContent}
            onKeyDown={handleEditorKeyDown}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onFocus={saveSelection}
            className={`reply-draft-editor h-full w-full resize-none overflow-y-auto rounded border p-3 text-sm outline-none transition-[background-color,border-color] duration-200 ease-out focus:border-zendesk-green ${
              focused
                ? "border-sky-300 bg-sky-100"
                : "border-sky-200/70 bg-sky-100/65"
            }`}
          />
        </div>
        <div className="mt-1.5 flex shrink-0 items-center justify-between gap-2 rounded border border-zendesk-border bg-gray-50 px-1 py-0.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          <ToolbarButton title="Bold" onMouseDown={saveSelection} onClick={() => runCommand("bold")}>
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            onMouseDown={saveSelection}
            onClick={() => runCommand("italic")}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            onMouseDown={saveSelection}
            onClick={() => runCommand("underline")}
          >
            <Underline className="h-3.5 w-3.5" />
          </ToolbarButton>
          <div ref={linkDialogRef} className="relative">
            <ToolbarButton
              title={`Insert link (${linkShortcutLabel()})`}
              onMouseDown={saveSelection}
              onClick={openLinkDialog}
            >
              <Link2 className="h-3.5 w-3.5" />
            </ToolbarButton>
            {linkDialogOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-1 w-64 rounded border border-zendesk-border bg-white p-2 shadow-lg">
                <label className="block text-[10px] font-medium text-zendesk-muted">
                  Link URL
                </label>
                <input
                  ref={linkUrlInputRef}
                  type="url"
                  value={linkUrl}
                  onChange={(e) => setLinkUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      applyLink();
                    }
                    if (e.key === "Escape") {
                      e.preventDefault();
                      setLinkDialogOpen(false);
                    }
                  }}
                  placeholder="https://…"
                  className="mt-1 w-full rounded border border-zendesk-border px-2 py-1.5 text-xs outline-none focus:border-zendesk-green"
                />
                <p className="mt-1 text-[10px] text-zendesk-muted">
                  {linkHasSelection
                    ? "Applies to selected text."
                    : "Inserts the URL as link text."}
                </p>
                <div className="mt-2 flex justify-end gap-1.5">
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setLinkDialogOpen(false)}
                    className="rounded px-2 py-1 text-[11px] text-zendesk-muted hover:bg-gray-100"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={applyLink}
                    className="rounded bg-zendesk-green px-2 py-1 text-[11px] font-medium text-white hover:opacity-90"
                  >
                    Apply
                  </button>
                </div>
              </div>
            )}
          </div>
          <span className="mx-1 h-4 w-px bg-zendesk-border" aria-hidden />
          <div ref={sizeMenuRef} className="relative">
            <button
              type="button"
              title="Font size"
              aria-label="Font size"
              aria-expanded={sizeMenuOpen}
              onMouseDown={(event) => {
                saveSelection();
                event.preventDefault();
              }}
              onClick={() => setSizeMenuOpen((open) => !open)}
              className="inline-flex items-center gap-0.5 rounded border border-zendesk-border bg-white px-1.5 py-1 text-[11px] font-medium text-zendesk-navy hover:bg-gray-100"
            >
              Size
              <ChevronDown className="h-3 w-3" />
            </button>
            {sizeMenuOpen && (
              <div className="absolute left-0 top-full z-20 mt-1 min-w-[6.5rem] rounded border border-zendesk-border bg-white py-1 shadow-md">
                {FONT_SIZES.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    onMouseDown={(event) => {
                      saveSelection();
                      event.preventDefault();
                    }}
                    onClick={() => applyFontSize(size.value)}
                    className="block w-full px-3 py-1.5 text-left text-[11px] text-zendesk-navy hover:bg-gray-100"
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span className="mx-1 h-4 w-px bg-zendesk-border" aria-hidden />
          <ToolbarButton
            title="Bullet list"
            onMouseDown={saveSelection}
            onClick={() => insertList(false)}
          >
            <List className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Numbered list"
            onMouseDown={saveSelection}
            onClick={() => insertList(true)}
          >
            <ListOrdered className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Increase indent"
            onMouseDown={saveSelection}
            onClick={() => runCommand("indent")}
          >
            <IndentIncrease className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Decrease indent"
            onMouseDown={saveSelection}
            onClick={() => runCommand("outdent")}
          >
            <IndentDecrease className="h-3.5 w-3.5" />
          </ToolbarButton>
          </div>
          {onDraftInGmail && (
            <button
              type="button"
              onClick={onDraftInGmail}
              title="Open Gmail compose in a popup with this draft (plain text)"
              className="inline-flex shrink-0 items-center gap-1 rounded border border-zendesk-border bg-white px-2 py-1 text-[11px] font-medium text-zendesk-navy hover:bg-gray-100"
            >
              <Mail className="h-3.5 w-3.5" />
              Draft in Gmail
            </button>
          )}
        </div>
      </div>
    );
  }
);
