"""Film hooked. at 1080x1920, 60fps, with audio that actually lines up.

Three earlier approaches and why each failed:

  Playwright's video recorder captures at CSS pixels — 430x932 — whatever DPI
  the context is set to. Upscaling that to 1080 wide is what made the first
  takes blocky.

  Screenshots honour deviceScaleFactor, so 3x gave a crisp 1290x2796, but only
  at ~10.6fps. Worse, they were assembled at an assumed 16fps, so every clip
  played back half again too fast and no soundtrack could ever line up with it.
  The sync problem was in the video the whole time.

  CDP screencast is fast — 85fps measured — but also captures at CSS pixels.

The way through is to make the CSS viewport 1080x1920 and scale the page with
`zoom`, so one CSS pixel is one output pixel. The layout still behaves like a
phone, the screencast runs well past 60fps, and every frame arrives stamped
with an epoch timestamp.

That shared clock is what fixes the audio. The page records what the player
does using Date.now(); frames carry Network.TimeSinceEpoch. Both are epoch
seconds, so a segment is placed against the frames it belongs to instead of
against a guess.

One caveat worth knowing: at a 1080px CSS viewport, phone `max-width` media
queries do not match, so any mobile-only rule is inactive while filming. Every
screen here is a centred column regardless, which is why it still looks right.

This machine also reports prefers-reduced-motion: reduce in every browser, so
contexts override it — otherwise the card physics and the segmented dots, the
whole point of the footage, are switched off.
"""
import asyncio, base64, json, os, shutil, subprocess, sys, urllib.request
from playwright.async_api import async_playwright, TimeoutError as PWTimeout

OUT_DIR = r"F:\Videos\Insta\2nd Reel (Hooked)"
CLIPS = os.path.join(OUT_DIR, "clips")
RAW = os.path.join(OUT_DIR, "raw")
URL = "http://localhost:4322/"

# 1920/932 keeps a phone's vertical room. The effective viewport lands at
# 524x932 — wider than an iPhone, still unambiguously a mobile layout, and it
# fills the frame with no letterboxing.
VIEW = {"width": 1080, "height": 1920}
ZOOM = 2.0601
FPS = 60

problems = []


def log(*p):
    print(" ".join(str(x) for x in p).encode("ascii", "replace").decode(), flush=True)


# Fixes the layout at output resolution, and makes the player report what it is
# doing on the same clock the frames are stamped with.
BOOT = """
(() => {
  const style = document.createElement('style');
  style.textContent = ':root { zoom: %f; }';
  const add = () => document.head && document.head.appendChild(style);
  if (document.head) add(); else document.addEventListener('DOMContentLoaded', add);

  localStorage.removeItem('hooked.onboarded');
  localStorage.removeItem('hooked.library.v2');
  localStorage.removeItem('hooked.anonSwipes.v1');

  // Every Audio the player builds, reporting itself. Polling five times a
  // second put segment boundaries out by up to 200ms; an event fires when the
  // thing actually happens.
  const Real = window.Audio;
  window.__log = [];
  const note = (el, type) => window.__log.push({
    t: Date.now() / 1000, type, src: el.src || '', at: el.currentTime || 0,
  });
  const Wrapped = function (...args) {
    const el = new Real(...args);
    window.__played = window.__played || [];
    window.__played.push(el);
    for (const type of ['play', 'playing', 'pause', 'ended', 'seeked', 'emptied']) {
      el.addEventListener(type, () => note(el, type));
    }
    // a coarse heartbeat, so a long stretch of playback has interior points
    el.addEventListener('timeupdate', () => {
      const last = window.__log[window.__log.length - 1];
      if (!last || last.t < Date.now() / 1000 - 0.5) note(el, 'tick');
    });
    return el;
  };
  Wrapped.prototype = Real.prototype;
  window.Audio = Wrapped;
})();
""" % ZOOM


