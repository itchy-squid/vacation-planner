import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import BootScreen from "./pages/BootScreen.jsx";
import SignedOut from "./pages/SignedOut.jsx";
import Home from "./pages/public/Home.jsx";
import PrivacyPolicy from "./pages/public/PrivacyPolicy.jsx";
import {
  clearReturnPath,
  ensureSignedIn,
  isAccountDeletedLanding,
  isSignedIn,
  isSignInLanding,
  isSignedOutLanding,
  restoreReturnPath,
} from "./lib/api";
import "./styles/styles.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

function render(element) {
  root.render(<React.StrictMode>{element}</React.StrictMode>);
}

function renderApp() {
  // Back from Easy Auth at "/": reopen the page (e.g. a /join/:token
  // share link) they were on before being sent to sign in.
  restoreReturnPath();
  render(<App />);
}

// "/privacy/" and "/privacy" are the same page.
const path = window.location.pathname.replace(/\/+$/, "") || "/";

// Public pages (pages/public/): rendered for anyone, signed in or not,
// without the session check. Google's OAuth brand verification needs a
// public homepage and privacy policy on our own domain. "/about" is the
// homepage for everyone, including signed-in users (and local dev, which
// is always signed in); "/" shows it only to signed-out visitors, below.
if (path === "/privacy") {
  render(<PrivacyPolicy />);
} else if (path === "/about") {
  render(<Home />);
} else if (isSignedOutLanding() || isSignInLanding()) {
  // Someone who just used "Sign out" comes back to "/?signedout=1". Render
  // the signed-out screen for them *without* calling ensureSignedIn() —
  // calling it would find no session and bounce them straight back into
  // Entra, i.e. undo the logout they just asked for.
  //
  // "/?signin=1" is where lib/api.js sends a signed-out user when more than
  // one sign-in provider is on and it can't tell which one they use. Same
  // screen, same reason not to call ensureSignedIn().
  //
  // After a deliberate sign-out, don't later drop them on whatever page a
  // stale session was trying to reach. The chooser keeps it — that's the
  // page they're about to sign in for.
  if (isSignedOutLanding()) clearReturnPath();
  const mode = !isSignedOutLanding() ? "signIn" : isAccountDeletedLanding() ? "accountDeleted" : "signedOut";
  render(<SignedOut mode={mode} />);
} else if (path === "/") {
  // A signed-out visitor at the root gets the homepage instead of being
  // sent straight to log in; its Sign in buttons take it from there.
  // Everywhere else (a /join/:token link, a bookmarked trip) still sends
  // them to log in first, so they come back to the page they wanted.
  // An inconclusive check (null) counts as signed in, as in
  // ensureSignedIn().
  render(<BootScreen />);
  isSignedIn().then((signedIn) => {
    if (signedIn === false) render(<Home />);
    else renderApp();
  });
} else {
  // Gate the rest of the app on the Easy Auth session check (see
  // lib/api.js) so a signed-out user is sent to log in before anything
  // tries to render, rather than after the first API call fails. Resolves
  // immediately in local dev and for anyone already signed in.
  //
  // The check can sit behind a backend cold start, so BootScreen holds the
  // page until it answers (see pages/BootScreen.jsx).
  render(<BootScreen />);
  ensureSignedIn({ onRedirect: () => render(<BootScreen phase="signingIn" />) }).then(renderApp);
}
