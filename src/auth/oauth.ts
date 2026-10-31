import type { Config } from '../config.js';
import { generateCodeChallenge, generateCodeVerifier, generateState } from './pkce.js';
import type { FileTokenStore, MemoryTokenStore, TokenSet } from './tokenStore.js';

type Store = FileTokenStore | MemoryTokenStore;
type FetchFn = typeof fetch;

export class SageOAuth {
  private pending = new Map<string, string>(); // state -> verifier

  constructor(
    private config: Config,
    private store: Store,
    private fetchFn: FetchFn = fetch,
  ) {}

  buildAuthorizeUrl(): { url: string; state: string } {
    const verifier = generateCodeVerifier();
    const state = generateState();
    this.pending.set(state, verifier);
    const u = new URL(this.config.SAGE_AUTH_URL);
    u.searchParams.set('client_id', this.config.SAGE_CLIENT_ID);
    u.searchParams.set('response_type', 'code');
    u.searchParams.set('redirect_uri', this.config.SAGE_REDIRECT_URI);
    u.searchParams.set('scope', this.config.SAGE_SCOPE);
    u.searchParams.set('state', state);
    u.searchParams.set('code_challenge', generateCodeChallenge(verifier));
    u.searchParams.set('code_challenge_method', 'S256');
    return { url: u.toString(), state };
  }

  async exchangeCode(code: string, state: string): Promise<TokenSet> {
    const verifier = this.pending.get(state);
    if (!verifier) throw new Error('Unknown OAuth state — restart the connect flow');
    this.pending.delete(state);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.config.SAGE_REDIRECT_URI,
      client_id: this.config.SAGE_CLIENT_ID,
      client_secret: this.config.SAGE_CLIENT_SECRET,
      code_verifier: verifier,
    });
    return this.tokenRequest(body);
  }

  async refresh(refreshToken: string): Promise<TokenSet> {
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: this.config.SAGE_CLIENT_ID,
      client_secret: this.config.SAGE_CLIENT_SECRET,
    });
    return this.tokenRequest(body);
  }

  /** Returns a valid access token, refreshing first if expired. */
  async getValidAccessToken(): Promise<string> {
    const current = await this.store.load();
    if (!current) throw new Error('Sage not connected — visit /auth/sage first');
    if (!this.store.isExpired(current)) return current.access_token;
    const next = await this.refresh(current.refresh_token);
    await this.store.save(next);
    return next.access_token;
  }

  /** Used by the API client when Sage returns 401 despite a locally-valid token. */
  async forceRefresh(): Promise<string> {
    const current = await this.store.load();
    if (!current?.refresh_token) throw new Error('No refresh token available');
    const next = await this.refresh(current.refresh_token);
    await this.store.save(next);
    return next.access_token;
  }

  private async tokenRequest(body: URLSearchParams): Promise<TokenSet> {
    const res = await this.fetchFn(this.config.SAGE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!res.ok) throw new Error(`Sage token request failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as any;
    const tokens: TokenSet = {
      access_token: json.access_token,
      refresh_token: json.refresh_token,
      token_type: json.token_type ?? 'Bearer',
      scope: json.scope,
      expires_at: Date.now() + (json.expires_in ?? 3600) * 1000,
    };
    await this.store.save(tokens);
    return tokens;
  }
}
