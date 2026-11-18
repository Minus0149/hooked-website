import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { backendDown, looksLikeServerError } from "../src/lib/backendHealth";
import { Maintenance } from "../src/components/AppErrorBoundary";

/**
 * Nov 2026: Convex switched the deployment off and every visitor got the crash
 * screen with a raw "[CONVEX Q(library:getLibrary)] Server Error". When the
 * whole backend is down the app now shows a calm maintenance screen instead,
 * and opens itself again once the backend answers.
 */
const reply = (body: unknown, status = 200) =>
  Promise.resolve(new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));

describe("telling an outage from a bug", () => {
  it("recognises Convex's generic server error", () => {
    expect(looksLikeServerError("[CONVEX Q(library:getLibrary)] [Request ID: 4cf37c5ef6db9610] Server Error")).toBe(true);
    expect(looksLikeServerError("Cannot read properties of undefined (reading 'title')")).toBe(false);
  });

  it("calls the backend up when the catalogue version answers", async () => {
    let asked = "";
    const down = await backendDown("https://x.convex.cloud/", (url, init) => {
      asked = `${url} ${String(init?.body)}`;
      return reply({ status: "success", value: { v: 3, parts: 2 } });
    });
    expect(down).toBe(false);
    expect(asked).toBe('https://x.convex.cloud/api/query {"path":"catalog:version","args":{},"format":"json"}');
  });

  it("calls the backend down when even the catalogue version fails", async () => {
    expect(await backendDown("https://x.convex.cloud", () => reply({ status: "error", errorMessage: "[Request ID: b6ff] Server Error" }))).toBe(true);
    expect(await backendDown("https://x.convex.cloud", () => reply({}, 503))).toBe(true);
    expect(await backendDown("https://x.convex.cloud", () => Promise.reject(new TypeError("Failed to fetch")))).toBe(true);
  });
});

describe("the maintenance screen", () => {
  const html = renderToStaticMarkup(<Maintenance convexUrl="https://x.convex.cloud" />);

  it("says it's temporary and that saves are safe, with no error text", () => {
    expect(html).toContain("Back in a little while");
    expect(html).toContain("Your saved songs are safe");
    expect(html).toContain("Try now");
    expect(html).not.toMatch(/Server Error|Something broke|not ready yet/);
  });

  it("has no em dashes in its copy", () => {
    expect(html).not.toContain("—");
  });
});
