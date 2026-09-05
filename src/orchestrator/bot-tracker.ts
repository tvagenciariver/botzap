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
    }

    const cleanSnippet = text.trim().slice(0, 50);
    const textKey = `${chatId}_${cleanSnippet}`;
    this.sentTextSnippets.set(textKey, now);
    this.recentBotReplies.set(chatId, now);

    // Remove do cache após 90 segundos
    setTimeout(() => {
      if (messageId) this.sentMessageIds.delete(messageId);
      this.sentTextSnippets.delete(textKey);
    }, 90000);
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

    // 2. Verificação por snippet do texto enviado recentemente
    const cleanSnippet = text.trim().slice(0, 50);
    const textKey = `${chatId}_${cleanSnippet}`;
    const snippetTime = this.sentTextSnippets.get(textKey);
    if (snippetTime && (now - snippetTime) < 90000) {
      return true;
    }

    // 3. Verificação por proximidade temporal direta (delay de echo da WAHA de até 5 segundos)
    const lastReplyTime = this.recentBotReplies.get(chatId);
    if (lastReplyTime && (now - lastReplyTime) < 5000) {
      return true;
    }

    return false;
  }
}

export const botTracker = new BotMessageTracker();
