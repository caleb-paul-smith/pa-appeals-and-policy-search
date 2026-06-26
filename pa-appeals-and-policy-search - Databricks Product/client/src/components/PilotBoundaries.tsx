interface Props {
  boundaries?: string;
}

const FALLBACK =
  "Original PDFs remain in Unity Catalog. This pilot searches an internal " +
  "page-level index and serves PDFs only from the configured approved volume. " +
  "It does not upload documents to external services, replace source-record " +
  "controls, or make legal or policy determinations.";

export function PilotBoundaries({ boundaries }: Props) {
  return (
    <div className="boundaries" role="note">
      <div className="boundaries-title">
        <span className="lock" aria-hidden>
          ⛨
        </span>
        Pilot boundaries
      </div>
      <p>{boundaries || FALLBACK}</p>
    </div>
  );
}
