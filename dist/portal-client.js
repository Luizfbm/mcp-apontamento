import { authorize as runAuthorization } from './auth.js';
const s = (value) => value == null ? '' : String(value);
const formatDate = (value) => {
    const text = s(value);
    const match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
    return match ? `${match[3]}-${match[2]}-${match[1]}` : text.slice(0, 10);
};
const agendaFromPortal = (row) => ({
    id_agenda: s(row.ID ?? row.IDAGENDA ?? row.id_agenda),
    data: formatDate(row.DATAAGENDA ?? row.DTAGENDA ?? row.data),
    id_projeto: s(row.IDPRJ ?? row.IDPMS ?? row.id_projeto),
    projeto: s(row.NOMEPROJETO ?? row.PROJETO ?? row.projeto),
    coordenador: s(row.NOMECOORDENADOR ?? row.COORDENADOR ?? row.coordenador),
    cliente: s(row.CLIENTE ?? row.NOMECLIENTE ?? row.cliente),
    ...((row.HORAINICIO || row.HORAFIM) ? { horario: `${s(row.HORAINICIO).slice(0, 5)}-${s(row.HORAFIM).slice(0, 5)}` } : {}),
    ...((row.IDAPONTAMENTO != null || row.tem_apontamento != null) ? {
        tem_apontamento: row.tem_apontamento != null
            ? Boolean(row.tem_apontamento)
            : !['', '0', 'false', 'null'].includes(s(row.IDAPONTAMENTO).toLowerCase()),
    } : {}),
});
export class HttpPortalClient {
    options;
    fetcher;
    authorize;
    agendaCache = new Map();
    constructor(options) {
        this.options = options;
        this.fetcher = options.fetcher ?? fetch;
        this.authorize = options.authorize ?? (() => runAuthorization({ portalUrl: options.portalUrl, fetcher: this.fetcher }));
    }
    async token(force = false) {
        let token = force ? null : await this.options.tokenStore.read();
        if (token && Date.parse(token.expires_at) <= Date.now()) {
            await this.options.tokenStore.clear();
            token = null;
        }
        if (!token) {
            try {
                token = await this.authorize();
            }
            catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                if (message.includes('expirou após 5 minutos'))
                    throw new Error('Autorize o MCP no navegador que abriu e tente de novo.');
                throw error;
            }
            await this.options.tokenStore.write(token);
        }
        return token;
    }
    async request(path, init = {}, retry = true) {
        const token = await this.token();
        const response = await this.fetcher(new URL(path, this.options.portalUrl), {
            ...init,
            headers: { ...init.headers, authorization: `Bearer ${token.access_token}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
        });
        if (response.status === 401) {
            const body = await response.clone().json().catch(() => ({}));
            if (retry && body.code === 'mcp_token_invalid') {
                await this.options.tokenStore.clear();
                await this.token(true);
                return this.request(path, init, false);
            }
        }
        return response;
    }
    async json(path, init) {
        const response = await this.request(path, init);
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(s(body.message) || `Portal respondeu HTTP ${response.status}.`);
        }
        return response.status === 204 ? undefined : await response.json();
    }
    async me() {
        const data = await this.json('/api/mcp/me');
        return { username: s(data.username), nome: s(data.nome), codcfo: s(data.codcfo), expires_at: s(data.expires_at) };
    }
    async meuCodcfo() {
        const { codcfo } = await this.me();
        if (!codcfo)
            throw new Error('Seu usuário não está vinculado a um analista (CFO) no RM. Peça o vínculo ao administrativo.');
        return codcfo;
    }
    async agendas(dataInicio, dataFim) {
        return this.projectsByDate(await this.meuCodcfo(), dataInicio, dataFim);
    }
    async projectsByDate(codcfo, dataInicio, dataFim) {
        const query = new URLSearchParams({ codcfo, startDate: dataInicio, endDate: dataFim });
        const rows = await this.json(`/api/projects-by-date?${query}`);
        const agendas = Array.isArray(rows) ? rows.map(agendaFromPortal) : [];
        agendas.forEach((agenda) => this.agendaCache.set(`${agenda.id_agenda}:${agenda.data}`, agenda));
        return agendas;
    }
    async agenda(idAgenda, dataAgenda) {
        const cached = this.agendaCache.get(`${idAgenda}:${dataAgenda}`);
        if (cached)
            return cached;
        const found = (await this.projectsByDate(await this.meuCodcfo(), dataAgenda, dataAgenda)).find((item) => item.id_agenda === idAgenda);
        if (found)
            return found;
        throw new Error(`A agenda ${idAgenda} não existe em ${dataAgenda} para você; consulte minhas_agendas`);
    }
    async atividades(idAgenda) {
        const query = new URLSearchParams({ idagenda: idAgenda, codcfo: await this.meuCodcfo() });
        const rows = await this.json(`/api/apontador/atividades-agenda?${query}`);
        return Array.isArray(rows) ? rows.map((row) => ({ id_tarefa: s(row.IDATIVIDADE ?? row.IDTAREFA ?? row.ID ?? row.id_tarefa), nome: s(row.ATIVIDADE ?? row.TAREFA ?? row.NOME ?? row.DESCRICAO ?? row.nome), codigo: s(row.CODATIVIDADE ?? row.CODTAREFA ?? row.CODIGO ?? row.codigo) })) : [];
    }
    async pendentes(dataInicio, dataFim) {
        const query = new URLSearchParams({ data_inicio: dataInicio, data_fim: dataFim });
        const data = await this.json(`/api/mcp/pendentes?${query}`);
        return (data.pendentes ?? []).map((row) => ({ id_agenda: s(row.id_agenda), data: s(row.data), id_projeto: s(row.id_projeto), projeto: s(row.projeto), cliente: s(row.cliente), coordenador: s(row.coordenador), horas_agendadas: s(row.horas_agendadas) }));
    }
    async lancar(body) {
        const response = await this.request('/api/apontador/apontamentos', { method: 'POST', body: JSON.stringify(body) });
        const payload = await response.json().catch(() => ({}));
        const mensagem = s(payload.message) || (response.ok ? 'Apontamento recebido pelo Portal.' : `Portal respondeu HTTP ${response.status}.`);
        const status = response.status === 201 ? 'GRAVADO'
            : response.status === 200 ? 'AGUARDANDO_APROVACAO'
                : response.status === 400 ? 'BLOQUEADO'
                    : response.status === 403 ? 'SEM_ACESSO' : 'ERRO';
        return { status, mensagem };
    }
}
export { agendaFromPortal };
