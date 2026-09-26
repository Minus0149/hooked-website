/**
 * The words and rules of the sign-in, invite and reset forms, shared by both
 * apps so they read identically.
 *
 * Mirrored in mobile/src/lib/authForms.ts (scripts/check-mirrors.mjs).
 *
 * hookedcue is a beta you apply for: nobody makes an account on a whim. The
 * sign-in screen leads with signing in; the create-account form exists for
 * people holding an invite, and the server refuses anyone else.
 */

export type AuthMode = "signin" | "join";

export const AUTH_COPY = {
  signin: {
    title: { lead: "welcome", accent: "back" },
    copy: "Sign in to pick up your library where you left it.",
    submit: "Sign in",
    busy: "Signing in…",
  },
  join: {
    title: { lead: "you're", accent: "in" },
    copy: "Create your account with the email your invite was sent to.",
    submit: "Create account",
    busy: "Creating…",
  },
  emailLabel: "email",
  passwordLabel: "password",
  emailPlaceholder: "you@example.com",
  signinPasswordPlaceholder: "your password",
  joinPasswordPlaceholder: "8 or more characters",
  forgot: "Forgot password?",
  resetSent: "Reset link sent — check your inbox (and spam).",
  apply: "Not in the beta yet? Apply",
  haveInvite: "Got an invite? Create your account",
  haveAccount: "Already have an account? Sign in",
  showPassword: "show",
  hidePassword: "hide",
} as const;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** What's wrong with the form as typed, or null when it can be sent. */
export function authProblem(
  mode: AuthMode,
  email: string,
  password: string,
): string | null {
  if (!EMAIL_RE.test(email.trim())) return "That email doesn't look right.";
  if (!password)
    return mode === "signin" ? "Enter your password." : "Choose a password.";
  if (mode === "join" && password.length < 8)
    return "Use at least 8 characters.";
  return null;
}

export function resetPasswordProblem(
  password: string,
  confirm: string,
): string | null {
  if (password.length < 8) return "Use at least 8 characters.";
  if (password !== confirm) return "The two passwords don't match.";
  return null;
}

/** The server's "this email isn't approved" answer, which the form turns into an Apply button. */
export function isNotApproved(message: string | null | undefined): boolean {
  return !!message && /approved yet|apply for the beta/i.test(message);
}

/** Better Auth's messages, in the app's voice. */
export function friendlyAuthError(message: string | null | undefined): string {
  const m = (message ?? "").toLowerCase();
  if (!m) return "Something went wrong. Try again?";
  if (m.includes("invalid email or password"))
    return "That email and password don't match.";
  if (m.includes("already exists"))
    return "There's already an account for this email. Sign in instead.";
  if (m.includes("too many"))
    return "Too many tries. Wait a minute and try again.";
  return message ?? "Something went wrong. Try again?";
}
