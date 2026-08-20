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
import asyncio, json, os, shutil, subprocess, sys, time, urllib.request
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

OUT_DIR = r"F:\Videos\Insta\2nd Reel (Hooked)"
CLIPS = os.path.join(OUT_DIR, "clips")
RAW = os.path.join(OUT_DIR, "raw")
URL = "http://localhost:4322/"
VIEW = {"width": 430, "height": 932}
# Playwright's video recorder and the CDP screencast both capture at CSS pixels
# — 430x932 here — whatever DPI the context is set to, and scaling that up to
# 1080x1920 is what made the first takes blocky. A screenshot honours
# deviceScaleFactor, so 3x captures 1290x2796 and delivery is a downscale.
#
# The trade is rate: ~16fps at 3x, ~8fps at 5x. So motion is slow and
# deliberate rather than fast and stuttering. 4K is deliberately not attempted:
# Instagram re-encodes Reels to 1080x1920, so it would be discarded, and the
# frame rate needed to reach it judders.
DSF = 3
FPS = 30
JPEG_QUALITY = 94

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
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir, exist_ok=True)
        self.browser = await self.pw.chromium.launch(
            channel="msedge", args=["--autoplay-policy=no-user-gesture-required"]
        )
        self.ctx = await self.browser.new_context(
            viewport=VIEW,
            device_scale_factor=DSF,
            is_mobile=True,
            has_touch=True,
            reduced_motion="no-preference",
        )
        self.pg = await self.ctx.new_page()
        # capture starts only once the app is up, so there is no boot dead air
        self.grabbing = False
        return self

    async def __aexit__(self, *exc):
        await self.stop()
        await self.ctx.close()
        await self.browser.close()

    async def _watch(self):
        """Poll what is playing, so the soundtrack can be rebuilt in sync."""
        while self.grabbing:
            try:
                state = await self.pg.evaluate(
                    """() => (window.__played || [])
                         .filter((a) => a.src && !a.paused && !a.ended)
                         .map((a) => ({ src: a.src, t: a.currentTime }))[0] || null"""
                )
            except Exception:
                break
            self.audio.append((time.monotonic() - self.t0, state))
            await asyncio.sleep(0.2)

    async def _grab(self):
        """Screenshot as fast as the browser will allow, in the background."""
        i = 0
        while self.grabbing:
            try:
                shot = await self.pg.screenshot(type="jpeg", quality=JPEG_QUALITY)
            except Exception:
                break  # page closing under us
            with open(os.path.join(self.dir, f"{i:05d}.jpg"), "wb") as f:
                f.write(shot)
            i += 1

    async def start(self):
        self.grabbing = True
        self.t0 = time.monotonic()
        self.audio = []
        self.task = asyncio.ensure_future(self._grab())
        self.watch = asyncio.ensure_future(self._watch())

    async def stop(self):
        if not self.grabbing:
            return
        self.grabbing = False
        for t in (self.task, getattr(self, "watch", None)):
            if t is None:
                continue
            try:
                await asyncio.wait_for(t, timeout=6)
            except Exception:
                pass
        # hand the playback log to the encoder
        with open(os.path.join(self.dir, "audio.json"), "w", encoding="utf-8") as f:
            json.dump(self.audio, f)

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
        # Keep a handle on every Audio the player builds.
        #
        # The soundtrack is rebuilt from the same preview files afterwards
        # rather than captured off the sound card: loopback would mean routing
        # this machine's default output through VB-Cable, and its audio runs
        # through a Voicemeeter setup used for real work. Reconstruction is
        # also simply better — no other app's notifications, no resampling,
        # and the exact position the player was at.
        await self.pg.add_init_script("""
            (() => {
              const Real = window.Audio;
              window.__played = [];
              const Wrapped = function (...args) {
                const el = new Real(...args);
                window.__played.push(el);
                return el;
              };
              Wrapped.prototype = Real.prototype;
              window.Audio = Wrapped;
            })();
        """)
        await self.pg.goto(URL, wait_until="domcontentloaded")
        await self.pg.wait_for_timeout(2600)
        await self.start()
        await self.pg.wait_for_timeout(900)

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
        # a flick, not a drag — a real swipe is fast and the video should look
        # like one, even though 16fps only catches a few frames of it
        for i in range(1, 11):
            await self.pg.mouse.move(cx + dx * i / 10, cy + dy * i / 10)
            await self.pg.wait_for_timeout(14)
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
        for i in range(1, 11):
            await s.pg.mouse.move(cx, cy + 260 * i / 10)
            await s.pg.wait_for_timeout(14)
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


