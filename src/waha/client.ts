import axios, { AxiosInstance } from 'axios';
import { env, loadBotConfig } from '../config/index.js';
import { WahaSendTextRequest, WahaSessionStatus } from './types.js';
import { getAlternateBrazilianChatId, getAllChatIdAliases, lidMapper } from '../appointments/phone-utils.js';
export { getAlternateBrazilianChatId, getAllChatIdAliases, lidMapper };

export class WahaClient {
  private client!: AxiosInstance;
  private defaultSession!: string;
  private sessionPhoneMap: Map<string, string> = new Map();
  private sessionToPhoneMap: Map<string, string> = new Map();
  private sessionPushNameMap: Map<string, string> = new Map();
  private lastSessionSyncAt: number = 0;

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
      headers['Authorization'] = `Bearer ${apiKey.trim()}`;
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

      // Se falhou com reply_to, tenta enviar direto sem citação
      if (body.reply_to) {
        console.warn(`[WAHA] Envio com reply_to para ${chatId} falhou (${firstErrMsg}). Tentando sem citação...`);
        try {
          const noReplyBody = { ...body, reply_to: undefined };
          const noReplyRes = await this.client.post('/api/sendText', noReplyBody);
          return noReplyRes.data;
        } catch {
          // Continua para tentar aliases
        }
      }

