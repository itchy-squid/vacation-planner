import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import { ensureSignedIn } from "./lib/api";
import "./styles/styles.css";

// Gate the whole app on the Easy Auth session check (see lib/api.js) so a
// signed-out user is sent to log in before anything tries to render,
// rather than after the first API call fails. Resolves immediately in
// local dev and for anyone already signed in.
ensureSignedIn().then(() => {
  ReactDOM.createRoot(document.getElementById("root")).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
