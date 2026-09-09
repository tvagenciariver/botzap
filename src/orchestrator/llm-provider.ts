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
    const isTranscriptionEnabled = (agent?.enableAudioTranscription !== undefined)
      ? agent.enableAudioTranscription
      : (config.enableAudioTranscription ?? false);

    if (primaryProvider === 'openai') {
      try {
        const text = await openAIService.generateReply(chatId, userMessage, contactName, agent);
        return {
          text: this.sanitizeAudioRefusal(text, isTranscriptionEnabled),
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
            text: this.sanitizeAudioRefusal(text, isTranscriptionEnabled),
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
          text: this.sanitizeAudioRefusal(text, isTranscriptionEnabled),
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
          const isTranscriptionEnabled = (agent?.enableAudioTranscription !== undefined)
            ? agent.enableAudioTranscription
            : (config.enableAudioTranscription ?? false);
          return {
            text: this.sanitizeAudioRefusal(text, isTranscriptionEnabled),
            provider: 'openai',
            model: agent?.openaiModel || config.openaiModel || 'gpt-4o-mini'
          };
        }
        throw err;
      }
    }
  }

  /**
   * Sanitiza respostas da IA removendo recusas alucinadas de áudio quando a transcrição estiver ativa
   */
  private sanitizeAudioRefusal(text: string, isTranscriptionEnabled: boolean): string {
    if (!isTranscriptionEnabled || !text) return text;

    // Remove frases de recusa de áudio como:
    // "Só nos comunicamos por mensagens de texto, imagens e documentos e por isso não consigo ouvir áudios."
    const cleaned = text
      .replace(/(?:por\s+favor\s*,?\s*)?(?:desculpe\s*,?\s*)?(?:lembrando\s+que\s+)?(?:só|somente)\s+(?:nos\s+)?comunicamos\s+por\s+mensagens?\s+de\s+texto[^.!?\n]*[.!?\n]*/gi, '')
      .replace(/(?:desculpe\s*,?\s*)?(?:n[aã]o\s+(?:consigo|podemos?|é\s+poss[ií]vel)\s+(?:ouvir|escutar|reproduzir)\s+[aá]udios?[^.!?\n]*)[.!?\n]*/gi, '')
      .replace(/(?:infelizmente\s*,?\s*)?(?:n[aã]o\s+ou[çc]o\s+[aá]udios?[^.!?\n]*)[.!?\n]*/gi, '')
      .trim();

    return cleaned || text;
  }

  /**
   * Avalia intenção de transbordo humano baseado nas palavras-chave configuradas
   */
  checkHandoffIntent(userMessage: string, customKeywords?: string[]): boolean {
    return geminiService.checkHandoffIntent(userMessage, customKeywords);
  }
}

export const llmProviderManager = new LLMProviderManager();
