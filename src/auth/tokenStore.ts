import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at: number; // epoch ms
  token_type: string;
  scope?: string;
}

// File store for local / staging only. In production swap this for
// an encrypted secret store (e.g. KMS-backed) — same interface.
export class FileTokenStore {
  constructor(private path: string) {}

  async save(tokens: TokenSet): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await writeFile(this.path, JSON.stringify(tokens, null, 2), { mode: 0o600 });
  }

  async load(): Promise<TokenSet | null> {
    try {
      const raw = await readFile(this.path, 'utf8');
      return JSON.parse(raw) as TokenSet;
    } catch {
      return null;
    }
  }

  isExpired(tokens: TokenSet, skewMs = 30_000): boolean {
    return Date.now() >= tokens.expires_at - skewMs;
  }
}

export class MemoryTokenStore {
  private tokens: TokenSet | null = null;
  async save(t: TokenSet) { this.tokens = t; }
  async load() { return this.tokens; }
  isExpired(t: TokenSet, skewMs = 30_000) { return Date.now() >= t.expires_at - skewMs; }
}
