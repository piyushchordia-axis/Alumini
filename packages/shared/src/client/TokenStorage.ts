export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

/** Platform-specific persistence for the session tokens (localStorage on web, SecureStore on mobile). */
export interface TokenStorage {
  getAccessToken(): Promise<string | null>;
  getRefreshToken(): Promise<string | null>;
  setTokens(tokens: TokenPair): Promise<void>;
  clear(): Promise<void>;
}

/** In-memory storage, handy for tests and server-side scripts. */
export class MemoryTokenStorage implements TokenStorage {
  private tokens: TokenPair | null = null;
  async getAccessToken() {
    return this.tokens?.accessToken ?? null;
  }
  async getRefreshToken() {
    return this.tokens?.refreshToken ?? null;
  }
  async setTokens(tokens: TokenPair) {
    this.tokens = tokens;
  }
  async clear() {
    this.tokens = null;
  }
}
