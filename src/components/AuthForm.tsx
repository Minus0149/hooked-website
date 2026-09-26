import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import {
  AUTH_COPY,
  authProblem,
  friendlyAuthError,
  isNotApproved,
  type AuthMode,
} from "../lib/authForms";

/**
 * Sign in, or — with an invite — create the account.
 *
 * hookedcue is a beta you apply for, so this leads with signing in. Creating
 * an account is for invited emails only (the server refuses anyone else and
 * the form turns that refusal into an Apply button), reached from the invite
 * link (/join) or the small "Got an invite?" link.
 */
export function AuthForm({
  initialMode = "signin",
  initialEmail = "",
  onApply,
}: {
  initialMode?: AuthMode;
  initialEmail?: string;
  /** open the beta application; without it the Apply link goes to the profile screen */
  onApply?: () => void;
}) {
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [email, setEmail] = useState(initialEmail);
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notApproved, setNotApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetSent, setResetSent] = useState(false);
  const [resetting, setResetting] = useState(false);
  const copy = AUTH_COPY[mode];

  const switchMode = (next: AuthMode) => {
    setMode(next);
    setError(null);
    setNotApproved(false);
    setPassword("");
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const problem = authProblem(mode, email, password);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setNotApproved(false);
    setBusy(true);
    // a request that throws (offline, a timeout) instead of returning an error
    // used to leave the button on "Signing in…" for good
    let result: { error?: { message?: string } | null } | undefined;
    try {
      result =
        mode === "join"
          ? await authClient.signUp.email({
              email: email.trim(),
              password,
              name: email.trim().split("@")[0],
              // the confirmation link lands back in the app
              callbackURL: `${window.location.origin}/`,
            })
          : await authClient.signIn.email({ email: email.trim(), password });
    } catch (err) {
      result = { error: { message: err instanceof Error ? err.message : "" } };
    }
    setBusy(false);
    if (result?.error) {
      const message = result.error.message ?? "";
      const refused = isNotApproved(message);
      setNotApproved(refused);
      setError(refused ? message : friendlyAuthError(message));
      return;
    }
    // an invite link opened /join — once in, the address should read /profile
    if (window.location.pathname === "/join")
      window.history.replaceState(null, "", "/profile");
  };

  const sendReset = async () => {
    if (resetting) return;
    if (authProblem("signin", email, "x")) {
      setError("Type your email above, then tap “Forgot password?” again.");
      return;
    }
    setResetting(true);
    setError(null);
    try {
      // Better Auth appends ?token=… to this; /reset-password reads it
      const res = await authClient.requestPasswordReset({
        email: email.trim(),
        redirectTo: `${window.location.origin}/reset-password`,
      });
      if (res.error) throw new Error(res.error.message ?? "Couldn't send it");
      setResetSent(true);
    } catch (err) {
      setError(friendlyAuthError(err instanceof Error ? err.message : null));
    } finally {
      setResetting(false);
    }
  };

  const apply = () => {
    if (onApply) onApply();
    else window.location.assign("/profile?apply=1");
  };

  return (
    <motion.form
      className="auth-form"
      onSubmit={submit}
      noValidate
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="ob-headline auth-title">
        {copy.title.lead} <em>{copy.title.accent}</em>
      </h2>
      <p className="ob-copy auth-copy">{copy.copy}</p>

      <label className="auth-field">
        <span className="auth-label">{AUTH_COPY.emailLabel}</span>
        <input
          className="auth-input"
          type="email"
          inputMode="email"
          placeholder={AUTH_COPY.emailPlaceholder}
          value={email}
          autoComplete="email"
          onChange={(e) => setEmail(e.target.value)}
        />
      </label>

      <div className="auth-field">
        <span className="auth-label-row">
          <label className="auth-label" htmlFor="auth-password">
            {AUTH_COPY.passwordLabel}
          </label>
          {mode === "signin" && (
            <button
              type="button"
              className="auth-link"
              onClick={() => void sendReset()}
            >
              {resetting ? "Sending…" : AUTH_COPY.forgot}
            </button>
          )}
        </span>
        <span className="auth-pass">
          <input
            id="auth-password"
            className="auth-input"
            type={showPassword ? "text" : "password"}
            placeholder={
              mode === "signin"
                ? AUTH_COPY.signinPasswordPlaceholder
                : AUTH_COPY.joinPasswordPlaceholder
            }
            value={password}
            autoComplete={mode === "join" ? "new-password" : "current-password"}
            onChange={(e) => setPassword(e.target.value)}
          />
          <button
            type="button"
            className="auth-pass-toggle"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
          >
            {showPassword ? AUTH_COPY.hidePassword : AUTH_COPY.showPassword}
          </button>
        </span>
      </div>

      {resetSent && !error && (
        <p className="auth-note" role="status">
          {AUTH_COPY.resetSent}
        </p>
      )}
      {error && (
        <div className="auth-error" role="alert">
          <p>{error}</p>
          {notApproved && (
            <button type="button" className="auth-error-action" onClick={apply}>
              Apply for the beta
            </button>
          )}
        </div>
      )}

      <button className="ob-primary auth-submit" type="submit" disabled={busy}>
        {busy ? copy.busy : copy.submit}
      </button>

      <div className="auth-alt">
        {mode === "signin" ? (
          <>
            <button type="button" className="auth-secondary" onClick={apply}>
              {AUTH_COPY.apply}
            </button>
            <button
              type="button"
              className="auth-link auth-link-center"
              onClick={() => switchMode("join")}
            >
              {AUTH_COPY.haveInvite}
            </button>
          </>
        ) : (
          <button
            type="button"
            className="auth-link auth-link-center"
            onClick={() => switchMode("signin")}
          >
            {AUTH_COPY.haveAccount}
          </button>
        )}
      </div>
    </motion.form>
  );
}
