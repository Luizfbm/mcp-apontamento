import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { AsyncEntry } from '@napi-rs/keyring';
const service = 'mcp-apontamento';
const account = 'portal-token';
export class SecureTokenStore {
    filePath;
    useKeyring = process.platform === 'win32';
    get backend() { return this.useKeyring ? 'Windows Credential Manager' : 'arquivo local'; }
    constructor(filePath = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'mcp-apontamento', 'token.json')) {
        this.filePath = filePath;
    }
    entry() { return new AsyncEntry(service, account); }
    async read() {
        if (this.useKeyring) {
            try {
                const value = await this.entry().getPassword();
                return value ? JSON.parse(value) : null;
            }
            catch {
                this.useKeyring = false;
            }
        }
        try {
            return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
        }
        catch (error) {
            if (error.code === 'ENOENT')
                return null;
            throw error;
        }
    }
    async write(token) {
        if (this.useKeyring) {
            try {
                await this.entry().setPassword(JSON.stringify(token));
                return;
            }
            catch {
                this.useKeyring = false;
            }
        }
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const temp = `${this.filePath}.${process.pid}.tmp`;
        await fs.writeFile(temp, JSON.stringify(token), { mode: 0o600 });
        await fs.rename(temp, this.filePath);
    }
    async clear() {
        if (this.useKeyring) {
            try {
                await this.entry().deleteCredential();
            }
            catch {
                this.useKeyring = false;
            }
        }
        await fs.rm(this.filePath, { force: true });
    }
}
