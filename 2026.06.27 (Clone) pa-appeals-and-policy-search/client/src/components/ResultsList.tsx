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
        <p>Search FEMA appeals &amp; policy.</p>
        <p className="muted">Type a few words and press Search — results appear here, ranked.</p>
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
        <p>No results for that search.</p>
        <p className="muted">
          Try fewer or different words, broaden the phrasing, or switch search mode.
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
          Ranked by meaning. Opening the source PDF from a “By meaning” hit is coming soon — use
          “Exact words” to open and highlight the page.
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
  const isSemantic = result.matchType === "semantic";
  return (
    <li>
      <button
        type="button"
        className={`result-card${active ? " active" : ""}`}
        onClick={() => onSelect(result)}
      >
        {/* Confidence is what tells the user how much to trust a semantic hit,
            so it leads the card. */}
        {isSemantic && <ConfidenceMeter score={result.score} />}
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
          {!isSemantic && (
            <span className="tag tag-count">
              {result.matchCount} match{result.matchCount === 1 ? "" : "es"}
            </span>
          )}
        </div>
        <p className="result-snippet">
          {result.snippet.map((seg, i) =>
            seg.highlight ? <mark key={i}>{seg.text}</mark> : <span key={i}>{seg.text}</span>
          )}
        </p>
        {!isSemantic && <p className="result-explain">{result.matchExplanation}</p>}
      </button>
    </li>
  );
}

/** Leading confidence bar for semantic results. Score is clamped to [0,1] for
 *  the bar width; the exact value is shown alongside and on hover. */
function ConfidenceMeter({ score }: { score: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, score)) * 100);
  const strength = pct >= 66 ? "high" : pct >= 33 ? "medium" : "low";
  return (
    <div className={`confidence confidence-${strength}`} title={`Relevance score: ${score.toFixed(3)}`}>
      <div className="confidence-bar" aria-hidden>
        <div className="confidence-fill" style={{ width: `${pct}%` }} />
      </div>
      <span className="confidence-label">
        Relevance <strong>{score.toFixed(2)}</strong>
      </span>
    </div>
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
