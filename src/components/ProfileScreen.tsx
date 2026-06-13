import { useState, type FormEvent } from "react";
import { motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import { useStore } from "../state/store";
import { IconBack, IconCheck, IconHeart } from "./icons";

export function ProfileScreen({
  isAdmin,
  onBack,
}: {
  isAdmin: boolean;
  onBack: () => void;
}) {
  const session = authClient.useSession();
  const { state } = useStore();

  const allSaved = [
    ...state.liked,
    ...state.discoveries,
    ...state.playlists.flatMap((p) => p.tracks),
  ];
  const genreCounts = new Map<string, number>();
  for (const t of allSaved) {
    genreCounts.set(t.genre, (genreCounts.get(t.genre) ?? 0) + 1);
  }
  const topGenres = [...genreCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 4);

  return (
    <div className="profile">
      <header className="topbar">
        <button className="topbar-btn" onClick={onBack} aria-label="Back to home">
          <IconBack />
        </button>
        <span className="wordmark">
          hooked<span className="dot">.</span>
        </span>
        <span style={{ width: 42 }} />
      </header>

      {session.isPending ? null : session.data ? (
        <motion.div
          className="profile-body"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <div className="profile-avatar">
            {(session.data.user.email ?? "?").slice(0, 1).toUpperCase()}
          </div>
          <h2 className="profile-email">{session.data.user.email}</h2>
          <p className="profile-sub">
            <IconCheck size={13} /> Your swipes and library sync to the cloud
          </p>

          <div className="tiles" style={{ width: "100%" }}>
            <div className="tile">
              <div className="tile-name">
                <IconHeart size={13} /> Liked
              </div>
              <div className="tile-sub">{state.liked.length} songs</div>
            </div>
            <div className="tile">
              <div className="tile-name">Discoveries</div>
              <div className="tile-sub">{state.discoveries.length} songs</div>
            </div>
            <div className="tile">
              <div className="tile-name">Playlists</div>
              <div className="tile-sub">{state.playlists.length} created</div>
            </div>
            <div className="tile">
              <div className="tile-name">Blocked artists</div>
              <div className="tile-sub">{state.neverArtists.length} never again</div>
            </div>
          </div>

          {topGenres.length > 0 && (
            <div style={{ width: "100%" }}>
              <p className="settings-group" style={{ marginTop: 4 }}>your taste</p>
              <div className="taste-chips">
                {topGenres.map(([genre, count], i) => (
                  <span
                    key={genre}
                    className="taste-chip"
                    style={i === 0 ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
                  >
                    {genre} · {count}
                  </span>
                ))}
              </div>
            </div>
          )}

          {isAdmin && (
            <a className="ob-primary profile-admin-link" href="#/admin">
              Open admin dashboard
            </a>
          )}
          <button
            className="profile-signout"
            onClick={() => void authClient.signOut()}
          >
            Sign out
          </button>
        </motion.div>
      ) : (
        <AuthForm />
      )}
    </div>
  );
}

export function AuthForm() {
  const [mode, setMode] = useState<"signin" | "signup">("signup");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const result =
      mode === "signup"
        ? await authClient.signUp.email({
            email,
            password,
            name: email.split("@")[0],
          })
        : await authClient.signIn.email({ email, password });
    setBusy(false);
    if (result.error) {
      setError(result.error.message ?? "Something went wrong");
    }
  };

  return (
    <motion.form
      className="profile-body"
      onSubmit={submit}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <h2 className="ob-headline" style={{ fontSize: 24 }}>
        {mode === "signup" ? (
          <>
            keep your taste <em>forever</em>
          </>
        ) : (
          <>
            welcome <em>back</em>
          </>
        )}
      </h2>
      <p className="ob-copy">
        {mode === "signup"
          ? "Create an account and every swipe, like and playlist follows you across devices."
          : "Sign in to pick up your library where you left it."}
      </p>

      <input
        className="auth-input"
        type="email"
        required
        placeholder="email"
        value={email}
        autoComplete="email"
        onChange={(e) => setEmail(e.target.value)}
      />
      <input
        className="auth-input"
        type="password"
        required
        minLength={8}
        placeholder="password (8+ characters)"
        value={password}
        autoComplete={mode === "signup" ? "new-password" : "current-password"}
        onChange={(e) => setPassword(e.target.value)}
      />

      {error && <p className="auth-error">{error}</p>}

      <button className="ob-primary" type="submit" disabled={busy}>
        {busy ? "…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
      <button
        type="button"
        className="ob-skip"
        onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
      >
        {mode === "signup"
          ? "Already have an account? Sign in"
          : "New here? Create an account"}
      </button>
    </motion.form>
  );
}
