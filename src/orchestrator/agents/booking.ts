import { IAgent, AgentContext, AgentResponse } from './base.js';
import { appointmentManager } from '../../appointments/appointment-manager.js';
import { notificationService, matchPhoneOrChatId } from '../../appointments/notification-service.js';
import { partnerManager } from '../../appointments/partner-manager.js';
import { Specialist, ServiceItem, Appointment, Partner } from '../../appointments/types.js';
import { agentManager } from '../../config/agent-manager.js';
import { lidMapper } from '../../appointments/phone-utils.js';
import { pendingReminderTracker } from '../../appointments/pending-reminder-tracker.js';

interface BookingSessionState {
  step: 'select_referral' | 'select_partner' | 'select_specialist' | 'select_service' | 'select_date' | 'select_slot' | 'confirm_name' | 'confirm_phone' | 'confirm_cancellation';
  referralType?: 'particular' | 'partner';
  partnerId?: string;
  partnerName?: string;
  specialistId?: string;
  serviceId?: string;
  dateStr?: string;
  slot?: string;
  clientName?: string;
  clientPhone?: string;
  cancellationAptId?: string;
  offeredPartners?: Partner[];
  offeredDates?: { label: string; date: string }[];
  offeredSlots?: string[];
  offeredSpecialists?: Specialist[];
  offeredServices?: ServiceItem[];
  updatedAt: number;
}

export class BookingAgent implements IAgent {
  name = 'BookingAgent';
  description = 'Gerencia agendamentos interativos, anti-conflitos, cancelamentos e confirmações de presença D-1 via WhatsApp.';

  // Sessões em memória por chatId (expiram após 10 minutos)
  private sessions: Map<string, BookingSessionState> = new Map();
  private readonly SESSION_TIMEOUT_MS = 10 * 60 * 1000;

  private getSession(chatId: string): BookingSessionState | undefined {
    const s = this.sessions.get(chatId);
    if (!s) return undefined;
    if (Date.now() - s.updatedAt > this.SESSION_TIMEOUT_MS) {
      this.sessions.delete(chatId);
      return undefined;
    }
    return s;
  }

  private setSession(chatId: string, state: Partial<BookingSessionState>): BookingSessionState {
    const current = this.getSession(chatId) || { step: 'select_specialist', updatedAt: Date.now() };
    const updated: BookingSessionState = {
      ...current,
      ...state,
      updatedAt: Date.now()
    };
    this.sessions.set(chatId, updated);
    return updated;
  }

  private clearSession(chatId: string): void {
    this.sessions.delete(chatId);
  }