class Scene:
    """One clip: a browser, a screencast, and a log of what was playing."""

    def __init__(self, pw, name):
        self.pw = pw
        self.name = name
        self.dir = os.path.join(RAW, name)
        self.frames = []
        self.rolling_now = False

    async def __aenter__(self):
        shutil.rmtree(self.dir, ignore_errors=True)
        os.makedirs(self.dir, exist_ok=True)
        self.browser = await self.pw.chromium.launch(
            channel="msedge", args=["--autoplay-policy=no-user-gesture-required"]
        )
        self.ctx = await self.browser.new_context(
            viewport=VIEW,
            device_scale_factor=1,
            is_mobile=True,
            has_touch=True,
            reduced_motion="no-preference",
        )
        await self.ctx.add_init_script(BOOT)
        self.pg = await self.ctx.new_page()
        self.cdp = await self.ctx.new_cdp_session(self.pg)
        return self

    async def __aexit__(self, *exc):
        await self.stop()
        try:
            await self.ctx.close()
        except Exception:
            pass
        await self.browser.close()

    # --------------------------------------------------------------- capture

    def _on_frame(self, payload):
        if self.rolling_now:
            i = len(self.frames)
            path = os.path.join(self.dir, f"{i:05d}.jpg")
            with open(path, "wb") as f:
                f.write(base64.b64decode(payload["data"]))
            self.frames.append(payload["metadata"]["timestamp"])
        asyncio.ensure_future(self._ack(payload))

    async def _ack(self, payload):
        try:
            await self.cdp.send(
                "Page.screencastFrameAck", {"sessionId": payload["sessionId"]}
            )
        except Exception:
            pass

    async def open(self):
        await self.pg.goto(URL, wait_until="domcontentloaded")
        await self.pg.wait_for_timeout(2600)

    async def rolling(self, on_audio=False, timeout=9000):
        """Start filming, optionally once a preview is genuinely playing."""
        if on_audio:
            waited = 0
            while waited < timeout:
                playing = await self.pg.evaluate(
                    "() => (window.__played || []).some((a) => a.src && !a.paused && a.currentTime > 0.1)"
                )
                if playing:
                    break
                await self.pg.wait_for_timeout(120)
                waited += 120
        self.cdp.on("Page.screencastFrame", self._on_frame)
        await self.cdp.send(
            "Page.startScreencast",
            {"format": "jpeg", "quality": 92, "maxWidth": VIEW["width"],
             "maxHeight": VIEW["height"], "everyNthFrame": 1},
        )
        self.rolling_now = True
        await self.pg.wait_for_timeout(400)

    async def stop(self):
        if not self.rolling_now:
            return
        self.rolling_now = False
        try:
            await self.cdp.send("Page.stopScreencast")
        except Exception:
            pass
        try:
            events = await self.pg.evaluate("() => window.__log || []")
        except Exception:
            events = []
        with open(os.path.join(self.dir, "audio.json"), "w", encoding="utf-8") as f:
            json.dump(events, f)
        with open(os.path.join(self.dir, "frames.json"), "w", encoding="utf-8") as f:
            json.dump(self.frames, f)

    # ------------------------------------------------------------------ acts

    async def click(self, selector, expect=None, label=None, wait=900):
        """Click, then prove the screen moved. Never reports a silent no-op."""
        what = label or selector
        try:
            el = self.pg.locator(selector).first
            await el.wait_for(state="visible", timeout=7000)
            await el.click()
        except PWTimeout:
            problems.append(f"{self.name}: never found {what}")
            log("   MISS", what)
            return False
        if expect:
            try:
                await self.pg.locator(expect).first.wait_for(state="visible", timeout=7000)
            except PWTimeout:
                problems.append(f"{self.name}: clicked {what} but {expect} never appeared")
                log("   STUCK after", what)
                return False
        await self.pg.wait_for_timeout(wait)
        log("   ok", what)
        return True

    async def swipe(self, dx, dy, label, settle=2000, expect_gate=False):
        """A flick. At 60fps it is captured properly, so it can be quick."""
        box = await self.pg.locator(".card").first.bounding_box()
        if not box:
            problems.append(f"{self.name}: no card to swipe")
            return False
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        before = await self.pg.locator(".card-title").first.inner_text()
        await self.pg.mouse.move(cx, cy)
        await self.pg.mouse.down()
        for i in range(1, 13):
            await self.pg.mouse.move(cx + dx * i / 12, cy + dy * i / 12)
            await self.pg.wait_for_timeout(12)
        await self.pg.mouse.up()
        await self.pg.wait_for_timeout(settle)

        gated = await self.pg.locator(".gate-overlay").count() > 0
        if expect_gate:
            if gated:
                log("   ok", label)
                return True
            problems.append(f"{self.name}: the save wall never appeared")
            log("   MISS the save wall")
            return False
        if gated:
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


