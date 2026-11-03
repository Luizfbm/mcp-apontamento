import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authorize } from '../src/auth.js';
import { fakePortal } from './helpers.js';

describe('autorização PKCE', () => {
  it('envia challenge S256 e troca o code pelo token', async () => {
    let challenge = '';
    let verifierFromExchange = '';
    let exchanges = 0;
    const portal = await fakePortal((req, body) => {
      if (req.url?.startsWith('/api/mcp/token')) {
        exchanges++;
        verifierFromExchange = body.code_verifier;
        return { body: { access_token: 'never-output-token', expires_at: '2099-01-01T00:00:00.000Z', username: 'analista' } };
      }
      return { status: 404 };
    });
    try {
      await expect(authorize({ portalUrl: portal.url, openBrowser: async (url) => {
        const auth = new URL(url);
        const redirect = new URL(auth.searchParams.get('redirect_uri')!);
        const wrong = new URL(redirect);
        wrong.search = new URLSearchParams({ code: 'bad', state: 'wrong-state' }).toString();
        const wrongResponse = await fetch(wrong);
        expect(wrongResponse.status).toBe(400);
      } })).rejects.toThrow('State inválido');
      const token = await authorize({ portalUrl: portal.url, openBrowser: async (url) => {
        const auth = new URL(url);
        expect(auth.pathname).toBe('/mcp/autorizar');
        expect(auth.searchParams.get('code_challenge_method')).toBe('S256');
        challenge = auth.searchParams.get('code_challenge')!;
        const redirect = new URL(auth.searchParams.get('redirect_uri')!);
        const good = new URL(redirect);
        good.search = new URLSearchParams({ code: 'good-code', state: auth.searchParams.get('state')! }).toString();
        await fetch(good);
      } });
      expect(token.username).toBe('analista');
      expect(createHash('sha256').update(verifierFromExchange).digest('base64url')).toBe(challenge);
      expect(exchanges).toBe(1);
    } finally { await portal.close(); }
  });

  it('falha claramente quando o callback expira', async () => {
    const portal = await fakePortal(() => ({ body: {} }));
    try {
      await expect(authorize({ portalUrl: portal.url, timeoutMs: 10, openBrowser: async () => {} })).rejects.toThrow('Autorização expirou');
    } finally { await portal.close(); }
  });
});
