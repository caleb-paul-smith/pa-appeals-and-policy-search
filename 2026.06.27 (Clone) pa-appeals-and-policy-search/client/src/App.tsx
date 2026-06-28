import { useCallback, useEffect, useRef, useState } from "react";
import { checkAdminAccess, fetchSearch, fetchSemanticSearch, fetchStatus } from "./api";
import type { SearchMode, SearchResponse, SearchResult, StatusResponse } from "./types";
import { SearchPanel } from "./components/SearchPanel";
import { ResultsList } from "./components/ResultsList";
import { PdfReader } from "./components/PdfReader";
import { StatusBar } from "./components/StatusBar";
import { AdminPanel } from "./components/AdminPanel";

type AppTab = "search" | "admin";

interface Selection {
  documentId: string;
  fileName: string;
  pageNumber: number;
  highlightTerms: string[];
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  return {
    q: params.get("q") ?? "",
    doc: params.get("doc") ?? "",
    fileName: params.get("fn") ?? "",
    page: parseInt(params.get("page") ?? "", 10) || 1,
  };
}

function writeUrlState(q: string, sel: Selection | null) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (sel?.documentId) {
    params.set("doc", sel.documentId);
    params.set("fn", sel.fileName);
    params.set("page", String(sel.pageNumber));
  }
  const qs = params.toString();
  const url = qs ? `?${qs}` : window.location.pathname;
  window.history.replaceState(null, "", url);
}

export function App() {
  const initial = useRef(readUrlState());
  const [status, setStatus] = useState<StatusResponse | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("search");
  const [mode, setMode] = useState<SearchMode>("deterministic");
  const [query, setQuery] = useState(initial.current.q);
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [searching, setSearching] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(
    initial.current.doc
      ? {
          documentId: initial.current.doc,
          fileName: initial.current.fileName,
          pageNumber: initial.current.page,
          highlightTerms: [],
        }
      : null
  );

  useEffect(() => {
    fetchStatus()
      .then(setStatus)
      .catch(() => setStatus(null));
  }, []);

  const runSearch = useCallback(async (q: string, selectedMode: SearchMode) => {
    const trimmed = q.trim();
    if (!trimmed) return;
    setSearching(true);
    setSelection(null);
    try {
      const res =
        selectedMode === "semantic"
          ? await fetchSemanticSearch(trimmed)
          : await fetchSearch(trimmed);
      setResponse(res);
    } catch {
      setResponse({
        ok: false,
        error: "Could not reach the search service.",
        query: trimmed,
        results: [],
        candidatesScanned: 0,
        truncated: false,
      });
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    if (initial.current.q) void runSearch(initial.current.q, "deterministic");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    writeUrlState(query, selection);
  }, [query, selection]);

  const handleSubmit = useCallback(
    (q: string, selectedMode: SearchMode) => {
      setQuery(q);
      setMode(selectedMode);
      void runSearch(q, selectedMode);
    },
    [runSearch]
  );

  const handleClear = useCallback(() => {
    setQuery("");
    setResponse(null);
    setSelection(null);
  }, []);

  const handleSelect = useCallback((r: SearchResult) => {
    setSelection({
      documentId: r.matchType === "semantic" ? "" : r.documentId,
      fileName: r.fileName,
      pageNumber: r.pageNumber,
      highlightTerms: r.highlightTerms,
    });
  }, []);

  return (
    <div className="app">
      <header className="app-header">
        <div className="brand">
          <span className="brand-mark" aria-hidden>
            PA
          </span>
          <div>
            <h1>Appeals &amp; Policy Research</h1>
            <p className="subtitle">Internal page-level research over governed FEMA appeal and policy PDFs</p>
          </div>
        </div>
        <StatusBar status={status} />
      </header>

      <nav className="app-tabs" aria-label="Application tabs">
        <button
          type="button"
          className={activeTab === "search" ? "active" : ""}
          onClick={() => setActiveTab("search")}
        >
          Search
        </button>
        <button
          type="button"
          className={activeTab === "admin" ? "active" : ""}
          onClick={() => setActiveTab("admin")}
        >
          Admin
        </button>
      </nav>

      {activeTab === "search" ? (
        <main className="panels">
          <section className="panel panel-left" aria-label="Search controls">
            <SearchPanel
              query={query}
              searching={searching}
              mode={mode}
              example={status?.queryExample}
              boundaries={status?.boundaries}
              onModeChange={setMode}
              onSubmit={handleSubmit}
              onClear={handleClear}
            />
          </section>

          <section className="panel panel-middle" aria-label="Search results">
            <ResultsList
              response={response}
              searching={searching}
              selectedDocId={selection?.documentId}
              selectedPage={selection?.pageNumber}
              onSelect={handleSelect}
            />
          </section>

          <section className="panel panel-right" aria-label="Document reader">
            <PdfReader
              documentId={selection?.documentId || null}
              fileName={selection?.fileName ?? ""}
              initialPage={selection?.pageNumber ?? 1}
              highlightTerms={selection?.highlightTerms ?? []}
              onPageChange={(page) =>
                setSelection((prev) => (prev ? { ...prev, pageNumber: page } : prev))
              }
            />
          </section>
        </main>
      ) : (
        <main className="admin-main">
          <AdminPanel />
        </main>
      )}
    </div>
  );
}
