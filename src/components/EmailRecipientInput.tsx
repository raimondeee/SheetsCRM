"use client";

import { useEffect, useId, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import type { MarketManager } from "@/lib/market-managers";
import {
  commitRecipientSuggestion,
  currentRecipientFragment,
  filterMarketManagerSuggestions,
  parseRecipientList,
} from "@/lib/email-recipients";
import {
  mergeRecipientSuggestions,
  recipientSuggestionSourceLabel,
  type RecipientSuggestion,
} from "@/lib/recipient-suggestions";

interface EmailRecipientInputProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  marketManagers: MarketManager[];
  placeholder?: string;
  disabled?: boolean;
  /** inline = ticket To/Cc row; stacked = labeled field (e.g. report email modal) */
  variant?: "inline" | "stacked";
}

const SUGGEST_DEBOUNCE_MS = 250;

export function EmailRecipientInput({
  label,
  value,
  onChange,
  marketManagers,
  placeholder,
  disabled = false,
  variant = "inline",
}: EmailRecipientInputProps) {
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [focused, setFocused] = useState(false);
  const [cursorIndex, setCursorIndex] = useState(value.length);
  const [activeIndex, setActiveIndex] = useState(0);
  const [remoteSuggestions, setRemoteSuggestions] = useState<RecipientSuggestion[]>([]);
  const [remoteWarning, setRemoteWarning] = useState<string | null>(null);

  const fragment = useMemo(
    () => currentRecipientFragment(value, cursorIndex),
    [cursorIndex, value]
  );

  const localSuggestions = useMemo(
    () =>
      focused
        ? filterMarketManagerSuggestions(marketManagers, value, cursorIndex).map((manager) => ({
            name: manager.name,
            email: manager.email,
            source: "market_manager" as const,
          }))
        : [],
    [cursorIndex, focused, marketManagers, value]
  );

  useEffect(() => {
    if (!focused || fragment.length < 1) {
      setRemoteSuggestions([]);
      setRemoteWarning(null);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams({
        q: fragment,
        exclude: parseRecipientList(value).join(", "),
        limit: "10",
      });

      void fetch(`/api/contacts/suggest?${params.toString()}`, {
        cache: "no-store",
        credentials: "same-origin",
        signal: controller.signal,
      })
        .then(async (res) => {
          const data = (await res.json()) as {
            suggestions?: RecipientSuggestion[];
            warning?: string | null;
            error?: string;
          };
          if (!res.ok) {
            throw new Error(data.error ?? "Failed to load contact suggestions");
          }
          setRemoteSuggestions(data.suggestions ?? []);
          setRemoteWarning(data.warning ?? null);
        })
        .catch((error) => {
          if (controller.signal.aborted) return;
          setRemoteSuggestions([]);
          setRemoteWarning(
            error instanceof Error ? error.message : "Failed to load contact suggestions"
          );
        });
    }, SUGGEST_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [focused, fragment, value]);

  const suggestions = useMemo(() => {
    if (!focused) return [];
    const groups =
      fragment.length < 1
        ? [localSuggestions]
        : [localSuggestions, remoteSuggestions];
    return mergeRecipientSuggestions(groups, {
      excludeEmails: parseRecipientList(value),
      limit: 10,
    });
  }, [focused, fragment.length, localSuggestions, remoteSuggestions, value]);

  useEffect(() => {
    setActiveIndex(0);
  }, [suggestions]);

  function syncCursor() {
    const next = inputRef.current?.selectionStart ?? value.length;
    setCursorIndex(next);
  }

  function chooseSuggestion(suggestion: RecipientSuggestion) {
    const nextCursor = inputRef.current?.selectionStart ?? value.length;
    const nextValue = commitRecipientSuggestion(value, nextCursor, suggestion.email);
    onChange(nextValue);
    setFocused(true);
    requestAnimationFrame(() => {
      const input = inputRef.current;
      if (!input) return;
      input.focus();
      const end = nextValue.length;
      input.setSelectionRange(end, end);
      setCursorIndex(end);
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (!suggestions.length) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % suggestions.length);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + suggestions.length) % suggestions.length);
      return;
    }

    if (event.key === "Enter" || event.key === "Tab") {
      const selected = suggestions[activeIndex];
      if (!selected) return;
      event.preventDefault();
      chooseSuggestion(selected);
    }

    if (event.key === "Escape") {
      setFocused(false);
    }
  }

  const showSuggestions = focused && suggestions.length > 0 && !disabled;

  const inputProps = {
    type: "text" as const,
    value,
    disabled,
    onChange: (event: ChangeEvent<HTMLInputElement>) => {
      onChange(event.target.value);
      setCursorIndex(event.target.selectionStart ?? event.target.value.length);
    },
    onFocus: () => {
      setFocused(true);
      syncCursor();
    },
    onBlur: () => {
      window.setTimeout(() => setFocused(false), 120);
    },
    onKeyDown: handleKeyDown,
    onKeyUp: syncCursor,
    onClick: syncCursor,
    onSelect: syncCursor,
    placeholder,
    "aria-label": `${label} recipients`,
    "aria-autocomplete": "list" as const,
    "aria-controls": showSuggestions ? listId : undefined,
    "aria-expanded": showSuggestions,
  };

  const suggestionList = showSuggestions ? (
    <ul
      id={listId}
      role="listbox"
      className={
        variant === "stacked"
          ? "absolute left-0 right-0 top-full z-20 mt-1 max-h-44 overflow-y-auto rounded border border-zendesk-border bg-white py-1 shadow-lg"
          : "absolute left-11 right-2 top-full z-20 mt-0.5 max-h-44 overflow-y-auto rounded border border-zendesk-border bg-white py-1 shadow-lg"
      }
    >
      {suggestions.map((suggestion, index) => {
        const sourceLabel = recipientSuggestionSourceLabel(suggestion.source);
        return (
          <li
            key={`${suggestion.source}-${suggestion.email}-${suggestion.name}`}
            role="presentation"
          >
            <button
              type="button"
              role="option"
              aria-selected={index === activeIndex}
              className={`flex w-full items-start justify-between gap-2 px-2.5 py-1.5 text-left text-xs hover:bg-blue-50 ${
                index === activeIndex ? "bg-blue-50" : ""
              }`}
              onMouseDown={(event) => {
                event.preventDefault();
                chooseSuggestion(suggestion);
              }}
            >
              <span className="min-w-0">
                <span className="block font-medium text-zendesk-navy">{suggestion.name}</span>
                <span className="block text-zendesk-muted">{suggestion.email}</span>
              </span>
              {sourceLabel && (
                <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-zendesk-muted">
                  {sourceLabel}
                </span>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  ) : null;

  const contactsWarning =
    focused && remoteWarning === "contacts_scope_required" && fragment.length > 0 ? (
      <p
        className={
          variant === "stacked"
            ? "absolute left-0 right-0 top-full z-10 mt-0.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900"
            : "absolute left-11 right-2 top-full z-10 mt-0.5 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-[10px] text-amber-900"
        }
      >
        Sign out and sign in again to enable Google Contacts and Workspace directory search.
      </p>
    ) : null;

  if (variant === "stacked") {
    return (
      <div className="relative block text-xs">
        <span className="font-medium text-zendesk-navy">{label}</span>
        <input
          ref={inputRef}
          {...inputProps}
          className="mt-1 w-full rounded border border-zendesk-border px-2.5 py-2 text-sm outline-none focus:border-zendesk-green disabled:opacity-60"
        />
        {suggestionList}
        {contactsWarning}
      </div>
    );
  }

  return (
    <label className="relative flex items-center gap-2 border-b border-zendesk-border/60 px-2.5 py-1 last:border-b-0">
      <span className="w-9 shrink-0 text-zendesk-muted">{label}</span>
      <input
        ref={inputRef}
        {...inputProps}
        className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-zendesk-muted/70 disabled:opacity-50"
      />
      {suggestionList}
      {contactsWarning}
    </label>
  );
}
