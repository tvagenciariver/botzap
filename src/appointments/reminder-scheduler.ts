import { loadBotConfig, saveBotConfig } from '../config/index.js';
import { agentManager } from '../config/agent-manager.js';
import { notificationService } from './notification-service.js';
import { orchestrator } from '../orchestrator/engine.js';

export interface ReminderSchedulerStatus {
  enabled: boolean;
  targetTime: string;
  timezone: string;
  currentTime: string;
  currentDate: string;
  lastRunDate?: string;
  lastRunSummary?: {
    sent: number;
    total: number;
    timestamp: string;
    trigger: 'auto' | 'manual';
    error?: string;
  };
}

export class ReminderScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private lastRunSummary?: ReminderSchedulerStatus['lastRunSummary'];

  /**
   * Inicia o loop de monitoramento periódico (a cada 30 segundos)
   */
  start(): void {
    if (this.timer) return;

    console.log('[ReminderScheduler] ⏰ Serviço de Envio Automático de Lembretes D-1 iniciado.');
    
    // Executa uma verificação inicial após 5 segundos da inicialização do servidor
    setTimeout(() => {
      this.checkAndRun('auto').catch(err => {
        console.error('[ReminderScheduler] Erro na verificação inicial:', err.message);
      });
    }, 5000);

    // Loop a cada 30 segundos para garantir precisão no minuto programado
    this.timer = setInterval(() => {
      this.checkAndRun('auto').catch(err => {
        console.error('[ReminderScheduler] Erro no ciclo de verificação:', err.message);
      });
    }, 30000);
  }

  /**
   * Para o agendador caso necessário
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[ReminderScheduler] Serviço de agendamento parado.');
    }
  }

  /**
   * Retorna a hora e data atual no fuso horário de atendimento (padrão America/Sao_Paulo)
   */
  getCurrentTimeAndDate(timezone: string = 'America/Sao_Paulo'): { time: string; date: string; hour: number; minute: number } {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false
      });

      const parts = formatter.formatToParts(new Date());
      let year = '2026', month = '01', day = '01', hour = '00', minute = '00';

      for (const p of parts) {
        if (p.type === 'year') year = p.value;
        if (p.type === 'month') month = p.value;
        if (p.type === 'day') day = p.value;
        if (p.type === 'hour') hour = p.value;
        if (p.type === 'minute') minute = p.value;
      }

      // Em en-US com hour12: false, meia-noite pode ser "24" em alguns ambientes node
      if (hour === '24') hour = '00';

      const time = `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;
      const date = `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
      return { time, date, hour: parseInt(hour, 10), minute: parseInt(minute, 10) };
    } catch {
      const now = new Date();
      const h = String(now.getHours()).padStart(2, '0');
      const m = String(now.getMinutes()).padStart(2, '0');
      const y = now.getFullYear();
      const mo = String(now.getMonth() + 1).padStart(2, '0');
      const d = String(now.getDate()).padStart(2, '0');
      return {
        time: `${h}:${m}`,
        date: `${y}-${mo}-${d}`,
        hour: now.getHours(),
        minute: now.getMinutes()
      };
    }
  }

  /**
   * Verifica se o horário configurado foi atingido e dispara para as consultas de amanhã
   */
  async checkAndRun(trigger: 'auto' | 'manual' = 'auto', forcedAgentId?: string): Promise<{ sent: number; total: number; lastError?: string }> {
    if (this.isChecking && trigger === 'auto') {
      return { sent: 0, total: 0 };
    }

    this.isChecking = true;
    try {
      const config = loadBotConfig();
      const timezone = config.businessHours?.timezone || 'America/Sao_Paulo';
      const { time: currentTime, date: currentDate } = this.getCurrentTimeAndDate(timezone);

      // Se for acionamento forçado (manual)
      if (trigger === 'manual') {
        console.log(`[ReminderScheduler] 🔔 Disparo manual imediato solicitado via painel (Horário: ${currentTime})...`);
        const result = await notificationService.sendRemindersForTomorrow(forcedAgentId);
        this.lastRunSummary = {
          sent: result.sent,
          total: result.total,
          timestamp: new Date().toISOString(),
          trigger: 'manual',
          error: result.lastError
        };
        saveBotConfig({ lastAutoReminderDate: currentDate });
        return result;
      }

      // Verificação do agendamento automático global
      const isAutoEnabled = config.enableAutoReminders !== false;
      const targetTime = config.autoReminderTime || '18:00';

      if (!isAutoEnabled) {
        return { sent: 0, total: 0 };
      }

      // Normaliza horários para comparação segura (ex: "18:00")
      const isTargetMinute = currentTime === targetTime;
      const alreadyRanToday = config.lastAutoReminderDate === currentDate;

      if (isTargetMinute && !alreadyRanToday) {
        console.log(`[ReminderScheduler] ⏰ HORÁRIO ATINGIDO: ${currentTime}. Disparando lembretes automáticos D-1 para consultas de amanhã...`);

        // Registra a data antes do envio para evitar disparos duplicados durante o mesmo minuto
        saveBotConfig({ lastAutoReminderDate: currentDate });

        const result = await notificationService.sendRemindersForTomorrow();
        
        this.lastRunSummary = {
          sent: result.sent,
          total: result.total,
          timestamp: new Date().toISOString(),
          trigger: 'auto',
          error: result.lastError
        };

        const summaryMsg = `⏰ Lembretes Automáticos D-1 enviados: ${result.sent} de ${result.total} paciente(s) notificado(s) para amanhã.`;
        console.log(`[ReminderScheduler] ✅ ${summaryMsg}`);

        orchestrator.addLog({
          type: 'info',
          chatId: 'sistema',
          message: summaryMsg
        });

        return result;
      }

      return { sent: 0, total: 0 };
    } finally {
      this.isChecking = false;
    }
  }

  /**
   * Retorna o estado atual do serviço de lembretes para exibição no painel
   */
  getStatus(): ReminderSchedulerStatus {
    const config = loadBotConfig();
    const timezone = config.businessHours?.timezone || 'America/Sao_Paulo';
    const { time: currentTime, date: currentDate } = this.getCurrentTimeAndDate(timezone);

    return {
      enabled: config.enableAutoReminders !== false,
      targetTime: config.autoReminderTime || '18:00',
      timezone,
      currentTime,
      currentDate,
      lastRunDate: config.lastAutoReminderDate,
      lastRunSummary: this.lastRunSummary
    };
  }

  /**
   * Atualiza as configurações de agendamento automático
   */
  updateConfig(updates: { enableAutoReminders?: boolean; autoReminderTime?: string }): ReminderSchedulerStatus {
    const config = loadBotConfig();
    const patch: any = {};

    if (typeof updates.enableAutoReminders === 'boolean') {
      patch.enableAutoReminders = updates.enableAutoReminders;
    }

    if (typeof updates.autoReminderTime === 'string' && updates.autoReminderTime.trim()) {
      // Valida formato HH:MM
      const trimmed = updates.autoReminderTime.trim();
      if (/^([01]\d|2[0-3]):([0-5]\d)$/.test(trimmed)) {
        patch.autoReminderTime = trimmed;
      }
    }

    saveBotConfig(patch);
    console.log(`[ReminderScheduler] ⚙️ Configuração de Lembretes Automáticos atualizada: Ativo=${patch.enableAutoReminders ?? config.enableAutoReminders}, Horário=${patch.autoReminderTime ?? config.autoReminderTime}`);

    return this.getStatus();
  }
}

export const reminderScheduler = new ReminderScheduler();
