"""Find UI defects by measuring, not by looking.

Walks every route at three widths and reports the things that are easy to ship
and hard to notice: content that genuinely escapes the viewport, text clipped
by its own box, controls covered by something else, targets under the minimum
size, and anything still trapped under the bottom bar once a screen is scrolled
to its end.

    python scripts/ui-audit.py [--url http://localhost:5173/] [--shots DIR]

Three things this got wrong before, all of which made it lie confidently:

  * It set `hooked.onboarded`, and the app reads `hooked.onboarded.v1`. Every
    "screen" it audited was therefore the onboarding overlay — four screens,
    one result, no findings, the reassuring kind of broken. The key now comes
    from the app's own source, so a rename breaks the run instead of hollowing
    it out.

  * It hit-tested the centre of every control, clamped into the viewport. A
    card scrolled off the side of a shelf was probed at a point inside a
    *different* card and reported as "covered". Controls that are not actually
    on screen are skipped now rather than dragged into view.

  * It called an element off-screen for sticking out sideways, looking only at
    that element's own `overflow`. Decorative glows are 130% wide on purpose
    and clipped by the phone frame two levels up. Clipping ancestors are walked
    now, and the page's own scrollWidth is the arbiter.

The target-size floor is 24px, which is what WCAG 2.5.8 requires; 44 is Apple's
comfort figure and is reported separately. A flat 44 buried one genuinely
broken 15px control under thirty-five 36px chips that were never a problem,
which is how a report gets ignored.
"""

import argparse
import asyncio
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent

WIDTHS = [(360, 780, "small phone"), (430, 932, "iphone 16 pro"), (500, 1000, "large phone")]

# (label, route, show onboarding)
ROUTES = [
    ("onboarding", "#/", True),
    ("deck", "#/discover", False),
    ("home", "#/", False),
    ("profile", "#/profile", False),
    ("settings", "#/settings", False),
    ("settings-appearance", "#/settings/appearance", False),
    ("settings-playback", "#/settings/playback", False),
    ("settings-gestures", "#/settings/gestures", False),
    ("settings-sound", "#/settings/sound", False),
    ("settings-support", "#/settings/support", False),
    ("settings-data", "#/settings/data", False),
    ("library-liked", "#/library/liked", False),
    ("library-discoveries", "#/library/discoveries", False),
    ("not-found", "#/no-such-page", False),
    ("admin", "#/admin", False),
    ("creator", "#/creator", False),
]


def onboarding_key() -> str:
    """Read the flag out of the app rather than restating it here."""
    src = (ROOT / "src/App.tsx").read_text(encoding="utf-8")
    m = re.search(r'ONBOARD_KEY\s*=\s*"([^"]+)"', src)
    if not m:
        sys.exit("ui-audit: no ONBOARD_KEY in src/App.tsx — has it moved? Fix this before trusting a run.")
    return m.group(1)


