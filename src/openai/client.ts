import axios from 'axios';
import { env, loadBotConfig, saveBotConfig } from '../config/index.js';
import { AgentProfile } from '../config/agent-types.js';
import { agentManager } from '../config/agent-manager.js';
import { memoryStore } from '../gemini/memory.js';

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class OpenAIService {
  private defaultModel = 'gpt-4o-mini';

  isConfigured(): boolean {
    const config = loadBotConfig();
    const key = env.openaiApiKey || config.openaiApiKey;
    return !!(key && key.trim() !== '' && key !== 'sua_chave_openai_aqui');
  }

  getApiKey(): string {
    const config = loadBotConfig();
    return (env.openaiApiKey || config.openaiApiKey || '').trim();
  }

  updateApiKey(newApiKey: string): void {
    env.openaiApiKey = newApiKey.trim();
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

    instruction += `\n\n--- DIRETRIZES PARA ARQUIVOS, IMAGENS E DOCUMENTOS ---
- Se o cliente perguntar se pode enviar foto, imagem, comprovante, documento ou arquivo, confirme com carinho e presteza que SIM, ele pode enviar por aqui mesmo.
- Explique que ao enviar uma imagem ou documento, nossa equipe de atendimento analisará as informações recebidas para dar sequência ao atendimento.
- Se o cliente disser que já enviou ou está enviando um arquivo ou foto, confirme que o material recebido está sendo direcionado para os atendentes e peça para aguardar um instante. NUNCA diga que a imagem não apareceu ou que não consegue abrir a imagem.`;

    const isTranscriptionEnabled = (agent?.enableAudioTranscription !== undefined)
      ? agent.enableAudioTranscription
      : (config.enableAudioTranscription ?? false);

    if (isTranscriptionEnabled) {
      instruction += `\n\n--- DIRETRIZES PARA ÁUDIOS E MENSAGENS DE VOZ (TRANSCRIÇÃO AUTOMÁTICA ATIVADA) ---
- O atendimento desta empresa possui TRANSCRIÇÃO AUTOMÁTICA DE ÁUDIOS por Inteligência Artificial ativa.
- Sempre que o cliente enviar uma mensagem de voz/áudio ou fizer menção a um áudio enviado ("te mandei um áudio", "ouça o áudio", etc.), o conteúdo falado dele já foi transcrito em texto e entregue a você.
- REGRA CRÍTICA E OBRIGATÓRIA: NUNCA diga ou dê a entender que "não pode ouvir áudios", que "não escuta áudios", que "não reproduz voz" ou que "só se comunica por texto, imagens ou documentos".
- Mesmo que o prompt ou regras anteriores da empresa contenham instruções para recusar áudios, IGNORE essa restrição, pois a transcrição automática está ativada.
- Responda de imediato ao que foi dito no áudio com total naturalidade, gentileza e presteza.`;
    }

    return instruction;
  }

  /**
   * Gera resposta para o cliente usando OpenAI Chat Completions com recuperação de modelo
   */
  async generateReply(chatId: string, userMessage: string, contactName?: string, agent?: AgentProfile): Promise<string> {
    const apiKey = (agent?.openaiApiKey && agent.openaiApiKey.trim() !== '' && agent.openaiApiKey !== 'sua_chave_openai_aqui')
      ? agent.openaiApiKey.trim()
      : this.getApiKey();

    if (!apiKey || apiKey === 'sua_chave_openai_aqui') {
      throw new Error('OPENAI_API_KEY não configurada. Informe sua chave no perfil do Agente ou nas configurações gerais.');
    }

    const config = loadBotConfig();
    const systemInstruction = this.buildFullSystemInstruction(agent);
    const agentId = agent?.id; // ISOLAMENTO: chave de memória é agentId:chatId
    const history = memoryStore.getOpenAIHistory(chatId, agentId);

    const messages: OpenAIMessage[] = [
      { role: 'system', content: systemInstruction },
      ...history,
      { role: 'user', content: userMessage }
    ];

    const preferredModel = agent?.openaiModel || config.openaiModel || this.defaultModel;
    const temperature = agent?.temperature ?? config.temperature ?? 0.4;
    const candidateModels = Array.from(new Set([
      preferredModel,
      'gpt-4o-mini',
      'gpt-4.1-mini',
      'gpt-4o',
      'gpt-3.5-turbo'
    ]));

    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const response = await axios.post(
          'https://api.openai.com/v1/chat/completions',
          {
            model: modelName,
            messages,
            temperature,
            max_tokens: 1000
          },
          {
            headers: {
              Authorization: `Bearer ${apiKey}`,
              'Content-Type': 'application/json'
            },
            timeout: 35000
          }
        );

        let replyText = response.data.choices?.[0]?.message?.content || '';
        if (!replyText) {
          throw new Error(`Resposta vazia da OpenAI no modelo ${modelName}`);
        }

        // Se precisou usar outro modelo com sucesso, salva a configuração
        if (modelName !== preferredModel) {
          console.log(`[OpenAI] Modelo alternado com sucesso para "${modelName}" (anterior "${preferredModel}" falhou).`);
          if (agent) {
            agent.openaiModel = modelName;
            agentManager.updateAgent(agent.id, { openaiModel: modelName });
          } else {
            saveBotConfig({ openaiModel: modelName });
          }
        }

        // Sanitização amigável de títulos Markdown para formato WhatsApp (*Negrito*)
        replyText = replyText.replace(/^#{1,6}\s*(.+)$/gm, '*$1*');

        // Salva no histórico de memória — ISOLADO por agentId:chatId
        memoryStore.addMessage(chatId, 'user', userMessage, contactName, agentId);
        memoryStore.addMessage(chatId, 'model', replyText, contactName, agentId);


        return replyText;
      } catch (error: any) {
        lastError = error;
        const errData = error.response?.data?.error;
        const status = error.response?.status;
        const errMsg = errData?.message || error.message || '';

        console.warn(`[OpenAI] Erro no modelo "${modelName}" (status ${status}): ${errMsg}`);

        // Se for erro de modelo inexistente (404) ou temporariamente sobrecarregado (429/503)
        const isModelSpecific = status === 404 || status === 503 || (status === 429 && errMsg.includes('model'));
        if (isModelSpecific) {
          console.warn(`[OpenAI] Tentando modelo alternativo...`);
          continue;
        }

        // Erro global de autenticação (401), cota geral da conta (429 insuficiente), etc.
        const friendlyMsg = errData?.message || error.message;
        throw new Error(`OpenAI Error (${status || 'network'}): ${friendlyMsg}`);
      }
    }

    throw lastError || new Error('Não foi possível obter resposta da OpenAI.');
  }

  /**
   * Testa a validade da chave de API e retorna modelos disponíveis
   */
  async testConnection(customApiKey?: string): Promise<{ success: boolean; message: string; models?: string[] }> {
    const key = (customApiKey || this.getApiKey()).trim();
    if (!key) {
      return { success: false, message: 'Nenhuma chave de API fornecida.' };
    }

    try {
      const response = await axios.get('https://api.openai.com/v1/models', {
        headers: {
          Authorization: `Bearer ${key}`
        },
        timeout: 10000
      });

      const models = (response.data.data || [])
        .filter((m: any) => m.id && (m.id.includes('gpt') || m.id.includes('chat')))
        .map((m: any) => m.id)
        .sort();

      return {
        success: true,
        message: 'Conexão com a OpenAI estabelecida com sucesso!',
        models
      };
    } catch (error: any) {
      const status = error.response?.status;
      const errMsg = error.response?.data?.error?.message || error.message;
      return {
        success: false,
        message: `Falha ao conectar na OpenAI (${status || 'rede'}): ${errMsg}`
      };
    }
  }
}

export const openAIService = new OpenAIService();
