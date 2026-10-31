import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COPYRIGHT_EMAIL_LIMITS, copyrightSubject } from "../convex/contentReports";

/**
 * Copyright reports mail copyright@hookedcue.com. Device keys are free to mint,
 * so anyone could send up to 300 of those an hour, each with their own words
 * (a title or artist of their choosing) in the subject line. Now: only songs we
 * have, nothing typed in the subject, and at most 20 an hour, 3 per reporter.
 */
const src = readFileSync(resolve(__dirname, "..", "convex", "contentReports.ts"), "utf8");
const submit = src.slice(src.indexOf("export const submit = "), src.indexOf("export type ReportGroup"));

describe("copyright report emails", () => {
  it("the subject is the kind and a cleaned id, nothing anyone typed", () => {
    expect(copyrightSubject("1640463908")).toBe("Copyright report: track 1640463908");
    expect(copyrightSubject("own:u1:abc")).toBe("Copyright report: track own:u1:abc");
    expect(copyrightSubject("x\r\nBcc: a@b.c <b>FREE</b>")).toBe("Copyright report: track xBcc:ab.cbFREEb");
    expect(copyrightSubject("")).toBe("Copyright report: track unknown");
    expect(submit).toMatch(/subject: copyrightSubject\(trackId\)/);
    expect(submit).not.toMatch(/subject: `/);
  });

  it("is capped low: 20 an hour in all, 3 per reporter, checked per reporter first", () => {
    expect(COPYRIGHT_EMAIL_LIMITS).toEqual({ global: 20, perReporter: 3 });
    const mayEmail = src.slice(src.indexOf("async function mayEmail"), src.indexOf("export type ReportGroup"));
    expect(mayEmail.indexOf("report:mail:${reporter}")).toBeLessThan(mayEmail.indexOf('"report:mail:global"'));
    expect(mayEmail).toMatch(/catch \{\s*return false;/);
    expect(submit).toMatch(/args\.reason === "copyright" && \(await mayEmail\(ctx, reporter\)\)/);
  });

  it("only for a song we have, with our title and artist", () => {
    expect(submit).toMatch(/const song = await resolveSong\(ctx, trackId\);\s*if \(!song\) return/);
    expect(submit).toMatch(/const \{ title, artist \} = song\.track;/);
    expect(submit).not.toMatch(/cleanText\(args\.title/);
    expect(submit.indexOf("resolveSong")).toBeLessThan(submit.indexOf('insert("contentReports"'));
  });

  it("the shared report ceiling binds device keys only, so accounts can always report", () => {
    expect(submit).toMatch(/if \(reporter\.startsWith\("anon:"\)\) await enforceRateLimit\(ctx, "report:global"/);
  });
});
