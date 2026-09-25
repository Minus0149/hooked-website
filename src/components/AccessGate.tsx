import { useEffect, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import { AuthForm } from "./ProfileScreen";
import {
  ACCESS_GENRES as GENRES,
  MAX_ACCESS_GENRES as MAX_GENRES,
  applyBody,
  emailLooksValid,
  stageAfterApply,
  toggleAccessGenre,
  type AccessStage as Stage,
  type ApplyResult,
} from "../lib/accessApply";

// the apply endpoint is an HTTP route, not a mutation, so the server can see
// the caller's IP and rate limit on it — a websocket mutation can't
const SITE_URL =
  import.meta.env.VITE_CONVEX_SITE_URL ?? "https://shocking-goldfinch-745.convex.site";

/**
 * The wall after the free swipes run out.
 *
 * Deliberately an application, not a signup — accounts only exist once an admin
 * has approved the email, so offering a password field first would just produce
 * accounts that can't do anything.
 *
 * Two steps. The first is only the email (name optional): sending it is the
 * whole application. It used to be eleven fields in four boxes, and every
 * field on a form like this loses people. The second step — phone and what
 * you play — is optional and skippable; it is sent as a second application for
 * the same email, which the server uses only to fill details left blank.
 */
export function AccessGate({ freeSwipes }: { freeSwipes: number }) {
  const [stage, setStage] = useState<Stage>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [device, setDevice] = useState("");
  const [notes, setNotes] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<string>("pending");
  const [trap, setTrap] = useState("");
  // stamped on mount, not during render — Date.now() in a render body is impure
  const startedAt = useRef(0);
  useEffect(() => {
    startedAt.current = Date.now();
  }, []);

  const toggleGenre = (g: string) => setGenres((list) => toggleAccessGenre(list, g));

  const apply = async (
    extra: { device?: string; notes?: string; genres?: string[] },
  ): Promise<ApplyResult | null> => {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${SITE_URL}/access/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          applyBody({ name, email, trap, startedAt: startedAt.current }, extra),
        ),
      });
      const data = (await res.json().catch(() => ({}))) as ApplyResult;
      if (!res.ok || !data.ok) {
        setError(data.message ?? "that didn't go through. try again?");
        return null;
      }
      return data;
    } catch (err) {
      setError(err instanceof Error ? err.message : "that didn't go through. try again?");
      return null;
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    if (!emailLooksValid(email)) {
      setError("that email doesn't look right");
      return;
    }
    const data = await apply({});
    if (!data) return;
    if (data.duplicate) setExisting(data.status ?? "pending");
    setStage(stageAfterApply(data));
  };

  const sendDetails = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    const hasAny = device.trim() || notes.trim() || genres.length > 0;
    if (!hasAny) {
      setStage("sent");
      return;
    }
    const data = await apply({ device, notes, genres });
    if (data) setStage("sent");
  };

  if (stage === "signin") {
    return (
      <div className="access-done">
        <p className="gate-kicker">you're approved</p>
        <p className="gate-copy">sign in and the deck never stops.</p>
        <AuthForm />
      </div>
    );
  }

  if (stage === "sent" || stage === "already") {
    const rejected = stage === "already" && existing === "rejected";
    return (
      <motion.div
        className="access-done"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
      >
        <i className="access-dot" />
        <p className="gate-kicker">{rejected ? "not this round" : "you're on the list"}</p>
        <p className="gate-copy">
          {rejected
            ? "this email isn't on the list for the current round. nothing else to do for now."
            : "we'll email you when you're in. then create an account with this address and pick up right where you left off."}
        </p>
        <button className="gate-close" onClick={() => setStage("signin")}>
          already approved? sign in
        </button>
      </motion.div>
    );
  }

  if (stage === "details") {
    return (
      <motion.form
        className="access-form"
        onSubmit={sendDetails}
        noValidate
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <i className="access-dot" />
        <p className="gate-kicker">you're on the list</p>
        <p className="gate-copy">
          that's all we need. two optional things help us tune your first deck:
        </p>

        <label className="access-field">
          <span className="access-label">your phone</span>
          <input
            className="auth-input"
            placeholder="pixel 8a, redmi note 13, …"
            value={device}
            onChange={(e) => setDevice(e.target.value)}
            maxLength={80}
          />
        </label>

        <div className="access-field">
          <span className="access-label">
            what you actually play <small>up to {MAX_GENRES}</small>
          </span>
          <div className="access-pills">
            {GENRES.map((g) => {
              const on = genres.includes(g);
              return (
                <button
                  type="button"
                  key={g}
                  className={on ? "access-pill on" : "access-pill"}
                  aria-pressed={on}
                  disabled={!on && genres.length >= MAX_GENRES}
                  onClick={() => toggleGenre(g)}
                >
                  {g}
                </button>
              );
            })}
          </div>
        </div>

        <label className="access-field">
          <span className="access-label">anything else</span>
          <textarea
            className="auth-input access-notes"
            placeholder="bugs you expect, features you want, complaints"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={2}
            maxLength={500}
          />
        </label>

        {error && <p className="access-error">{error}</p>}

        <div className="gate-actions">
          <button className="ob-primary" type="submit" disabled={busy}>
            {busy ? "sending…" : "send"}
          </button>
          <button type="button" className="gate-close" onClick={() => setStage("sent")}>
            skip — I'm done
          </button>
        </div>
      </motion.form>
    );
  }

  return (
    <form className="access-form" onSubmit={submit} noValidate>
      <p className="gate-kicker">that was your {freeSwipes} free tastes</p>
      <p className="gate-copy">
        hooked. is invite-only while it's in testing. leave your email and we'll let you in.
      </p>

      <label className="access-field">
        <span className="access-label">email</span>
        <input
          className="auth-input"
          type="email"
          inputMode="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoComplete="email"
          maxLength={200}
          required
          autoFocus
        />
      </label>
      <AnimatePresence initial={false}>
        {email.includes("@") && (
          <motion.label
            className="access-field"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <span className="access-label">
              your name <small>optional</small>
            </span>
            <input
              className="auth-input"
              placeholder="what should we call you?"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="name"
              maxLength={60}
            />
          </motion.label>
        )}
      </AnimatePresence>

      {/* honeypot — never shown, never announced, only bots fill it */}
      <div className="access-hp" aria-hidden="true">
        <label htmlFor="access-website">website</label>
        <input
          id="access-website"
          name="website"
          type="text"
          tabIndex={-1}
          autoComplete="off"
          value={trap}
          onChange={(e) => setTrap(e.target.value)}
        />
      </div>

      {error && <p className="access-error">{error}</p>}

      <div className="gate-actions">
        <button className="ob-primary" type="submit" disabled={busy || !email.trim()}>
          {busy ? "sending…" : "put me on the list"}
        </button>
        <button type="button" className="gate-close" onClick={() => setStage("signin")}>
          already approved? sign in
        </button>
      </div>
    </form>
  );
}

