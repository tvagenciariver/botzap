import fs from 'fs';
import path from 'path';
import { AgentProfile } from './agent-types.js';
import { loadBotConfig, defaultBusinessHours } from './index.js';
import { wahaClient } from '../waha/client.js';
import { lidMapper, matchPhoneOrChatId, getAllChatIdAliases } from '../appointments/phone-utils.js';

const agentsFilePath = path.resolve(process.cwd(), 'data', 'agents.json');

export class AgentManager {
  private agents: Map<string, AgentProfile> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    const tryLoad = (filePath: string): boolean => {
      try {
        if (fs.existsSync(filePath)) {
          const raw = fs.readFileSync(filePath, 'utf-8');
          if (!raw || !raw.trim()) return false;
          const list: AgentProfile[] = JSON.parse(raw);
          if (Array.isArray(list) && list.length > 0) {
            this.agents.clear();
            for (const a of list) {
              if (a && a.id) {
                this.agents.set(a.id, a);
              }
            }
            console.log(`[AgentManager] ${this.agents.size} agente(s) carregado(s) com sucesso de "${path.basename(filePath)}".`);
            return true;
          }
        }
      } catch (err: any) {
        console.warn(`[AgentManager] Falha ao ler ${path.basename(filePath)}:`, err.message);
      }
      return false;
    };

    // 1. Tenta carregar o arquivo principal
    if (tryLoad(agentsFilePath)) {
      return;
    }

    // 2. Se o principal falhar ou estiver ausente, tenta carregar o backup .bak
    const bakPath = agentsFilePath + '.bak';
    if (tryLoad(bakPath)) {
      console.warn('[AgentManager] ⚠️ agents.json principal estava ausente ou corrompido. Restaurado automaticamente com sucesso a partir de agents.json.bak!');
      this.saveToDisk();
      return;
    }

    // 3. Se nenhum arquivo existir, faz a migração automática das configurações padrão
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
      // Proteção de segurança: nunca sobrescreve com array vazio se existiam agentes
      if (list.length === 0) {
        console.warn('[AgentManager] Tentativa de salvar lista vazia de agentes ignorada para evitar perda de dados.');
        return;
      }

      const content = JSON.stringify(list, null, 2);

      // 1. Cria backup contínuo do agents.json atual se válido antes de sobrescrever
      if (fs.existsSync(agentsFilePath)) {
        try {
          const currentRaw = fs.readFileSync(agentsFilePath, 'utf-8');
          if (currentRaw && currentRaw.trim().length > 10) {
            // Valida se o conteúdo atual em disco é JSON válido antes de transformá-lo em .bak
            const parsed = JSON.parse(currentRaw);
            if (Array.isArray(parsed) && parsed.length > 0) {
              const bakPath = agentsFilePath + '.bak';
              fs.writeFileSync(bakPath, currentRaw, 'utf-8');
            }
          }
        } catch {}
      }

      // 2. Escrita atômica com fsyncSync para garantir que o kernel descarregue os dados fisicamente no disco/volume
      const tmpPath = `${agentsFilePath}.tmp.${Date.now()}`;
      const fd = fs.openSync(tmpPath, 'w');
      fs.writeSync(fd, content, undefined, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);

