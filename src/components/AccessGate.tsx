import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { useMutation } from "convex/react";
import { authClient } from "../lib/auth-client";
import { api } from "../../convex/_generated/api";
import { AuthForm } from "./ProfileScreen";

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
  const apply = useMutation(api.access.apply);
  const [stage, setStage] = useState<Stage>("form");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [device, setDevice] = useState("");
  const [notes, setNotes] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [existing, setExisting] = useState<string>("pending");

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
      const res = await apply({
        name: name.trim(),
        email: email.trim(),
        device: device.trim() || undefined,
        notes: notes.trim() || undefined,
        genres: genres.length ? genres : undefined,
      });
      if (res.duplicate) {
        setExisting(res.status);
        setStage(res.status === "approved" ? "signin" : "already");
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
        placeholder="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        autoComplete="email"
        maxLength={200}
        required
      />
      <input
        className="auth-input"
        placeholder="phone you'd use it on (optional)"
        value={device}
        onChange={(e) => setDevice(e.target.value)}
        maxLength={80}
      />

      <p className="access-label">what do you actually play? (optional)</p>
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

      <textarea
        className="auth-input access-notes"
        placeholder="anything you want to tell me (optional)"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        rows={2}
        maxLength={500}
      />

      {error && <p className="access-error">{error}</p>}

      <button className="auth-submit" type="submit" disabled={busy}>
        {busy ? "sending..." : "ask for access"}
      </button>
      <button type="button" className="gate-close" onClick={() => setStage("signin")}>
        already approved? sign in
      </button>
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
