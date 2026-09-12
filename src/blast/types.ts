/**
 * Tipos e interfaces para o módulo Disparador de Mensagem (Blast)
 */

export type BlastQueueItemStatus = 'pending' | 'sent' | 'failed' | 'cancelled';

export type BlastCampaignStatus = 'idle' | 'running' | 'paused' | 'completed' | 'cancelled';

export interface BlastContact {
  name: string;
  phone: string;
}

export interface BlastQueueItem {
  id: string;
  recipientName: string;
  phone: string;
  originalMessage: string;
  generatedMessage: string;
  status: BlastQueueItemStatus;
  sentAt?: string;
  errorMessage?: string;
}

export interface BlastSettings {
  /** Intervalo minimo entre envios (segundos) */
  minInterval: number;
  /** Intervalo maximo entre envios (segundos) */
  maxInterval: number;
  /** Quantidade de envios por lote antes de pausar */
  batchSize: number;
  /** Tempo de pausa entre lotes (minutos) */
  batchPauseMinutes: number;
}

export interface BlastCampaign {
  id: string;
  name: string;
  /** ID do agente / sessao WAHA a ser usado */
  agentId: string;
  /** Mensagem base com suporte a variavel {{nome}} */
  baseMessage: string;
  contacts: BlastContact[];
  queue: BlastQueueItem[];
  settings: BlastSettings;
  status: BlastCampaignStatus;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}
