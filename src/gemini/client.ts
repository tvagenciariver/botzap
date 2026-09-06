import { GoogleGenerativeAI } from '@google/generative-ai';
import { env, loadBotConfig, saveBotConfig } from '../config/index.js';
import { AgentProfile } from '../config/agent-types.js';
import { agentManager } from '../config/agent-manager.js';
import { memoryStore } from './memory.js';

export class GeminiService {
  private genAI: GoogleGenerativeAI | null = null;

  constructor() {
    this.initClient();
  }

  private initClient(): void {
    const config = loadBotConfig();
    const apiKey = env.geminiApiKey || config.geminiApiKey;
    if (apiKey && apiKey.trim() !== '' && apiKey !== 'sua_chave_gemini_aqui') {
      this.genAI = new GoogleGenerativeAI(apiKey.trim());
    } else {
      this.genAI = null;
    }
  }

  isConfigured(): boolean {
    const config = loadBotConfig();
    const key = env.geminiApiKey || config.geminiApiKey;
    return !!(key && key.trim() !== '' && key !== 'sua_chave_gemini_aqui');
  }

  /**
   * Atualiza a chave de API em tempo de execução
   */
  updateApiKey(newApiKey: string): void {
    env.geminiApiKey = newApiKey.trim();
    this.initClient();
  }

  /**
   * Constrói o System Prompt completo unindo as diretrizes e dados do negócio
   */
  private buildFullSystemInstruction(agent?: AgentProfile): string {
    const config = loadBotConfig();
    const companyName = agent?.companyName || config.companyName || 'Nossa Empresa';
    const rawInstruction = agent?.systemInstruction || config.systemInstruction || 'Você é um atendente inteligente para WhatsApp.';
    
    let instruction = rawInstruction.replace('{companyName}', companyName);

    const businessInfo = agent ? agent.businessInfo : config.businessInfo;
    if (businessInfo && businessInfo.trim()) {
      instruction += `\n\n--- INFORMAÇÕES E REGRAS DA EMPRESA ---\n${businessInfo}`;
    }

    instruction += `\n\n--- REGRAS DE FORMATAÇÃO WHATSAPP ---
- O WhatsApp NÃO suporta títulos markdown como '# Título' ou '## Subtítulo'. NUNCA use '#' para cabeçalhos.
- Use *negrito* para dar destaque.
- Use _itálico_ quando apropriado.
- Use listas com traços (-) ou emojis explicativos.
- Seja cortês, humanizado e conciso.`;

    return instruction;
  }

  /**
   * Gera resposta para o cliente usando Google Gemini Flash com auto-recuperação de modelo
   */
  async generateReply(chatId: string, userMessage: string, contactName?: string, agent?: AgentProfile): Promise<string> {
    const config = loadBotConfig();
    const apiKey = (agent?.geminiApiKey && agent.geminiApiKey.trim() !== '' && agent.geminiApiKey !== 'sua_chave_gemini_aqui')
      ? agent.geminiApiKey.trim()
      : (env.geminiApiKey || config.geminiApiKey || '').trim();

    if (!apiKey || apiKey === 'sua_chave_gemini_aqui') {
      throw new Error('GEMINI_API_KEY não configurada. Informe sua chave no perfil do Agente ou nas configurações gerais.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const systemInstruction = this.buildFullSystemInstruction(agent);
    const history = memoryStore.getHistory(chatId);

    // Lista de modelos candidatos priorizados para garantir altíssima disponibilidade
    const preferredModel = agent?.model || config.model || 'gemini-flash-lite-latest';
    const temperature = agent?.temperature ?? config.temperature ?? 0.4;
    const candidateModels = Array.from(new Set([
      preferredModel,
      'gemini-flash-lite-latest',
      'gemini-2.5-flash-lite',
      'gemini-flash-latest',
      'gemini-3.6-flash',
      'gemini-3.5-flash',
      'gemini-2.5-flash',
      'gemini-1.5-flash'
    ]));

    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: {
            role: 'system',
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature,
            maxOutputTokens: 1000
          }
        });

        let result;
        try {
          const chat = model.startChat({ history });
          result = await chat.sendMessage(userMessage);
        } catch (chatErr: any) {
          const errMsg = chatErr?.message || '';
          if (errMsg.includes('role') || errMsg.includes('First content') || errMsg.includes('history')) {
            console.warn(`[Gemini] Inconsistência no histórico detectada (${errMsg}). Limpando histórico de ${chatId} e regenerando...`);
            memoryStore.clearHistory(chatId);
            const freshChat = model.startChat({ history: [] });
            result = await freshChat.sendMessage(userMessage);
          } else {
            throw chatErr;
          }
        }
        let replyText = result.response.text();

        // Se precisou usar outro modelo com sucesso, atualiza a configuração para os próximos
        if (modelName !== preferredModel) {
          console.log(`[Gemini] Modelo alternado com sucesso para "${modelName}" (anterior "${preferredModel}" falhou/sem quota).`);
          if (agent) {
            agent.model = modelName;
            agentManager.updateAgent(agent.id, { model: modelName });
          } else {
            saveBotConfig({ model: modelName });
          }
        }

        // Sanitização amigável de títulos Markdown para formato WhatsApp (*Negrito*)
        replyText = replyText.replace(/^#{1,6}\s*(.+)$/gm, '*$1*');

        // Salva no histórico de memória
        memoryStore.addMessage(chatId, 'user', userMessage, contactName);
        memoryStore.addMessage(chatId, 'model', replyText, contactName);

        return replyText;
      } catch (error: any) {
        lastError = error;
        const msg = error.message || '';
        // Se o erro for 404 (modelo indisponível), 429 (quota esgotada no modelo específico), 503 (sobrecarregado)
        const isModelSpecificError =
          msg.includes('404') || msg.includes('not found') || msg.includes('no longer available') ||
          msg.includes('429') || msg.includes('quota') || msg.includes('Quota exceeded') || msg.includes('ResourceExhausted') ||
          msg.includes('503') || msg.includes('overloaded') || msg.includes('high demand');

        if (isModelSpecificError) {
          console.warn(`[Gemini] Modelo "${modelName}" falhou (${msg.slice(0, 110)}...). Tentando modelo de contingência...`);
          continue;
        } else {
          // Erro global (como chave de API inválida), lança exceção
          throw error;
        }
      }
    }

    throw lastError || new Error('Não foi possível obter resposta de nenhum dos modelos Gemini testados.');
  }

  /**
   * Avalia se a mensagem do cliente expressa o desejo de falar com atendente humano
   */
  checkHandoffIntent(userMessage: string, customKeywords?: string[]): boolean {
    const config = loadBotConfig();
    const keywords = (customKeywords && customKeywords.length > 0)
      ? customKeywords
      : (config.handoffKeywords || []);
    const normalized = userMessage.toLowerCase().trim();

    for (const keyword of keywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return true;
      }
    }

    return false;
  }
}

export const geminiService = new GeminiService();
