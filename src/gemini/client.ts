import { GoogleGenerativeAI } from '@google/generative-ai';
import { env, loadBotConfig, saveBotConfig } from '../config/index.js';
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
  private buildFullSystemInstruction(): string {
    const config = loadBotConfig();
    
    let instruction = config.systemInstruction.replace('{companyName}', config.companyName);

    if (config.businessInfo && config.businessInfo.trim()) {
      instruction += `\n\n--- INFORMAÇÕES E REGRAS DA EMPRESA ---\n${config.businessInfo}`;
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
  async generateReply(chatId: string, userMessage: string, contactName?: string): Promise<string> {
    this.initClient();
    if (!this.genAI) {
      throw new Error('GEMINI_API_KEY não configurada. Informe sua chave na aba "Agente & Prompts" no Painel Web.');
    }

    const config = loadBotConfig();
    const systemInstruction = this.buildFullSystemInstruction();
    const history = memoryStore.getHistory(chatId);

    // Lista de modelos candidatos priorizados para garantir alta disponibilidade
    const preferredModel = config.model || 'gemini-1.5-flash';
    const candidateModels = Array.from(new Set([
      preferredModel,
      'gemini-1.5-flash',
      'gemini-2.5-flash',
      'gemini-3.6-flash',
      'gemini-1.5-pro'
    ]));

    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const model = this.genAI.getGenerativeModel({
          model: modelName,
          systemInstruction: {
            role: 'system',
            parts: [{ text: systemInstruction }]
          },
          generationConfig: {
            temperature: config.temperature ?? 0.4,
            maxOutputTokens: 1000
          }
        });

        const chat = model.startChat({ history });
        const result = await chat.sendMessage(userMessage);
        let replyText = result.response.text();

        // Se precisou usar outro modelo com sucesso, atualiza a configuração para os próximos
        if (modelName !== config.model) {
          console.log(`[Gemini] Modelo alterado com sucesso para "${modelName}" (anterior "${config.model}" indisponível).`);
          saveBotConfig({ model: modelName });
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
        // Se o erro for 404 (modelo indisponível/descontinuado), tenta o próximo modelo da lista
        if (msg.includes('404') || msg.includes('not found') || msg.includes('no longer available')) {
          console.warn(`[Gemini] Modelo "${modelName}" retornou 404/indisponível. Tentando próximo modelo...`);
          continue;
        } else {
          // Erro de autenticação, quota ou outro, não adianta trocar modelo
          throw error;
        }
      }
    }

    throw lastError || new Error('Não foi possível obter resposta de nenhum dos modelos Gemini testados.');
  }

  /**
   * Avalia se a mensagem do cliente expressa o desejo de falar com atendente humano
   */
  checkHandoffIntent(userMessage: string): boolean {
    const config = loadBotConfig();
    const normalized = userMessage.toLowerCase().trim();

    for (const keyword of config.handoffKeywords) {
      if (normalized.includes(keyword.toLowerCase())) {
        return true;
      }
    }

    return false;
  }
}

export const geminiService = new GeminiService();