AUDIT = """
(opts) => {
  const out = [];
  const vw = innerWidth, vh = innerHeight;
  const seen = new Set();
  const name = (el) => (el.tagName + '.' + (typeof el.className === 'string' ? el.className : '')).slice(0, 60);
  const push = (kind, el, detail) => {
    const id = kind + '|' + name(el) + '|' + detail;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, el: name(el), detail });
  };

  // Only audit what is actually on top. An overlay (onboarding, the invite
  // wall) covers the screen behind it, and reporting every button underneath
  // as "covered" buries the real findings in noise.
  const overlay = document.querySelector('.onboarding, .gate-overlay');
  const root = overlay || document.body;

  /**
   * The window this element is actually painted through: every clipping
   * ancestor intersected, not just the nearest one. A card sits inside a
   * shelf that scrolls sideways, inside a screen that scrolls down, inside
   * the phone frame — and the innermost of those is not always the one that
   * cuts it off.
   */
  const clipRect = (el) => {
    let box = null;
    for (let n = el.parentElement; n; n = n.parentElement) {
      const s = getComputedStyle(n);
      if (s.overflowX === 'visible' && s.overflowY === 'visible') continue;
      const r = n.getBoundingClientRect();
      box = box
        ? { left: Math.max(box.left, r.left), top: Math.max(box.top, r.top),
            right: Math.min(box.right, r.right), bottom: Math.min(box.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return box;
  };

  const shown = (el) => {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && el.offsetParent !== null;
  };

  // 1. The page itself must never scroll sideways. This is the only honest
  //    test of "sticks out": an element wider than the viewport inside a
  //    clipping frame is a design, not a defect.
  if (document.documentElement.scrollWidth > vw + 1) {
    push('page-scrolls-sideways', document.body,
         'scrollWidth ' + document.documentElement.scrollWidth + ' > ' + vw);
    for (const el of root.querySelectorAll('*')) {
      if (!shown(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right <= vw + 1 && r.left >= -1) continue;
      if (getComputedStyle(el).position === 'fixed') continue;
      const c = clipRect(el);
      if (c && c.right <= vw + 1) continue;
      push('offscreen-x', el, Math.round(r.left) + '..' + Math.round(r.right) + ' vs 0..' + vw);
    }
  }

  // 2. Text clipped by its own box.
  for (const el of root.querySelectorAll('*')) {
    if (el.children.length > 0) continue;
    if (!shown(el)) continue;
    if (el.clientHeight === 0 || el.scrollHeight <= el.clientHeight + 2) continue;
    const s = getComputedStyle(el);
    if (s.overflowY === 'auto' || s.overflowY === 'scroll') continue;
    push('text-clipped', el, 'needs ' + el.scrollHeight + 'px has ' + el.clientHeight + 'px');
  }

  // 3. Controls: covered, trapped, or too small to hit.
  const nav = document.querySelector('.bottomnav, .bottom-nav');
  const navTop = nav ? nav.getBoundingClientRect().top : vh;

  const controls = root.querySelectorAll(
    'button, a, input, select, [role="switch"], [role="button"], [role="radio"]');
  for (const el of controls) {
    if (!shown(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // Skip anything not actually on screen — including a card scrolled out of
    // a shelf. Probing a clamped point lands on a neighbour and invents a
    // "covered" finding about a control nobody can see anyway.
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    if (cx < 0 || cx > vw || cy < 0 || cy > vh) continue;
    const c = clipRect(el);
    if (c && (cx < c.left || cx > c.right || cy < c.top || cy > c.bottom)) continue;

    // A pseudo-element may carry the real hit area (see .section-action), so
    // measure what actually responds to a press, not just the border box.
    const hit = document.elementFromPoint(cx, cy);
    const size = Math.round(r.width) + 'x' + Math.round(r.height);
    if (r.height < opts.min || r.width < opts.min) {
      push('target-too-small', el, size + ' (WCAG 2.5.8 wants ' + opts.min + ')');
    } else if (r.height < opts.comfort || r.width < opts.comfort) {
      push('target-under-comfort', el, size + ' (' + opts.comfort + ' is comfortable)');
    }

    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      push('covered', el, 'by ' + name(hit));
    }

    // A control that ends underneath the fixed bar can never be pressed —
    // but only the part of it that is actually painted counts. A row whose
    // layout box runs past the bottom of a scroll container is cut off there,
    // well above the bar, and reporting its unclipped rect invents a defect.
    const visibleBottom = c ? Math.min(r.bottom, c.bottom) : r.bottom;
    if (!overlay && nav && !nav.contains(el) && r.top < navTop && visibleBottom > navTop + 4
        && getComputedStyle(el).position !== 'fixed') {
      push('under-nav', el, 'bottom ' + Math.round(visibleBottom) + ' vs bar top ' + Math.round(navTop));
    }
  }
  return out;
}
"""

SCROLL_TO_END = """
() => {
  // Only the app's own containers. On a narrow desktop viewport the phone
  // frame and the stage behind it are scrollable presentation chrome, and
  // scrolling those slides the whole phone out of the window — after which
  // every measurement describes a screen no user will ever see. (This is what
  // "content trapped under the bottom bar on a small phone" turned out to be.)
  const chrome = new Set(['stage', 'phone', 'phone-wrap']);
  for (const el of document.querySelectorAll('*')) {
    if (typeof el.className === 'string' && el.className.split(/\s+/).some((c) => chrome.has(c))) continue;
    if (el.scrollHeight > el.clientHeight + 4) el.scrollTop = 1e6;
  }
}
"""

