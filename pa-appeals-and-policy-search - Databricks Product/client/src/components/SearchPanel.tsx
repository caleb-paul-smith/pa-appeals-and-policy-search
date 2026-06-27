import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
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

export function SearchPanel({
  query,
  searching,
  mode,
  example,
  boundaries,
  onModeChange,
  onSubmit,
  onClear,
}: Props) {
  const [local, setLocal] = useState(query);
  const [history, setHistory] = useState<string[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

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

  return (
    <div className="search-panel">
      <form onSubmit={submit} className="search-form">
        <div className="mode-toggle" role="group" aria-label="Search mode">
          <button
            type="button"
            className={mode === "deterministic" ? "active" : ""}
            onClick={() => onModeChange("deterministic")}
          >
            Deterministic
          </button>
          <button
            type="button"
            className={mode === "semantic" ? "active" : ""}
            onClick={() => onModeChange("semantic")}
          >
            Semantic
          </button>
        </div>

        <label htmlFor="query" className="field-label">
          Search query
        </label>
        <div className="query-wrap">
          <textarea
            id="query"
            className="query-input"
            rows={3}
            spellCheck={false}
            placeholder={
              mode === "semantic"
                ? "e.g. debris removal eligibility on federal-aid routes"
                : 'e.g.  "direct administrative costs"  AND procurement'
            }
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            onKeyDown={onKey}
            onFocus={() => setHistoryOpen(true)}
            onBlur={() => window.setTimeout(() => setHistoryOpen(false), 120)}
          />
          {historyOpen && history.length > 0 && (
            <div className="query-history" role="listbox" aria-label="Recent searches">
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
            {searching ? "Searching..." : "Search"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={clear}>
            Clear
          </button>
        </div>

        {mode === "deterministic" && example && (
          <p className="example-hint">
            Try: <code>{example.replace(/^Examples:\s*/, "").split("|")[0].trim()}</code>
          </p>
        )}
        {mode === "semantic" && (
          <p className="example-hint">
            Semantic mode ranks conceptually similar passages from the live Vector Search index.
          </p>
        )}
      </form>

      {mode === "deterministic" && <AdvancedHelp />}
      <PilotBoundaries boundaries={boundaries} />
    </div>
  );
}
