"""Film hooked. — one clip per scene, plus a combined reel.

Every action asserts the screen actually changed. The first version of this
logged what it was about to do rather than what happened, so it reported a
clean run while clicking nothing and filmed a still welcome screen for a
minute.

Two things worth knowing about this machine:
  * it reports prefers-reduced-motion: reduce in every browser, so contexts are
    opened with reduced_motion="no-preference" — otherwise the card physics and
    the segmented dots, the entire point of the footage, are switched off.
  * Convex is down, so the deck falls back to the catalogue bundled in the JS.
    That's the offline path working as designed and it films fine, but it does
    mean the signed-in screens (admin, creator) can't be shot yet.
"""
import asyncio, os, shutil, subprocess, sys, time
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

OUT_DIR = r"F:\Videos\Insta\2nd Reel (Hooked)"
CLIPS = os.path.join(OUT_DIR, "clips")
RAW = os.path.join(OUT_DIR, "raw")
URL = "http://localhost:4321/"
VIEW = {"width": 430, "height": 932}

problems = []
# seconds of browser boot to cut off the front of each clip
LEAD_IN = {}


def log(*p):
    print(" ".join(str(x) for x in p).encode("ascii", "replace").decode(), flush=True)


class Scene:
    """One recorded clip. Each context writes its own webm."""

    def __init__(self, pw, name):
        self.pw = pw
        self.name = name
        self.dir = os.path.join(RAW, name)

    async def __aenter__(self):
        os.makedirs(self.dir, exist_ok=True)
        self.browser = await self.pw.chromium.launch(
            channel="msedge", args=["--autoplay-policy=no-user-gesture-required"]
        )
        self.ctx = await self.browser.new_context(
            viewport=VIEW,
            device_scale_factor=2,
            is_mobile=True,
            has_touch=True,
            reduced_motion="no-preference",
            record_video_dir=self.dir,
            record_video_size=VIEW,
        )
        self.pg = await self.ctx.new_page()
        # Recording starts the moment the context exists, so the browser
        # launching and the app booting land at the head of every clip as dead
        # air — 21 seconds of it in the first take. Note when the app is
        # actually ready and trim exactly that much off the front.
        self.started = time.monotonic()
        self.lead_in = 0.0
        return self

    async def __aexit__(self, *exc):
        await self.ctx.close()
        await self.browser.close()
        LEAD_IN[self.name] = self.lead_in
        log(f"   (trimming {self.lead_in:.1f}s of boot from the head)")

    async def open(self, fresh=True):
        if fresh:
            # Film a genuinely fresh visitor. The anon counter is the one that
            # matters: five swipes in, the invite gate drops over the deck and
            # every later action silently does nothing — which is exactly what
            # ruined the first take.
            await self.pg.add_init_script(
                "localStorage.removeItem('hooked.onboarded');"
                "localStorage.removeItem('hooked.library.v2');"
                "localStorage.removeItem('hooked.anonSwipes.v1');"
            )
        await self.pg.goto(URL, wait_until="networkidle")
        await self.pg.wait_for_timeout(1400)
        # keep a beat of the first screen, not twenty seconds of it
        self.lead_in = max(0.0, time.monotonic() - self.started - 1.0)

    async def click(self, selector, expect=None, label=None, wait=900):
        """Click, then prove the screen moved. Raises rather than pretending."""
        what = label or selector
        try:
            el = self.pg.locator(selector).first
            await el.wait_for(state="visible", timeout=6000)
            await el.click()
        except PWTimeout:
            problems.append(f"{self.name}: never found {what}")
            log("   MISS", what)
            return False
        if expect:
            try:
                await self.pg.locator(expect).first.wait_for(state="visible", timeout=6000)
            except PWTimeout:
                problems.append(f"{self.name}: clicked {what} but {expect} never appeared")
                log("   STUCK after", what)
                return False
        await self.pg.wait_for_timeout(wait)
        log("   ok", what)
        return True

    async def swipe_card(self, dx, dy, label, settle=2400):
        box = await self.pg.locator(".card").first.bounding_box()
        if not box:
            problems.append(f"{self.name}: no card to swipe")
            return False
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        before = await self.pg.locator(".card-title").first.inner_text()
        await self.pg.mouse.move(cx, cy)
        await self.pg.mouse.down()
        for i in range(1, 23):
            await self.pg.mouse.move(cx + dx * i / 22, cy + dy * i / 22)
            await self.pg.wait_for_timeout(9)
        await self.pg.mouse.up()
        await self.pg.wait_for_timeout(settle)
        # the gate is the usual reason a swipe appears to do nothing
        if await self.pg.locator(".gate-overlay").count():
            problems.append(f"{self.name}: hit the invite gate at {label}")
            log("   GATED at", label)
            return False
        after = await self.pg.locator(".card-title").first.inner_text()
        if before == after:
            problems.append(f"{self.name}: {label} did not change the card")
            log("   NO CHANGE", label)
            return False
        log("   ok", label, "->", after[:34])
        return True


