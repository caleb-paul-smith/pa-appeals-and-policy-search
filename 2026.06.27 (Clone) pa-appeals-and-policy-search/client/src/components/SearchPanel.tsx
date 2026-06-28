import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import type { SearchMode } from "../types";
import { AdvancedHelp } from "./AdvancedHelp";
import { PilotBoundaries } from "./PilotBoundaries";

const HISTORY_KEY = "pa-search-history";
const MAX_HISTORY = 20;

interface Props {
  query: string;
  searching: boolean;
  mode: SearchMode;
  example?: string;
  boundaries?: string;
  onModeChange: (mode: SearchMode) => void;
  onSubmit: (q: string, mode: SearchMode) => void;
  onClear: () => void;
}

const MODES: Array<{ id: SearchMode; label: string; hint: string }> = [
  {
    id: "deterministic",
    label: "Exact words",
    hint: "Finds your exact terms. Supports quotes, AND/OR/NOT, wildcards, and proximity.",
  },
  {
    id: "semantic",
    label: "By meaning",
    hint: "Finds passages about the same idea, even when the wording differs.",
  },
];

export function SearchPanel({
  query,
  searching,
  mode,
  boundaries,
  onModeChange,
  onSubmit,
  onClear,
}: Props) {
  const [local, setLocal] = useState(query);
  const [history, setHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (query === "" || query !== local) setLocal(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    try {
      const parsed = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
      if (Array.isArray(parsed)) {
        setHistory(parsed.filter((item) => typeof item === "string").slice(0, MAX_HISTORY));
      }
    } catch {
      setHistory([]);
    }
  }, []);

  const remember = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    const next = [trimmed, ...history.filter((item) => item !== trimmed)].slice(0, MAX_HISTORY);
    setHistory(next);
    localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  };

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const trimmed = local.trim();
    if (!trimmed) return;
    remember(trimmed);
    onSubmit(trimmed, mode);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  const clear = () => {
    setLocal("");
    onClear();
  };

  const chooseHistory = (item: string) => {
    setLocal(item);
    setHistoryOpen(false);
    remember(item);
    onSubmit(item, mode);
  };

  const insertOperator = (syntax: string) => {
    setLocal(syntax);
    inputRef.current?.focus();
  };

  const activeHint = MODES.find((m) => m.id === mode)?.hint;

  return (
    <div className="search-panel">
      <form onSubmit={submit} className="search-form">
        <div className="mode-switch" role="group" aria-label="How to search">
          {MODES.map((m) => (
            <button
              key={m.id}
              type="button"
              className={mode === m.id ? "active" : ""}
              aria-pressed={mode === m.id}
              onClick={() => onModeChange(m.id)}
            >
              {m.label}
            </button>
          ))}
        </div>
        {activeHint && <p className="mode-hint">{activeHint}</p>}

        <div className="query-wrap">
          <textarea
            id="query"
            ref={inputRef}
            className="query-input"
            rows={2}
            spellCheck={false}
            aria-label="Search query"
            placeholder={
              mode === "semantic"
                ? "Describe what you're looking for…"
                : "Search appeals and policy…"
            }
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setHistoryOpen(true)}
            onBlur={() => window.setTimeout(() => setHistoryOpen(false), 120)}
          />
          {historyOpen && history.length > 0 && (
            <div className="query-history" role="listbox" aria-label="Recent searches">
              <div className="query-history-head">Recent</div>
              {history.map((item) => (
                <button
                  key={item}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => chooseHistory(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="search-actions">
          <button type="submit" className="btn btn-primary" disabled={searching || !local.trim()}>
            {searching ? "Searching…" : "Search"}
          </button>
          {local && (
            <button type="button" className="btn btn-ghost" onClick={clear}>
              Clear
            </button>
          )}
        </div>

        {mode === "deterministic" && (
          <div className={`advanced${advancedOpen ? " open" : ""}`}>
            <button
              type="button"
              className="advanced-toggle"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((v) => !v)}
            >
              <span className="chev" aria-hidden>
                {advancedOpen ? "▾" : "▸"}
              </span>
              Advanced search
              <span className="advanced-sub">exact phrases · wildcards · AND/OR/NOT · proximity</span>
            </button>
            {advancedOpen && (
              <div className="advanced-body">
                <p className="advanced-intro">
                  Tap any pattern to drop it into the search box, then edit the words.
                </p>
                <AdvancedHelp onInsert={insertOperator} />
              </div>
            )}
          </div>
        )}
      </form>

      <PilotBoundaries boundaries={boundaries} />
    </div>
  );
}
