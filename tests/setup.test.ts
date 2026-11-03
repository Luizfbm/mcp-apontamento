import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { setup } from '../src/cli.js';
import { fakePortal, tokenStore } from './helpers.js';

const temporary: string[] = [];
afterEach(() => { for (const directory of temporary.splice(0)) fs.rmSync(directory, { recursive: true, force: true }); });

describe('setup em diretórios isolados', () => {
  it('registra Codex, Cursor e Claude Desktop preservando entradas, criando backup e repetindo sem duplicação', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-apontamento-'));
    temporary.push(root);
    const home = path.join(root, 'home');
    const appData = path.join(root, 'appdata');
    fs.mkdirSync(path.join(home, '.codex'), { recursive: true });
    fs.mkdirSync(path.join(home, '.cursor'), { recursive: true });
    fs.mkdirSync(path.join(appData, 'Claude'), { recursive: true });
    const codexFile = path.join(home, '.codex', 'config.toml');
    const cursorFile = path.join(home, '.cursor', 'mcp.json');
    const desktopFile = path.join(appData, 'Claude', 'claude_desktop_config.json');
    fs.writeFileSync(codexFile, '[mcp_servers.outro]\ncommand = "node"\nargs = []\n');
    fs.writeFileSync(cursorFile, '{"other":true,"mcpServers":{"existing":{"command":"node","args":[]}}}');
    fs.writeFileSync(desktopFile, '{"keep":"value","mcpServers":{"existing":{"command":"node","args":[]}}}');
    const portal = await fakePortal((req) => {
      if (req.url?.startsWith('/api/mcp/me')) return { body: { username: 'ana', nome: 'Ana', codcfo: '1', expires_at: '2099-01-01T00:00:00.000Z' } };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [] };
      return { status: 404 };
    });
    const logs: string[] = [];
    const deps = { env: { HOME: home, USERPROFILE: home, APPDATA: appData }, home, platform: 'win32' as NodeJS.Platform,
      run: (() => ({ status: 1, stdout: '', stderr: '' })) as any, nodeVersion: '20.0.0', tokenStore: tokenStore(), fetcher: fetch, log: (line: string) => logs.push(line) };
    try {
      await setup(['--portal-url', portal.url], deps);
      const firstCursor = fs.readFileSync(cursorFile, 'utf8');
      await setup(['--portal-url', portal.url], deps);
      const cursor = JSON.parse(fs.readFileSync(cursorFile, 'utf8'));
      const desktop = JSON.parse(fs.readFileSync(desktopFile, 'utf8'));
      expect(cursor.other).toBe(true);
      expect(cursor.mcpServers.existing).toBeDefined();
      expect(cursor.mcpServers.apontamento.args).toEqual(['/c', 'npx', '-y', 'github:Luizfbm/mcp-apontamento']);
      expect(cursor.mcpServers.apontamento.env.PORTAL_URL).toBe(portal.url);
      expect(desktop.keep).toBe('value');
      expect(desktop.mcpServers.existing).toBeDefined();
      expect(fs.readFileSync(codexFile, 'utf8')).toContain('[mcp_servers.outro]');
      expect(fs.readFileSync(codexFile, 'utf8')).toContain('[mcp_servers.apontamento]');
      expect((fs.readFileSync(codexFile, 'utf8').match(/\[mcp_servers\.apontamento\]/g) || [])).toHaveLength(1);
      expect(fs.existsSync(`${cursorFile}.bak`)).toBe(true);
      expect(fs.existsSync(`${desktopFile}.bak`)).toBe(true);
      expect(fs.readFileSync(cursorFile, 'utf8')).not.toContain('apontamento\n  "apontamento"');
      expect(firstCursor).toContain('existing');
      expect(logs.filter((line) => line.startsWith('Tudo pronto:'))).toHaveLength(2);
    } finally { await portal.close(); }
  });
});
