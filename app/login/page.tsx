import { LoginForm } from "./LoginForm";

export default function LoginPage() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "grid",
        placeItems: "center",
        padding: 24,
        background: "radial-gradient(circle at top, color-mix(in srgb, var(--accent) 12%, transparent), transparent 32%), var(--bg)",
      }}
    >
      <div style={{ width: "100%", maxWidth: 380 }}>
        <LoginForm />
      </div>
    </main>
  );
}