# ------------------------------------------------------------------- scenes

async def onboarding(pw):
    """The introduction: welcome, the three taste questions, into the deck."""
    async with Scene(pw, "onboarding") as s:
        await s.open()
        await s.rolling()
        log(" onboarding")
        await s.click(".ob-primary", expect=".ob-chips", label="Let's start", wait=1200)
        for label in ["Hindi", "English", "Punjabi"]:
            await s.click(f'.ob-chip:has-text("{label}")', label=f"language {label}", wait=520)
        await s.pg.wait_for_timeout(700)
        await s.click(".ob-primary", expect='.ob-chip:has-text("Hip-hop")', label="to genres", wait=1100)
        for label in ["Hip-hop & rap", "Dance & electronic", "Desi"]:
            await s.click(f'.ob-chip:has-text("{label}")', label=f"genre {label}", wait=520)
        await s.pg.wait_for_timeout(700)
        await s.click(".ob-primary", expect=".ob-choices", label="to adventure", wait=1100)
        await s.click('.ob-choice:has-text("A bit of both")', label="a bit of both", wait=1100)
        await s.click(".ob-primary", expect=".ob-step-wrap", label="into the tour", wait=1300)
        await s.click(".ob-skip", expect=".card", label="skip the tour", wait=3400)


async def deck(pw):
    """The three gestures an anonymous visitor gets, with a hook playing.

    Swipe-down is absent on purpose: saving needs somewhere to save to, so the
    product gates it for a signed-out visitor. It gets its own scene.
    """
    async with Scene(pw, "swipe-deck") as s:
        await s.open()
        await s.click(".ob-skip", expect=".card", label="into the deck", wait=2400)
        await s.rolling(on_audio=True)
        log(" deck")
        await s.pg.wait_for_timeout(3600)
        await s.swipe(0, -300, "up  = skip")
        await s.pg.wait_for_timeout(1400)
        await s.swipe(300, 0, "right = more like this")
        await s.pg.wait_for_timeout(1400)
        await s.swipe(-300, 0, "left = never")
        await s.pg.wait_for_timeout(2600)


async def gate(pw):
    """Saving asks you in. The invite wall is the funnel, so film it."""
    async with Scene(pw, "gate") as s:
        await s.open()
        await s.click(".ob-skip", expect=".card", label="into the deck", wait=2400)
        await s.rolling(on_audio=True)
        log(" gate")
        await s.pg.wait_for_timeout(2400)
        await s.swipe(0, 300, "save asks you in", settle=1200, expect_gate=True)
        await s.pg.wait_for_timeout(3600)


async def home(pw):
    """The home screen and its shelves."""
    async with Scene(pw, "home") as s:
        await s.open()
        await s.click(".ob-skip", expect=".card", label="into the app", wait=2200)
        await s.rolling(on_audio=True)
        log(" home")
        await s.pg.wait_for_timeout(1400)
        await s.click('.nav-btn:has-text("Home")', expect=".row-card", label="home", wait=2400)
        for _ in range(4):
            await s.pg.mouse.wheel(0, 150)
            await s.pg.wait_for_timeout(1200)
        await s.pg.wait_for_timeout(1800)