      // Tenta todos os aliases conhecidos (LID, 8/9 dígitos)
      const allAliases = getAllChatIdAliases(chatId).filter(a => a !== chatId);
      for (const altId of allAliases) {
        console.warn(`[WAHA] Tentando envio para alias alternativo: ${altId}...`);
        try {
          // Tenta sem reply_to no alias para máxima compatibilidade
          const altBody = { ...body, chatId: altId, reply_to: undefined };
          const altResponse = await this.client.post('/api/sendText', altBody);
          console.log(`[WAHA] ✅ Sucesso no envio para o alias alternativo ${altId}!`);
          return altResponse.data;
        } catch {
          // continua para o próximo alias
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
   * Marca uma conversa como NÃO LIDA no WhatsApp.
   * Faz com que o WhatsApp exiba a bolinha verde / badge de mensagem pendente
   * para atendentes acessando pelo celular ou WhatsApp Web.
   * Endpoint oficial da WAHA: POST /api/{session}/chats/{chatId}/unread
   */
  async markChatUnread(chatId: string, session?: string): Promise<boolean> {
    if (chatId.includes('@g.us')) {
      return false;
    }

    const rawSession = session || this.defaultSession;
    const sessionName = (rawSession && rawSession !== '*') ? rawSession : (this.defaultSession || 'default');
    const cleanId = (typeof chatId === 'string' ? chatId : '').trim();
    if (!cleanId) return false;

    // Tentativa 1: Endpoint oficial WAHA POST /api/{session}/chats/{chatId}/unread
    try {
      await this.client.post(`/api/${sessionName}/chats/${cleanId}/unread`, {});
      console.log(`[WAHA] 🟢 Conversa ${cleanId} marcada como NÃO LIDA na sessão "${sessionName}".`);
      return true;
    } catch (err1: any) {
      // Tentativa 2: Com encodeURIComponent para proteção de rota contra caracteres especiais
      try {
        const encId = encodeURIComponent(cleanId);
        await this.client.post(`/api/${sessionName}/chats/${encId}/unread`, {});
        console.log(`[WAHA] 🟢 Conversa ${cleanId} marcada como NÃO LIDA (encoded) na sessão "${sessionName}".`);
        return true;
      } catch (err2: any) {
        // Tentativa 3: Rota alternativa global /api/chats/unread com body { session, chatId }
        try {
          await this.client.post('/api/chats/unread', { session: sessionName, chatId: cleanId });
          console.log(`[WAHA] 🟢 Conversa ${cleanId} marcada como NÃO LIDA via rota alternativa.`);
          return true;
        } catch {
          // Tentativa 4: Formato alternativo com/sem 9º dígito brasileiro
          const altId = getAlternateBrazilianChatId(cleanId);
          if (altId && altId !== cleanId) {
            try {
              await this.client.post(`/api/${sessionName}/chats/${altId}/unread`, {});
              console.log(`[WAHA] 🟢 Conversa marcada como NÃO LIDA com número alternativo ${altId}!`);
              return true;
            } catch {}
          }
        }
        console.warn(`[WAHA] Aviso ao marcar conversa como não lida (${cleanId}):`, this.extractErrorMessage(err1));
        return false;
      }
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
   * Lista todas as sessões ativas na WAHA e atualiza o mapa de telefones conectados
   */
  async listSessions(): Promise<any[]> {
    try {
      const response = await this.client.get('/api/sessions');
      const sessions = Array.isArray(response.data) ? response.data : [];
      
      // Atualiza o mapa de telefones conectados por sessão
      for (const s of sessions) {
        if (!s || !s.name) continue;
        if (s.me?.pushName) {
          this.sessionPushNameMap.set(s.name, s.me.pushName);
        }

        let phoneClean = '';
        if (s.me?.id) {
          const rawId = String(s.me.id);
          phoneClean = rawId.replace(/:\d+@/, '@').replace(/\D/g, '');
        }

        // Se a sessão não tiver me.id (ex: conectando), tenta extrair telefone do nome da sessão (padrão Chatwoot: id_inbox_telefone)
        if (!phoneClean || phoneClean.length < 8) {
          const parts = s.name.split('_');
          const lastPart = parts[parts.length - 1];
          if (lastPart && /^\d{10,13}$/.test(lastPart)) {
            phoneClean = lastPart;
          }
        }

        if (phoneClean && phoneClean.length >= 8) {
          this.sessionPhoneMap.set(phoneClean, s.name);
          this.sessionToPhoneMap.set(s.name, phoneClean);
          (s as any).phoneNumber = phoneClean;
        }

        (s as any).pushName = s.me?.pushName || '';
      }
      this.lastSessionSyncAt = Date.now();
      return sessions;
    } catch (error: any) {
      return [];
    }
  }

  /**
   * Obtém o PushName (nome amigável no WhatsApp) associado à sessão da WAHA
   */
  getPushNameBySession(sessionName: string): string | undefined {
    if (!sessionName) return undefined;
    return this.sessionPushNameMap.get(sessionName);
  }

  /**
   * Obtém o número de telefone do chip conectado na sessão da WAHA
   */
  getPhoneNumberBySession(sessionName: string): string | undefined {
    if (!sessionName) return undefined;
    if (this.sessionToPhoneMap.has(sessionName)) {
      return this.sessionToPhoneMap.get(sessionName);
    }
    // Fallback: se o nome da sessão contém o telefone no final (ex: 6_14_5587991252580)
    const parts = sessionName.split('_');
    const lastPart = parts[parts.length - 1];
    if (lastPart && /^\d{10,13}$/.test(lastPart)) {
      return lastPart;
    }
    return undefined;
  }

  /**
   * Sincroniza ativamente o cache de sessões e telefones conectados
   */
  async syncSessionsCache(): Promise<void> {
    await this.listSessions();
  }

  /**
   * Encontra o nome da sessão da WAHA a partir do número de telefone de destino (payload.to)
   */
  getSessionByPhoneNumber(rawPhone: string): string | undefined {
    if (!rawPhone) return undefined;
    const clean = rawPhone.replace(/:\d+@/, '@').replace(/\D/g, '');
    if (clean.length < 8) return undefined;

    // 1. Match exato nos dígitos
    if (this.sessionPhoneMap.has(clean)) {
      return this.sessionPhoneMap.get(clean);
    }

    // 2. Match com/sem 9º dígito ou DDI (55)
    for (const [phoneDigits, session] of this.sessionPhoneMap.entries()) {
      if (clean === phoneDigits) return session;
      if (clean.length >= 10 && phoneDigits.length >= 10) {
        if (clean.endsWith(phoneDigits) || phoneDigits.endsWith(clean)) {
          return session;
        }
        const cWithout9 = clean.length === 13 ? clean.slice(0, 4) + clean.slice(5) : clean;
        const pWithout9 = phoneDigits.length === 13 ? phoneDigits.slice(0, 4) + phoneDigits.slice(5) : phoneDigits;
        if (cWithout9 === pWithout9 || cWithout9.endsWith(pWithout9) || pWithout9.endsWith(cWithout9)) {
          return session;
        }
      }
    }
    return undefined;
  }

  /**
   * Obtém lista de contatos salvos da sessão na WAHA
   */
  async getContacts(session?: string): Promise<any[]> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    try {
      const res = await this.client.get('/api/contacts/all', { params: { session: sessionName } });
      if (Array.isArray(res.data)) return res.data;
    } catch (err1: any) {
      try {
        const res2 = await this.client.get('/api/contacts', { params: { session: sessionName } });
        if (Array.isArray(res2.data)) return res2.data;
      } catch (err2: any) {
        console.warn(`[WAHA] Erro ao buscar contatos (${sessionName}):`, this.extractErrorMessage(err2));
      }
    }
    return [];
  }

  /**
   * Obtém lista de conversas/chats da sessão na WAHA
   */
  async getChats(session?: string): Promise<any[]> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    try {
      const res = await this.client.get(`/api/${sessionName}/chats`);
      if (Array.isArray(res.data)) return res.data;
    } catch (err: any) {
      console.warn(`[WAHA] Erro ao buscar chats (${sessionName}):`, this.extractErrorMessage(err));
    }
    return [];
  }

  /**
   * Obtém detalhes de um contato (nome, pushname) da WAHA
   */
  async getContact(contactId: string, session?: string): Promise<any | null> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    const cleanId = (typeof contactId === 'string' ? contactId : '').trim();
    if (!cleanId) return null;

    try {
      const res = await this.client.get(`/api/${sessionName}/contacts/${cleanId}`, { timeout: 3000 });
      return res.data || null;
    } catch {
      try {
        const encId = encodeURIComponent(cleanId);
        const res = await this.client.get(`/api/${sessionName}/contacts/${encId}`, { timeout: 3000 });
        return res.data || null;
      } catch {
        return null;
      }
    }
  }

  /**
   * Sincroniza todos os mapeamentos LID <-> Telefone da sessão via endpoint oficial WAHA:
   * GET /api/{session}/lids?limit=500
   */
  async syncSessionLids(session?: string): Promise<{ lid: string; pn: string }[]> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    try {
      const res = await this.client.get(`/api/${sessionName}/lids`, {
        params: { limit: 500 },
        timeout: 4000
      });
      if (Array.isArray(res.data) && res.data.length > 0) {
        let count = 0;
        for (const item of res.data) {
          if (item && item.lid && item.pn) {
            lidMapper.register(item.lid, item.pn);
            count++;
          }
        }
        if (count > 0) {
          console.log(`[WAHA] 🔄 Sincronizados ${count} mapeamentos LID <-> Telefone da sessão "${sessionName}".`);
        }
        return res.data;
      }
    } catch (err: any) {
      // Ignora silenciosamente se o endpoint de lids não estiver disponível na versão
    }
    return [];
  }