  private sanitizeChoiceText(text: string): { clean: string; digits: string; unaccented: string } {
    if (!text) return { clean: '', digits: '', unaccented: '' };
    // Remove caracteres invisíveis do WhatsApp (LTR, RTL, zero-width, BOM, non-breaking space, etc.)
    const stripped = text.replace(/[\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF\u00A0]/g, '');
    const clean = stripped
      .toLowerCase()
      .trim()
      .replace(/[\*\_\#\.\,\-\)\(\[\]]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const unaccented = clean
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

    const digits = clean.replace(/\D/g, '');
    return { clean, digits, unaccented };
  }

  /**
   * Identifica se a mensagem é uma opção de confirmação do lembrete D-1
   */
  public isConfirmChoice(text: string): boolean {
    const { clean, digits, unaccented } = this.sanitizeChoiceText(text);
    if (!clean && !unaccented) return false;

    // Se o único dígito for 1 e não contiver 2
    if (digits === '1') {
      if (clean === '1' || clean === '1️⃣' || clean === '✅') return true;
      if (/^(o\s+)?(numero|opcao|op|item)?\s*1$/i.test(unaccented)) return true;
      if (/^1\s*(sim|confirmo|confirmar|confirmado|presenca|presença|vou|por favor)?$/i.test(unaccented)) return true;
      if (clean.length <= 30 && !clean.includes('2')) return true;
    }

    // Formas textuais do número um (sem dígitos)
    if (/^(o\s+)?(numero|opcao|op|item)?\s*um$/i.test(unaccented)) return true;
    if (unaccented.includes('numero um') || unaccented.includes('opcao um') || unaccented.includes('item um')) return true;

    // Palavras-chave inequívocas de confirmação
    const confirmKeywords = [
      'sim', 'confirmo', 'confirmado', 'confirmar', 'vou', 'com certeza',
      'confirmar presenca', 'presenca confirmada',
      'sim confirmo', 'estarei la', 'pode confirmar'
    ];
    if (confirmKeywords.includes(unaccented)) return true;
    if (unaccented.startsWith('sim ') || unaccented.startsWith('confirmo ') || unaccented.startsWith('confirmar ')) return true;

    return false;
  }

  /**
   * Identifica se a mensagem é uma opção de cancelamento/desistência do lembrete D-1
   */
  public isCancelChoice(text: string): boolean {
    const { clean, digits, unaccented } = this.sanitizeChoiceText(text);
    if (!clean && !unaccented) return false;

    // Se o único dígito for 2 e não contiver 1
    if (digits === '2') {
      if (clean === '2' || clean === '2️⃣' || clean === '❌') return true;
      if (/^(o\s+)?(numero|opcao|op|item)?\s*2$/i.test(unaccented)) return true;
      if (/^2\s*(não|nao|cancelo|cancelar|desisto|desistir|liberar vaga|não poderei|nao poderei|liberar|vaga|por favor)?$/i.test(unaccented)) return true;
      if (clean.length <= 30 && !clean.includes('1')) return true;
    }

    // Formas textuais do número dois (sem dígitos)
    if (/^(o\s+)?(numero|opcao|op|item)?\s*dois$/i.test(unaccented)) return true;
    if (unaccented.includes('numero dois') || unaccented.includes('opcao dois') || unaccented.includes('item dois')) return true;

    // Expressões e palavras-chave de cancelamento / desistência
    const cancelKeywords = [
      'nao', 'cancelo', 'desisto', 'cancelar', 'desistir',
      'nao poderei', 'nao poderei ir',
      'nao vou', 'nao vou poder',
      'liberar vaga', 'desmarcar', 'nao posso',
      'nao poderei ir liberar vaga',
      'nao tenho como ir'
    ];
    if (cancelKeywords.includes(unaccented)) return true;
    if (unaccented.startsWith('nao poderei') || unaccented.startsWith('nao vou') || unaccented.startsWith('nao posso')) return true;
    if (unaccented.includes('liberar vaga') || unaccented.includes('desmarcar')) return true;
    if (unaccented.includes('desist') || unaccented.includes('cancel')) return true;

    return false;
  }

  public isReminderChoice(text: string): boolean {
    return this.isConfirmChoice(text) || this.isCancelChoice(text);
  }

  /**
   * Localiza agendamento pendente de confirmação ou cancelamento por resposta a lembrete
   */
  public findReminderAppointment(
    chatIdOrContext: string | AgentContext,
    fallbackAgentId?: string
  ): Appointment | undefined {
    let chatId = '';
    let agentId = fallbackAgentId;
    let contactName: string | undefined;
    let session: string | undefined;
    let quotedMessageId: string | undefined;

    if (typeof chatIdOrContext === 'string') {
      chatId = chatIdOrContext;
    } else if (chatIdOrContext) {
      chatId = chatIdOrContext.chatId;
      agentId = chatIdOrContext.agent?.id || fallbackAgentId;
      contactName = chatIdOrContext.contactName;
      session = chatIdOrContext.session;
      quotedMessageId = chatIdOrContext.metadata?.payload?.replyTo?.id ||
        chatIdOrContext.metadata?.payload?._data?.quotedStanzaID ||
        chatIdOrContext.metadata?.payload?.quotedMsgId;
    }

    console.log(`[BookingAgent] 🔍 Buscando agendamento para resposta a lembrete: chatId=${chatId}, contactName=${contactName || 'N/A'}, agentId=${agentId || 'N/A'}, session=${session || 'N/A'}`);

    // Prioridade 0: Buscar no PendingReminderTracker (inteligente com tolerância a LID, nomes e quotes)
    const tracked = pendingReminderTracker.findPendingReminder({
      chatId,
      contactName,
      session,
      agentId,
      quotedMessageId
    });

    if (tracked) {
      const apt = appointmentManager.getAppointment(tracked.appointmentId);
      if (apt && apt.status !== 'cancelled' && apt.status !== 'cancelled_by_patient') {
        console.log(`[BookingAgent] ✅ Agendamento localizado com sucesso via PendingReminderTracker: ${apt.id} (${apt.clientName})`);
        return apt;
      }
    }

    // Prioridade 1+: Busca no appointmentManager
    const all = appointmentManager.listAppointments();
    const isMatch = (apt: Appointment) => {
      return matchPhoneOrChatId(apt.clientChatId, chatId) || matchPhoneOrChatId(apt.clientPhone, chatId);
    };

    const isPendingReminder = (a: Appointment) =>
      Boolean(a.reminderSent) && (a.status === 'confirmed' || a.status === 'scheduled') && isMatch(a);

    const isActive = (a: Appointment) =>
      (a.status === 'confirmed' || a.status === 'scheduled' || a.status === 'presence_confirmed') && isMatch(a);

    // Prioridade 1: Agendamento com lembrete pendente na empresa específica
    if (agentId && agentId !== 'all') {
      const companyApts = all.filter(a => a.agentId === agentId);
      const companyReminder = companyApts.find(isPendingReminder);
      if (companyReminder) {
        console.log(`[BookingAgent] ✅ Agendamento localizado por lembrete da empresa: ${companyReminder.id} (${companyReminder.clientName})`);
        return companyReminder;
      }

      const companyActive = companyApts.find(isActive);
      if (companyActive) {
        console.log(`[BookingAgent] ✅ Agendamento ativo localizado na empresa: ${companyActive.id} (${companyActive.clientName})`);
        return companyActive;
      }
    }

    // Prioridade 2: Agendamento com lembrete pendente em qualquer empresa cadastrada
    const globalReminder = all.find(isPendingReminder);
    if (globalReminder) {
      console.log(`[BookingAgent] ✅ Agendamento localizado por lembrete global: ${globalReminder.id} (${globalReminder.clientName})`);
      return globalReminder;
    }

    // Prioridade 3: Qualquer agendamento ativo correspondente a este contato
    const globalActive = all.find(isActive);
    if (globalActive) {
      console.log(`[BookingAgent] ✅ Agendamento ativo localizado globalmente: ${globalActive.id} (${globalActive.clientName})`);
      return globalActive;
    }

    // Prioridade 4: Se o chatId for @lid ou sem match direto, correlaciona por contactName com agendamentos de amanhã/hoje
    if (contactName && contactName.trim().length >= 3) {
      const cleanContact = contactName.toLowerCase().trim().replace(/[^a-z0-9áéíóúãõç\s]/g, '');
      const contactTokens = cleanContact.split(/\s+/).filter(t => t.length >= 3);

      const candidateApts = all.filter(a => 
        (a.status === 'confirmed' || a.status === 'scheduled' || a.status === 'presence_confirmed') &&
        (Boolean(a.reminderSent) || a.date === appointmentManager.getTodayDateString() || a.date === appointmentManager.getTomorrowDateString())
      );

      for (const apt of candidateApts) {
        const cleanClient = apt.clientName.toLowerCase().trim().replace(/[^a-z0-9áéíóúãõç\s]/g, '');
        const clientTokens = cleanClient.split(/\s+/).filter(t => t.length >= 3);

        const firstMatch = contactTokens.length > 0 && clientTokens.length > 0 && contactTokens[0] === clientTokens[0];
        const sharedToken = contactTokens.some(ct => clientTokens.includes(ct));

        if (firstMatch || sharedToken) {
          console.log(`[BookingAgent] ✅ Agendamento correlacionado por nome do contato: ${apt.id} (${apt.clientName}) para contactName="${contactName}"`);
          if (chatId.endsWith('@lid') && apt.clientChatId) {
            lidMapper.register(chatId, apt.clientChatId);
          }
          return apt;
        }
      }
    }

    // Prioridade 5: Se há apenas UM agendamento ativo com reminderSent === true em todo o sistema
    const singleReminderList = all.filter(a => Boolean(a.reminderSent) && (a.status === 'confirmed' || a.status === 'scheduled'));
    if (singleReminderList.length === 1) {
      const single = singleReminderList[0];
      console.log(`[BookingAgent] ✅ Agendamento único com lembrete pendente no sistema: ${single.id} (${single.clientName})`);
      if (chatId.endsWith('@lid') && single.clientChatId) {
        lidMapper.register(chatId, single.clientChatId);
      }
      return single;
    }

    console.warn(`[BookingAgent] ⚠️ Nenhum agendamento encontrado para resposta a lembrete (chatId=${chatId})`);
    return undefined;
  }

  /**
   * Decide se este agente deve tratar a mensagem.
   */
  async canHandle(context: AgentContext): Promise<boolean> {
    const text = (context.userMessage || '').trim();
    const chatId = context.chatId;

    // 1. Se o usuário já está no meio de um fluxo de agendamento ou cancelamento ativo
    if (this.getSession(chatId)) {
      return true;
    }

    // 2. Se o usuário respondeu à mensagem de confirmação/desistência de lembrete (opção 1 ou 2)
    // CRÍTICO: Avalia ANTES do check de enableBooking do agente da sessão, pois o lembrete
    // pode ter sido disparado por outra empresa/agente do consultório para este mesmo contato!
    const isConfirm = this.isConfirmChoice(text);
    const isCancel = this.isCancelChoice(text);

    if (isConfirm || isCancel) {
      const apt = this.findReminderAppointment(context);
      if (apt) {
        return true;
      }
    }

    // 🔒 BLINDAGEM CRÍTICA: Se a empresa/agente NÃO possui a agenda habilitada,
    // NUNCA interceptar a conversa! O bot deve responder estritamente conforme o prompt da IA.
    if (!context.agent?.enableBooking) {
      return false;
    }

    const lowerText = text.toLowerCase();
    const agentId = context.agent.id;

    // 3. Intenção de Agendar — verifica se esta empresa tem médicos cadastrados
    const bookingKeywords = [
      'agendar', 'agendamento', 'marcar consulta', 'marcar horario', 'marcar horário',
      'quero agendar', 'preciso de consulta', 'disponibilidade de horario', 'horario disponivel',
      'horário disponível', 'vaga para consulta', 'marcar médico', 'marcar psicologo',
      'marcar dentista', 'fazer agendamento', 'consultas disponíveis'
    ];
    if (bookingKeywords.some(kw => lowerText.includes(kw))) {
      // Garante que só ativa o fluxo interativo se a empresa possuir especialistas cadastrados
      const specialists = appointmentManager.listSpecialists(agentId).filter(s => s.active);
      if (specialists.length === 0) {
        return false;
      }
      return true;
    }

    // 4. Intenção de Cancelar / Ver Agendamentos
    const cancelKeywords = [
      'cancelar agendamento', 'cancelar consulta', 'desmarcar consulta',
      'desmarcar agendamento', 'desmarcar horario', 'desmarcar horário',
      'meus agendamentos', 'minhas consultas'
    ];
    if (cancelKeywords.some(kw => lowerText.includes(kw))) {
      return true;
    }

    return false;
  }


  /**
   * Execução da lógica de agendamento conversacional
   */
  async execute(context: AgentContext): Promise<AgentResponse> {
    const text = (context.userMessage || '').trim();
    const lowerText = text.toLowerCase();
    const chatId = context.chatId;
    const agentId = context.agent?.id || 'default';
    const companyName = context.agent?.companyName || 'Nossa Clínica';

    // 0. Se o usuário quiser sair ou cancelar a qualquer momento
    if (['cancelar', 'sair', 'parar', 'abortar', 'voltar ao início', 'desistir'].includes(lowerText)) {
      const hadSession = !!this.getSession(chatId);
      this.clearSession(chatId);
      if (hadSession) {
        return {
          handled: true,
          agentName: this.name,
          replyText: `Agendamento cancelado. Se precisar de mais alguma informação ou desejar marcar em outro momento, é só me chamar! 😊`
        };
      }
    }

    // 1. Verifica se é resposta ao Lembrete D-1 (Confirmar ou Desistir da consulta)
    const isConfirmChoice = this.isConfirmChoice(text);
    const isCancelChoice = this.isCancelChoice(text);

    if (isConfirmChoice || isCancelChoice) {
      const apt = this.findReminderAppointment(context, agentId);
      if (apt) {
        // Encontra o agente da empresa dona da consulta
        const aptAgent = agentManager.getAgent(apt.agentId) || context.agent;
        const effectiveCompanyName = aptAgent?.companyName || companyName;

        if (isConfirmChoice) {
          appointmentManager.updateAppointment(apt.id, { status: 'presence_confirmed' });
          pendingReminderTracker.markResolved(apt.id);

          return {
            handled: true,
            agentName: this.name,
            replyText: `🎉 *Presença Confirmada!*\n\nMuito obrigado, *${apt.clientName}*! Seu horário com *${apt.specialistName}* para o dia ${notificationService.formatDateBR(apt.date)} às *${apt.startTime}* está 100% garantido.\n\nNos vemos na *${effectiveCompanyName}*! Tenha um excelente dia! 😊`
          };
        }

        if (isCancelChoice) {
          appointmentManager.cancelAppointment(apt.id, true);
          notificationService.notifySpecialistCancellation(apt);
          pendingReminderTracker.markResolved(apt.id);

          return {
            handled: true,
            agentName: this.name,
            replyText: `Entendido, *${apt.clientName}*. A sua consulta com *${apt.specialistName}* para ${notificationService.formatDateBR(apt.date)} às ${apt.startTime} na *${effectiveCompanyName}* foi cancelada e o horário liberado para outros pacientes.\n\nAgradecemos imensamente por nos avisar com antecedência! Se quiser remarcar para outro dia ou horário, é só digitar *agendar*. 🙏`
          };
        }
      }
    }

    // 2. Intenção de Cancelamento manual ou Ver Meus Agendamentos
    const cancelKeywords = ['cancelar agendamento', 'cancelar consulta', 'desmarcar consulta', 'desmarcar agendamento', 'desmarcar horario', 'meus agendamentos', 'minhas consultas'];
    if (cancelKeywords.some(kw => lowerText.includes(kw)) && !this.getSession(chatId)) {
      const activeApts = appointmentManager.getAppointmentsByChatId(chatId);

      if (activeApts.length === 0) {
        return {
          handled: true,
          agentName: this.name,
          replyText: `Você não possui nenhum agendamento ativo no momento na *${companyName}*.\n\nSe deseja marcar uma nova consulta, digite *agendar*!`
        };
      }

      if (activeApts.length === 1) {
        const apt = activeApts[0];
        this.setSession(chatId, {
          step: 'confirm_cancellation',
          cancellationAptId: apt.id
        });

        return {
          handled: true,
          agentName: this.name,
          replyText: `Encontramos o seguinte agendamento:\n\n` +
            `👨‍⚕️ *Especialista:* ${apt.specialistName}\n` +
            `🩺 *Serviço:* ${apt.serviceName}\n` +
            `📅 *Data:* ${notificationService.formatDateBR(apt.date)}\n` +
            `⏰ *Horário:* ${apt.startTime}\n\n` +
            `Deseja realmente cancelar este agendamento?\n` +
            `*1.* ❌ Sim, confirmar cancelamento\n` +
            `*2.* ↩️ Não, manter agendamento`
        };
      }

      // Se tiver mais de um agendamento
      let msg = `Você possui os seguintes agendamentos ativos:\n\n`;
      activeApts.forEach((a, idx) => {
        msg += `*${idx + 1}.* ${notificationService.formatDateBR(a.date)} às ${a.startTime} - ${a.specialistName} (${a.serviceName})\n`;
      });
      msg += `\nDigite o número do agendamento que deseja cancelar (ou digite *sair* para voltar):`;

      this.setSession(chatId, {
        step: 'confirm_cancellation',
        offeredSlots: activeApts.map(a => a.id)
      });

      return {
        handled: true,
        agentName: this.name,
        replyText: msg
      };
    }

    // 3. Máquina de Estados da Sessão
    let session = this.getSession(chatId);

    // Se ainda não tem sessão, inicia nova sessão de agendamento
    if (!session) {
      return this.startBookingFlow(chatId, agentId, companyName);
    }

    // Processa o passo atual da sessão
    switch (session.step) {
      case 'confirm_cancellation':
        return this.handleCancellationStep(chatId, session, text);

      case 'select_referral':
        return this.handleSelectReferralStep(chatId, session, text, agentId, companyName);

      case 'select_partner':
        return this.handleSelectPartnerStep(chatId, session, text, agentId, companyName);

      case 'select_specialist':
        return this.handleSelectSpecialistStep(chatId, session, text, agentId);

      case 'select_service':
        return this.handleSelectServiceStep(chatId, session, text);

      case 'select_date':
        return this.handleSelectDateStep(chatId, session, text);

      case 'select_slot':
        return this.handleSelectSlotStep(chatId, session, text, context.contactName);

      case 'confirm_name':
        return this.handleConfirmNameStep(chatId, session, text);

      case 'confirm_phone':
        return this.handleConfirmPhoneStep(chatId, session, text, agentId, companyName);

      default:
        this.clearSession(chatId);
        return {
          handled: true,
          agentName: this.name,
          replyText: `Desculpe, ocorreu uma inconsistência no fluxo de agendamento. Digite *agendar* para recomeçar.`
        };
    }
  }

  /**
   * Inicia o fluxo de agendamento perguntando sobre convênio/particular se houver parceiros
   */
  private startBookingFlow(chatId: string, agentId: string, companyName: string): AgentResponse {
    const activePartners = partnerManager.listPartners(agentId).filter(p => p.active);

    if (activePartners.length > 0) {
      this.setSession(chatId, {
        step: 'select_referral',
        offeredPartners: activePartners
      });

      const welcomeMsg = `Olá! Que alegria atender você na *${companyName}*! 🗓️✨\n\n` +
        `Para organizarmos o seu atendimento, por favor informe:\n\n` +
        `*1.* 👤 Particular\n` +
        `*2.* 🏢 Encaminhamento / Convênio de Empresa Parceira\n\n` +
        `_Digite *1* para Particular ou *2* para Convênio/Parceiro:_`;

      return {
        handled: true,
        agentName: this.name,
        replyText: welcomeMsg
      };
    }

    // Se não houver parceiros, inicia direto na seleção de especialistas
    this.setSession(chatId, { referralType: 'particular' });
    return this.presentSpecialistsOrServices(chatId, agentId, companyName);
  }

  /**
   * Tratamento da escolha de atendimento Particular vs Convênio/Parceiro
   */
  private handleSelectReferralStep(
    chatId: string,
    session: BookingSessionState,
    text: string,
    agentId: string,
    companyName: string
  ): AgentResponse {
    const lower = text.toLowerCase().trim();
    const isParticular = lower === '1' || lower.includes('part') || lower === 'particular';
    const isPartner = lower === '2' || lower.includes('parc') || lower.includes('conv') || lower.includes('enca') || lower === 'encaminhamento';

    if (!isParticular && !isPartner) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Por favor, digite apenas *1* para Particular ou *2* para Encaminhamento / Convênio de Empresa Parceira:`
      };
    }

    if (isParticular) {
      this.setSession(chatId, {
        referralType: 'particular',
        partnerId: undefined,
        partnerName: undefined
      });
      return this.presentSpecialistsOrServices(chatId, agentId, companyName, 'Perfeito! Atendimento *Particular*.');
    }

    // Se escolheu parceiro/convênio
    const partners = session.offeredPartners && session.offeredPartners.length > 0
      ? session.offeredPartners
      : partnerManager.listPartners(agentId).filter(p => p.active);

    if (partners.length === 0) {
      this.setSession(chatId, { referralType: 'particular' });
      return this.presentSpecialistsOrServices(chatId, agentId, companyName, 'No momento não identificamos convênios ativos. Prosseguiremos como atendimento particular.');
    }

    if (partners.length === 1) {
      const p = partners[0];
      this.setSession(chatId, {
        referralType: 'partner',
        partnerId: p.id,
        partnerName: p.name
      });
      return this.presentSpecialistsOrServices(chatId, agentId, companyName, `Convênio vinculado com sucesso: *${p.name}*! ✅`);
    }

    this.setSession(chatId, {
      step: 'select_partner',
      referralType: 'partner',
      offeredPartners: partners
    });

    let msg = `🏢 *Empresas & Convênios Parceiros*\n\n` +
      `Selecione abaixo a empresa parceira ou clínica que realizou seu encaminhamento:\n\n`;

    partners.forEach((p, idx) => {
      msg += `*${idx + 1}.* ${p.name}\n`;
    });

    msg += `\n_Digite o número correspondente à empresa parceira:_`;

    return {
      handled: true,
      agentName: this.name,
      replyText: msg
    };
  }

  /**
   * Tratamento da seleção da empresa parceira específica
   */
  private handleSelectPartnerStep(
    chatId: string,
    session: BookingSessionState,
    text: string,
    agentId: string,
    companyName: string
  ): AgentResponse {
    const partners = session.offeredPartners || partnerManager.listPartners(agentId).filter(p => p.active);
    const chosenIndex = parseInt(text.replace(/\D/g, ''), 10) - 1;

    let chosenPartner: Partner | undefined;
    if (!isNaN(chosenIndex) && chosenIndex >= 0 && chosenIndex < partners.length) {
      chosenPartner = partners[chosenIndex];
    } else {
      const lower = text.toLowerCase();
      chosenPartner = partners.find(p => p.name.toLowerCase().includes(lower));
    }

    if (!chosenPartner) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Opção inválida. Por favor, digite o número de 1 a ${partners.length} correspondente à sua empresa parceira:`
      };
    }

    this.setSession(chatId, {
      referralType: 'partner',
      partnerId: chosenPartner.id,
      partnerName: chosenPartner.name
    });

    return this.presentSpecialistsOrServices(chatId, agentId, companyName, `Convênio vinculado com sucesso: *${chosenPartner.name}*! ✅`);
  }

