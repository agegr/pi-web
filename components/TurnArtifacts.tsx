import { getFileName } from "@/lib/file-paths";
import type { TurnArtifact } from "@/lib/turn-artifacts";

export function TurnArtifacts({ artifacts, onOpenFile }: {
  artifacts: TurnArtifact[];
  onOpenFile?: (filePath: string) => void;
}) {
  if (artifacts.length === 0) return null;

  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
      {artifacts.map((artifact) => (
        <button
          key={artifact.filePath}
          type="button"
          title={artifact.filePath}
          onClick={() => onOpenFile?.(artifact.filePath)}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            padding: "2px 8px",
            fontSize: 12,
            fontFamily: "var(--font-mono)",
            color: "var(--text)",
            background: "var(--bg-subtle)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            cursor: "pointer",
          }}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M9 1.5H4A1.5 1.5 0 0 0 2.5 3v10A1.5 1.5 0 0 0 4 14.5h8A1.5 1.5 0 0 0 13.5 13V6z" />
            <path d="M9 1.5V6h4.5" />
          </svg>
          <span>{getFileName(artifact.filePath)}</span>
        </button>
      ))}
    </div>
  );
}
