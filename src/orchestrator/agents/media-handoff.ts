import { IAgent, AgentContext, AgentResponse } from './base.js';
import { memoryStore } from '../../gemini/memory.js';
import { loadBotConfig } from '../../config/index.js';
import { getAlternateBrazilianChatId } from '../../appointments/phone-utils.js';

export class MediaHandoffAgent implements IAgent {
  name = 'MediaHandoffAgent';
  description = 'Detecta envio de fotos de pedidos médicos, laudos, receitas e imagens do paciente, respondendo com acolhimento e redirecionando para atendimento humanizado.';

  canHandle(context: AgentContext): boolean {
    // 1. Sinalização explícita via metadata
    if (context.metadata?.hasMedia && (context.metadata?.mediaType === 'image' || context.metadata?.mediaType === 'document')) {
      return true;
    }

    const raw = (context.userMessage || '').trim();

    // 2. Marcadores inseridos pelo orquestrador ao receber imagem ou documento da WAHA
    if (
      raw.includes('[Imagem / Pedido Médico / Laudo Enviado pelo Paciente]') ||
      raw.includes('[Imagem/Documento Anexo]') ||
      raw.includes('[Documento / Pedido Médico Anexo]') ||
      raw.includes('[Documento / Laudo Anexo]') ||
      raw.includes('[Imagem / Pedido Médico Anexo]') ||
      raw.startsWith('[Imagem') ||
      raw.startsWith('[Documento') ||
      raw.startsWith('[Foto')
    ) {
      return true;
    }

    // 3. Suporte a testes no simulador ou digitação explícita
    const lower = raw.toLowerCase();
    if (
      (lower.includes('foto do pedido') || lower.includes('foto da receita') || lower.includes('foto do laudo') || lower.includes('imagem do exame') || lower.includes('laudo anexo')) &&
      (raw.startsWith('[') || raw.startsWith('*'))
    ) {
      return true;
    }

    return false;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const config = loadBotConfig();
    const pauseMinutes = context.agent
      ? ((context.agent.pauseDurationHours ? context.agent.pauseDurationHours * 60 : context.agent.pauseDurationMinutes) || 360)
      : ((config.pauseDurationHours ? config.pauseDurationHours * 60 : config.pauseDurationMinutes) || 360);

    const isValidName = !!(
      context.contactName &&
      context.contactName !== 'Cliente' &&
      context.contactName !== 'Cliente Teste' &&
      !/^[\d\s\-()+]+$/.test(context.contactName) &&
      !context.contactName.includes('@')
    );

    const nameGreeting = isValidName
      ? `Olá, *${context.contactName}*! `
      : 'Olá! ';

    let replyText = context.agent?.mediaHandoffMessage?.trim() || config.mediaHandoffMessage?.trim();

    if (!replyText) {
      replyText = `${nameGreeting}Recebemos sua imagem / pedido médico com sucesso! 📄✅\n\n` +
        `Já estou encaminhando seu documento para a nossa equipe de atendimento humanizado 👤 para calcular os valores e verificar a disponibilidade dos seus exames.\n\n` +
        `Em instantes um de nossos atendentes irá te responder por aqui! Por favor, aguarde só um momento. 😊`;
    } else {
      // Interpolação de variáveis opcionais
      const cleanName = isValidName ? context.contactName! : '';
      if (replyText.includes('{name}')) {
        replyText = replyText.replace(/{\s*name\s*}/gi, cleanName);
      } else if (cleanName && (replyText.startsWith('Recebemos') || replyText.startsWith('Identificamos') || replyText.startsWith('Já estou'))) {
        replyText = `${nameGreeting}${replyText}`;
      }
      replyText = replyText
        .replace(/{\s*companyName\s*}/gi, context.agent?.companyName || config.companyName || '')
        .replace(/Olá,\s*\*\*\s*!\s*/g, 'Olá! ')
        .replace(/Olá,\s*!\s*/g, 'Olá! ')
        .replace(/Olá\s*!\s*/g, 'Olá! ');
    }

    // Pausa o bot para este contato para transbordo humano
    memoryStore.pauseChat(context.chatId, pauseMinutes, context.agent?.id);
    const altChat = getAlternateBrazilianChatId(context.chatId);
    if (altChat) {
      memoryStore.pauseChat(altChat, pauseMinutes, context.agent?.id);
    }

    // Registra a mensagem no histórico de memória
    memoryStore.addMessage(context.chatId, 'user', context.userMessage, context.contactName);
    memoryStore.addMessage(context.chatId, 'model', replyText, context.contactName);

    console.log(`[MediaHandoffAgent] Imagem/documento recebido de ${context.chatId}. Bot pausado por ${pauseMinutes}m (transbordo humanizado).`);

    return {
      handled: true,
      replyText,
      action: 'transferred_human',
      agentName: this.name
    };
  }
}
