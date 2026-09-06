import { loadBotConfig, env } from '../config/index.js';
import { AgentProfile } from '../config/agent-types.js';
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
  getActiveProviderInfo(agent?: AgentProfile): { provider: 'gemini' | 'openai'; model: string; isConfigured: boolean } {
    const config = loadBotConfig();
    const provider = agent?.llmProvider || config.llmProvider || 'gemini';

    if (provider === 'openai') {
      const hasKey = !!(agent?.openaiApiKey?.trim() || openAIService.isConfigured());
      return {
        provider: 'openai',
        model: agent?.openaiModel || config.openaiModel || 'gpt-4o-mini',
        isConfigured: hasKey
      };
    } else {
      const hasKey = !!(agent?.geminiApiKey?.trim() || geminiService.isConfigured());
      return {
        provider: 'gemini',
        model: agent?.model || config.model || 'gemini-flash-lite-latest',
        isConfigured: hasKey
      };
    }
  }

  /**
   * Gera a resposta do assistente usando o provedor configurado com fallback automático caso o secundário esteja ativo
   */
  async generateReply(chatId: string, userMessage: string, contactName?: string, agent?: AgentProfile): Promise<LLMReplyResult> {
    const config = loadBotConfig();
    const primaryProvider = agent?.llmProvider || config.llmProvider || 'gemini';

    if (primaryProvider === 'openai') {
      try {
        const text = await openAIService.generateReply(chatId, userMessage, contactName, agent);
        return {
          text,
          provider: 'openai',
          model: agent?.openaiModel || config.openaiModel || 'gpt-4o-mini'
        };
      } catch (err: any) {
        console.warn(`[LLMManager] Provedor OpenAI falhou (${err.message}).`);
        // Fallback para Gemini se estiver configurado
        const geminiKey = agent?.geminiApiKey?.trim() || env.geminiApiKey || config.geminiApiKey;
        if (geminiKey && geminiKey !== 'sua_chave_gemini_aqui') {
          console.log(`[LLMManager] Acionando contingência automática via Google Gemini...`);
          const text = await geminiService.generateReply(chatId, userMessage, contactName, agent);
          return {
            text,
            provider: 'gemini',
            model: agent?.model || config.model || 'gemini-flash-lite-latest'
          };
        }
        throw err;
      }
    } else {
      // Provedor primário: Google Gemini
      try {
        const text = await geminiService.generateReply(chatId, userMessage, contactName, agent);
        return {
          text,
          provider: 'gemini',
          model: agent?.model || config.model || 'gemini-flash-lite-latest'
        };
      } catch (err: any) {
        console.warn(`[LLMManager] Provedor Gemini falhou (${err.message}).`);
        // Fallback para OpenAI se estiver configurado
        const openaiKey = agent?.openaiApiKey?.trim() || env.openaiApiKey || config.openaiApiKey;
        if (openaiKey && openaiKey !== 'sua_chave_openai_aqui') {
          console.log(`[LLMManager] Acionando contingência automática via OpenAI...`);
          const text = await openAIService.generateReply(chatId, userMessage, contactName, agent);
          return {
            text,
            provider: 'openai',
            model: agent?.openaiModel || config.openaiModel || 'gpt-4o-mini'
          };
        }
        throw err;
      }
    }
  }

  /**
   * Avalia intenção de transbordo humano baseado nas palavras-chave configuradas
   */
  checkHandoffIntent(userMessage: string, customKeywords?: string[]): boolean {
    return geminiService.checkHandoffIntent(userMessage, customKeywords);
  }
}

export const llmProviderManager = new LLMProviderManager();
