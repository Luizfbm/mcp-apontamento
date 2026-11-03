import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
const agendaItemSchema = z.object({
    id_agenda: z.string(), data: z.string(), id_projeto: z.string(), projeto: z.string(),
    coordenador: z.string(), cliente: z.string(), horario: z.string().optional(), tem_apontamento: z.boolean().optional(),
});
const activitySchema = z.object({ id_tarefa: z.string(), nome: z.string(), codigo: z.string() });
const pendingSchema = z.object({ id_agenda: z.string(), data: z.string(), id_projeto: z.string(), projeto: z.string(), cliente: z.string(), coordenador: z.string(), horas_agendadas: z.string() });
const appointmentSchema = z.object({
    status: z.enum(['GRAVADO', 'AGUARDANDO_APROVACAO', 'BLOQUEADO', 'SEM_ACESSO', 'CANCELADO', 'CONFIRMACAO_PENDENTE', 'ERRO']),
    mensagem: z.string(),
    apontamento: z.object({ id_agenda: z.string(), data: z.string(), projeto: z.string(), id_tarefa: z.string(), hora_inicio: z.string(), hora_fim: z.string(), intervalo: z.string(), total_horas: z.string(), detalhamento: z.string() }),
});
const isoToday = () => {
    const today = new Date();
    return `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
};
const dateValid = (date) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date))
        return false;
    const parsed = new Date(`${date}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
};
const parseMinutes = (time) => {
    if (!/^\d{2}:\d{2}$/.test(time))
        return null;
    const [h, m] = time.split(':').map(Number);
    return h <= 23 && m < 60 ? h * 60 + m : null;
};
const asTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const emptyAppt = () => ({ id_agenda: '', data: '', projeto: '', id_tarefa: '', hora_inicio: '', hora_fim: '', intervalo: '00:00', total_horas: '', detalhamento: '' });
const result = (status, mensagem, apontamento = emptyAppt()) => ({ status, mensagem, apontamento });
export function createMcpServer(portal) {
    const server = new McpServer({ name: 'mcp-apontamento', version: '1.0.0' }, {
        instructions: 'Use minhas_agendas para localizar uma agenda, atividades_da_agenda para listar tarefas e lancar_apontamento para registrar as horas. O lançamento sempre exige confirmação do analista.',
    });
    const text = (message) => [{ type: 'text', text: message }];
    const dateBounds = (inicio, fim) => {
        const today = isoToday();
        const start = inicio ?? today;
        const end = fim ?? today;
        if (!dateValid(start) || !dateValid(end) || start > end)
            throw new Error('Informe datas válidas no formato YYYY-MM-DD, com início anterior ou igual ao fim.');
        return [start, end];
    };
    const sendProgress = async (extra, progress, message) => {
        const token = extra._meta?.progressToken;
        if (token !== undefined)
            await server.server.notification({ method: 'notifications/progress', params: { progressToken: token, progress, total: 4, message } });
    };
    server.registerTool('minhas_agendas', {
        description: 'Lista as agendas do analista no período, com os dados necessários para apontar. Use primeiro para encontrar id_agenda; em seguida, consulte atividades_da_agenda e só então lance com lancar_apontamento. Sem datas, consulta hoje.',
        inputSchema: { data_inicio: z.string().optional(), data_fim: z.string().optional() },
        outputSchema: { agendas: z.array(agendaItemSchema) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async ({ data_inicio, data_fim }) => {
        const [start, end] = dateBounds(data_inicio, data_fim);
        const agendas = await portal.agendas(start, end);
        return { structuredContent: { agendas }, content: text(`${agendas.length} agenda(s) encontrada(s).`) };
    });
    server.registerTool('atividades_da_agenda', {
        description: 'Lista as tarefas elegíveis para uma agenda. Use depois de minhas_agendas e antes de lancar_apontamento.',
        inputSchema: { id_agenda: z.string().min(1) },
        outputSchema: { atividades: z.array(activitySchema) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async ({ id_agenda }) => {
        const atividades = await portal.atividades(id_agenda);
        return { structuredContent: { atividades }, content: text(`${atividades.length} atividade(s) elegível(is) para a agenda ${id_agenda}.`) };
    });
    server.registerTool('apontamentos_pendentes', {
        description: 'Lista agendas do próprio analista sem apontamento no período. Sem datas, consulta os últimos 30 dias até hoje.',
        inputSchema: { data_inicio: z.string().optional(), data_fim: z.string().optional() },
        outputSchema: { pendentes: z.array(pendingSchema) },
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true },
    }, async ({ data_inicio, data_fim }) => {
        const today = isoToday();
        const startDefault = new Date();
        startDefault.setDate(startDefault.getDate() - 30);
        const defaultStart = `${startDefault.getFullYear()}-${String(startDefault.getMonth() + 1).padStart(2, '0')}-${String(startDefault.getDate()).padStart(2, '0')}`;
        const [start, end] = dateBounds(data_inicio ?? defaultStart, data_fim ?? today);
        const pendentes = await portal.pendentes(start, end);
        return { structuredContent: { pendentes }, content: text(`${pendentes.length} agenda(s) pendente(s).`) };
    });
    server.registerTool('lancar_apontamento', {
        description: 'Registra horas para uma agenda e tarefa. Primeiro consulte minhas_agendas e atividades_da_agenda; informe data_agenda exatamente como retornada para a agenda escolhida. O servidor pede confirmação ao usuário por elicitation quando disponível; se ela falhar ou não for suportada, mostre o resumo e repita com confirmar: true após a confirmação do usuário.',
        inputSchema: { id_agenda: z.string().min(1), data_agenda: z.string(), id_tarefa: z.string().min(1), hora_inicio: z.string(), hora_fim: z.string(), intervalo: z.string().optional(), detalhamento: z.string(), confirmar: z.boolean().optional() },
        outputSchema: appointmentSchema,
        annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false },
    }, async (args, extra) => {
        const intervalo = args.intervalo ?? '00:00';
        const startMinutes = parseMinutes(args.hora_inicio);
        const endMinutes = parseMinutes(args.hora_fim);
        const breakMinutes = parseMinutes(intervalo);
        if (startMinutes === null || endMinutes === null || breakMinutes === null)
            return { structuredContent: result('ERRO', 'Horas inválidas; use HH:MM.'), content: text('Horas inválidas; use HH:MM.') };
        if (endMinutes <= startMinutes)
            return { structuredContent: result('ERRO', 'A hora de fim deve ser posterior à hora de início.'), content: text('A hora de fim deve ser posterior à hora de início.') };
        const total = endMinutes - startMinutes - breakMinutes;
        if (total <= 0)
            return { structuredContent: result('ERRO', 'O total de horas precisa ser maior que zero.'), content: text('O total de horas precisa ser maior que zero.') };
        if (!args.detalhamento.trim())
            return { structuredContent: result('ERRO', 'O detalhamento não pode ficar vazio.'), content: text('O detalhamento não pode ficar vazio.') };
        if (!dateValid(args.data_agenda))
            return { structuredContent: result('ERRO', 'Informe data_agenda no formato YYYY-MM-DD.'), content: text('Informe data_agenda no formato YYYY-MM-DD.') };
        await sendProgress(extra, 1, 'Buscando agenda');
        let agenda;
        let me;
        try {
            me = await portal.me();
            agenda = await portal.agenda(args.id_agenda, args.data_agenda);
        }
        catch (error) {
            const message = authMessage(error);
            return { structuredContent: result('ERRO', message), content: text(message) };
        }
        const appt = { id_agenda: agenda.id_agenda, data: agenda.data, projeto: agenda.projeto, id_tarefa: args.id_tarefa, hora_inicio: args.hora_inicio, hora_fim: args.hora_fim, intervalo, total_horas: asTime(total), detalhamento: args.detalhamento };
        await sendProgress(extra, 2, 'Confirmando lançamento');
        if (server.server.getClientCapabilities()?.elicitation?.form) {
            try {
                const elicitation = await server.server.elicitInput({ mode: 'form', message: `Confirme o apontamento: ${agenda.data}, ${agenda.projeto}, tarefa ${args.id_tarefa}, ${args.hora_inicio}–${args.hora_fim}, intervalo ${intervalo}, total ${appt.total_horas}. Detalhamento: ${args.detalhamento}`, requestedSchema: { type: 'object', properties: { confirmar: { type: 'boolean', title: 'Confirmo o lançamento' } }, required: ['confirmar'] } });
                if (elicitation.action !== 'accept' || elicitation.content?.confirmar !== true) {
                    const canceled = result('CANCELADO', 'Lançamento cancelado; nada foi gravado.', appt);
                    return { structuredContent: canceled, content: text(canceled.mensagem) };
                }
            }
            catch {
                if (args.confirmar !== true) {
                    const pending = result('CONFIRMACAO_PENDENTE', `Mostre o resumo ao usuário e chame de novo com confirmar: true. ${appointmentSummary(appt)}`, appt);
                    return { structuredContent: pending, content: text(pending.mensagem) };
                }
            }
        }
        else if (args.confirmar !== true) {
            const pending = result('CONFIRMACAO_PENDENTE', `Mostre o resumo ao usuário e chame de novo com confirmar: true. ${appointmentSummary(appt)}`, appt);
            return { structuredContent: pending, content: text(pending.mensagem) };
        }
        await sendProgress(extra, 3, 'Gravando no Portal');
        const body = { ZMDAPONTAMENTO: [{
                    IDAGENDA: agenda.id_agenda,
                    DTAGENDA: `${agenda.data}T00:00:00.000Z`,
                    IDTAREFA: args.id_tarefa,
                    IDPRJ: agenda.id_projeto,
                    PROJETO: agenda.projeto,
                    COORDENADOR: agenda.coordenador,
                    ANALISTA: me.nome,
                    USUARIO_ANALISTA: me.username,
                    CODCFO_ANALISTA: me.codcfo,
                    HORAINICIO: args.hora_inicio,
                    INTERVALO: intervalo,
                    HORAFIM: args.hora_fim,
                    TOTALHORAS: appt.total_horas,
                    DETALHAMENTO: args.detalhamento,
                    AVANSOFISICO: null,
                    STATUS: 'PENDENTE',
                }] };
        let posted;
        try {
            posted = await portal.lancar(body);
        }
        catch (error) {
            const failed = result('ERRO', error instanceof Error ? error.message : 'Erro ao lançar apontamento.', appt);
            return { structuredContent: failed, content: text(failed.mensagem) };
        }
        await sendProgress(extra, 4, 'Lançamento concluído');
        const final = result(posted.status, posted.mensagem, appt);
        return { structuredContent: final, content: text(final.mensagem) };
    });
    return server;
}
function appointmentSummary(a) {
    return `Data: ${a.data}; projeto: ${a.projeto}; tarefa: ${a.id_tarefa}; início: ${a.hora_inicio}; fim: ${a.hora_fim}; intervalo: ${a.intervalo}; total: ${a.total_horas}; detalhamento: ${a.detalhamento}.`;
}
function authMessage(error) {
    const message = error instanceof Error ? error.message : 'Erro desconhecido.';
    return message.includes('expirou após 5 minutos') ? 'Autorize o MCP no navegador que abriu e tente de novo.' : message;
}
export async function runStdioServer(portal) {
    const server = createMcpServer(portal);
    await server.connect(new StdioServerTransport());
    return server;
}