async def settings(pw):
    """The replay rules — the part nobody else's music app has."""
    async with Scene(pw, "settings") as s:
        await s.open()
        await s.click(".ob-skip", expect=".card", label="into the app", wait=2200)
        await s.rolling(on_audio=True)
        log(" settings")
        await s.swipe(-300, 0, "bury a song", settle=2000)
        await s.click('.nav-btn:has-text("Home")', expect=".row-card", label="home", wait=1600)
        await s.click('button[aria-label="Settings"]', expect=".settings-row", label="settings", wait=2200)
        for _ in range(3):
            await s.pg.mouse.wheel(0, 190)
            await s.pg.wait_for_timeout(1300)
        await s.pg.wait_for_timeout(1800)


# -------------------------------------------------------------------- audio

def preview_cache(url, name):
    cache = os.path.join(RAW, "_previews")
    os.makedirs(cache, exist_ok=True)
    path = os.path.join(cache, name)
    if not os.path.exists(path):
        try:
            urllib.request.urlretrieve(url, path)
        except Exception:
            return None
    return path


def bed_file():
    """The preview used as a bed — from the catalogue the app ships."""
    here = os.path.dirname(os.path.abspath(__file__))
    catalog = os.path.join(os.path.dirname(here), "src", "data", "catalog.json")
    try:
        with open(catalog, encoding="utf-8") as f:
            url = json.load(f)[0]["previewUrl"]
    except Exception:
        return None
    return preview_cache(url, "bed.m4a")


