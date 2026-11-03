import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AsyncEntry } from '@napi-rs/keyring';
import type { TokenRecord } from './types.js';

const service = 'mcp-apontamento';
const account = 'portal-token';

export interface TokenStore {
  readonly backend: 'Windows Credential Manager' | 'arquivo local';
  read(): Promise<TokenRecord | null>;
  write(token: TokenRecord): Promise<void>;
  clear(): Promise<void>;
}

export class SecureTokenStore implements TokenStore {
  private useKeyring = process.platform === 'win32';
  get backend(): TokenStore['backend'] { return this.useKeyring ? 'Windows Credential Manager' : 'arquivo local'; }

  constructor(private readonly filePath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'mcp-apontamento', 'token.json')) {}

  private entry() { return new AsyncEntry(service, account); }

  async read(): Promise<TokenRecord | null> {
    if (this.useKeyring) {
      try {
        const value = await this.entry().getPassword();
        return value ? JSON.parse(value) as TokenRecord : null;
      } catch {
        this.useKeyring = false;
      }
    }
    try { return JSON.parse(await fs.readFile(this.filePath, 'utf8')) as TokenRecord; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
  }

  async write(token: TokenRecord): Promise<void> {
    if (this.useKeyring) {
      try { await this.entry().setPassword(JSON.stringify(token)); return; }
      catch { this.useKeyring = false; }
    }
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temp = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(temp, JSON.stringify(token), { mode: 0o600 });
    await fs.rename(temp, this.filePath);
  }

  async clear(): Promise<void> {
    if (this.useKeyring) {
      try { await this.entry().deleteCredential(); }
      catch { this.useKeyring = false; }
    }
    await fs.rm(this.filePath, { force: true });
  }
}
