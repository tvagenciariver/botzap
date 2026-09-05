import { IAgent, AgentContext, AgentResponse } from './base.js';
import { geminiService } from '../../gemini/client.js';

export class AttendantAgent implements IAgent {
  name = 'GeminiFlashAttendantAgent';
  description = 'Agente de Atendimento ao Cliente alimentado pelo Google Gemini Flash';

  canHandle(_context: AgentContext): boolean {
    return true;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    try {
      const reply = await geminiService.generateReply(
        context.chatId,
        context.userMessage,
        context.contactName
      );

      return {
        handled: true,
        replyText: reply,
        action: 'none',
        agentName: this.name
      };
    } catch (error: any) {
      console.error(`[AttendantAgent] Erro ao processar mensagem com Gemini Flash:`, error.message);
      return {
        handled: true,
        replyText: `⚠️ Aviso do Bot: Não foi possível obter resposta da IA (${error.message}). Por favor, verifique sua chave de API e modelo nas configurações.`,
        action: 'none',
        agentName: this.name
      };
    }
  }
}
