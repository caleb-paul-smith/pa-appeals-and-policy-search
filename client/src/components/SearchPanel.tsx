import { useEffect, useState, type FormEvent, type KeyboardEvent } from "react";
import { AdvancedHelp } from "./AdvancedHelp";
import { PilotBoundaries } from "./PilotBoundaries";

interface Props {
  query: string;
  searching: boolean;
  example?: string;
  boundaries?: string;
  onSubmit: (q: string) => void;
  onClear: () => void;
}

export function SearchPanel({ query, searching, example, boundaries, onSubmit, onClear }: Props) {
  const [local, setLocal] = useState(query);

  // Resync the input when the query is cleared/restored externally (e.g. Clear
  // button or URL restore), without clobbering active typing.
  useEffect(() => {
    if (query === "" || query !== local) setLocal(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    onSubmit(local);
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

  return (
    <div className="search-panel">
      <form onSubmit={submit} className="search-form">
        <label htmlFor="query" className="field-label">
          Search query
        </label>
        <textarea
          id="query"
          className="query-input"
          rows={3}
          spellCheck={false}
          placeholder={'e.g.  "direct administrative costs"  AND procurement'}
          value={local}
          onChange={(e) => setLocal(e.target.value)}
          onKeyDown={onKey}
        />
        <div className="search-actions">
          <button type="submit" className="btn btn-primary" disabled={searching || !local.trim()}>
            {searching ? "Searching…" : "Search"}
          </button>
          <button type="button" className="btn btn-ghost" onClick={clear}>
            Clear
          </button>
        </div>
        {example && <p className="example-hint">Try: <code>{example.replace(/^Examples:\s*/, "").split("|")[0].trim()}</code></p>}
      </form>

      <AdvancedHelp />
      <PilotBoundaries boundaries={boundaries} />
    </div>
  );
}
