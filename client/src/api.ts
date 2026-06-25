import type { SearchResponse, StatusResponse } from "./types";

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status");
  return (await res.json()) as StatusResponse;
}

export async function fetchSearch(query: string): Promise<SearchResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  return (await res.json()) as SearchResponse;
}

export function pdfUrl(documentId: string): string {
  return `/pdf/${encodeURIComponent(documentId)}`;
}
