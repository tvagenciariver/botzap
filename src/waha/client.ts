import axios, { AxiosInstance } from 'axios';
import { env } from '../config/index.js';
import { WahaSendTextRequest, WahaSessionStatus } from './types.js';

export class WahaClient {
  private client: AxiosInstance;
  private defaultSession: string;

  constructor() {
    this.defaultSession = env.wahaSession;
    
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    };

    if (env.wahaApiKey) {
      headers['X-Api-Key'] = env.wahaApiKey;
    }

    this.client = axios.create({
      baseURL: env.wahaBaseUrl,
      headers,
      timeout: 15000
    });
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
      // Falha silenciosa para não quebrar fluxo principal caso engine não suporte
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
      console.error(`[WAHA] Erro ao verificar sessão ${sessionName}:`, error.message);
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
      console.error('[WAHA] Erro ao listar sessões:', error.message);
      return [];
    }
  }

  /**
   * Registra ou atualiza o webhook do Bot na WAHA
   */
  async configureWebhook(webhookUrl: string, session?: string): Promise<boolean> {
    const sessionName = session || this.defaultSession;
    const webhookConfig = {
      url: webhookUrl,
      events: ['message']
    };

    try {
      // Tenta adicionar webhook diretamente na sessão
      await this.client.post(`/api/sessions/${sessionName}/webhooks`, webhookConfig);
      console.log(`[WAHA] Webhook registrado com sucesso na sessão ${sessionName}: ${webhookUrl}`);
      return true;
    } catch (err1: any) {
      // Alternativa: tentar atualizar a configuração da sessão
      try {
        await this.client.patch(`/api/sessions/${sessionName}`, {
          config: {
            webhooks: [webhookConfig]
          }
        });
        console.log(`[WAHA] Webhook atualizado via PATCH na sessão ${sessionName}: ${webhookUrl}`);
        return true;
      } catch (err2: any) {
        console.warn(`[WAHA] Não foi possível auto-configurar webhook na sessão: ${err2.message}`);
        console.info(`[WAHA] Você pode configurar o webhook na WAHA através de WHATSAPP_HOOK_URL=${webhookUrl} ou no Dashboard da WAHA.`);
        return false;
      }
    }
  }
}

export const wahaClient = new WahaClient();
