/** How pins are matched to a region: "Cozumel" and " cozumel" are one. */
export function regionKey(name) {
  return (name ?? "").trim().toLowerCase();
}
