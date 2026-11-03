import { afterEach, describe, expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { HttpPortalClient } from '../src/portal-client.js';
import { createMcpServer } from '../src/mcp-server.js';
import { fakePortal, tokenStore } from './helpers.js';

const agenda = { ID: '42', IDPMS: '2250', DATAAGENDA: '03/11/2026', PROJETO: 'Projeto Teste', CLIENTE: 'ACME', COORDENADOR: 'Coord Teste', HORAINICIO: '08:00', HORAFIM: '17:00' };
const user = { username: 'analista.teste', nome: 'Ana Teste', codcfo: 'CFO-17', expires_at: '2099-01-01T00:00:00.000Z' };

async function connectedServer(handler: (request: any, body: any) => Promise<{ status?: number; body?: unknown }> | { status?: number; body?: unknown }, elicitation?: 'accept' | 'decline' | 'cancel' | 'error') {
  const fake = await fakePortal(handler);
  const server = createMcpServer(new HttpPortalClient({ portalUrl: fake.url, tokenStore: tokenStore() }));
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-agent', version: '1.0.0' }, elicitation ? { capabilities: { elicitation: { form: {} } } } : {});
  if (elicitation) client.setRequestHandler(ElicitRequestSchema, async () => {
    if (elicitation === 'error') throw new Error('elicitation não disponível');
    return { action: elicitation, content: elicitation === 'accept' ? { confirmar: true } : undefined };
  });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { fake, server, client, close: async () => { await client.close(); await server.close(); await fake.close(); } };
}

let closeCurrent: (() => Promise<void>) | undefined;
afterEach(async () => { await closeCurrent?.(); closeCurrent = undefined; });

describe('servidor MCP com Portal HTTP falso', () => {
  it('expõe quatro ferramentas com outputSchema e devolve conteúdo estruturado nas três consultas', async () => {
    const ctx = await connectedServer((req) => {
      if (req.url?.startsWith('/api/mcp/me')) return { body: user };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [agenda] };
      if (req.url?.startsWith('/api/apontador/atividades-agenda')) return { body: [{ IDATIVIDADE: 88, ATIVIDADE: 'Configuração', CODATIVIDADE: 'CFG' }] };
      if (req.url?.startsWith('/api/apontador/apontamentos')) return { status: 201, body: {} };
      if (req.url?.startsWith('/api/mcp/pendentes')) return { body: { pendentes: [{ id_agenda: '42', data: '2026-11-03', id_projeto: '2250', projeto: 'Projeto Teste', cliente: 'ACME', coordenador: 'Coord Teste', horas_agendadas: '08:00' }] } };
      return { status: 404, body: { message: 'not found' } };
    });
    closeCurrent = ctx.close;
    const listed = await ctx.client.listTools();
    expect(listed.tools.map((item) => item.name).sort()).toEqual(['apontamentos_pendentes', 'atividades_da_agenda', 'lancar_apontamento', 'minhas_agendas'].sort());
    expect(listed.tools.every((item) => item.outputSchema)).toBe(true);
    expect(listed.tools.find((item) => item.name === 'lancar_apontamento')?.inputSchema.required).toContain('data_agenda');
    const agendas = await ctx.client.callTool({ name: 'minhas_agendas', arguments: {} });
    expect(agendas.structuredContent).toEqual({ agendas: [{ id_agenda: '42', data: '2026-11-03', id_projeto: '2250', projeto: 'Projeto Teste', coordenador: 'Coord Teste', cliente: 'ACME', horario: '08:00-17:00' }] });
    expect(JSON.stringify(agendas)).not.toContain('test-access-token');
    const activities = await ctx.client.callTool({ name: 'atividades_da_agenda', arguments: { id_agenda: '42' } });
    expect(activities.structuredContent).toEqual({ atividades: [{ id_tarefa: '88', nome: 'Configuração', codigo: 'CFG' }] });
    const pending = await ctx.client.callTool({ name: 'apontamentos_pendentes', arguments: {} });
    expect(pending.structuredContent).toMatchObject({ pendentes: [{ id_agenda: '42', horas_agendadas: '08:00' }] });
    const launch = await ctx.client.callTool({ name: 'lancar_apontamento', arguments: { id_agenda: '42', data_agenda: '2026-11-03', id_tarefa: '88', hora_inicio: '08:00', hora_fim: '09:00', detalhamento: 'Tarefa', confirmar: true } });
    expect(launch.structuredContent).toMatchObject({ status: 'GRAVADO' });
    expect(ctx.fake.requests.filter((request) => request.url.startsWith('/api/projects-by-date'))).toHaveLength(1);
  });

  it.each([
    [8, 201, 'GRAVADO'], [9, 200, 'AGUARDANDO_APROVACAO'], [10, 400, 'BLOQUEADO'], [11, 403, 'SEM_ACESSO'], [12, 500, 'ERRO'],
  ] as const)('mapeia HTTP %i para %s e envia os identificadores obtidos do Portal', async (hour, httpStatus, expected) => {
    let posted: any;
    const ctx = await connectedServer((req, body) => {
      if (req.url?.startsWith('/api/mcp/me')) return { body: user };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [agenda] };
      if (req.url?.startsWith('/api/apontador/apontamentos')) { posted = body; return { status: httpStatus, body: { message: 'Mensagem do Portal' } }; }
      return { status: 404 };
    });
    closeCurrent = ctx.close;
    const result = await ctx.client.callTool({ name: 'lancar_apontamento', arguments: {
      id_agenda: '42', data_agenda: '2026-11-03', id_tarefa: '88', hora_inicio: `${String(hour).padStart(2, '0')}:00`, hora_fim: `${String(hour + 1).padStart(2, '0')}:00`, detalhamento: 'Trabalho validado', confirmar: true,
      ANALISTA: 'injeção', CODCFO_ANALISTA: 'outro', IDPRJ: 'malicioso', PROJETO: 'falso',
    } });
    expect(result.structuredContent).toMatchObject({ status: expected, mensagem: 'Mensagem do Portal' });
    const row = posted.ZMDAPONTAMENTO[0];
    expect(row).toMatchObject({ IDAGENDA: '42', DTAGENDA: '2026-11-03T00:00:00.000Z', IDTAREFA: '88', IDPRJ: '2250', PROJETO: 'Projeto Teste', COORDENADOR: 'Coord Teste', ANALISTA: 'Ana Teste', USUARIO_ANALISTA: 'analista.teste', CODCFO_ANALISTA: 'CFO-17', TOTALHORAS: '01:00', STATUS: 'PENDENTE' });
  });

  it('retorna CANCELADO se a confirmação elicitation for recusada e nada grava', async () => {
    let postCount = 0;
    const ctx = await connectedServer((req) => {
      if (req.url?.startsWith('/api/mcp/me')) return { body: user };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [agenda] };
      if (req.url?.startsWith('/api/apontador/apontamentos')) { postCount++; return { status: 201 }; }
      return { status: 404 };
    }, 'decline');
    closeCurrent = ctx.close;
    const result = await ctx.client.callTool({ name: 'lancar_apontamento', arguments: { id_agenda: '42', data_agenda: '2026-11-03', id_tarefa: '88', hora_inicio: '08:00', hora_fim: '09:00', detalhamento: 'Tarefa' } });
    expect(result.structuredContent).toMatchObject({ status: 'CANCELADO' });
    expect(postCount).toBe(0);
  });

  it('sem elicitation exige confirmação em chamada posterior e repete autorização uma vez no token inválido', async () => {
    let postCount = 0;
    const fake = await fakePortal((req, body) => {
      if (req.url?.startsWith('/api/mcp/me') && req.headers.authorization === 'Bearer old-token') return { status: 401, body: { code: 'mcp_token_invalid', message: 'invalid' } };
      if (req.url?.startsWith('/api/mcp/me')) return { body: user };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [agenda] };
      if (req.url?.startsWith('/api/apontador/apontamentos')) { postCount++; return { status: 201, body: {} }; }
      return { status: 404, body };
    });
    const store = tokenStore();
    let renewals = 0;
    const portal = new HttpPortalClient({ portalUrl: fake.url, tokenStore: store, authorize: async () => { renewals++; return { access_token: 'new-token', expires_at: '2099-01-01T00:00:00.000Z', username: 'ana' }; } });
    const server = createMcpServer(portal);
    const [ct, st] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'without-elicitation', version: '1' });
    await Promise.all([server.connect(st), client.connect(ct)]);
    closeCurrent = async () => { await client.close(); await server.close(); await fake.close(); };
    const input = { id_agenda: '42', data_agenda: '2026-11-03', id_tarefa: '88', hora_inicio: '08:00', hora_fim: '09:00', detalhamento: 'Tarefa' };
    const pending = await client.callTool({ name: 'lancar_apontamento', arguments: input });
    expect(pending.structuredContent).toMatchObject({ status: 'CONFIRMACAO_PENDENTE' });
    expect(postCount).toBe(0);
    await store.write({ access_token: 'old-token', expires_at: '2099-01-01T00:00:00.000Z', username: 'ana' });
    expect(await portal.me()).toEqual(user);
    expect(renewals).toBe(1);
    const confirmed = await client.callTool({ name: 'lancar_apontamento', arguments: { ...input, confirmar: true } });
    expect(confirmed.structuredContent).toMatchObject({ status: 'GRAVADO' });
    expect(postCount).toBe(1);
  });

  it('consulta somente a data informada e retorna mensagem clara quando a agenda não está nela', async () => {
    const ctx = await connectedServer((req) => {
      if (req.url?.startsWith('/api/mcp/me')) return { body: user };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [] };
      return { status: 404 };
    });
    closeCurrent = ctx.close;
    const result = await ctx.client.callTool({ name: 'lancar_apontamento', arguments: { id_agenda: '999', data_agenda: '2026-10-28', id_tarefa: '88', hora_inicio: '08:00', hora_fim: '09:00', detalhamento: 'Tarefa', confirmar: true } });
    expect(result.structuredContent).toMatchObject({ status: 'ERRO', mensagem: 'A agenda 999 não existe em 2026-10-28 para você; consulte minhas_agendas' });
    const queries = ctx.fake.requests.filter((request) => request.url.startsWith('/api/projects-by-date'));
    expect(queries).toHaveLength(1);
    const query = new URLSearchParams(queries[0]!.url.split('?')[1]);
    expect(query.get('startDate')).toBe('2026-10-28');
    expect(query.get('endDate')).toBe('2026-10-28');
  });

  it('se elicitation falhar, a chamada sem confirmar fica pendente e confirmar:true grava sem repetir elicitation', async () => {
    let posts = 0;
    const ctx = await connectedServer((req) => {
      if (req.url?.startsWith('/api/mcp/me')) return { body: user };
      if (req.url?.startsWith('/api/projects-by-date')) return { body: [agenda] };
      if (req.url?.startsWith('/api/apontador/apontamentos')) { posts++; return { status: 201, body: {} }; }
      return { status: 404 };
    }, 'error');
    closeCurrent = ctx.close;
    const input = { id_agenda: '42', data_agenda: '2026-11-03', id_tarefa: '88', hora_inicio: '08:00', hora_fim: '09:00', detalhamento: 'Tarefa' };
    const pending = await ctx.client.callTool({ name: 'lancar_apontamento', arguments: input });
    expect(pending.structuredContent).toMatchObject({ status: 'CONFIRMACAO_PENDENTE' });
    expect(posts).toBe(0);
    const confirmed = await ctx.client.callTool({ name: 'lancar_apontamento', arguments: { ...input, confirmar: true } });
    expect(confirmed.structuredContent).toMatchObject({ status: 'GRAVADO' });
    expect(posts).toBe(1);
  });
});
