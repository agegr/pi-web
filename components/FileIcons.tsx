// Flat monochrome file & folder icons — all use currentColor / var(--text-dim)

interface IconProps {
  size?: number;
}

const DIM = "var(--text-dim)";

// ── Folder ────────────────────────────────────────────────────────────────

export function FolderIcon({ size = 14, open = false }: IconProps & { open?: boolean }) {
  if (open) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
        <path d="M1 4.5A1 1 0 0 1 2 3.5H5.5L7 5h7.5v1H1V4.5Z" fill={DIM} />
        <path d="M1 6h14.5L14 13H2L1 6Z" stroke={DIM} strokeWidth="1" fill={DIM} fillOpacity="0.12" />
      </svg>
    );
  }
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M1 4.5A1 1 0 0 1 2 3.5H5.5L7 5H14a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1V4.5Z"
        stroke={DIM} strokeWidth="1" fill={DIM} fillOpacity="0.1" />
    </svg>
  );
}

// ── Generic file (fallback) ────────────────────────────────────────────────

export function GenericFileIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none">
      <path d="M3 2h7l3 3v9H3V2Z" stroke={DIM} strokeWidth="1" fill={DIM} fillOpacity="0.08" />
      <path d="M10 2v3h3" stroke={DIM} strokeWidth="1" fill="none" strokeLinejoin="round" />
    </svg>
  );
}

// ── File with label text (used for most types) ────────────────────────────
// Renders the file outline + a short text badge

function LabelFileIcon({ label, size = 14 }: { label: string; size?: number }) {
  const s = size / 14; // scale factor
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <text
        x="7" y="9.5"
        textAnchor="middle"
        fontSize={3.4 * s}
        fontFamily="var(--font-mono), monospace"
        fontWeight="600"
        fill={DIM}
        letterSpacing="0"
      >{label}</text>
    </svg>
  );
}

// ── Specific icons ────────────────────────────────────────────────────────

export function TypeScriptIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="TS" size={size} />;
}
export function TypeScriptReactIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="TSX" size={size} />;
}
export function JavaScriptIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="JS" size={size} />;
}
export function JavaScriptReactIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="JSX" size={size} />;
}
export function PythonIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="PY" size={size} />;
}
export function JsonIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="{}" size={size} />;
}
export function CssIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="CSS" size={size} />;
}
export function ScssIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="SC" size={size} />;
}
export function HtmlIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="HTM" size={size} />;
}
export function MarkdownIcon({ size = 14 }: IconProps) {
  // file outline + M↓ symbol
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      {/* M */}
      <path d="M3.5 9.5V7l1.5 1.5L6.5 7v2.5" stroke={DIM} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      {/* down arrow */}
      <path d="M8 7v2.5M7 9l1 1.5 1-1.5" stroke={DIM} strokeWidth="0.9" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}
