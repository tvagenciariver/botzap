import { getAllChatIdAliases } from '../appointments/phone-utils.js';

/**
 * Rastreia mensagens enviadas pelo próprio bot para distinguir entre:
 * 1. Respostas automáticas do bot (que geram evento fromMe: true na WAHA)
 * 2. Mensagens enviadas por atendentes humanos (no Chatwoot ou no celular/web do WhatsApp)
 */
export class BotMessageTracker {
  private sentMessageIds: Set<string> = new Set();
  private sentTextSnippets: Map<string, number> = new Map(); // key -> timestamp
  private recentBotReplies: Map<string, number> = new Map(); // chatId -> timestamp

  /**
   * Registra uma mensagem que foi enviada pelo BotZap
   */
  recordBotMessage(chatId: string, text: string, messageId?: string): void {
    const now = Date.now();

    if (messageId) {
      this.sentMessageIds.add(messageId);
      setTimeout(() => {
        this.sentMessageIds.delete(messageId);
      }, 90000);
    }

    const cleanSnippet = (text || '').trim().slice(0, 50);
    const aliases = getAllChatIdAliases(chatId);

    for (const alias of aliases) {
      const textKey = `${alias}_${cleanSnippet}`;
      this.sentTextSnippets.set(textKey, now);
      this.recentBotReplies.set(alias, now);

      // Remove do cache após 90 segundos
      setTimeout(() => {
        this.sentTextSnippets.delete(textKey);
      }, 90000);
    }
  }

  /**
   * Verifica se a mensagem com fromMe === true foi gerada pelo BotZap
   */
  isSentByBot(chatId: string, text: string, messageId?: string): boolean {
    const now = Date.now();

    // 1. Verificação por ID da mensagem retornado pela WAHA
    if (messageId && this.sentMessageIds.has(messageId)) {
      return true;
    }

    const cleanSnippet = (text || '').trim().slice(0, 50);
    const aliases = getAllChatIdAliases(chatId);

    // 2. Verificação por snippet do texto enviado recentemente por qualquer alias
    if (cleanSnippet) {
      for (const alias of aliases) {
        const textKey = `${alias}_${cleanSnippet}`;
        const snippetTime = this.sentTextSnippets.get(textKey);
        if (snippetTime && (now - snippetTime) < 90000) {
          return true;
        }
      }
    }

    // 3. Verificação por proximidade temporal direta:
    // 🔒 REGRA DE OURO: Só podemos considerar como bot por proximidade temporal se NÃO houver texto
    // (ex: envio de arquivo/mídia sem legenda) ou se for vazio!
    // Se a mensagem contém texto digitado e esse texto NÃO bateu com nenhum snippet enviado pelo bot,
    // significa COM 100% DE CERTEZA que foi um ATENDENTE HUMANO que digitou no WhatsApp Web / Celular!
    if (!cleanSnippet || cleanSnippet.length === 0) {
      for (const alias of aliases) {
        const lastReplyTime = this.recentBotReplies.get(alias);
        if (lastReplyTime && (now - lastReplyTime) < 5000) {
          return true;
        }
      }
    }

    return false;
  }
}

export const botTracker = new BotMessageTracker();
