import { type Db, deleteCredential, getCredential, setCredential } from "@gilly/db";
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import type { Vault } from "./vault.ts";

// Credential keys the OAuth flow stores under a connector's provider name. Distinct from api_key keys.
const K_TOKENS = "oauth_tokens";
const K_CLIENT = "oauth_client";
const K_VERIFIER = "oauth_verifier";
const K_STATE = "oauth_state";
const K_DISCOVERY = "oauth_discovery";

// Transient rows cleared after a successful callback; tokens + client info persist.
const TRANSIENT_KEYS = [K_VERIFIER, K_STATE, K_DISCOVERY];

/** Delete the transient OAuth rows (verifier/state/discovery) for a provider; keep tokens + client. */
export function clearOAuth(db: Db, provider: string): void {
  for (const key of TRANSIENT_KEYS) deleteCredential(db, provider, key);
}

/**
 * An `OAuthClientProvider` backed entirely by the `credentials` table (encrypted through the vault),
 * so its state survives the `/oauth/:provider/start` → Atlassian → `/oauth/:provider/callback` gap
 * across two separate HTTP requests. Every method reads/writes a DB row — there is NO in-memory state
 * except `authorizationUrl`, which only needs to live within the single `/start` request.
 *
 * Supports Dynamic Client Registration: `clientInformation()` starts undefined and the SDK calls
 * `saveClientInformation` after it lazily registers with Atlassian.
 */
export class VaultOAuthProvider implements OAuthClientProvider {
  /** Set by `redirectToAuthorization` during `client.connect`; read by `/start` right after. */
  authorizationUrl?: URL;

  readonly redirectUrl: string;
  readonly clientMetadata: OAuthClientMetadata;

  constructor(
    private readonly db: Db,
    private readonly vault: Vault,
    private readonly provider: string,
    gatewayUrl: string,
  ) {
    this.redirectUrl = `${gatewayUrl}/oauth/${provider}/callback`;
    this.clientMetadata = {
      client_name: "Gilly",
      redirect_uris: [this.redirectUrl],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      // NOTE: SDK's OAuthClientMetadata (RFC 7591 subset) has no `application_type` field, so it's omitted.
    };
  }

  /** Read a stored key: find the row, decrypt, JSON.parse. Undefined if absent. */
  private load<T>(key: string): T | undefined {
    const row = getCredential(this.db, this.provider).find((c) => c.key === key);
    if (!row) return undefined;
    return JSON.parse(this.vault.decrypt(row.value)) as T;
  }

  /** Write a stored key: JSON.stringify, encrypt, upsert. */
  private save(key: string, value: unknown): void {
    setCredential(this.db, this.provider, key, this.vault.encrypt(JSON.stringify(value)));
  }

  tokens(): OAuthTokens | undefined {
    return this.load<OAuthTokens>(K_TOKENS);
  }
  saveTokens(tokens: OAuthTokens): void {
    this.save(K_TOKENS, tokens);
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    return this.load<OAuthClientInformationMixed>(K_CLIENT);
  }
  saveClientInformation(info: OAuthClientInformationMixed): void {
    this.save(K_CLIENT, info);
  }

  saveCodeVerifier(verifier: string): void {
    this.save(K_VERIFIER, verifier);
  }
  codeVerifier(): string {
    const v = this.load<string>(K_VERIFIER);
    if (v === undefined) throw new Error("missing PKCE code verifier");
    return v;
  }

  saveDiscoveryState(state: OAuthDiscoveryState): void {
    this.save(K_DISCOVERY, state);
  }
  discoveryState(): OAuthDiscoveryState | undefined {
    return this.load<OAuthDiscoveryState>(K_DISCOVERY);
  }

  /** Generate + persist a fresh CSRF state string (the SDK puts it in the authorization URL). */
  state(): string {
    const s = crypto.randomUUID();
    this.save(K_STATE, s);
    return s;
  }
  /** The persisted CSRF state, read back on the callback request to compare against `?state=`. */
  get lastState(): string | undefined {
    return this.load<string>(K_STATE);
  }

  redirectToAuthorization(authorizationUrl: URL): void {
    this.authorizationUrl = authorizationUrl;
  }
}
