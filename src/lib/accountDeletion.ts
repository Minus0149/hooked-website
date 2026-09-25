/**
 * The arguments library.deleteMyAccount insists on. The server takes a literal
 * "DELETE" so a stray call can't erase an account; the phone app reaches the
 * backend through an untyped API, so it once called this with `{}`, failed the
 * validator every time, and "Delete my account" silently never worked there.
 * Both clients send exactly this object (mirrored — check-mirrors.mjs fails if
 * the copies drift), and tests/account-deletion.test.ts checks it against the
 * server's own validator.
 */
export const DELETE_ACCOUNT_ARGS = { confirm: "DELETE" } as const;
