import { Appointment, Specialist } from './types.js';
import { appointmentManager } from './appointment-manager.js';
import { wahaClient } from '../waha/client.js';
import { agentManager } from '../config/agent-manager.js';
import { env } from '../config/index.js';
import { botTracker } from '../orchestrator/bot-tracker.js';
import { memoryStore } from '../gemini/memory.js';

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
    if (!phoneStr) return '';
    let digits = phoneStr.replace(/\D/g, '');
    if (!digits) return '';

    // Remove zero inicial se houver (ex: 011999998888 -> 11999998888)
    if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
      digits = digits.substring(1);
    }

    // Se for número brasileiro com 10 ou 11 dígitos (DDD + número) sem o DDI 55
    if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
      digits = '55' + digits;
    }

    return `${digits}@c.us`;
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
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;

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
      const errorMsg = err.response?.data?.message || err.message || 'Falha ao enviar mensagem pela WAHA.';
      this.lastError = `Erro WAHA ao notificar ${spec.name} (${targetChatId}): ${errorMsg}`;
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
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;

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
      this.lastError = err.response?.data?.message || err.message;
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
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;

    // Garante que o chat está ativo para poder responder
    memoryStore.resumeChat(appointment.clientChatId, agent.id);

    const message = `Olá, *${appointment.clientName}*! 👋\n\n` +
      `Aqui é da equipe da *${companyName}*.\n` +
      `Passando para lembrar da sua consulta agendada para *amanhã, ${this.formatDateBR(appointment.date)} às ${appointment.startTime}* com *${appointment.specialistName}* (${appointment.serviceName}).\n\n` +
      `Por favor, para mantermos sua vaga reservada, *você confirma sua presença?*\n\n` +
      `*1.* ✅ Sim, confirmo minha presença\n` +
      `*2.* ❌ Não poderei ir (liberar vaga)\n\n` +
      `_Digite o número *1* para confirmar ou *2* para cancelar._`;

    try {
      const sendRes = await wahaClient.sendText(appointment.clientChatId, message, { session });
      // Rastreia mensagem para que o eco da WAHA não congele/pause o bot para este cliente
      botTracker.recordBotMessage(appointment.clientChatId, message, sendRes?.id);

      appointmentManager.updateAppointment(appointment.id, {
        reminderSent: true,
        reminderSentAt: new Date().toISOString()
      });
      console.log(`[NotificationService] Lembrete D-1 enviado com sucesso para ${appointment.clientName} (${appointment.clientChatId}).`);
      return true;
    } catch (err: any) {
      this.lastError = err.response?.data?.message || err.message;
      console.error(`[NotificationService] Falha ao enviar lembrete D-1 para ${appointment.clientChatId}:`, this.lastError);
      return false;
    }
  }

  /**
   * Dispara lembretes D-1 em lote para todos os pacientes com agendamento amanhã
   */
  async sendRemindersForTomorrow(agentId?: string): Promise<{ sent: number; total: number }> {
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
      total: appointments.length
    };
  }
}

export const notificationService = new NotificationService();
