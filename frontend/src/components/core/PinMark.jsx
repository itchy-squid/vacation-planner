// The pin mark: this calendar event or Itinerary stop is an idea from the
// board (a pin), not a custom event or a ride. Drawn in the pin colour
// (--pin, used for nothing else) so it stands out on the teal calendar.
export default function PinMark({ size = 10, title = "Idea" }) {
  return (
    <svg
      viewBox="0 0 12 16"
      width={size}
      height={(size * 16) / 12}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
      style={{ flex: "none", display: "block" }}
    >
      <path d="M6 .8C3.1.8.8 3.1.8 5.9c0 3.9 5.2 9.2 5.2 9.2s5.2-5.3 5.2-9.2C11.2 3.1 8.9.8 6 .8z" fill="var(--pin)" />
      <circle cx="6" cy="6" r="2" fill="#fff" />
    </svg>
  );
}
