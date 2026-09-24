import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { AnimatePresence, motion } from "motion/react";

/**
 * The app's own confirm dialog and notices.
 *
 * Every "are you sure?" and every error used to go through window.confirm and
 * window.alert: a grey browser box with the site's address in the title,
 * blocking the whole tab, un-themed, and on some phones rendered as a system
 * sheet that looked like a security warning. These look like the app, say
 * what the action is, keep the destructive button red, and don't freeze the
 * page behind them.
 *
 *   const { confirm, notify } = useDialogs();
 *   if (!(await confirm({ title: "Delete playlist?", confirmLabel: "Delete", danger: true }))) return;
 *   notify("Couldn't save — try again", "error");
 */

export interface ConfirmOptions {
  title: string;
  body?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** destructive: the confirm button is red and focus starts on Cancel */
  danger?: boolean;
}

type Tone = "info" | "success" | "error";

interface Dialogs {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  notify: (message: string, tone?: Tone) => void;
}

const DialogContext = createContext<Dialogs | null>(null);

export function useDialogs(): Dialogs {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialogs needs <DialogProvider> above it");
  return ctx;
}

interface Pending extends ConfirmOptions {
  resolve: (ok: boolean) => void;
}

interface Notice {
  id: number;
  message: string;
  tone: Tone;
}

/** Errors stay up long enough to be read; the rest get out of the way. */
export const noticeDuration = (tone: Tone) => (tone === "error" ? 6000 : 3200);

export function DialogProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [notices, setNotices] = useState<Notice[]>([]);
  const nextId = useRef(1);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending((prev) => {
          prev?.resolve(false); // a second question cancels the first
          return { ...options, resolve };
        });
      }),
    [],
  );

  const notify = useCallback((message: string, tone: Tone = "info") => {
    const id = nextId.current++;
    setNotices((list) => [...list.slice(-2), { id, message, tone }]);
    window.setTimeout(() => setNotices((list) => list.filter((n) => n.id !== id)), noticeDuration(tone));
  }, []);

  const answer = useCallback((ok: boolean) => {
    setPending((prev) => {
      prev?.resolve(ok);
      return null;
    });
  }, []);

  const value = useMemo(() => ({ confirm, notify }), [confirm, notify]);

  return (
    <DialogContext.Provider value={value}>
      {children}
      <AnimatePresence>
        {pending && <ConfirmDialog key="confirm" pending={pending} onAnswer={answer} />}
      </AnimatePresence>
      <div className="notice-stack" aria-live="polite">
        <AnimatePresence initial={false}>
          {notices.map((n) => (
            <motion.div
              key={n.id}
              className={`notice notice-${n.tone}`}
              role={n.tone === "error" ? "alert" : "status"}
              initial={{ opacity: 0, y: 16, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, transition: { duration: 0.15 } }}
            >
              <span className="notice-dot" aria-hidden="true" />
              <span>{n.message}</span>
              <button
                className="notice-close"
                aria-label="Dismiss"
                onClick={() => setNotices((list) => list.filter((x) => x.id !== n.id))}
              >
                ×
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </DialogContext.Provider>
  );
}

function ConfirmDialog({ pending, onAnswer }: { pending: Pending; onAnswer: (ok: boolean) => void }) {
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    // destructive questions start on the safe answer
    (pending.danger ? cancelRef : confirmRef).current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onAnswer(false);
      } else if (e.key === "Tab") {
        // keep focus inside the two buttons
        const order = [cancelRef.current, confirmRef.current].filter(Boolean) as HTMLElement[];
        const at = order.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        order[(at + (e.shiftKey ? -1 : 1) + order.length) % order.length]?.focus();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [pending, onAnswer]);

  return (
    <motion.div
      className="dlg-backdrop"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onAnswer(false);
      }}
    >
      <motion.div
        className={`dlg${pending.danger ? " dlg-danger" : ""}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="dlg-title"
        aria-describedby={pending.body ? "dlg-body" : undefined}
        initial={{ opacity: 0, y: 18, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 10, scale: 0.98 }}
        transition={{ type: "spring", stiffness: 420, damping: 32 }}
      >
        <h2 id="dlg-title" className="dlg-title">
          {pending.title}
        </h2>
        {pending.body && (
          <div id="dlg-body" className="dlg-body">
            {pending.body}
          </div>
        )}
        <div className="dlg-actions">
          <button ref={cancelRef} className="dlg-btn" onClick={() => onAnswer(false)}>
            {pending.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            className={`dlg-btn dlg-btn-primary${pending.danger ? " dlg-btn-danger" : ""}`}
            onClick={() => onAnswer(true)}
          >
            {pending.confirmLabel ?? "OK"}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

/* --------------------------------------------------------------- select --- */

export interface SelectOption<T extends string> {
  value: T;
  label: string;
}

/**
 * A dropdown that looks like the app. The native <select> opened the
 * browser's own list — white, system font, a different design on every OS.
 * Keyboard: ↑/↓ move, Enter picks, Esc closes; type-free on purpose (short lists).
 */
export function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange: (value: T) => void;
  /** accessible name */
  label: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(() => Math.max(0, options.findIndex((o) => o.value === value)));
  const root = useRef<HTMLDivElement | null>(null);
  const current = options.find((o) => o.value === value) ?? options[0];

  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", away);
    return () => window.removeEventListener("pointerdown", away);
  }, [open]);

  const pick = (i: number) => {
    const o = options[i];
    if (o) onChange(o.value);
    setOpen(false);
  };

  return (
    <div className={`sel${open ? " open" : ""}${className ? ` ${className}` : ""}`} ref={root}>
      <button
        type="button"
        className="sel-btn"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${label}: ${current?.label ?? ""}`}
        onClick={() => {
          setActive(Math.max(0, options.findIndex((o) => o.value === value)));
          setOpen((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              setOpen(true);
              return;
            }
            setActive((i) => (i + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
          } else if (e.key === "Enter" && open) {
            e.preventDefault();
            pick(active);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      >
        <span>{current?.label}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            className="sel-list"
            role="listbox"
            aria-label={label}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4, transition: { duration: 0.1 } }}
          >
            {options.map((o, i) => (
              <li
                key={o.value}
                role="option"
                aria-selected={o.value === value}
                className={`${i === active ? "active" : ""}${o.value === value ? " chosen" : ""}`}
                onPointerEnter={() => setActive(i)}
                onClick={() => pick(i)}
              >
                {o.label}
              </li>
            ))}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
