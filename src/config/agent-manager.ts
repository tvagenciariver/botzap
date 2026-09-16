import fs from 'fs';
import path from 'path';
import { AgentProfile } from './agent-types.js';
import { loadBotConfig, defaultBusinessHours } from './index.js';

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
   * Encontra o agente correto para a mensagem recebida pelo nome da sessão da WAHA
   */
  getAgentBySession(session: string): AgentProfile {
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

      // 3. Busca por nome da empresa normalizado (ex: "vale_studio" bate com "Vale Studio")
      const cleanAlpha = cleanSession.replace(/[^a-z0-9]/g, '');
      if (cleanAlpha && cleanAlpha.length >= 3) {
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

    // 4. Busca agente curinga (*) - prioriza o padrão se houver
    const defaultAgent = this.getDefaultAgent();
    if (defaultAgent && defaultAgent.active && defaultAgent.wahaSession === '*') {
      return defaultAgent;
    }

    for (const a of this.agents.values()) {
      if (a.active && a.wahaSession === '*') {
        return a;
      }
    }

    // 5. Fallback para agente padrão
    return defaultAgent;
  }

  /**
   * Resolução contextual inteligente do agente para uma mensagem recebida.
   * Ordem de prioridade estrita:
   * 1. Sessão exata e não-curinga da WAHA
   * 2. Menção direta a especialista ativo no corpo do texto (ex: "Dra. Valéria")
   * 3. Menção direta ao nome da empresa no corpo do texto (ex: "Vale Studio")
   * 4. Agendamento ativo ou lembrete pendente para este contato (chatId)
   * 5. Se houver intenção de agendamento e apenas uma empresa ativa com agenda ativada
   * 6. Fallback padrão por sessão WAHA
   */
  resolveAgentForMessage(params: {
    sessionName?: string;
    messageText?: string;
    chatId?: string;
    recipientPhone?: string;
    contactName?: string;
  }): { agent: AgentProfile; reason: string } {
    const { sessionName, messageText, chatId } = params;
    const cleanSession = (sessionName || '').trim().toLowerCase();

    // 1. Se a sessão da WAHA é específica (diferente de '*' e 'default'), tenta correspondência direta
    if (cleanSession && cleanSession !== '*' && cleanSession !== 'default') {
      for (const a of this.agents.values()) {
        if (a.active && a.wahaSession && a.wahaSession.trim().toLowerCase() === cleanSession) {
          return { agent: a, reason: `exact_session (${a.wahaSession})` };
        }
      }
      for (const a of this.agents.values()) {
        if (a.active && a.id.toLowerCase() === cleanSession) {
          return { agent: a, reason: `id_session (${a.id})` };
        }
      }
      const cleanAlpha = cleanSession.replace(/[^a-z0-9]/g, '');
      if (cleanAlpha && cleanAlpha.length >= 3) {
        for (const a of this.agents.values()) {
          if (a.active) {
            const compAlpha = (a.companyName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
            if (compAlpha === cleanAlpha) {
              return { agent: a, reason: `company_name_session (${a.companyName})` };
            }
          }
        }
      }
    }

    // 2. Detecção por menção a especialista ativo no texto
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

    // 3. Detecção por menção direta ao nome da empresa no texto
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

    // 4. Detecção por agendamento ativo ou lembrete pendente para este paciente (chatId)
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

    // 5. Se houver apenas UMA empresa com agendamento ativo e a mensagem tiver intenção clara de agendamento
    if (messageText) {
      const lower = messageText.toLowerCase();
      const isBookingIntent = ['agendar', 'marcar consulta', 'marcar horario', 'marcar horário', 'quero agendar'].some(kw => lower.includes(kw));
      if (isBookingIntent) {
        const bookingAgents = Array.from(this.agents.values()).filter(a => a.active && a.enableBooking);
        if (bookingAgents.length === 1) {
          return { agent: bookingAgents[0], reason: `single_booking_agent (${bookingAgents[0].companyName})` };
        }
      }
    }

    // 6. Fallback padrão por sessão WAHA
    const fallbackAgent = this.getAgentBySession(sessionName || 'default');
    return { agent: fallbackAgent, reason: `session_fallback (${sessionName || 'default'})` };
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