def build_audio(scene):
    """Rebuild what was playing, from the same preview files.

    The watcher sampled (video time, src, position-in-track) five times a
    second. Contiguous samples of one src become one segment: take that slice
    of the preview and lay it at the video time it started. Gaps stay silent,
    which is honest — nothing was playing there either.
    """
    d = os.path.join(RAW, scene)
    log_path = os.path.join(d, "audio.json")
    if not os.path.exists(log_path):
        return None
    with open(log_path, encoding="utf-8") as f:
        samples = json.load(f)

    segments = []
    for at, state in samples:
        if not state:
            continue
        src, pos = state["src"], state["t"]
        last = segments[-1] if segments else None
        # same file and time still moving forward -> the same segment
        if last and last["src"] == src and pos >= last["pos"] - 0.5:
            last["end"] = at
            last["pos"] = pos
        else:
            segments.append({"src": src, "start": at, "end": at, "from": pos, "pos": pos})
    segments = [s for s in segments if s["end"] - s["start"] > 0.6]
    if not segments:
        return None

    cache = os.path.join(RAW, "_previews")
    os.makedirs(cache, exist_ok=True)
    parts, filters, labels = [], [], []
    for i, seg in enumerate(segments):
        name = str(abs(hash(seg["src"]))) + ".m4a"
        path = os.path.join(cache, name)
        if not os.path.exists(path):
            try:
                urllib.request.urlretrieve(seg["src"], path)
            except Exception:
                continue
        dur = seg["end"] - seg["start"]
        parts += ["-ss", f"{max(seg['from'] - 0.15, 0):.2f}", "-t", f"{dur:.2f}", "-i", path]
        # a short fade each end so a cut never clicks
        filters.append(
            f"[{len(labels)}:a]afade=t=in:st=0:d=0.25,"
            f"afade=t=out:st={max(dur - 0.35, 0):.2f}:d=0.35,"
            f"adelay={int(seg['start'] * 1000)}|{int(seg['start'] * 1000)}[a{len(labels)}]"
        )
        labels.append(f"[a{len(labels)}]")
    if not labels:
        return None

    out = os.path.join(d, "audio.m4a")
    chain = ";".join(filters) + ";" + "".join(labels) + f"amix=inputs={len(labels)}:dropout_transition=0:normalize=0[out]"
    r = subprocess.run(
        ["ffmpeg", "-y", *parts, "-filter_complex", chain, "-map", "[out]",
         "-c:a", "aac", "-b:a", "192k", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        log("   audio:", r.stderr[-300:])
        return None
    log(f"   audio: {len(segments)} segment(s)")
    return out


def encode(scene, name):
    """Assemble the captured frames and downscale 1290x2796 -> 1080x1920."""
    d = os.path.join(RAW, scene)
    shots = sorted(f for f in os.listdir(d) if f.endswith(".jpg")) if os.path.isdir(d) else []
    if len(shots) < 8:
        problems.append(f"{scene}: only {len(shots)} frames captured")
        return None
    os.makedirs(CLIPS, exist_ok=True)
    out = os.path.join(CLIPS, name + ".mp4")
    audio = build_audio(scene)
    extra = ["-i", audio] if audio else []
    # Summing segments with normalize=0 pushed peaks to 0dBFS — audible as
    # crunch on the loud parts. loudnorm brings it to the -14 LUFS / -1.5dBTP
    # that Instagram targets anyway, so the platform re-encode has headroom
    # instead of clipping further.
    tail = (
        ["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-shortest"]
        if audio
        else ["-an"]
    )
    r = subprocess.run(
        ["ffmpeg", "-y", "-framerate", "16", "-i", os.path.join(d, "%05d.jpg"), *extra,
         # fit to HEIGHT: the phone is 430:932, narrower than 9:16, so scaling
         # to 1080 wide overflows 1920 and the pad filter rejects it
         "-vf", f"fps={FPS},scale=-2:1920:flags=lanczos,"
                "pad=1080:1920:(ow-iw)/2:0:color=#08080C",
         # visually lossless for flat UI colour
         "-c:v", "libx264", "-preset", "slow", "-crf", "16",
         "-pix_fmt", "yuv420p", *tail, "-movflags", "+faststart", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        problems.append(f"{scene}: ffmpeg failed")
        log("   ffmpeg:", r.stderr[-300:])
        return None
    log(f"   {name}.mp4  {os.path.getsize(out)//1024} KB  ({len(shots)} frames)")
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
