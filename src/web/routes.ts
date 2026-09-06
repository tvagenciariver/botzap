import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import { orchestrator } from '../orchestrator/engine.js';
import { loadBotConfig, saveBotConfig, updateEnvFile, env } from '../config/index.js';
import { memoryStore } from '../gemini/memory.js';
import { geminiService } from '../gemini/client.js';
import { openAIService } from '../openai/client.js';
import { wahaClient } from '../waha/client.js';
import { WahaWebhookEvent } from '../waha/types.js';
import { checkBusinessHoursStatus } from '../orchestrator/schedule-helper.js';

export const apiRouter = Router();

// Sessões de autenticação ativas (Tokens de sessão em memória)
const activeSessions = new Set<string>();

/**
 * Middleware de Autenticação para rotas protegidas da API
 */
const requireAuth = (req: Request, res: Response, next: () => void) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado. Faça login para acessar o sistema.', unauthorized: true });
  }

  const token = authHeader.split(' ')[1];
  if (!token || !activeSessions.has(token)) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.', unauthorized: true });
  }

  next();
};

/**
 * Endpoint de Login (Usuário e Senha)
 */
apiRouter.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  const config = loadBotConfig();

  const expectedUser = config.adminUser || env.adminUser || 'admin';
  const expectedPass = config.adminPassword || env.adminPassword || 'File@152341';

  if (username === expectedUser && password === expectedPass) {
    const token = crypto.randomBytes(32).toString('hex');
    activeSessions.add(token);
    return res.json({
      success: true,
      token,
      user: {
        username: expectedUser
      }
    });
  }

  return res.status(401).json({
    success: false,
    error: 'Usuário ou senha incorretos.'
  });
});

/**
 * Endpoint de Logout
 */
apiRouter.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    activeSessions.delete(token);
  }
  return res.json({ success: true, message: 'Logout realizado com sucesso.' });
});

/**
 * Endpoint para validar sessão atual
 */
apiRouter.get('/api/auth/me', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token && activeSessions.has(token)) {
      const config = loadBotConfig();
      return res.json({
        authenticated: true,
        user: {
          username: config.adminUser || env.adminUser || 'admin'
        }
      });
    }
  }
  return res.status(401).json({ authenticated: false });
});

/**
 * 1. Webhook principal da WAHA
 */
apiRouter.post('/webhook/waha', async (req: Request, res: Response) => {
  const event: WahaWebhookEvent = req.body;

  // Responde imediatamente à WAHA com status 200
  res.status(200).json({ status: 'received' });

  // Processa de forma assíncrona
  try {
    if (event.event === 'message' || event.event === 'message.any') {
      if (event.payload) {
        await orchestrator.processIncomingWahaMessage(event.payload, event.session || env.wahaSession);
      }
    } else {
      console.log(`[WAHA Webhook] Evento ignorado: ${event.event}`);
    }
  } catch (error: any) {
    console.error('[WAHA Webhook] Erro ao processar webhook:', error.message);
  }
});

/**
 * 2. Webhook do Chatwoot (para sincronização inteligente de status de atendimento)
 */
