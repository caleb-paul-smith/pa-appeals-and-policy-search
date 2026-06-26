// Synthesize a simple, real PDF for a fabricated demo document so the PDF.js
// reader (open-to-page, text layer, highlighting) works end-to-end in Demo
// Mode. Generated entirely in-process with pdf-lib; nothing leaves the app.

import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { DemoDocument } from "../data/demoData";

const PAGE_WIDTH = 612; // US Letter
const PAGE_HEIGHT = 792;
const MARGIN = 64;
const FONT_SIZE = 12;
const LINE_HEIGHT = 18;
const TITLE_SIZE = 15;

function wrapText(text: string, font: import("pdf-lib").PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) > maxWidth && current) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}

const pdfCache = new Map<string, Buffer>();

export async function renderDemoPdf(doc: DemoDocument): Promise<Buffer> {
  const cached = pdfCache.get(doc.documentId);
  if (cached) return cached;

  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.fileName);
  pdf.setSubject("Fabricated demonstration document — not real appeal content.");
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const usableWidth = PAGE_WIDTH - MARGIN * 2;

  for (const page of doc.pages) {
    const p = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    let y = PAGE_HEIGHT - MARGIN;

    p.drawText(`${doc.fileName}`, {
      x: MARGIN,
      y,
      size: TITLE_SIZE,
      font: bold,
      color: rgb(0.1, 0.13, 0.2),
    });
    y -= LINE_HEIGHT * 1.4;
    p.drawText(`Page ${page.pageNumber}  •  DEMO MODE — fabricated content`, {
      x: MARGIN,
      y,
      size: 9,
      font,
      color: rgb(0.45, 0.45, 0.5),
    });
    y -= LINE_HEIGHT * 1.6;

    const lines = wrapText(page.text, font, FONT_SIZE, usableWidth);
    for (const line of lines) {
      if (y < MARGIN) break;
      p.drawText(line, { x: MARGIN, y, size: FONT_SIZE, font, color: rgb(0.12, 0.12, 0.14) });
      y -= LINE_HEIGHT;
    }
  }

  const bytes = await pdf.save();
  const buf = Buffer.from(bytes);
  pdfCache.set(doc.documentId, buf);
  return buf;
}
