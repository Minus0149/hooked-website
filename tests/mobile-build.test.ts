import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The release bundle was 73 MB: 14 MB of it was x86/x86_64 native code that
 * only emulators run, plus their share of the debug symbols. Phones are ARM.
 */
describe("the Android release build", () => {
  it("carries native code for ARM phones only", () => {
    const plugins = JSON.parse(readFileSync("../mobile/app.json", "utf8")).expo.plugins as unknown[];
    const props = plugins.find((p) => Array.isArray(p) && p[0] === "expo-build-properties") as [string, { android: { buildArchs: string[] } }];
    expect(props).toBeDefined();
    expect(props[1].android.buildArchs).toEqual(["armeabi-v7a", "arm64-v8a"]);
  });
});
