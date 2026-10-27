import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "motion/react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Track } from "../types";
import { art } from "../lib/art";
import { useT } from "../lib/lang";
import { useDialogs } from "./ui/Dialogs";
import { usePlayer } from "../audio/usePlayer";
import { IconBack, IconHeart, IconPlay, IconSearch, IconShare, IconUser, IconX } from "./icons";
import { normalizeCode, ROOM_PRESENCE_MS } from "../../convex/socialRules";
import { serverMessage } from "../lib/serverError";

/**
 * The social side of the app: people, follows, the feed of songs friends
 * shared, someone's public page, the mutual playlist, shared playlists and
 * listening rooms. Server rules live in convex/socialRules.ts; nothing here
 * decides who may see what, it only shows what the server returned.
 */

/** A song as the server stores it (posts, library rows), before it becomes a playable Track. */
export type ServerSong = {
  trackId: string;
  title: string;
  artist: string;
  album: string;
  artwork: string;
  previewUrl: string;
  durationMs: number;
  genre: string;
  accent: string;
};

export type PlaySongs = (title: string, songs: ServerSong[], startId?: string) => void;

const rise = {
  hidden: { opacity: 0, y: 12 },
  show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 260, damping: 26 } },
};
const stagger = { hidden: {}, show: { transition: { staggerChildren: 0.04 } } };

function Header({ title, onBack, right }: { title: string; onBack: () => void; right?: React.ReactNode }) {
  return (
    <header className="topbar">
      <button className="topbar-btn" onClick={onBack} aria-label="Back">
        <IconBack />
      </button>
      <span className="wordmark social-title">{title}</span>
      {right ?? <span style={{ width: 42 }} />}
    </header>
  );
}

const initial = (name: string) => (name.replace(/^@/, "").trim()[0] ?? "?").toUpperCase();

function Avatar({ name, size = 40 }: { name: string; size?: number }) {
  return (
    <span className="social-avatar" style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden="true">
      {initial(name)}
    </span>
  );
}

function FollowButton({ username, following }: { username: string; following: boolean }) {
  const tx = useT();
  const follow = useMutation(api.social.follow);
  const unfollow = useMutation(api.social.unfollow);
  const { notify } = useDialogs();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`social-follow ${following ? "on" : ""}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          await (following ? unfollow({ username }) : follow({ username }));
        } catch (e) {
          notify(`${tx("Couldn't do that")}: ${serverMessage(e)}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {following ? tx("Following") : tx("Follow")}
    </button>
  );
}

function SongRow({
  song,
  sub,
  onPlay,
  action,
}: {
  song: ServerSong;
  sub?: React.ReactNode;
  onPlay: () => void;
  action?: React.ReactNode;
}) {
  return (
    <motion.div className="library-row" variants={rise}>
      <button className="library-row-main" onClick={onPlay}>
        <span className="library-art-wrap">
          <img src={art(song.artwork, 100)} alt="" />
          <span className="library-art-play">
            <IconPlay size={13} />
          </span>
        </span>
        <span className="list-meta library-row-meta">
          <span className="list-title">{song.title}</span>
          <span className="list-artist">{song.artist}</span>
          {sub && <span className="social-row-sub">{sub}</span>}
        </span>
      </button>
      {action}
    </motion.div>
  );
}

