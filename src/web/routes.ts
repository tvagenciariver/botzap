import { Router, Request, Response } from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { orchestrator } from '../orchestrator/engine.js';
import { loadBotConfig, saveBotConfig, updateEnvFile, env, defaultBrazilianHolidays, HolidayItem } from '../config/index.js';
import { commandExecutor } from '../orchestrator/command-executor.js';
import { agentManager } from '../config/agent-manager.js';
import { AgentProfile } from '../config/agent-types.js';
import { memoryStore } from '../gemini/memory.js';
import { geminiService } from '../gemini/client.js';
import { openAIService } from '../openai/client.js';
import { wahaClient } from '../waha/client.js';
import { WahaWebhookEvent } from '../waha/types.js';
import { checkBusinessHoursStatus } from '../orchestrator/schedule-helper.js';
import { appointmentManager } from '../appointments/appointment-manager.js';
import { notificationService } from '../appointments/notification-service.js';
import { reminderScheduler } from '../appointments/reminder-scheduler.js';
import { partnerManager } from '../appointments/partner-manager.js';

import { examService } from '../appointments/exam-service.js';
import { formatToWhatsAppChatId } from '../appointments/phone-utils.js';
import { userManager } from '../auth/user-manager.js';
import { UserSession, AppModule } from '../auth/user-types.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserSession;
    }
  }
}

export const apiRouter = Router();

function sanitizeAgentProfile(agent: AgentProfile) {
  const bhStatus = checkBusinessHoursStatus(agent);
  return {
    ...agent,
    geminiApiKey: agent.geminiApiKey ? '••••••••' + agent.geminiApiKey.slice(-4) : '',
    openaiApiKey: agent.openaiApiKey ? '••••••••' + agent.openaiApiKey.slice(-4) : '',
    hasGeminiKey: !!(agent.geminiApiKey && agent.geminiApiKey.trim()),
    hasOpenAIKey: !!(agent.openaiApiKey && agent.openaiApiKey.trim()),
    businessHoursStatus: {
      enabled: !!agent.businessHours?.enabled,
      isOpen: bhStatus.isOpen,
      reason: bhStatus.reason,
      currentTime: bhStatus.currentTime,
      currentDay: bhStatus.currentDayName,
      timezone: bhStatus.timezone
    }
  };
}

/**
 * Middleware de Autenticação para rotas protegidas da API
 */
const requireAuth = (req: Request, res: Response, next: () => void) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Não autorizado. Faça login para acessar o sistema.', unauthorized: true });
  }

  const token = authHeader.split(' ')[1];
  const session = token ? userManager.getSession(token) : undefined;
  if (!token || !session) {
    return res.status(401).json({ error: 'Sessão expirada ou inválida. Faça login novamente.', unauthorized: true });
  }

  req.user = session;
  next();
};

/**
 * Middleware de Verificação de Permissão por Módulo (RBAC granular)
 */
const requireModule = (module: AppModule) => {
  return (req: Request, res: Response, next: () => void) => {
    requireAuth(req, res, () => {
      if (req.user?.role === 'admin') {
        return next();
      }
      const allowed = req.user?.allowedModules || ['appointments', 'exams', 'chats', 'simulator'];
      if (!allowed.includes(module)) {
        return res.status(403).json({
          error: `Acesso restrito. Seu usuário não possui permissão para acessar o módulo '${module}'.`,
          forbidden: true
        });
      }
      next();
    });
  };
};

/**
 * Middleware de Autorização de Administrador (Acesso total)
 */
const requireAdmin = (req: Request, res: Response, next: () => void) => {
  requireAuth(req, res, () => {
    if (req.user?.role !== 'admin') {
      return res.status(403).json({
        error: 'Acesso restrito para administradores.',
        forbidden: true
      });
    }
    next();
  });
};

/**
 * Endpoint de Login (Usuário e Senha com RBAC)
 */
apiRouter.post('/api/auth/login', (req: Request, res: Response) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, error: 'Informe usuário e senha.' });
  }

  const session = userManager.validateLogin(username, password);
  if (!session) {
    return res.status(401).json({
      success: false,
      error: 'Usuário ou senha incorretos ou usuário desativado.'
    });
  }

  return res.json({
    success: true,
    token: session.token,
    user: {
      userId: session.userId,
      username: session.username,
      name: session.name,
      role: session.role,
      assignedAgentId: session.assignedAgentId,
      allowedModules: session.allowedModules
    }
  });
});

/**
 * Endpoint de Logout
 */
apiRouter.post('/api/auth/logout', (req: Request, res: Response) => {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    const token = authHeader.split(' ')[1];
    if (token) userManager.deleteSession(token);
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
    const session = token ? userManager.getSession(token) : undefined;
    if (session) {
      return res.json({
        authenticated: true,
        user: {
          userId: session.userId,
          username: session.username,
          name: session.name,
          role: session.role,
          assignedAgentId: session.assignedAgentId,
          allowedModules: session.allowedModules
        }
      });
    }
  }
  return res.status(401).json({ authenticated: false });
});

