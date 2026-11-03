import { createHash, randomBytes } from 'node:crypto';
import http from 'node:http';
import { once } from 'node:events';
import { openExternal } from './open-browser.js';
const base64url = (bytes) => bytes.toString('base64url');
export async function authorize(options) {
    const fetcher = options.fetcher ?? fetch;
    const verifier = base64url(randomBytes(32));
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const state = base64url(randomBytes(24));
    const server = http.createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string')
        throw new Error('Não foi possível abrir o callback local.');
    const redirectUri = `http://127.0.0.1:${address.port}/callback`;
    let timer;
    const callback = new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Autorização expirou após 5 minutos.')), options.timeoutMs ?? 300_000);
        server.on('request', (request, response) => {
            const url = new URL(request.url ?? '/', redirectUri);
            if (url.pathname !== '/callback') {
                response.writeHead(404).end();
                return;
            }
            if (url.searchParams.get('state') !== state) {
                clearTimeout(timer);
                response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' }).end('State inválido.');
                reject(new Error('State inválido no callback de autorização.'));
                return;
            }
            clearTimeout(timer);
            response.writeHead(url.searchParams.has('error') ? 400 : 200, { 'content-type': 'text/html; charset=utf-8' });
            response.end(url.searchParams.has('error') ? 'Autorização cancelada. Você pode fechar esta janela.' : 'MCP autorizado. Você pode fechar esta janela.');
            resolve(url);
        });
    });
    void callback.catch(() => { });
    try {
        const authorizationUrl = new URL('/mcp/autorizar', options.portalUrl);
        authorizationUrl.search = new URLSearchParams({
            response_type: 'code', client_id: 'mcp-apontamento', redirect_uri: redirectUri,
            code_challenge: challenge, code_challenge_method: 'S256', state,
        }).toString();
        await (options.openBrowser ?? openExternal)(authorizationUrl.toString());
        const result = await callback;
        if (result.searchParams.has('error'))
            throw new Error('Autorização cancelada no navegador.');
        const code = result.searchParams.get('code');
        if (!code)
            throw new Error('O Portal não retornou o código de autorização.');
        const response = await fetcher(new URL('/api/mcp/token', options.portalUrl), {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ grant_type: 'authorization_code', code, code_verifier: verifier, redirect_uri: redirectUri, client_id: 'mcp-apontamento' }),
        });
        if (!response.ok)
            throw new Error(`Não foi possível trocar o código pelo token (HTTP ${response.status}).`);
        const token = await response.json();
        if (!token.access_token || !token.expires_at || !token.username)
            throw new Error('Resposta de token inválida do Portal.');
        return { access_token: token.access_token, expires_at: token.expires_at, username: token.username };
    }
    finally {
        clearTimeout(timer);
        server.removeAllListeners('request');
        server.close();
    }
}
