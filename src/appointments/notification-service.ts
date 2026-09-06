import { Appointment, Specialist } from './types.js';
import { appointmentManager } from './appointment-manager.js';
import { wahaClient } from '../waha/client.js';
import { agentManager } from '../config/agent-manager.js';
import { env } from '../config/index.js';

export class NotificationService {
  /**
   * Formata telefone para o padrão de chatId do WhatsApp (ex: 5511999998888@c.us)
   */
  formatToWhatsAppChatId(phoneStr: string): string {
    const clean = phoneStr.replace(/\D/g, '');
    if (!clean) return '';
    return clean.includes('@') ? clean : `${clean}@c.us`;
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
    const spec = specialist || appointmentManager.getSpecialist(appointment.specialistId);
    if (!spec || !spec.phone) {
      console.log(`[NotificationService] Especialista ${appointment.specialistName} sem telefone cadastrado para alertas.`);
      return false;
    }

    const agent = agentManager.getAgent(appointment.agentId) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const targetChatId = this.formatToWhatsAppChatId(spec.phone);
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;

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
      await wahaClient.sendText(targetChatId, message, { session });
      appointmentManager.updateAppointment(appointment.id, {
        notifiedSpecialist: true,
        notifiedAt: new Date().toISOString()
      });
      console.log(`[NotificationService] Alerta enviado ao especialista ${spec.name} (${targetChatId}).`);
      return true;
    } catch (err: any) {
      console.error(`[NotificationService] Erro ao notificar especialista ${spec.name}:`, err.message);
      return false;
    }
  }

  /**
   * Envia notificação ao WhatsApp do especialista quando uma consulta é cancelada
   */
  async notifySpecialistCancellation(appointment: Appointment, specialist?: Specialist): Promise<boolean> {
    const spec = specialist || appointmentManager.getSpecialist(appointment.specialistId);
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
      await wahaClient.sendText(targetChatId, message, { session });
      console.log(`[NotificationService] Alerta de cancelamento enviado ao especialista ${spec.name}.`);
      return true;
    } catch (err: any) {
      console.error(`[NotificationService] Falha ao alertar especialista sobre cancelamento:`, err.message);
      return false;
    }
  }

  /**
   * Envia lembrete D-1 (fim do dia anterior) para o paciente confirmar presença ou desistir
   */
  async sendDMinusOneReminder(appointment: Appointment): Promise<boolean> {
    const agent = agentManager.getAgent(appointment.agentId) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : env.wahaSession;

    const message = `Olá, *${appointment.clientName}*! 👋\n\n` +
      `Aqui é da equipe da *${companyName}*.\n` +
      `Passando para lembrar da sua consulta agendada para *amanhã, ${this.formatDateBR(appointment.date)} às ${appointment.startTime}* com *${appointment.specialistName}* (${appointment.serviceName}).\n\n` +
      `Por favor, para mantermos sua vaga reservada, *você confirma sua presença?*\n\n` +
      `*1.* ✅ Sim, confirmo minha presença\n` +
      `*2.* ❌ Não poderei ir (liberar vaga)\n\n` +
      `_Digite o número *1* para confirmar ou *2* para cancelar._`;

    try {
      await wahaClient.sendText(appointment.clientChatId, message, { session });
      appointmentManager.updateAppointment(appointment.id, {
        reminderSent: true,
        reminderSentAt: new Date().toISOString()
      });
      console.log(`[NotificationService] Lembrete D-1 enviado com sucesso para ${appointment.clientName} (${appointment.clientChatId}).`);
      return true;
    } catch (err: any) {
      console.error(`[NotificationService] Falha ao enviar lembrete D-1 para ${appointment.clientChatId}:`, err.message);
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
