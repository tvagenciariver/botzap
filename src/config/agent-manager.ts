import fs from 'fs';
import path from 'path';
import { AgentProfile } from './agent-types.js';
import { loadBotConfig, defaultBusinessHours } from './index.js';
import { wahaClient } from '../waha/client.js';

const agentsFilePath = path.resolve(process.cwd(), 'data', 'agents.json');

export class AgentManager {
  private agents: Map<string, AgentProfile> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(agentsFilePath)) {
        const raw = fs.readFileSync(agentsFilePath, 'utf-8');
        const list: AgentProfile[] = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          this.agents.clear();
          for (const a of list) {
            if (a && a.id) {
              this.agents.set(a.id, a);
            }
          }
          console.log(`[AgentManager] ${this.agents.size} agente(s) carregado(s) com sucesso.`);
          return;
        }
      }
    } catch (err: any) {
      console.warn('[AgentManager] Aviso ao carregar agents.json:', err.message);
    }

    // Se o arquivo não existir ou estiver vazio, faz a migração automática das configurações existentes
    this.migrateFromBotConfig();
  }

  private migrateFromBotConfig(): void {
    console.log('[AgentManager] Inicializando migração automática do agente a partir de bot_config.json...');
    const config = loadBotConfig();

    const defaultAgent: AgentProfile = {
      id: 'default',
      name: config.botName || 'Assistente Virtual',
      companyName: config.companyName || 'Minha Empresa',
      description: 'Agente Principal Migrado',
      active: true,
      isDefault: true,
      wahaSession: '*',
      llmProvider: config.llmProvider || 'openai',
      model: config.model || 'gemini-flash-lite-latest',
      openaiModel: config.openaiModel || 'gpt-4o-mini',
      temperature: config.temperature ?? 0.4,
      geminiApiKey: config.geminiApiKey || '',
      openaiApiKey: config.openaiApiKey || '',
      systemInstruction: config.systemInstruction || 'Você é um atendente inteligente e prestativo para WhatsApp.',
      businessInfo: config.businessInfo || '',
      handoffKeywords: config.handoffKeywords || ['atendente', 'humano', 'suporte', 'pessoa'],
      handoffMessage: config.handoffMessage || 'Entendido! Estou transferindo sua conversa para um de nossos atendentes humanos.',
      mediaHandoffMessage: config.mediaHandoffMessage,
      pauseDurationHours: config.pauseDurationHours || 6,
      pauseDurationMinutes: config.pauseDurationMinutes || 360,
      debounceSeconds: config.debounceSeconds ?? 2.5,
      enableTypingSimulation: config.enableTypingSimulation !== false,
      enableSendSeen: config.enableSendSeen !== false,
      keepChatUnread: !!config.keepChatUnread,
      enableAudioTranscription: config.enableAudioTranscription ?? false,
      enableBooking: false,
      businessHours: config.businessHours || defaultBusinessHours,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };


    this.agents.set(defaultAgent.id, defaultAgent);
    this.saveToDisk();
    console.log(`[AgentManager] Agente padrão "${defaultAgent.name}" criado com sucesso.`);
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(agentsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const list = Array.from(this.agents.values());
      fs.writeFileSync(agentsFilePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[AgentManager] Erro ao salvar agents.json:', err.message);
    }
  }

  listAgents(): AgentProfile[] {
    return Array.from(this.agents.values()).sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  getAgent(id: string): AgentProfile | null {
    return this.agents.get(id) || null;
  }

  getDefaultAgent(): AgentProfile {
    for (const a of this.agents.values()) {
      if (a.isDefault && a.active) return a;
    }
    for (const a of this.agents.values()) {
      if (a.isDefault) return a;
    }
    const first = this.agents.values().next().value;
    if (first) return first;

    // Fallback absoluto
    this.migrateFromBotConfig();
    return this.agents.get('default')!;
  }

  /**
   * Encontra o agente correto para a mensagem recebida pelo nome da sessão da WAHA.
   * Retorna null se não houver agente ativo para esta sessão (zero fallback para default).
   */
  getAgentBySession(session: string): AgentProfile | null {
    if (session) {
      const cleanSession = session.trim().toLowerCase();

      // 1. Busca correspondência exata de sessão
      for (const a of this.agents.values()) {
        if (a.active && a.wahaSession && a.wahaSession.trim().toLowerCase() === cleanSession) {
          return a;
        }
      }

      // 2. Busca por id / slug exato
      for (const a of this.agents.values()) {
        if (a.active && a.id.toLowerCase() === cleanSession) {
          return a;
        }
      }

      // 3. Busca por nome da empresa ou wahaSession normalizado
      const cleanAlpha = cleanSession.replace(/[^a-z0-9]/g, '');
      if (cleanAlpha && cleanAlpha.length >= 3) {
        for (const a of this.agents.values()) {
          if (a.active && a.wahaSession) {
            const sessAlpha = a.wahaSession.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (sessAlpha === cleanAlpha) return a;
          }
        }
        for (const a of this.agents.values()) {
          if (a.active) {
            const compAlpha = (a.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            const nameAlpha = (a.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (compAlpha === cleanAlpha || nameAlpha === cleanAlpha) {
              return a;
            }
          }
        }
      }
    }

    // ZERO FALLBACK: Nenhuma correspondência de sessão encontrada
    return null;
  }

  /**
   * Resolução contextual inteligente do agente para uma mensagem recebida.
   * Ordem de prioridade estrita:
   * 1. Match por número de telefone de destino (recipientPhone / payload.to)
   * 2. Sessão exata e não-curinga da WAHA
   *    🔐 BLOQUEIO DE SEGURANÇA: sessão específica sem agente retorna sentinel inativo (descarte)
   *    Texto/contexto SÓ é avaliado quando a sessão é '*' ou 'default' (curinga).
   * 3. [Somente curinga] Menção direta a especialista ativo no corpo do texto
   * 4. [Somente curinga] Menção direta ao nome da empresa no corpo do texto
   * 5. [Somente curinga] Agendamento ativo ou lembrete pendente para este contato
   * 6. [Somente curinga] Intenção de agendamento + única empresa com agenda ativada
   * 7. Fallback padrão por sessão WAHA (apenas para sessão curinga)
   */
  resolveAgentForMessage(params: {
    sessionName?: string;
    messageText?: string;
    chatId?: string;
    recipientPhone?: string;
    contactName?: string;
  }): { agent: AgentProfile; reason: string } {
    const { sessionName, messageText, chatId, recipientPhone } = params;
    const cleanSession = (sessionName || '').trim().toLowerCase();

    // 1. PRIORIDADE ABSOLUTA: Match por número de telefone de destino (recipientPhone / payload.to)
    if (recipientPhone) {
      const recDigits = recipientPhone.replace(/:\d+@/, '@').replace(/\D/g, '');
      if (recDigits.length >= 8) {
        // A. Match direto com phoneNumber cadastrado no perfil do agente
        for (const a of this.agents.values()) {
          if (a.active && a.phoneNumber) {
            const agentDigits = a.phoneNumber.replace(/\D/g, '');
            if (agentDigits.length >= 8 && (recDigits.endsWith(agentDigits) || agentDigits.endsWith(recDigits))) {
              return { agent: a, reason: `recipient_phone (${a.phoneNumber} -> ${a.companyName})` };
            }
          }
        }

        // B. Match com o telefone conectado da sessão da WAHA
        const mappedSession = wahaClient.getSessionByPhoneNumber(recDigits);
        if (mappedSession) {
          const matchedAgent = this.getAgentBySession(mappedSession);
          if (matchedAgent && matchedAgent.active) {
            return { agent: matchedAgent, reason: `waha_connected_phone (${recDigits} -> sessão ${mappedSession} -> ${matchedAgent.companyName})` };
          }
        }
      }
    }

    // 2. Se a sessão da WAHA é específica (diferente de '*' e 'default'), tenta correspondência direta
    if (cleanSession && cleanSession !== '*' && cleanSession !== 'default') {
      // A. Match exato de wahaSession
      for (const a of this.agents.values()) {
        if (a.active && a.wahaSession && a.wahaSession.trim().toLowerCase() === cleanSession) {
          return { agent: a, reason: `exact_session (${a.wahaSession})` };
        }
      }
      // B. Match exato ou por prefixo de id
      for (const a of this.agents.values()) {
        if (a.active && (a.id.toLowerCase() === cleanSession || a.id.toLowerCase().startsWith(cleanSession + '-') || cleanSession.startsWith(a.id.toLowerCase() + '-'))) {
          return { agent: a, reason: `id_session (${a.id})` };
        }
      }
      // C. Match alfanumérico normalizado (ignora hífens, underlines, espaços e acentos)
      const cleanAlpha = cleanSession.replace(/[^a-z0-9]/g, '');
      if (cleanAlpha && cleanAlpha.length >= 3) {
        // C.1 Com wahaSession cadastrada no agente
        for (const a of this.agents.values()) {
          if (a.active && a.wahaSession) {
            const sessAlpha = a.wahaSession.toLowerCase().replace(/[^a-z0-9]/g, '');
            if (sessAlpha === cleanAlpha) {
              return { agent: a, reason: `waha_session_normalized (${a.wahaSession})` };
            }
          }
        }
        // C.2 Com companyName ou nome do agente
        for (const a of this.agents.values()) {
          if (a.active) {
            const compAlpha = (a.companyName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            const nameAlpha = (a.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
            if (compAlpha === cleanAlpha || nameAlpha === cleanAlpha) {
              return { agent: a, reason: `company_name_session (${a.companyName || a.name})` };
            }
          }
        }
      }

      // ============================================================
      // 🔐 BLOQUEIO DE SEGURANÇA ANTI CROSS-CONTAMINATION
      // Sessão WAHA específica identificada mas sem agente cadastrado correspondente.
      // NUNCA fazer fallback para o agente padrão — isso causaria o bug crítico
      // de mensagens de um cliente serem respondidas pelo bot de outro cliente.
      // Retornamos um sentinel inativo para o orchestrator descartar silenciosamente.
      // ============================================================
      console.warn(`[SEGURANÇA][AgentManager] ⚠️ Sessão WAHA "${sessionName}" não possui agente ativo cadastrado. Mensagem de ${chatId || '?'} DESCARTADA (anti cross-contamination).`);
      return {
        agent: { id: '__unknown_session__', name: 'Sessão Desconhecida', active: false, isDefault: false, wahaSession: sessionName || '*' } as any,
        reason: `unknown_session_blocked (${sessionName})`
      };
    }

    // A partir daqui: sessão é curinga ('*') ou 'default'.
    // Somente neste caso aplicamos lógica contextual baseada no conteúdo da mensagem.

    // 3. Detecção por menção a especialista ativo no texto
    if (messageText && messageText.length >= 3) {
      const normText = messageText
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      try {
        const specFile = path.resolve(process.cwd(), 'data', 'specialists.json');
        if (fs.existsSync(specFile)) {
          const raw = fs.readFileSync(specFile, 'utf-8');
          const specialists: any[] = JSON.parse(raw);
          if (Array.isArray(specialists)) {
            for (const spec of specialists) {
              if (!spec || !spec.name || !spec.agentId) continue;
              const specNorm = spec.name
                .toLowerCase()
                .normalize('NFD')
                .replace(/[\u0300-\u036f]/g, '')
                .replace(/^(dra?\.?|doutor(a)?|dr\.?)\s+/i, '')
                .trim();

              const firstName = specNorm.split(' ')[0];
              if (firstName.length >= 4 && normText.includes(firstName)) {
                const targetAgent = this.getAgent(spec.agentId);
                if (targetAgent && targetAgent.active) {
                  return { agent: targetAgent, reason: `specialist_in_text (${spec.name} -> ${targetAgent.companyName})` };
                }
              }
            }
          }
        }
      } catch (err: any) {
        console.warn('[AgentManager] Aviso ao verificar specialists.json para roteamento:', err.message);
      }
    }

    // 4. Detecção por menção direta ao nome da empresa no texto
    if (messageText && messageText.length >= 3) {
      const normText = messageText
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

      for (const a of this.agents.values()) {
        if (!a.active || !a.companyName) continue;
        const compNorm = a.companyName
          .toLowerCase()
          .normalize('NFD')
          .replace(/[\u0300-\u036f]/g, '')
          .trim();

        if (compNorm.length >= 3 && normText.includes(compNorm)) {
          return { agent: a, reason: `company_in_text (${a.companyName})` };
        }

        // Se o nome da empresa tiver partes com 4+ caracteres (ex: "Vale Studio" -> ["vale", "studio"])
        const words = compNorm.split(/\s+/).filter(w => w.length >= 4);
        if (words.length > 0 && words.every(w => normText.includes(w))) {
          return { agent: a, reason: `company_words_in_text (${a.companyName})` };
        }
      }
    }

    // 5. Detecção por agendamento ativo ou lembrete pendente para este paciente (chatId)
    if (chatId) {
      try {
        const aptFile = path.resolve(process.cwd(), 'data', 'appointments.json');
        if (fs.existsSync(aptFile)) {
          const raw = fs.readFileSync(aptFile, 'utf-8');
          const appointments: any[] = JSON.parse(raw);
          if (Array.isArray(appointments)) {
            const cleanPhone = chatId.replace(/\D/g, '');
            const activeApt = appointments.find(a =>
              (a.status === 'scheduled' || a.status === 'confirmed' || a.status === 'presence_confirmed') &&
              a.agentId &&
              ((a.clientChatId && a.clientChatId.replace(/\D/g, '') === cleanPhone) ||
               (a.clientPhone && a.clientPhone.replace(/\D/g, '') === cleanPhone))
            );
            if (activeApt) {
              const targetAgent = this.getAgent(activeApt.agentId);
              if (targetAgent && targetAgent.active) {
                return { agent: targetAgent, reason: `active_appointment (${targetAgent.companyName})` };
              }
            }
          }
        }
      } catch (err: any) {
        console.warn('[AgentManager] Aviso ao verificar appointments.json para roteamento:', err.message);
      }
    }

    // 6. Se houver apenas UMA empresa com agendamento ativo e a mensagem tiver intenção clara de agendamento
    if (messageText) {
      const lower = messageText.toLowerCase();
      const isBookingIntent = [
        'agendar', 'agendamento', 'marcar consulta', 'marcar horario', 'marcar horário', 'quero agendar',
        'marcar exame', 'agendar exame', 'fazer exame', 'marcar procedimento', 'agendar procedimento',
        'fazer procedimento', 'fazer agendamento', 'consultas disponíveis', 'exames disponíveis'
      ].some(kw => lower.includes(kw));
      if (isBookingIntent) {
        const bookingAgents = Array.from(this.agents.values()).filter(a => a.active && a.enableBooking);
        if (bookingAgents.length === 1) {
          return { agent: bookingAgents[0], reason: `single_booking_agent (${bookingAgents[0].companyName})` };
        }
      }
    }

    // 7. SEM FALLBACK PARA AGENTE PADRÃO (ZERO CROSS-CONTAMINATION)
    // Se a mensagem não teve correspondência com nenhum agente ativo,
    // ela NUNCA deve ser assumida por outro cliente. NENHUM agente responderá.
    const matchedBySession = sessionName ? this.getAgentBySession(sessionName) : null;
    if (matchedBySession && matchedBySession.active) {
      return { agent: matchedBySession, reason: `session_match (${sessionName})` };
    }

    console.warn(`[SEGURANÇA][AgentManager] ⛔ Mensagem de ${chatId || '?'} (sessão: "${sessionName || 'desconhecida'}") não pertence a nenhum agente ativo. NENHUM agente responderá (fallback padrão desativado).`);
    return {
      agent: { id: '__no_agent_matched__', name: 'Nenhum Agente', active: false, isDefault: false, wahaSession: sessionName || '*' } as any,
      reason: 'no_agent_matched_no_fallback'
    };
  }

  createAgent(data: Partial<AgentProfile>): AgentProfile {
    const rawName = (data.name || 'Novo Agente').trim();
    const slug = (data.id || rawName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agente')
      + '-' + Math.random().toString(36).substring(2, 6);

    const defaultHours = defaultBusinessHours;

    // Se não foi informada uma sessão, só usa '*' se ainda não houver nenhum agente com '*'
    let assignedSession = (data.wahaSession || '').trim();
    if (!assignedSession) {
      const hasWildcard = Array.from(this.agents.values()).some(a => a.wahaSession === '*');
      assignedSession = hasWildcard ? slug : '*';
    }

    const newAgent: AgentProfile = {
      id: slug,
      name: rawName,
      companyName: data.companyName || 'Empresa Cliente',
      description: data.description || '',
      phoneNumber: data.phoneNumber ? data.phoneNumber.trim() : undefined,
      active: data.active !== false,
      isDefault: !!data.isDefault,
      wahaSession: assignedSession,
      llmProvider: data.llmProvider || 'openai',
      model: data.model || 'gemini-flash-lite-latest',
      openaiModel: data.openaiModel || 'gpt-4o-mini',
      temperature: data.temperature ?? 0.4,
      geminiApiKey: data.geminiApiKey || '',
      openaiApiKey: data.openaiApiKey || '',
      systemInstruction: data.systemInstruction || 'Você é o atendente inteligente da {companyName} no WhatsApp.',
      businessInfo: data.businessInfo || '',
      handoffKeywords: data.handoffKeywords || ['atendente', 'humano', 'suporte'],
      handoffMessage: data.handoffMessage || 'Estou transferindo para nossa equipe humana.',
      mediaHandoffMessage: data.mediaHandoffMessage,
      pauseDurationHours: data.pauseDurationHours || 6,
      pauseDurationMinutes: data.pauseDurationMinutes || 360,
      debounceSeconds: data.debounceSeconds ?? 2.5,
      enableTypingSimulation: data.enableTypingSimulation !== false,
      enableSendSeen: data.enableSendSeen !== false,
      keepChatUnread: !!data.keepChatUnread,
      enableAudioTranscription: !!data.enableAudioTranscription,
      enableBooking: !!data.enableBooking,
      enableAutoReminders: data.enableAutoReminders !== false,
      autoReminderTime: data.autoReminderTime || '18:00',
      businessHours: data.businessHours || defaultHours,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (newAgent.isDefault) {
      // Remove isDefault dos demais
      for (const a of this.agents.values()) {
        a.isDefault = false;
      }
    }

    this.agents.set(newAgent.id, newAgent);
    this.saveToDisk();
    return newAgent;
  }

  updateAgent(id: string, updates: Partial<AgentProfile>): AgentProfile {
    const existing = this.agents.get(id);
    if (!existing) {
      throw new Error(`Agente com ID "${id}" não encontrado.`);
    }

    if (updates.isDefault) {
      for (const a of this.agents.values()) {
        if (a.id !== id) a.isDefault = false;
      }
    }

    if (updates.phoneNumber !== undefined) {
      updates.phoneNumber = updates.phoneNumber ? updates.phoneNumber.trim() : undefined;
    }

    if (updates.pauseDurationHours !== undefined) {
      updates.pauseDurationMinutes = Math.round(updates.pauseDurationHours * 60);
    }

    const updated: AgentProfile = {
      ...existing,
      ...updates,
      id: existing.id, // ID não muda
      updatedAt: Date.now()
    };

    this.agents.set(id, updated);
    this.saveToDisk();
    return updated;
  }

  duplicateAgent(id: string): AgentProfile {
    const source = this.agents.get(id);
    if (!source) {
      throw new Error(`Agente com ID "${id}" não encontrado para duplicar.`);
    }

    const copyData: Partial<AgentProfile> = {
      ...source,
      name: `${source.name} (Cópia)`,
      isDefault: false,
      wahaSession: ''
    };
    delete copyData.id;

    return this.createAgent(copyData);
  }

  deleteAgent(id: string): boolean {
    if (this.agents.size <= 1) {
      throw new Error('Não é possível excluir o único agente cadastrado no sistema.');
    }

    const agent = this.agents.get(id);
    if (!agent) return false;

    if (agent.isDefault) {
      throw new Error('Não é possível excluir o agente padrão. Defina outro agente como padrão antes de excluir este.');
    }

    this.agents.delete(id);
    this.saveToDisk();
    return true;
  }
}

export const agentManager = new AgentManager();
