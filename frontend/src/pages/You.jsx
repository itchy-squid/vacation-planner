import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import HomeTabBar from "../components/core/HomeTabBar";
import Button from "../components/core/Button";
import { api, logout } from "../lib/api";

// The You tab: who you're signed in as, signing out, and deleting your
// account. These used to sit at the foot of Trips home; they're about you
// rather than any trip, so they live on their own tab now. Deleting opens
// a confirmation screen (pages/DeleteAccount.jsx) rather than doing
// anything here.
export default function You() {
  const navigate = useNavigate();
  const [me, setMe] = useState(null);

  useEffect(() => {
    let cancelled = false;
    api
      .me()
      .then((data) => {
        if (!cancelled) setMe(data);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <div style={{ padding: "20px var(--gutter-text) 14px" }}>
          <h1 style={{ font: "700 26px var(--font-sans)", color: "var(--text-primary)" }}>You</h1>
        </div>

        <div style={{ padding: "0 var(--gutter-screen)" }}>
          <div
            style={{
              background: "var(--surface-card)",
              borderRadius: "var(--radius-xl)",
              border: "1px solid var(--hairline)",
              padding: "16px 18px",
            }}
          >
            <div className="mono-caption">Signed in as</div>
            <div style={{ font: "600 15px var(--font-sans)", color: "var(--text-primary)", marginTop: 8 }}>
              {me?.display_name ?? "…"}
            </div>
            <div style={{ font: "400 12.5px var(--font-sans)", color: "var(--text-secondary)", marginTop: 2 }}>
              {me?.email ?? ""}
            </div>
          </div>

          <div style={{ marginTop: 16 }}>
            <Button variant="secondary" onClick={() => logout()}>
              Sign out
            </Button>
          </div>
          <div style={{ display: "flex", justifyContent: "center", marginTop: 18 }}>
            <button
              type="button"
              className="tap hit-target"
              onClick={() => navigate("/account/delete")}
              style={{
                padding: "0 16px",
                background: "none",
                border: "none",
                font: "500 12.5px var(--font-sans)",
                color: "var(--text-muted)",
                cursor: "pointer",
              }}
            >
              Delete account
            </button>
          </div>
        </div>
      </div>
      <HomeTabBar />
    </div>
  );
}
