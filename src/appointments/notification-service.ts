import { Appointment, Specialist } from './types.js';
import { appointmentManager } from './appointment-manager.js';
import { wahaClient } from '../waha/client.js';
import { agentManager } from '../config/agent-manager.js';
import { env } from '../config/index.js';
import { botTracker } from '../orchestrator/bot-tracker.js';
import { memoryStore } from '../gemini/memory.js';
import { formatToWhatsAppChatId, matchPhoneOrChatId, getAlternateBrazilianChatId } from './phone-utils.js';

export { formatToWhatsAppChatId, matchPhoneOrChatId, getAlternateBrazilianChatId };

export class NotificationService {
  private lastError: string = '';

  getLastError(): string {
    return this.lastError;
  }

  /**
   * Formata telefone para o padrão de chatId do WhatsApp (ex: 5511999998888@c.us)
   * Garante o DDI 55 do Brasil para números com 10 ou 11 dígitos.
   */
  formatToWhatsAppChatId(phoneStr: string): string {
    return formatToWhatsAppChatId(phoneStr);
  }

  /**
   * Formata data YYYY-MM-DD para DD/MM/AAAA
   */
  formatDateBR(dateStr: string): string {
    if (!dateStr || !dateStr.includes('-')) return dateStr;
    const [y, m, d] = dateStr.split('-');
    return `${d}/${m}/${y}`;
  }

  /**
   * Envia notificação ao WhatsApp do especialista quando uma nova consulta é confirmada
   */
  async notifySpecialistNewBooking(appointment: Appointment, specialist?: Specialist): Promise<boolean> {
    this.lastError = '';

    const spec = specialist
      || appointmentManager.getSpecialist(appointment.specialistId)
      || appointmentManager.listSpecialists().find(s => s.id === appointment.specialistId || s.name === appointment.specialistName);

    if (!spec || !spec.phone) {
      this.lastError = `Especialista "${appointment.specialistName}" não possui telefone de WhatsApp cadastrado.`;
      console.log(`[NotificationService] ${this.lastError}`);
      return false;
    }

    const agent = agentManager.getAgent(appointment.agentId) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const targetChatId = this.formatToWhatsAppChatId(spec.phone);
    const rawSession = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;
    const session = (rawSession && rawSession !== '*') ? rawSession : 'default';

    if (!targetChatId) {
      this.lastError = `Telefone "${spec.phone}" do especialista é inválido.`;
      return false;
    }

    const message = `🔔 *Novo Agendamento Confirmado!*\n\n` +
      `🏢 *Empresa / Clínica:* ${companyName}\n` +
      `👨‍⚕️ *Especialista:* ${spec.name} (${spec.role})\n` +
      `🩺 *Procedimento:* ${appointment.serviceName}\n` +
      `👤 *Paciente:* ${appointment.clientName}\n` +
      `📱 *WhatsApp do Paciente:* ${appointment.clientPhone}\n` +
      `📅 *Data:* ${this.formatDateBR(appointment.date)}\n` +
      `⏰ *Horário:* ${appointment.startTime} às ${appointment.endTime}\n` +
      (appointment.notes ? `📝 *Observações:* ${appointment.notes}\n` : '') +
      `\n_Agendamento registrado via BotZap._`;

    try {
      const sendRes = await wahaClient.sendText(targetChatId, message, { session });
      // Registra mensagem no botTracker para não pausar o bot ao receber o eco do WhatsApp
      botTracker.recordBotMessage(targetChatId, message, sendRes?.id);

      appointmentManager.updateAppointment(appointment.id, {
        notifiedSpecialist: true,
        notifiedAt: new Date().toISOString()
      });
      console.log(`[NotificationService] Alerta enviado ao especialista ${spec.name} (${targetChatId}).`);
      return true;
    } catch (err: any) {
      const errorMsg = err.message || 'Falha ao enviar mensagem pela WAHA.';
      this.lastError = `Erro ao notificar ${spec.name} (${targetChatId}): ${errorMsg}`;
      console.error(`[NotificationService] ${this.lastError}`);
      return false;
    }
  }

  /**
   * Envia notificação ao WhatsApp do especialista quando uma consulta é cancelada
   */
  async notifySpecialistCancellation(appointment: Appointment, specialist?: Specialist): Promise<boolean> {
    this.lastError = '';

    const spec = specialist
      || appointmentManager.getSpecialist(appointment.specialistId)
      || appointmentManager.listSpecialists().find(s => s.id === appointment.specialistId || s.name === appointment.specialistName);

    if (!spec || !spec.phone) return false;

    const agent = agentManager.getAgent(appointment.agentId) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const targetChatId = this.formatToWhatsAppChatId(spec.phone);
    const rawSession = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;
    const session = (rawSession && rawSession !== '*') ? rawSession : 'default';

    const message = `⚠️ *Aviso de Cancelamento de Consulta*\n\n` +
      `🏢 *Clínica:* ${companyName}\n` +
      `O paciente *${appointment.clientName}* cancelou a consulta agendada para:\n` +
      `📅 *Data:* ${this.formatDateBR(appointment.date)}\n` +
      `⏰ *Horário:* ${appointment.startTime} às ${appointment.endTime}\n` +
      `🩺 *Procedimento:* ${appointment.serviceName}\n\n` +
      `_O horário foi automaticamente liberado na sua agenda para novos encaixes._`;

    try {
      const sendRes = await wahaClient.sendText(targetChatId, message, { session });
      botTracker.recordBotMessage(targetChatId, message, sendRes?.id);

      console.log(`[NotificationService] Alerta de cancelamento enviado ao especialista ${spec.name}.`);
      return true;
    } catch (err: any) {
      this.lastError = err.message || 'Falha ao avisar especialista sobre cancelamento.';
      console.error(`[NotificationService] Falha ao alertar especialista sobre cancelamento:`, this.lastError);
      return false;
    }
  }

