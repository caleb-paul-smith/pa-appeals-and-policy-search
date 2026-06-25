import type { SearchResponse, SearchResult } from "../types";

interface Props {
  response: SearchResponse | null;
  searching: boolean;
  selectedDocId?: string;
  selectedPage?: number;
  onSelect: (r: SearchResult) => void;
}

const MATCH_LABEL: Record<string, string> = {
  phrase: "Exact phrase",
  proximity: "Proximity",
  boolean: "Boolean",
  term: "Term",
};

export function ResultsList({
  response,
  searching,
  selectedDocId,
  selectedPage,
  onSelect,
}: Props) {
  if (searching) {
    return <div className="results-empty">Searching the page index…</div>;
  }
  if (!response) {
    return (
      <div className="results-empty">
        <p>Enter a query to search the page-level index.</p>
        <p className="muted">Results appear here ranked by match strength.</p>
      </div>
    );
  }
  if (!response.ok) {
    return (
      <div className="results-error" role="alert">
        <strong>Query problem</strong>
        <p>{response.error}</p>
        {response.example && <p className="example"><code>{response.example}</code></p>}
      </div>
    );
  }
  if (response.results.length === 0) {
    return (
      <div className="results-empty">
        <p>No pages matched.</p>
        <p className="muted">
          Scanned {response.candidatesScanned.toLocaleString()} candidate page
          {response.candidatesScanned === 1 ? "" : "s"}.
        </p>
      </div>
    );
  }

  return (
    <div className="results">
      <div className="results-meta">
        {response.results.length.toLocaleString()} result
        {response.results.length === 1 ? "" : "s"}
        {response.truncated && " (showing top matches)"}
      </div>
      <ol className="results-list">
        {response.results.map((r) => {
          const active = r.documentId === selectedDocId && r.pageNumber === selectedPage;
          return (
            <li key={`${r.documentId}-${r.pageNumber}`}>
              <button
                type="button"
                className={`result-card${active ? " active" : ""}`}
                onClick={() => onSelect(r)}
              >
                <div className="result-head">
                  <span className="result-file" title={r.fileName}>
                    {r.fileName}
                  </span>
                  <span className="result-page">p. {r.pageNumber}</span>
                </div>
                <div className="result-tags">
                  <span className={`tag tag-${r.matchType}`}>
                    {MATCH_LABEL[r.matchType] ?? r.matchType}
                  </span>
                  <span className="tag tag-count">{r.matchCount} match{r.matchCount === 1 ? "" : "es"}</span>
                </div>
                <p className="result-snippet">
                  {r.snippet.map((seg, i) =>
                    seg.highlight ? (
                      <mark key={i}>{seg.text}</mark>
                    ) : (
                      <span key={i}>{seg.text}</span>
                    )
                  )}
                </p>
                <p className="result-explain">{r.matchExplanation}</p>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
