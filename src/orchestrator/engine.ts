import { IAgent, AgentContext, AgentResponse } from './agents/base.js';
import { BusinessHoursAgent } from './agents/business-hours.js';
import { HandoffAgent } from './agents/handoff.js';
import { AttendantAgent } from './agents/attendant.js';
import { messageDebouncer } from './debouncer.js';
import { botTracker } from './bot-tracker.js';
import { memoryStore } from '../gemini/memory.js';
import { wahaClient } from '../waha/client.js';
import { loadBotConfig, env } from '../config/index.js';
import { WahaMessagePayload } from '../waha/types.js';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'incoming' | 'outgoing' | 'info' | 'warn' | 'error' | 'handoff';
  chatId: string;
  contactName?: string;
  message: string;
  agentName?: string;
}

export class AgentOrchestrator {
  private agents: IAgent[] = [];
  private logs: LogEntry[] = [];
  private maxLogs: number = 200;
  private processedMessageIds: Set<string> = new Set();
  private botStartTime: number = Date.now();

  constructor() {
    // Ordem de prioridade dos agentes:
    // 1. BusinessHoursAgent (verifica se está fora do horário comercial)
    // 2. HandoffAgent (checa se o cliente quer atendente humano)
    // 3. AttendantAgent (IA: Google Gemini / OpenAI)
    this.agents = [
      new BusinessHoursAgent(),
      new HandoffAgent(),
      new AttendantAgent()
    ];

    // Registra o callback do debouncer
    messageDebouncer.registerHandler(this.handleDebouncedMessage.bind(this));
  }

  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    const log: LogEntry = {
      ...entry,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString('pt-BR')
    };
    this.logs.unshift(log);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
  }

  getLogs(): LogEntry[] {
    return this.logs;
  }

  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Ponto de entrada do Webhook da WAHA
   */
  async processIncomingWahaMessage(payload: WahaMessagePayload, sessionName: string): Promise<void> {
    const { from, to, fromMe, body, hasMedia } = payload;

    // 0. Deduplicação de mensagens idênticas (evita duplicar eventos da WAHA como message e message.any)
    if (payload.id) {
      if (this.processedMessageIds.has(payload.id)) {
        return;
      }
      this.processedMessageIds.add(payload.id);
      if (this.processedMessageIds.size > 2000) {
        const first = this.processedMessageIds.values().next().value;
        if (first) this.processedMessageIds.delete(first);
      }
    }

    // Determina o chatId remoto do cliente
    let chatId = from;
    if (fromMe) {
      chatId = to || payload._data?.to || payload._data?.id?.remote || from;
    }

    // 1. Descartar mensagens antigas ou sincronizadas do histórico (stale messages ao reconectar WAHA)
    if (payload.timestamp) {
      const msgTimeMs = payload.timestamp > 1e11 ? payload.timestamp : payload.timestamp * 1000;
      const now = Date.now();
      const ageSeconds = Math.round((now - msgTimeMs) / 1000);
      const maxAgeSeconds = 120; // Limite de 2 minutos

      // Se a mensagem for anterior ao início do bot ou tiver mais de 2 minutos
      if (ageSeconds > maxAgeSeconds || msgTimeMs < (this.botStartTime - 15000)) {
        console.log(`[Orchestrator] Mensagem antiga de ${chatId} ignorada (${ageSeconds}s atrás): "${body}"`);
        this.addLog({
          type: 'info',
          chatId,
          message: `Mensagem antiga/histórico ignorada (${ageSeconds}s atrás): "${body}"`
        });
        return;
      }
    }

    // 2. Ignorar canais de status e newsletter
    if (chatId.includes('status@broadcast') || chatId.includes('@newsletter')) {
      return;
    }

    // 3. Se for grupo (@g.us) e desejar ignorar grupos por padrão:
    if (chatId.includes('@g.us')) {
      console.log(`[Orchestrator] Mensagem de grupo ignorada: ${chatId}`);
      return;
    }

    // 4. Se a mensagem foi enviada pelo próprio número (fromMe === true)
    // Isso acontece quando um ATENDENTE HUMANO no Chatwoot ou no celular responde ao cliente!
    if (fromMe) {
      // Verifica se a mensagem foi enviada pelo próprio BotZap
      if (botTracker.isSentByBot(chatId, body || '', payload.id)) {
        // É o eco da resposta do próprio bot, ignora e NÃO pausa
        return;
      }

      const config = loadBotConfig();
      const pauseMinutes = config.pauseDurationMinutes || (config.pauseDurationHours ? config.pauseDurationHours * 60 : 360);
      const pauseHours = config.pauseDurationHours || (pauseMinutes / 60);

      // Pausa o bot automaticamente para não atropelar a conversa do atendente humano
      memoryStore.pauseChat(chatId, pauseMinutes);
      messageDebouncer.cancel(chatId);

      this.addLog({
        type: 'info',
        chatId,
        message: `Intervenção humana detectada (WhatsApp/Chatwoot). Bot pausado para ${chatId} por ${pauseHours} horas.`
      });
      return;
    }

    // 4. Se o bot estiver pausado para este chatId, ignora
    if (memoryStore.isChatPaused(chatId)) {
      console.log(`[Orchestrator] Bot pausado para ${chatId}, ignorando processamento.`);
      this.addLog({
        type: 'info',
        chatId,
        message: `Mensagem recebida mas bot está pausado para este contato: "${body}"`
      });
      return;
    }

    // 5. Verifica se há texto válido
    if (!body || body.trim() === '') {
      if (hasMedia) {
        this.addLog({
          type: 'info',
          chatId,
          message: 'Mensagem com mídia recebida sem legenda.'
        });
      }
      return;
    }

    const contactName = payload._data?.notifyName || payload.from.split('@')[0];

    this.addLog({
      type: 'incoming',
      chatId,
      contactName,
      message: body
    });

    // 6. Envia mensagem para o debouncer (buffer de mensagens consecutivas)
    messageDebouncer.enqueue(chatId, body, contactName);
  }

  /**
   * Processa a mensagem unificada após a janela de debounce
   */
  private async handleDebouncedMessage(chatId: string, messageText: string, contactName?: string): Promise<void> {
    const config = loadBotConfig();
    const session = env.wahaSession;

    // 1. Confirmação de leitura (sendSeen) e indicador de digitação (startTyping)
    if (config.enableSendSeen) {
      await wahaClient.sendSeen(chatId, session);
    }

    if (config.enableTypingSimulation) {
      await wahaClient.startTyping(chatId, session);
    }

    const context: AgentContext = {
      chatId,
      userMessage: messageText,
      contactName,
      session
    };

    let response: AgentResponse | null = null;

    try {
      // 2. Execução pela esteira de agentes
      for (const agent of this.agents) {
        const canHandle = await agent.canHandle(context);
        if (canHandle) {
          response = await agent.execute(context);
          if (response.handled) {
            break;
          }
        }
      }

      // 3. Aguarda um pequeno delay para humanizar a resposta
      if (config.enableTypingSimulation) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await wahaClient.stopTyping(chatId, session);
      }

      // 4. Envia a resposta final via WAHA
      if (response && response.replyText) {
        const sendResult = await wahaClient.sendText(chatId, response.replyText, { session });
        botTracker.recordBotMessage(chatId, response.replyText, sendResult?.id);

        this.addLog({
          type: response.action === 'transferred_human' ? 'handoff' : 'outgoing',
          chatId,
          contactName,
          message: response.replyText,
          agentName: response.agentName
        });
      }
    } catch (error: any) {
      if (config.enableTypingSimulation) {
        await wahaClient.stopTyping(chatId, session);
      }
      console.error(`[Orchestrator] Falha no processamento de ${chatId}:`, error.message);
      this.addLog({
        type: 'error',
        chatId,
        message: `Erro ao responder: ${error.message}`
      });
    }
  }

  /**
   * Permite executar uma simulação direta (para teste no painel web)
   */
  async simulateMessage(chatId: string, messageText: string): Promise<AgentResponse> {
    const context: AgentContext = {
      chatId,
      userMessage: messageText,
      contactName: 'Cliente Teste',
      session: 'simulator'
    };

    for (const agent of this.agents) {
      const canHandle = await agent.canHandle(context);
      if (canHandle) {
        const res = await agent.execute(context);
        if (res.handled) {
          return res;
        }
      }
    }

    return {
      handled: false,
      replyText: 'Nenhum agente pôde responder.',
      agentName: 'None'
    };
  }
}

export const orchestrator = new AgentOrchestrator();
