import { IAgent, AgentContext, AgentResponse } from './agents/base.js';
import { BusinessHoursAgent } from './agents/business-hours.js';
import { MediaHandoffAgent } from './agents/media-handoff.js';
import { HandoffAgent } from './agents/handoff.js';
import { BookingAgent } from './agents/booking.js';
import { ExamDeliveryAgent } from './agents/exam-delivery.js';
import { AttendantAgent } from './agents/attendant.js';
import { messageDebouncer } from './debouncer.js';
import { botTracker } from './bot-tracker.js';
import { memoryStore } from '../gemini/memory.js';
import { wahaClient } from '../waha/client.js';
import { loadBotConfig, env } from '../config/index.js';
import { agentManager } from '../config/agent-manager.js';
import { WahaMessagePayload } from '../waha/types.js';
import { getAlternateBrazilianChatId } from '../appointments/phone-utils.js';
import { audioTranscriber } from './audio-transcriber.js';

export interface LogEntry {
  id: string;
  timestamp: string;
  type: 'incoming' | 'outgoing' | 'info' | 'warn' | 'error' | 'handoff';
  chatId: string;
  contactName?: string;
  message: string;
  agentId?: string;
  agentName?: string;
  companyName?: string;
}

export class AgentOrchestrator {
  private agents: IAgent[] = [];
  private logs: LogEntry[] = [];
  private maxLogs: number = 500;
  private processedMessageIds: Set<string> = new Set();
  private botStartTime: number = Date.now();

  constructor() {
    // Ordem de prioridade dos agentes:
    // 1. BusinessHoursAgent (verifica se está fora do horário comercial)
    // 2. MediaHandoffAgent (detecta fotos de pedidos médicos/laudos e transfere para humanizado)
    // 3. HandoffAgent (checa se o cliente quer atendente humano)
    // 4. ExamDeliveryAgent (Validação dos 3 primeiros dígitos do CPF e entrega de exames LGPD)
    // 5. BookingAgent (Agendamentos, anti-conflitos e confirmação D-1)
    // 6. AttendantAgent (IA: Google Gemini / OpenAI)
    this.agents = [
      new BusinessHoursAgent(),
      new MediaHandoffAgent(),
      new HandoffAgent(),
      new ExamDeliveryAgent(),
      new BookingAgent(),
      new AttendantAgent()
    ];

    // Registra o callback do debouncer
    messageDebouncer.registerHandler(this.handleDebouncedMessage.bind(this));
  }

  /**
   * Identifica se a mensagem recebida é um áudio ou gravação de voz (PTT)
   */
  isAudioMessage(payload: WahaMessagePayload): boolean {
    if (!payload.hasMedia) return false;
    const type = (payload._data?.type || '').toLowerCase();
    const mime = (payload.media?.mimetype || payload._data?.mimetype || '').toLowerCase();
    return (
      type === 'ptt' ||
      type === 'audio' ||
      mime.startsWith('audio/') ||
      mime.includes('audio') ||
      mime.includes('ogg') ||
      mime.includes('opus')
    );
  }

  /**
   * Identifica se a mensagem recebida é uma imagem/foto (pedido médico, laudo, receita)
   */
  isImageMessage(payload: WahaMessagePayload): boolean {
    if (!payload.hasMedia) return false;
    const type = (payload._data?.type || '').toLowerCase();
    const mime = (payload.media?.mimetype || payload._data?.mimetype || '').toLowerCase();
    return (
      type === 'image' ||
      mime.startsWith('image/')
    );
  }

  /**
   * Identifica se a mensagem recebida é um documento (PDF de laudo, requisição, etc.)
   */
  isDocumentMessage(payload: WahaMessagePayload): boolean {
    if (!payload.hasMedia) return false;
    const type = (payload._data?.type || '').toLowerCase();
    const mime = (payload.media?.mimetype || payload._data?.mimetype || '').toLowerCase();
    return (
      type === 'document' ||
      mime.startsWith('application/pdf') ||
      mime.includes('pdf') ||
      mime.includes('document') ||
      mime.includes('msword') ||
      mime.includes('officedocument')
    );
  }

