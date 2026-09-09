import { IAgent, AgentContext, AgentResponse } from './base.js';
import { examService } from '../../appointments/exam-service.js';
import { memoryStore } from '../../gemini/memory.js';
import { loadBotConfig } from '../../config/index.js';
import { getAlternateBrazilianChatId } from '../../appointments/phone-utils.js';

export class ExamDeliveryAgent implements IAgent {
  name = 'ExamDeliveryAgent';
  description = 'Valida os 3 primeiros dígitos do CPF do paciente e entrega com segurança e sigilo laudos e exames médicos no WhatsApp.';

  /**
   * Ativado se houver qualquer laudo/exame aguardando validação de CPF para o contato atual,
   * ou se a mensagem enviada for dígitos que correspondam a um exame pendente.
   */
  canHandle(context: AgentContext): boolean {
    const pending = examService.getPendingExamsForChat(context.chatId, context.agent?.id);
    if (pending.length > 0) return true;

    // Também intercepta se o usuário digitou dígitos (possível CPF) e há exame não verificado
    const cleanDigits = context.userMessage.replace(/\D/g, '');
    if (cleanDigits.length >= 3 && cleanDigits.length <= 11) {
      const match = examService.findPendingExam(context.chatId, context.userMessage, context.agent?.id);
      if (match) return true;
    }

    return false;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const verification = await examService.verifyCpfAndDeliver(
      context.chatId,
      context.userMessage,
      context.session,
      context.agent?.id
    );

    if (verification.transferredToHuman) {
      const config = loadBotConfig();
      const pauseMinutes = context.agent
        ? ((context.agent.pauseDurationHours ? context.agent.pauseDurationHours * 60 : context.agent.pauseDurationMinutes) || 360)
        : ((config.pauseDurationHours ? config.pauseDurationHours * 60 : config.pauseDurationMinutes) || 360);

      // Pausa o bot para este contato para transbordo humano
      memoryStore.pauseChat(context.chatId, pauseMinutes, context.agent?.id);
      const altChatId = getAlternateBrazilianChatId(context.chatId);
      if (altChatId) {
        memoryStore.pauseChat(altChatId, pauseMinutes, context.agent?.id);
      }

      memoryStore.addMessage(context.chatId, 'user', context.userMessage, context.contactName);
      memoryStore.addMessage(context.chatId, 'model', verification.replyText, context.contactName);

      console.log(`[ExamDeliveryAgent] Bot pausado para ${context.chatId} por ${pauseMinutes}m (3 tentativas incorretas de CPF).`);

      return {
        handled: true,
        replyText: verification.replyText,
        action: 'transferred_human',
        agentName: this.name
      };
    }

    if (verification.replyText) {
      memoryStore.addMessage(context.chatId, 'user', context.userMessage, context.contactName);
      memoryStore.addMessage(context.chatId, 'model', verification.replyText, context.contactName);

      return {
        handled: true,
        replyText: verification.replyText,
        agentName: this.name,
        action: 'none'
      };
    }

    return {
      handled: false,
      replyText: '',
      agentName: this.name,
      action: 'none'
    };
  }
}
