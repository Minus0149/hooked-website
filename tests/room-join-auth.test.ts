import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Opening a room link cold (a friend pastes /together/<code>) ran joinRoom
 * before the Convex client had its auth token: "Unauthenticated", the guest
 * was never a member, and every Save in the room was refused. Found driving
 * two accounts on the dev deployment, 28 Oct 2026.
 */
describe("Play together: joining waits for sign-in", () => {
  const src = readFileSync("src/components/SocialScreens.tsx", "utf8");
  const room = src.slice(src.indexOf("export function RoomScreen"), src.indexOf("export function ShareToFollowers"));

  it("joins only once the backend is authenticated, and retries when it becomes so", () => {
    expect(room).toMatch(/useConvexAuth\(\)/);
    const effect = room.slice(room.indexOf("useEffect(() => {"), room.indexOf("}, [code, join, heartbeat, isAuthenticated]);"));
    expect(effect).toMatch(/if \(!isAuthenticated\) return;[\s\S]*join\(\{ code \}\)/);
    expect(room).toContain("}, [code, join, heartbeat, isAuthenticated]);");
  });

  it("tells a signed-out visitor to sign in instead of 'No room with that code'", () => {
    expect(room).toContain('tx("Sign in to join this room.")');
  });
});
