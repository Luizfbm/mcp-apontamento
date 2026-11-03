#!/usr/bin/env node
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { HttpPortalClient } from './portal-client.js';
import { SecureTokenStore } from './token-store.js';
import { clientPaths, registerClients, registeredClients } from './clients.js';
import { runStdioServer } from './mcp-server.js';
const DEFAULT_PORTAL = 'https://portal.pvtsoftware.com.br';
export const HELP = `mcp-apontamento — MCP local para o Portal PVT

Uso:
  mcp-apontamento                 Inicia o servidor MCP em stdio
  mcp-apontamento setup [--portal-url URL]
                                  Registra nos clientes, autoriza e testa
  mcp-apontamento login           Autoriza este computador no Portal
  mcp-apontamento logout          Revoga e apaga o token local
  mcp-apontamento status          Exibe usuário, validade e clientes
  mcp-apontamento --help          Mostra esta ajuda
`;
function tokenFile(env, home) {
    return path.join(env.APPDATA || path.join(home, 'AppData', 'Roaming'), 'mcp-apontamento', 'token.json');
}
function today() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function portalUrlFrom(args, env) {
    const index = args.indexOf('--portal-url');
    if (index !== -1) {
        const value = args[index + 1];
        if (!value)
            throw new Error('Informe a URL após --portal-url.');
        return new URL(value).toString().replace(/\/$/, '');
    }
    return new URL(env.PORTAL_URL || DEFAULT_PORTAL).toString().replace(/\/$/, '');
}
export async function setup(args = [], deps = {}) {
    const env = deps.env ?? process.env;
    const home = deps.home ?? os.homedir();
    const platform = deps.platform ?? process.platform;
    const nodeVersion = deps.nodeVersion ?? process.versions.node;
    const log = deps.log ?? console.log;
    if (Number(nodeVersion.split('.')[0]) < 20)
        throw new Error('Node.js 20 ou superior é obrigatório. Instale com: winget install OpenJS.NodeJS.LTS');
    const portalUrl = portalUrlFrom(args, env);
    await registerClients({ ...deps, env, home, platform }, portalUrl);
    const store = deps.tokenStore ?? new SecureTokenStore(tokenFile(env, home));
    const portal = new HttpPortalClient({ portalUrl, tokenStore: store, fetcher: deps.fetcher });
    // An injected browser opener is passed to the authorization flow through a client factory below.
    const activePortal = deps.openBrowser
        ? new HttpPortalClient({ portalUrl, tokenStore: store, fetcher: deps.fetcher, authorize: () => import('./auth.js').then(({ authorize }) => authorize({ portalUrl, fetcher: deps.fetcher, openBrowser: deps.openBrowser })) })
        : portal;
    let user;
    let agendas;
    try {
        user = await activePortal.me();
        agendas = await activePortal.agendas(today(), today());
    }
    catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes('Autorize o MCP no navegador que abriu'))
            throw new Error(`${message} Rode \`npx -y github:Luizfbm/mcp-apontamento login\` se precisar repetir a autorização.`);
        throw error;
    }
    const backend = store.backend;
    log(`Token salvo em: ${backend}.`);
    log(`Tudo pronto: ${user.nome}, você tem ${agendas.length} agendas hoje.`);
}
export async function login(deps = {}) {
    const env = deps.env ?? process.env;
    const home = deps.home ?? os.homedir();
    const store = deps.tokenStore ?? new SecureTokenStore(tokenFile(env, home));
    const portal = new HttpPortalClient({ portalUrl: portalUrlFrom([], env), tokenStore: store, fetcher: deps.fetcher,
        ...(deps.openBrowser ? { authorize: () => import('./auth.js').then(({ authorize }) => authorize({ portalUrl: portalUrlFrom([], env), fetcher: deps.fetcher, openBrowser: deps.openBrowser })) } : {}),
    });
    const me = await portal.me();
    (deps.log ?? console.log)(`Autorizado: ${me.nome} (${me.username}). Token válido até ${me.expires_at}. Armazenamento: ${store.backend}.`);
}
export async function logout(deps = {}) {
    const env = deps.env ?? process.env;
    const home = deps.home ?? os.homedir();
    const store = deps.tokenStore ?? new SecureTokenStore(tokenFile(env, home));
    const token = await store.read();
    if (token) {
        const fetcher = deps.fetcher ?? fetch;
        const response = await fetcher(new URL('/api/mcp/token', portalUrlFrom([], env)), { method: 'DELETE', headers: { authorization: `Bearer ${token.access_token}` } });
        if (!response.ok && response.status !== 401)
            throw new Error(`Não foi possível revogar o token (HTTP ${response.status}).`);
    }
    await store.clear();
    (deps.log ?? console.log)('Token revogado e removido deste computador.');
}
export async function status(deps = {}) {
    const env = deps.env ?? process.env;
    const home = deps.home ?? os.homedir();
    const store = deps.tokenStore ?? new SecureTokenStore(tokenFile(env, home));
    const token = await store.read();
    const clients = registeredClients(clientPaths(env, home));
    (deps.log ?? console.log)(token && Date.parse(token.expires_at) > Date.now()
        ? `Usuário: ${token.username}\nToken válido até: ${token.expires_at}\nArmazenamento: ${store.backend}`
        : 'Sem token válido. Rode: npx -y github:Luizfbm/mcp-apontamento login');
    (deps.log ?? console.log)(`Clientes registrados: ${Object.entries(clients).filter(([, enabled]) => enabled).map(([name]) => name).join(', ') || 'nenhum'}`);
}
export async function main(args = process.argv.slice(2), deps = {}) {
    try {
        if (args.includes('--help') || args.includes('-h')) {
            (deps.log ?? console.log)(HELP);
            return 0;
        }
        const command = args[0];
        if (!command) {
            const env = deps.env ?? process.env;
            const home = deps.home ?? os.homedir();
            const store = deps.tokenStore ?? new SecureTokenStore(tokenFile(env, home));
            await runStdioServer(new HttpPortalClient({ portalUrl: portalUrlFrom([], env), tokenStore: store, fetcher: deps.fetcher,
                ...(deps.openBrowser ? { authorize: () => import('./auth.js').then(({ authorize }) => authorize({ portalUrl: portalUrlFrom([], env), fetcher: deps.fetcher, openBrowser: deps.openBrowser })) } : {}),
            }));
            return 0;
        }
        if (command === 'setup') {
            await setup(args.slice(1), deps);
            return 0;
        }
        if (command === 'login') {
            await login(deps);
            return 0;
        }
        if (command === 'logout') {
            await logout(deps);
            return 0;
        }
        if (command === 'status') {
            await status(deps);
            return 0;
        }
        throw new Error(`Comando desconhecido: ${command}. Use --help.`);
    }
    catch (error) {
        (deps.log ?? console.error)(error instanceof Error ? error.message : String(error));
        return 1;
    }
}
const isDirect = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirect)
    process.exitCode = await main();
