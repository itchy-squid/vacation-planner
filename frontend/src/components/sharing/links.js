// The shareable URL for an invite token. Always the SPA's own origin —
// /join/:token is a frontend route (see App.jsx), not an API path.
export function inviteUrl(token) {
  return `${window.location.origin}/join/${token}`;
}

// Resolves true when the text reached the clipboard. Clipboard access can
// be refused (insecure origin, permissions), so callers show the link for
// manual copying when this resolves false.
export async function copyText(text) {
  try {
    await window.navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
