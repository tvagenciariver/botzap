import { IAgent, AgentContext, AgentResponse } from './base.js';
import { llmProviderManager } from '../llm-provider.js';

export class AttendantAgent implements IAgent {
  name = 'SmartAttendantAgent';
  description = 'Agente de Atendimento ao Cliente alimentado por IA (Google Gemini / OpenAI)';

  canHandle(_context: AgentContext): boolean {
    return true;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    try {
      const result = await llmProviderManager.generateReply(
        context.chatId,
        context.userMessage,
        context.contactName
      );

      const agentLabel = result.provider === 'openai' 
        ? `OpenAI (${result.model})` 
        : `Gemini (${result.model})`;

      return {
        handled: true,
        replyText: result.text,
        action: 'none',
        agentName: agentLabel
      };
    } catch (error: any) {
      console.error(`[AttendantAgent] Erro ao processar mensagem com IA:`, error.message);
      const isSimulation = context.chatId.startsWith('simulador_');
      const clientMessage = 'Olá! No momento estamos com uma instabilidade técnica momentânea em nosso atendimento automatizado. Nossa equipe humana já foi notificada e logo te responderá por aqui!';
      return {
        handled: true,
        replyText: isSimulation 
          ? `⚠️ Aviso do Bot: Não foi possível obter resposta da IA (${error.message}). Por favor, verifique sua chave de API e modelo nas configurações.`
          : clientMessage,
        action: 'none',
        agentName: this.name
      };
    }
  }
}
