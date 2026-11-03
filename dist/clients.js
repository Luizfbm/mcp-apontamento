import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const repo = 'github:Luizfbm/mcp-apontamento';
export function clientPaths(env = process.env, home = os.homedir()) {
    const userHome = env.HOME || env.USERPROFILE || home;
    const appData = env.APPDATA || path.join(userHome, 'AppData', 'Roaming');
    return {
        home: userHome,
        codex: path.join(env.CODEX_HOME || path.join(userHome, '.codex'), 'config.toml'),
        cursor: path.join(userHome, '.cursor', 'mcp.json'),
        claudeDesktop: path.join(appData, 'Claude', 'claude_desktop_config.json'),
    };
}
function npxCommand(platform, portalUrl) {
    return platform === 'win32'
        ? { command: 'cmd', args: ['/c', 'npx', '-y', repo], ...(portalUrl ? { env: { PORTAL_URL: portalUrl } } : {}) }
        : { command: 'npx', args: ['-y', repo], ...(portalUrl ? { env: { PORTAL_URL: portalUrl } } : {}) };
}
function quoteToml(value) { return JSON.stringify(value); }
export function updateCodexToml(existing, portalUrl, platform = process.platform) {
    const newline = existing.includes('\r\n') ? '\r\n' : '\n';
    const { command, args, env } = npxCommand(platform, portalUrl);
    const lines = [`[mcp_servers.apontamento]`, `command = ${quoteToml(command)}`, `args = [${args.map(quoteToml).join(', ')}]`];
    if (env)
        lines.push(`[mcp_servers.apontamento.env]`, `PORTAL_URL = ${quoteToml(env.PORTAL_URL)}`);
    const input = existing.split(/\r?\n/);
    const output = [];
    let inTarget = false;
    let inserted = false;
    for (const line of input) {
        const header = line.match(/^\s*\[\[?(.*?)\]\]?\s*(?:#.*)?$/);
        if (header) {
            const section = header[1].replace(/^"|"$/g, '').replace(/^'|'$/g, '');
            inTarget = section === 'mcp_servers.apontamento' || section.startsWith('mcp_servers.apontamento.');
            if (inTarget) {
                if (!inserted) {
                    output.push(...lines);
                    inserted = true;
                }
                continue;
            }
        }
        if (!inTarget)
            output.push(line);
    }
    if (!inserted)
        output.push(...lines);
    return output.join(newline).replace(new RegExp(`${newline}+$`), '') + newline;
}
function backup(file) {
    if (fs.existsSync(file))
        fs.copyFileSync(file, `${file}.bak`);
}
function atomicWrite(file, contents) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(temp, contents, { mode: 0o600 });
    fs.renameSync(temp, file);
}
function writeJson(file, update) {
    const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '{}';
    const config = JSON.parse(existing);
    backup(file);
    atomicWrite(file, `${JSON.stringify(update(config), null, 2)}\n`);
}
export function registeredClients(paths = clientPaths(), options = {}) {
    const platform = options.platform ?? process.platform;
    const run = options.run ?? spawnSync;
    const has = (file, key) => {
        try {
            return Boolean(JSON.parse(fs.readFileSync(file, 'utf8'))[key]?.apontamento);
        }
        catch {
            return false;
        }
    };
    let codex = false;
    try {
        codex = /\[mcp_servers\.apontamento\]/.test(fs.readFileSync(paths.codex, 'utf8'));
    }
    catch { /* missing */ }
    let claudeCode = false;
    const cli = run(platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true });
    if (cli.status === 0) {
        const listed = run('claude', ['mcp', 'list'], { encoding: 'utf8', windowsHide: true, ...(platform === 'win32' ? { shell: true } : {}) });
        claudeCode = listed.status === 0 && /apontamento/i.test(`${listed.stdout || ''}${listed.stderr || ''}`);
    }
    return { claudeCode, codex, cursor: has(paths.cursor, 'mcpServers'), claudeDesktop: has(paths.claudeDesktop, 'mcpServers') };
}
export async function registerClients({ env = process.env, home = os.homedir(), platform = process.platform, run = spawnSync, exists = fs.existsSync } = {}, portalUrl) {
    const paths = clientPaths(env, home);
    const command = npxCommand(platform, portalUrl);
    const candidates = [
        ['Codex', paths.codex], ['Cursor', paths.cursor], ['Claude Desktop', paths.claudeDesktop],
    ];
    const installed = new Set();
    const cliCheck = run(platform === 'win32' ? 'where.exe' : 'which', ['claude'], { encoding: 'utf8', windowsHide: true });
    if (cliCheck.status === 0) {
        const claudeArgs = ['mcp', 'add', '--scope', 'user', ...(portalUrl ? ['--env', `PORTAL_URL=${portalUrl}`] : []), 'apontamento', '--', command.command, ...command.args];
        const result = run('claude', claudeArgs, { encoding: 'utf8', windowsHide: true, ...(platform === 'win32' ? { shell: true } : {}) });
        if (result.status !== 0)
            throw new Error('Não foi possível registrar o MCP no Claude Code.');
        installed.add('Claude Code');
    }
    for (const [name, file] of candidates) {
        const directory = path.dirname(file);
        if (!exists(file) && !exists(directory))
            continue;
        if (name === 'Codex') {
            const current = exists(file) ? fs.readFileSync(file, 'utf8') : '';
            backup(file);
            atomicWrite(file, updateCodexToml(current, portalUrl, platform));
        }
        else {
            writeJson(file, (config) => {
                const rootKey = 'mcpServers';
                const servers = (config[rootKey] && typeof config[rootKey] === 'object') ? config[rootKey] : {};
                return { ...config, [rootKey]: { ...servers, apontamento: command } };
            });
        }
        installed.add(name);
    }
    return { paths, registered: registeredClients(paths, { platform, run }), installed: [...installed] };
}
