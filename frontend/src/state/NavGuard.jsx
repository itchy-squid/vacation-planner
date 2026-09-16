import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

// "You have unsaved changes — leave anyway?" for screens that hold a local
// draft instead of writing every keystroke straight through (see
// pages/EditVisit.jsx, the first of them). One screen registers a guard
// while its draft is dirty; every in-app way off that screen asks first.
//
// Scope, deliberately: this guards *in-app* navigation that routes through
// useGuardedNavigate — the screen's own Cancel, the ⌂ home button
// (components/core/HomeButton.jsx) and the bottom tab bar
// (components/core/BottomNav.jsx), which together are every way out of an
// edit screen the app itself offers. It does NOT guard the browser's back
// button or a tab close: blocking a popstate needs react-router's
// useBlocker, which only exists on a data router (createBrowserRouter),
// and this app mounts a plain <BrowserRouter> (see App.jsx). If that ever
// changes, this is the place to add it — the guard registry below wouldn't
// change, only what consults it.
//
// The sheet itself lives here rather than in the guarded screen so that
// all three exits share one confirmation instead of each growing its own.

const NavGuardContext = createContext(null);

export function NavGuardProvider({ children }) {
  const navigate = useNavigate();

  // At most one guard at a time — only one screen is mounted and editable
  // at a time, and a ref (not state) because every read happens inside an
  // event handler, and re-rendering the whole app on each keystroke of a
  // draft just to record "still dirty" would be wasteful.
  const guardRef = useRef(null);
  const [pending, setPending] = useState(null); // { to, options, prompt } while the sheet is open

  const register = useCallback((token, guard) => {
    guardRef.current = { token, ...guard };
  }, []);

  const unregister = useCallback((token) => {
    if (guardRef.current?.token === token) guardRef.current = null;
  }, []);

  const isGuarded = useCallback(() => Boolean(guardRef.current?.active), []);

  // Drop-in for useNavigate() on any control that can leave a guarded
  // screen. Returns true if it navigated, false if it opened the sheet
  // instead — callers generally don't care, but a caller that wants to do
  // something else on a real departure can.
  const guardedNavigate = useCallback(
    (to, options) => {
      if (!guardRef.current?.active) {
        navigate(to, options);
        return true;
      }
      setPending({ to, options, prompt: guardRef.current });
      return false;
    },
    [navigate]
  );

  function discardAndGo() {
    const target = pending;
    setPending(null);
    if (!target) return;
    // Stand the guard down before navigating so the screen's own cleanup
    // doesn't race this navigate into a second confirmation.
    guardRef.current = null;
    navigate(target.to, target.options);
  }

  const value = useMemo(
    () => ({ register, unregister, isGuarded, guardedNavigate }),
    [register, unregister, isGuarded, guardedNavigate]
  );

  const prompt = pending?.prompt;

  return (
    <NavGuardContext.Provider value={value}>
      {children}
      {pending && (
        // Same shape as the other confirmations in the app (the propose-an-
        // alternative sheet in pages/DaySchedule.jsx): absolute rather than
        // fixed so it stays inside the 430px .app-viewport column on a wide
        // screen. zIndex clears BottomNav's 999.
        <div
          style={{ position: "absolute", inset: 0, background: "rgba(0,0,0,.4)", display: "flex", alignItems: "flex-end", zIndex: 1000 }}
          onClick={() => setPending(null)}
        >
          <div
            style={{ background: "var(--surface-card)", borderRadius: "20px 20px 0 0", padding: "18px 18px 28px", width: "100%" }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ width: 38, height: 4, borderRadius: 99, background: "var(--stone-250)", margin: "0 auto 14px" }} />
            <div className="serif-place" style={{ fontSize: 19, color: "var(--text-primary)" }}>
              {prompt?.title ?? "Discard changes?"}
            </div>
            <div style={{ marginTop: 8, font: "400 13px var(--font-sans)", lineHeight: 1.5, color: "var(--text-secondary)" }}>
              {prompt?.body ?? "Your changes haven't been saved yet."}
            </div>
            <div style={{ marginTop: 16, display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => setPending(null)}
                style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", border: "1px solid var(--border-strong)", font: "600 13px var(--font-sans)", color: "var(--text-primary)" }}
              >
                {prompt?.stayLabel ?? "Keep editing"}
              </button>
              <button
                type="button"
                onClick={discardAndGo}
                style={{ flex: 1, height: 44, borderRadius: "var(--radius-lg)", background: "var(--surface-inverse)", color: "#fff", font: "600 13px var(--font-sans)" }}
              >
                {prompt?.leaveLabel ?? "Discard"}
              </button>
            </div>
          </div>
        </div>
      )}
    </NavGuardContext.Provider>
  );
}

function useNavGuardContext() {
  const ctx = useContext(NavGuardContext);
  if (!ctx) throw new Error("useNavGuard/useGuardedNavigate must be used within NavGuardProvider");
  return ctx;
}

// Call from a screen with a draft: while `active` is true, any guarded
// navigation opens the confirmation above instead of leaving. `prompt`
// supplies the wording ({ title, body, stayLabel, leaveLabel }) so each
// screen can say what's actually at stake.
export function useNavGuard(active, prompt) {
  const { register, unregister } = useNavGuardContext();
  // Identity for this hook instance, so a screen unmounting can only ever
  // clear its own guard.
  const tokenRef = useRef({});
  const { title, body, stayLabel, leaveLabel } = prompt ?? {};

  useEffect(() => {
    const token = tokenRef.current;
    register(token, { active, title, body, stayLabel, leaveLabel });
    return () => unregister(token);
  }, [register, unregister, active, title, body, stayLabel, leaveLabel]);
}

// For controls that leave a screen: navigates as usual, except when a
// guard is armed, in which case it asks first.
export function useGuardedNavigate() {
  return useNavGuardContext().guardedNavigate;
}

// For links that want to keep their normal anchor behaviour (new tab,
// modifier-click) and only intercept a plain left-click while guarded —
// see components/core/BottomNav.jsx.
export function useIsNavGuarded() {
  return useNavGuardContext().isGuarded;
}