  /**
   * Resolve um identificador @lid para o telefone real (@c.us) utilizando a API oficial de LIDs da WAHA:
   * 1. Cache do lidMapper
   * 2. GET /api/{session}/lids/{lid}
   * 3. Sincronização geral GET /api/{session}/lids
   * 4. GET /api/contacts?contactId={lid}
   * 5. GET /api/{session}/contacts/{lid}
   * 6. Busca em lista de contatos (/api/contacts/all)
   */
  async resolveLidToPhone(lid: string, session?: string): Promise<string | null> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    let cleanId = (typeof lid === 'string' ? lid : '').trim();
    if (!cleanId) return null;

    if (cleanId.includes(':') && cleanId.includes('@')) {
      cleanId = cleanId.replace(/:\d+@/, '@');
    }

    if (!cleanId.endsWith('@lid') && !cleanId.includes('@')) {
      cleanId = `${cleanId}@lid`;
    }

    // 1. Verifica cache local do lidMapper
    const cached = lidMapper.getPhone(cleanId);
    if (cached) return cached;

    const lidDigits = cleanId.replace(/\D/g, '');
    if (lidDigits) {
      const cachedDigits = lidMapper.getPhone(`${lidDigits}@lid`);
      if (cachedDigits) return cachedDigits;
    }

