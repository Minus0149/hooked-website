import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { normalizeUsername, usernameProblem, USERNAME_MAX } from "../lib/username";
import { useT } from "../lib/lang";
import { serverMessage } from "../lib/serverError";

/**
 * The listener's @handle on their profile: shown when set, edited in place.
 * The rules are checked as you type (src/lib/username.ts), availability a
 * moment after you stop, and the server checks both again on save.
 */
export function UsernameField() {
  const tt = useT();
  const library = useQuery(api.library.getLibrary);
  const current = library?.username ?? null;
  const save = useMutation(api.library.setUsername);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [debounced, setDebounced] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const name = normalizeUsername(draft);
  const localProblem = name ? usernameProblem(name) : null;
  useEffect(() => {
    const id = setTimeout(() => setDebounced(name), 350);
    return () => clearTimeout(id);
  }, [name]);
  const remote = useQuery(
    api.library.usernameStatus,
    editing && debounced && !usernameProblem(debounced) && debounced !== current ? { username: debounced } : "skip",
  );

  if (library === undefined) return null;

  if (!editing) {
    return (
      <button
        className={current ? "username-show" : "username-add"}
        onClick={() => {
          setDraft(current ?? "");
          setError(null);
          setEditing(true);
        }}
      >
        {current ? `@${current}` : tt("Choose a username")}
        <span className="username-edit">{current ? tt("edit") : "+"}</span>
      </button>
    );
  }

  const unchanged = name === (current ?? "");
  const checking = !!name && !localProblem && !unchanged && (debounced !== name || remote === undefined);
  const message = error ?? localProblem ?? (remote && !remote.ok ? remote.problem : null);
  const canSave = !busy && !unchanged && (name === "" || (!localProblem && !checking && remote?.ok === true));

  const submit = async () => {
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      await save({ username: name });
      setEditing(false);
    } catch (e) {
      // Convex wraps thrown messages (and prod redacts all but ConvexError); show only ours
      setError(serverMessage(e, tt("Couldn't save that. Try again.")));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="username-form"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label className="username-input-wrap">
        <span className="username-at" aria-hidden="true">@</span>
        <input
          className="auth-input username-input"
          value={draft}
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          maxLength={USERNAME_MAX + 1}
          aria-label={tt("Username")}
          aria-invalid={!!message}
          placeholder={tt("yourname")}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(null);
          }}
        />
      </label>
      <p className={`username-note${message ? " is-bad" : remote?.ok && !unchanged ? " is-good" : ""}`} aria-live="polite">
        {message
          ? tt(message)
          : checking
            ? tt("Checking…")
            : remote?.ok && !unchanged
              ? tt("@{name} is free.", { name })
              : name === "" && current
                ? tt("Saving an empty name removes it.")
                : tt("Letters, numbers, dots and underscores.")}
      </p>
      <div className="username-actions">
        <button type="button" className="username-cancel" onClick={() => setEditing(false)}>
          {tt("Cancel")}
        </button>
        <button type="submit" className="ob-primary username-save" disabled={!canSave}>
          {busy ? tt("Saving…") : tt("Save")}
        </button>
      </div>
    </form>
  );
}