      // 3. Renomeação atômica
      fs.renameSync(tmpPath, agentsFilePath);
    } catch (err: any) {
      console.error('[AgentManager] Erro ao salvar atomicamente agents.json:', err.message);
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

      // D. Match pelo número de telefone embutido no nome da sessão da WAHA (ex: "6_14_5587991252580" -> "5587991252580")
      const sessionParts = cleanSession.split('_');
      const lastSessionPart = sessionParts[sessionParts.length - 1];
      const embeddedDigits = (lastSessionPart && /^\d{8,14}$/.test(lastSessionPart))
        ? lastSessionPart
        : (cleanSession.match(/\d{10,14}/)?.[0] || '');

      if (embeddedDigits && embeddedDigits.length >= 8) {
        for (const a of this.agents.values()) {
          if (a.active && a.phoneNumber) {
            const agentDigits = a.phoneNumber.replace(/\D/g, '');
            if (agentDigits.length >= 8 && (embeddedDigits.endsWith(agentDigits) || agentDigits.endsWith(embeddedDigits))) {
              return { agent: a, reason: `session_embedded_phone (${embeddedDigits} -> ${a.companyName})` };
            }
          }
        }
      }

      // E. Match pelo telefone conectado da sessão obtido da WAHA
      const wahaConnectedPhone = wahaClient.getPhoneNumberBySession(cleanSession);
      if (wahaConnectedPhone && wahaConnectedPhone.length >= 8) {
        for (const a of this.agents.values()) {
          if (a.active && a.phoneNumber) {
            const agentDigits = a.phoneNumber.replace(/\D/g, '');
            if (agentDigits.length >= 8 && (wahaConnectedPhone.endsWith(agentDigits) || agentDigits.endsWith(wahaConnectedPhone))) {
              return { agent: a, reason: `waha_session_connected_phone (${wahaConnectedPhone} -> ${a.companyName})` };
            }
          }
        }
      }

      // F. Match pelo PushName da conta conectada na WAHA para esta sessão (ex: "Aviva Sport")
      const sessionPushName = wahaClient.getPushNameBySession(cleanSession);
      if (sessionPushName) {
        const pushAlpha = sessionPushName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
        if (pushAlpha && pushAlpha.length >= 3) {
          for (const a of this.agents.values()) {
            if (a.active) {
              const compAlpha = (a.companyName || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
              const nameAlpha = (a.name || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');
              if (compAlpha === pushAlpha || nameAlpha === pushAlpha || (pushAlpha.length >= 5 && (compAlpha.includes(pushAlpha) || pushAlpha.includes(compAlpha)))) {
                return { agent: a, reason: `waha_session_pushname (${sessionPushName} -> ${a.companyName})` };
              }
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
      ignoredNumbers: Array.isArray(data.ignoredNumbers)
        ? data.ignoredNumbers.map(n => sanitizeIgnoredNumber(n)).filter((n): n is string => Boolean(n))
        : [],
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

    if (updates.ignoredNumbers !== undefined) {
      updates.ignoredNumbers = Array.isArray(updates.ignoredNumbers)
        ? updates.ignoredNumbers.map(n => sanitizeIgnoredNumber(n)).filter((n): n is string => Boolean(n))
        : [];
    }

    if (updates.pauseDurationHours !== undefined) {
      updates.pauseDurationMinutes = Math.round(updates.pauseDurationHours * 60);
    }

    // 🛡️ VERSIONAMENTO E HISTÓRICO ATÔMICO DE PROMPT
    // Se a instrução do sistema foi alterada para um texto válido e diferente do atual:
    if (
      updates.systemInstruction !== undefined &&
      typeof updates.systemInstruction === 'string' &&
      updates.systemInstruction.trim() !== '' &&
      updates.systemInstruction.trim() !== existing.systemInstruction.trim()
    ) {
      const history = Array.isArray(existing.promptHistory) ? [...existing.promptHistory] : [];
      if (existing.systemInstruction && existing.systemInstruction.trim() !== '') {
        history.unshift({
          prompt: existing.systemInstruction,
          savedAt: existing.updatedAt || Date.now(),
          note: `Versão anterior arquivada automaticamente em ${new Date().toLocaleString('pt-BR')}`
        });
      }
      // Mantém até 30 versões no histórico
      updates.promptHistory = history.slice(0, 30);
    } else if (updates.systemInstruction !== undefined && (!updates.systemInstruction || updates.systemInstruction.trim() === '')) {
      // Se tentou enviar vazio acidentalmente, preserva o prompt existente para evitar perda de dados
      console.warn(`[AgentManager] Tentativa de salvar prompt em branco para agente "${existing.name}" (${id}) rejeitada. Prompt preservado.`);
      delete updates.systemInstruction;
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

  /**
   * Retorna o histórico de versões do prompt do agente
   */
  getPromptHistory(id: string) {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agente com ID "${id}" não encontrado.`);
    }
    return agent.promptHistory || [];
  }

  /**
   * Restaura uma versão específica do histórico de prompts do agente
   */
  restorePromptVersion(id: string, versionIndex: number): AgentProfile {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new Error(`Agente com ID "${id}" não encontrado.`);
    }
    const history = agent.promptHistory || [];
    if (versionIndex < 0 || versionIndex >= history.length) {
      throw new Error(`Versão #${versionIndex} não encontrada no histórico do agente.`);
    }
    const targetVersion = history[versionIndex];
    if (!targetVersion || !targetVersion.prompt) {
      throw new Error('Conteúdo da versão selecionada é inválido.');
    }

    return this.updateAgent(id, {
      systemInstruction: targetVersion.prompt
    });
  }

  /**
   * Verifica se determinado número/chatId está na lista de números ignorados do agente (comunicação interna/equipe/sócios).
   * Suporta:
   * 1. Telefones móveis ou fixos (com/sem DDI 55, com/sem 9º dígito brasileiro).
   * 2. Identificadores WhatsApp @lid (ex: "62887095701679@lid" ou "62887095701679").
   * 3. Mapeamento bidirecional LID <-> Telefone real (via lidMapper).
   * 4. Identificadores copiados da interface com prefixo de agente (ex: "avi-a2o1:62887095701679@lid").
   * 5. Variações multi-dispositivo (:0, :1, etc.).
   */
  isNumberIgnored(agent: AgentProfile | null | undefined, rawPhoneOrChatId: string): boolean {
    if (!agent || !agent.ignoredNumbers || !Array.isArray(agent.ignoredNumbers) || agent.ignoredNumbers.length === 0) {
      return false;
    }
    if (!rawPhoneOrChatId) return false;

    // 1. Limpa prefixo de agente se houver (ex: "avi-a2o1:62887095701679@lid" -> "62887095701679@lid")
    let target = String(rawPhoneOrChatId).trim();
    if (target.includes(':')) {
      const colonIdx = target.indexOf(':');
      const atIdx = target.indexOf('@');
      if (colonIdx !== -1 && atIdx !== -1 && colonIdx < atIdx) {
        const prefix = target.substring(0, colonIdx);
        // Se o prefixo não for exclusivamente numérico, é um prefixo de agentId (ex: "avi-a2o1")
        if (!/^\d+$/.test(prefix)) {
          target = target.substring(colonIdx + 1).trim();
        }
      }
    }

    // 2. Remove sufixo de dispositivo (:0, :1) antes do @
    if (target.includes(':') && target.includes('@')) {
      target = target.replace(/:\d+@/, '@');
    }

    // 3. Normalização básica do target
    const targetIsLid = target.toLowerCase().includes('@lid');
    const targetLidDigits = targetIsLid ? target.replace(/\D/g, '') : null;

    // Aliases cruzados do target (inclui 9º dígito e mapeamento LID)
    const targetAliases = new Set<string>(getAllChatIdAliases(target));
    targetAliases.add(target);

    let targetMappedPhone: string | undefined;
    if (targetIsLid) {
      targetMappedPhone = lidMapper.getPhone(target) || (targetLidDigits ? lidMapper.getPhone(`${targetLidDigits}@lid`) : undefined);
      if (targetMappedPhone) {
        targetAliases.add(targetMappedPhone);
        for (const a of getAllChatIdAliases(targetMappedPhone)) {
          targetAliases.add(a);
        }
      }
    } else {
      const mappedLid = lidMapper.getLid(target);
      if (mappedLid) {
        targetAliases.add(mappedLid);
      }
    }

    const targetDigits = target.replace(/\D/g, '');

    for (const rawIgnored of agent.ignoredNumbers) {
      if (!rawIgnored) continue;
      const cleanIgnored = sanitizeIgnoredNumber(rawIgnored) || String(rawIgnored).trim();
      if (!cleanIgnored) continue;

      // Match 1: Igualdade exata de string (ex: "62887095701679@lid" === "62887095701679@lid")
      if (target === cleanIgnored) return true;

      const ignIsLid = cleanIgnored.toLowerCase().includes('@lid');
      const ignLidDigits = ignIsLid ? cleanIgnored.replace(/\D/g, '') : (cleanIgnored.length >= 14 ? cleanIgnored.replace(/\D/g, '') : null);

      // Match 2: Se ambos possuem formato/dígitos de LID, compara dígitos diretos
      if (targetLidDigits && ignLidDigits) {
        if (targetLidDigits === ignLidDigits) return true;
      }

      // Match 3: Resolução cruzada LID <-> Telefone Real
      if (targetIsLid && !ignIsLid) {
        // Target é LID, Ignored é telefone real cadastrado pelo usuário
        if (targetMappedPhone && matchPhoneOrChatId(targetMappedPhone, cleanIgnored)) {
          return true;
        }
        const ignLid = lidMapper.getLid(cleanIgnored);
        if (ignLid && (ignLid === target || (targetLidDigits && ignLid.includes(targetLidDigits)))) {
          return true;
        }
      } else if (!targetIsLid && ignIsLid) {
        // Target é telefone real, Ignored é LID cadastrado pelo usuário
        const ignMappedPhone = lidMapper.getPhone(cleanIgnored);
        if (ignMappedPhone && matchPhoneOrChatId(target, ignMappedPhone)) {
          return true;
        }
        const targetLid = lidMapper.getLid(target);
        if (targetLid && (targetLid === cleanIgnored || (ignLidDigits && targetLid.includes(ignLidDigits)))) {
          return true;
        }
      }

      // Match 4: Compara aliases completos via getAllChatIdAliases
      const ignAliases = getAllChatIdAliases(cleanIgnored);
      for (const ignAlias of ignAliases) {
        if (targetAliases.has(ignAlias)) return true;
      }

      // Match 5: Comparação inteligente via matchPhoneOrChatId (trata @c.us, DDI 55, DDD e 9º dígito)
      if (matchPhoneOrChatId(target, cleanIgnored)) {
        return true;
      }

      // Match 6: Comparação puramente numérica de telefone (para comprimentos <= 13 dígitos)
      const ignDigits = cleanIgnored.replace(/\D/g, '');
      if (targetDigits.length >= 8 && ignDigits.length >= 8) {
        if (targetDigits === ignDigits) return true;

        if (targetDigits.length <= 13 && ignDigits.length <= 13) {
          if (targetDigits.endsWith(ignDigits) || ignDigits.endsWith(targetDigits)) {
            return true;
          }

          // Normalização do 9º dígito móvel brasileiro
          const targetWithout9 = targetDigits.length === 13 && targetDigits.startsWith('55')
            ? targetDigits.slice(0, 4) + targetDigits.slice(5)
            : (targetDigits.length === 11 ? targetDigits.slice(0, 2) + targetDigits.slice(3) : targetDigits);

          const ignWithout9 = ignDigits.length === 13 && ignDigits.startsWith('55')
            ? ignDigits.slice(0, 4) + ignDigits.slice(5)
            : (ignDigits.length === 11 ? ignDigits.slice(0, 2) + ignDigits.slice(3) : ignDigits);

          if (targetWithout9 === ignWithout9 || targetWithout9.endsWith(ignWithout9) || ignWithout9.endsWith(targetWithout9)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Versão assíncrona com consulta ativa à WAHA:
   * 1. Executa verificação síncrona imediata via isNumberIgnored.
   * 2. Se for um @lid e ainda não tiver mapeamento, consulta resolveLidToPhone(rawPhoneOrChatId, sessionName).
   * 3. Para cada número na lista de ignorados, consulta resolvePhoneToLid(ignoredPhone, sessionName).
   * 4. Se ainda não resolveu, sincroniza a tabela de LIDs da WAHA e reavalia.
   */
  async isNumberIgnoredAsync(
    agent: AgentProfile | null | undefined,
    rawPhoneOrChatId: string,
    sessionName?: string
  ): Promise<boolean> {
    if (!agent || !agent.ignoredNumbers || !Array.isArray(agent.ignoredNumbers) || agent.ignoredNumbers.length === 0) {
      return false;
    }
    if (!rawPhoneOrChatId) return false;

    // 1. Verificação síncrona rápida
    if (this.isNumberIgnored(agent, rawPhoneOrChatId)) {
      return true;
    }

    const session = (sessionName && sessionName !== '*')
      ? sessionName
      : (agent.wahaSession && agent.wahaSession !== '*' ? agent.wahaSession : 'default');

    let target = String(rawPhoneOrChatId).trim();
    if (target.includes(':')) {
      const colonIdx = target.indexOf(':');
      const atIdx = target.indexOf('@');
      if (colonIdx !== -1 && atIdx !== -1 && colonIdx < atIdx) {
        const prefix = target.substring(0, colonIdx);
        if (!/^\d+$/.test(prefix)) {
          target = target.substring(colonIdx + 1).trim();
        }
      }
    }

    // 2. Se o target for LID, tenta resolver ativamente via WAHA API
    if (target.includes('@lid')) {
      try {
        const resolvedPhone = await wahaClient.resolveLidToPhone(target, session);
        if (resolvedPhone) {
          if (this.isNumberIgnored(agent, resolvedPhone)) {
            return true;
          }
        }
      } catch {
        // continua
      }
    }

    // 3. Tenta resolver na WAHA os telefones da lista de ignorados para seus respectivos @lid
    for (const rawIgnored of agent.ignoredNumbers) {
      if (!rawIgnored) continue;
      const cleanIgnored = sanitizeIgnoredNumber(rawIgnored) || String(rawIgnored).trim();
      if (!cleanIgnored || cleanIgnored.includes('@lid')) continue;

      const digits = cleanIgnored.replace(/\D/g, '');
      if (digits.length >= 8 && digits.length <= 13) {
        try {
          const mappedLid = await wahaClient.resolvePhoneToLid(digits, session);
          if (mappedLid) {
            if (this.isNumberIgnored(agent, rawPhoneOrChatId)) {
              return true;
            }
          }
        } catch {
          // continua
        }
      }
    }

    // 4. Sincroniza a tabela inteira de LIDs da sessão e retesta
    try {
      await wahaClient.syncSessionLids(session);
      if (this.isNumberIgnored(agent, rawPhoneOrChatId)) {
        return true;
      }
    } catch {
      // continua
    }

    return false;
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

/**
 * Sanitiza e normaliza números ou identificadores @lid inseridos pelo usuário.
 * Suporta:
 * - Telefones normais: "5587988887777", "87988887777", "(87) 98888-7777", "+55 87 8888-7777"
 * - Identificadores @lid: "62887095701679@lid", "62887095701679:0@lid"
 * - Prefixos de agentes copiados da tela: "avi-a2o1:62887095701679@lid" -> "62887095701679@lid"
 * - LIDs de 14+ dígitos sem sufixo: "62887095701679" -> "62887095701679@lid"
 */
export function sanitizeIgnoredNumber(raw: any): string | null {
  if (raw === null || raw === undefined) return null;
  let str = String(raw).trim();
  if (!str) return null;

  // 1. Remove qualquer prefixo de agente se houver (ex: "avi-a2o1:62887095701679@lid" -> "62887095701679@lid")
  if (str.includes(':')) {
    const colonIdx = str.indexOf(':');
    const atIdx = str.indexOf('@');
    if (colonIdx !== -1 && atIdx !== -1 && colonIdx < atIdx) {
      const prefix = str.substring(0, colonIdx);
      if (!/^\d+$/.test(prefix)) {
        str = str.substring(colonIdx + 1).trim();
      }
    }
  }

  // 2. Remove sufixo de dispositivo multi-device (:0, :1, etc) antes de @
  if (str.includes(':') && str.includes('@')) {
    str = str.replace(/:\d+@/, '@');
  }

  // 3. Se contiver @lid
  if (str.toLowerCase().includes('@lid')) {
    const lidDigits = str.replace(/\D/g, '');
    if (lidDigits.length >= 8) {
      return `${lidDigits}@lid`;
    }
  }

  // 4. Se for telefone com @c.us ou @s.whatsapp.net
  if (str.toLowerCase().includes('@c.us') || str.toLowerCase().includes('@s.whatsapp.net')) {
    const digits = str.replace(/\D/g, '');
    if (digits.length >= 8) {
      return digits;
    }
  }

  // 5. Se for puramente dígitos ou telefone formatado
  const digits = str.replace(/\D/g, '');
  if (digits.length >= 8) {
    // WhatsApp LIDs tipicamente possuem 14 a 16 dígitos e NÃO iniciam com 55 (DDI Brasil).
    if (digits.length >= 14 && (!digits.startsWith('55') || digits.length >= 15)) {
      return `${digits}@lid`;
    }
    return digits;
  }

  return null;
}
