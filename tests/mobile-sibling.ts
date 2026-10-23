import { existsSync } from "node:fs";

// The phone app lives beside this repo on Minus's machine (hooked/mobile), but
// the GitHub repo that CI checks out is web/ alone. Tests that read the phone
// app's files run where it exists and skip in CI instead of failing the build
// (which stopped every deploy from 27 Sep 2026 to 23 Oct 2026).
// HOOKED_NO_MOBILE=1 simulates CI locally.
export const HAS_MOBILE = !process.env.HOOKED_NO_MOBILE && existsSync("../mobile/app.json");
