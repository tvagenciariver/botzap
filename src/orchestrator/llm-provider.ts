import { loadBotConfig } from '../config/index.js';
import { geminiService } from '../gemini/client.js';
import { openAIService } from '../openai/client.js';

export interface LLMReplyResult {
  text: string;
  provider: 'gemini' | 'openai';
  model: string;
}

export class LLMProviderManager {
  /**
   * Retorna informações sobre o provedor e modelo atualmente ativos
   */
  getActiveProviderInfo(): { provider: 'gemini' | 'openai'; model: string; isConfigured: boolean } {
    const config = loadBotConfig();
    const provider = config.llmProvider || 'gemini';

    if (provider === 'openai') {
      return {
        provider: 'openai',
        model: config.openaiModel || 'gpt-4o-mini',
        isConfigured: openAIService.isConfigured()
      };
    } else {
      return {
        provider: 'gemini',
        model: config.model || 'gemini-flash-lite-latest',
        isConfigured: geminiService.isConfigured()
      };
    }
  }

  /**
   * Gera a resposta do assistente usando o provedor configurado com fallback automático caso o secundário esteja ativo
   */
  async generateReply(chatId: string, userMessage: string, contactName?: string): Promise<LLMReplyResult> {
    const config = loadBotConfig();
    const primaryProvider = config.llmProvider || 'gemini';

    if (primaryProvider === 'openai') {
      try {
        const text = await openAIService.generateReply(chatId, userMessage, contactName);
        return {
          text,
          provider: 'openai',
          model: config.openaiModel || 'gpt-4o-mini'
        };
      } catch (err: any) {
        console.warn(`[LLMManager] Provedor OpenAI falhou (${err.message}).`);
        // Fallback para Gemini se estiver configurado
        if (geminiService.isConfigured()) {
          console.log(`[LLMManager] Acionando contingência automática via Google Gemini...`);
          const text = await geminiService.generateReply(chatId, userMessage, contactName);
          return {
            text,
            provider: 'gemini',
            model: config.model || 'gemini-flash-lite-latest'
          };
        }
        throw err;
      }
    } else {
      // Provedor primário: Google Gemini
      try {
        const text = await geminiService.generateReply(chatId, userMessage, contactName);
        return {
          text,
          provider: 'gemini',
          model: config.model || 'gemini-flash-lite-latest'
        };
      } catch (err: any) {
        console.warn(`[LLMManager] Provedor Gemini falhou (${err.message}).`);
        // Fallback para OpenAI se estiver configurado
        if (openAIService.isConfigured()) {
          console.log(`[LLMManager] Acionando contingência automática via OpenAI...`);
          const text = await openAIService.generateReply(chatId, userMessage, contactName);
          return {
            text,
            provider: 'openai',
            model: config.openaiModel || 'gpt-4o-mini'
          };
        }
        throw err;
      }
    }
  }

  /**
   * Avalia intenção de transbordo humano baseado nas palavras-chave configuradas
   */
  checkHandoffIntent(userMessage: string): boolean {
    return geminiService.checkHandoffIntent(userMessage);
  }
}

export const llmProviderManager = new LLMProviderManager();