/**
 * Shown when someone signs in whose email hasn't been approved. The server
 * refuses to create their profile, so there is nothing for them to use — this
 * explains why and gets them back out.
 */
export function AccessPending({
  reason,
  email,
}: {
  reason: "pending" | "rejected" | "none" | "unverified";
  email: string;
}) {
  const [busy, setBusy] = useState(false);
  const [resent, setResent] = useState<"idle" | "sending" | "sent" | "failed">("idle");
  const resend = async () => {
    setResent("sending");
    const res = await authClient
      .sendVerificationEmail({ email, callbackURL: `${window.location.origin}/#/` })
      .catch(() => ({ error: true }));
    setResent(res && "error" in res && res.error ? "failed" : "sent");
  };
  const signOut = async () => {
    setBusy(true);
    await authClient.signOut();
    window.location.reload();
  };
  return (
    <div className="gate-overlay">
      <motion.div
        className="gate-card"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        role="status"
      >
        <i className="access-dot" />
        <p className="gate-kicker">
          {reason === "rejected"
            ? "not this round"
            : reason === "none"
              ? "no request on file"
              : reason === "unverified"
                ? "check your inbox"
                : "thank you for your interest"}
        </p>
        <p className="gate-copy">
          {reason === "rejected"
            ? "this account isn't on the list for the current round."
            : reason === "none"
              ? "this email hasn't asked for access yet. sign out, swipe a few, and the form will come to you."
              : reason === "unverified"
                ? `you're approved. we sent a confirmation link to ${email} — open it, then come back here.`
                : "we'll get back to you. your account works the moment you're approved — nothing else to do."}
        </p>
        {reason === "unverified" && (
          <div className="gate-actions">
            <button className="ob-primary" onClick={() => window.location.reload()}>
              I've confirmed it
            </button>
            <button
              className="linklike"
              onClick={() => void resend()}
              disabled={resent === "sending" || resent === "sent"}
            >
              {resent === "sending"
                ? "sending…"
                : resent === "sent"
                  ? "sent — give it a minute (and check spam)"
                  : resent === "failed"
                    ? "couldn't send — try again"
                    : "resend the link"}
            </button>
          </div>
        )}
        <button className="gate-close" onClick={signOut} disabled={busy}>
          {busy ? "signing out..." : "sign out"}
        </button>
      </motion.div>
    </div>
  );
}
