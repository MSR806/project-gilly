import { expect, test } from "bun:test";
import { makeVault } from "./vault.ts";

test("encrypt → decrypt round-trip", () => {
  const v = makeVault("test-key");
  expect(v.decrypt(v.encrypt("s3cret"))).toBe("s3cret");
});

test("ciphertext differs each call (random iv)", () => {
  const v = makeVault("test-key");
  expect(v.encrypt("same")).not.toBe(v.encrypt("same"));
});

test("wrong key fails to decrypt", () => {
  const enc = makeVault("key-a").encrypt("s3cret");
  expect(() => makeVault("key-b").decrypt(enc)).toThrow();
});
