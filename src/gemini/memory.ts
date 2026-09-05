export interface ChatMessage {
  role: 'user' | 'model';
  parts: Array<{ text: string }>;
  timestamp: number;
}

export interface ChatSessionState {
  chatId: string;
  contactName?: string;
  isPaused: boolean;
  pausedUntil?: number;
  lastMessageAt: number;
  messages: ChatMessage[];
}

export class MemoryStore {
  private sessions: Map<string, ChatSessionState> = new Map();
  private maxHistoryPerChat: number = 20;

  getSession(chatId: string): ChatSessionState {
    let state = this.sessions.get(chatId);
    if (!state) {
      state = {
        chatId,
        isPaused: false,
        lastMessageAt: Date.now(),
        messages: []
      };
      this.sessions.set(chatId, state);
    }
    return state;
  }

  /**
   * Retorna o histórico formatado e estritamente validado para a SDK do Gemini.
   * O Gemini EXIGE que:
   * 1. A primeira mensagem seja estritamente 'user' (nunca 'model').
   * 2. As mensagens alternem rigorosamente entre 'user' e 'model'.
   * 3. Termine em 'model', pois o startChat será seguido por sendMessage('user').
   */
  getHistory(chatId: string): Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> {
    const session = this.getSession(chatId);
    const validHistory: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }> = [];

    for (const m of session.messages) {
      if (!m.parts || m.parts.length === 0 || !m.parts[0].text) continue;

      if (validHistory.length === 0) {
        // Regra do Gemini: a primeira mensagem DEVE ter role 'user'
        if (m.role === 'user') {
          validHistory.push({
            role: 'user',
            parts: [{ text: m.parts[0].text }]
          });
        }
      } else {
        const last = validHistory[validHistory.length - 1];
        if (last.role === m.role) {
          // Mescla mensagens consecutivas do mesmo papel
          last.parts[0].text += `\n${m.parts[0].text}`;
        } else {
          validHistory.push({
            role: m.role,
            parts: [{ text: m.parts[0].text }]
          });
        }
      }
    }

    // O histórico passado para startChat deve terminar em 'model', pois a próxima chamada será chat.sendMessage(userMessage)
    while (validHistory.length > 0 && validHistory[validHistory.length - 1].role === 'user') {
      validHistory.pop();
    }

    return validHistory;
  }

  addMessage(chatId: string, role: 'user' | 'model', text: string, contactName?: string): void {
    const session = this.getSession(chatId);
    if (contactName) {
      session.contactName = contactName;
    }
    session.lastMessageAt = Date.now();
    session.messages.push({
      role,
      parts: [{ text }],
      timestamp: Date.now()
    });

    if (session.messages.length > this.maxHistoryPerChat) {
      session.messages = session.messages.slice(-this.maxHistoryPerChat);
      // Garante que o histórico armazenado comece sempre com 'user'
      while (session.messages.length > 0 && session.messages[0].role !== 'user') {
        session.messages.shift();
      }
    }
  }

  isChatPaused(chatId: string): boolean {
    const session = this.sessions.get(chatId);
    if (!session) return false;
    if (!session.isPaused) return false;

    if (session.pausedUntil && Date.now() > session.pausedUntil) {
      session.isPaused = false;
      session.pausedUntil = undefined;
      return false;
    }

    return true;
  }

  pauseChat(chatId: string, durationMinutes: number): void {
    const session = this.getSession(chatId);
    session.isPaused = true;
    session.pausedUntil = Date.now() + durationMinutes * 60 * 1000;
  }

  resumeChat(chatId: string): void {
    const session = this.getSession(chatId);
    session.isPaused = false;
    session.pausedUntil = undefined;
  }

  clearHistory(chatId: string): void {
    const session = this.sessions.get(chatId);
    if (session) {
      session.messages = [];
    }
  }

  listActiveChats(): Array<{
    chatId: string;
    contactName?: string;
    isPaused: boolean;
    pausedUntil?: number;
    lastMessageAt: number;
    messageCount: number;
    lastMessagePreview?: string;
  }> {
    const list = [];
    for (const [chatId, session] of this.sessions.entries()) {
      const lastMsg = session.messages[session.messages.length - 1];
      list.push({
        chatId,
        contactName: session.contactName,
        isPaused: this.isChatPaused(chatId),
        pausedUntil: session.pausedUntil,
        lastMessageAt: session.lastMessageAt,
        messageCount: session.messages.length,
        lastMessagePreview: lastMsg ? lastMsg.parts[0]?.text.slice(0, 60) : undefined
      });
    }

    return list.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
  }
}

export const memoryStore = new MemoryStore();
