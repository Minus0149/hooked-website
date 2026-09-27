import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The release bundle was 73 MB. Play sends each device only its own native
 * code, so what matters is not shipping code no device needs: 32-bit x86 is
 * gone. x86_64 stays — an ARM-only bundle crashes at launch on x86_64 devices
 * that translate ARM (SoLoader looks for lib/x86_64 inside the ARM split),
 * seen on the emulator 2026-09-28, and Play would still offer them the app.
 */
describe("the Android release build", () => {
  it("carries native code for ARM phones and x86_64, not 32-bit x86", () => {
    const plugins = JSON.parse(readFileSync("../mobile/app.json", "utf8")).expo.plugins as unknown[];
    const props = plugins.find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as [string, { android: { buildArchs: string[] } }];
    expect(props).toBeDefined();
    expect(props[1].android.buildArchs).toEqual(["armeabi-v7a", "arm64-v8a", "x86_64"]);
  });

  it("shrinks code with R8 and keeps the map Play needs to read crashes", () => {
    const plugins = JSON.parse(readFileSync("../mobile/app.json", "utf8")).expo.plugins as unknown[];
    const props = plugins.find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as [string, { android: Record<string, unknown> }];
    expect(props[1].android.enableMinifyInReleaseBuilds).toBe(true);
    expect(props[1].android.enableShrinkResourcesInReleaseBuilds).toBe(true);
    expect(readFileSync("../mobile/scripts/build-release-aab.ps1", "utf8")).toContain("hooked-release-mapping.txt");
  });
});
