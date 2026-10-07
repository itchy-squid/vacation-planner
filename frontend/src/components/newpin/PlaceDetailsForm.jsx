import { useState } from "react";
import TextField from "../forms/TextField";
import Stepper from "../forms/Stepper";
import CostField from "../forms/CostField";
import Button from "../core/Button";
import PhotoPicker from "../photos/PhotoPicker";
import { NewPinHeader, AddModeSwitch, SourceTag } from "./NewPinChrome";
import { areaLine, googleMapsPlaceUrl, regionFor } from "../../lib/places";
import { fmtMin } from "../../data/derive";

const DEFAULT_MINUTES = 60;
const MIN_MINUTES = 15;

/**
 * Step 2 of adding a pin by search: the new-pin form, filled in from the
 * place that was picked. Everything stays editable; the tags say which
 * values came from the search. Time and cost are typed for now.
 *
 *   place         a lib/places.js search result
 *   tripId        the trip, for the photo picker
 *   knownRegions  the regions the trip already uses, to match against
 *   canSetCost    whether this person may price their own ideas
 *   onSubmit(payload)  the POST /api/trips/{id}/pins body
 */
export default function PlaceDetailsForm({ place, tripId, knownRegions, canSetCost, submitting, error, onBack, onLink, onSubmit }) {
  const [suggestedRegion] = useState(() => regionFor(place, knownRegions));
  const [title, setTitle] = useState(place.name);
  const [region, setRegion] = useState(suggestedRegion.name);
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [cost, setCost] = useState("");
  const [costBasis, setCostBasis] = useState("per_head");
  // One of the place's Google photos (its position), a pasted image link,
  // or neither.
  const [photo, setPhoto] = useState({ url: "", sourceUrl: "", googleIndex: null });

  const mapsUrl = googleMapsPlaceUrl(place);
  const canSubmit = title.trim().length > 0 && !submitting;

  function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    const finalTitle = title.trim();
    const costCents = Math.round(Math.max(0, Number(cost) || 0) * 100);
    onSubmit({
      title: finalTitle,
      place: areaLine(place),
      region: region.trim(),
      lat: place.lat,
      lng: place.lng,
      google_place_id: place.placeId,
      link: mapsUrl,
      duration_minutes: minutes,
      notes: "",
      tags: [],
      ...(photo.googleIndex != null ? { photo_google_index: photo.googleIndex } : {}),
      ...(photo.url.trim() ? { photo_url: photo.url.trim(), photo_source_url: photo.sourceUrl || photo.url.trim() } : {}),
      // Only sent when set: pricing needs its own permission.
      ...(canSetCost && costCents > 0 ? { cost_cents: costCents, cost_basis: costBasis } : {}),
    });
  }

  const regionTag = region.trim() && region.trim() === suggestedRegion.name
    ? <SourceTag tone={suggestedRegion.existing ? "geo" : "neutral"}>{suggestedRegion.existing ? "Matched" : "New region"}</SourceTag>
    : null;

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <NewPinHeader
          backLabel="Search"
          onBack={onBack}
          action={
            <button type="button" onClick={submit} disabled={!canSubmit} style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}>
              {submitting ? "Adding…" : "Add"}
            </button>
          }
        />
        <AddModeSwitch mode="search" onLink={onLink} />

        <form onSubmit={submit} style={{ padding: "0 16px", display: "flex", flexDirection: "column", gap: 14 }}>
          <div>
            <div className="mono-caption">Place</div>
            <div
              style={{
                marginTop: 6,
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "10px 12px",
                borderRadius: "var(--radius-lg)",
                border: "1px solid var(--teal-line)",
                background: "var(--geo-quiet)",
              }}
            >
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ font: "600 13.5px var(--font-sans)", color: "var(--text-primary)" }}>{place.name}</div>
                <div className="mono-data-sm" style={{ color: "var(--text-secondary)", letterSpacing: 0, marginTop: 2 }}>{place.address}</div>
              </div>
              <button type="button" onClick={onBack} style={{ flex: "none", font: "500 12px var(--font-sans)", color: "var(--accent)" }}>
                Change
              </button>
            </div>
          </div>

          <LabeledTag tag={title === place.name ? <SourceTag>From Google</SourceTag> : null}>
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} weight={600} size={15} />
          </LabeledTag>

          <LabeledTag tag={regionTag}>
            <TextField label="Region" value={region} onChange={(e) => setRegion(e.target.value)} placeholder="e.g. Xiaoliuqiu" list="new-pin-known-regions" />
            {knownRegions.length ? (
              <datalist id="new-pin-known-regions">
                {knownRegions.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
            ) : null}
          </LabeledTag>

          <Stepper
            label="Time there"
            valueLabel={fmtMin(minutes)}
            onDown={() => setMinutes((m) => Math.max(MIN_MINUTES, m - 15))}
            onUp={() => setMinutes((m) => m + 15)}
          />

          {canSetCost ? (
            <CostField id="new-pin-cost" value={cost} onChange={setCost} basis={costBasis} onBasis={setCostBasis} disabled={submitting} />
          ) : null}

          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span className="mono-caption">Google Maps link</span>
              <SourceTag>From Google</SourceTag>
            </div>
            <a
              href={mapsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mono-data-sm"
              style={{ display: "block", marginTop: 6, padding: "11px 13px", borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", background: "var(--surface-card)", color: "var(--text-secondary)", letterSpacing: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            >
              Open {place.name} in Google Maps ↗
            </a>
          </div>

          <PhotoPicker
            tripId={tripId}
            link={mapsUrl}
            placeId={place.placeId}
            photoUrl={photo.url}
            googleIndex={photo.googleIndex}
            onPick={(url, sourceUrl, origin, googleIndex) => setPhoto({ url, sourceUrl: sourceUrl ?? "", googleIndex: googleIndex ?? null })}
          />

          {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}

          <Button variant="accent" type="submit" disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Adding…" : "Add to board"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)" }}>
            Everyone on the trip sees it once it’s added.
          </div>
        </form>
      </div>
    </div>
  );
}

// A form field with a small source tag pinned to the top-right corner of
// its label row.
function LabeledTag({ tag, children }) {
  return (
    <div style={{ position: "relative" }}>
      {tag ? <div style={{ position: "absolute", top: 0, right: 0, lineHeight: 1 }}>{tag}</div> : null}
      {children}
    </div>
  );
}
