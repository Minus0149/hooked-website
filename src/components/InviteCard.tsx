import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

/**
 * "Invite friends" — the listener's personal link. A friend who applies
 * through it skips the waitlist, up to the allowance the admin sets
 * (convex/referrals.ts). Shown on the profile of anyone with an account.
 */
export function InviteCard() {
  const data = useQuery(api.referrals.mine);
  const ensureCode = useMutation(api.referrals.ensureCode);
  const asked = useRef(false);
  const [note, setNote] = useState<string | null>(null);

  // the code is made the first time someone opens their profile
  useEffect(() => {
    if (!data || !data.enabled || data.code || asked.current) return;
    asked.current = true;
    void ensureCode({}).catch(() => {
      asked.current = false;
    });
  }, [data, ensureCode]);

  if (!data || !data.enabled) return null;

  const flash = (msg: string) => {
    setNote(msg);
    window.setTimeout(() => setNote(null), 2200);
  };

  const share = async () => {
    if (!data.link) return;
    const text = "Come find songs with me on hookedcue — this link skips the waitlist.";
    try {
      if (navigator.share) {
        await navigator.share({ title: "hookedcue", text, url: data.link });
        return;
      }
    } catch {
      // cancelled — fall through to copying
    }
    await copy();
  };

  const copy = async () => {
    if (!data.link) return;
    try {
      await navigator.clipboard.writeText(data.link);
      flash("Link copied");
    } catch {
      flash("Couldn't copy — press and hold the link instead");
    }
  };

  const full = data.remaining === 0;

  return (
    <section className="invite-card" aria-labelledby="invite-title">
      <div className="invite-head">
        <h3 id="invite-title">invite friends</h3>
        {data.foundingListener && <span className="badge-founding">founding listener</span>}
      </div>
      <p className="invite-copy">
        {full
          ? "You've used all your invites. Friends can still apply — they'll join the queue."
          : `Your link lets ${data.remaining} more ${data.remaining === 1 ? "friend" : "friends"} skip the waitlist.`}
        {!data.foundingListener && " Two friends who join make you a founding listener."}
      </p>
      <div className="invite-link" aria-live="polite">
        {data.link ?? "making your link…"}
      </div>
      <div className="invite-actions">
        <button className="ob-primary invite-share" onClick={() => void share()} disabled={!data.link}>
          Share invite
        </button>
        <button className="invite-copy-btn" onClick={() => void copy()} disabled={!data.link}>
          Copy
        </button>
      </div>
      <p className="invite-note" role="status">
        {note ?? `${data.used} of ${data.cap} used`}
      </p>
      {data.people.length > 0 && (
        <ul className="invite-people">
          {data.people.map((p, i) => (
            <li key={`${p.name}-${i}`}>
              <span className="invite-person">{p.name}</span>
              <span className={p.joined ? "invite-state joined" : "invite-state"}>
                {p.joined ? "joined" : "invited"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
