import { IAgent, AgentContext, AgentResponse } from './base.js';
import { loadBotConfig } from '../../config/index.js';
import { memoryStore } from '../../gemini/memory.js';
import { checkBusinessHoursStatus } from '../schedule-helper.js';

export class BusinessHoursAgent implements IAgent {
  name = 'BusinessHoursAgent';
  description = 'Informa os clientes quando o contato é realizado fora do horário de atendimento ou durante o almoço';

  canHandle(context: AgentContext): boolean {
    const bh = context.agent?.businessHours || loadBotConfig().businessHours;
    if (!bh || !bh.enabled) {
      return false;
    }

    const status = checkBusinessHoursStatus(bh);
    return !status.isOpen;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const bh = context.agent?.businessHours || loadBotConfig().businessHours;
    const status = checkBusinessHoursStatus(bh);

    const outOfHoursMessage = bh?.outOfHoursMessage || 
      'Olá! Nosso horário de atendimento encerrou. Deixe sua dúvida que responderemos assim que retornarmos! 🕒';

    const canSendNotice = memoryStore.canSendOutOfHoursNotice(context.chatId, 2, context.agent?.id);

    if (canSendNotice) {
      // Registra que o aviso foi enviado para evitar flood
      memoryStore.recordOutOfHoursNotice(context.chatId, context.agent?.id);
      memoryStore.addMessage(context.chatId, 'user', context.userMessage, context.contactName, context.agent?.id);
      memoryStore.addMessage(context.chatId, 'model', outOfHoursMessage, context.contactName, context.agent?.id);

      console.log(`[BusinessHoursAgent] Mensagem fora de expediente enviada para ${context.chatId} (Motivo: ${status.reason}, Horário: ${status.currentTime}).`);

      return {
        handled: true,
        replyText: outOfHoursMessage,
        action: 'none',
        agentName: 'Horário Comercial'
      };
    } else {
      // Cliente já recebeu o aviso de ausência recentemente
      memoryStore.addMessage(context.chatId, 'user', context.userMessage, context.contactName, context.agent?.id);

      console.log(`[BusinessHoursAgent] Mensagem de ${context.chatId} recebida fora de expediente, mas aviso recente já emitido (Cooldown ativo).`);

      const isSim = context.chatId.startsWith('simulad');

      return {
        handled: true,
        replyText: isSim ? `(ℹ️ Mensagem recebida fora do horário de expediente. O aviso de ausência já foi enviado recentemente para este contato nas últimas 2 horas.)` : undefined,
        action: 'none',
        agentName: 'Horário Comercial (Silenciado - Cooldown)'
      };
    }
  }
}