/**
 * 1. Webhook principal da WAHA (universal para todos os clientes ou com sessão na URL)
 */
apiRouter.post(['/webhook/waha', '/webhook/waha/:session'], async (req: Request, res: Response) => {
  const event: WahaWebhookEvent = req.body;

  // Responde imediatamente à WAHA com status 200
  res.status(200).json({ status: 'received' });

  // Processa de forma assíncrona
  try {
    if (event.event === 'message' || event.event === 'message.any') {
      if (event.payload) {
        const sessionName = req.params.session
          || (req.query.session as string)
          || event.session
          || (event.payload as any)?.session
          || (event.payload as any)?._data?.session
          || env.wahaSession;

        await orchestrator.processIncomingWahaMessage(event.payload, sessionName);
      }
    }
  } catch (err: any) {
    console.error('[WAHA Webhook] Erro ao processar:', err.message);
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
    // Extrai o identificador do contato no formato do WhatsApp a partir de todos os campos possíveis do Chatwoot
    const rawIdentifier = data.conversation?.meta?.sender?.phone_number ||
      data.sender?.phone_number ||
      data.contact?.phone_number ||
      data.conversation?.contact_inbox?.source_id ||
      data.conversation?.channel?.recipient_id ||
      data.conversation?.meta?.sender?.identifier;

    let chatId = '';
    if (rawIdentifier) {
      const str = String(rawIdentifier).trim();
      if (str.endsWith('@lid') || str.endsWith('@c.us')) {
        chatId = str;
      } else if (str.endsWith('@s.whatsapp.net')) {
        chatId = str.replace('@s.whatsapp.net', '@c.us');
      } else {
        const cleanDigits = str.replace(/\D/g, '');
        if (cleanDigits) {
          chatId = formatToWhatsAppChatId(cleanDigits);
        }
      }
    }

    if (chatId) {
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
apiRouter.get('/api/status', requireAuth, async (req: Request, res: Response) => {
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
  const allAgents = agentManager.listAgents();
  const activeAgents = allAgents.filter(a => a.active !== false);

  const effectiveAgentId = req.query.agentId as string;
  let targetBhConfig = config;
  let targetBhStatus = checkBusinessHoursStatus(config);
  if (effectiveAgentId && effectiveAgentId !== 'all' && effectiveAgentId !== '*') {
    const agent = agentManager.getAgent(effectiveAgentId);
    if (agent && agent.businessHours) {
      targetBhConfig = { ...config, businessHours: agent.businessHours };
      targetBhStatus = checkBusinessHoursStatus(agent);
    }
  }

  res.json({
    orchestrator: 'online',
    version: '2.7.0',
    buildDate: '2026.09.08',
    timestamp: new Date().toISOString(),
    agentsCount: {
      total: allAgents.length,
      active: activeAgents.length
    },
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
      enabled: !!targetBhConfig.businessHours?.enabled,
      isOpen: targetBhStatus.isOpen,
      reason: targetBhStatus.reason,
      currentTime: targetBhStatus.currentTime,
      currentDay: targetBhStatus.currentDayName,
      timezone: targetBhStatus.timezone
    }
  });
});

/**
 * 3.1 Obter status e configuração de Horário Comercial
 */
apiRouter.get('/api/business-hours/status', requireAuth, (req: Request, res: Response) => {
  const agentId = req.query.agentId as string;
  if (agentId && agentId !== 'all' && agentId !== '*') {
    const agent = agentManager.getAgent(agentId);
    if (agent) {
      const bh = agent.businessHours || loadBotConfig().businessHours;
      const status = checkBusinessHoursStatus(agent);
      return res.json({
        businessHours: bh,
        status,
        agent: {
          id: agent.id,
          name: agent.name,
          companyName: agent.companyName
        }
      });
    }
  }

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
apiRouter.post('/api/business-hours', requireAdmin, (req: Request, res: Response) => {
  try {
    const { businessHours, agentId } = req.body;
    if (!businessHours) {
      return res.status(400).json({ error: 'Configuração de horário ausente.' });
    }

    if (agentId && agentId !== 'all' && agentId !== '*') {
      const agent = agentManager.getAgent(agentId);
      if (agent) {
        // Preserva feriados existentes do agente se não enviados no payload
        const holidays = businessHours.holidays || agent.businessHours?.holidays || [];
        const updatedBh = {
          ...agent.businessHours,
          ...businessHours,
          holidays
        };
        const updatedAgent = agentManager.updateAgent(agentId, { businessHours: updatedBh });
        const status = checkBusinessHoursStatus(updatedAgent || { businessHours: updatedBh });
        return res.json({
          success: true,
          message: `Horário comercial de "${agent.companyName || agent.name}" salvo com sucesso!`,
          businessHours: updatedBh,
          status,
          agentId
        });
      }
    }

    // Se for global ('all' ou sem agentId)
    const updated = saveBotConfig({ businessHours });

    // Sincroniza também o agente padrão caso exista, evitando descompasso de horários
    const defaultAgent = agentManager.getAgent('default');
    if (defaultAgent) {
      const holidays = businessHours.holidays || defaultAgent.businessHours?.holidays || updated.businessHours?.holidays || [];
      const updatedBh = {
        ...defaultAgent.businessHours,
        ...businessHours,
        holidays
      };
      agentManager.updateAgent('default', { businessHours: updatedBh });
    }

    const status = checkBusinessHoursStatus(updated);
    res.json({
      success: true,
      message: 'Horário comercial global salvo com sucesso!',
      businessHours: updated.businessHours,
      status
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3.3 Feriados & Indisponibilidades - Listar
 */
apiRouter.get('/api/business-hours/holidays', requireAuth, (req: Request, res: Response) => {
  try {
    const agentId = req.query.agentId as string;
    const agent = (agentId && agentId !== '*' && agentId !== 'all') ? agentManager.getAgent(agentId) : null;
    const holidays = agent?.businessHours?.holidays || loadBotConfig().businessHours?.holidays || [];
    res.json({ success: true, holidays });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3.4 Feriados & Indisponibilidades - Adicionar
 */
apiRouter.post('/api/business-hours/holidays', requireAdmin, (req: Request, res: Response) => {
  try {
    const { name, date, type, outOfHoursMessage, agentId } = req.body;
    if (!name || !date) {
      return res.status(400).json({ error: 'Nome e data do feriado são obrigatórios.' });
    }

    const newHoliday: HolidayItem = {
      id: 'hol_' + Math.random().toString(36).substring(2, 9),
      name: name.trim(),
      date: date.trim(),
      type: type || 'municipal',
      enabled: true,
      outOfHoursMessage: outOfHoursMessage ? outOfHoursMessage.trim() : undefined,
      createdAt: new Date().toISOString()
    };

    if (agentId && agentId !== '*' && agentId !== 'all') {
      const agent = agentManager.getAgent(agentId);
      if (agent) {
        const list = Array.isArray(agent.businessHours?.holidays) ? [...agent.businessHours.holidays] : [];
        list.push(newHoliday);
        agentManager.updateAgent(agentId, {
          businessHours: { ...agent.businessHours, holidays: list }
        });
        return res.status(201).json({
          success: true,
          holiday: newHoliday,
          message: `Feriado adicionado para a empresa "${agent.companyName || agent.name}"!`
        });
      }
    }

    // Atualiza na configuração global se for 'all' ou sem agentId
    const cfg = loadBotConfig();
    const globalList = Array.isArray(cfg.businessHours?.holidays) ? [...cfg.businessHours.holidays] : [];
    globalList.push(newHoliday);
    saveBotConfig({ businessHours: { ...cfg.businessHours, holidays: globalList } });

    const defaultAgent = agentManager.getAgent('default');
    if (defaultAgent && defaultAgent.businessHours) {
      agentManager.updateAgent('default', {
        businessHours: { ...defaultAgent.businessHours, holidays: globalList }
      });
    }

    res.status(201).json({ success: true, holiday: newHoliday, message: 'Feriado/Indisponibilidade cadastrado com sucesso!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3.5 Feriados & Indisponibilidades - Remover
 */
apiRouter.delete('/api/business-hours/holidays/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const agentId = req.query.agentId as string;

    if (agentId && agentId !== '*' && agentId !== 'all') {
      const agent = agentManager.getAgent(agentId);
      if (agent && Array.isArray(agent.businessHours?.holidays)) {
        const filtered = agent.businessHours.holidays.filter(h => h.id !== id);
        agentManager.updateAgent(agentId, {
          businessHours: { ...agent.businessHours, holidays: filtered }
        });
        return res.json({ success: true, message: 'Feriado removido com sucesso!' });
      }
    }

    const cfg = loadBotConfig();
    if (Array.isArray(cfg.businessHours?.holidays)) {
      const filtered = cfg.businessHours.holidays.filter(h => h.id !== id);
      saveBotConfig({ businessHours: { ...cfg.businessHours, holidays: filtered } });

      const defaultAgent = agentManager.getAgent('default');
      if (defaultAgent && defaultAgent.businessHours) {
        agentManager.updateAgent('default', {
          businessHours: { ...defaultAgent.businessHours, holidays: filtered }
        });
      }
    }

    res.json({ success: true, message: 'Feriado removido com sucesso!' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3.6 Feriados & Indisponibilidades - Carregar Feriados Nacionais Padrão
 */
apiRouter.post('/api/business-hours/holidays/load-national', requireAdmin, (req: Request, res: Response) => {
  try {
    const { agentId } = req.body;
    let count = 0;

    if (agentId && agentId !== '*' && agentId !== 'all') {
      const agent = agentManager.getAgent(agentId);
      if (agent) {
        const agentList = Array.isArray(agent.businessHours?.holidays) ? [...agent.businessHours.holidays] : [];
        for (const def of defaultBrazilianHolidays) {
          if (!agentList.some(h => h.date === def.date && h.name === def.name)) {
            agentList.push({
              id: 'hol_' + Math.random().toString(36).substring(2, 9),
              ...def,
              createdAt: new Date().toISOString()
            });
            count++;
          }
        }
        agentManager.updateAgent(agentId, {
          businessHours: { ...agent.businessHours, holidays: agentList }
        });
        return res.json({
          success: true,
          addedCount: count,
          count,
          message: `${count} feriados nacionais carregados para "${agent.companyName || agent.name}"!`
        });
      }
    }

    const cfg = loadBotConfig();
    const currentList = Array.isArray(cfg.businessHours?.holidays) ? [...cfg.businessHours.holidays] : [];

    for (const def of defaultBrazilianHolidays) {
      if (!currentList.some(h => h.date === def.date && h.name === def.name)) {
        currentList.push({
          id: 'hol_' + Math.random().toString(36).substring(2, 9),
          ...def,
          createdAt: new Date().toISOString()
        });
        count++;
      }
    }

    saveBotConfig({ businessHours: { ...cfg.businessHours, holidays: currentList } });

    const defaultAgent = agentManager.getAgent('default');
    if (defaultAgent && defaultAgent.businessHours) {
      agentManager.updateAgent('default', {
        businessHours: { ...defaultAgent.businessHours, holidays: currentList }
      });
    }

    res.json({ success: true, addedCount: count, count, message: `${count} feriados nacionais carregados com sucesso!` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * 3.7 Console de Comandos do Administrador em Tempo Real
 */
apiRouter.post('/api/admin/command', requireAdmin, async (req: Request, res: Response) => {
  try {
    const { command, agentId } = req.body;
    if (!command || !command.trim()) {
      return res.status(400).json({ error: 'Comando não fornecido.' });
    }

    const user = req.user || { name: 'Admin', username: 'admin', role: 'admin' };
    const result = await commandExecutor.execute(command, user, agentId);
    res.json({ success: result.success, result });
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
apiRouter.post('/api/config', requireAdmin, (req: Request, res: Response) => {
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
apiRouter.post('/api/openai/test-connection', requireAdmin, async (req: Request, res: Response) => {
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
apiRouter.post('/api/waha/test-connection', requireAdmin, async (req: Request, res: Response) => {
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
apiRouter.post('/api/waha/save-connection', requireAdmin, (req: Request, res: Response) => {
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
apiRouter.post('/api/waha/setup-webhook', requireAdmin, async (req: Request, res: Response) => {
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
apiRouter.get('/api/chats', requireModule('chats'), (_req: Request, res: Response) => {
  const chats = memoryStore.listActiveChats();
  res.json({ chats });
});

/**
 * 8. Pausar bot para um contato específico
 */
apiRouter.post('/api/chats/:chatId/pause', requireModule('chats'), (req: Request, res: Response) => {
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
apiRouter.post('/api/chats/:chatId/resume', requireModule('chats'), (req: Request, res: Response) => {
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
apiRouter.post('/api/chats/:chatId/clear', requireModule('chats'), (req: Request, res: Response) => {
  const { chatId } = req.params;
  memoryStore.clearHistory(chatId);
  res.json({ success: true, chatId, message: 'Histórico limpo com sucesso.' });
});

/**
 * 11. Simular mensagem de entrada (Web Chat)
 */
apiRouter.post('/api/simulate', requireModule('simulator'), async (req: Request, res: Response) => {
  const { chatId = 'simulacao@c.us', message, agentId } = req.body;
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'Mensagem inválida.' });
  }

  try {
    const result = await orchestrator.simulateMessage(chatId, message, agentId);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * 12. Obter logs em tempo real (Exclusivo Administrador)
 * Suporta filtro individual por empresa via ?agentId=...
 */
apiRouter.get('/api/logs', requireAdmin, (req: Request, res: Response) => {
  const agentId = req.query.agentId as string | undefined;
  res.json({ logs: orchestrator.getLogs(agentId) });
});

/**
 * 13. Limpar logs (Exclusivo Administrador)
 */
apiRouter.delete('/api/logs', requireAdmin, (req: Request, res: Response) => {
  const agentId = req.query.agentId as string | undefined;
  orchestrator.clearLogs(agentId);
  res.json({ success: true });
});

/**
 * 14. Gerenciamento Multi-Agentes (CRUD)
 */
apiRouter.get('/api/agents', requireAuth, (_req: Request, res: Response) => {
  const agents = agentManager.listAgents().map(sanitizeAgentProfile);
  res.json({ agents });
});

apiRouter.get('/api/agents/:id', requireAuth, (req: Request, res: Response) => {
  const agent = agentManager.getAgent(req.params.id);
  if (!agent) {
    return res.status(404).json({ error: 'Agente não encontrado.' });
  }
  res.json({ agent: sanitizeAgentProfile(agent) });
});

apiRouter.post('/api/agents', requireAdmin, (req: Request, res: Response) => {
  try {
    const data = req.body;
    const created = agentManager.createAgent(data);
    res.status(201).json({ success: true, agent: sanitizeAgentProfile(created) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/api/agents/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updates = { ...req.body };

    // Se as chaves enviadas forem as mascaradas, preserva a chave existente
    const current = agentManager.getAgent(id);
    if (current) {
      if (typeof updates.geminiApiKey === 'string' && updates.geminiApiKey.includes('••••')) {
        delete updates.geminiApiKey;
      }
      if (typeof updates.openaiApiKey === 'string' && updates.openaiApiKey.includes('••••')) {
        delete updates.openaiApiKey;
      }
      // Se enviou businessHours, preserva holidays e timezone existentes
      if (updates.businessHours && current.businessHours) {
        updates.businessHours = {
          ...current.businessHours,
          ...updates.businessHours,
          timezone: updates.businessHours.timezone || current.businessHours.timezone || 'America/Sao_Paulo',
          holidays: updates.businessHours.holidays || current.businessHours.holidays || []
        };
      }
    }

    const updated = agentManager.updateAgent(id, updates);
    if (id === 'default' && updates.businessHours) {
      saveBotConfig({ businessHours: updated.businessHours });
    }

    res.json({ success: true, agent: sanitizeAgentProfile(updated) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/api/agents/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const success = agentManager.deleteAgent(id);
    res.json({ success, message: 'Agente excluído com sucesso.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/api/agents/:id/duplicate', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const duplicated = agentManager.duplicateAgent(id);
    res.status(201).json({ success: true, agent: sanitizeAgentProfile(duplicated) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * 15. Pausa de Emergência Individual — Congela todas as respostas de um agente
 */
apiRouter.post('/api/agents/:id/pause', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = agentManager.getAgent(id);
  if (!agent) {
    return res.status(404).json({ error: 'Agente não encontrado.' });
  }
  agentManager.updateAgent(id, { isPausedGlobally: true, pausedGloballyUntil: undefined });
  orchestrator.addLog({
    type: 'info',
    chatId: 'sistema',
    message: `⏸ Agente "${agent.name}" pausado globalmente via painel.`,
    agentName: agent.name
  });
  console.warn(`[SEGURANÇA] Agente "${agent.name}" (${id}) PAUSADO GLOBALMENTE pelo painel.`);
  res.json({ success: true, id, isPausedGlobally: true });
});

/**
 * 16. Reativar Agente após Pausa de Emergência
 */
apiRouter.post('/api/agents/:id/resume', requireAuth, (req: Request, res: Response) => {
  const { id } = req.params;
  const agent = agentManager.getAgent(id);
  if (!agent) {
    return res.status(404).json({ error: 'Agente não encontrado.' });
  }
  agentManager.updateAgent(id, { isPausedGlobally: false, pausedGloballyUntil: undefined });
  orchestrator.addLog({
    type: 'info',
    chatId: 'sistema',
    message: `▶️ Agente "${agent.name}" reativado via painel.`,
    agentName: agent.name
  });
  console.log(`[SEGURANÇA] Agente "${agent.name}" (${id}) REATIVADO pelo painel.`);
  res.json({ success: true, id, isPausedGlobally: false });
});

/**
 * 17. 🚨 BOTÃO DE PÂNICO — Para TODOS os agentes imediatamente
 */
apiRouter.post('/api/agents/panic', requireAuth, (req: Request, res: Response) => {
  const agents = agentManager.listAgents();
  let pausedCount = 0;
  for (const agent of agents) {
    if (agent.active) {
      agentManager.updateAgent(agent.id, { isPausedGlobally: true, pausedGloballyUntil: undefined });
      pausedCount++;
    }
  }
  orchestrator.addLog({
    type: 'info',
    chatId: 'sistema',
    message: `🚨 BOTÃO DE PÂNICO ACIONADO — ${pausedCount} agente(s) pausados imediatamente via painel de emergência.`
  });
  console.error(`[PÂNICO] 🚨 TODOS OS AGENTES PAUSADOS (${pausedCount}) via botão de pânico!`);
  res.json({ success: true, pausedCount });
});

/**
 * 18. Restaurar todos os agentes após pânico
 */
apiRouter.delete('/api/agents/panic', requireAuth, (req: Request, res: Response) => {
  const agents = agentManager.listAgents();
  let resumedCount = 0;
  for (const agent of agents) {
    if (agent.isPausedGlobally) {
      agentManager.updateAgent(agent.id, { isPausedGlobally: false, pausedGloballyUntil: undefined });
      resumedCount++;
    }
  }
  orchestrator.addLog({
    type: 'info',
    chatId: 'sistema',
    message: `✅ Emergência encerrada — ${resumedCount} agente(s) reativados.`
  });
  console.log(`[PÂNICO] Emergência encerrada. ${resumedCount} agente(s) reativados.`);
  res.json({ success: true, resumedCount });
});



// ============================================================================
// AGENDAMENTOS & AGENDA INTELIGENTE
// ============================================================================

/**
 * Lista agendamentos com filtros (data, agentId, specialistId, status)
 */
apiRouter.get('/api/appointments', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    let { agentId, date, specialistId, status } = req.query as {
      agentId?: string;
      date?: string;
      specialistId?: string;
      status?: string;
    };

    // Se o usuário for atendente vinculado a um cliente específico, restringe a busca
    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }

    const appointments = appointmentManager.listAppointments({ agentId, date, specialistId, status });
    res.json({ appointments });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Métricas e KPIs para o Dashboard de Agendamentos
 */
apiRouter.get('/api/appointments/summary', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    let { agentId, date } = req.query as { agentId?: string; date?: string };

    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }

    const summary = appointmentManager.getAppointmentsSummary(agentId, date);
    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Consulta horários disponíveis (anti-colisão) para uma data e especialista
 */
apiRouter.get('/api/appointments/slots', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const { specialistId, date } = req.query as { specialistId?: string; date?: string };
    if (!specialistId || !date) {
      return res.status(400).json({ error: 'specialistId e date são obrigatórios.' });
    }
    const slots = appointmentManager.getAvailableSlots(specialistId, date);
    res.json({ slots });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Lista vagas canceladas para encaixes rápidos (Hoje e Amanhã)
 */
apiRouter.get('/api/appointments/encaixes', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    let { agentId } = req.query as { agentId?: string };

    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }

    const encaixes = appointmentManager.getEncaixes(agentId);
    res.json({ encaixes });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Criação manual de agendamento pelo painel
 */
apiRouter.post('/api/appointments', requireModule('appointments'), async (req: Request, res: Response) => {
  try {
    let {
      agentId,
      specialistId,
      serviceId,
      clientPhone,
      clientName,
      date,
      startTime,
      notes,
      notifySpecialist,
      referralType,
      partnerId
    } = req.body;

    if (!specialistId || !date || !startTime || !clientName || !clientPhone) {
      return res.status(400).json({ error: 'Preencha todos os campos obrigatórios.' });
    }

    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }

    let partnerName: string | undefined;
    if (partnerId) {
      const p = partnerManager.getPartner(partnerId);
      if (p) partnerName = p.name;
    }

    const clientChatId = notificationService.formatToWhatsAppChatId(clientPhone);

    const appointment = appointmentManager.createAppointment({
      agentId: agentId || 'default',
      specialistId,
      serviceId,
      clientChatId,
      clientPhone,
      clientName,
      date,
      startTime,
      notes,
      referralType: referralType || (partnerId ? 'partner' : 'particular'),
      partnerId,
      partnerName,
      bookedVia: 'manual'
    });

    // Notifica o especialista se solicitado
    if (notifySpecialist !== false) {
      notificationService.notifySpecialistNewBooking(appointment).catch(err => {
        console.error('[Routes] Erro ao notificar especialista sobre novo agendamento:', err.message);
      });
    }

    res.status(201).json({ success: true, appointment });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Atualiza status, observações ou reagendamento de consulta
 */
apiRouter.put('/api/appointments/:id', requireModule('appointments'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const previous = appointmentManager.getAppointment(id);
    if (!previous) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    const updated = appointmentManager.updateAppointment(id, req.body);

    // Se mudou para cancelado e não era antes, notifica especialista
    if (
      (updated.status === 'cancelled' || updated.status === 'cancelled_by_patient') &&
      previous.status !== 'cancelled' && previous.status !== 'cancelled_by_patient'
    ) {
      notificationService.notifySpecialistCancellation(updated).catch(err => {
        console.error('[Routes] Erro ao notificar cancelamento:', err.message);
      });
    }

    res.json({ success: true, appointment: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Exclui agendamento permanentemente
 */
apiRouter.delete('/api/appointments/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const ok = appointmentManager.deleteAppointment(id);
    res.json({ success: ok, message: 'Agendamento removido com sucesso.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Reenvia notificação WhatsApp ao especialista
 */
apiRouter.post('/api/appointments/:id/notify', requireModule('appointments'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const apt = appointmentManager.getAppointment(id);
    if (!apt) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    const sent = await notificationService.notifySpecialistNewBooking(apt);
    if (sent) {
      res.json({ success: true, sent: true });
    } else {
      const errorMsg = notificationService.getLastError() || 'Especialista sem telefone válido ou falha na conexão WAHA.';
      res.status(400).json({ success: false, sent: false, error: errorMsg });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Disparo em lote de Lembretes D-1 para consultas de amanhã
 */
apiRouter.post('/api/appointments/send-reminders', requireModule('appointments'), async (req: Request, res: Response) => {
  try {
    let { agentId } = req.body;
    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }
    const result = await notificationService.sendRemindersForTomorrow(agentId);
    if (result.total > 0 && result.sent === 0) {
      const errorMsg = result.lastError || notificationService.getLastError() || 'Nenhum lembrete pôde ser entregue pela WAHA.';
      return res.status(400).json({ success: false, ...result, error: errorMsg });
    }
    res.json({ success: true, ...result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * Obter status e configuração do Envio Automático de Lembretes D-1
 */
apiRouter.get('/api/appointments/reminders/config', requireModule('appointments'), (_req: Request, res: Response) => {
  const status = reminderScheduler.getStatus();
  res.json({ success: true, ...status });
});

/**
 * Atualizar configuração do Envio Automático de Lembretes D-1
 */
apiRouter.put('/api/appointments/reminders/config', requireAdmin, (req: Request, res: Response) => {
  try {
    const { enableAutoReminders, autoReminderTime } = req.body;
    const updated = reminderScheduler.updateConfig({ enableAutoReminders, autoReminderTime });
    res.json({ success: true, ...updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

/**
 * Disparar lembretes D-1 imediatamente via scheduler (com registro de log)
 */
apiRouter.post('/api/appointments/reminders/run-now', requireModule('appointments'), async (req: Request, res: Response) => {
  try {
    let { agentId } = req.body;
    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }
    const result = await reminderScheduler.checkAndRun('manual', agentId);
    res.json({ success: true, ...result, status: reminderScheduler.getStatus() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});


/**
 * Envia lembrete D-1 individual para um agendamento
 */
apiRouter.post('/api/appointments/:id/send-reminder', requireModule('appointments'), async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const apt = appointmentManager.getAppointment(id);
    if (!apt) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    const sent = await notificationService.sendDMinusOneReminder(apt);
    if (sent) {
      res.json({ success: true, sent: true });
    } else {
      const errorMsg = notificationService.getLastError() || 'Não foi possível enviar o lembrete via WAHA.';
      res.status(400).json({ success: false, sent: false, error: errorMsg });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ============================================================================
// ESPECIALISTAS & SERVIÇOS
// ============================================================================

apiRouter.get('/api/specialists', requireModule('appointments'), (req: Request, res: Response) => {
  let { agentId } = req.query as { agentId?: string };
  if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
    agentId = req.user.assignedAgentId;
  }
  const specialists = appointmentManager.listSpecialists(agentId);
  res.json({ specialists });
});

apiRouter.post('/api/specialists', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      data.agentId = req.user.assignedAgentId;
    }
    const created = appointmentManager.createSpecialist(data);
    res.status(201).json({ success: true, specialist: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/api/specialists/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const updated = appointmentManager.updateSpecialist(req.params.id, req.body);
    res.json({ success: true, specialist: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/api/specialists/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const ok = appointmentManager.deleteSpecialist(req.params.id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.get('/api/services', requireModule('appointments'), (req: Request, res: Response) => {
  let { agentId } = req.query as { agentId?: string };
  if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
    agentId = req.user.assignedAgentId;
  }
  const services = appointmentManager.listServices(agentId);
  res.json({ services });
});

apiRouter.post('/api/services', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const data = req.body;
    if (req.user?.role === 'attendant' && req.user.assignedAgentId && req.user.assignedAgentId !== '*') {
      data.agentId = req.user.assignedAgentId;
    }
    const created = appointmentManager.createService(data);
    res.status(201).json({ success: true, service: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/api/services/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const updated = appointmentManager.updateService(req.params.id, req.body);
    res.json({ success: true, service: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/api/services/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const ok = appointmentManager.deleteService(req.params.id);
    res.json({ success: ok });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// GESTÃO DE USUÁRIOS & EQUIPE (RBAC - Exclusivo Administradores)
// ============================================================================

apiRouter.get('/api/users', requireAdmin, (_req: Request, res: Response) => {
  try {
    const users = userManager.listUsers();
    res.json({ users });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/api/users', requireAdmin, (req: Request, res: Response) => {
  try {
    const { username, password, name, role, assignedAgentId, allowedModules } = req.body;
    if (!username || !password || !name) {
      return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios.' });
    }
    const created = userManager.createUser({
      username,
      password,
      name,
      role: role || 'attendant',
      assignedAgentId: assignedAgentId || '*',
      allowedModules: Array.isArray(allowedModules) ? allowedModules : undefined
    });
    res.status(201).json({ success: true, user: created });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/api/users/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const updated = userManager.updateUser(id, req.body);
    res.json({ success: true, user: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/api/users/:id', requireAdmin, (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const ok = userManager.deleteUser(id);
    if (!ok) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }
    res.json({ success: true, message: 'Usuário removido com sucesso.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// GESTÃO DE PARCEIROS & CONVÊNIOS (requireAuth)
// ============================================================================

apiRouter.get('/api/partners', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const agentId = (req.query.agentId as string) || (req.user?.role === 'attendant' && req.user?.assignedAgentId !== '*' ? req.user.assignedAgentId : undefined);
    const partners = partnerManager.listPartners(agentId);
    res.json({ partners });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/api/partners/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const partner = partnerManager.getPartner(req.params.id);
    if (!partner) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    res.json({ partner });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/api/partners', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const { name, document, phone, contactPerson, email, notes, active, agentId } = req.body;
    const partner = partnerManager.createPartner({
      name,
      document,
      phone,
      contactPerson,
      email,
      notes,
      active,
      agentId: agentId || '*'
    });
    res.status(201).json({ success: true, partner });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.put('/api/partners/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const updated = partnerManager.updatePartner(req.params.id, req.body);
    res.json({ success: true, partner: updated });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/api/partners/:id', requireModule('appointments'), (req: Request, res: Response) => {
  try {
    const ok = partnerManager.deletePartner(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Parceiro não encontrado.' });
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ============================================================================
// ENVIO & GESTÃO DE EXAMES / LAUDOS (requireAuth)
// ============================================================================

apiRouter.get('/api/exams', requireModule('exams'), (req: Request, res: Response) => {
  try {
    let agentId = req.query.agentId as string | undefined;
    if (req.user?.role === 'attendant' && req.user?.assignedAgentId !== '*') {
      agentId = req.user.assignedAgentId;
    }
    const exams = examService.listExams({
      agentId,
      partnerId: req.query.partnerId as string,
      referralType: req.query.referralType as string,
      status: req.query.status as string,
      startDate: req.query.startDate as string,
      endDate: req.query.endDate as string,
      search: req.query.search as string
    });
    res.json({ exams });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/api/exams/:id', requireModule('exams'), (req: Request, res: Response) => {
  try {
    const exam = examService.getExam(req.params.id);
    if (!exam) return res.status(404).json({ error: 'Exame não encontrado.' });
    res.json({ exam });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.get('/api/exams/:id/download', requireModule('exams'), (req: Request, res: Response) => {
  try {
    const exam = examService.getExam(req.params.id);
    if (!exam || !fs.existsSync(exam.fileStoredPath)) {
      return res.status(404).json({ error: 'Arquivo do laudo/exame não encontrado em disco.' });
    }
    res.download(exam.fileStoredPath, exam.originalName);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post('/api/exams/dispatch', requireModule('exams'), async (req: Request, res: Response) => {
  try {
    const {
      appointmentId,
      agentId,
      patientName,
      patientPhone,
      patientCpf,
      referralType,
      partnerId,
      target,
      fileBase64,
      fileName,
      fileMimeType,
      caption
    } = req.body;

    const operatorName = req.user?.name || req.user?.username || 'Atendimento';
    const effectiveAgentId = (req.user?.role === 'attendant' && req.user?.assignedAgentId !== '*')
      ? req.user.assignedAgentId
      : (agentId || '*');

    const result = await examService.dispatchExam({
      appointmentId,
      agentId: effectiveAgentId,
      patientName,
      patientPhone,
      patientCpf,
      referralType,
      partnerId,
      target,
      fileBase64,
      fileName,
      fileMimeType,
      caption,
      sentBy: operatorName
    });

    res.status(201).json({ success: true, exam: result });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.post('/api/exams/:id/resend', requireModule('exams'), async (req: Request, res: Response) => {
  try {
    const { target, caption } = req.body;
    const exam = await examService.reSendExam(req.params.id, target, caption);
    res.json({ success: true, exam });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

apiRouter.delete('/api/exams/:id', requireModule('exams'), (req: Request, res: Response) => {
  try {
    const ok = examService.deleteExam(req.params.id);
    if (!ok) return res.status(404).json({ error: 'Exame não encontrado.' });
    res.json({ success: true, message: 'Exame removido com sucesso.' });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});


