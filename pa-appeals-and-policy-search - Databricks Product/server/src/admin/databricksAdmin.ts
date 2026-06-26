import type { AppConfig } from "../config";

export interface AdminStats {
  indexedRowCount: number | string;
  ready: boolean;
  statusMessage: string;
  indexName: string;
}

export interface AdminRefreshResult {
  runId: string;
  message: string;
}

export interface AdminRunStatus {
  runId: string;
  lifecycleState: string;
  resultState: string;
  statusLabel: string;
  startTime: string;
  endTime: string;
  errorMessage?: string;
}

interface VectorIndexResponse {
  status?: {
    indexed_row_count?: number;
    ready?: boolean;
    message?: string;
  };
}

interface SubmitRunResponse {
  run_id?: number | string;
}

interface RunStatusResponse {
  state?: {
    life_cycle_state?: string;
    result_state?: string;
    state_message?: string;
  };
  start_time?: number;
  end_time?: number;
}

export async function fetchAdminStats(
  userToken: string | undefined,
  config: AppConfig
): Promise<AdminStats> {
  if (!config.databricksHost || !config.vsIndexName) {
    return {
      indexedRowCount: "Demo",
      ready: true,
      statusMessage: "Vector Search index is not configured in this local environment.",
      indexName: config.vsIndexName || "not configured",
    };
  }
  const data = await databricksGet<VectorIndexResponse>(
    `/api/2.0/vector-search/indexes/${encodeURIComponent(config.vsIndexName)}`,
    userToken,
    config
  );
  return {
    indexedRowCount: data.status?.indexed_row_count ?? "Unknown",
    ready: data.status?.ready ?? false,
    statusMessage: data.status?.message ?? "",
    indexName: config.vsIndexName,
  };
}

export async function triggerRefresh(
  userToken: string | undefined,
  config: AppConfig
): Promise<AdminRefreshResult> {
  if (!config.databricksHost) {
    return {
      runId: "demo-run",
      message: "Demo refresh created. Configure DATABRICKS_HOST in Databricks to submit the processor notebook.",
    };
  }
  const response = await databricksPost<SubmitRunResponse>(
    "/api/2.1/jobs/runs/submit",
    {
      run_name: "PA Appeals Manual Refresh",
      tasks: [
        {
          task_key: "process_pdfs",
          notebook_task: {
            notebook_path: config.processorNotebookPath,
            source: "WORKSPACE",
          },
          environment_key: "Default",
        },
      ],
      environments: [
        {
          environment_key: "Default",
          spec: { client: "2", dependencies: ["pypdf"] },
        },
      ],
    },
    userToken,
    config
  );
  const runId = String(response.run_id ?? "");
  return {
    runId,
    message: `Refresh triggered. Run ID: ${runId || "unknown"}.`,
  };
}

export async function fetchRunStatus(
  runId: string,
  userToken: string | undefined,
  config: AppConfig
): Promise<AdminRunStatus> {
  const cleanRunId = runId.trim();
  if (!cleanRunId) {
    throw new Error("Run ID is required.");
  }
  if (!config.databricksHost || cleanRunId === "demo-run") {
    return {
      runId: cleanRunId,
      lifecycleState: "TERMINATED",
      resultState: "SUCCESS",
      statusLabel: "Completed",
      startTime: "Demo",
      endTime: "Demo",
    };
  }
  const data = await databricksGet<RunStatusResponse>(
    `/api/2.1/jobs/runs/get?run_id=${encodeURIComponent(cleanRunId)}`,
    userToken,
    config
  );
  const lifecycleState = data.state?.life_cycle_state ?? "UNKNOWN";
  const resultState = data.state?.result_state ?? "";
  return {
    runId: cleanRunId,
    lifecycleState,
    resultState,
    statusLabel: statusLabel(lifecycleState, resultState),
    startTime: formatTimestamp(data.start_time),
    endTime: data.end_time ? formatTimestamp(data.end_time) : "Still running",
    errorMessage:
      lifecycleState === "TERMINATED" && resultState && resultState !== "SUCCESS"
        ? data.state?.state_message ?? "Run did not complete successfully."
        : undefined,
  };
}

async function databricksGet<T>(
  path: string,
  userToken: string | undefined,
  config: AppConfig
): Promise<T> {
  return databricksRequest<T>(path, { method: "GET" }, userToken, config);
}

async function databricksPost<T>(
  path: string,
  body: unknown,
  userToken: string | undefined,
  config: AppConfig
): Promise<T> {
  return databricksRequest<T>(
    path,
    {
      method: "POST",
      body: JSON.stringify(body),
    },
    userToken,
    config
  );
}

async function databricksRequest<T>(
  path: string,
  init: RequestInit,
  userToken: string | undefined,
  config: AppConfig
): Promise<T> {
  if (!userToken) {
    throw new AuthError("No user authentication token found. Refresh the Databricks App and try again.");
  }
  const response = await fetch(`${config.databricksHost.replace(/\/$/, "")}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Databricks request failed (${response.status}): ${detail.slice(0, 300)}`);
  }
  return (await response.json()) as T;
}

function statusLabel(lifecycleState: string, resultState: string): string {
  if (lifecycleState === "TERMINATED") {
    return resultState === "SUCCESS" ? "Completed" : "Failed";
  }
  if (lifecycleState === "RUNNING") return "Running...";
  if (lifecycleState === "PENDING") return "Pending...";
  return lifecycleState || "Unknown";
}

function formatTimestamp(ms: number | undefined): string {
  if (!ms) return "N/A";
  return `${new Date(ms).toISOString().replace("T", " ").slice(0, 19)} UTC`;
}

export class AuthError extends Error {}
