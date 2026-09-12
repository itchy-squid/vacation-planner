import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import SignedOut from "./pages/SignedOut.jsx";
import { ensureSignedIn, isSignedOutLanding } from "./lib/api";
import "./styles/styles.css";

const root = ReactDOM.createRoot(document.getElementById("root"));

// Someone who just used "Sign out" comes back to "/?signedout=1". Render
// the signed-out screen for them *without* calling ensureSignedIn() —
// calling it would find no session and bounce them straight back into
// Entra, i.e. undo the logout they just asked for.
if (isSignedOutLanding()) {
  root.render(
    <React.StrictMode>
      <SignedOut />
    </React.StrictMode>
  );
} else {
  // Gate the whole app on the Easy Auth session check (see lib/api.js) so a
  // signed-out user is sent to log in before anything tries to render,
  // rather than after the first API call fails. Resolves immediately in
  // local dev and for anyone already signed in.
  ensureSignedIn().then(() => {
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
  });
}
