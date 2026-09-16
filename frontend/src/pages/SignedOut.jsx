import Button from "../components/core/Button";
import { AUTH_PROVIDERS, PROVIDER_LABELS, signIn } from "../lib/api";

// Shown instead of the app when a user arrives at "/?signedout=1" — the
// landing Easy Auth sends them to after lib/api.js's logout(). Its only
// job is to stop main.jsx's ensureSignedIn() from immediately redirecting
// them back into Entra, which would make signing out look like a no-op.
// Also the "choose how to sign in" screen ("/?signin=1", mode="signIn")
// when more than one Easy Auth provider is on — one button per provider.
//
// NOT a design-handoff screen: the handoff explicitly leaves
// invite/permissions/login screens undesigned (see README "Not designed at
// all"). Built from tokens only, deliberately plain, and expected to be
// replaced whenever those screens do get designed.
const COPY = {
  signedOut: { title: "You\u2019re signed out", body: "Sign back in to get to your trips." },
  signIn: { title: "Sign in", body: "Sign in to get to your trips." },
};

export default function SignedOut({ mode = "signedOut" }) {
  const copy = COPY[mode] ?? COPY.signedOut;
  const single = AUTH_PROVIDERS.length === 1;
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
          {copy.title}
        </h1>
        <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", margin: 0, maxWidth: "32ch" }}>
          {copy.body}
        </p>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: "var(--space-5)" }}>
        {AUTH_PROVIDERS.map((provider, i) => (
          <Button
            key={provider}
            onClick={() => signIn(provider)}
            variant={i === 0 ? "primary" : "secondary"}
            fullWidth={false}
            style={{ minWidth: 240 }}
          >
            {single ? "Sign in" : `Sign in with ${PROVIDER_LABELS[provider]}`}
          </Button>
        ))}
      </div>
    </main>
  );
}
