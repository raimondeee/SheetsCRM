"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import {
  isRichTextEmpty,
  looksLikeHtml,
  normalizeDraftHtml,
  plainTextToHtml,
  sanitizeDraftPasteHtml,
} from "@/lib/html-utils";
import {
  AlignVerticalSpaceAround,
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

/** Gmail-style relative presets (approximate px equivalents). */
const FONT_SIZES = [
  { label: "Small", value: "10px" },
  { label: "Normal", value: "14px" },
  { label: "Large", value: "18px" },
  { label: "Huge", value: "32px" },
] as const;

const TEXT_COLORS = [
  { label: "Black", value: "#000000" },
  { label: "Blue", value: "#2563eb" },
  { label: "Red", value: "#dc2626" },
  { label: "Grey", value: "#6b7280" },
] as const;

const LINE_SPACINGS = [
  { label: "Normal", value: "normal" },
  { label: "1.15", value: "1.15" },
  { label: "1.5", value: "1.5" },
  { label: "Double", value: "2" },
] as const;

const BLOCK_TAGS = new Set(["P", "DIV", "LI", "H1", "H2", "H3", "H4", "H5", "H6"]);

const DEFAULT_TEXT_COLOR: string = TEXT_COLORS[0].value;

export interface ReplyDraftEditorHandle {
  focus: () => void;
  /** Sync contentEditable DOM into parent state; returns current HTML. */
  flush: () => string;
  /** Replace the entire editor contents (e.g. applying a Mixmax template). */
  replaceHtml: (html: string) => void;
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
  /** When true with fillAvailable, use flex height even when the editor is not focused. */
  alwaysExpand?: boolean;
  onDraftInGmail?: () => void;
}

function ToolbarButton({
  title,
  active = false,
  onMouseDown,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onMouseDown?: () => void;
  onClick: () => void;
  children: ReactNode;
}) {
  const tooltip = active ? `${title} (on)` : `${title} (off)`;
  return (
    <button
      type="button"
      title={tooltip}
      aria-label={tooltip}
      aria-pressed={active}
      onMouseDown={(event) => {
        onMouseDown?.();
        event.preventDefault();
      }}
      onClick={onClick}
      className={`rounded p-1.5 ${
        active
          ? "bg-zendesk-navy text-white hover:bg-zendesk-navy/90"
          : "text-zendesk-muted hover:bg-gray-100 hover:text-zendesk-navy"
      }`}
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

/** Prefer DOM insert over execCommand so pasted emphasis/spacing is not flattened. */
function insertHtmlFragment(html: string): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;

  const range = selection.getRangeAt(0);
  range.deleteContents();

  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  const lastNode = fragment.lastChild;
  range.insertNode(fragment);

  if (lastNode) {
    placeCaretAfter(lastNode);
  } else {
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }
  return true;
}

function wrapRangeInStyledSpan(
  range: Range,
  styles: Partial<CSSStyleDeclaration>
): HTMLSpanElement {
  const span = document.createElement("span");
  Object.assign(span.style, styles);

  if (range.collapsed) {
    span.appendChild(document.createTextNode("\u200B"));
    range.insertNode(span);
    const selection = window.getSelection();
    if (selection) {
      const caret = document.createRange();
      caret.selectNodeContents(span);
      caret.collapse(false);
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    return span;
  }

  const contents = range.extractContents();
  span.appendChild(contents);
  range.insertNode(span);
  selectNodeContents(span);
  return span;
}

function selectNodeContents(node: Node) {
  const selection = window.getSelection();
  if (!selection) return;
  const next = document.createRange();
  next.selectNodeContents(node);
  selection.removeAllRanges();
  selection.addRange(next);
}

function getTextNodesInRange(range: Range): Text[] {
  const ancestor =
    range.commonAncestorContainer.nodeType === Node.TEXT_NODE
      ? range.commonAncestorContainer.parentNode
      : range.commonAncestorContainer;
  if (!ancestor) return [];

  const nodes: Text[] = [];
  const walker = document.createTreeWalker(ancestor, NodeFilter.SHOW_TEXT);
  let current: Node | null;
  while ((current = walker.nextNode())) {
    const text = current as Text;
    if (!text.data) continue;
    if (!range.intersectsNode(text)) continue;
    nodes.push(text);
  }
  return nodes;
}

function applyFontSizeToTextNode(textNode: Text, range: Range, size: string) {
  let start = 0;
  let end = textNode.length;
  if (textNode === range.startContainer) start = range.startOffset;
  if (textNode === range.endContainer) end = range.endOffset;
  if (start >= end) return;

  const nodeRange = document.createRange();
  nodeRange.setStart(textNode, start);
  nodeRange.setEnd(textNode, end);

  const span = document.createElement("span");
  span.style.fontSize = size;
  const contents = nodeRange.extractContents();
  span.appendChild(contents);
  nodeRange.insertNode(span);
}

function applyFontSizeToRange(range: Range, size: string) {
  if (range.collapsed) {
    wrapRangeInStyledSpan(range, { fontSize: size });
    return;
  }

  const textNodes = getTextNodesInRange(range);
  if (textNodes.length === 0) return;

  if (textNodes.length === 1) {
    applyFontSizeToTextNode(textNodes[0], range, size);
    return;
  }

  for (const textNode of [...textNodes].reverse()) {
    applyFontSizeToTextNode(textNode, range, size);
  }
}

function isBlockElement(node: Node): node is HTMLElement {
  return node instanceof HTMLElement && BLOCK_TAGS.has(node.tagName);
}

function getBlockElementsInRange(range: Range, editor: HTMLElement): HTMLElement[] {
  const candidates: HTMLElement[] = [];
  const walker = document.createTreeWalker(editor, NodeFilter.SHOW_ELEMENT);

  let current: Node | null;
  while ((current = walker.nextNode())) {
    const element = current as HTMLElement;
    if (!BLOCK_TAGS.has(element.tagName)) continue;
    if (range.intersectsNode(element)) candidates.push(element);
  }

  if (candidates.length === 0) {
    let node: Node | null = range.commonAncestorContainer;
    if (node.nodeType === Node.TEXT_NODE) node = node.parentNode;
    while (node && node !== editor) {
      if (isBlockElement(node)) {
        candidates.push(node);
        break;
      }
      node = node.parentNode;
    }
  }

  return candidates.filter(
    (block) => !candidates.some((other) => other !== block && other.contains(block))
  );
}

function clearInlineLineHeight(element: HTMLElement) {
  element.style.lineHeight = "";
  if (!element.getAttribute("style")?.trim()) {
    element.removeAttribute("style");
  }
}

function stripLineHeightFromTree(root: HTMLElement) {
  clearInlineLineHeight(root);
  for (const descendant of root.querySelectorAll("[style]")) {
    clearInlineLineHeight(descendant as HTMLElement);
  }
}

function applyLineHeightToBlock(block: HTMLElement, lineHeight: string) {
  if (lineHeight === "normal") {
    stripLineHeightFromTree(block);
    return;
  }

  block.style.lineHeight = lineHeight;
  for (const descendant of block.querySelectorAll("[style*='line-height']")) {
    clearInlineLineHeight(descendant as HTMLElement);
  }
}

function applyLineSpacingToRange(range: Range, editor: HTMLElement, lineHeight: string) {
  const blocks = getBlockElementsInRange(range, editor);
  if (blocks.length === 0) {
    if (lineHeight === "normal") {
      stripLineHeightFromTree(editor);
    } else {
      wrapRangeInStyledSpan(range, { lineHeight });
    }
    return;
  }

  for (const block of blocks) {
    applyLineHeightToBlock(block, lineHeight);
  }
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
    {
      value,
      onChange,
      focused,
      onFocusChange,
      placeholder,
      fillAvailable = false,
      alwaysExpand = false,
      onDraftInGmail,
    },
    ref
  ) {
    const composerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const sizeMenuRef = useRef<HTMLDivElement>(null);
    const colorMenuRef = useRef<HTMLDivElement>(null);
    const lineSpacingMenuRef = useRef<HTMLDivElement>(null);
    const linkDialogRef = useRef<HTMLDivElement>(null);
    const linkUrlInputRef = useRef<HTMLInputElement>(null);
    const savedSelectionRef = useRef<Range | null>(null);
    const linkDialogOpenRef = useRef(false);
    const lastValueRef = useRef(value);
    const onChangeRef = useRef(onChange);
    onChangeRef.current = onChange;
    const [sizeMenuOpen, setSizeMenuOpen] = useState(false);
    const [colorMenuOpen, setColorMenuOpen] = useState(false);
    const [lineSpacingMenuOpen, setLineSpacingMenuOpen] = useState(false);
    const [textColor, setTextColor] = useState(DEFAULT_TEXT_COLOR);
    const [linkDialogOpen, setLinkDialogOpen] = useState(false);
    const [linkUrl, setLinkUrl] = useState("");
    const [linkHasSelection, setLinkHasSelection] = useState(false);
    const [formatActive, setFormatActive] = useState({
      bold: false,
      italic: false,
      underline: false,
    });

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;

      const normalized = normalizeDraftHtml(value);

      if (document.activeElement === editor) {
        const editorEmpty = isRichTextEmpty(editor.innerHTML);
        const valueEmpty = isRichTextEmpty(normalized);
        // While typing, the DOM is authoritative — parent re-renders (e.g. sync
        // countdown ticks) must not clobber innerHTML and reset the caret.
        if (!valueEmpty || editorEmpty) {
          return;
        }
      } else if (normalized === lastValueRef.current) {
        return;
      }

      lastValueRef.current = normalized;
      if (editor.innerHTML !== normalized) {
        editor.innerHTML = normalized;
        updateEmptyState(normalized);
      }
      if (normalized !== value) {
        onChangeRef.current(normalized);
      }
    }, [value]);

    useEffect(() => {
      if (!sizeMenuOpen && !colorMenuOpen && !lineSpacingMenuOpen && !linkDialogOpen) return;

      function handlePointerDown(event: MouseEvent) {
        const target = event.target as Node;
        if (sizeMenuOpen && sizeMenuRef.current?.contains(target)) return;
        if (colorMenuOpen && colorMenuRef.current?.contains(target)) return;
        if (lineSpacingMenuOpen && lineSpacingMenuRef.current?.contains(target)) return;
        if (linkDialogOpen && linkDialogRef.current?.contains(target)) return;
        setSizeMenuOpen(false);
        setColorMenuOpen(false);
        setLineSpacingMenuOpen(false);
        setLinkDialogOpen(false);
      }

      document.addEventListener("mousedown", handlePointerDown);
      return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [sizeMenuOpen, colorMenuOpen, lineSpacingMenuOpen, linkDialogOpen]);

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

    function syncFormatActive() {
      const editor = editorRef.current;
      if (!editor || document.activeElement !== editor) {
        setFormatActive({ bold: false, italic: false, underline: false });
        return;
      }
      try {
        setFormatActive({
          bold: document.queryCommandState("bold"),
          italic: document.queryCommandState("italic"),
          underline: document.queryCommandState("underline"),
        });
      } catch {
        setFormatActive({ bold: false, italic: false, underline: false });
      }
    }

    function saveSelection() {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !editorRef.current) return;

      const range = selection.getRangeAt(0);
      if (!editorRef.current.contains(range.commonAncestorContainer)) return;
      savedSelectionRef.current = range.cloneRange();
      syncFormatActive();
    }

    useEffect(() => {
      function onSelectionChange() {
        const editor = editorRef.current;
        if (!editor || document.activeElement !== editor) return;
        syncFormatActive();
      }
      document.addEventListener("selectionchange", onSelectionChange);
      return () => document.removeEventListener("selectionchange", onSelectionChange);
    }, []);

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

    function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
      const clipboard = event.clipboardData;
      if (!clipboard) return;

      const html = clipboard.getData("text/html");
      const text = clipboard.getData("text/plain");
      if (!html && !text) return;

      event.preventDefault();
      // Keep the browser's paste caret — do not restoreSelection() here (that jumps
      // the insertion point and also breaks Cmd/Ctrl+Z for the paste).

      const toInsert =
        html && looksLikeHtml(html) ? sanitizeDraftPasteHtml(html) : plainTextToHtml(text);
      if (!toInsert) return;

      // insertHTML participates in the contentEditable undo stack; DOM insertNode does not.
      const inserted = document.execCommand("insertHTML", false, toInsert);
      if (!inserted) {
        insertHtmlFragment(toInsert);
      }
      syncContent();
    }

    function replaceHtml(html: string) {
      const normalized = normalizeDraftHtml(html);
      const editor = editorRef.current;
      if (!editor) return;

      lastValueRef.current = normalized;
      if (editor.innerHTML !== normalized) {
        editor.innerHTML = normalized;
        updateEmptyState(normalized);
      }
      onChange(normalized);
    }

    function insertHtmlAtCursor(html: string) {
      const normalized = normalizeDraftHtml(html);
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
      replaceHtml,
      insertHtmlAtCursor,
    }));

    function runCommand(command: string, commandValue?: string) {
      ensureEditorFocus();
      document.execCommand("styleWithCSS", false, "true");
      document.execCommand(command, false, commandValue);
      syncContent();
      syncFormatActive();
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
      setColorMenuOpen(false);
      setLineSpacingMenuOpen(false);
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

    function handleEditorClick(event: ReactMouseEvent<HTMLDivElement>) {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a[href]");
      if (!anchor || !editorRef.current?.contains(anchor)) return;

      const href = anchor.getAttribute("href")?.trim();
      if (!href || href.startsWith("#")) return;

      const selection = window.getSelection();
      if (selection && !selection.isCollapsed && selection.toString()) {
        return;
      }

      event.preventDefault();
      window.open(href, "_blank", "noopener,noreferrer");
    }

    function getEditorRangeForFormatting(): Range | null {
      const editor = editorRef.current;
      if (!editor) return null;

      onFocusChange(true);
      editor.focus();

      const saved = savedSelectionRef.current;
      if (saved && isRangeValidInEditor(saved, editor)) {
        const range = saved.cloneRange();
        const selection = window.getSelection();
        if (selection) {
          selection.removeAllRanges();
          selection.addRange(range);
        }
        return range;
      }

      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return null;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.commonAncestorContainer)) return null;
      savedSelectionRef.current = range.cloneRange();
      return range;
    }

    function applyFontSize(size: string) {
      const range = getEditorRangeForFormatting();
      if (!range) return;

      applyFontSizeToRange(range, size);
      setSizeMenuOpen(false);
      syncContent();
    }

    function applyTextColor(color: string) {
      ensureEditorFocus();
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;

      document.execCommand("styleWithCSS", false, "true");
      const worked = document.execCommand("foreColor", false, color);
      if (!worked) {
        wrapRangeInStyledSpan(selection.getRangeAt(0), { color });
      }

      setTextColor(color);
      setColorMenuOpen(false);
      syncContent();
    }

    function applyLineSpacing(lineHeight: string) {
      const editor = editorRef.current;
      const range = getEditorRangeForFormatting();
      if (!editor || !range) return;

      applyLineSpacingToRange(range, editor, lineHeight);
      setLineSpacingMenuOpen(false);
      syncContent();
    }

    function handleComposerBlur(event: FocusEvent<HTMLDivElement>) {
      const next = event.relatedTarget as Node | null;
      if (next && composerRef.current?.contains(next)) return;
      if (linkDialogOpenRef.current) return;
      syncContent();
      onFocusChange(false);
      setSizeMenuOpen(false);
      setColorMenuOpen(false);
      setLineSpacingMenuOpen(false);
      setLinkDialogOpen(false);
    }

    const collapsedHeight = "4.5rem";
    const expandedHeight = "16rem";
    const useFlexFill = fillAvailable && (alwaysExpand || focused);

    return (
      <div
        ref={composerRef}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={handleComposerBlur}
        className={`flex w-full flex-col ${
          useFlexFill ? "min-h-0 flex-1" : fillAvailable ? "mt-auto shrink-0" : "shrink-0"
        }`}
      >
        <div
          className={
            useFlexFill ? "flex min-h-0 flex-1 flex-col" : "shrink-0"
          }
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
            onPaste={handlePaste}
            onKeyDown={handleEditorKeyDown}
            onClick={handleEditorClick}
            onKeyUp={saveSelection}
            onMouseUp={saveSelection}
            onFocus={saveSelection}
            className={`reply-draft-editor w-full resize-none overflow-y-auto rounded border p-3 text-sm outline-none transition-[background-color,border-color] duration-200 ease-out focus:border-zendesk-green ${
              useFlexFill ? "min-h-0 flex-1" : "h-full"
            } ${
              focused
                ? "border-sky-300 bg-sky-100"
                : "border-sky-200/70 bg-sky-100/65"
            }`}
          />
        </div>
        <div className="mt-1.5 flex shrink-0 items-center justify-between gap-2 rounded border border-zendesk-border bg-gray-50 px-1 py-0.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5">
          <ToolbarButton
            title="Bold"
            active={formatActive.bold}
            onMouseDown={saveSelection}
            onClick={() => runCommand("bold")}
          >
            <Bold className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Italic"
            active={formatActive.italic}
            onMouseDown={saveSelection}
            onClick={() => runCommand("italic")}
          >
            <Italic className="h-3.5 w-3.5" />
          </ToolbarButton>
          <ToolbarButton
            title="Underline"
            active={formatActive.underline}
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
          <div ref={sizeMenuRef} className="notranslate relative" translate="no">
            <button
              type="button"
              title="Font size"
              aria-label="Font size"
              aria-expanded={sizeMenuOpen}
              className="notranslate inline-flex items-center gap-0.5 rounded border border-zendesk-border bg-white px-1.5 py-1 text-[11px] font-medium text-zendesk-navy hover:bg-gray-100"
              translate="no"
              onMouseDown={(event) => {
                saveSelection();
                event.preventDefault();
              }}
              onClick={() => {
                setColorMenuOpen(false);
                setLineSpacingMenuOpen(false);
                setSizeMenuOpen((open) => !open);
              }}
            >
              Size
              <ChevronDown className="h-3 w-3" />
            </button>
            {sizeMenuOpen && (
              <div
                className="notranslate absolute bottom-full left-0 z-30 mb-1 min-w-[6.5rem] rounded border border-zendesk-border bg-white py-1 shadow-lg"
                translate="no"
              >
                {FONT_SIZES.map((size) => (
                  <button
                    key={size.value}
                    type="button"
                    className="notranslate block w-full px-3 py-1.5 text-left text-[11px] text-zendesk-navy hover:bg-gray-100"
                    translate="no"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyFontSize(size.value)}
                  >
                    {size.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div ref={colorMenuRef} className="relative">
            <button
              type="button"
              title="Text color"
              aria-label="Text color"
              aria-expanded={colorMenuOpen}
              onMouseDown={(event) => {
                saveSelection();
                event.preventDefault();
              }}
              onClick={() => {
                setSizeMenuOpen(false);
                setLineSpacingMenuOpen(false);
                setColorMenuOpen((open) => !open);
              }}
              className="inline-flex items-center gap-0.5 rounded border border-zendesk-border bg-white px-1 py-1 hover:bg-gray-100"
            >
              <span
                className="block h-3.5 w-3.5 rounded-sm border border-zendesk-border/60"
                style={{ backgroundColor: textColor }}
              />
              <ChevronDown className="h-3 w-3 text-zendesk-muted" />
            </button>
            {colorMenuOpen && (
              <div className="absolute bottom-full left-0 z-30 mb-1 min-w-[7rem] rounded border border-zendesk-border bg-white py-1 shadow-lg">
                {TEXT_COLORS.map((color) => (
                  <button
                    key={color.value}
                    type="button"
                    onMouseDown={(event) => {
                      saveSelection();
                      event.preventDefault();
                    }}
                    onClick={() => applyTextColor(color.value)}
                    className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] text-zendesk-navy hover:bg-gray-100 ${
                      textColor === color.value ? "bg-gray-50" : ""
                    }`}
                  >
                    <span
                      className="block h-3 w-3 shrink-0 rounded-sm border border-zendesk-border/60"
                      style={{ backgroundColor: color.value }}
                    />
                    {color.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div ref={lineSpacingMenuRef} className="notranslate relative" translate="no">
            <button
              type="button"
              title="Line spacing"
              aria-label="Line spacing"
              aria-expanded={lineSpacingMenuOpen}
              className="notranslate inline-flex items-center gap-0.5 rounded border border-zendesk-border bg-white px-1.5 py-1 text-[11px] font-medium text-zendesk-navy hover:bg-gray-100"
              translate="no"
              onMouseDown={(event) => {
                saveSelection();
                event.preventDefault();
              }}
              onClick={() => {
                setSizeMenuOpen(false);
                setColorMenuOpen(false);
                setLineSpacingMenuOpen((open) => !open);
              }}
            >
              <AlignVerticalSpaceAround className="h-3.5 w-3.5" />
              <ChevronDown className="h-3 w-3" />
            </button>
            {lineSpacingMenuOpen && (
              <div
                className="notranslate absolute bottom-full left-0 z-30 mb-1 min-w-[6.5rem] rounded border border-zendesk-border bg-white py-1 shadow-lg"
                translate="no"
              >
                {LINE_SPACINGS.map((spacing) => (
                  <button
                    key={spacing.value}
                    type="button"
                    className="notranslate block w-full px-3 py-1.5 text-left text-[11px] text-zendesk-navy hover:bg-gray-100"
                    translate="no"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => applyLineSpacing(spacing.value)}
                  >
                    {spacing.label}
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
