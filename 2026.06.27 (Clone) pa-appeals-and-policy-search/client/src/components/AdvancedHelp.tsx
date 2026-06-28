import { useState } from "react";

interface Example {
  syntax: string;
  desc: string;
}

const EXAMPLES: Example[] = [
  { syntax: 'procurement reasonable', desc: "Both terms on the same page (implicit AND)." },
  { syntax: '"direct administrative costs"', desc: "Exact phrase, case-insensitive." },
  { syntax: 'procurement AND reasonable', desc: "Explicit boolean AND." },
  { syntax: '"first appeal" OR "second appeal"', desc: "Either phrase matches." },
  { syntax: 'procurement NOT draft', desc: "Exclude pages containing the NOT term." },
  {
    syntax: '("first appeal" OR "second appeal") AND procurement NOT draft',
    desc: "Group with parentheses.",
  },
  {
    syntax: '"force account" NEAR(12) reasonable',
    desc: "Both within 12 tokens, either order.",
  },
  {
    syntax: '"direct administrative cost" ONEAR(15) "reasonable cost"',
    desc: "Ordered proximity — left expression must precede the right.",
  },
  { syntax: "administrat*", desc: 'Any term starting with "administrat" (truncation).' },
  { syntax: "ATLEAST3(procurement)", desc: "Term must appear at least 3 times on the page." },
];

export function AdvancedHelp() {
  const [open, setOpen] = useState(false);
  return (
    <div className="advanced">
      <button
        type="button"
        className="drawer-toggle"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span>Advanced syntax</span>
        <span className="chev">{open ? "▾" : "▸"}</span>
      </button>
      {open && (
        <div className="drawer-body">
          <ul className="syntax-list">
            {EXAMPLES.map((ex) => (
              <li key={ex.syntax}>
                <code>{ex.syntax}</code>
                <span className="syntax-desc">{ex.desc}</span>
              </li>
            ))}
          </ul>
          <p className="drawer-note">
            Phrases use double quotes. Operators <code>AND</code> <code>OR</code> <code>NOT</code>{" "}
            are case-insensitive. <code>NEAR(n)</code> / <code>ONEAR(n)</code> take a maximum token
            distance. A trailing <code>*</code> matches token prefixes.
          </p>
        </div>
      )}
    </div>
  );
}
