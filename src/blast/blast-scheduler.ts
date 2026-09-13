import { blastStore } from './blast-store.js';
import { blastEngine } from './blast-engine.js';

export class BlastScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isChecking: boolean = false;

  /**
   * Inicia o monitoramento periódico de campanhas agendadas (a cada 15 segundos)
   */
  start(): void {
    if (this.timer) return;

    console.log('[BlastScheduler] ⏰ Serviço de agendamento de campanhas de disparo iniciado.');

    // Verificação inicial após 4 segundos da inicialização do servidor
    setTimeout(() => {
      this.checkAndRun().catch(err => {
        console.error('[BlastScheduler] Erro na verificação inicial:', err.message);
      });
    }, 4000);

    // Loop a cada 15 segundos
    this.timer = setInterval(() => {
      this.checkAndRun().catch(err => {
        console.error('[BlastScheduler] Erro no ciclo de verificação:', err.message);
      });
    }, 15000);
  }

  /**
   * Para o agendador caso necessário
   */
  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      console.log('[BlastScheduler] Serviço de agendamento de campanhas parado.');
    }
  }

  /**
   * Verifica se há alguma campanha agendada cujo horário já chegou
   */
  async checkAndRun(): Promise<void> {
    if (this.isChecking) return;
    if (blastEngine.isRunning()) {
      // Já existe uma campanha disparando, aguarda o próximo ciclo para não sobrecarregar
      return;
    }

    this.isChecking = true;
    try {
      const allCampaigns = blastStore.list();
      const now = Date.now();

      // Filtra campanhas com status 'scheduled' cujo horário agendado já foi atingido
      const dueCampaigns = allCampaigns
        .filter(c => c.status === 'scheduled' && c.scheduledAt)
        .filter(c => {
          const scheduleTime = new Date(c.scheduledAt!).getTime();
          return !isNaN(scheduleTime) && scheduleTime <= now;
        })
        .sort((a, b) => new Date(a.scheduledAt!).getTime() - new Date(b.scheduledAt!).getTime());

      if (dueCampaigns.length === 0) {
        return;
      }

      // Pega a primeira campanha com horário vencido
      const campaignToRun = dueCampaigns[0];
      const scheduledFormatted = new Date(campaignToRun.scheduledAt!).toLocaleString('pt-BR');
      console.log(`[BlastScheduler] ⏰ Horário agendado atingido (${scheduledFormatted}) para a campanha "${campaignToRun.name}" (${campaignToRun.id}).`);
      console.log(`[BlastScheduler] 🚀 Disparando automaticamente ${campaignToRun.queue.length} contatos...`);

      // Inicia a execução em background via blastEngine
      blastEngine.start(campaignToRun.id).catch(err => {
        console.error(`[BlastScheduler] ❌ Erro ao iniciar campanha agendada "${campaignToRun.name}":`, err.message);
        blastStore.updateStatus(campaignToRun.id, 'idle');
      });

    } finally {
      this.isChecking = false;
    }
  }
}

export const blastScheduler = new BlastScheduler();
