import axios, { AxiosInstance } from 'axios';
import { env, loadBotConfig } from '../config/index.js';
import { WahaSendTextRequest, WahaSessionStatus } from './types.js';

export class WahaClient {
  private client!: AxiosInstance;
  private defaultSession!: string;

  constructor() {
    this.reloadConfig();
  }

  /**
   * Recarrega a configuração do cliente a partir de bot_config e env
   */
  reloadConfig(): void {
    const config = loadBotConfig();
    this.defaultSession = config.wahaSession || env.wahaSession || 'default';
    const baseUrl = config.wahaBaseUrl || env.wahaBaseUrl || 'http://localhost:3000';
    const apiKey = config.wahaApiKey !== undefined ? config.wahaApiKey : env.wahaApiKey;

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (apiKey && apiKey.trim() !== '') {
      headers['X-Api-Key'] = apiKey.trim();
    }

    this.client = axios.create({
      baseURL: baseUrl.replace(/\/$/, ''),
      headers,
      timeout: 15000
    });
  }

  /**
   * Atualiza as configurações da WAHA dinamicamente
   */
  updateConfig(baseUrl: string, apiKey?: string, session?: string): void {
    if (baseUrl) env.wahaBaseUrl = baseUrl.replace(/\/$/, '');
    if (apiKey !== undefined) env.wahaApiKey = apiKey;
    if (session) {
      env.wahaSession = session;
      this.defaultSession = session;
    }
    this.reloadConfig();
  }

  /**
   * Envia mensagem de texto para um contato ou grupo no WhatsApp
   */
  async sendText(chatId: string, text: string, options?: Partial<WahaSendTextRequest>): Promise<any> {
    const session = options?.session || this.defaultSession;
    const body: WahaSendTextRequest = {
      session,
      chatId,
      text,
      linkPreview: options?.linkPreview ?? true,
      reply_to: options?.reply_to
    };

    try {
      const response = await this.client.post('/api/sendText', body);
      return response.data;
    } catch (error: any) {
      const msg = error.response?.data?.message || error.message;
      console.error(`[WAHA] Erro ao enviar texto para ${chatId}:`, msg);
      throw error;
    }
  }

  /**
   * Envia confirmação de leitura (dois risquinhos azuis/verdes)
   */
  async sendSeen(chatId: string, session?: string): Promise<void> {
    try {
      await this.client.post('/api/sendSeen', {
        session: session || this.defaultSession,
        chatId
      });
    } catch (error: any) {
      console.warn(`[WAHA] Aviso ao marcar visto (${chatId}):`, error.response?.data?.message || error.message);
    }
  }

  /**
   * Inicia indicador de "Digitando..." no WhatsApp
   */
  async startTyping(chatId: string, session?: string): Promise<void> {
    try {
      await this.client.post('/api/startTyping', {
        session: session || this.defaultSession,
        chatId
      });
    } catch (error: any) {
      console.warn(`[WAHA] Aviso ao iniciar digitação (${chatId}):`, error.response?.data?.message || error.message);
    }
  }

  /**
   * Para indicador de digitação no WhatsApp
   */
  async stopTyping(chatId: string, session?: string): Promise<void> {
    try {
      await this.client.post('/api/stopTyping', {
        session: session || this.defaultSession,
        chatId
      });
    } catch (error: any) {
      console.warn(`[WAHA] Aviso ao parar digitação (${chatId}):`, error.response?.data?.message || error.message);
    }
  }

  /**
   * Verifica o status da sessão na WAHA
   */
  async getSessionStatus(session?: string): Promise<WahaSessionStatus | null> {
    const sessionName = session || this.defaultSession;
    try {
      const response = await this.client.get(`/api/sessions/${sessionName}`);
      return response.data;
    } catch (error: any) {
      if (error.response?.status === 404) {
        return null;
      }
      return null;
    }
  }

  /**
   * Lista todas as sessões ativas na WAHA
   */
  async listSessions(): Promise<WahaSessionStatus[]> {
    try {
      const response = await this.client.get('/api/sessions');
      return response.data;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Testa a conexão completa com a WAHA e retorna detalhes da sessão
   */
  async testConnection(session?: string): Promise<{ success: boolean; message: string; sessionStatus?: string; sessions?: string[] }> {
    const sessionName = session || this.defaultSession;
    try {
      // 1. Tenta listar sessões
      const listRes = await this.client.get('/api/sessions');
      const sessions = Array.isArray(listRes.data) ? listRes.data : [];
      const sessionNames = sessions.map((s: any) => s.name);

      const targetSession = sessions.find((s: any) => s.name === sessionName);

      if (targetSession) {
        return {
          success: true,
          message: `Conectado com sucesso! Sessão "${sessionName}" encontrada com status: ${targetSession.status}`,
          sessionStatus: targetSession.status,
          sessions: sessionNames
        };
      } else {
        return {
          success: true,
          message: `Conectado à WAHA, mas a sessão "${sessionName}" não foi encontrada. Sessões disponíveis: ${sessionNames.join(', ') || 'Nenhuma'}`,
          sessions: sessionNames
        };
      }
    } catch (error: any) {
      const status = error.response?.status;
      if (status === 401 || status === 403) {
        return {
          success: false,
          message: `Erro de Autenticação na WAHA (${status}): Chave de API (X-Api-Key) ausente ou incorreta.`
        };
      } else if (error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
        return {
          success: false,
          message: `Não foi possível conectar à URL da WAHA (${error.message}). Verifique se o endereço está correto e acessível.`
        };
      }
      return {
        success: false,
        message: `Erro ao comunicar com a WAHA: ${error.response?.data?.message || error.message}`
      };
    }
  }

  /**
   * Registra ou atualiza o webhook do Bot na WAHA
   */
  async configureWebhook(webhookUrl: string, session?: string): Promise<{ success: boolean; message: string }> {
    const sessionName = session || this.defaultSession;
    const webhookConfig = {
      url: webhookUrl,
      events: ['message']
    };

    try {
      // Método 1: POST /api/sessions/{session}/webhooks
      await this.client.post(`/api/sessions/${sessionName}/webhooks`, webhookConfig);
      return {
        success: true,
        message: `Webhook registrado com sucesso na sessão "${sessionName}" da WAHA!`
      };
    } catch (err1: any) {
      try {
        // Método 2: PUT /api/sessions/{session}/webhooks
        await this.client.put(`/api/sessions/${sessionName}/webhooks`, webhookConfig);
        return {
          success: true,
          message: `Webhook registrado via PUT na sessão "${sessionName}" da WAHA!`
        };
      } catch (err2: any) {
        try {
          // Método 3: PATCH /api/sessions/{session}
          await this.client.patch(`/api/sessions/${sessionName}`, {
            config: {
              webhooks: [webhookConfig]
            }
          });
          return {
            success: true,
            message: `Webhook configurado via PATCH na sessão "${sessionName}"!`
          };
        } catch (err3: any) {
          const errCode = err3.response?.status || err1.response?.status;
          const errMsg = err3.response?.data?.message || err1.response?.data?.message || err1.message;
          return {
            success: false,
            message: `Falha ao registrar webhook na WAHA (${errCode || 'Erro'}): ${errMsg}. Você também pode colar a URL ${webhookUrl} diretamente no Dashboard da sua WAHA.`
          };
        }
      }
    }
  }
}

export const wahaClient = new WahaClient();
