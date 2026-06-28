interface Operator {
  label: string;
  syntax: string;
  desc: string;
}

// Westlaw-style operators. Surfaced only inside the "Advanced search" disclosure
// so the default experience stays simple. Each row is clickable and drops its
// syntax into the search box, so nobody has to memorize the grammar.
const OPERATORS: Operator[] = [
  { label: "Exact phrase", syntax: '"direct administrative costs"', desc: "Match the words in this exact order." },
  { label: "All of these", syntax: "procurement AND reasonable", desc: "Page must contain both (a space also means AND)." },
  { label: "Any of these", syntax: '"first appeal" OR "second appeal"', desc: "Either phrase matches." },
  { label: "Exclude", syntax: "procurement NOT draft", desc: "Drop pages that contain the excluded term." },
  { label: "Group", syntax: '("first appeal" OR "second appeal") AND procurement', desc: "Use parentheses to combine logic." },
  { label: "Near each other", syntax: '"force account" NEAR(12) reasonable', desc: "Within 12 words, either order." },
  { label: "In order", syntax: '"direct administrative cost" ONEAR(15) "reasonable cost"', desc: "Left phrase must come before the right." },
  { label: "Starts with", syntax: "administrat*", desc: "Any word beginning with these letters." },
  { label: "Appears N times", syntax: "ATLEAST3(procurement)", desc: "Term occurs at least 3 times on the page." },
];

interface Props {
  /** Drop an example into the search box. */
  onInsert?: (syntax: string) => void;
}

export function AdvancedHelp({ onInsert }: Props) {
  return (
    <div className="operators">
      <ul className="operator-list">
        {OPERATORS.map((op) => (
          <li key={op.syntax}>
            <button
              type="button"
              className="operator-row"
              onClick={() => onInsert?.(op.syntax)}
              title={onInsert ? "Use this in the search box" : undefined}
            >
              <span className="operator-label">{op.label}</span>
              <code className="operator-syntax">{op.syntax}</code>
              <span className="operator-desc">{op.desc}</span>
            </button>
          </li>
        ))}
      </ul>
      <p className="operator-note">
        Phrases use double quotes. <code>AND</code> <code>OR</code> <code>NOT</code> are
        case-insensitive. <code>NEAR(n)</code> / <code>ONEAR(n)</code> take a word distance; a
        trailing <code>*</code> matches word prefixes.
      </p>
    </div>
  );
}
