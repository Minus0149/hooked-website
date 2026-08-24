import { useEffect, useRef, useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import { AuthForm } from "./ProfileScreen";

// the apply endpoint is an HTTP route, not a mutation, so the server can see
// the caller's IP and rate limit on it — a websocket mutation can't
const SITE_URL = import.meta.env.VITE_CONVEX_SITE_URL ?? "https://cnx.hookedcue.com";

const GENRES = [
  "afrobeats", "psych pop", "bollywood", "house", "soul",
  "reggaeton", "indie folk", "k-pop", "hip hop", "classic rock",
  "punjabi", "electronic",
] as const;
const MAX_GENRES = 8;

type Stage = "form" | "sent" | "already" | "signin";

/**
 * The wall after the free swipes run out.
 *
 * Deliberately an application, not a signup — accounts only exist once an admin
 * has approved the email, so offering a password field first would just produce
 * accounts that can't do anything.
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

  const toggleGenre = (g: string) =>
    setGenres((list) =>
      list.includes(g)
        ? list.filter((x) => x !== g)
        : list.length < MAX_GENRES
          ? [...list, g]
          : list,
    );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`${SITE_URL}/access/apply`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          device: device.trim() || undefined,
          notes: notes.trim() || undefined,
          genres: genres.length ? genres : undefined,
          website: trap,
          startedAt: startedAt.current,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        duplicate?: boolean;
        status?: string;
        message?: string;
      };
      if (!res.ok || !data.ok) {
        setError(data.message ?? "that didn't go through. try again?");
        return;
      }
      if (data.duplicate) {
        setExisting(data.status ?? "pending");
        setStage(data.status === "approved" ? "signin" : "already");
      } else {
        setStage("sent");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "that didn't go through. try again?");
    } finally {
      setBusy(false);
    }
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
        <p className="gate-kicker">
          {rejected ? "not this round" : stage === "already" ? "you're already in the queue" : "thank you for your interest"}
        </p>
        <p className="gate-copy">
          {rejected
            ? "this email isn't on the list for the current round. nothing else to do for now."
            : "we'll get back to you. once you're approved you can create an account with this email and pick up right where you left off."}
        </p>
        <button className="gate-close" onClick={() => setStage("signin")}>
          already approved? sign in
        </button>
      </motion.div>
    );
  }

  return (
    <form className="access-form" onSubmit={submit} noValidate>
      <p className="gate-kicker">that was your {freeSwipes} free tastes</p>
      <p className="gate-copy">
        hooked. is invite-only while it's in testing. tell me who you are and i'll get back to you.
      </p>

      {/* 01 — identity: the two fields that actually matter */}
      <div className="prefs-block">
        <span className="prefs-label">01 · who are you</span>
        <input
          className="auth-input"
          placeholder="your name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          autoComplete="name"
          maxLength={60}
          required
        />
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
        />
        <span className="prefs-hint">
          the invite and every update goes to this one address
        </span>
      </div>

      {/* 02 — the phone, since the test build is android-only */}
      <div className="prefs-block">
        <span className="prefs-label">02 · your phone</span>
        <input
          className="auth-input"
          placeholder="pixel 8a, redmi note 13, ..."
          value={device}
          onChange={(e) => setDevice(e.target.value)}
          maxLength={80}
        />
        <span className="prefs-hint">optional — the test build only runs on android</span>
      </div>

      {/* 03 — taste: optional, but it tunes the first deck you're dealt */}
      <div className="prefs-block">
        <span className="prefs-label">03 · what do you actually play?</span>
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
        <span className="prefs-hint">optional — up to {MAX_GENRES}; tunes your first deck</span>
      </div>

      {/* 04 — the open floor */}
      <div className="prefs-block">
        <span className="prefs-label">04 · anything else</span>
        <textarea
          className="auth-input access-notes"
          placeholder="bugs you expect, features you want, complaints"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          maxLength={500}
        />
      </div>

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

      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? "sending..." : "ask for access"}
      </button>
      <div className="gate-secondary">
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
export function AccessPending({ reason }: { reason: "pending" | "rejected" | "none" }) {
  const [busy, setBusy] = useState(false);
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
              : "thank you for your interest"}
        </p>
        <p className="gate-copy">
          {reason === "rejected"
            ? "this account isn't on the list for the current round."
            : reason === "none"
              ? "this email hasn't asked for access yet. sign out, swipe a few, and the form will come to you."
              : "we'll get back to you. your account works the moment you're approved — nothing else to do."}
        </p>
        <button className="gate-close" onClick={signOut} disabled={busy}>
          {busy ? "signing out..." : "sign out"}
        </button>
      </motion.div>
    </div>
  );
}