apiRouter.post('/webhook/chatwoot', async (req: Request, res: Response) => {
  res.status(200).json({ status: 'ok' });

  const data = req.body;
  try {
    const eventType = data.event;
    // Extrai o telefone do contato no formato do WhatsApp se disponível
    const phoneNumber = data.conversation?.meta?.sender?.phone_number || data.sender?.phone_number;
    
    if (phoneNumber) {
      const cleanPhone = phoneNumber.replace(/\D/g, '');
      const chatId = `${cleanPhone}@c.us`;

      // Se conversa foi resolvida pelo atendente humano no Chatwoot, reativa o bot para o próximo contato!
      if (eventType === 'conversation_resolved' || (eventType === 'conversation_status_changed' && data.status === 'resolved')) {
        memoryStore.resumeChat(chatId);
        orchestrator.addLog({
          type: 'info',
          chatId,
          message: 'Conversa resolvida no Chatwoot. Bot reativado para este contato.'
        });
      }

      // Se conversa foi reaberta ou atribuída a um atendente no Chatwoot, pausa o bot
      if (eventType === 'conversation_opened' && data.assignee_id) {
        const config = loadBotConfig();
        const pauseMinutes = config.pauseDurationMinutes || (config.pauseDurationHours ? config.pauseDurationHours * 60 : 360);
        const pauseHours = config.pauseDurationHours || (pauseMinutes / 60);
        memoryStore.pauseChat(chatId, pauseMinutes);
        orchestrator.addLog({
          type: 'info',
          chatId,
          message: `Atendente atribuído no Chatwoot. Bot pausado para ${chatId} por ${pauseHours} horas.`
        });
      }

      // Se um atendente humano digitou no Chatwoot
      if (eventType === 'message_created' && data.message_type === 'outgoing' && data.sender?.type === 'User') {
        const config = loadBotConfig();
        const pauseMinutes = config.pauseDurationMinutes || (config.pauseDurationHours ? config.pauseDurationHours * 60 : 360);
        const pauseHours = config.pauseDurationHours || (pauseMinutes / 60);
        memoryStore.pauseChat(chatId, pauseMinutes);
        orchestrator.addLog({
          type: 'info',
          chatId,
          message: `Atendente humano (${data.sender?.name || 'Agente'}) respondeu no Chatwoot. Bot pausado para ${chatId} por ${pauseHours} horas.`
        });
      }
    }
  } catch (err: any) {
    console.error('[Chatwoot Webhook] Erro ao processar:', err.message);
  }
});

/**
 * 3. Status geral do sistema e serviços
 */
apiRouter.get('/api/status', requireAuth, async (_req: Request, res: Response) => {
  let wahaOnline = false;
  let sessionStatus = null;

  try {
    sessionStatus = await wahaClient.getSessionStatus(env.wahaSession);
    wahaOnline = sessionStatus !== null;
  } catch (err) {
    wahaOnline = false;
  }

  const config = loadBotConfig();
  const provider = config.llmProvider || 'gemini';

  res.json({
    orchestrator: 'online',
    timestamp: new Date().toISOString(),
    waha: {
      baseUrl: env.wahaBaseUrl,
      session: env.wahaSession,
      online: wahaOnline,
      status: sessionStatus?.status || 'UNKNOWN'
    },
    gemini: {
      configured: geminiService.isConfigured(),
      model: env.geminiModel
    },
    openai: {
      configured: openAIService.isConfigured(),
      model: config.openaiModel || 'gpt-4o-mini'
    },
    activeLlm: {
      provider,
      configured: provider === 'openai' ? openAIService.isConfigured() : geminiService.isConfigured(),
      model: provider === 'openai' ? (config.openaiModel || 'gpt-4o-mini') : (config.model || 'gemini-flash-lite-latest')
    },
    businessHours: {
      enabled: !!config.businessHours?.enabled,
      isOpen: checkBusinessHoursStatus(config).isOpen,
      reason: checkBusinessHoursStatus(config).reason,
      currentTime: checkBusinessHoursStatus(config).currentTime,
      currentDay: checkBusinessHoursStatus(config).currentDayName,
      timezone: checkBusinessHoursStatus(config).timezone
    }
  });
});

/**
 * 3.1 Obter status e configuração de Horário Comercial
 */
apiRouter.get('/api/business-hours/status', requireAuth, (_req: Request, res: Response) => {
  const config = loadBotConfig();
  const status = checkBusinessHoursStatus(config);
  res.json({
    businessHours: config.businessHours,
    status
  });
});

/**
 * 3.2 Salvar configuração de Horário Comercial
 */
