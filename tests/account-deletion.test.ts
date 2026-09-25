import { describe, expect, it } from "vitest";
import { deleteMyAccount } from "../convex/library";
import { DELETE_ACCOUNT_ARGS } from "../src/lib/accountDeletion";

/**
 * Google Play requires that an account can be deleted from inside the app. The
 * phone calls the backend untyped, so the only thing standing between "Delete
 * my account" and a validator error is this object matching the server.
 */
describe("DELETE_ACCOUNT_ARGS", () => {
  it("is exactly what deleteMyAccount's validator accepts", () => {
    const exported = JSON.parse(
      (deleteMyAccount as unknown as { exportArgs: () => string }).exportArgs(),
    );
    expect(exported.type).toBe("object");
    expect(Object.keys(exported.value)).toEqual(Object.keys(DELETE_ACCOUNT_ARGS));
    expect(exported.value.confirm.fieldType).toEqual({ type: "literal", value: DELETE_ACCOUNT_ARGS.confirm });
  });
});
