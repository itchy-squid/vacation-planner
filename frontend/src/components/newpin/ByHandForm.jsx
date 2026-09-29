import { useState } from "react";
import TextField from "../forms/TextField";
import Stepper from "../forms/Stepper";
import CostField from "../forms/CostField";
import RegionPicker from "../forms/RegionPicker";
import Button from "../core/Button";
import WhereOnMap from "../map/WhereOnMap";
import { useRegionPreview } from "../map/useRegionPreview";
import { NewPinHeader, AddModeSwitch, SourceTag } from "./NewPinChrome";
import { externalHref } from "../../lib/externalHref";
import { hintsFromLink } from "../../lib/linkHints";
import { isMapsConfigured } from "../../lib/googleMaps";
import { regionKey } from "../../lib/regions";
import { fmtMin } from "../../data/derive";

const DEFAULT_MINUTES = 60;
const MIN_MINUTES = 15;

// When nothing better is typed, a pasted link's host is the title
// placeholder, the way bookmarking tools name a link.
function hostOf(link) {
  const href = externalHref(link);
  if (!href) return null;
  try {
    return new window.URL(href).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/**
 * Adding an idea Google Maps doesn't list: a tour from Viator, a friend's
 * tip, an article. It still goes on the map: in its region (pick
 * "Cozumel" and it shows in Cozumel), or at an exact spot if one is
 * pinned. The way to add ideas when there's no Maps key, too (without the
 * map preview).
 *
 *   knownRegions       the regions the trip already uses, offered as chips
 *   focusTitle         start in the title rather than the link
 *   onSearch           switch to place search; absent without a Maps key
 *   onSubmit({ payload, newRegion })
 *                      payload is the POST /api/trips/{id}/pins body;
 *                      newRegion is where a region the trip hasn't stored
 *                      yet was found, to store alongside it
 */
export default function ByHandForm({ trip, knownRegions, canSetCost, focusTitle, submitting, error, onCancel, onSearch, onSubmit }) {
  const [link, setLink] = useState("");
  const [title, setTitle] = useState("");
  const [region, setRegion] = useState("");
  const [hinted, setHinted] = useState({ title: null, region: null });
  const [spot, setSpot] = useState(null);
  const [minutes, setMinutes] = useState(DEFAULT_MINUTES);
  const [cost, setCost] = useState("");
  const [costBasis, setCostBasis] = useState("per_head");
  const { chosenChip, knownByKey, location, lookingUp } = useRegionPreview(region, knownRegions);

  function changeLink(next) {
    setLink(next);
    const hints = hintsFromLink(next);
    if (!hints) return;
    // Only fill fields the person hasn't typed in (or that the last link filled).
    if (hints.title && (!title.trim() || title === hinted.title)) setTitle(hints.title);
    const hintRegion = hints.place ? knownByKey[regionKey(hints.place)] ?? hints.place : null;
    if (hintRegion && (!region.trim() || region === hinted.region)) setRegion(hintRegion);
    setHinted({ title: hints.title, region: hintRegion });
  }

  const finalTitle = title.trim() || hostOf(link.trim()) || "";
  const canSubmit = (link.trim().length > 0 || title.trim().length > 0) && !submitting;

  function submit(e) {
    e?.preventDefault();
    if (!canSubmit) return;
    const name = finalTitle || "Untitled pin";
    const costCents = Math.round(Math.max(0, Number(cost) || 0) * 100);
    const regionName = region.trim();
    onSubmit({
      payload: {
        title: name,
        place: regionName || name,
        region: regionName,
        link: link.trim(),
        duration_minutes: minutes,
        notes: "",
        tags: [],
        ...(spot ? { lat: spot.lat, lng: spot.lng } : {}),
        // Only sent when set: pricing needs its own permission.
        ...(canSetCost && costCents > 0 ? { cost_cents: costCents, cost_basis: costBasis } : {}),
      },
      newRegion: location && !location.id ? { ...location, name: regionName } : null,
    });
  }

  return (
    <div className="screen">
      <div className="screen-scroll" style={{ paddingBottom: 24 }}>
        <NewPinHeader
          backLabel="Cancel"
          onBack={onCancel}
          action={
            <button type="button" onClick={submit} disabled={!canSubmit} style={{ font: "600 13px var(--font-sans)", color: canSubmit ? "var(--text-primary)" : "var(--text-muted)" }}>
              {submitting ? "Adding…" : "Add"}
            </button>
          }
        />
        {onSearch ? <AddModeSwitch mode="link" onSearch={onSearch} /> : null}

        <form onSubmit={submit} style={{ padding: onSearch ? "0 16px" : "16px 16px 0", display: "flex", flexDirection: "column", gap: 14 }}>
          <TextField
            label="Link"
            value={link}
            onChange={(e) => changeLink(e.target.value)}
            placeholder="Paste a link: Viator, Instagram, an article…"
            mono
            size={12.5}
            autoFocus={!focusTitle}
          />

          <div style={{ position: "relative" }}>
            {hinted.title && title === hinted.title ? (
              <div style={{ position: "absolute", top: 0, right: 0, lineHeight: 1 }}>
                <SourceTag tone="neutral">From the link</SourceTag>
              </div>
            ) : null}
            <TextField
              label="Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={hostOf(link.trim()) || "e.g. Snorkel and beach tour"}
              weight={600}
              size={15}
              autoFocus={focusTitle}
            />
          </div>

          <RegionPicker
            knownRegions={knownRegions}
            value={region}
            chosenChip={chosenChip}
            onChange={setRegion}
            tag={hinted.region && region === hinted.region ? <SourceTag tone="neutral">From the link</SourceTag> : null}
          />

          {isMapsConfigured ? (
            <WhereOnMap trip={trip} regionName={region.trim()} location={location} lookingUp={lookingUp} newRegion={!chosenChip} spot={spot} onSpot={setSpot} />
          ) : null}

          <Stepper
            label="Time there"
            valueLabel={fmtMin(minutes)}
            onDown={() => setMinutes((m) => Math.max(MIN_MINUTES, m - 15))}
            onUp={() => setMinutes((m) => m + 15)}
          />
          {canSetCost ? <CostField id="by-hand-cost" value={cost} onChange={setCost} basis={costBasis} onBasis={setCostBasis} disabled={submitting} /> : null}

          {error ? <div style={{ font: "500 12.5px var(--font-sans)", color: "#b3423a" }}>{error}</div> : null}

          <Button variant="accent" type="submit" disabled={!canSubmit} style={{ marginTop: 4 }}>
            {submitting ? "Adding…" : "Add to board"}
          </Button>
          <div style={{ textAlign: "center", font: "400 11px var(--font-sans)", color: "var(--text-muted)", paddingBottom: 8 }}>
            A photo link can be added on the idea afterwards.
          </div>
        </form>
      </div>
    </div>
  );
}
