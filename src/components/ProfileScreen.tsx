import { useState } from "react";
import { motion } from "motion/react";
import { authClient } from "../lib/auth-client";
import { useStore } from "../state/store";
import { IconBack, IconCheck, IconHeart } from "./icons";
import { AccessGate } from "./AccessGate";
import { AuthForm } from "./AuthForm";

export function ProfileScreen({
  isAdmin,
  onBack,
  joinEmail,
}: {
  isAdmin: boolean;
  onBack: () => void;
  /** set when the page was opened from an invite link (/join?email=…) */
  joinEmail?: string;
}) {
  const session = authClient.useSession();
  // "Not in the beta yet? Apply" swaps the sign-in form for the application
  const [applying, setApplying] = useState(
    () => new URLSearchParams(window.location.search).get("apply") === "1",
  );
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
          hookedcue<span className="dot">.</span>
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
            <a className="ob-primary profile-admin-link" href="/admin">
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
      ) : applying ? (
        <div className="profile-body auth-body">
          <AccessGate
            freeSwipes={0}
            intro={{
              kicker: "join the beta",
              copy: "hookedcue is invite-only while it's in testing. Leave your email and we'll send you an invite when you're in.",
            }}
            onSignIn={() => setApplying(false)}
          />
        </div>
      ) : (
        <div className="profile-body auth-body">
          <AuthForm
            initialMode={joinEmail !== undefined ? "join" : "signin"}
            initialEmail={joinEmail ?? ""}
            onApply={() => setApplying(true)}
          />
        </div>
      )}
    </div>
  );
}