async def onboarding(pw):
    """The introduction: welcome, the three taste questions, into the deck."""
    async with Scene(pw, "onboarding") as s:
        await s.open()
        log(" onboarding")
        await s.click(".ob-primary", expect=".ob-chips", label="Let's start", wait=1300)

        for label in ["Hindi", "English", "Punjabi"]:
            await s.click(f'.ob-chip:has-text("{label}")', label=f"language {label}", wait=520)
        await s.pg.wait_for_timeout(800)
        await s.click(".ob-primary", expect='.ob-chip:has-text("Hip-hop")', label="to genres", wait=1200)

        for label in ["Hip-hop & rap", "Dance & electronic", "Desi"]:
            await s.click(f'.ob-chip:has-text("{label}")', label=f"genre {label}", wait=520)
        await s.pg.wait_for_timeout(800)
        await s.click(".ob-primary", expect=".ob-choices", label="to adventure", wait=1200)

        await s.click('.ob-choice:has-text("A bit of both")', label="a bit of both", wait=1100)
        await s.click(".ob-primary", expect=".ob-step-wrap", label="into the tour", wait=1400)
        await s.click(".ob-skip", expect=".card", label="skip the tour", wait=3000)
        await s.pg.wait_for_timeout(2500)


async def deck(pw):
    """The three gestures an anonymous visitor gets, and the hook dots running.

    Swipe-down is deliberately absent: saving needs somewhere to save to, so the
    product gates it for a signed-out visitor. It gets its own scene rather than
    being fought.
    """
    async with Scene(pw, "swipe-deck") as s:
        await s.open()
        log(" deck")
        await s.click(".ob-skip", expect=".card", label="straight to the deck", wait=3200)
        # let a hook run so the segmented bar fills on camera
        await s.pg.wait_for_timeout(5600)
        await s.swipe_card(0, -260, "up  = skip")
        await s.pg.wait_for_timeout(1300)
        await s.swipe_card(260, 0, "right = more like this")
        await s.pg.wait_for_timeout(1300)
        await s.swipe_card(-260, 0, "left = never")
        await s.pg.wait_for_timeout(3000)


async def gate(pw):
    """Saving asks you in. The invite wall is the funnel, so film it on purpose."""
    async with Scene(pw, "gate") as s:
        await s.open()
        log(" gate")
        await s.click(".ob-skip", expect=".card", label="into the deck", wait=3000)
        await s.pg.wait_for_timeout(2600)
        box = await s.pg.locator(".card").first.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        await s.pg.mouse.move(cx, cy)
        await s.pg.mouse.down()
        for i in range(1, 23):
            await s.pg.mouse.move(cx, cy + 260 * i / 22)
            await s.pg.wait_for_timeout(9)
        await s.pg.mouse.up()
        try:
            await s.pg.locator(".gate-overlay").first.wait_for(state="visible", timeout=6000)
            log("   ok  save asks you in")
        except PWTimeout:
            problems.append("gate: the save wall never appeared")
            log("   MISS the save wall")
        await s.pg.wait_for_timeout(4200)


