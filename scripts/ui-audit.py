"""Find UI defects by measuring, not by looking.

Checks each screen at three widths for the things that are easy to ship and
hard to notice: content wider than the viewport, text clipped by its own box,
interactive elements covered by something else, tap targets under the minimum
size, and anything hidden behind the fixed bottom navigation.
"""
import asyncio, json
from playwright.async_api import async_playwright

URL = "http://localhost:4322/"
WIDTHS = [(360, 780, "small phone"), (430, 932, "iphone 16 pro"), (500, 1000, "large phone")]

AUDIT = """
() => {
  const out = [];
  const vw = innerWidth, vh = innerHeight;
  const seen = new Set();
  const push = (kind, el, detail) => {
    const id = kind + '|' + (el.className || el.tagName) + '|' + detail;
    if (seen.has(id)) return;
    seen.add(id);
    out.push({ kind, el: (el.tagName + '.' + (typeof el.className === 'string' ? el.className : '')).slice(0, 60), detail });
  };

  // 1. anything sticking out sideways
  if (document.documentElement.scrollWidth > vw + 1) {
    push('page-overflow', document.body, `scrollWidth ${document.documentElement.scrollWidth} > ${vw}`);
  }

  // Only audit what is actually on top. An overlay (onboarding, the invite
  // wall) covers the screen behind it, and reporting every button underneath
  // as "covered" buries the real findings in noise.
  const overlay = document.querySelector('.onboarding, .gate-overlay');
  const root = overlay || document.body;

  // Shelves scroll sideways on purpose, so their children leaving the viewport
  // is the design, not a defect.
  const scrollsX = (el) => {
    for (let n = el; n && n !== document.body; n = n.parentElement) {
      const o = getComputedStyle(n).overflowX;
      if (o === 'auto' || o === 'scroll') return true;
    }
    return false;
  };

  const all = [...root.querySelectorAll('*')].filter((e) => {
    const s = getComputedStyle(e);
    return s.display !== 'none' && s.visibility !== 'hidden' && +s.opacity > 0.05 && e.offsetParent !== null;
  });

  for (const el of all) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;

    // 2. off the right or left edge
    if (r.right > vw + 1 || r.left < -1) {
      const s = getComputedStyle(el);
      if (s.position !== 'fixed' && s.overflow !== 'hidden' && !scrollsX(el)) {
        push('offscreen-x', el, `${Math.round(r.left)}..${Math.round(r.right)} vs 0..${vw}`);
      }
    }

    // 3. text clipped by its own box
    if (el.scrollHeight > el.clientHeight + 2 && el.clientHeight > 0) {
      const s = getComputedStyle(el);
      if (s.overflowY !== 'auto' && s.overflowY !== 'scroll' && el.children.length === 0) {
        push('text-clipped', el, `needs ${el.scrollHeight}px has ${el.clientHeight}px`);
      }
    }
  }

  // 4. interactive elements: covered, too small, or under the bottom bar
  const nav = document.querySelector('.bottom-nav, .nav, nav');
  const navTop = nav ? nav.getBoundingClientRect().top : vh;
  for (const el of root.querySelectorAll('button, a, input, [role="switch"], [role="button"]')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    if (r.top > vh || r.bottom < 0) continue;

    if (r.height < 44 || r.width < 44) {
      push('small-target', el, `${Math.round(r.width)}x${Math.round(r.height)} (want 44)`);
    }
    const cx = Math.min(Math.max(r.left + r.width / 2, 1), vw - 1);
    const cy = Math.min(Math.max(r.top + r.height / 2, 1), vh - 1);
    const hit = document.elementFromPoint(cx, cy);
    if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
      push('covered', el, `by ${hit.tagName}.${(typeof hit.className === 'string' ? hit.className : '').slice(0, 30)}`);
    }
    // a control that ends underneath the fixed nav can never be pressed
    if (!overlay && nav && r.top < navTop && r.bottom > navTop + 4 && getComputedStyle(el).position !== 'fixed') {
      push('under-nav', el, `bottom ${Math.round(r.bottom)} vs nav top ${Math.round(navTop)}`);
    }
  }
  return out;
}
"""


async def screen(pg, name, setup):
    await pg.goto(URL, wait_until="domcontentloaded")
    await pg.wait_for_timeout(2600)
    await setup(pg)
    await pg.wait_for_timeout(900)
    return await pg.evaluate(AUDIT)


async def to_deck(pg):
    # onboarding may already be dismissed from an earlier screen in this context
    skip = pg.locator(".ob-skip").first
    if await skip.count() and await skip.is_visible():
        await skip.click()
        await pg.wait_for_timeout(2200)


async def to_onboarding(pg):
    await pg.locator(".ob-primary").first.click()
    await pg.wait_for_timeout(900)


async def to_settings(pg):
    await to_deck(pg)
    await pg.locator('.nav-btn:has-text("Home")').first.click()
    await pg.wait_for_timeout(1200)
    await pg.locator('button[aria-label="Settings"]').first.click()
    await pg.wait_for_timeout(1500)


async def to_home(pg):
    await to_deck(pg)
    await pg.locator('.nav-btn:has-text("Home")').first.click()
    await pg.wait_for_timeout(1500)


async def main():
    findings = {}
    async with async_playwright() as pw:
        b = await pw.chromium.launch(channel="msedge", args=["--autoplay-policy=no-user-gesture-required"])
        for w, h, label in WIDTHS:
            ctx = await b.new_context(viewport={"width": w, "height": h}, is_mobile=True,
                                      has_touch=True, reduced_motion="no-preference")
            # clear on every navigation, so each screen starts from a fresh
            # visitor no matter what the previous one left behind
            await ctx.add_init_script(
                "localStorage.removeItem('hooked.onboarded');"
                "localStorage.removeItem('hooked.anonSwipes.v1');"
                "localStorage.removeItem('hooked.library.v2');"
            )
            pg = await ctx.new_page()
            await pg.goto(URL, wait_until="domcontentloaded")
            for name, setup in [("onboarding", to_onboarding), ("deck", to_deck),
                                ("home", to_home), ("settings", to_settings)]:
                try:
                    res = await screen(pg, name, setup)
                except Exception as e:
                    res = [{"kind": "audit-failed", "el": "-", "detail": str(e)[:90]}]
                for f in res:
                    key = (f["kind"], f["el"], f["detail"])
                    findings.setdefault(key, []).append(f"{label}/{name}")
            await ctx.close()
        await b.close()

    if not findings:
        print("no defects found")
        return
    by_kind = {}
    for (kind, el, detail), where in findings.items():
        by_kind.setdefault(kind, []).append((el, detail, where))
    for kind in sorted(by_kind):
        print(f"\n## {kind}  ({len(by_kind[kind])})")
        for el, detail, where in by_kind[kind][:12]:
            print(f"  {el}")
            print(f"      {detail}")
            print(f"      seen: {', '.join(sorted(set(where))[:4])}")


asyncio.run(main())
