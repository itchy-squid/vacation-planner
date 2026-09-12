import Button from "../components/core/Button";
import { signIn } from "../lib/api";

// Shown instead of the app when a user arrives at "/?signedout=1" — the
// landing Easy Auth sends them to after lib/api.js's logout(). Its only
// job is to stop main.jsx's ensureSignedIn() from immediately redirecting
// them back into Entra, which would make signing out look like a no-op.
//
// NOT a design-handoff screen: the handoff explicitly leaves
// invite/permissions/login screens undesigned (see README "Not designed at
// all"). Built from tokens only, deliberately plain, and expected to be
// replaced whenever those screens do get designed.
export default function SignedOut() {
  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "var(--space-9)",
        padding: "var(--space-9)",
        textAlign: "center",
        background: "var(--surface-page)",
      }}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        <h1 style={{ font: "var(--type-title)", color: "var(--text-primary)", margin: 0 }}>
          You&apos;re signed out
        </h1>
        <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: 0, maxWidth: "32ch" }}>
          Sign back in to get to your trips.
        </p>
      </div>
      <Button onClick={signIn} fullWidth={false} style={{ minWidth: 180 }}>
        Sign in
      </Button>
    </main>
  );
}
