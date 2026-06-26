import { useMemo, useState } from "react";
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
  semantic: "Semantic",
};

export function ResultsList({
  response,
  searching,
  selectedDocId,
  selectedPage,
  onSelect,
}: Props) {
  const [grouped, setGrouped] = useState(false);
  const groups = useMemo(() => groupResults(response?.results ?? []), [response]);

  if (searching) {
    return <div className="results-empty">Searching the page index...</div>;
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
        {response.example && (
          <p className="example">
            <code>{response.example}</code>
          </p>
        )}
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

  const semanticOnly = response.results.every((result) => result.matchType === "semantic");

  return (
    <div className="results">
      <div className="results-toolbar">
        <div className="results-meta">
          {response.results.length.toLocaleString()} result
          {response.results.length === 1 ? "" : "s"}
          {response.truncated && " (showing top matches)"}
        </div>
        <label className="group-toggle">
          <input
            type="checkbox"
            checked={grouped}
            onChange={(event) => setGrouped(event.target.checked)}
          />
          Group by document
        </label>
      </div>

      {semanticOnly && (
        <p className="results-note">
          Semantic hits come from Vector Search chunks. PDF preview requires a document mapping in the
          deterministic index.
        </p>
      )}

      {grouped ? (
        <div className="result-groups">
          {groups.map((group) => (
            <details className="result-group" key={group.key} open>
              <summary>
                <span title={group.fileName}>{group.fileName}</span>
                <small>
                  {group.results.length} page hit{group.results.length === 1 ? "" : "s"}
                </small>
              </summary>
              <ol className="results-list">
                {group.results.map((result) => (
                  <ResultItem
                    key={`${result.documentId}-${result.pageNumber}-${result.score}`}
                    result={result}
                    selectedDocId={selectedDocId}
                    selectedPage={selectedPage}
                    onSelect={onSelect}
                  />
                ))}
              </ol>
            </details>
          ))}
        </div>
      ) : (
        <ol className="results-list">
          {response.results.map((result) => (
            <ResultItem
              key={`${result.documentId}-${result.pageNumber}-${result.score}`}
              result={result}
              selectedDocId={selectedDocId}
              selectedPage={selectedPage}
              onSelect={onSelect}
            />
          ))}
        </ol>
      )}
    </div>
  );
}

function ResultItem({
  result,
  selectedDocId,
  selectedPage,
  onSelect,
}: {
  result: SearchResult;
  selectedDocId?: string;
  selectedPage?: number;
  onSelect: (result: SearchResult) => void;
}) {
  const active = result.documentId === selectedDocId && result.pageNumber === selectedPage;
  return (
    <li>
      <button
        type="button"
        className={`result-card${active ? " active" : ""}`}
        onClick={() => onSelect(result)}
      >
        <div className="result-head">
          <span className="result-file" title={result.fileName}>
            {result.fileName}
          </span>
          <span className="result-page">p. {result.pageNumber}</span>
        </div>
        <div className="result-tags">
          <span className={`tag tag-${result.matchType}`}>
            {MATCH_LABEL[result.matchType] ?? result.matchType}
          </span>
          <span className="tag tag-count">
            {result.matchCount} match{result.matchCount === 1 ? "" : "es"}
          </span>
        </div>
        <p className="result-snippet">
          {result.snippet.map((seg, i) =>
            seg.highlight ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
          )}
        </p>
        <p className="result-explain">{result.matchExplanation}</p>
      </button>
    </li>
  );
}

function groupResults(results: SearchResult[]): Array<{
  key: string;
  fileName: string;
  results: SearchResult[];
}> {
  const groups = new Map<string, { key: string; fileName: string; results: SearchResult[] }>();
  for (const result of results) {
    const key = result.documentId || result.fileName;
    const existing = groups.get(key);
    if (existing) {
      existing.results.push(result);
    } else {
      groups.set(key, { key, fileName: result.fileName, results: [result] });
    }
  }
  return [...groups.values()];
}