  /**
   * Envia lembrete D-1 (fim do dia anterior) para o paciente confirmar presença ou desistir
   */
  async sendDMinusOneReminder(appointment: Appointment): Promise<boolean> {
    this.lastError = '';

    const agent = agentManager.getAgent(appointment.agentId) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const rawSession = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;
    const session = (rawSession && rawSession !== '*') ? rawSession : 'default';

    // Se o clientChatId for @lid ou vazio, prioriza o telefone formatado do paciente
    let targetChatId = appointment.clientChatId;
    if (!targetChatId || targetChatId.includes('@lid') || !targetChatId.endsWith('@c.us')) {
      const formattedPhone = this.formatToWhatsAppChatId(appointment.clientPhone);
      if (formattedPhone) {
        targetChatId = formattedPhone;
      }
    }

    // Garante que o chat está ativo para poder responder (despausa em caso de pausa prévia)
    if (targetChatId) {
      memoryStore.resumeChat(targetChatId, agent.id);
    }
    if (appointment.clientChatId && appointment.clientChatId !== targetChatId) {
      memoryStore.resumeChat(appointment.clientChatId, agent.id);
    }

    const message = `Olá, *${appointment.clientName}*! 👋\n\n` +
      `Aqui é da equipe da *${companyName}*.\n` +
      `Passando para lembrar da sua consulta agendada para *amanhã, ${this.formatDateBR(appointment.date)} às ${appointment.startTime}* com *${appointment.specialistName}* (${appointment.serviceName}).\n\n` +
      `Por favor, para mantermos sua vaga reservada, *você confirma sua presença?*\n\n` +
      `*1.* ✅ Sim, confirmo minha presença\n` +
      `*2.* ❌ Não poderei ir (liberar vaga)\n\n` +
      `_Digite o número *1* para confirmar ou *2* para cancelar._`;

    try {
      const sendRes = await wahaClient.sendText(targetChatId, message, { session });
      // Rastreia mensagem para que o eco da WAHA não congele/pause o bot para este cliente
      botTracker.recordBotMessage(targetChatId, message, sendRes?.id);
      if (appointment.clientChatId && appointment.clientChatId !== targetChatId) {
        botTracker.recordBotMessage(appointment.clientChatId, message, sendRes?.id);
      }

      appointmentManager.updateAppointment(appointment.id, {
        reminderSent: true,
        reminderSentAt: new Date().toISOString()
      });
      console.log(`[NotificationService] Lembrete D-1 enviado com sucesso para ${appointment.clientName} (${targetChatId}).`);
      return true;
    } catch (err: any) {
      // Se falhou e ainda temos o clientPhone formatado diferente
      const formattedPhone = this.formatToWhatsAppChatId(appointment.clientPhone);
      if (formattedPhone && formattedPhone !== targetChatId) {
        try {
          console.warn(`[NotificationService] Tentando reenvio de lembrete D-1 para telefone formatado: ${formattedPhone}...`);
          const sendRes2 = await wahaClient.sendText(formattedPhone, message, { session });
          botTracker.recordBotMessage(formattedPhone, message, sendRes2?.id);
          appointmentManager.updateAppointment(appointment.id, {
            reminderSent: true,
            reminderSentAt: new Date().toISOString()
          });
          console.log(`[NotificationService] Lembrete D-1 enviado com sucesso para ${appointment.clientName} (${formattedPhone}).`);
          return true;
        } catch (phoneErr: any) {
          console.error(`[NotificationService] Falha também no telefone formatado ${formattedPhone}:`, phoneErr.message);
        }
      }

      this.lastError = err.message || 'Falha ao enviar lembrete D-1 pela WAHA.';
      console.error(`[NotificationService] Falha ao enviar lembrete D-1 para ${appointment.clientName} (${targetChatId}):`, this.lastError);
      return false;
    }
  }

  /**
   * Dispara lembretes D-1 em lote para todos os pacientes com agendamento amanhã
   */
  async sendRemindersForTomorrow(agentId?: string): Promise<{ sent: number; total: number; lastError?: string }> {
    const tomorrowStr = appointmentManager.getTomorrowDateString();
    const appointments = appointmentManager.listAppointments({
      date: tomorrowStr,
      agentId: agentId || 'all'
    }).filter(a => 
      (a.status === 'confirmed' || a.status === 'scheduled') &&
      !a.reminderSent
    );

    let sentCount = 0;
    for (const apt of appointments) {
      const ok = await this.sendDMinusOneReminder(apt);
      if (ok) sentCount++;
      // Delay de 1 segundo entre envios para humanizar e não disparar rate limit
      await new Promise(r => setTimeout(r, 1000));
    }

    return {
      sent: sentCount,
      total: appointments.length,
      lastError: this.lastError || undefined
    };
  }
}

export const notificationService = new NotificationService();
