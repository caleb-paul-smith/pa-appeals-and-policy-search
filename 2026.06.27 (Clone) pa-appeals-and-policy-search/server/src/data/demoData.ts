// Fabricated placeholder corpus for DEMO MODE.
//
// IMPORTANT: This is invented content using generic public FEMA-policy
// vocabulary only. It contains NO real appeal text and NO real internal
// document names. Filenames are clearly marked "DEMO-".

export interface DemoPage {
  pageNumber: number;
  text: string;
}

export interface DemoDocument {
  documentId: string;
  fileName: string;
  relativePath: string;
  pages: DemoPage[];
}

// Generic, fabricated paragraphs. Deliberately written to exercise phrase,
// boolean, and proximity search — not drawn from any real decision.
export const DEMO_DOCUMENTS: DemoDocument[] = [
  {
    documentId: "demo-0001",
    fileName: "DEMO-Sample-Appeal-Decision-0001.pdf",
    relativePath: "demo/DEMO-Sample-Appeal-Decision-0001.pdf",
    pages: [
      {
        pageNumber: 1,
        text:
          "This is a fabricated demonstration record. It does not contain real appeal text. " +
          "The procurement process must remain reasonable and fully documented at every step. " +
          "A recipient that follows competitive procedures generally supports a finding that " +
          "costs are reasonable. This sample exists only to demonstrate phrase and boolean search.",
      },
      {
        pageNumber: 2,
        text:
          "On first appeal, the applicant argued that force account labor was the most practical " +
          "approach. The reasonable cost standard was applied to the force account effort. " +
          "Direct administrative costs were claimed separately and reviewed for documentation. " +
          "This fabricated page demonstrates proximity search such as force account near reasonable.",
      },
    ],
  },
  {
    documentId: "demo-0002",
    fileName: "DEMO-Sample-Appeal-Decision-0002.pdf",
    relativePath: "demo/DEMO-Sample-Appeal-Decision-0002.pdf",
    pages: [
      {
        pageNumber: 1,
        text:
          "Fabricated demonstration content only. On second appeal the question concerned whether " +
          "direct administrative costs were adequately supported. The analysis distinguished direct " +
          "administrative costs from indirect costs and emphasized contemporaneous documentation.",
      },
      {
        pageNumber: 2,
        text:
          "The placeholder discussion notes that a reasonable cost determination depends on the facts. " +
          "Procurement under exigent circumstances may still require a documented justification. " +
          "Nothing on this page reflects an actual determination; it is invented sample text.",
      },
      {
        pageNumber: 3,
        text:
          "This sample mentions both first appeal and second appeal so boolean grouping can be shown. " +
          "It also avoids the word that would appear in a draft so that NOT draft can be demonstrated.",
      },
    ],
  },
  {
    documentId: "demo-0003",
    fileName: "DEMO-Sample-Policy-Guidance-0003.pdf",
    relativePath: "demo/DEMO-Sample-Policy-Guidance-0003.pdf",
    pages: [
      {
        pageNumber: 1,
        text:
          "Fabricated policy-style guidance for demonstration. Reasonable costs are those that a " +
          "prudent person would incur. Force account work should be tracked with labor records. " +
          "This placeholder text supports proximity demonstrations like direct administrative cost " +
          "near reasonable cost within a configurable token window.",
      },
      {
        pageNumber: 2,
        text:
          "Procurement standards encourage full and open competition. The sample guidance repeats " +
          "the phrase direct administrative costs to demonstrate exact phrase highlighting. " +
          "Again, this is invented demonstration material and is not authoritative.",
      },
    ],
  },
];

export function demoStats() {
  const documentCount = DEMO_DOCUMENTS.length;
  const pageCount = DEMO_DOCUMENTS.reduce((n, d) => n + d.pages.length, 0);
  return {
    documentCount,
    pageCount,
    // Fixed, non-random freshness label for the demo.
    lastIndexedAt: "demo dataset (no real index)",
  };
}