function ago(at: number) {
  const m = Math.round((Date.now() - at) / 60_000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}

// ---------------------------------------------------------------------------
// Home: the friends card
// ---------------------------------------------------------------------------

/** On Home: the newest songs friends shared, and the way into people and rooms. */
export function FriendsCard({ onOpenPeople, onPlaySongs }: { onOpenPeople: () => void; onPlaySongs: PlaySongs }) {
  const tx = useT();
  const feed = useQuery(api.social.feed);
  if (feed === undefined) return null;
  const latest = feed.filter((p) => !p.mine).slice(0, 3);
  return (
    <div className="social-card">
      <div className="social-card-head">
        <span className="social-kicker">{tx("Friends")}</span>
        <button type="button" className="social-link" onClick={onOpenPeople}>
          {tx("People & play together")} →
        </button>
      </div>
      {latest.length === 0 ? (
        <button type="button" className="social-empty" onClick={onOpenPeople}>
          {tx("Follow friends to see the songs they share. Or start a room and listen together.")}
        </button>
      ) : (
        latest.map((p) => (
          <button
            key={p.id}
            type="button"
            className="social-mini"
            onClick={() => onPlaySongs(tx("Shared with you"), latest.map((x) => x.track), p.track.trackId)}
          >
            <img src={art(p.track.artwork, 80)} alt="" />
            <span className="social-mini-text">
              <b>{p.track.title}</b>
              <span>
                {p.by.username ? `@${p.by.username}` : p.by.name}
                {p.note ? ` · “${p.note}”` : ""}
              </span>
            </span>
            <span className="social-mini-play" aria-hidden="true">▶</span>
          </button>
        ))
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// People: search, the feed, play together
// ---------------------------------------------------------------------------

export function PeopleScreen({
  onBack,
  onOpenUser,
  onStartRoom,
  onJoinRoom,
  onPlaySongs,
}: {
  onBack: () => void;
  onOpenUser: (username: string) => void;
  onStartRoom: () => Promise<void>;
  onJoinRoom: (code: string) => void;
  onPlaySongs: PlaySongs;
}) {
  const tx = useT();
  const { notify } = useDialogs();
  const me = useQuery(api.social.me);
  const [q, setQ] = useState("");
  const results = useQuery(api.social.searchPeople, q.trim().length >= 2 ? { q } : "skip");
  const feed = useQuery(api.social.feed);
  const deletePost = useMutation(api.social.deletePost);
  const [code, setCode] = useState("");
  const [starting, setStarting] = useState(false);

  return (
    <div className="library">
      <Header title={tx("People")} onBack={onBack} />
      <motion.div className="library-body" variants={stagger} initial="hidden" animate="show">
        {me && (
          <motion.div className="social-me" variants={rise}>
            {me.username ? (
              <button type="button" className="social-me-btn" onClick={() => onOpenUser(me.username!)}>
                <Avatar name={me.username} size={34} />
                <span>
                  <b>@{me.username}</b>
                  <small>
                    {tx(me.followers === 1 ? "{n} follower" : "{n} followers", { n: me.followers })} · {tx("{n} following", { n: me.following })}
                  </small>
                </span>
              </button>
            ) : (
              <p className="settings-hint">{tx("Pick a @username on your Profile so friends can find and follow you.")}</p>
            )}
          </motion.div>
        )}

        <motion.p className="settings-group" variants={rise}>{tx("Play together")}</motion.p>
        <motion.div className="social-room-start" variants={rise}>
          <button
            type="button"
            className="library-cta"
            disabled={starting}
            onClick={async () => {
              setStarting(true);
              try {
                await onStartRoom();
              } catch (e) {
                notify(`${tx("Couldn't start a room")}: ${serverMessage(e)}`);
              } finally {
                setStarting(false);
              }
            }}
          >
            <IconPlay size={15} /> {tx("Start a room")}
          </button>
          <form
            className="social-code-form"
            onSubmit={(e) => {
              e.preventDefault();
              const c = normalizeCode(code);
              if (c) onJoinRoom(c);
            }}
          >
            <input
              className="social-input"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder={tx("Room code")}
              aria-label={tx("Room code")}
              maxLength={12}
              autoCapitalize="characters"
            />
            <button type="submit" className="library-cta ghost" disabled={!normalizeCode(code)}>
              {tx("Join")}
            </button>
          </form>
          <p className="settings-hint">{tx("Everyone hears the same song and sees each other's saves, live.")}</p>
        </motion.div>

        <motion.p className="settings-group" variants={rise}>{tx("Find people")}</motion.p>
        <motion.label className="social-search" variants={rise}>
          <IconSearch />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tx("@username")}
            aria-label={tx("Search people by username")}
            autoCapitalize="none"
            autoCorrect="off"
          />
        </motion.label>
        {results && results.length === 0 && q.trim().length >= 2 && (
          <p className="settings-hint">{tx("No one with that username yet.")}</p>
        )}
        {results?.map((p) => (
          <motion.div key={p.username} className="social-person" variants={rise}>
            <button type="button" className="social-person-main" onClick={() => onOpenUser(p.username!)}>
              <Avatar name={p.name} />
              <span>
                <b>{p.name}</b>
                <small>@{p.username}</small>
              </span>
            </button>
            <FollowButton username={p.username!} following={p.iFollow} />
          </motion.div>
        ))}

        <motion.p className="settings-group" variants={rise}>{tx("From people you follow")}</motion.p>
        {feed && feed.length === 0 && (
          <p className="settings-hint">{tx("Nothing shared yet. Share a song from its ⋯ sheet and it shows here for your followers.")}</p>
        )}
        {feed?.map((p) => (
          <SongRow
            key={p.id}
            song={p.track}
            onPlay={() => onPlaySongs(tx("Shared with you"), feed.map((x) => x.track), p.track.trackId)}
            sub={
              <>
                {p.mine ? tx("you") : p.by.username ? (
                  <a
                    href={`/u/${p.by.username}`}
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onOpenUser(p.by.username!);
                    }}
                  >
                    @{p.by.username}
                  </a>
                ) : (
                  p.by.name
                )}
                {" · "}
                {ago(p.at)}
                {p.note ? ` · “${p.note}”` : ""}
              </>
            }
            action={
              p.mine ? (
                <button className="library-row-btn danger" onClick={() => void deletePost({ postId: p.id })} aria-label={tx("Delete post")}>
                  <IconX size={13} />
                </button>
              ) : undefined
            }
          />
        ))}
        <div style={{ height: 10 }} />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Someone's page
// ---------------------------------------------------------------------------

export function UserScreen({
  username,
  onBack,
  onOpenUser,
  onOpenMutual,
  onOpenPlaylist,
  onPlaySongs,
}: {
  username: string;
  onBack: () => void;
  onOpenUser: (username: string) => void;
  onOpenMutual: (username: string) => void;
  onOpenPlaylist: (playlistId: string) => void;
  onPlaySongs: PlaySongs;
}) {
  const tx = useT();
  const p = useQuery(api.social.profile, { username });
  const [list, setList] = useState<"followers" | "following" | null>(null);
  const people = useQuery(api.social.connections, list ? { username, kind: list } : "skip");

  if (p === undefined) return <div className="library"><Header title={`@${username}`} onBack={onBack} /></div>;
  if (p === null)
    return (
      <div className="library">
        <Header title={`@${username}`} onBack={onBack} />
        <div className="library-body"><p className="settings-hint">{tx("Couldn't find @{name}. Check the spelling, and that you're signed in.", { name: username })}</p></div>
      </div>
    );

  return (
    <div className="library">
      <Header title={`@${p.username}`} onBack={onBack} />
      <motion.div className="library-body" variants={stagger} initial="hidden" animate="show">
        <motion.div className="social-hero" variants={rise}>
          <Avatar name={p.name} size={72} />
          <h2 className="library-title">{p.name}</h2>
          <p className="library-sub">
            @{p.username}
            {p.followsMe && !p.isMe && <span className="social-badge">{tx("follows you")}</span>}
          </p>
          <div className="social-counts">
            <button type="button" onClick={() => setList(list === "followers" ? null : "followers")}>
              <b>{p.followers}</b> {tx(p.followers === 1 ? "follower" : "followers")}
            </button>
            <button type="button" onClick={() => setList(list === "following" ? null : "following")}>
              <b>{p.following}</b> {tx("following")}
            </button>
          </div>
          {!p.isMe && p.username && <FollowButton username={p.username} following={p.iFollow} />}
        </motion.div>

        {list && (
          <motion.div variants={rise}>
            <p className="settings-group">{tx(list === "followers" ? "Followers" : "Following")}</p>
            {people?.length === 0 && <p className="settings-hint">{tx("No one yet.")}</p>}
            {people?.map((x) => (
              <div key={x.username} className="social-person">
                <button type="button" className="social-person-main" onClick={() => onOpenUser(x.username!)}>
                  <Avatar name={x.name} />
                  <span>
                    <b>{x.name}</b>
                    <small>@{x.username}</small>
                  </span>
                </button>
                {x.iFollow !== null && <FollowButton username={x.username!} following={x.iFollow} />}
              </div>
            ))}
          </motion.div>
        )}

        {!p.isMe && (
          <motion.button
            type="button"
            className="settings-row"
            variants={rise}
            onClick={() => onOpenMutual(p.username!)}
            disabled={!p.mutual}
          >
            <span className="settings-row-icon" style={{ color: "var(--accent)" }}>⇄</span>
            <span className="settings-row-label">
              {tx("Your mutual playlist")}
              <small>
                {p.mutual
                  ? tx("songs you both saved, then picks from each other")
                  : tx("unlocks when you follow each other")}
              </small>
            </span>
            <span className="settings-row-value">{p.mutual ? tx("open") : "🔒"}</span>
          </motion.button>
        )}

        {p.playlists.length > 0 && (
          <>
            <motion.p className="settings-group" variants={rise}>{tx(p.isMe ? "Your playlists" : "Public playlists")}</motion.p>
            <motion.div className="tiles" variants={rise}>
              {p.playlists.map((pl) => (
                <button key={pl.id} type="button" className="tile" style={{ borderColor: pl.accent }} onClick={() => onOpenPlaylist(pl.id)}>
                  <div className="tile-name">{pl.name}</div>
                  <div className="tile-sub">
                    {tx(pl.count === 1 ? "{n} song" : "{n} songs", { n: pl.count })}
                    {pl.collaborative ? ` · ${tx("collaborative")}` : ""}
                    {p.isMe && pl.visibility === "private" ? ` · ${tx("private")}` : ""}
                  </div>
                </button>
              ))}
            </motion.div>
          </>
        )}

        <motion.p className="settings-group" variants={rise}>{tx("Shared songs")}</motion.p>
        {p.posts.length === 0 && <p className="settings-hint">{tx("Nothing shared yet.")}</p>}
        {p.posts.map((x) => (
          <SongRow
            key={x.id}
            song={x.track}
            sub={`${ago(x.at)}${x.note ? ` · “${x.note}”` : ""}`}
            onPlay={() => onPlaySongs(tx("Shared by {name}", { name: p.name }), p.posts.map((y) => y.track), x.track.trackId)}
          />
        ))}
        <div style={{ height: 10 }} />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// The mutual playlist
// ---------------------------------------------------------------------------

export function MutualScreen({ username, onBack, onPlaySongs }: { username: string; onBack: () => void; onPlaySongs: PlaySongs }) {
  const tx = useT();
  const m = useQuery(api.social.mutual, { username });
  const title = m ? tx("You + {name}", { name: m.name }) : tx("Mutual playlist");
  return (
    <div className="library">
      <Header title={tx("Mutual")} onBack={onBack} />
      <motion.div className="library-body" variants={stagger} initial="hidden" animate="show">
        {m === null && <p className="settings-hint">{tx("No one with that username.")}</p>}
        {m && !m.allowed && (
          <p className="settings-hint">{tx("A mutual playlist unlocks when you and {name} follow each other.", { name: m.name })}</p>
        )}
        {m && m.allowed && (
          <>
            <motion.div className="library-hero" variants={rise}>
              <div className="library-collage">
                {m.songs.slice(0, 4).map((s, i) => (
                  <img key={s.track.trackId} src={art(s.track.artwork, 200)} alt="" style={{ rotate: `${(i % 2 ? 1 : -1) * (2 + i)}deg` }} />
                ))}
                {m.songs.length === 0 && <div className="library-collage-empty">⇄</div>}
              </div>
              <div className="library-hero-meta">
                <span className="library-kicker">{tx("mutual playlist")}</span>
                <h2 className="library-title">{title}</h2>
                <p className="library-sub">
                  {m.both > 0 && <>{tx("{n} you both saved", { n: m.both })} · </>}
                  {tx(m.songs.length === 1 ? "{n} song" : "{n} songs", { n: m.songs.length })}
                </p>
              </div>
            </motion.div>
            <motion.div className="library-actions" variants={rise}>
              <button className="library-cta" disabled={m.songs.length === 0} onClick={() => onPlaySongs(title, m.songs.map((s) => s.track))}>
                <IconPlay size={16} /> {tx("Play")}
              </button>
            </motion.div>
            {m.songs.length === 0 && (
              <p className="settings-hint">{tx("Save a few songs each and they'll meet here.")}</p>
            )}
            {m.songs.map((s) => (
              <SongRow
                key={s.track.trackId}
                song={s.track}
                sub={s.from === "both" ? tx("you both saved this") : s.from === "them" ? tx("from {name}", { name: m.name }) : tx("from you")}
                onPlay={() => onPlaySongs(title, m.songs.map((x) => x.track), s.track.trackId)}
              />
            ))}
          </>
        )}
        <div style={{ height: 10 }} />
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared playlists
// ---------------------------------------------------------------------------

const inviteUrl = (code: string) => `${window.location.origin}/join-playlist/${code}`;

async function copyOrShare(url: string, title: string): Promise<string> {
  try {
    if (navigator.share) {
      await navigator.share({ title, url });
      return "";
    }
  } catch {
    // cancelled: copy instead
  }
  try {
    await navigator.clipboard.writeText(url);
    return "Link copied";
  } catch {
    return url;
  }
}

/** In the owner's playlist screen: who can see it, who can add, and the invite link. */
export function PlaylistSharingPanel({ playlistId, name }: { playlistId: string; name: string }) {
  const tx = useT();
  const pl = useQuery(api.social.playlist, { playlistId });
  const setSharing = useMutation(api.social.setPlaylistSharing);
  const [note, setNote] = useState<string | null>(null);
  if (!pl || !pl.isOwner) return null;
  const toggle = (patch: { visibility?: string; collaborative?: boolean }) =>
    void setSharing({ playlistId: pl.id, ...patch }).catch(() => undefined);
  return (
    <div className="social-share-panel">
      <button className="settings-row" onClick={() => toggle({ visibility: pl.visibility === "public" ? "private" : "public" })} aria-pressed={pl.visibility === "public"}>
        <span className="settings-row-label">
          {tx("Public")}
          <small>{tx("shows on your profile; anyone with the link can listen")}</small>
        </span>
        <span className={`toggle ${pl.visibility === "public" ? "on" : ""}`}><span className="toggle-knob" /></span>
      </button>
      <button className="settings-row" onClick={() => toggle({ collaborative: !pl.collaborative })} aria-pressed={pl.collaborative}>
        <span className="settings-row-label">
          {tx("Collaborative")}
          <small>{tx("friends who join with the invite link can add songs")}</small>
        </span>
        <span className={`toggle ${pl.collaborative ? "on" : ""}`}><span className="toggle-knob" /></span>
      </button>
      {pl.inviteCode && (
        <button
          className="settings-row"
          onClick={async () => setNote(tx(await copyOrShare(inviteUrl(pl.inviteCode!), name)) || null)}
        >
          <span className="settings-row-icon" style={{ color: "var(--accent)" }}><IconShare size={15} /></span>
          <span className="settings-row-label">
            {tx(pl.collaborative ? "Invite friends to add songs" : "Share the playlist")}
            <small>{note ?? `/join-playlist/${pl.inviteCode}`}</small>
          </span>
        </button>
      )}
      {pl.members.length > 0 && (
        <p className="settings-hint">
          {tx("With {list}", { list: pl.members.map((m) => (m.username ? `@${m.username}` : m.name)).join(", ") })}
        </p>
      )}
    </div>
  );
}

/** Someone else's playlist (public, or one you joined): everyone's songs, live. */
export function SharedPlaylistScreen({
  playlistId,
  onBack,
  onOpenUser,
  onPlaySongs,
  onOpenOwn,
  onSaveHere,
}: {
  playlistId: string;
  onBack: () => void;
  onOpenUser: (username: string) => void;
  onPlaySongs: PlaySongs;
  /** the owner is sent to their own library screen, which has the editing tools */
  onOpenOwn: (playlistId: string) => void;
  /** a collaborator's "add songs": make it the swipe-down target and go swipe */
  onSaveHere?: (pl: { id: string; name: string; accent: string; songs: ServerSong[]; ownerName: string }) => void;
}) {
  const tx = useT();
  const { confirm } = useDialogs();
  const pl = useQuery(api.social.playlist, { playlistId });
  const leave = useMutation(api.social.leavePlaylist);
  const remove = useMutation(api.social.removeFromPlaylist);
  const redirected = useRef(false);
  useEffect(() => {
    if (pl?.isOwner && !redirected.current) {
      redirected.current = true;
      onOpenOwn(playlistId);
    }
  }, [pl?.isOwner, playlistId, onOpenOwn]);

  if (pl === undefined) return <div className="library"><Header title={tx("Playlist")} onBack={onBack} /></div>;
  if (pl === null)
    return (
      <div className="library">
        <Header title={tx("Playlist")} onBack={onBack} />
        <div className="library-body"><p className="settings-hint">{tx("This playlist is private, or it's gone.")}</p></div>
      </div>
    );
  const songs = pl.songs.map((s) => s.track);
  return (
    <div className="library" style={{ "--pl-accent": pl.accent } as React.CSSProperties}>
      <div className="library-hero-glow" />
      <Header title={tx("Playlist")} onBack={onBack} />
      <motion.div className="library-body" variants={stagger} initial="hidden" animate="show">
        <motion.div className="library-hero" variants={rise}>
          <div className="library-collage">
            {songs.slice(0, 4).map((t, i) => (
              <img key={t.trackId} src={art(t.artwork, 200)} alt="" style={{ rotate: `${(i % 2 ? 1 : -1) * (2 + i)}deg` }} />
            ))}
            {songs.length === 0 && <div className="library-collage-empty"><IconHeart size={15} /></div>}
          </div>
          <div className="library-hero-meta">
            <span className="library-kicker">
              {tx(pl.collaborative ? "collaborative playlist" : "playlist")} ·{" "}
              {pl.owner.username ? (
                <a href={`/u/${pl.owner.username}`} onClick={(e) => { e.preventDefault(); onOpenUser(pl.owner.username!); }}>
                  @{pl.owner.username}
                </a>
              ) : (
                pl.owner.name
              )}
            </span>
            <h2 className="library-title">{pl.name}</h2>
            <p className="library-sub">{tx(songs.length === 1 ? "{n} song" : "{n} songs", { n: songs.length })}</p>
          </div>
        </motion.div>
        <motion.div className="library-actions" variants={rise}>
          <button className="library-cta" disabled={songs.length === 0} onClick={() => onPlaySongs(pl.name, songs)}>
            <IconPlay size={16} /> {tx("Play")}
          </button>
          <button className="library-cta ghost" disabled={songs.length < 2} onClick={() => onPlaySongs(pl.name, [...songs].sort(() => 0.5 - Math.random()))}>
            {tx("Shuffle")}
          </button>
          {pl.isMember && (
            <button
              className="library-cta ghost"
              onClick={async () => {
                const ok = await confirm({ title: tx("Leave “{title}”?", { title: pl.name }), body: tx("It leaves your library. Songs you added stay for the others."), confirmLabel: tx("Leave") });
                if (!ok) return;
                await leave({ playlistId: pl.id });
                onBack();
              }}
            >
              {tx("Leave")}
            </button>
          )}
        </motion.div>
        {pl.canAdd && !pl.isOwner && (
          <>
            {onSaveHere && (
              <motion.div className="library-actions" variants={rise}>
                <button
                  className="library-cta"
                  onClick={() =>
                    onSaveHere({
                      id: String(pl.id),
                      name: pl.name,
                      accent: pl.accent,
                      songs,
                      ownerName: pl.owner.username ? `@${pl.owner.username}` : pl.owner.name,
                    })
                  }
                >
                  <IconPlay size={16} /> {tx("Add songs by swiping")}
                </button>
              </motion.div>
            )}
            <p className="settings-hint">{tx("Your swipe-down saves then land here, for everyone in it.")}</p>
          </>
        )}
        {pl.songs.map((s) => (
          <SongRow
            key={s.track.trackId}
            song={s.track}
            sub={pl.collaborative ? tx("added by {name}", { name: s.addedBy }) : undefined}
            onPlay={() => onPlaySongs(pl.name, songs, s.track.trackId)}
            action={
              s.canRemove ? (
                <button className="library-row-btn danger" onClick={() => void remove({ playlistId: pl.id, trackId: s.track.trackId })} aria-label={`Remove ${s.track.title}`}>
                  <IconX size={13} />
                </button>
              ) : undefined
            }
          />
        ))}
        <div style={{ height: 10 }} />
      </motion.div>
    </div>
  );
}

/** /join-playlist/<code>: what you're joining, and the button. */
export function JoinPlaylistScreen({ code, onBack, onJoined }: { code: string; onBack: () => void; onJoined: (playlistId: string) => void }) {
  const tx = useT();
  const invite = useQuery(api.social.invite, { code });
  const join = useMutation(api.social.joinPlaylist);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="library">
      <Header title={tx("Invite")} onBack={onBack} />
      <div className="library-body social-center">
        {invite === null && <p className="settings-hint">{tx("That invite link doesn't work any more.")}</p>}
        {invite && (
          <motion.div className="social-invite" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} style={{ borderColor: invite.accent }}>
            <span className="library-kicker">{tx(invite.collaborative ? "collaborative playlist" : "playlist")}</span>
            <h2 className="library-title">{invite.name}</h2>
            <p className="library-sub">
              {invite.owner ? (invite.owner.username ? `@${invite.owner.username}` : invite.owner.name) : ""} ·{" "}
              {tx(invite.count === 1 ? "{n} song" : "{n} songs", { n: invite.count })}
            </p>
            <button
              className="library-cta"
              onClick={async () => {
                try {
                  const r = await join({ code });
                  onJoined(String(r.playlistId));
                } catch (e) {
                  setErr(serverMessage(e));
                }
              }}
            >
              {tx(invite.collaborative ? "Join and add songs" : "Add to my library")}
            </button>
            {err && <p className="settings-hint" role="alert">{err}</p>}
          </motion.div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Listening rooms
// ---------------------------------------------------------------------------

/**
 * A room: the host's songs, one at a time, for everyone in it. The host's
 * player moves the room on when a song ends (or on Next); everyone else
 * follows. Saves go to each person's own library and show up for the others.
 */
export function RoomScreen({
  code,
  onBack,
  resolveTrack,
  afterHook,
}: {
  code: string;
  onBack: () => void;
  resolveTrack: (trackId: string) => Track | null;
  afterHook: import("../../convex/socialRules").AfterHook;
}) {
  const tx = useT();
  const { notify } = useDialogs();
  const room = useQuery(api.social.room, { code });
  const join = useMutation(api.social.joinRoom);
  const heartbeat = useMutation(api.social.roomHeartbeat);
  const advance = useMutation(api.social.advanceRoom);
  const end = useMutation(api.social.endRoom);
  const react = useMutation(api.social.reactInRoom);
  const recordSwipe = useMutation(api.library.recordSwipe);
  const [joinError, setJoinError] = useState<string | null>(null);
  const [linkNote, setLinkNote] = useState<string | null>(null);

  // join once the backend knows who this is (a cold load of /together/<code>
  // ran the join before the auth token landed: "Unauthenticated", never in
  // the room, and every Save refused), then say "still here" every 20 s
  const { isAuthenticated, isLoading: authLoading } = useConvexAuth();
  useEffect(() => {
    if (!isAuthenticated) return;
    let alive = true;
    setJoinError(null);
    join({ code }).catch((e) => alive && setJoinError(serverMessage(e)));
    const t = window.setInterval(() => void heartbeat({ code }).catch(() => undefined), 20_000);
    return () => {
      alive = false;
      window.clearInterval(t);
    };
  }, [code, join, heartbeat, isAuthenticated]);

  const local = useMemo(() => (room?.open && room.currentTrackId ? resolveTrack(room.currentTrackId) : null), [room?.open, room?.currentTrackId, resolveTrack]);
  // a song this listener's app doesn't have: fetch it the way a shared link does
  const remote = useQuery(api.share.track, room?.open && room.currentTrackId && !local ? { trackId: room.currentTrackId } : "skip");
  const track = useMemo<Track | null>(() => {
    if (local) return local;
    if (!remote) return null;
    return {
      id: remote.trackId, title: remote.title, artist: remote.artist, album: remote.album, artwork: remote.artwork,
      previewUrl: remote.previewUrl, audioUrl: remote.audioUrl ?? undefined, durationMs: remote.durationMs, genre: remote.genre,
      accent: remote.accent, hooks: remote.hooks.map((h, i) => ({ id: `room-${i}`, startMs: h.startMs, durationMs: h.durationMs, label: h.label ?? undefined })),
    };
  }, [local, remote]);
  const nextTrack = useMemo(
    () => (room?.open && room.trackIds[room.index + 1] ? resolveTrack(room.trackIds[room.index + 1]) : null),
    [room?.open, room?.trackIds, room?.index, resolveTrack],
  );
  const roomRef = useRef(room);
  roomRef.current = room;
  const moveOn = () => {
    const r = roomRef.current;
    if (r?.isHost && r.open) void advance({ code, expected: r.index }).catch(() => undefined);
  };
  // the host's player moves the room on; a guest's just waits for the next song
  // the host always moves on when a song ends (a looping host would freeze the room)
  const { playing, toggle, progress } = usePlayer(track, nextTrack, Boolean(track), moveOn, undefined, room?.isHost ? "next" : afterHook);

  const myReaction = room?.reactions.find((r) => r.me)?.action ?? null;
  const save = async () => {
    if (!track || !room) return;
    try {
      await react({ code, trackId: track.id, action: "save" });
      await recordSwipe({
        track: {
          trackId: track.id, title: track.title, artist: track.artist, album: track.album ?? "", artwork: track.artwork,
          previewUrl: track.previewUrl, durationMs: track.durationMs ?? 30_000, genre: track.genre ?? "", accent: track.accent ?? "#FF3D71",
        },
        action: "save",
      });
    } catch (e) {
      notify(`${tx("Couldn't save")}: ${serverMessage(e)}`);
    }
  };
  const skip = async () => {
    if (!track || !room) return;
    await react({ code, trackId: track.id, action: "skip" }).catch(() => undefined);
    if (room.isHost) moveOn();
  };

  const here = room ? room.members.filter((m) => Date.now() - m.lastSeen < ROOM_PRESENCE_MS) : [];
  const roomUrl = `${window.location.origin}/together/${code}`;

  return (
    <div className="library room" style={{ "--pl-accent": track?.accent ?? "#FF3D71" } as React.CSSProperties}>
      <div className="library-hero-glow" />
      <Header
        title={tx("Room {code}", { code })}
        onBack={onBack}
        right={
          <button className="topbar-btn" aria-label={tx("Invite")} onClick={async () => setLinkNote(tx(await copyOrShare(roomUrl, "HookedCue room")) || null)}>
            <IconShare size={16} />
          </button>
        }
      />
      <div className="library-body">
        {joinError && <p className="settings-hint" role="alert">{joinError}</p>}
        {!authLoading && !isAuthenticated ? (
          <p className="settings-hint">{tx("Sign in to join this room.")}</p>
        ) : (
          room === null && <p className="settings-hint">{tx("No room with that code.")}</p>
        )}
        {room && !room.open && (
          <div className="social-center">
            <p className="library-title">{tx("This room has ended")}</p>
            <p className="settings-hint">{tx(room.saves === 1 ? "1 save was made in it." : "{n} saves were made in it.", { n: room.saves })}</p>
          </div>
        )}
        {room && room.open && (
          <>
            {linkNote && <p className="settings-hint" role="status">{linkNote}</p>}
            <div className="room-people">
              {here.map((m, i) => (
                <span key={`${m.name}-${i}`} className={`room-person ${m.host ? "host" : ""}`} title={m.host ? tx("host") : undefined}>
                  <Avatar name={m.name} size={30} />
                  <small>{m.me ? tx("you") : m.name}</small>
                </span>
              ))}
            </div>
            {track ? (
              <motion.div key={track.id} className="room-card" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }}>
                <button type="button" className="room-art" onClick={toggle} aria-label={playing ? tx("Pause") : tx("Play")}>
                  <img src={art(track.artwork, 600)} alt="" />
                  {!playing && <span className="room-art-play">▶</span>}
                </button>
                <div className="room-progress"><i style={{ transform: `scaleX(${progress})` }} /></div>
                <h2 className="library-title">{track.title}</h2>
                <p className="library-sub">{track.artist}</p>
                <p className="settings-hint">{tx("Song {i} of {n} · hosted by {host}", { i: room.index + 1, n: room.total, host: room.isHost ? tx("you") : room.hostName })}</p>
                <div className="room-actions">
                  <button type="button" className={`library-cta ghost ${myReaction === "skip" ? "on" : ""}`} onClick={() => void skip()}>
                    {room.isHost ? tx("Next ▶") : tx("Not for me")}
                  </button>
                  <button type="button" className={`library-cta ${myReaction === "save" ? "on" : ""}`} onClick={() => void save()}>
                    <IconHeart size={15} /> {myReaction === "save" ? tx("Saved") : tx("Save")}
                  </button>
                </div>
                <div className="room-reactions" aria-live="polite">
                  {room.reactions.length === 0 ? (
                    <span className="settings-hint">{tx("No one has reacted yet.")}</span>
                  ) : (
                    room.reactions.map((r, i) => (
                      <span key={i} className={`room-reaction ${r.action}`}>
                        {r.action === "save" ? "♥" : "↷"} {r.me ? tx("you") : r.name}
                      </span>
                    ))
                  )}
                </div>
              </motion.div>
            ) : (
              <p className="settings-hint">{tx("Loading the song…")}</p>
            )}
            {room.isHost && (
              <button
                type="button"
                className="profile-signout"
                onClick={async () => {
                  await end({ code });
                  onBack();
                }}
              >
                {tx("End the room")}
              </button>
            )}
          </>
        )}
        <div style={{ height: 10 }} />
      </div>
    </div>
  );
}

/** "Share to followers": a note and a button, inside the song's ⋯ sheet. */
export function ShareToFollowers({ song }: { song: ServerSong }) {
  const tx = useT();
  const share = useMutation(api.social.shareToFollowers);
  const me = useQuery(api.social.me);
  const [note, setNote] = useState("");
  const [state, setState] = useState<"idle" | "busy" | "done" | string>("idle");
  if (!me) return null;
  return (
    <form
      className="social-share-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("busy");
        try {
          await share({ track: song, note: note.trim() || undefined });
          setState("done");
        } catch (err) {
          setState(serverMessage(err));
        }
      }}
    >
      <span className="social-share-label"><IconUser size={14} /> {tx("Share to your followers")}</span>
      <div className="social-code-form">
        <input
          className="social-input"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={tx("Add a note (optional)")}
          maxLength={140}
          aria-label={tx("Note")}
        />
        <button type="submit" className="library-cta" disabled={state === "busy" || state === "done"}>
          {state === "done" ? tx("Shared ✓") : tx("Share")}
        </button>
      </div>
      {state !== "idle" && state !== "busy" && state !== "done" && <p className="settings-hint" role="alert">{state}</p>}
    </form>
  );
}
