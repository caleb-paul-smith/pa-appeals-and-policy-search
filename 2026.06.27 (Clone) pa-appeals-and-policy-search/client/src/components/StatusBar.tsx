import type { StatusResponse } from "../types";

interface Props {
  status: StatusResponse | null;
}

const MODE_LABEL: Record<string, string> = {
  demo: "Demo Mode",
  pilot: "Pilot Mode",
  production: "Production Mode",
};

export function StatusBar({ status }: Props) {
  if (!status) {
    return (
      <div className="status-bar">
        <span className="mode-chip mode-unknown">Connecting…</span>
      </div>
    );
  }
  const mode = status.mode;
  return (
    <div className="status-bar">
      <span className={`mode-chip mode-${mode}`} title="Current operating mode">
        {MODE_LABEL[mode] ?? mode}
      </span>
      <dl className="status-metrics">
        <div>
          <dt>Documents</dt>
          <dd>{status.stats.documentCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Pages</dt>
          <dd>{status.stats.pageCount.toLocaleString()}</dd>
        </div>
        <div>
          <dt>Index freshness</dt>
          <dd title={status.stats.lastIndexedAt}>{status.stats.lastIndexedAt}</dd>
        </div>
      </dl>
      {mode === "demo" && (
        <span className="demo-note">Fabricated placeholder data — configure a volume to enter Pilot Mode.</span>
      )}
    </div>
  );
}
