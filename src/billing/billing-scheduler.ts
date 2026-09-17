import { loadBotConfig, saveBotConfig } from '../config/index.js';
import { billingManager } from './billing-manager.js';
import { BillingSchedulerConfig } from './types.js';

export class BillingScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;
  private lastRunDate?: string;
  private lastRunSummary?: BillingSchedulerConfig['lastRunSummary'];

  /**
   * Inicia o loop periódico de monitoramento (a cada 30 segundos)
   */
  start(): void {
    if (this.timer) return;

    console.log('[BillingScheduler] 💳 Serviço de Régua de Cobrança Automática Diária (09:00) iniciado.');

    // Verificação inicial após 6 segundos
    setTimeout(() => {
      this.checkAndRun('auto').catch(err => {
        console.error('[BillingScheduler] Erro na verificação inicial da régua:', err.message);
      });
    }, 6000);

    // Loop a cada 30 segundos
    this.timer = setInterval(() => {
      this.checkAndRun('auto').catch(err => {
        console.error('[BillingScheduler] Erro no ciclo de verificação:', err.message);
      });
    }, 30000);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[BillingScheduler] Serviço de régua de cobrança parado.');
    }
  }

  getConfig(): BillingSchedulerConfig {
    const botConfig = loadBotConfig();
    const billingConfig = (botConfig as any).billingScheduler || {};

    return {
      enabled: billingConfig.enabled !== false,
      targetTime: billingConfig.targetTime || '09:00',
      overdueDaysThreshold: billingConfig.overdueDaysThreshold ?? 3,
      timezone: billingConfig.timezone || 'America/Sao_Paulo',
      reminderTemplateBoleto: billingConfig.reminderTemplateBoleto,
      reminderTemplatePix: billingConfig.reminderTemplatePix,
      lastRunDate: this.lastRunDate || billingConfig.lastRunDate,
      lastRunSummary: this.lastRunSummary || billingConfig.lastRunSummary
    };
  }

  updateConfig(newConfig: Partial<BillingSchedulerConfig>): BillingSchedulerConfig {
    const botConfig = loadBotConfig();
    const current = (botConfig as any).billingScheduler || {};
    const updated = {
      ...current,
      ...newConfig
    };

    (botConfig as any).billingScheduler = updated;
    saveBotConfig(botConfig);
    return this.getConfig();
  }

  /**
   * Retorna hora e data no fuso de atendimento (padrão America/Sao_Paulo)
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
      const getPart = (type: string) => parts.find(p => p.type === type)?.value || '00';

      const year = getPart('year');
      const month = getPart('month');
      const day = getPart('day');
      const hour = parseInt(getPart('hour'), 10);
      const minute = parseInt(getPart('minute'), 10);

      return {
        time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
        date: `${year}-${month}-${day}`,
        hour,
        minute
      };
    } catch {
      const now = new Date();
      return {
        time: `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`,
        date: now.toISOString().split('T')[0],
        hour: now.getHours(),
        minute: now.getMinutes()
      };
    }
  }

  /**
   * Ciclo de checagem automática da régua
   */
  async checkAndRun(trigger: 'auto' | 'manual' = 'auto', filterAgentId?: string): Promise<{ dispatched: number; totalEligible: number }> {
    if (this.isChecking) {
      console.log('[BillingScheduler] Ciclo já em execução. Ignorando chamada concorrente.');
      return { dispatched: 0, totalEligible: 0 };
    }

    const config = this.getConfig();
    if (!config.enabled && trigger === 'auto') {
      return { dispatched: 0, totalEligible: 0 };
    }

    const { time, date } = this.getCurrentTimeAndDate(config.timezone);

    // Se for execução automática, valida o horário alvo (ex: 09:00) e se já rodou hoje
    if (trigger === 'auto') {
      if (time !== config.targetTime) {
        return { dispatched: 0, totalEligible: 0 };
      }

      if (this.lastRunDate === date) {
        return { dispatched: 0, totalEligible: 0 };
      }
    }

    this.isChecking = true;
    console.log(`\n======================================================`);
    console.log(`[BillingScheduler] 💳 Executando Régua de Cobrança (${trigger.toUpperCase()}) em ${date} às ${time}...`);

    let dispatched = 0;
    let totalEligible = 0;

    try {
      // 1. Calcula a data de corte: vencidas há X dias (padrão 3 dias)
      const thresholdDate = billingManager.getOverdueThresholdDateString(config.overdueDaysThreshold);
      console.log(`[BillingScheduler] Selecionando cobranças pendentes com vencimento até ${thresholdDate} (atraso >= ${config.overdueDaysThreshold} dias)...`);

      // 2. Busca todas as cobranças elegíveis
      const allCharges = billingManager.getCharges({ agentId: filterAgentId });
      const eligibleCharges = allCharges.filter(c => {
        const isUnpaid = c.statusPagamento === 'pendente' || c.statusPagamento === 'aguardando_confirmacao';
        return isUnpaid && c.dueDate <= thresholdDate;
      });

      totalEligible = eligibleCharges.length;
      console.log(`[BillingScheduler] Encontradas ${totalEligible} cobrança(s) elegível(is) para a régua.`);

      // 3. Dispara a mensagem e anexo para cada cliente elegível
      for (const charge of eligibleCharges) {
        try {
          console.log(`[BillingScheduler] Enviando lembrete de cobrança para ${charge.customerName} (${charge.customerPhone}) - Vencimento: ${charge.dueDate}...`);
          const ok = await billingManager.dispatchBilling(charge.id, 'regua_recorrente');
          if (ok) {
            dispatched++;
          }
          // Intervalo de segurança de 2 segundos entre envios para evitar flood
          await new Promise(resolve => setTimeout(resolve, 2000));
        } catch (err: any) {
          console.error(`[BillingScheduler] Erro ao processar cobrança ${charge.id}:`, err.message);
        }
      }

      this.lastRunDate = date;
      this.lastRunSummary = {
        dispatched,
        totalEligible,
        timestamp: new Date().toISOString(),
        trigger
      };

      this.updateConfig({
        lastRunDate: this.lastRunDate,
        lastRunSummary: this.lastRunSummary
      });

      console.log(`[BillingScheduler] ✅ Régua concluída: ${dispatched}/${totalEligible} disparada(s) com sucesso.`);
      console.log(`======================================================\n`);
    } catch (err: any) {
      console.error('[BillingScheduler] Erro geral ao executar régua:', err.message);
      this.lastRunSummary = {
        dispatched,
        totalEligible,
        timestamp: new Date().toISOString(),
        trigger,
        error: err.message
      };
    } finally {
      this.isChecking = false;
    }

    return { dispatched, totalEligible };
  }
}

export const billingScheduler = new BillingScheduler();
