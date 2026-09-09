import { IAgent, AgentContext, AgentResponse } from './base.js';
import { geminiService } from '../../gemini/client.js';
import { memoryStore } from '../../gemini/memory.js';
import { loadBotConfig } from '../../config/index.js';

export class HandoffAgent implements IAgent {
  name = 'HandoffAgent';
  description = 'Detecta intenção de falar com humano e pausa o bot para transbordo no Chatwoot';

  canHandle(context: AgentContext): boolean {
    return geminiService.checkHandoffIntent(context.userMessage, context.agent?.handoffKeywords);
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const config = loadBotConfig();
    const pauseMinutes = context.agent
      ? ((context.agent.pauseDurationHours ? context.agent.pauseDurationHours * 60 : context.agent.pauseDurationMinutes) || 360)
      : ((config.pauseDurationHours ? config.pauseDurationHours * 60 : config.pauseDurationMinutes) || 360);
    const handoffMessage = context.agent?.handoffMessage || config.handoffMessage || 'Transferindo para um de nossos atendentes humanos...';

    // Pausa o bot para este contato
    memoryStore.pauseChat(context.chatId, pauseMinutes, context.agent?.id);

    // Registra a mensagem no histórico de memória
    memoryStore.addMessage(context.chatId, 'user', context.userMessage, context.contactName);
    memoryStore.addMessage(context.chatId, 'model', handoffMessage, context.contactName);

    console.log(`[HandoffAgent] Bot pausado para ${context.chatId} por ${pauseMinutes} minutos (transbordo humano).`);

    return {
      handled: true,
      replyText: handoffMessage,
      action: 'transferred_human',
      agentName: this.name
    };
  }
}