    const encId = encodeURIComponent(cleanId);

    // 2. Endpoint nativo oficial WAHA: GET /api/{session}/lids/{lid}
    try {
      const res = await this.client.get(`/api/${sessionName}/lids/${encId}`, { timeout: 3000 });
      if (res.data?.pn) {
        const pnStr = String(res.data.pn);
        const resolved = pnStr.endsWith('@c.us') ? pnStr : `${pnStr.replace(/\D/g, '')}@c.us`;
        lidMapper.register(cleanId, resolved);
        console.log(`[WAHA] 🔍 Resolvido LID ${cleanId} -> ${resolved} via /api/${sessionName}/lids/{lid}`);
        return resolved;
      }
    } catch {
      // continua
    }

    // 3. Tentativa com dígitos puros
    try {
      const res = await this.client.get(`/api/${sessionName}/lids/${lidDigits}`, { timeout: 3000 });
      if (res.data?.pn) {
        const pnStr = String(res.data.pn);
        const resolved = pnStr.endsWith('@c.us') ? pnStr : `${pnStr.replace(/\D/g, '')}@c.us`;
        lidMapper.register(cleanId, resolved);
        console.log(`[WAHA] 🔍 Resolvido LID ${cleanId} -> ${resolved} via /api/${sessionName}/lids/${lidDigits}`);
        return resolved;
      }
    } catch {
      // continua
    }

    // 4. Sincroniza a tabela completa de LIDs da sessão
    try {
      await this.syncSessionLids(sessionName);
      const afterSync = lidMapper.getPhone(cleanId) || (lidDigits ? lidMapper.getPhone(`${lidDigits}@lid`) : undefined);
      if (afterSync) {
        console.log(`[WAHA] 🔍 Recuperado ${cleanId} -> ${afterSync} após syncSessionLids`);
        return afterSync;
      }
    } catch {
      // continua
    }

    // 5. Endpoint de contatos: GET /api/contacts?contactId={cleanId}&session={session}
    try {
      const res = await this.client.get('/api/contacts', {
        params: { contactId: cleanId, session: sessionName },
        timeout: 3000
      });
      const data = res.data;
      if (data) {
        const cand = data.number || data.id?.user || (typeof data.id === 'string' && data.id.endsWith('@c.us') ? data.id : null) || data.pn;
        if (cand) {
          const digits = String(cand).replace(/\D/g, '');
          if (digits.length >= 10 && digits.length <= 13) {
            const resolved = `${digits.startsWith('55') ? digits : '55' + digits}@c.us`;
            lidMapper.register(cleanId, resolved);
            return resolved;
          }
        }
      }
    } catch {
      // continua
    }

    // 6. Endpoint de contatos por path: GET /api/{session}/contacts/{encId}
    try {
      const res = await this.client.get(`/api/${sessionName}/contacts/${encId}`, { timeout: 3000 });
      const data = res.data;
      if (data) {
        const cand = data.number || data.id?.user || (typeof data.id === 'string' && data.id.endsWith('@c.us') ? data.id : null) || data.pn;
        if (cand) {
          const digits = String(cand).replace(/\D/g, '');
          if (digits.length >= 10 && digits.length <= 13) {
            const resolved = `${digits.startsWith('55') ? digits : '55' + digits}@c.us`;
            lidMapper.register(cleanId, resolved);
            return resolved;
          }
        }
      }
    } catch {
      // continua
    }

