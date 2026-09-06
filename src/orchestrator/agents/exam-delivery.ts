import { IAgent, AgentContext, AgentResponse } from './base.js';
import { examService } from '../../appointments/exam-service.js';

export class ExamDeliveryAgent implements IAgent {
  name = 'ExamDeliveryAgent';
  description = 'Valida os 3 primeiros dígitos do CPF do paciente e entrega com segurança e sigilo laudos e exames médicos no WhatsApp.';

  /**
   * Ativado se houver qualquer laudo/exame aguardando validação de CPF para o contato atual
   */
  canHandle(context: AgentContext): boolean {
    const pending = examService.getPendingExamsForChat(context.chatId);
    return pending.length > 0;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const verification = await examService.verifyCpfAndDeliver(
      context.chatId,
      context.userMessage,
      context.session
    );

    if (verification.replyText) {
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
