import { Router, Request, Response } from 'express';
import { orchestrator } from '../orchestrator/engine.js';
import { loadBotConfig, saveBotConfig, updateEnvFile, env } from '../config/index.js';
import { memoryStore } from '../gemini/memory.js';
import { geminiService } from '../gemini/client.js';
import { wahaClient } from '../waha/client.js';
import { WahaWebhookEvent } from '../waha/types.js';

export const apiRouter = Router();

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
apiRouter.get('/api/status', async (_req: Request, res: Response) => {
  let wahaOnline = false;
  let sessionStatus = null;

  try {
    sessionStatus = await wahaClient.getSessionStatus(env.wahaSession);
    wahaOnline = sessionStatus !== null;
  } catch (err) {
    wahaOnline = false;
  }

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
    }
  });
});

/**
 * 4. Obter configurações do bot
 */
apiRouter.get('/api/config', (_req: Request, res: Response) => {
  const config = loadBotConfig();
  res.json({
    config,
    env: {
      port: env.port,
      wahaBaseUrl: env.wahaBaseUrl,
      wahaSession: env.wahaSession,
      geminiConfigured: geminiService.isConfigured(),
      webhookPublicUrl: env.webhookPublicUrl
    }
  });
});

/**
 * 5. Salvar configurações do bot
 */
apiRouter.post('/api/config', (req: Request, res: Response) => {
  try {
    const { apiKey, ...botSettings } = req.body;

    if (apiKey && typeof apiKey === 'string' && apiKey.trim() !== '') {
      const cleanKey = apiKey.trim();
      geminiService.updateApiKey(cleanKey);
      updateEnvFile('GEMINI_API_KEY', cleanKey);
      botSettings.geminiApiKey = cleanKey;
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
    res.json({ success: true, config: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 6. Testar conexão com a WAHA API
 */
apiRouter.post('/api/waha/test-connection', async (req: Request, res: Response) => {
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
apiRouter.post('/api/waha/save-connection', (req: Request, res: Response) => {
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
      const cleanHook = webhookPublicUrl.trim().replace(/\/$/, '');
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
apiRouter.post('/api/waha/setup-webhook', async (req: Request, res: Response) => {
  try {
    const targetUrl = req.body.url || `${env.webhookPublicUrl}/webhook/waha`;
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
apiRouter.get('/api/chats', (_req: Request, res: Response) => {
  const chats = memoryStore.listActiveChats();
  res.json({ chats });
});

/**
 * 8. Pausar bot para um contato específico
 */
apiRouter.post('/api/chats/:chatId/pause', (req: Request, res: Response) => {
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
apiRouter.post('/api/chats/:chatId/resume', (req: Request, res: Response) => {
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
apiRouter.post('/api/chats/:chatId/clear', (req: Request, res: Response) => {
  const { chatId } = req.params;
  memoryStore.clearHistory(chatId);
  res.json({ success: true, chatId });
});

/**
 * 11. Simular conversa (Chat Simulator)
 */
apiRouter.post('/api/simulate', async (req: Request, res: Response) => {
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
apiRouter.get('/api/logs', (_req: Request, res: Response) => {
  res.json({ logs: orchestrator.getLogs() });
});

/**
 * 13. Limpar logs
 */
apiRouter.delete('/api/logs', (_req: Request, res: Response) => {
  orchestrator.clearLogs();
  res.json({ success: true });
});