apiRouter.post('/api/business-hours', requireAuth, (req: Request, res: Response) => {
  try {
    const { businessHours } = req.body;
    if (!businessHours) {
      return res.status(400).json({ error: 'Configuração de horário ausente.' });
    }
    const updated = saveBotConfig({ businessHours });
    const status = checkBusinessHoursStatus(updated);
    res.json({ success: true, message: 'Horário comercial salvo com sucesso!', businessHours: updated.businessHours, status });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 4. Obter configurações do bot
 */
apiRouter.get('/api/config', requireAuth, (_req: Request, res: Response) => {
  const config = loadBotConfig();
  const { adminPassword: _hiddenPass, ...safeConfig } = config;

  res.json({
    config: {
      ...safeConfig,
      geminiApiKey: safeConfig.geminiApiKey ? '••••••••' + safeConfig.geminiApiKey.slice(-4) : '',
      openaiApiKey: safeConfig.openaiApiKey ? '••••••••' + safeConfig.openaiApiKey.slice(-4) : ''
    },
    env: {
      port: env.port,
      wahaBaseUrl: env.wahaBaseUrl,
      wahaSession: env.wahaSession,
      geminiConfigured: geminiService.isConfigured(),
      openaiConfigured: openAIService.isConfigured(),
      llmProvider: env.llmProvider,
      webhookPublicUrl: env.webhookPublicUrl
    }
  });
});

/**
 * 5. Salvar configurações do bot
 */
apiRouter.post('/api/config', requireAuth, (req: Request, res: Response) => {
  try {
    const { apiKey, openaiApiKey, adminPassword, ...botSettings } = req.body;

    if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
      const cleanKey = apiKey.trim();
      geminiService.updateApiKey(cleanKey);
      updateEnvFile('GEMINI_API_KEY', cleanKey);
      botSettings.geminiApiKey = cleanKey;
    }

    if (openaiApiKey && typeof openaiApiKey === 'string' && openaiApiKey.trim() !== '') {
      const cleanOpenAIKey = openaiApiKey.trim();
      openAIService.updateApiKey(cleanOpenAIKey);
      updateEnvFile('OPENAI_API_KEY', cleanOpenAIKey);
      botSettings.openaiApiKey = cleanOpenAIKey;
    }

    if (botSettings.openaiModel && typeof botSettings.openaiModel === 'string') {
      updateEnvFile('OPENAI_MODEL', botSettings.openaiModel.trim());
    }

    if (botSettings.llmProvider && (botSettings.llmProvider === 'gemini' || botSettings.llmProvider === 'openai')) {
      updateEnvFile('LLM_PROVIDER', botSettings.llmProvider);
    }

    if (adminPassword && typeof adminPassword === 'string' && adminPassword.trim() !== '') {
      botSettings.adminPassword = adminPassword.trim();
      updateEnvFile('ADMIN_PASSWORD', adminPassword.trim());
    }

    if (botSettings.adminUser && typeof botSettings.adminUser === 'string') {
      botSettings.adminUser = botSettings.adminUser.trim();
      updateEnvFile('ADMIN_USER', botSettings.adminUser);
    }

    if (botSettings.wahaBaseUrl) {
      updateEnvFile('WAHA_BASE_URL', botSettings.wahaBaseUrl.trim());
    }
    if (botSettings.wahaApiKey !== undefined) {
      updateEnvFile('WAHA_API_KEY', botSettings.wahaApiKey.trim());
    }
    if (botSettings.wahaSession) {
      updateEnvFile('WAHA_SESSION', botSettings.wahaSession.trim());
    }
    if (botSettings.webhookPublicUrl) {
      updateEnvFile('WEBHOOK_PUBLIC_URL', botSettings.webhookPublicUrl.trim());
    }

    const updated = saveBotConfig(botSettings);
    wahaClient.reloadConfig();
    const { adminPassword: _hiddenPass, ...safeUpdated } = updated;
    res.json({ success: true, config: safeUpdated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 5.1 Testar chave da OpenAI
 */
apiRouter.post('/api/openai/test-connection', requireAuth, async (req: Request, res: Response) => {
  try {
    const { apiKey } = req.body;
    const result = await openAIService.testConnection(apiKey);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Erro ao testar conexão com a OpenAI: ${err.message}` });
  }
});

/**
 * 6. Testar conexão com a WAHA API
 */
apiRouter.post('/api/waha/test-connection', requireAuth, async (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey, session } = req.body;
    if (baseUrl) {
      wahaClient.updateConfig(baseUrl, apiKey, session);
    }
    const result = await wahaClient.testConnection(session);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Erro ao testar conexão: ${err.message}` });
  }
});

/**
 * 7. Salvar dados de conexão com a WAHA
 */
apiRouter.post('/api/waha/save-connection', requireAuth, (req: Request, res: Response) => {
  try {
    const { baseUrl, apiKey, session, webhookPublicUrl } = req.body;
    const toUpdate: Record<string, any> = {};

    if (baseUrl !== undefined) {
      const cleanUrl = baseUrl.trim().replace(/\/$/, '');
      toUpdate.wahaBaseUrl = cleanUrl;
      updateEnvFile('WAHA_BASE_URL', cleanUrl);
    }
    if (apiKey !== undefined) {
      const cleanKey = apiKey.trim();
      toUpdate.wahaApiKey = cleanKey;
      updateEnvFile('WAHA_API_KEY', cleanKey);
    }
    if (session !== undefined) {
      const cleanSession = session.trim();
      toUpdate.wahaSession = cleanSession;
      updateEnvFile('WAHA_SESSION', cleanSession);
    }
    if (webhookPublicUrl !== undefined) {
      const cleanHook = webhookPublicUrl.trim().replace(/(\/webhook\/(waha|chatwoot))+/gi, '').replace(/\/$/, '');
      toUpdate.webhookPublicUrl = cleanHook;
      updateEnvFile('WEBHOOK_PUBLIC_URL', cleanHook);
    }

    const updated = saveBotConfig(toUpdate);
    wahaClient.reloadConfig();
    res.json({ success: true, message: 'Dados da WAHA salvos com sucesso!', config: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Erro ao salvar: ${err.message}` });
  }
});

/**
 * 8. Auto-registro de Webhook na WAHA
 */
apiRouter.post('/api/waha/setup-webhook', requireAuth, async (req: Request, res: Response) => {
  try {
    const rawTarget = req.body.url || env.webhookPublicUrl;
    const baseTarget = (rawTarget || '').replace(/(\/webhook\/(waha|chatwoot))+/gi, '').replace(/\/$/, '');
    const targetUrl = `${baseTarget}/webhook/waha`;
    const session = req.body.session || env.wahaSession;
    const result = await wahaClient.configureWebhook(targetUrl, session);
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ success: false, message: `Erro ao registrar webhook: ${err.message}` });
  }
});

/**
 * 7. Listar conversas ativas
 */
apiRouter.get('/api/chats', requireAuth, (_req: Request, res: Response) => {
  const chats = memoryStore.listActiveChats();
  res.json({ chats });
});

/**
 * 8. Pausar bot para um contato específico
 */
apiRouter.post('/api/chats/:chatId/pause', requireAuth, (req: Request, res: Response) => {
  const { chatId } = req.params;
  const minutes = parseInt(req.body.minutes || '60', 10);
  memoryStore.pauseChat(chatId, minutes);
  orchestrator.addLog({
    type: 'info',
    chatId,
    message: `Bot pausado manualmente via painel por ${minutes} minutos.`
  });
  res.json({ success: true, chatId, isPaused: true, minutes });
});

/**
 * 9. Reativar bot para um contato específico
 */
apiRouter.post('/api/chats/:chatId/resume', requireAuth, (req: Request, res: Response) => {
  const { chatId } = req.params;
  memoryStore.resumeChat(chatId);
  orchestrator.addLog({
    type: 'info',
    chatId,
    message: 'Bot reativado manualmente via painel.'
  });
  res.json({ success: true, chatId, isPaused: false });
});

/**
 * 10. Limpar histórico de um contato
 */
apiRouter.post('/api/chats/:chatId/clear', requireAuth, (req: Request, res: Response) => {
  const { chatId } = req.params;
  memoryStore.clearHistory(chatId);
  res.json({ success: true, chatId });
});

/**
 * 11. Simular conversa (Chat Simulator)
 */
apiRouter.post('/api/simulate', requireAuth, async (req: Request, res: Response) => {
  const { chatId = 'simulacao@c.us', message } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem inválida.' });
  }

  try {
    const result = await orchestrator.simulateMessage(chatId, message);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 12. Obter logs em tempo real
 */
apiRouter.get('/api/logs', requireAuth, (_req: Request, res: Response) => {
  res.json({ logs: orchestrator.getLogs() });
});

/**
 * 13. Limpar logs
 */
apiRouter.delete('/api/logs', requireAuth, (_req: Request, res: Response) => {
  orchestrator.clearLogs();
  res.json({ success: true });
});
