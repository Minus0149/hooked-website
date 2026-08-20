import type { CSSProperties, ReactNode } from "react";

/**
 * The shapes every screen was re-typing.
 *
 * A settings row had been hand-written forty-three times, an admin panel
 * seventeen, and each copy drifted — some rows took a `<small>`, some didn't,
 * two spelled the toggle differently. That is why every new feature arrived as
 * another slightly-different row instead of an obviously-consistent one.
 *
 * These wrap the existing class names rather than replacing them: the CSS is
 * good and already themed, what was missing was a single place to spell it.
 */

/* ---------------------------------------------------------------- rows ---- */

export function Row({
  icon,
  iconColor,
  label,
  sub,
  right,
  onClick,
  danger,
  as = "button",
}: {
  icon?: ReactNode;
  iconColor?: string;
  label: ReactNode;
  sub?: ReactNode;
  /** trailing slot: a Toggle, a word like "change", a count */
  right?: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  as?: "button" | "div";
}) {
  const inner = (
    <>
      {icon && (
        <span className="settings-row-icon" style={iconColor ? { color: iconColor } : undefined}>
          {icon}
        </span>
      )}
      <span className="settings-row-label" style={danger ? { color: "var(--never)" } : undefined}>
        {label}
        {sub && <small>{sub}</small>}
      </span>
      {right}
    </>
  );
  if (as === "div" || !onClick) {
    return <div className="settings-row">{inner}</div>;
  }
  return (
    <button className="settings-row" onClick={onClick}>
      {inner}
    </button>
  );
}

export function Toggle({ on }: { on: boolean }) {
  return (
    <span className={`toggle ${on ? "on" : ""}`} role="switch" aria-checked={on}>
      <span className="toggle-knob" />
    </span>
  );
}

export function GroupLabel({ children }: { children: ReactNode }) {
  return <p className="settings-group">{children}</p>;
}

/** Explanatory copy under a group heading — why the setting exists at all. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="settings-note">{children}</p>;
}

/* -------------------------------------------------------------- panels ---- */

export function Panel({
  title,
  sub,
  actions,
  children,
  wide,
}: {
  title?: ReactNode;
  sub?: ReactNode;
  /** buttons that belong to this panel, aligned with its heading */
  actions?: ReactNode;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <section className="admin-panel" style={wide ? { gridColumn: "1 / -1" } : undefined}>
      {/* Without actions this emits exactly the markup these panels already
          used — heading, then dim subtitle, then content. Adoption therefore
          can't shift spacing in screens that need a signed-in admin to see. */}
      {actions ? (
        <div className="panel-head">
          <div>
            {title && <h3>{title}</h3>}
            {sub && <p className="admin-dim">{sub}</p>}
          </div>
          <div className="panel-actions">{actions}</div>
        </div>
      ) : (
        <>
          {title && <h3>{title}</h3>}
          {sub && <p className="admin-dim">{sub}</p>}
        </>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  color,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
  /** "bad" turns the card when a number is a problem rather than a fact */
  tone?: "bad";
}) {
  return (
    <div className={`admin-stat ${tone === "bad" ? "is-bad" : ""}`}>
      <span className="admin-stat-value" style={color ? { color } : undefined}>
        {value}
      </span>
      <span className="admin-stat-label">{label}</span>
      {sub && <span className="admin-stat-sub">{sub}</span>}
    </div>
  );
}

export function Stats({ children }: { children: ReactNode }) {
  return <section className="admin-stats">{children}</section>;
}

export function Cols({ children }: { children: ReactNode }) {
  return <div className="admin-cols">{children}</div>;
}

/* --------------------------------------------------------------- media ---- */

/** Artwork, two lines of text, a trailing slot. The catalogue's workhorse. */
export function MediaRow({
  artwork,
  title,
  sub,
  right,
  dim,
  onClick,
}: {
  artwork?: string;
  title: ReactNode;
  sub?: ReactNode;
  right?: ReactNode;
  dim?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      className={`admin-row ${dim ? "is-hidden" : ""}`}
      onClick={onClick}
      style={onClick ? { cursor: "pointer" } : undefined}
    >
      {artwork !== undefined && <img src={artwork} alt="" />}
      <div className="admin-row-meta">
        <strong>{title}</strong>
        {sub && <span>{sub}</span>}
      </div>
      {right}
    </div>
  );
}

/* --------------------------------------------------------------- state ---- */

export function Empty({ children }: { children: ReactNode }) {
  return <p className="admin-dim">{children}</p>;
}

export function Chip({
  on,
  onClick,
  children,
  title,
}: {
  on?: boolean;
  onClick?: () => void;
  children: ReactNode;
  title?: string;
}) {
  return (
    <button
      className={`admin-perm ${on ? "on" : ""}`}
      onClick={onClick}
      aria-pressed={on}
      title={title}
    >
      {children}
    </button>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="admin-toolbar">{children}</div>;
}

/** A labelled proportion. Used by the funnel and the genre breakdown. */
export function Meter({
  label,
  value,
  of,
  note,
  color,
  valueLabel,
}: {
  label: ReactNode;
  value: number;
  of: number;
  note?: ReactNode;
  color?: string;
  valueLabel?: string;
}) {
  const share = of > 0 ? value / of : 0;
  const style: CSSProperties = {
    width: `${Math.max(share * 100, value > 0 ? 2 : 0)}%`,
    background: color,
  };
  return (
    <div className="admin-funnel-step">
      <div className="admin-funnel-head">
        <span>{label}</span>
        <strong style={color ? { color } : undefined}>{valueLabel ?? value}</strong>
        <span className="admin-dim">{of > 0 ? `${Math.round(share * 100)}%` : "—"}</span>
      </div>
      <div className="admin-funnel-track">
        <div style={style} />
      </div>
      {note && <span className="admin-funnel-note">{note}</span>}
    </div>
  );
}
