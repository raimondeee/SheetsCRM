"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from "react";
import { isRichTextEmpty } from "@/lib/html-utils";
import {
  Bold,
  ChevronDown,
  IndentDecrease,
  IndentIncrease,
  Italic,
  List,
  ListOrdered,
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
}

interface ReplyDraftEditorProps {
  value: string;
  onChange: (html: string) => void;
  focused: boolean;
  onFocusChange: (focused: boolean) => void;
  placeholder?: string;
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

export const ReplyDraftEditor = forwardRef<ReplyDraftEditorHandle, ReplyDraftEditorProps>(
  function ReplyDraftEditor(
    { value, onChange, focused, onFocusChange, placeholder },
    ref
  ) {
    const composerRef = useRef<HTMLDivElement>(null);
    const editorRef = useRef<HTMLDivElement>(null);
    const sizeMenuRef = useRef<HTMLDivElement>(null);
    const savedSelectionRef = useRef<Range | null>(null);
    const lastValueRef = useRef(value);
    const [sizeMenuOpen, setSizeMenuOpen] = useState(false);

    useImperativeHandle(ref, () => ({
      focus: () => {
        editorRef.current?.focus();
      },
    }));

    useEffect(() => {
      const editor = editorRef.current;
      if (!editor) return;

      if (document.activeElement === editor) {
        // Parent re-rendered during typing (e.g. ticket refresh) — keep live DOM + cursor.
        lastValueRef.current = editor.innerHTML;
        return;
      }

      if (value === lastValueRef.current) return;
      lastValueRef.current = value;
      if (editor.innerHTML !== value) {
        editor.innerHTML = value;
        updateEmptyState(value);
      }
    }, [value]);

    useEffect(() => {
      if (!sizeMenuOpen) return;

      function handlePointerDown(event: MouseEvent) {
        if (sizeMenuRef.current?.contains(event.target as Node)) return;
        setSizeMenuOpen(false);
      }

      document.addEventListener("mousedown", handlePointerDown);
      return () => document.removeEventListener("mousedown", handlePointerDown);
    }, [sizeMenuOpen]);

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
      if (!saved || !editor || !selection) return false;

      selection.removeAllRanges();
      selection.addRange(saved);
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
      onFocusChange(false);
      setSizeMenuOpen(false);
    }

    return (
      <div
        ref={composerRef}
        onFocusCapture={() => onFocusChange(true)}
        onBlurCapture={handleComposerBlur}
      >
        <div
          ref={editorRef}
          contentEditable
          suppressContentEditableWarning
          role="textbox"
          aria-multiline="true"
          data-placeholder={placeholder}
          data-empty="true"
          onInput={syncContent}
          onKeyUp={saveSelection}
          onMouseUp={saveSelection}
          onFocus={saveSelection}
          style={
            focused
              ? { height: "25vh", minHeight: "4.5rem" }
              : { height: "4.5rem", minHeight: "4.5rem" }
          }
          className={`reply-draft-editor w-full resize-none overflow-y-auto rounded border border-zendesk-border p-3 text-sm outline-none transition-[height,background-color,border-color] duration-200 ease-out focus:border-zendesk-green ${
            focused ? "bg-sky-50/90" : "bg-sky-50/45"
          }`}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-0.5 rounded border border-zendesk-border bg-gray-50 px-1 py-0.5">
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
      </div>
    );
  }
);
