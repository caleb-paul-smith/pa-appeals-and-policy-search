import { useEffect, useState } from "react";
import { fetchAdminStats, fetchRunStatus, triggerRefresh } from "../api";
import type { AdminRunStatus, AdminStats } from "../types";

export function AdminPanel() {
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [status, setStatus] = useState<AdminRunStatus | null>(null);
  const [runId, setRunId] = useState("");
  const [message, setMessage] = useState("");
  const [loadingStats, setLoadingStats] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState("");

  const loadStats = async () => {
    setLoadingStats(true);
    setError("");
    try {
      setStats(await fetchAdminStats());
    } catch (err) {
      setError(errorMessage(err, "Could not load index stats."));
    } finally {
      setLoadingStats(false);
    }
  };

  const startRefresh = async () => {
    setRefreshing(true);
    setError("");
    try {
      const result = await triggerRefresh();
      setMessage(result.message);
      setRunId(result.runId);
      setStatus(null);
    } catch (err) {
      setError(errorMessage(err, "Could not trigger refresh."));
    } finally {
      setRefreshing(false);
    }
  };

  const checkStatus = async (id = runId) => {
    const clean = id.trim();
    if (!clean) return;
    setChecking(true);
    setError("");
    try {
      setStatus(await fetchRunStatus(clean));
    } catch (err) {
      setError(errorMessage(err, "Could not check run status."));
    } finally {
      setChecking(false);
    }
  };

  useEffect(() => {
    if (!status || !["RUNNING", "PENDING"].includes(status.lifecycleState)) return;
    const timer = window.setTimeout(() => void checkStatus(status.runId), 5000);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  return (
    <section className="admin-panel" aria-label="Administration">
      <div className="admin-section">
        <div className="admin-section-head">
          <div>
            <h2>Index Stats</h2>
            <p>Current Vector Search index status.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={loadStats} disabled={loadingStats}>
            {loadingStats ? "Loading..." : "Refresh Stats"}
          </button>
        </div>
        {stats && (
          <dl className="admin-grid">
            <div>
              <dt>Indexed Chunks</dt>
              <dd>{formatCount(stats.indexedRowCount)}</dd>
            </div>
            <div>
              <dt>Index Ready</dt>
              <dd>{stats.ready ? "Yes" : "No"}</dd>
            </div>
            <div>
              <dt>Index Name</dt>
              <dd>{stats.indexName}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{stats.statusMessage || "No status message"}</dd>
            </div>
          </dl>
        )}
      </div>

      <div className="admin-section">
        <div className="admin-section-head">
          <div>
            <h2>Manual Refresh</h2>
            <p>Submit the existing incremental processor notebook as the calling user.</p>
          </div>
          <button type="button" className="btn btn-primary" onClick={startRefresh} disabled={refreshing}>
            {refreshing ? "Submitting..." : "Trigger Refresh"}
          </button>
        </div>
        {message && <p className="admin-message">{message}</p>}
      </div>

      <div className="admin-section">
        <div className="admin-section-head">
          <div>
            <h2>Run Status</h2>
            <p>Check a submitted processor run.</p>
          </div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void checkStatus()}
            disabled={checking || !runId.trim()}
          >
            {checking ? "Checking..." : "Check Run Status"}
          </button>
        </div>
        <label className="field-label" htmlFor="run-id">
          Run ID
        </label>
        <input
          id="run-id"
          className="admin-input"
          value={runId}
          onChange={(event) => setRunId(event.target.value)}
          placeholder="Paste a run ID"
        />
        {status && (
          <dl className="admin-grid admin-grid-status">
            <div>
              <dt>Run ID</dt>
              <dd>{status.runId}</dd>
            </div>
            <div>
              <dt>Status</dt>
              <dd>{status.statusLabel}</dd>
            </div>
            <div>
              <dt>Lifecycle</dt>
              <dd>{status.lifecycleState}</dd>
            </div>
            <div>
              <dt>Result</dt>
              <dd>{status.resultState || "In progress"}</dd>
            </div>
            <div>
              <dt>Started</dt>
              <dd>{status.startTime}</dd>
            </div>
            <div>
              <dt>Ended</dt>
              <dd>{status.endTime}</dd>
            </div>
          </dl>
        )}
        {status?.errorMessage && <p className="admin-error">{status.errorMessage}</p>}
      </div>

      {error && (
        <div className="results-error" role="alert">
          <strong>Admin request failed</strong>
          <p>{error}</p>
        </div>
      )}
    </section>
  );
}

function formatCount(value: number | string): string {
  return typeof value === "number" ? value.toLocaleString() : value;
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}