  /**
   * Apresenta especialistas ou serviços após a escolha de particular/convênio
   */
  private presentSpecialistsOrServices(
    chatId: string,
    agentId: string,
    companyName: string,
    prefixMsg?: string
  ): AgentResponse {
    const specialists = appointmentManager.listSpecialists(agentId).filter(s => s.active);

    if (specialists.length === 0) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `${prefixMsg ? prefixMsg + '\n\n' : ''}No momento não há especialistas com agenda aberta na *${companyName}*. Por favor, tente novamente mais tarde ou fale com um de nossos atendentes.`
      };
    }

    // Se tiver apenas 1 especialista, pula direto para a escolha do serviço ou data
    if (specialists.length === 1) {
      const spec = specialists[0];
      const services = appointmentManager.listServices(agentId).filter(s => s.active);

      if (services.length > 1) {
        this.setSession(chatId, {
          step: 'select_service',
          specialistId: spec.id,
          offeredServices: services
        });

        let msg = `${prefixMsg ? prefixMsg + '\n\n' : ''}O atendimento será com *${spec.name}* (${spec.role}).\n` +
          `Qual procedimento você deseja agendar?\n\n`;

        services.forEach((srv, i) => {
          msg += `*${i + 1}.* ${srv.name} (${srv.durationMinutes} min) - ${srv.price ? `R$ ${srv.price.toFixed(2)}` : 'Consulte valor'}\n`;
        });
        msg += `\n_Digite o número do serviço desejado:_`;

        return {
          handled: true,
          agentName: this.name,
          replyText: msg
        };
      }

      // Se só tem 1 especialista e 1 ou 0 serviços
      this.setSession(chatId, {
        step: 'select_date',
        specialistId: spec.id,
        serviceId: services[0]?.id
      });
      return this.presentNextDates(chatId, spec);
    }

    // Caso tenha múltiplos especialistas, apresenta o menu numerado
    this.setSession(chatId, {
      step: 'select_specialist',
      offeredSpecialists: specialists
    });

    let msg = `${prefixMsg ? prefixMsg + '\n\n' : ''}Por favor, escolha com qual de nossos profissionais você gostaria de marcar:\n\n`;

    specialists.forEach((spec, idx) => {
      msg += `*${idx + 1}.* 👨‍⚕️ *${spec.name}* - ${spec.role}\n`;
    });

    msg += `\n_Digite o número correspondente ao especialista desejado (ou "sair" para cancelar):_`;

    return {
      handled: true,
      agentName: this.name,
      replyText: msg
    };
  }

  /**
   * Tratamento da seleção de especialista
   */
  private handleSelectSpecialistStep(
    chatId: string,
    session: BookingSessionState,
    text: string,
    agentId: string
  ): AgentResponse {
    const specialists = session.offeredSpecialists || appointmentManager.listSpecialists(agentId).filter(s => s.active);
    const num = parseInt(text.replace(/\D/g, ''), 10);

    let selected: Specialist | undefined;

    if (!isNaN(num) && num >= 1 && num <= specialists.length) {
      selected = specialists[num - 1];
    } else {
      // Tenta buscar por nome parcial
      const match = specialists.find(s => s.name.toLowerCase().includes(text.toLowerCase()));
      if (match) selected = match;
    }

    if (!selected) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Opção inválida. Por favor, digite o *número* de 1 a ${specialists.length} do especialista escolhido (ou digite "sair" para cancelar).`
      };
    }

    // Especialista selecionado! Checa serviços disponíveis
    const services = appointmentManager.listServices(agentId).filter(s => s.active);
    if (services.length > 1) {
      this.setSession(chatId, {
        step: 'select_service',
        specialistId: selected.id,
        offeredServices: services
      });

      let msg = `Ótimo! Você escolheu *${selected.name}* (${selected.role}). 👍\n\n` +
        `Qual procedimento você gostaria de realizar?\n\n`;

      services.forEach((srv, i) => {
        msg += `*${i + 1}.* ${srv.name} (${srv.durationMinutes} min) - ${srv.price ? `R$ ${srv.price.toFixed(2)}` : 'Consulte valor'}\n`;
      });
      msg += `\n_Digite o número do serviço desejado:_`;

      return {
        handled: true,
        agentName: this.name,
        replyText: msg
      };
    }

    // Se tiver 1 ou 0 serviços, avança direto para datas
    this.setSession(chatId, {
      step: 'select_date',
      specialistId: selected.id,
      serviceId: services[0]?.id
    });
    return this.presentNextDates(chatId, selected);
  }

  /**
   * Tratamento da seleção de serviço
   */
  private handleSelectServiceStep(
    chatId: string,
    session: BookingSessionState,
    text: string
  ): AgentResponse {
    const services = session.offeredServices || [];
    const num = parseInt(text.replace(/\D/g, ''), 10);

    let selectedService: ServiceItem | undefined;
    if (!isNaN(num) && num >= 1 && num <= services.length) {
      selectedService = services[num - 1];
    } else {
      const match = services.find(s => s.name.toLowerCase().includes(text.toLowerCase()));
      if (match) selectedService = match;
    }

    if (!selectedService) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Por favor, digite o número correspondente ao serviço desejado (1 a ${services.length}).`
      };
    }

    const spec = appointmentManager.getSpecialist(session.specialistId!);
    if (!spec) {
      this.clearSession(chatId);
      return { handled: true, agentName: this.name, replyText: 'Especialista não encontrado. Digite *agendar* para reiniciar.' };
    }

    this.setSession(chatId, {
      step: 'select_date',
      serviceId: selectedService.id
    });

    return this.presentNextDates(chatId, spec);
  }

  /**
   * Apresenta os próximos 5 dias úteis que o especialista atende e tem horários
   */
  private presentNextDates(chatId: string, specialist: Specialist): AgentResponse {
    const dates: { label: string; date: string }[] = [];
    const dayNames = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

    // Procura nos próximos 14 dias corridos
    const now = new Date();
    for (let i = 0; i < 14; i++) {
      const d = new Date(now);
      d.setDate(now.getDate() + i);

      const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Sao_Paulo',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
      });
      const dateStr = formatter.format(d);

      const slots = appointmentManager.getAvailableSlots(specialist.id, dateStr);
      if (slots.length > 0) {
        let label = '';
        if (i === 0) label = `Hoje (${notificationService.formatDateBR(dateStr)})`;
        else if (i === 1) label = `Amanhã (${notificationService.formatDateBR(dateStr)})`;
        else {
          const [y, m, day] = dateStr.split('-').map(Number);
          const dt = new Date(Date.UTC(y, m - 1, day, 12, 0, 0));
          label = `${dayNames[dt.getUTCDay()]} (${notificationService.formatDateBR(dateStr)})`;
        }
        dates.push({ label, date: dateStr });
      }

      if (dates.length >= 4) break; // Oferece os 4 primeiros dias com vagas
    }

    if (dates.length === 0) {
      this.clearSession(chatId);
      return {
        handled: true,
        agentName: this.name,
        replyText: `Infelizmente *${specialist.name}* não possui horários livres nos próximos dias. 😔\n\nPor favor, fale com um atendente humano para verificar lista de espera.`
      };
    }

    this.setSession(chatId, {
      step: 'select_date',
      offeredDates: dates
    });

    let msg = `📅 *Escolha a data desejada* para o atendimento com *${specialist.name}*:\n\n`;
    dates.forEach((item, idx) => {
      msg += `*${idx + 1}.* ${item.label}\n`;
    });
    msg += `\n_Digite o número do dia escolhido (ou digite "sair"):_`;

    return {
      handled: true,
      agentName: this.name,
      replyText: msg
    };
  }

  /**
   * Tratamento da seleção da data
   */
  private handleSelectDateStep(
    chatId: string,
    session: BookingSessionState,
    text: string
  ): AgentResponse {
    const dates = session.offeredDates || [];
    const num = parseInt(text.replace(/\D/g, ''), 10);

    let chosenDate: string | undefined;

    if (!isNaN(num) && num >= 1 && num <= dates.length) {
      chosenDate = dates[num - 1].date;
    } else {
      // Se digitou data no formato DD/MM ou DD/MM/AAAA
      if (text.includes('/')) {
        const parts = text.trim().split('/');
        if (parts.length >= 2) {
          const day = parts[0].padStart(2, '0');
          const month = parts[1].padStart(2, '0');
          const year = parts[2] || new Date().getFullYear().toString();
          const candidate = `${year}-${month}-${day}`;
          const match = dates.find(d => d.date === candidate);
          if (match) chosenDate = match.date;
        }
      }
    }

    if (!chosenDate) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Por favor, digite o número da data desejada (1 a ${dates.length}).`
      };
    }

    const specialistId = session.specialistId!;
    const specialist = appointmentManager.getSpecialist(specialistId);
    if (!specialist) {
      this.clearSession(chatId);
      return { handled: true, agentName: this.name, replyText: 'Especialista não encontrado. Digite *agendar*.' };
    }

    // Busca os horários livres na data escolhida
    const slots = appointmentManager.getAvailableSlots(specialistId, chosenDate);

    if (slots.length === 0) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Desculpe, todos os horários para esta data acabaram de ser preenchidos. Por favor, escolha outra data digitando o número correspondente.`
      };
    }

    this.setSession(chatId, {
      step: 'select_slot',
      dateStr: chosenDate,
      offeredSlots: slots
    });

    let msg = `⏰ *Horários disponíveis* para *${notificationService.formatDateBR(chosenDate)}* com *${specialist.name}*:\n\n`;
    slots.forEach((s, idx) => {
      msg += `*${idx + 1}.* 🕒 ${s}\n`;
    });
    msg += `\n_Digite o número do horário desejado (ou "sair" para cancelar):_`;

    return {
      handled: true,
      agentName: this.name,
      replyText: msg
    };
  }

  /**
   * Tratamento da seleção do horário
   */
  private handleSelectSlotStep(
    chatId: string,
    session: BookingSessionState,
    text: string,
    contactName?: string
  ): AgentResponse {
    const slots = session.offeredSlots || [];
    const num = parseInt(text.replace(/\D/g, ''), 10);

    let chosenSlot: string | undefined;

    if (!isNaN(num) && num >= 1 && num <= slots.length) {
      chosenSlot = slots[num - 1];
    } else {
      // Se digitou o horário direto (ex: "14:00")
      const direct = text.trim();
      if (slots.includes(direct)) {
        chosenSlot = direct;
      }
    }

    if (!chosenSlot) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Opção inválida. Por favor, digite o número correspondente ao horário desejado (1 a ${slots.length}).`
      };
    }

    // Se já tivermos o nome do contato do WhatsApp e o usuário puder confirmar
    this.setSession(chatId, {
      step: 'confirm_name',
      slot: chosenSlot
    });

    const isValidPatientName = !!(
      contactName &&
      contactName.length > 2 &&
      !contactName.includes('@') &&
      !/^[\d\s\-()+]+$/.test(contactName) &&
      !['cliente', 'cliente teste', 'desconhecido'].includes(contactName.toLowerCase().trim())
    );

    let promptName = `Perfeito! Horário escolhido: *${chosenSlot}* em *${notificationService.formatDateBR(session.dateStr!)}*.\n\n`;

    if (isValidPatientName) {
      promptName += `Por favor, digite o *Nome Completo do Paciente* para registro na ficha médica (ou responda *1* para confirmar no nome de *${contactName}*):`;
    } else {
      promptName += `Por favor, digite o *Nome Completo do Paciente* para finalizarmos o agendamento:`;
    }

    return {
      handled: true,
      agentName: this.name,
      replyText: promptName
    };
  }

  /**
   * Tratamento da confirmação de nome do paciente
   */
  private handleConfirmNameStep(
    chatId: string,
    session: BookingSessionState,
    text: string
  ): AgentResponse {
    let clientName = text.trim();

    if (clientName === '1' || clientName.toLowerCase() === 'sim') {
      clientName = 'Paciente WhatsApp';
    }

    if (!clientName || clientName.length < 2) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Por favor, informe o *Nome Completo do Paciente* para continuarmos:`
      };
    }

    // Salva o nome e avança para solicitar o WhatsApp de contato do paciente
    this.setSession(chatId, {
      step: 'confirm_phone',
      clientName
    });

    return {
      handled: true,
      agentName: this.name,
      replyText: `Muito bem, *${clientName}*! 👍\n\nAgora, por favor, digite o seu *número de WhatsApp com DDD* (ex: *11999998888* ou *(11) 99999-8888*):\n\n_Usaremos este número para enviar o comprovante do agendamento e o lembrete de presença na véspera._`
    };
  }

  /**
   * Tratamento da confirmação do telefone/WhatsApp e persistência final
   */
  private async handleConfirmPhoneStep(
    chatId: string,
    session: BookingSessionState,
    text: string,
    agentId: string,
    companyName: string
  ): Promise<AgentResponse> {
    const rawInput = text.trim();
    const digits = rawInput.replace(/\D/g, '');

    if (digits.length < 8) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Por favor, digite um número de WhatsApp válido com DDD (ex: *11999998888*):`
      };
    }

    let cleanPhone = digits;
    // Se digitou celular brasileiro padrão (10 ou 11 dígitos, ex: 11999998888), acrescenta 55
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
      cleanPhone = `55${digits}`;
    }

    const { specialistId, serviceId, dateStr, slot, clientName } = session;

    if (!specialistId || !dateStr || !slot || !clientName) {
      this.clearSession(chatId);
      return {
        handled: true,
        agentName: this.name,
        replyText: `Ocorreu um erro com os dados da sessão. Digite *agendar* para recomeçar.`
      };
    }

    // Cria o agendamento com validação anti-colisão
    try {
      const appointment = appointmentManager.createAppointment({
        agentId,
        specialistId,
        serviceId,
        clientChatId: chatId,
        clientPhone: cleanPhone,
        clientName,
        date: dateStr,
        startTime: slot,
        referralType: session.referralType || 'particular',
        partnerId: session.partnerId,
        partnerName: session.partnerName,
        bookedVia: 'whatsapp'
      });

      // Limpa a sessão do usuário
      this.clearSession(chatId);

      // Notifica o especialista no WhatsApp dele imediatamente!
      notificationService.notifySpecialistNewBooking(appointment).catch(err => {
        console.error('[BookingAgent] Falha ao notificar especialista assincronamente:', err);
      });

      const formattedPhone = this.formatDisplayPhone(cleanPhone);
      const referralLine = appointment.partnerName
        ? `🏢 *Convênio / Encaminhamento:* ${appointment.partnerName}\n`
        : `🏷️ *Tipo de Atendimento:* Particular\n`;

      const responseText = `🎉 *AGENDAMENTO CONFIRMADO COM SUCESSO!*\n\n` +
        `🏢 *${companyName}*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `👤 *Paciente:* ${appointment.clientName}\n` +
        `📱 *WhatsApp:* ${formattedPhone}\n` +
        referralLine +
        `👨‍⚕️ *Especialista:* ${appointment.specialistName} (${appointment.specialistRole})\n` +
        `🩺 *Procedimento:* ${appointment.serviceName}\n` +
        `📅 *Data:* ${notificationService.formatDateBR(appointment.date)}\n` +
        `⏰ *Horário:* ${appointment.startTime} às ${appointment.endTime}\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `✅ O especialista já foi avisado e sua vaga está reservada no sistema.\n` +
        `🔔 No final do dia anterior, enviaremos um lembrete para você confirmar sua presença.\n\n` +
        `_Caso precise remarcar ou cancelar, basta digitar "cancelar agendamento" a qualquer momento._\n\n` +
        `Agradecemos a confiança!`;

      return {
        handled: true,
        agentName: this.name,
        replyText: responseText
      };
    } catch (err: any) {
      console.error('[BookingAgent] Erro ao criar agendamento:', err.message);
      this.clearSession(chatId);
      return {
        handled: true,
        agentName: this.name,
        replyText: `Desculpe, esse horário foi reservado por outra pessoa há poucos instantes ou está indisponível.\n\nPor favor, digite *agendar* para escolher um novo horário.`
      };
    }
  }

  private formatDisplayPhone(phone: string): string {
    const digits = phone.replace(/\D/g, '');
    if (digits.length === 13 && digits.startsWith('55')) {
      const ddd = digits.substring(2, 4);
      const part1 = digits.substring(4, 9);
      const part2 = digits.substring(9, 13);
      return `+55 (${ddd}) ${part1}-${part2}`;
    }
    if (digits.length === 11) {
      const ddd = digits.substring(0, 2);
      const part1 = digits.substring(2, 7);
      const part2 = digits.substring(7, 11);
      return `(${ddd}) ${part1}-${part2}`;
    }
    return phone;
  }

  /**
   * Tratamento de cancelamento de agendamento selecionado
   */
  private handleCancellationStep(
    chatId: string,
    session: BookingSessionState,
    text: string
  ): AgentResponse {
    const lower = text.toLowerCase().trim();

    if (['2', 'nao', 'não', 'manter', 'sair'].includes(lower)) {
      this.clearSession(chatId);
      return {
        handled: true,
        agentName: this.name,
        replyText: `Perfeito! Seu agendamento foi mantido sem alterações.`
      };
    }

    let targetAptId = session.cancellationAptId;

    if (!targetAptId && session.offeredSlots) {
      const num = parseInt(text.replace(/\D/g, ''), 10);
      if (!isNaN(num) && num >= 1 && num <= session.offeredSlots.length) {
        targetAptId = session.offeredSlots[num - 1];
      }
    }

    if (!targetAptId) {
      // Se respondeu 1 com agendamento único
      if (['1', 'sim', 'confirmar', 'cancela'].includes(lower) && session.cancellationAptId) {
        targetAptId = session.cancellationAptId;
      }
    }

    if (!targetAptId) {
      return {
        handled: true,
        agentName: this.name,
        replyText: `Opção inválida. Digite *1* para confirmar o cancelamento ou *2* para manter seu agendamento.`
      };
    }

    try {
      const cancelledApt = appointmentManager.cancelAppointment(targetAptId, true);
      this.clearSession(chatId);

      // Notifica o especialista
      notificationService.notifySpecialistCancellation(cancelledApt).catch(err => {
        console.error('[BookingAgent] Falha ao notificar cancelamento ao especialista:', err);
      });

      return {
        handled: true,
        agentName: this.name,
        replyText: `✅ Seu agendamento para o dia *${notificationService.formatDateBR(cancelledApt.date)} às ${cancelledApt.startTime}* foi cancelado com sucesso.\n\nO horário foi liberado no sistema. Quando desejar marcar um novo atendimento, estaremos à sua disposição!`
      };
    } catch (err: any) {
      this.clearSession(chatId);
      return {
        handled: true,
        agentName: this.name,
        replyText: `Não foi possível cancelar o agendamento: ${err.message}`
      };
    }
  }
}