  addLog(entry: Omit<LogEntry, 'id' | 'timestamp'>): void {
    let agentId = entry.agentId;
    let agentName = entry.agentName;
    let companyName = entry.companyName;

    // 1. Se agentId foi fornecido mas não agentName ou companyName, auto-completa
    if (agentId && (!agentName || !companyName)) {
      const a = agentManager.getAgent(agentId);
      if (a) {
        if (!agentName) agentName = a.name;
        if (!companyName) companyName = a.companyName || a.name;
      }
    } else if (!agentId && agentName) {
      // 2. Se apenas agentName foi fornecido, descobre agentId e companyName
      const all = agentManager.listAgents();
      const match = all.find(a => a.name.toLowerCase() === agentName!.toLowerCase() || a.companyName?.toLowerCase() === agentName!.toLowerCase());
      if (match) {
        agentId = match.id;
        companyName = match.companyName || match.name;
      }
    } else if (!agentId && !agentName && entry.message) {
      // 3. Se não passou agentId/agentName, verifica se a mensagem menciona o bot/empresa
      const all = agentManager.listAgents();
      for (const a of all) {
        if (
          entry.message.includes(`[${a.name}]`) ||
          entry.message.includes(`Bot [${a.name}]`) ||
          (a.companyName && entry.message.includes(a.companyName))
        ) {
          agentId = a.id;
          agentName = a.name;
          companyName = a.companyName || a.name;
          break;
        }
      }
    }

    const log: LogEntry = {
      ...entry,
      id: Math.random().toString(36).substring(2, 9),
      timestamp: new Date().toLocaleTimeString('pt-BR'),
      agentId,
      agentName,
      companyName
    };
    this.logs.unshift(log);
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(0, this.maxLogs);
    }
  }

  getLogs(agentId?: string): LogEntry[] {
    if (!agentId || agentId === 'all' || agentId === '*') {
      return this.logs;
    }
    return this.logs.filter(l => l.agentId === agentId);
  }

  clearLogs(agentId?: string): void {
    if (!agentId || agentId === 'all' || agentId === '*') {
      this.logs = [];
    } else {
      this.logs = this.logs.filter(l => l.agentId !== agentId);
    }
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

    // REGRA ESTRITA: Nossos bots e assistentes NUNCA interagem em grupos do WhatsApp (@g.us).
    // Apenas conversas diretas e individuais com clientes/pacientes (@c.us / @s.whatsapp.net) são atendidas.
    const isGroupMessage =
      (from && from.includes('@g.us')) ||
      (to && to.includes('@g.us')) ||
      ((payload as any).participant !== undefined && (payload as any).participant !== null) ||
      (payload._data?.id?.remote && payload._data.id.remote.includes('@g.us')) ||
      (payload._data?.from && payload._data.from.includes('@g.us'));

    if (isGroupMessage) {
      return;
    }

    // Determina o chatId remoto do cliente
    let chatId = from;
    if (fromMe) {
      chatId = to || payload._data?.to || payload._data?.id?.remote || from;
    }

    if (chatId && chatId.includes('@g.us')) {
      return;
    }

    // Remove sufixo de dispositivo multi-device (:1, :0, etc) antes de @
    if (chatId && chatId.includes(':') && (chatId.includes('@c.us') || chatId.includes('@s.whatsapp.net'))) {
      const atIdx = chatId.indexOf('@');
      const colonIdx = chatId.indexOf(':');
      if (colonIdx !== -1 && colonIdx < atIdx) {
        chatId = chatId.substring(0, colonIdx) + chatId.substring(atIdx);
      }
    }

    // Se o chatId veio no formato @lid (Linked Device), traduz para o chatId do telefone real (@c.us)
    if (chatId && chatId.endsWith('@lid')) {
      const realPhone = payload._data?.author ||
        payload._data?.key?.participant ||
        payload._data?.id?.participant ||
        payload._data?.participant ||
        payload.replyTo?.participant ||
        payload._data?.from;
      if (realPhone && (realPhone.endsWith('@c.us') || realPhone.endsWith('@s.whatsapp.net'))) {
        let cleanReal = realPhone;
        if (cleanReal.includes(':')) {
          const atIdx = cleanReal.indexOf('@');
          const colonIdx = cleanReal.indexOf(':');
          if (colonIdx !== -1 && colonIdx < atIdx) {
            cleanReal = cleanReal.substring(0, colonIdx) + cleanReal.substring(atIdx);
          }
        }
        console.log(`[Orchestrator] Mapeado chatId LID ${chatId} para telefone real: ${cleanReal}`);
        chatId = cleanReal;
      }
    }

    // Normaliza @s.whatsapp.net para @c.us
    if (chatId && chatId.endsWith('@s.whatsapp.net')) {
      chatId = chatId.replace('@s.whatsapp.net', '@c.us');
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

    // Resolve o perfil do agente correspondente a esta sessão da WAHA
    const agent = agentManager.getAgentBySession(sessionName);
    if (!agent || !agent.active) {
      console.log(`[Orchestrator] Sessão "${sessionName}" sem agente ativo associado. Ignorando.`);
      return;
    }

    // BLINDAGEM DE SEGURANÇA: Verificar se o agente está globalmente pausado (botão de pânico)
    if (agent.isPausedGlobally) {
      const pausedUntil = agent.pausedGloballyUntil;
      // Se tem tempo de expiração e já passou, remove a pausa automaticamente
      if (pausedUntil && Date.now() > pausedUntil) {
        agentManager.updateAgent(agent.id, { isPausedGlobally: false, pausedGloballyUntil: undefined });
        console.log(`[SEGURANÇA][${agent.id}] Pausa global expirou automaticamente. Agente reativado.`);
      } else {
        console.warn(`[SEGURANÇA][${agent.id}] ⛔ Mensagem de ${chatId} BLOQUEADA — agente pausado globalmente (pânico). Sessão: "${sessionName}".`);
        this.addLog({
          type: 'info',
          chatId,
          message: `⛔ Mensagem bloqueada — Agente "${agent.name}" está pausado globalmente por emergência.`,
          agentName: agent.name
        });
        return;
      }
    }


    // 4. Se a mensagem foi enviada pelo próprio número (fromMe === true)
    // Isso acontece quando um ATENDENTE HUMANO no Chatwoot ou no celular responde ao cliente!
    if (fromMe) {
      // Verifica se a mensagem foi enviada pelo próprio BotZap
      if (botTracker.isSentByBot(chatId, body || '', payload.id)) {
        // É o eco da resposta do próprio bot, ignora e NÃO pausa
        return;
      }

      const pauseMinutes = (agent.pauseDurationHours ? agent.pauseDurationHours * 60 : agent.pauseDurationMinutes) || 360;
      const pauseHours = pauseMinutes / 60;

      // Pausa o bot automaticamente para não atropelar a conversa do atendente humano
      memoryStore.pauseChat(chatId, pauseMinutes, agent.id);
      messageDebouncer.cancel(chatId, sessionName);

      this.addLog({
        type: 'info',
        chatId,
        message: `Intervenção humana detectada (WhatsApp/Chatwoot). Bot [${agent.name}] pausado para ${chatId} por ${pauseHours} horas.`
      });
      return;
    }

    // Sanitização inteligente do nome do contato: só usa se for um nome real de perfil, nunca o número de telefone
    const rawNotifyName = (payload._data?.notifyName || '').trim();
    const isNumericName = /^[\d\s\-()+]+$/.test(rawNotifyName);
    const contactName = (rawNotifyName && !isNumericName && !rawNotifyName.includes('@'))
      ? rawNotifyName
      : undefined;

    let effectiveBody = body || '';
    let transcribedAudioText = '';
    const isAudio = this.isAudioMessage(payload);
    const isImage = this.isImageMessage(payload);
    const isDocument = this.isDocumentMessage(payload);

    // 4.1. Processamento Inteligente de Áudio (Voz / PTT) com Transcrição IA
    if (isAudio) {
      const config = loadBotConfig();
      const isTranscriptionEnabled = (agent.enableAudioTranscription !== undefined)
        ? agent.enableAudioTranscription
        : (config.enableAudioTranscription ?? false);

      if (!isTranscriptionEnabled) {
        console.log(`[Orchestrator] Áudio recebido de ${chatId}, mas a transcrição está desativada no agente [${agent.name}].`);
        this.addLog({
          type: 'info',
          chatId,
          contactName,
          message: `[${agent.name}] Mensagem de áudio recebida de ${contactName}, mas a transcrição automática está desativada.`
        });
        return;
      }

      // Transcrição habilitada!
      console.log(`[Orchestrator] 🎙️ Áudio recebido de ${chatId} (${contactName}). Baixando para transcrição com IA...`);
      this.addLog({
        type: 'info',
        chatId,
        contactName,
        message: `[${agent.name}] 🎙️ Mensagem de áudio recebida. Baixando e transcrevendo via IA...`
      });

      try {
        const downloaded = await wahaClient.downloadMedia(payload.media?.url, payload, sessionName);
        if (!downloaded || !downloaded.buffer || downloaded.buffer.length === 0) {
          console.warn(`[Orchestrator] Não foi possível baixar mídia de áudio para ${chatId}.`);
          this.addLog({
            type: 'error',
            chatId,
            contactName,
            message: `[${agent.name}] ⚠️ Não foi possível baixar o arquivo de áudio da WAHA para transcrição.`
          });
          return;
        }

        const transcribed = await audioTranscriber.transcribe(downloaded.buffer, downloaded.mimetype, agent);
        if (!transcribed || transcribed.trim() === '') {
          console.log(`[Orchestrator] Áudio de ${chatId} inaudível ou sem fala perceptível.`);
          this.addLog({
            type: 'info',
            chatId,
            contactName,
            message: `[${agent.name}] 🎙️ Áudio inaudível ou sem fala discernível detectada.`
          });
          return;
        }

        console.log(`[Orchestrator] ✅ Áudio transcrito com sucesso para ${chatId}: "${transcribed}"`);
        transcribedAudioText = transcribed;
        effectiveBody = transcribed;
        payload.body = transcribed;

        // Adiciona a transcrição diretamente na conversa do WhatsApp citando o áudio recebido.
        // Assim, o atendente humano no WhatsApp Web ou Chatwoot pode ler imediatamente o conteúdo!
        const transcriptionReply = `🎤 *Transcrição do Áudio:*\n"${transcribed}"`;
        try {
          botTracker.recordBotMessage(chatId, transcriptionReply);
          const activeSession = (sessionName && sessionName !== '*')
            ? sessionName
            : ((agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession);

          await wahaClient.sendText(chatId, transcriptionReply, {
            session: activeSession,
            reply_to: payload.id
          });
          console.log(`[Orchestrator] 📤 Transcrição do áudio entregue no WhatsApp/Chatwoot com citação direta.`);
        } catch (sendErr: any) {
          console.warn(`[Orchestrator] Aviso ao enviar citação de transcrição do áudio para ${chatId}:`, sendErr.message);
        }
      } catch (err: any) {
        console.error(`[Orchestrator] Erro ao transcrever áudio de ${chatId}:`, err.message);
        this.addLog({
          type: 'error',
          chatId,
          contactName,
          message: `[${agent.name}] ⚠️ Falha na transcrição do áudio: ${err.message}`
        });
        return;
      }
    }

    // 4.1b. Processamento Inteligente de Imagens e Documentos (Pedidos Médicos, Laudos, Receitas)
    if (isImage || isDocument) {
      if (!effectiveBody || effectiveBody.trim() === '') {
        effectiveBody = isImage
          ? '[Imagem / Pedido Médico / Laudo Enviado pelo Paciente]'
          : '[Documento / Pedido Médico Anexo]';
      } else {
        effectiveBody = isImage
          ? `[Imagem / Pedido Médico Anexo]: ${effectiveBody.trim()}`
          : `[Documento / Pedido Médico Anexo]: ${effectiveBody.trim()}`;
      }
      payload.body = effectiveBody;
    }

    // 4.2. Se o bot estiver pausado para este chatId e agente, verifica se é interação de agendamento/lembrete ou validação de exame LGPD
    if (memoryStore.isChatPaused(chatId, agent.id)) {
      const bookingAgent = this.agents.find(a => a.name === 'BookingAgent');
      const examAgent = this.agents.find(a => a.name === 'ExamDeliveryAgent');

      let canHandleBooking = false;
      let canHandleExam = false;

      const testCtx = {
        chatId,
        userMessage: effectiveBody,
        session: sessionName,
        agent
      };

      if (bookingAgent) {
        canHandleBooking = await bookingAgent.canHandle(testCtx);
      }
      if (examAgent) {
        canHandleExam = await examAgent.canHandle(testCtx);
      }

      if (canHandleBooking || canHandleExam) {
        memoryStore.resumeChat(chatId, agent.id);
        const altChat = getAlternateBrazilianChatId(chatId);
        if (altChat) memoryStore.resumeChat(altChat, agent.id);

        const reason = canHandleExam ? 'validação de exame (CPF)' : 'agenda/lembrete';
        console.log(`[Orchestrator] Contato ${chatId} interagiu com ${reason}. Pausa removida automaticamente.`);
        this.addLog({
          type: 'info',
          chatId,
          contactName,
          message: `Contato ${chatId} respondeu a ${reason}. Pausa cancelada automaticamente.`
        });
      } else {
        if (isAudio) {
          console.log(`[Orchestrator] Bot [${agent.name}] pausado para ${chatId}. Transcrição entregue no chat para o atendente humano ler.`);
          this.addLog({
            type: 'info',
            chatId,
            contactName,
            message: `[${agent.name}] 🎙️ Áudio transcrito e entregue no chat para o atendente humano ler: "${transcribedAudioText}"`
          });
          return;
        }

        console.log(`[Orchestrator] Bot [${agent.name}] pausado para ${chatId}, ignorando processamento.`);
        this.addLog({
          type: 'info',
          chatId,
          contactName,
          message: `Mensagem recebida mas bot [${agent.name}] está pausado para este contato: "${effectiveBody}"`
        });
        return;
      }
    }

    // 5. Verifica se há texto válido
    if (!effectiveBody || effectiveBody.trim() === '') {
      if (hasMedia) {
        this.addLog({
          type: 'info',
          chatId,
          contactName,
          message: 'Mensagem com mídia recebida sem legenda.'
        });
      }
      return;
    }

    this.addLog({
      type: 'incoming',
      chatId,
      contactName,
      message: isAudio
        ? `[${agent.name}] 🎙️ [Áudio Transcrito]: "${effectiveBody}"`
        : (isImage
            ? `[${agent.name}] 📸 [Foto/Pedido Médico Recebido]: "${effectiveBody}"`
            : (isDocument
                ? `[${agent.name}] 📄 [Documento/Laudo Recebido]: "${effectiveBody}"`
                : `[${agent.name}] ${effectiveBody}`))
    });

    // 6. Envia mensagem para o debouncer com escopo da sessão e agente
    messageDebouncer.enqueue(chatId, effectiveBody, contactName, sessionName, agent.id, agent.debounceSeconds);
  }

  /**
   * Processa a mensagem unificada após a janela de debounce
   */
  private async handleDebouncedMessage(
    chatId: string,
    messageText: string,
    contactName?: string,
    sessionName?: string,
    agentId?: string
  ): Promise<void> {
    const agent = (agentId ? agentManager.getAgent(agentId) : null)
      || (sessionName ? agentManager.getAgentBySession(sessionName) : null)
      || agentManager.getDefaultAgent();

    const activeSession = (sessionName && sessionName !== '*')
      ? sessionName
      : ((agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession);

    // 1. Confirmação de leitura (sendSeen) e indicador de digitação (startTyping)
    if (agent.enableSendSeen !== false) {
      await wahaClient.sendSeen(chatId, activeSession);
    }

    if (agent.enableTypingSimulation !== false) {
      await wahaClient.startTyping(chatId, activeSession);
    }

    const context: AgentContext = {
      chatId,
      userMessage: messageText,
      contactName,
      session: activeSession,
      agent
    };

    let response: AgentResponse | null = null;

    try {
      // 2. Execução pela esteira de agentes
      for (const a of this.agents) {
        const canHandle = await a.canHandle(context);
        if (canHandle) {
          response = await a.execute(context);
          if (response.handled) {
            break;
          }
        }
      }

      // 3. Aguarda um pequeno delay para humanizar a resposta
      if (agent.enableTypingSimulation !== false) {
        await new Promise(resolve => setTimeout(resolve, 1500));
        await wahaClient.stopTyping(chatId, activeSession);
      }

      // 4. Envia a resposta final via WAHA
      if (response && response.replyText) {
        const sendResult = await wahaClient.sendText(chatId, response.replyText, { session: activeSession });
        botTracker.recordBotMessage(chatId, response.replyText, sendResult?.id);

        this.addLog({
          type: response.action === 'transferred_human' ? 'handoff' : 'outgoing',
          chatId,
          contactName,
          message: response.replyText,
          agentId: agent.id,
          agentName: response.agentName || agent.name,
          companyName: agent.companyName || agent.name
        });
      }
    } catch (error: any) {
      if (agent.enableTypingSimulation !== false) {
        await wahaClient.stopTyping(chatId, activeSession);
      }
      console.error(`[Orchestrator] Falha no processamento de ${chatId}:`, error.message);
      this.addLog({
        type: 'error',
        chatId,
        message: `Erro ao responder: ${error.message}`,
        agentId: agent.id,
        agentName: agent.name,
        companyName: agent.companyName || agent.name
      });
    }
  }

  /**
   * Permite executar uma simulação direta (para teste no painel web)
   */
  async simulateMessage(chatId: string, messageText: string, agentId?: string): Promise<AgentResponse> {
    const agent = (agentId ? agentManager.getAgent(agentId) : null) || agentManager.getDefaultAgent();

    const isImageSim = messageText.startsWith('[Imagem') || messageText.startsWith('[Foto');
    const isDocSim = messageText.startsWith('[Documento');
    const isAudioSim = messageText.startsWith('[Áudio') || messageText.startsWith('[Audio') || messageText.startsWith('[Voz');

    // Suporte especial à Simulação de Mensagens de Áudio Recebidas
    if (isAudioSim) {
      const config = loadBotConfig();
      const isTranscriptionEnabled = (agent?.enableAudioTranscription !== undefined)
        ? agent.enableAudioTranscription
        : (config.enableAudioTranscription ?? false);

      if (!isTranscriptionEnabled) {
        return {
          handled: true,
          replyText: '🎙️ *[Mensagem de Áudio Recebida]*\n\n*(Aviso: A transcrição automática de áudios recebidos está desativada para este agente. Para transcrever e adicionar o texto automaticamente no WhatsApp e Chatwoot, ative a opção nas configurações do Agente).*',
          agentName: 'AudioTranscriber'
        };
      }

      // Se a transcrição está ativada, extrai o texto do áudio simulado ou usa exemplo padrão
      let spokenText = 'Olá! Gostaria de saber os horários de atendimento para esta semana.';
      const match = messageText.match(/\[(?:Áudio|Audio|Voz)[^\]]*\]:\s*"?([^"]+)"?/i);
      if (match && match[1]) {
        spokenText = match[1].trim();
      }

      const audioContext: AgentContext = {
        chatId,
        userMessage: spokenText,
        contactName: 'Cliente Teste',
        session: 'simulator',
        agent,
        metadata: {
          hasMedia: true,
          mediaType: 'audio'
        }
      };

      for (const a of this.agents) {
        const canHandle = await a.canHandle(audioContext);
        if (canHandle) {
          const res = await a.execute(audioContext);
          if (res.handled) {
            return {
              ...res,
              replyText: `🎤 *Transcrição do Áudio:*\n"${spokenText}"\n\n---\n\n${res.replyText}`
            };
          }
        }
      }

      return {
        handled: true,
        replyText: `🎤 *Transcrição do Áudio:*\n"${spokenText}"\n\n*(Transcrição entregue na conversa para os atendentes lerem).*`,
        agentName: 'AudioTranscriber'
      };
    }

    const context: AgentContext = {
      chatId,
      userMessage: messageText,
      contactName: 'Cliente Teste',
      session: 'simulator',
      agent,
      metadata: (isImageSim || isDocSim) ? {
        hasMedia: true,
        mediaType: isImageSim ? 'image' : 'document'
      } : undefined
    };

    for (const a of this.agents) {
      const canHandle = await a.canHandle(context);
      if (canHandle) {
        const res = await a.execute(context);
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
