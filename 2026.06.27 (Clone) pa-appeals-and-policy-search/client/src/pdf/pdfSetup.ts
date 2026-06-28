// PDF.js configuration. The worker is bundled from the local dependency — no
// public CDN is referenced.

import * as pdfjs from "pdfjs-dist";
// Vite resolves this to a hashed local asset URL served from our own origin.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export { pdfjs };

/**
 * Wrap matches of `terms` inside the rendered text-layer divs with <mark>
 * elements, using safe DOM text nodes (never innerHTML). Returns the created
 * marks in document order for match navigation.
 */
export function highlightTextDivs(divs: HTMLElement[], terms: string[]): HTMLElement[] {
  const marks: HTMLElement[] = [];
  const lowerTerms = terms
    .map((t) => t.toLowerCase().trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);
  if (lowerTerms.length === 0) return marks;

  for (const div of divs) {
    const text = div.textContent ?? "";
    if (!text) continue;
    const lower = text.toLowerCase();
    const ranges: Array<{ start: number; end: number }> = [];
    for (const term of lowerTerms) {
      let from = 0;
      for (;;) {
        const idx = lower.indexOf(term, from);
        if (idx === -1) break;
        const end = idx + term.length;
        if (!ranges.some((r) => idx < r.end && end > r.start)) {
          ranges.push({ start: idx, end });
        }
        from = end;
      }
    }
    if (ranges.length === 0) continue;
    ranges.sort((a, b) => a.start - b.start);

    const frag = document.createDocumentFragment();
    let cursor = 0;
    for (const r of ranges) {
      if (r.start > cursor) frag.appendChild(document.createTextNode(text.slice(cursor, r.start)));
      const mark = document.createElement("mark");
      mark.className = "pdf-hl";
      mark.textContent = text.slice(r.start, r.end);
      frag.appendChild(mark);
      marks.push(mark);
      cursor = r.end;
    }
    if (cursor < text.length) frag.appendChild(document.createTextNode(text.slice(cursor)));
    div.textContent = "";
    div.appendChild(frag);
  }
  return marks;
}
