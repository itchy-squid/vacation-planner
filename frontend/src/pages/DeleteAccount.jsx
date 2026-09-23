import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Button from "../components/core/Button";
import HomeButton from "../components/core/HomeButton";
import { api, logout } from "../lib/api";

// /account/delete: self-serve account deletion, reached from "Delete
// account" at the bottom of Trips Home. This screen is the confirmation
// step: it lists what happens to each of your trips (GET
// /api/me/deletion-preview), and the button does it (DELETE /api/me; see
// backend/app/routers/account.py for the rules). Afterwards you're signed
// out and land on the signed-out screen's "account deleted" message.

function TripGroup({ title, note, trips, detail }) {
  if (!trips.length) return null;
  return (
    <section
      style={{
        background: "var(--surface-card)",
        borderRadius: "var(--radius-xl)",
        border: "1px solid var(--hairline)",
        padding: "14px 16px 16px",
      }}
    >
      <h2 className="mono-caption">{title}</h2>
      {note ? (
        <p style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)", marginTop: 6 }}>{note}</p>
      ) : null}
      <ul style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 12 }}>
        {trips.map((t) => (
          <li key={t.id}>
            <div className="serif-place" style={{ fontSize: 18, lineHeight: 1.25, color: "var(--text-primary)" }}>
              {t.name}
            </div>
            {detail ? (
              <div style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)", marginTop: 2 }}>
                {detail(t)}
              </div>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function DeleteAccount() {
  const navigate = useNavigate();
  const [preview, setPreview] = useState(null);
  const [loadError, setLoadError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api
      .accountDeletionPreview()
      .then((data) => {
        if (!cancelled) setPreview(data);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(err.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleDelete() {
    if (deleting) return;
    setDeleting(true);
    setDeleteError("");
    try {
      await api.deleteAccount();
    } catch (err) {
      setDeleting(false);
      setDeleteError(`Couldn’t delete your account. Nothing was changed. (${err.message})`);
      return;
    }
    logout({ accountDeleted: true });
  }

  const noTrips = preview && !preview.handed_over.length && !preview.deleted.length && !preview.left.length;

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 28 }}>
        <div style={{ padding: "16px var(--gutter-screen) 0" }}>
          <HomeButton />
        </div>
        <div style={{ padding: "16px var(--gutter-text) 14px" }}>
          <div className="mono-caption">Your account</div>
          <h1 className="serif-place" style={{ font: "var(--type-display)", color: "var(--text-primary)", marginTop: 8 }}>
            Delete your account
          </h1>
          <p style={{ font: "var(--type-body)", color: "var(--text-secondary)", marginTop: 10 }}>
            This takes you off every trip and removes your name and email address from Vacation Planner. It can’t be
            undone.
          </p>
        </div>

        <div style={{ padding: "0 var(--gutter-screen)", display: "flex", flexDirection: "column", gap: 12 }}>
          {loadError ? (
            <p role="alert" style={{ font: "var(--type-body)", color: "var(--warn)" }}>
              Couldn’t load your trips: {loadError}
            </p>
          ) : null}

          {!preview && !loadError ? <div className="mono-caption">Loading your trips…</div> : null}

          {preview ? (
            <>
              <TripGroup
                title="Trips you’ll hand over"
                note="You own these. The person named takes over as owner, and the trip carries on without you."
                trips={preview.handed_over}
                detail={(t) => `${t.new_owner_name} becomes the owner`}
              />
              <TripGroup
                title="Trips that will be deleted"
                note="Nobody else is on these, so they’re deleted along with everything in them."
                trips={preview.deleted}
              />
              <TripGroup title="Trips you’ll leave" trips={preview.left} />
              {noTrips ? (
                <p style={{ font: "var(--type-body)", color: "var(--text-secondary)" }}>You’re not on any trips.</p>
              ) : (
                <p style={{ font: "var(--type-body-sm)", color: "var(--text-secondary)" }}>
                  Places, travel items and plans you added to trips that carry on stay there for the group, without
                  your name. Your votes, comments and drafts are deleted.
                </p>
              )}
            </>
          ) : null}

          {deleteError ? (
            <p role="alert" style={{ font: "var(--type-body)", color: "var(--warn)" }}>
              {deleteError}
            </p>
          ) : null}

          <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}>
            <Button
              onClick={handleDelete}
              disabled={!preview || deleting}
              style={{ background: "var(--warn)", color: "var(--text-on-accent)" }}
            >
              {deleting ? "Deleting…" : "Delete my account"}
            </Button>
            <Button variant="secondary" onClick={() => navigate("/")} disabled={deleting}>
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