def build_audio(scene, first_frame, span):
    """Rebuild the soundtrack against the frames' own clock.

    Events and frames are both stamped in epoch seconds, so a segment lands
    where it actually happened rather than where a 200ms poll guessed.
    """
    d = os.path.join(RAW, scene)
    log_path = os.path.join(d, "audio.json")
    if not os.path.exists(log_path):
        return None
    with open(log_path, encoding="utf-8") as f:
        events = json.load(f)

    segments = []
    for e in events:
        rel = e["t"] - first_frame
        if e["type"] in ("play", "playing", "seeked", "tick"):
            last = segments[-1] if segments else None
            if (last and last["src"] == e["src"] and rel - last["end"] < 1.2
                    and e["at"] >= last["at"] - 0.5):
                last["end"] = rel
                last["at"] = e["at"]
            else:
                segments.append({"src": e["src"], "start": rel, "end": rel,
                                 "from": e["at"], "at": e["at"]})
        elif e["type"] in ("pause", "ended", "emptied") and segments:
            segments[-1]["end"] = rel

    segments = [s for s in segments if s["src"] and s["end"] > 0]
    for s in segments:
        if s["start"] < 0:                       # playing before filming began
            s["from"] += -s["start"]
            s["start"] = 0.0
        s["end"] = min(s["end"], span)
    segments = [s for s in segments if s["end"] - s["start"] > 0.5]

    parts, filters, labels = [], [], []
    src = bed_file()
    if src:
        # a quiet bed the whole way, because onboarding plays nothing at all
        parts += ["-stream_loop", "-1", "-t", f"{span:.2f}", "-i", src]
        filters.append(
            f"[0:a]volume=-12dB,afade=t=in:st=0:d=0.8,"
            f"afade=t=out:st={max(span - 1.4, 0):.2f}:d=1.4[bed]"
        )
        labels.append("[bed]")

    for seg in segments:
        path = preview_cache(seg["src"], str(abs(hash(seg["src"]))) + ".m4a")
        if not path:
            continue
        dur = max(seg["end"] - seg["start"], 0.4)
        idx = len(labels)
        parts += ["-ss", f"{max(seg['from'], 0):.2f}", "-t", f"{dur:.2f}", "-i", path]
        filters.append(
            f"[{idx}:a]afade=t=in:st=0:d=0.22,"
            f"afade=t=out:st={max(dur - 0.3, 0):.2f}:d=0.3,"
            f"adelay={int(seg['start'] * 1000)}|{int(seg['start'] * 1000)}[a{idx}]"
        )
        labels.append(f"[a{idx}]")

    if not labels:
        return None
    out = os.path.join(d, "audio.m4a")
    chain = ";".join(filters) + ";" + "".join(labels) + \
        f"amix=inputs={len(labels)}:dropout_transition=0:normalize=0[out]"
    r = subprocess.run(
        ["ffmpeg", "-y", *parts, "-filter_complex", chain, "-map", "[out]",
         "-c:a", "aac", "-b:a", "192k", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        log("   audio failed:", r.stderr[-300:])
        return None
    log(f"   audio: {len(segments)} segment(s) + bed across {span:.1f}s")
    return out


# ------------------------------------------------------------------- encode

def encode(scene, name):
    d = os.path.join(RAW, scene)
    shots = sorted(f for f in os.listdir(d) if f.endswith(".jpg")) if os.path.isdir(d) else []
    tpath = os.path.join(d, "frames.json")
    if len(shots) < 12 or not os.path.exists(tpath):
        problems.append(f"{scene}: only {len(shots)} frames captured")
        return None
    with open(tpath, encoding="utf-8") as f:
        times = json.load(f)
    n = min(len(shots), len(times))
    shots, times = shots[:n], times[:n]
    span = times[-1] - times[0]
    log(f"   {n} frames over {span:.1f}s = {n / max(span, 0.01):.0f}fps captured")

    listfile = os.path.join(d, "frames.txt")
    with open(listfile, "w", encoding="utf-8") as f:
        for i, shot in enumerate(shots):
            hold = (times[i + 1] - times[i]) if i + 1 < n else 1 / FPS
            f.write("file '" + os.path.join(d, shot).replace(chr(92), "/") + "'" + chr(10))
            f.write("duration " + format(max(hold, 0.002), ".5f") + chr(10))
        f.write("file '" + os.path.join(d, shots[-1]).replace(chr(92), "/") + "'" + chr(10))

    audio = build_audio(scene, times[0], span)
    extra = ["-i", audio] if audio else []
    # -14 LUFS / -1.5dBTP is what Instagram targets, so its own re-encode has
    # headroom rather than clipping what summing the segments pushed to 0dBFS
    tail = (["-af", "loudnorm=I=-14:TP=-1.5:LRA=11", "-c:a", "aac", "-b:a", "192k", "-shortest"]
            if audio else ["-an"])

    os.makedirs(CLIPS, exist_ok=True)
    out = os.path.join(CLIPS, name + ".mp4")
    r = subprocess.run(
        ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile, *extra,
         "-vf", f"fps={FPS},format=yuv420p",
         "-c:v", "libx264", "-preset", "slow", "-crf", "18",
         "-x264-params", f"keyint={FPS * 2}:min-keyint={FPS}",
         *tail, "-movflags", "+faststart", out],
        capture_output=True, text=True,
    )
    if r.returncode != 0:
        problems.append(f"{scene}: ffmpeg failed")
        log("   ffmpeg:", r.stderr[-400:])
        return None
    log(f"   {name}.mp4  {os.path.getsize(out) // 1024} KB")
    return out


async def main():
    os.makedirs(RAW, exist_ok=True)
    async with async_playwright() as pw:
        for fn in (onboarding, deck, gate, home, settings):
            await fn(pw)

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
                f.write("file '" + m.replace(chr(92), "/") + "'" + chr(10))
        combined = os.path.join(OUT_DIR, "hooked-full-walkthrough.mp4")
        subprocess.run(
            ["ffmpeg", "-y", "-f", "concat", "-safe", "0", "-i", listfile,
             "-c", "copy", "-movflags", "+faststart", combined],
            capture_output=True, text=True,
        )
        if os.path.exists(combined):
            log(f"\ncombined: {os.path.getsize(combined) // 1024} KB")

    if problems:
        log("\nPROBLEMS:")
        for p in problems:
            log("  -", p)
        sys.exit(1)
    log("\nall scenes filmed cleanly")


asyncio.run(main())
