import { expect, test } from "bun:test";
import { createDb, getCredential } from "@gilly/db";
import type { OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { clearOAuth, VaultOAuthProvider } from "./oauth.ts";
import { makeVault } from "./vault.ts";

const GATEWAY = "http://localhost:4100";

function setup() {
  const db = createDb(":memory:");
  const vault = makeVault("k");
  const provider = new VaultOAuthProvider(db, vault, "jira", GATEWAY);
  return { db, vault, provider };
}

const tokens: OAuthTokens = { access_token: "AT", token_type: "bearer", refresh_token: "RT" };

test("redirectUrl and clientMetadata are shaped for a public web client", () => {
  const { provider } = setup();
  expect(provider.redirectUrl).toBe(`${GATEWAY}/oauth/jira/callback`);
  expect(provider.clientMetadata.token_endpoint_auth_method).toBe("none");
  expect(provider.clientMetadata.redirect_uris).toEqual([`${GATEWAY}/oauth/jira/callback`]);
  expect(provider.clientMetadata.grant_types).toContain("refresh_token");
});

test("saveTokens → tokens() round-trips, and the stored value is encrypted (not plaintext JSON)", () => {
  const { db, provider } = setup();
  provider.saveTokens(tokens);
  expect(provider.tokens()).toEqual(tokens);

  const row = getCredential(db, "jira").find((c) => c.key === "oauth_tokens");
  expect(row).toBeDefined();
  // Ciphertext must not contain the secret nor look like the JSON we stored.
  expect(row?.value).not.toContain("AT");
  expect(row?.value).not.toContain("access_token");
});

test("saveClientInformation / saveCodeVerifier round-trip; state() sets lastState", () => {
  const { provider } = setup();
  provider.saveClientInformation({ client_id: "cid-123" });
  expect(provider.clientInformation()).toEqual({ client_id: "cid-123" });

  provider.saveCodeVerifier("verifier-xyz");
  expect(provider.codeVerifier()).toBe("verifier-xyz");

  const s = provider.state();
  expect(typeof s).toBe("string");
  expect(provider.lastState).toBe(s);
});

test("state persists across a freshly-constructed provider (cross-request)", () => {
  const { db, vault, provider } = setup();
  provider.saveTokens(tokens);
  const s = provider.state();

  // A second provider on the same DB simulates the separate /callback request.
  const fresh = new VaultOAuthProvider(db, vault, "jira", GATEWAY);
  expect(fresh.tokens()).toEqual(tokens);
  expect(fresh.lastState).toBe(s);
});

test("clearOAuth removes verifier/state but leaves tokens + client", () => {
  const { db, provider } = setup();
  provider.saveTokens(tokens);
  provider.saveClientInformation({ client_id: "cid-123" });
  provider.saveCodeVerifier("v");
  provider.state();

  clearOAuth(db, "jira");

  const keys = getCredential(db, "jira").map((c) => c.key);
  expect(keys).toContain("oauth_tokens");
  expect(keys).toContain("oauth_client");
  expect(keys).not.toContain("oauth_verifier");
  expect(keys).not.toContain("oauth_state");
});