export function YamlIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="YML" size={size} />;
}
export function TomlIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="TOM" size={size} />;
}
export function ShellIcon({ size = 14 }: IconProps) {
  // file outline + > prompt
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <path d="M4 7.5l2 1.5-2 1.5" stroke={DIM} strokeWidth="0.95" strokeLinecap="round" strokeLinejoin="round" fill="none" />
      <path d="M7.5 10.5h2.5" stroke={DIM} strokeWidth="0.95" strokeLinecap="round" />
    </svg>
  );
}
export function RustIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="RS" size={size} />;
}
export function GoIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="GO" size={size} />;
}
export function SqlIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="SQL" size={size} />;
}
export function GraphqlIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="GQL" size={size} />;
}
export function TerraformIcon({ size = 14 }: IconProps) {
  return <LabelFileIcon label="TF" size={size} />;
}
export function DockerfileIcon({ size = 14 }: IconProps) {
  // file outline + container stack
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <rect x="3.5" y="6.5" width="2" height="1.5" rx="0.3" stroke={DIM} strokeWidth="0.8" />
      <rect x="6" y="6.5" width="2" height="1.5" rx="0.3" stroke={DIM} strokeWidth="0.8" />
      <rect x="3.5" y="8.5" width="2" height="1.5" rx="0.3" stroke={DIM} strokeWidth="0.8" />
    </svg>
  );
}
export function EnvIcon({ size = 14 }: IconProps) {
  // file outline + key symbol
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <circle cx="5.5" cy="8.5" r="1.5" stroke={DIM} strokeWidth="0.9" />
      <path d="M7 8.5h2.5M8.5 8.5v1.5" stroke={DIM} strokeWidth="0.9" strokeLinecap="round" />
    </svg>
  );
}
export function GitIcon({ size = 14 }: IconProps) {
  // file outline + git branch lines
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <circle cx="5" cy="6.5" r="1" stroke={DIM} strokeWidth="0.85" />
      <circle cx="9" cy="6.5" r="1" stroke={DIM} strokeWidth="0.85" />
      <circle cx="5" cy="10" r="1" stroke={DIM} strokeWidth="0.85" />
      <path d="M5 7.5V9" stroke={DIM} strokeWidth="0.85" strokeLinecap="round" />
      <path d="M9 7.5v.5a2 2 0 0 1-2 2H6" stroke={DIM} strokeWidth="0.85" strokeLinecap="round" fill="none" />
    </svg>
  );
}
export function LockFileIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <rect x="4.5" y="8.5" width="5" height="3" rx="0.6" stroke={DIM} strokeWidth="0.9" />
      <path d="M5.5 8.5V7.5a1.5 1.5 0 0 1 3 0v1" stroke={DIM} strokeWidth="0.9" strokeLinecap="round" fill="none" />
    </svg>
  );
}
export function ConfigIcon({ size = 14 }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 14 14" fill="none">
      <path d="M2.5 1h6l3 3v9h-9V1Z" stroke={DIM} strokeWidth="0.9" fill={DIM} fillOpacity="0.07" strokeLinejoin="round" />
      <path d="M8.5 1v3h3" stroke={DIM} strokeWidth="0.9" fill="none" strokeLinejoin="round" />
      <circle cx="7" cy="8.5" r="1.3" stroke={DIM} strokeWidth="0.9" />
      <path d="M7 6.5v.7M7 10.3v.7M5 8.5h.7M8.3 8.5H9M5.5 6.9l.5.5M8.5 9.6l-.5-.5M5.5 10.1l.5-.5M8.5 7.4l-.5.5"
        stroke={DIM} strokeWidth="0.8" strokeLinecap="round" />
    </svg>
  );
}

// ── Main resolver ─────────────────────────────────────────────────────────

export function getFileIcon(name: string, size = 14): React.ReactNode {
  const lower = name.toLowerCase();
  const ext = lower.split(".").pop() ?? "";

  if (lower === "dockerfile" || lower.startsWith("dockerfile.")) return <DockerfileIcon size={size} />;
  if (lower === ".env" || lower.startsWith(".env.")) return <EnvIcon size={size} />;
  if (lower === ".gitignore" || lower === ".gitattributes" || lower === ".gitmodules") return <GitIcon size={size} />;
  if (lower === "package-lock.json" || lower === "yarn.lock" || lower === "bun.lock" || lower === "pnpm-lock.yaml" || lower === "cargo.lock") return <LockFileIcon size={size} />;
  if (lower.endsWith(".config.ts") || lower.endsWith(".config.js") || lower.endsWith(".config.mjs") || lower.endsWith(".config.cjs")) return <ConfigIcon size={size} />;
  if ([".eslintrc", ".eslintrc.js", ".eslintrc.json", ".eslintrc.yml", "eslint.config.mjs", "eslint.config.js"].includes(lower)) return <ConfigIcon size={size} />;

  switch (ext) {
    case "ts":      return <TypeScriptIcon size={size} />;
    case "tsx":     return <TypeScriptReactIcon size={size} />;
    case "js":
    case "mjs":
    case "cjs":     return <JavaScriptIcon size={size} />;
    case "jsx":     return <JavaScriptReactIcon size={size} />;
    case "py":      return <PythonIcon size={size} />;
    case "json":
    case "jsonl":   return <JsonIcon size={size} />;
    case "css":
    case "less":    return <CssIcon size={size} />;
    case "scss":    return <ScssIcon size={size} />;
    case "html":
    case "htm":     return <HtmlIcon size={size} />;
    case "md":
    case "mdx":     return <MarkdownIcon size={size} />;
    case "yaml":
    case "yml":     return <YamlIcon size={size} />;
    case "toml":    return <TomlIcon size={size} />;
    case "sh":
    case "bash":
    case "zsh":
    case "fish":    return <ShellIcon size={size} />;
    case "rs":      return <RustIcon size={size} />;
    case "go":      return <GoIcon size={size} />;
    case "sql":     return <SqlIcon size={size} />;
    case "graphql":
    case "gql":     return <GraphqlIcon size={size} />;
    case "tf":
    case "hcl":     return <TerraformIcon size={size} />;
    case "lock":    return <LockFileIcon size={size} />;
    default:        return <GenericFileIcon size={size} />;
  }
}
