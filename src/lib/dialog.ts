import { useEffect, useRef } from "react";

/**
 * Modal-dialog behaviour for the sheets and overlays.
 *
 * The sheets used to be pure visuals: no Escape, no focus management, so a
 * keyboard user could open one and be stuck behind it. This wires up the
 * essentials — Esc closes, initial focus lands inside, Tab cycles within.
 */
export function useDialog({
  onClose,
  enabled = true,
}: {
  onClose: () => void;
  enabled?: boolean;
}) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const node = ref.current;
    if (!node) return;

    // move focus inside so Tab cycles from here and screen readers announce
    const previous = document.activeElement as HTMLElement | null;
    const focusable = node.querySelector<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    );
    (focusable ?? node).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab") return;
      const items = Array.from(
        node.querySelectorAll<HTMLElement>(
          "button:not([disabled]), [href], input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])",
        ),
      );
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    node.addEventListener("keydown", onKey);
    return () => {
      node.removeEventListener("keydown", onKey);
      previous?.focus?.(); // hand focus back where it came from
    };
  }, [enabled, onClose]);

  return { ref, role: "dialog" as const, ariaModal: true as const, tabIndex: -1 };
}
