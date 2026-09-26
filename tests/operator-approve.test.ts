import { describe, expect, it } from "vitest";
import { operatorEmails } from "../convex/access";

/**
 * access:approve lets the operator pre-approve the Play reviewer and the
 * closed-test testers from the command line. The list it receives is pasted by
 * hand, so it has to survive capitals, spaces, repeats and typos.
 */
describe("operatorEmails", () => {
  it("lowercases, trims and de-duplicates", () => {
    expect(operatorEmails([" Ada@Gmail.com", "ada@gmail.com", "bo@x.co "]).valid).toEqual([
      "ada@gmail.com",
      "bo@x.co",
    ]);
  });

  it("hands back what isn't an email instead of storing it", () => {
    const r = operatorEmails(["ada@gmail.com", "not-an-email", "a@b"]);
    expect(r.valid).toEqual(["ada@gmail.com"]);
    expect(r.invalid).toEqual(["not-an-email", "a@b"]);
  });

  it("ignores blank lines", () => {
    expect(operatorEmails(["", "  ", "ada@gmail.com"]).valid).toEqual(["ada@gmail.com"]);
  });
});