async def home(pw):
    """The home screen and its shelves."""
    async with Scene(pw, "home") as s:
        await s.open()
        log(" home")
        await s.click(".ob-skip", expect=".card", label="into the app", wait=2400)
        await s.click('.nav-btn:has-text("Home")', expect=".row-card", label="home", wait=2600)
        await s.pg.mouse.wheel(0, 300)
        await s.pg.wait_for_timeout(1800)
        await s.pg.mouse.wheel(0, 300)
        await s.pg.wait_for_timeout(2400)


async def settings(pw):
    """The replay rules — the part nobody else's music app has."""
    async with Scene(pw, "settings") as s:
        await s.open()
        log(" settings")
        await s.click(".ob-skip", expect=".card", label="into the app", wait=2400)
        # bury one so the buried-songs list has something real in it
        await s.swipe_card(-260, 0, "bury a song", settle=2000)
        await s.click('.nav-btn:has-text("Home")', expect=".row-card", label="home", wait=1800)
        await s.click('button[aria-label="Settings"]', expect=".settings-row", label="settings", wait=2400)
        await s.pg.mouse.wheel(0, 380)
        await s.pg.wait_for_timeout(2400)
        await s.pg.mouse.wheel(0, 380)
        await s.pg.wait_for_timeout(2800)


def encode(scene, name):
    """Scale to a 1080x1920 canvas. Fit to height — 1080 wide overflows."""
    d = os.path.join(RAW, scene)
    vids = [f for f in os.listdir(d) if f.endswith(".webm")] if os.path.isdir(d) else []
    if not vids:
        problems.append(f"{scene}: nothing recorded")
        return None
    src = os.path.join(d, sorted(vids)[-1])
    os.makedirs(CLIPS, exist_ok=True)
    out = os.path.join(CLIPS, name + ".mp4")
    trim = LEAD_IN.get(scene, 0.0)
    r = subprocess.run(
        ["ffmpeg", "-y", "-ss", f"{trim:.2f}", "-i", src, "-vf",
         "scale=-2:1920:flags=lanczos,pad=1080:1920:(ow-iw)/2:0:color=#08080C",
         "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        problems.append(f"{scene}: ffmpeg failed")
        log("   ffmpeg:", r.stderr[-300:])
        return None
    log(f"   {name}.mp4  {os.path.getsize(out)//1024} KB")
    return out


async def main():
    os.makedirs(RAW, exist_ok=True)
    async with async_playwright() as pw:
        await onboarding(pw)
        await deck(pw)
        await gate(pw)
        await home(pw)
        await settings(pw)

    log("\nencoding")
    made = []
    for scene, name in [
        ("onboarding", "01-onboarding-taste"),
        ("swipe-deck", "02-swipe-gestures"),
        ("gate", "03-save-asks-you-in"),
        ("home", "04-home"),
        ("settings", "05-replay-rules"),
    ]:
        out = encode(scene, name)
        if out:
            made.append(out)

    if made:
        listfile = os.path.join(CLIPS, "concat.txt")
        with open(listfile, "w", encoding="utf-8") as f:
            for m in made:
                f.write("file '" + m.replace("\\", "/") + "'\n")
        combined = os.path.join(OUT_DIR, "hooked-full-walkthrough.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
             "-c", "copy", "-movflags", "+faststart", combined],
            capture_output=True, text=True,
        )
        if os.path.exists(combined):
            log(f"\ncombined: {combined}  {os.path.getsize(combined)//1024} KB")

    if problems:
        log("\nPROBLEMS:")
        for p in problems:
            log("  -", p)
        sys.exit(1)
    log("\nall scenes filmed cleanly")


asyncio.run(main())
