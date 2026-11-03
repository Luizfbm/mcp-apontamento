export type UserInfo = {
  username: string;
  nome: string;
  codcfo: string;
  expires_at: string;
};

export type Agenda = {
  id_agenda: string;
  data: string;
  id_projeto: string;
  projeto: string;
  coordenador: string;
  cliente: string;
  horario?: string;
  tem_apontamento?: boolean;
};

export type PendingAgenda = Pick<Agenda, 'id_agenda' | 'data' | 'id_projeto' | 'projeto' | 'coordenador' | 'cliente'> & {
  horas_agendadas: string;
};

export type Activity = { id_tarefa: string; nome: string; codigo: string };

export type TokenRecord = {
  access_token: string;
  expires_at: string;
  username: string;
};

export type AppointmentStatus = 'GRAVADO' | 'AGUARDANDO_APROVACAO' | 'BLOQUEADO' | 'SEM_ACESSO' | 'CANCELADO' | 'CONFIRMACAO_PENDENTE' | 'ERRO';

export type AppointmentResult = {
  status: AppointmentStatus;
  mensagem: string;
  apontamento: {
    id_agenda: string;
    data: string;
    projeto: string;
    id_tarefa: string;
    hora_inicio: string;
    hora_fim: string;
    intervalo: string;
    total_horas: string;
    detalhamento: string;
  };
};
