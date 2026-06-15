"use client";

import { useEffect, useMemo, useState } from "react";
import { Plus, Search, Trash2 } from "lucide-react";
import type { MarketManager } from "@/lib/market-managers";
import { parseMarketManagerPaste, sortMarketManagers } from "@/lib/market-managers";

export function MarketManagersPanel() {
  const [managers, setManagers] = useState<MarketManager[]>([]);
  const [search, setSearch] = useState("");
  const [newName, setNewName] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [pasteText, setPasteText] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const res = await fetch("/api/market-managers");
        const data = await res.json();
        if (!cancelled && !data.error) {
          setManagers(data.managers ?? []);
          setUpdatedAt(data.updatedAt ?? null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const visibleManagers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return managers
      .map((manager, index) => ({ manager, index }))
      .filter(({ manager }) => {
        if (!q) return true;
        return (
          manager.name.toLowerCase().includes(q) || manager.email.toLowerCase().includes(q)
        );
      })
      .sort((a, b) =>
        a.manager.name.localeCompare(b.manager.name, undefined, { sensitivity: "base" })
      );
  }, [managers, search]);

  function updateRow(index: number, field: keyof MarketManager, value: string) {
    setManagers((prev) =>
      prev.map((m, i) => (i === index ? { ...m, [field]: value } : m))
    );
  }

  function addMarketManager() {
    const name = newName.trim();
    const email = newEmail.trim();
    if (!name || !email) {
      setMessage("Enter both name and email for the new market manager.");
      return;
    }
    setManagers((prev) => sortMarketManagers([...prev, { name, email }]));
    setNewName("");
    setNewEmail("");
    setMessage(null);
  }

  function removeRow(index: number) {
    setManagers((prev) => prev.filter((_, i) => i !== index));
  }

  function importPaste() {
    const imported = parseMarketManagerPaste(pasteText);
    if (imported.length === 0) {
      setMessage("No rows found. Paste Name and Email separated by a tab or comma.");
      return;
    }
    setManagers((prev) => sortMarketManagers([...prev, ...imported]));
    setPasteText("");
    setMessage(`Added ${imported.length} market manager(s). Click Save directory to persist.`);
  }

  async function save() {
    setSaving(true);
    setMessage(null);
    try {
      const res = await fetch("/api/market-managers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ managers }),
      });
      const data = await res.json();
      if (data.error) {
        setMessage(data.error);
        return;
      }
      setManagers(data.managers ?? []);
      setUpdatedAt(data.updatedAt ?? null);
      setMessage(`Saved ${data.managers?.length ?? 0} market managers to data/market-managers.json`);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-zendesk-muted">Loading market manager directory…</p>;
  }

  return (
    <div>
      <p className="text-sm text-zendesk-muted">
        Maps Market Manager names from Column H to email addresses for CC on replies. Stored in{" "}
        <code className="rounded bg-gray-100 px-1 text-xs">data/market-managers.json</code>
        {updatedAt && (
          <span className="ml-1">· last saved {new Date(updatedAt).toLocaleString()}</span>
        )}
      </p>

      <div className="relative mt-4 max-w-sm">
        <Search className="absolute left-2 top-2 h-4 w-4 text-zendesk-muted" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name or email…"
          className="w-full rounded border border-zendesk-border py-1.5 pl-8 pr-3 text-sm outline-none focus:border-zendesk-green"
        />
      </div>

      <div className="mt-4 max-h-[36vh] overflow-y-auto rounded border border-zendesk-border">
        <table className="w-full text-left text-sm">
          <thead className="sticky top-0 bg-gray-50 text-xs text-zendesk-muted">
            <tr className="border-b">
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2 w-10" />
            </tr>
          </thead>
          <tbody>
            {visibleManagers.map(({ manager, index }) => (
                <tr key={index} className="border-b border-zendesk-border/60">
                  <td className="px-3 py-2">
                    <input
                      type="text"
                      value={manager.name}
                      onChange={(e) => updateRow(index, "name", e.target.value)}
                      className="w-full rounded border border-zendesk-border px-2 py-1 text-sm"
                      placeholder="Full name"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <input
                      type="email"
                      value={manager.email}
                      onChange={(e) => updateRow(index, "email", e.target.value)}
                      className="w-full rounded border border-zendesk-border px-2 py-1 text-sm"
                      placeholder="name@airbnb.com"
                    />
                  </td>
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="rounded p-1 text-zendesk-muted hover:bg-red-50 hover:text-red-600"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
        {visibleManagers.length === 0 && (
          <p className="p-4 text-sm text-zendesk-muted">No matches.</p>
        )}
      </div>

      <div className="mt-3 rounded border border-zendesk-border bg-gray-50/80 p-3">
        <p className="text-xs font-medium text-zendesk-navy">New market manager</p>
        <div className="mt-2 flex flex-wrap items-end gap-2">
          <label className="min-w-[10rem] flex-1 text-xs text-zendesk-muted">
            Name
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addMarketManager();
              }}
              className="mt-1 w-full rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-zendesk-navy outline-none focus:border-zendesk-green"
              placeholder="Full name"
            />
          </label>
          <label className="min-w-[12rem] flex-[1.5] text-xs text-zendesk-muted">
            Email
            <input
              type="email"
              value={newEmail}
              onChange={(e) => setNewEmail(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addMarketManager();
              }}
              className="mt-1 w-full rounded border border-zendesk-border bg-white px-2 py-1.5 text-sm text-zendesk-navy outline-none focus:border-zendesk-green"
              placeholder="name@airbnb.com"
            />
          </label>
          <button
            type="button"
            onClick={addMarketManager}
            className="flex shrink-0 items-center gap-1 rounded border border-zendesk-border bg-white px-3 py-1.5 text-sm font-medium hover:bg-gray-100"
          >
            <Plus className="h-4 w-4" />
            Add Market Manager
          </button>
        </div>
      </div>

      <details className="mt-4 rounded border border-zendesk-border bg-gray-50/80 p-3">
        <summary className="cursor-pointer text-sm font-medium">Bulk import (Name + Email)</summary>
        <p className="mt-2 text-xs text-zendesk-muted">
          Paste rows from a spreadsheet — one per line, tab-separated or comma-separated.
        </p>
        <textarea
          value={pasteText}
          onChange={(e) => setPasteText(e.target.value)}
          rows={4}
          placeholder={"Dario Cirella\tdario.cirella@airbnb.com\nEssie Atherton\tessie.atherton@ext.airbnb.com"}
          className="mt-2 w-full rounded border border-zendesk-border p-2 text-sm"
        />
        <button
          type="button"
          onClick={importPaste}
          className="mt-2 rounded bg-zendesk-teal px-3 py-1.5 text-sm font-medium text-white"
        >
          Import rows
        </button>
      </details>

      {message && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">{message}</p>
      )}

      <div className="mt-4 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="rounded bg-zendesk-green px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save directory"}
        </button>
      </div>
    </div>
  );
}
