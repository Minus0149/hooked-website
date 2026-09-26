import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import { resetPasswordProblem } from "../lib/authForms";

/**
 * Where the "reset your password" email lands: /reset-password?token=…
 *
 * The app used to send the reset link and then have nowhere for it to go — the
 * token arrived and nothing read it, so a forgotten password could never
 * actually be changed.
 */
export function ResetPasswordScreen({
  token,
  error,
}: {
  token: string | null;
  error: string | null;
}) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const badLink = !token || error === "INVALID_TOKEN";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const issue = resetPasswordProblem(password, confirm);
    if (issue) {
      setProblem(issue);
      return;
    }
    setBusy(true);
    setProblem(null);
    const res = await authClient.resetPassword({
      newPassword: password,
      token: token ?? "",
    });
    setBusy(false);
    if (res.error) {
      setProblem(
        res.error.message?.toLowerCase().includes("token")
          ? "This reset link has expired or was already used. Ask for a new one from the sign-in screen."
          : (res.error.message ?? "That didn't work. Try again?"),
      );
      return;
    }
    setDone(true);
  };

  return (
    // the same frame as the app itself, so the page doesn't look like a stray
    <div className="stage">
      <div className="phone-wrap">
        <div className="phone">
          <div className="profile auth-page">
            <header className="topbar">
              <span style={{ width: 42 }} />
              <a
                className="wordmark"
                href="/"
                style={{ textDecoration: "none" }}
              >
                hookedcue<span className="dot">.</span>
              </a>
              <span style={{ width: 42 }} />
            </header>
            <motion.div
              className="profile-body auth-body"
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
            >
              {done ? (
                <>
                  <h2 className="ob-headline auth-title">
                    password <em>changed</em>
                  </h2>
                  <p className="ob-copy auth-copy">
                    Sign in with your new password and pick up where you left
                    off.
                  </p>
                  <a className="ob-primary auth-submit" href="/profile">
                    Sign in
                  </a>
                </>
              ) : badLink ? (
                <>
                  <h2 className="ob-headline auth-title">
                    link <em>expired</em>
                  </h2>
                  <p className="ob-copy auth-copy">
                    This reset link has expired or was already used. Ask for a
                    new one from the sign-in screen.
                  </p>
                  <a className="ob-primary auth-submit" href="/profile">
                    Back to sign in
                  </a>
                </>
              ) : (
                <form className="auth-form" onSubmit={submit} noValidate>
                  <h2 className="ob-headline auth-title">
                    new <em>password</em>
                  </h2>
                  <p className="ob-copy auth-copy">
                    Choose a new password for your hookedcue account.
                  </p>
                  <label className="auth-field">
                    <span className="auth-label">new password</span>
                    <input
                      className="auth-input"
                      type="password"
                      autoComplete="new-password"
                      placeholder="8 or more characters"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      autoFocus
                    />
                  </label>
                  <label className="auth-field">
                    <span className="auth-label">type it again</span>
                    <input
                      className="auth-input"
                      type="password"
                      autoComplete="new-password"
                      placeholder="same as above"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                    />
                  </label>
                  {problem && (
                    <p className="auth-error" role="alert">
                      {problem}
                    </p>
                  )}
                  <button
                    className="ob-primary auth-submit"
                    type="submit"
                    disabled={busy}
                  >
                    {busy ? "Saving…" : "Save new password"}
                  </button>
                </form>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    </div>
  );
}
