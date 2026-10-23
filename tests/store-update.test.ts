import { describe, expect, it } from "vitest";
import { HAS_MOBILE } from "./mobile-sibling";

// Loaded only where the phone app exists (see mobile-sibling.ts).
const MOBILE_LIB = new URL("../../mobile/src/lib/storeUpdate.ts", import.meta.url).href;
const { storeUpdateAction } = HAS_MOBILE
  ? ((await import(/* @vite-ignore */ MOBILE_LIB)) as typeof import("../../mobile/src/lib/storeUpdate"))
  : { storeUpdateAction: () => "" };

/**
 * Store builds carry what over-the-air updates can't (native code). A newer
 * build is offered; one below the admin's minimum is required (Minus,
 * 2026-09-28: updates "shown in app or auto update").
 */
describe.skipIf(!HAS_MOBILE)("a newer build on Google Play", () => {
  it("is offered, not forced, by default", () => {
    expect(storeUpdateAction({ available: true, installed: 5, minVersionCode: 0 })).toBe("offer");
  });

  it("is required when the installed build is below the admin's minimum", () => {
    expect(storeUpdateAction({ available: true, installed: 4, minVersionCode: 5, immediateAllowed: true })).toBe("force");
    // at or above the minimum it is just an offer
    expect(storeUpdateAction({ available: true, installed: 5, minVersionCode: 5 })).toBe("offer");
  });

  it("falls back to offering when Play can't run the blocking flow", () => {
    expect(storeUpdateAction({ available: true, installed: 4, minVersionCode: 5, immediateAllowed: false, flexibleAllowed: true })).toBe("offer");
  });

  it("does nothing when there is no update, or Play allows neither flow", () => {
    expect(storeUpdateAction({ available: false, installed: 4, minVersionCode: 9 })).toBe("none");
    expect(storeUpdateAction({ available: true, installed: 5, minVersionCode: 0, immediateAllowed: false, flexibleAllowed: false })).toBe("none");
  });

  it("never forces when it can't tell which build is installed", () => {
    expect(storeUpdateAction({ available: true, installed: null, minVersionCode: 99 })).toBe("offer");
  });
});
