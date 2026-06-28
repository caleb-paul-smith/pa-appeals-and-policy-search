import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import { pdfjs, highlightTextDivs } from "../pdf/pdfSetup";
import { pdfUrl } from "../api";

interface Props {
  documentId: string | null;
  fileName: string;
  initialPage: number;
  highlightTerms: string[];
  onPageChange: (page: number) => void;
}

type Status = "idle" | "loading" | "ready" | "error";

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

export function PdfReader({ documentId, fileName, initialPage, highlightTerms, onPageChange }: Props) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const [numPages, setNumPages] = useState(0);
  const [page, setPage] = useState(initialPage);
  const [scale, setScale] = useState(1.3);
  const [matchCount, setMatchCount] = useState(0);
  const [activeMatch, setActiveMatch] = useState(0);

  const pdfDocRef = useRef<PDFDocumentProxy | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const marksRef = useRef<HTMLElement[]>([]);
  const renderTaskRef = useRef<{ cancel: () => void } | null>(null);
  const textLayerRef = useRef<{ cancel: () => void } | null>(null);

  const highlightKey = highlightTerms.join("");

  // Reset the page when a new result is selected.
  useEffect(() => {
    setPage(initialPage);
  }, [documentId, initialPage]);

  // Load the document whenever the selected document changes.
  useEffect(() => {
    if (!documentId) {
      pdfDocRef.current?.destroy();
      pdfDocRef.current = null;
      setStatus("idle");
      setNumPages(0);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    setErrorMsg("");
    const task = pdfjs.getDocument({ url: pdfUrl(documentId), isEvalSupported: false });
    task.promise.then(
      (doc) => {
        if (cancelled) {
          doc.destroy();
          return;
        }
        pdfDocRef.current?.destroy();
        pdfDocRef.current = doc;
        setNumPages(doc.numPages);
        setStatus("ready");
      },
      (err: unknown) => {
        if (cancelled) return;
        setStatus("error");
        setErrorMsg(err instanceof Error ? err.message : "Could not load PDF.");
      }
    );
    return () => {
      cancelled = true;
      task.destroy();
    };
  }, [documentId]);

  const applyActive = useCallback((idx: number) => {
    const marks = marksRef.current;
    marks.forEach((m) => m.classList.remove("active"));
    const el = marks[idx];
    if (el) {
      el.classList.add("active");
      el.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
    }
  }, []);

  // Render the current page + text layer + highlights.
  useEffect(() => {
    const doc = pdfDocRef.current;
    const host = hostRef.current;
    if (!doc || !host || status !== "ready") return;
    let cancelled = false;

    (async () => {
      try {
        renderTaskRef.current?.cancel();
        textLayerRef.current?.cancel();
        const safePage = Math.min(Math.max(1, page), doc.numPages);
        const pdfPage = await doc.getPage(safePage);
        if (cancelled) return;
        const viewport = pdfPage.getViewport({ scale });

        host.replaceChildren();
        host.style.width = `${Math.floor(viewport.width)}px`;
        host.style.height = `${Math.floor(viewport.height)}px`;
        host.style.setProperty("--scale-factor", String(scale));

        const canvas = document.createElement("canvas");
        canvas.className = "pdf-canvas";
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported.");
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        host.appendChild(canvas);

        const textLayerDiv = document.createElement("div");
        textLayerDiv.className = "textLayer";
        host.appendChild(textLayerDiv);

        const renderTask = pdfPage.render({
          canvasContext: ctx,
          viewport,
          transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined,
        });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (cancelled) return;

        const textContent = await pdfPage.getTextContent();
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        textLayerRef.current = textLayer;
        await textLayer.render();
        if (cancelled) return;

        const marks = highlightTextDivs(textLayer.textDivs, highlightTerms);
        marksRef.current = marks;
        setMatchCount(marks.length);
        setActiveMatch(0);
        if (marks.length > 0) {
          requestAnimationFrame(() => applyActive(0));
        }
      } catch (err) {
        if (!cancelled && !(err instanceof Error && err.name === "RenderingCancelledException")) {
          setStatus("error");
          setErrorMsg(err instanceof Error ? err.message : "Failed to render page.");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [status, page, scale, highlightKey, applyActive, highlightTerms]);

  const goPage = useCallback(
    (next: number) => {
      const clamped = Math.min(Math.max(1, next), numPages || 1);
      setPage(clamped);
      onPageChange(clamped);
    },
    [numPages, onPageChange]
  );

  const nextMatch = useCallback(() => {
    if (matchCount === 0) return;
    const idx = (activeMatch + 1) % matchCount;
    setActiveMatch(idx);
    applyActive(idx);
  }, [activeMatch, matchCount, applyActive]);

  const prevMatch = useCallback(() => {
    if (matchCount === 0) return;
    const idx = (activeMatch - 1 + matchCount) % matchCount;
    setActiveMatch(idx);
    applyActive(idx);
  }, [activeMatch, matchCount, applyActive]);

  if (!documentId) {
    return (
      <div className="reader reader-empty">
        <div className="reader-placeholder">
          <div className="reader-placeholder-mark" aria-hidden>
            ◫
          </div>
          <p>Select a result to open the original PDF here.</p>
          <p className="muted">The reader opens directly to the matching page and highlights the matched language.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="reader">
      <div className="reader-toolbar">
        <div className="reader-file" title={fileName}>
          {fileName || "Document"}
        </div>
        <div className="reader-controls">
          <div className="control-group" aria-label="Match navigation">
            <button type="button" className="icon-btn" onClick={prevMatch} disabled={matchCount === 0} title="Previous match">
              ◀
            </button>
            <span className="match-counter">
              {matchCount === 0 ? "No matches" : `Match ${activeMatch + 1} of ${matchCount}`}
            </span>
            <button type="button" className="icon-btn" onClick={nextMatch} disabled={matchCount === 0} title="Next match">
              ▶
            </button>
          </div>
          <div className="control-group" aria-label="Page navigation">
            <button type="button" className="icon-btn" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Previous page">
              −
            </button>
            <span className="page-control">
              <input
                type="number"
                min={1}
                max={numPages || 1}
                value={page}
                onChange={(e) => goPage(parseInt(e.target.value, 10) || 1)}
                aria-label="Page number"
              />
              <span className="page-total">/ {numPages || "–"}</span>
            </span>
            <button type="button" className="icon-btn" onClick={() => goPage(page + 1)} disabled={page >= numPages} title="Next page">
              +
            </button>
          </div>
          <div className="control-group" aria-label="Zoom">
            <button type="button" className="icon-btn" onClick={() => setScale((s) => Math.max(MIN_SCALE, +(s - 0.2).toFixed(2)))} title="Zoom out">
              –
            </button>
            <span className="zoom-label">{Math.round(scale * 100)}%</span>
            <button type="button" className="icon-btn" onClick={() => setScale((s) => Math.min(MAX_SCALE, +(s + 0.2).toFixed(2)))} title="Zoom in">
              +
            </button>
          </div>
        </div>
      </div>

      <div className="reader-stage">
        {status === "loading" && <div className="reader-overlay">Loading document…</div>}
        {status === "error" && (
          <div className="reader-overlay reader-overlay-error" role="alert">
            <strong>Could not display PDF</strong>
            <p>{errorMsg}</p>
          </div>
        )}
        <div className="page-host" ref={hostRef} />
      </div>
    </div>
  );
}
