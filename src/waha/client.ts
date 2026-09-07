import axios, { AxiosInstance } from 'axios';
import { env, loadBotConfig } from '../config/index.js';
import { WahaSendTextRequest, WahaSessionStatus } from './types.js';
import { getAlternateBrazilianChatId } from '../appointments/phone-utils.js';
export { getAlternateBrazilianChatId };

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
    const rawSession = config.wahaSession || env.wahaSession || 'default';
    this.defaultSession = (rawSession && rawSession !== '*') ? rawSession : 'default';
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
   * Extrai mensagem de erro legível e detalhada da resposta da WAHA
   */
  extractErrorMessage(error: any): string {
    if (error?.response?.data) {
      const data = error.response.data;
      if (typeof data === 'string') return data;
      if (data.message && data.error) return `${data.error}: ${data.message}`;
      if (data.message) return data.message;
      if (data.error) return typeof data.error === 'string' ? data.error : JSON.stringify(data.error);
      if (data.detail) return typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail);
      try {
        return JSON.stringify(data);
      } catch {
        // ignore
      }
    }
    return error?.message || 'Erro de comunicação com a WAHA';
  }

  /**
   * Envia mensagem de texto para um contato ou grupo no WhatsApp.
   * Conta com fallback automático inteligente para números brasileiros:
   * Se falhar o envio para 13 dígitos (com 9), tenta automaticamente para 12 dígitos (sem 9), e vice-versa.
   */
  async sendText(chatId: string, text: string, options?: Partial<WahaSendTextRequest>): Promise<any> {
    if (chatId.includes('@g.us')) {
      console.warn(`[WAHA] Bloqueado: Nossos bots não interagem em grupos do WhatsApp (@g.us): ${chatId}`);
      return null;
    }

    const rawSession = options?.session || this.defaultSession;
    const session = (rawSession && rawSession !== '*') ? rawSession : (this.defaultSession || 'default');

    const body: WahaSendTextRequest = {
      session,
      chatId,
      text,
      linkPreview: options?.linkPreview ?? false
    };

    if (options?.reply_to) {
      body.reply_to = options.reply_to;
    }

    try {
      const response = await this.client.post('/api/sendText', body);
      return response.data;
    } catch (error: any) {
      const firstErrMsg = this.extractErrorMessage(error);
      const altChatId = getAlternateBrazilianChatId(chatId);

      // Se for número brasileiro e o envio inicial falhou, tenta o formato alternativo (com/sem 9)
      if (altChatId) {
        console.warn(`[WAHA] Primeiro envio para ${chatId} falhou (${firstErrMsg}). Tentando formato alternativo do 9º dígito: ${altChatId}...`);
        try {
          const altBody = { ...body, chatId: altChatId };
          const altResponse = await this.client.post('/api/sendText', altBody);
          console.log(`[WAHA] ✅ Sucesso no envio para o número alternativo ${altChatId}!`);
          return altResponse.data;
        } catch (altError: any) {
          const altErrMsg = this.extractErrorMessage(altError);
          console.error(`[WAHA] Falha também no número alternativo ${altChatId}: ${altErrMsg}`);
          const detailedError = new Error(`Erro WAHA para ${chatId} (${firstErrMsg}) e alternativa ${altChatId} (${altErrMsg})`);
          (detailedError as any).response = error.response || altError.response;
          throw detailedError;
        }
      }

      console.error(`[WAHA] Erro ao enviar texto para ${chatId}:`, firstErrMsg);
      const detailedError = new Error(`Erro WAHA ao enviar para ${chatId}: ${firstErrMsg}`);
      (detailedError as any).response = error.response;
      throw detailedError;
    }
  }

  /**
   * Envia arquivo (PDF, imagem, documento) para um contato ou grupo no WhatsApp.
   * Utiliza POST /api/sendFile da WAHA com fallback inteligente do 9º dígito brasileiro.
   */
  async sendFile(
    chatId: string,
    fileData: {
      mimetype: string;
      filename: string;
      url?: string;
      base64?: string;
    },
    caption?: string,
    options?: { session?: string }
  ): Promise<any> {
    if (chatId.includes('@g.us')) {
      console.warn(`[WAHA] Bloqueado: Nossos bots não interagem em grupos do WhatsApp (@g.us): ${chatId}`);
      return null;
    }

    const rawSession = options?.session || this.defaultSession;
    const session = (rawSession && rawSession !== '*') ? rawSession : (this.defaultSession || 'default');

    let fileUrl = fileData.url;
    if (!fileUrl && fileData.base64) {
      fileUrl = fileData.base64.startsWith('data:') 
        ? fileData.base64 
        : `data:${fileData.mimetype};base64,${fileData.base64}`;
    }

    if (!fileUrl) {
      throw new Error('É necessário fornecer a URL pública ou o Base64 do arquivo.');
    }

    const body: any = {
      session,
      chatId,
      file: {
        mimetype: fileData.mimetype,
        filename: fileData.filename,
        url: fileUrl
      }
    };

    if (caption) {
      body.caption = caption;
    }

    try {
      const response = await this.client.post('/api/sendFile', body);
      return response.data;
    } catch (error: any) {
      const firstErrMsg = this.extractErrorMessage(error);
      const altChatId = getAlternateBrazilianChatId(chatId);

      // Se for número brasileiro e o envio inicial falhou, tenta o formato alternativo (com/sem 9)
      if (altChatId) {
        console.warn(`[WAHA] Primeiro envio de arquivo para ${chatId} falhou (${firstErrMsg}). Tentando formato alternativo do 9º dígito: ${altChatId}...`);
        try {
          const altBody = { ...body, chatId: altChatId };
          const altResponse = await this.client.post('/api/sendFile', altBody);
          console.log(`[WAHA] ✅ Sucesso no envio de arquivo para o número alternativo ${altChatId}!`);
          return altResponse.data;
        } catch (altError: any) {
          const altErrMsg = this.extractErrorMessage(altError);
          console.error(`[WAHA] Falha também no envio de arquivo para o número alternativo ${altChatId}: ${altErrMsg}`);
          const detailedError = new Error(`Erro WAHA ao enviar arquivo para ${chatId} (${firstErrMsg}) e alternativa ${altChatId} (${altErrMsg})`);
          (detailedError as any).response = error.response || altError.response;
          throw detailedError;
        }
      }

      console.error(`[WAHA] Erro ao enviar arquivo para ${chatId}:`, firstErrMsg);
      const detailedError = new Error(`Erro WAHA ao enviar arquivo para ${chatId}: ${firstErrMsg}`);
      (detailedError as any).response = error.response;
      throw detailedError;
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

  /**
   * Baixa arquivo de mídia (áudio, voz/PTT, imagem, documento) da WAHA ou de URL externa.
   * Trata URLs relativas, absolutas, autenticação da WAHA e fallback para download sob demanda.
   */
  async downloadMedia(
    mediaUrl?: string | null,
    payload?: any,
    session?: string
  ): Promise<{ buffer: Buffer; mimetype: string } | null> {
    let targetUrl = mediaUrl || payload?.media?.url;
    let expectedMime = payload?.media?.mimetype || payload?._data?.mimetype || 'audio/ogg';

    // Se a URL não veio diretamente no webhook, tenta solicitar o download sob demanda na WAHA
    if (!targetUrl && payload?.id && (payload.from || payload.to)) {
      const chatId = payload.from || payload.to;
      const sessionName = session || this.defaultSession;
      try {
        const res = await this.client.get(`/api/${sessionName}/chats/${chatId}/messages/${payload.id}`, {
          params: { downloadMedia: true }
        });
        if (res.data?.media?.url) {
          targetUrl = res.data.media.url;
          expectedMime = res.data.media.mimetype || expectedMime;
        }
      } catch (err: any) {
        console.warn(`[WAHA] Tentativa de baixar mensagem com mídia sob demanda falhou (${payload.id}):`, err.message);
      }
    }

    if (!targetUrl) {
      console.warn('[WAHA] Nenhuma URL de mídia disponível para download.');
      return null;
    }

    try {
      let requestPath = targetUrl;

      // Se for uma URL absoluta
      if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
        try {
          const parsed = new URL(targetUrl);
          // Se o path for da WAHA (/api/files/... ou /api/...) usamos o cliente configurado da WAHA
          if (parsed.pathname.startsWith('/api/files/') || parsed.pathname.startsWith('/api/')) {
            requestPath = parsed.pathname + parsed.search;
          } else {
            // URL externa arbitrária
            const externalRes = await axios.get(targetUrl, {
              responseType: 'arraybuffer',
              timeout: 20000
            });
            const buffer = Buffer.from(externalRes.data);
            const mimetype = externalRes.headers['content-type'] || expectedMime;
            return { buffer, mimetype };
          }
        } catch {
          requestPath = targetUrl;
        }
      }

      // Requisição direta via axios client da WAHA (com headers X-Api-Key)
      const res = await this.client.get(requestPath, {
        responseType: 'arraybuffer',
        timeout: 25000
      });

      const buffer = Buffer.from(res.data);
      const mimetype = (res.headers['content-type'] && res.headers['content-type'] !== 'application/octet-stream')
        ? res.headers['content-type']
        : expectedMime;

      return { buffer, mimetype };
    } catch (err: any) {
      console.error('[WAHA] Erro ao baixar arquivo de mídia:', this.extractErrorMessage(err));
      return null;
    }
  }
}

export const wahaClient = new WahaClient();
