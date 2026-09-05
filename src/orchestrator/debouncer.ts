import { loadBotConfig } from '../config/index.js';

type MessageHandler = (chatId: string, combinedText: string, contactName?: string) => Promise<void>;

interface PendingBuffer {
  timer: NodeJS.Timeout;
  messages: string[];
  contactName?: string;
}

export class MessageDebouncer {
  private buffers: Map<string, PendingBuffer> = new Map();
  private handler: MessageHandler | null = null;

  registerHandler(handler: MessageHandler): void {
    this.handler = handler;
  }

  enqueue(chatId: string, messageText: string, contactName?: string): void {
    if (!this.handler) {
      console.warn('[Debouncer] Nenhum handler registrado no debouncer.');
      return;
    }

    const config = loadBotConfig();
    const waitTimeMs = Math.max(1000, (config.debounceSeconds || 2.5) * 1000);

    const existing = this.buffers.get(chatId);

    if (existing) {
      // Limpa timer anterior e acumula mensagem
      clearTimeout(existing.timer);
      existing.messages.push(messageText);
      if (contactName) existing.contactName = contactName;

      existing.timer = setTimeout(() => {
        this.flush(chatId);
      }, waitTimeMs);
    } else {
      // Cria novo buffer para o chatId
      const timer = setTimeout(() => {
        this.flush(chatId);
      }, waitTimeMs);

      this.buffers.set(chatId, {
        timer,
        messages: [messageText],
        contactName
      });
    }
  }

  private async flush(chatId: string): Promise<void> {
    const buffer = this.buffers.get(chatId);
    if (!buffer) return;

    this.buffers.delete(chatId);

    const combinedText = buffer.messages.join('\n');
    if (this.handler && combinedText.trim()) {
      try {
        await this.handler(chatId, combinedText, buffer.contactName);
      } catch (err: any) {
        console.error(`[Debouncer] Erro ao processar mensagens para ${chatId}:`, err.message);
      }
    }
  }

  cancel(chatId: string): void {
    const existing = this.buffers.get(chatId);
    if (existing) {
      clearTimeout(existing.timer);
      this.buffers.delete(chatId);
    }
  }
}

export const messageDebouncer = new MessageDebouncer();
