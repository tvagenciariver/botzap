import { loadBotConfig } from '../config/index.js';

type MessageHandler = (
  chatId: string,
  combinedText: string,
  contactName?: string,
  sessionName?: string,
  agentId?: string
) => Promise<void>;

interface PendingBuffer {
  timer: NodeJS.Timeout;
  messages: string[];
  contactName?: string;
  sessionName?: string;
  agentId?: string;
}

export class MessageDebouncer {
  private buffers: Map<string, PendingBuffer> = new Map();
  private handler: MessageHandler | null = null;

  registerHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  enqueue(
    chatId: string,
    messageText: string,
    contactName?: string,
    sessionName?: string,
    agentId?: string,
    customDebounceSeconds?: number
  ): void {
    if (!this.handler) {
      console.warn('[Debouncer] Nenhum handler registrado no debouncer.');
      return;
    }

    const config = loadBotConfig();
    const waitSeconds = customDebounceSeconds ?? config.debounceSeconds ?? 2.5;
    const waitTimeMs = Math.max(1000, waitSeconds * 1000);

    const bufferKey = sessionName ? `${sessionName}:${chatId}` : chatId;
    const existing = this.buffers.get(bufferKey);

    if (existing) {
      // Limpa timer anterior e acumula mensagem
      clearTimeout(existing.timer);
      existing.messages.push(messageText);
      if (contactName) existing.contactName = contactName;

      existing.timer = setTimeout(() => {
        this.flush(bufferKey, chatId);
      }, waitTimeMs);
    } else {
      // Cria novo buffer para o chatId
      const timer = setTimeout(() => {
        this.flush(bufferKey, chatId);
      }, waitTimeMs);

      this.buffers.set(bufferKey, {
        timer,
        messages: [messageText],
        contactName,
        sessionName,
        agentId
      });
    }
  }

  private async flush(bufferKey: string, realChatId: string): Promise<void> {
    const buffer = this.buffers.get(bufferKey);
    if (!buffer) return;

    this.buffers.delete(bufferKey);

    const combinedText = buffer.messages.join('\n');
    if (this.handler && combinedText.trim()) {
      try {
        await this.handler(realChatId, combinedText, buffer.contactName, buffer.sessionName, buffer.agentId);
      } catch (err: any) {
        console.error(`[Debouncer] Erro ao processar mensagens para ${realChatId}:`, err.message);
      }
    }
  }

  cancel(chatId: string, sessionName?: string): void {
    const bufferKey = sessionName ? `${sessionName}:${chatId}` : chatId;
    const existing = this.buffers.get(bufferKey);
    if (existing) {
      clearTimeout(existing.timer);
      this.buffers.delete(bufferKey);
    }
  }
}

export const messageDebouncer = new MessageDebouncer();