# kinds that mean something is broken, worst first
SERIOUS = [
    "screen-failed",
    "page-scrolls-sideways",
    "offscreen-x",
    "covered",
    "under-nav",
    "text-clipped",
    "target-too-small",
]
ORDER = SERIOUS + ["target-under-comfort"]


async def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--url", default="http://localhost:5173/")
    ap.add_argument("--shots", default=None, help="write a screenshot per route here")
    ap.add_argument("--min", type=int, default=24, help="hard floor for a target, in px")
    ap.add_argument("--comfort", type=int, default=44, help="comfortable size, reported separately")
    args = ap.parse_args()

    try:
        from playwright.async_api import async_playwright
    except ImportError:
        sys.exit("ui-audit needs playwright: pip install playwright && playwright install msedge")

    shots = pathlib.Path(args.shots) if args.shots else None
    if shots:
        shots.mkdir(parents=True, exist_ok=True)

    key = onboarding_key()
    opts = {"min": args.min, "comfort": args.comfort}
    findings: dict[tuple[str, str, str], list[str]] = {}
    errors: dict[str, list[str]] = {}

    async with async_playwright() as pw:
        browser = await pw.chromium.launch(
            channel="msedge", args=["--autoplay-policy=no-user-gesture-required"]
        )
        for w, h, label in WIDTHS:
            for name, route, first_run in ROUTES:
                # A fresh context per route: the onboarding flag has to be set
                # before the app boots, and one context that has already been
                # through onboarding cannot show it again.
                ctx = await browser.new_context(
                    viewport={"width": w, "height": h},
                    is_mobile=True,
                    has_touch=True,
                    # this machine reports "reduce" system-wide; auditing the
                    # motion-off build would miss everything animation places
                    reduced_motion="no-preference",
                    device_scale_factor=2,
                )
                if not first_run:
                    await ctx.add_init_script(f"localStorage.setItem({key!r}, '1');")
                page = await ctx.new_page()
                page.on(
                    "console",
                    lambda m: errors.setdefault(m.text[:150], []).append(label)
                    if m.type == "error"
                    else None,
                )
                page.on("pageerror", lambda e: errors.setdefault(str(e)[:150], []).append(label))
                try:
                    # domcontentloaded, not networkidle: the Convex socket
                    # retries forever when the backend is down, so networkidle
                    # would simply never fire.
                    await page.goto(args.url + route, wait_until="domcontentloaded")
                    await page.wait_for_timeout(2200)
                    result = await page.evaluate(AUDIT, opts)
                    if shots and label == "iphone 16 pro":
                        await page.screenshot(path=str(shots / f"{name}.png"))
                    # then again from the bottom, which is where content
                    # trapped under the bar actually shows up
                    await page.evaluate(SCROLL_TO_END)
                    # long enough for the rise-in transforms to land; measuring
                    # an element mid-animation reports a rect it never holds
                    await page.wait_for_timeout(900)
                    result += await page.evaluate(AUDIT, opts)
                except Exception as e:  # a screen that won't even load is a finding
                    result = [{"kind": "screen-failed", "el": "-", "detail": str(e)[:120]}]
                for f in result:
                    findings.setdefault((f["kind"], f["el"], f["detail"]), []).append(
                        f"{label}/{name}"
                    )
                await ctx.close()
        await browser.close()

    by_kind: dict[str, list[tuple[str, str, list[str]]]] = {}
    for (kind, el, detail), where in findings.items():
        by_kind.setdefault(kind, []).append((el, detail, where))

    if not by_kind:
        print("no defects found")
    for kind in sorted(by_kind, key=lambda k: ORDER.index(k) if k in ORDER else 99):
        rows = by_kind[kind]
        print(f"\n## {kind}  ({len(rows)})")
        for el, detail, where in rows[:15]:
            print(f"  {el}\n      {detail}\n      seen: {', '.join(sorted(set(where))[:5])}")
        if len(rows) > 15:
            print(f"  … and {len(rows) - 15} more")

    if errors:
        print(f"\n## console errors  ({len(errors)})")
        for text in list(errors)[:10]:
            print(f"  {text}")

    # exit non-zero only for the serious kinds, so this can gate a commit
    return 1 if any(by_kind.get(k) for k in SERIOUS) else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