    // 7. Busca iterativa em todos os contatos da sessão
    try {
      const contacts = await this.getContacts(sessionName);
      for (const c of contacts) {
        if (!c) continue;
        const cLid = (c.lid || (typeof c.id === 'string' && c.id.endsWith('@lid') ? c.id : ''));
        if (cLid && (cLid === cleanId || cLid.replace(/\D/g, '') === lidDigits)) {
          const cand = c.number || (typeof c.id === 'string' && c.id.endsWith('@c.us') ? c.id : null);
          if (cand) {
            const digits = String(cand).replace(/\D/g, '');
            if (digits.length >= 10 && digits.length <= 13) {
              const resolved = `${digits.startsWith('55') ? digits : '55' + digits}@c.us`;
              lidMapper.register(cleanId, resolved);
              console.log(`[WAHA] 🔍 Encontrado contato para LID ${cleanId}: ${resolved}`);
              return resolved;
            }
          }
        }
      }
    } catch {
      // continua
    }

    return null;
  }

  /**
   * Resolve um número de telefone (@c.us) para seu identificador @lid correspondente:
   * 1. Cache do lidMapper
   * 2. GET /api/{session}/lids/pn/{phoneNumber}
   * 3. Variação com/sem 9º dígito brasileiro
   */
  async resolvePhoneToLid(phone: string, session?: string): Promise<string | null> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    const cleanDigits = String(phone || '').replace(/\D/g, '');
    if (cleanDigits.length < 8) return null;

    const fullCUs = `${cleanDigits.startsWith('55') ? cleanDigits : '55' + cleanDigits}@c.us`;

    // 1. Cache do lidMapper
    const cached = lidMapper.getLid(fullCUs) || lidMapper.getLid(cleanDigits);
    if (cached) return cached;

    // 2. Query WAHA GET /api/{session}/lids/pn/{phoneNumber}
    const candidates = [
      cleanDigits,
      fullCUs,
      cleanDigits.startsWith('55') ? cleanDigits.slice(2) : cleanDigits,
      cleanDigits.startsWith('55') ? cleanDigits : `55${cleanDigits}`
    ];

    // Variação do 9º dígito
    const alt = getAlternateBrazilianChatId(fullCUs);
    if (alt) {
      candidates.push(alt.replace(/\D/g, ''));
      candidates.push(alt);
    }

    for (const cand of candidates) {
      try {
        const res = await this.client.get(`/api/${sessionName}/lids/pn/${encodeURIComponent(cand)}`, { timeout: 3000 });
        if (res.data?.lid) {
          const lidStr = String(res.data.lid);
          const resolvedLid = lidStr.endsWith('@lid') ? lidStr : `${lidStr.replace(/\D/g, '')}@lid`;
          lidMapper.register(resolvedLid, fullCUs);
          console.log(`[WAHA] 🔍 Resolvido Telefone ${cand} -> LID ${resolvedLid} via /api/${sessionName}/lids/pn/`);
          return resolvedLid;
        }
      } catch {
        // continua
      }
    }

    return null;
  }

  /**
   * Obtém mensagens recentes de um chat ou grupo para captura de notifyName / pushName
   */
  async getChatMessages(chatId: string, limit: number = 100, session?: string): Promise<any[]> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    const cleanId = (typeof chatId === 'string' ? chatId : '').trim();
    if (!cleanId) return [];

    try {
      const res = await this.client.get(`/api/${sessionName}/chats/${cleanId}/messages`, { params: { limit }, timeout: 5000 });
      return Array.isArray(res.data) ? res.data : [];
    } catch {
      try {
        const encId = encodeURIComponent(cleanId);
        const res = await this.client.get(`/api/${sessionName}/chats/${encId}/messages`, { params: { limit }, timeout: 5000 });
        return Array.isArray(res.data) ? res.data : [];
      } catch {
        return [];
      }
    }
  }

  /**
   * Helper interno para normalizar dados retornados pela WAHA (Array ou Object com IDs)
   */
  private normalizeList(data: any): any[] {
    if (!data) return [];
    if (Array.isArray(data)) return data;
    if (typeof data === 'object') {
      if (Array.isArray(data.data)) return data.data;
      if (Array.isArray(data.groups)) return data.groups;
      if (Array.isArray(data.chats)) return data.chats;
      if (Array.isArray(data.contacts)) return data.contacts;
      if (Array.isArray(data.participants)) return data.participants;
      if (Array.isArray(data.result)) return data.result;
      const values = Object.values(data);
      if (values.length > 0 && typeof values[0] === 'object') {
        return values;
      }
    }
    return [];
  }

  /**
   * Obtém lista de grupos da sessão na WAHA (com suporte a todos os engines: NOWEB, WEBJS, GOWS, WPP)
   */
  async getGroups(session?: string): Promise<any[]> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');

    // Tentativa 1: /api/{session}/groups com limit
    try {
      const res = await this.client.get(`/api/${sessionName}/groups`, { params: { limit: 500 } });
      const groups = this.normalizeList(res.data);
      if (groups.length > 0) return groups;
    } catch (err1: any) {
      // continua para tentativa 2
    }

    // Tentativa 2: /api/{session}/groups sem query params
    try {
      const res = await this.client.get(`/api/${sessionName}/groups`);
      const groups = this.normalizeList(res.data);
      if (groups.length > 0) return groups;
    } catch (err2: any) {
      // continua para tentativa 3
    }

    // Tentativa 3: Se NOWEB tiver reset de cache de grupos (/api/{session}/groups/refresh)
    try {
      await this.client.post(`/api/${sessionName}/groups/refresh`).catch(() => null);
      const res = await this.client.get(`/api/${sessionName}/groups`);
      const groups = this.normalizeList(res.data);
      if (groups.length > 0) return groups;
    } catch (err3: any) {
      // continua
    }

    // Tentativa 4 (INFALÍVEL): Extrair grupos das conversas gerais (/api/{session}/chats)
    try {
      const chatsRes = await this.client.get(`/api/${sessionName}/chats`, { params: { limit: 500 } });
      const chats = this.normalizeList(chatsRes.data);
      const groupChats = chats.filter((c: any) => {
        const id = (typeof c.id === 'string' ? c.id : (c.id?._serialized || c.JID || c.jid || '')).toLowerCase();
        return c.isGroup === true || id.includes('@g.us') || c.id?.server === 'g.us';
      });
      if (groupChats.length > 0) {
        console.log(`[WAHA] ${groupChats.length} grupos recuperados via lista de chats da sessão "${sessionName}"`);
        return groupChats;
      }
    } catch (err4: any) {
      console.warn(`[WAHA] Erro ao buscar chats de grupo (${sessionName}):`, this.extractErrorMessage(err4));
    }

    return [];
  }

  /**
   * Obtém participantes de um grupo específico (nativo via WAHA REST API)
   * Endpoint oficial: GET /api/{session}/groups/{groupId}/participants
   */
  async getGroupParticipants(groupId: string, session?: string): Promise<any[]> {
    const sessionName = (session && session !== '*') ? session : (this.defaultSession || 'default');
    const cleanId = (typeof groupId === 'string' ? groupId : '').trim();
    if (!cleanId) return [];

    console.log(`[WAHA] Buscando membros do grupo "${cleanId}" na sessão "${sessionName}"...`);

    const extractParticipants = (data: any): any[] => {
      if (!data) return [];
      if (Array.isArray(data) && data.length > 0) return data;
      if (Array.isArray(data.participants) && data.participants.length > 0) return data.participants;
      if (Array.isArray(data.groupMetadata?.participants) && data.groupMetadata.participants.length > 0) return data.groupMetadata.participants;
      if (typeof data.participants === 'object' && data.participants !== null) {
        const v = Object.values(data.participants);
        if (v.length > 0) return v;
      }
      if (typeof data.groupMetadata?.participants === 'object' && data.groupMetadata.participants !== null) {
        const v = Object.values(data.groupMetadata.participants);
        if (v.length > 0) return v;
      }
      return [];
    };

    // Tentativa 1: Endpoint v2 que resolve 'pn' (número de telefone real dos membros)
    try {
      const res = await this.client.get(`/api/${sessionName}/groups/${cleanId}/participants/v2`, { timeout: 15000 });
      const list = extractParticipants(res.data);
      if (list.length > 0) {
        console.log(`[WAHA] ✅ ${list.length} participantes retornados pelo endpoint v2 para ${cleanId}`);
        return list;
      }
    } catch {}

    // Tentativa 2: Endpoint nativo oficial v1 GET /api/{session}/groups/{groupId}/participants
    try {
      const res = await this.client.get(`/api/${sessionName}/groups/${cleanId}/participants`, { timeout: 15000 });
      const list = extractParticipants(res.data);
      if (list.length > 0) {
        console.log(`[WAHA] ✅ ${list.length} participantes retornados pelo endpoint oficial v1 para ${cleanId}`);
        return list;
      }
    } catch (err1: any) {
      console.warn(`[WAHA] Endpoint oficial (${cleanId}) respondeu:`, err1?.response?.status, this.extractErrorMessage(err1));
    }

    // Tentativa 2: Com encodeURIComponent do groupId (necessário em alguns proxies reversos/Nginx)
    try {
      const encId = encodeURIComponent(cleanId);
      const res = await this.client.get(`/api/${sessionName}/groups/${encId}/participants`, { timeout: 15000 });
      const list = extractParticipants(res.data);
      if (list.length > 0) {
        console.log(`[WAHA] ✅ ${list.length} participantes retornados com encoded ID para ${cleanId}`);
        return list;
      }
    } catch (err2: any) {
      // continua
    }

    // Tentativa 3: GET /api/{session}/groups/{groupId} (metadados completos com array de participants)
    try {
      const res = await this.client.get(`/api/${sessionName}/groups/${cleanId}`, { timeout: 15000 });
      const list = extractParticipants(res.data);
      if (list.length > 0) {
        console.log(`[WAHA] ✅ ${list.length} participantes encontrados em getGroup para ${cleanId}`);
        return list;
      }
    } catch (err3: any) {
      // continua
    }

    // Tentativa 4: Fallback por mensagens recentes do grupo (/chats/{id}/messages)
    try {
      const res = await this.client.get(`/api/${sessionName}/chats/${cleanId}/messages`, { params: { limit: 100 }, timeout: 10000 });
      const messages = Array.isArray(res.data) ? res.data : [];
      if (messages.length > 0) {
        const participantMap = new Map<string, any>();
        for (const m of messages) {
          const sender = m.author || m.participant || m._data?.author || m._data?.participant || (m.from && !m.from.includes('@g.us') ? m.from : '');
          if (sender && typeof sender === 'string' && !sender.includes('@broadcast') && !sender.includes('@g.us')) {
            if (!participantMap.has(sender)) {
              participantMap.set(sender, {
                id: sender,
                name: m._data?.notifyName || m.notifyName || m._data?.pushName || m.pushName || ''
              });
            }
          }
        }
        const senders = Array.from(participantMap.values());
        if (senders.length > 0) {
          console.log(`[WAHA] ✅ ${senders.length} participantes ativos obtidos via mensagens recentes para ${cleanId}`);
          return senders;
        }
      }
    } catch (err4: any) {
      // continua
    }

    console.warn(`[WAHA] ⚠️ Não foi possível obter participantes para o grupo: ${cleanId}`);
    return [];
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
    let targetUrl = webhookUrl;
    if (sessionName && sessionName !== '*' && !targetUrl.endsWith('/' + sessionName)) {
      targetUrl = `${targetUrl.replace(/\/$/, '')}/${encodeURIComponent(sessionName)}`;
    }
    const webhookConfig = {
      url: targetUrl,
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
