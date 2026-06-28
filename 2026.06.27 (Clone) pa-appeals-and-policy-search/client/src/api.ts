import type { AdminRunStatus, AdminStats, SearchResponse, StatusResponse } from "./types";

export async function fetchStatus(): Promise<StatusResponse> {
  const res = await fetch("/api/status");
  return (await res.json()) as StatusResponse;
}

export async function fetchSearch(query: string): Promise<SearchResponse> {
  const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
  return (await res.json()) as SearchResponse;
}

export async function fetchSemanticSearch(
  query: string,
  numResults = 10
): Promise<SearchResponse> {
  const res = await fetch("/api/semantic-search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, numResults }),
  });
  return (await res.json()) as SearchResponse;
}

export async function fetchAdminStats(): Promise<AdminStats> {
  const res = await fetch("/api/admin/stats");
  return readJson<AdminStats>(res);
}

export async function triggerRefresh(): Promise<{ runId: string; message: string }> {
  const res = await fetch("/api/admin/refresh", { method: "POST" });
  return readJson<{ runId: string; message: string }>(res);
}

export async function fetchRunStatus(runId: string): Promise<AdminRunStatus> {
  const res = await fetch(`/api/admin/status/${encodeURIComponent(runId)}`);
  return readJson<AdminRunStatus>(res);
}

export async function checkAdminAccess(): Promise<boolean> {
  try {
    const res = await fetch("/api/admin/check");
    if (!res.ok) return false;
    const data = (await res.json()) as { admin?: boolean };
    return data.admin === true;
  } catch {
    return false;
  }
}

export function pdfUrl(documentId: string): string {
  return `/pdf/${encodeURIComponent(documentId)}`;
}

async function readJson<T>(res: Response): Promise<T> {
  const data = await res.json();
  if (!res.ok) {
    const detail = typeof data?.detail === "string" ? data.detail : "";
    const error = typeof data?.error === "string" ? data.error : "Request failed.";
    throw new Error(detail ? `${error} ${detail}` : error);
  }
  return data as T;
}
