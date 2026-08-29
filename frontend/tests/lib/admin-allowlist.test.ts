import { test } from "node:test";
import { strict as assert } from "node:assert";

const allowlist = await import("../../src/lib/admin-allowlist");

test("admin allowlist: built-in operator email is allowed", () => {
  assert.equal(
    allowlist.isAllowedAdminEmail("yashagrawalrkt123@gmail.com"),
    true,
  );
  assert.equal(
    allowlist.isAllowedAdminEmail(" YashAgrawalRkt123@gmail.com "),
    true,
  );
});

test("admin allowlist: BOOTSTRAP_ADMIN_EMAIL still works", () => {
  const prev = process.env.BOOTSTRAP_ADMIN_EMAIL;
  process.env.BOOTSTRAP_ADMIN_EMAIL = "ops@example.com";
  try {
    assert.equal(allowlist.isAllowedAdminEmail("ops@example.com"), true);
    assert.equal(allowlist.isAllowedAdminEmail("user@example.com"), false);
  } finally {
    if (prev === undefined) {
      delete process.env.BOOTSTRAP_ADMIN_EMAIL;
    } else {
      process.env.BOOTSTRAP_ADMIN_EMAIL = prev;
    }
  }
});
