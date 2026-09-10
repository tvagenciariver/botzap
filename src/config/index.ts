import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

export interface DaySchedule {
  enabled: boolean;
  start: string;
  end: string;
  hasLunch: boolean;
  lunchStart?: string;
  lunchEnd?: string;
}

export interface HolidayItem {
  id: string;
  name: string; // Ex: "Feriado Municipal - Padroeiro de Petrolina"
  date: string; // "YYYY-MM-DD" para data específica ou "MM-DD" para recorrente anual (ex: "12-25")
  type?: 'municipal' | 'national' | 'state' | 'custom';
  enabled?: boolean;
  outOfHoursMessage?: string; // Mensagem específica personalizada para este feriado
  createdAt?: string;
}

export const defaultBrazilianHolidays: Omit<HolidayItem, 'id'>[] = [
  { name: 'Confraternização Universal (Ano Novo)', date: '01-01', type: 'national', enabled: true },
  { name: 'Tiradentes', date: '04-21', type: 'national', enabled: true },
  { name: 'Dia do Trabalho', date: '05-01', type: 'national', enabled: true },
  { name: 'Independência do Brasil', date: '09-07', type: 'national', enabled: true },
  { name: 'Nossa Senhora Aparecida', date: '10-12', type: 'national', enabled: true },
  { name: 'Finados', date: '11-02', type: 'national', enabled: true },
  { name: 'Proclamação da República', date: '11-15', type: 'national', enabled: true },
  { name: 'Dia Nacional de Zumbi e da Consciência Negra', date: '11-20', type: 'national', enabled: true },
  { name: 'Natal', date: '12-25', type: 'national', enabled: true }
];

export interface BusinessHoursConfig {
  enabled: boolean;
  timezone: string;
  outOfHoursMessage: string;
  schedule: {
    monday: DaySchedule;
    tuesday: DaySchedule;
    wednesday: DaySchedule;
    thursday: DaySchedule;
    friday: DaySchedule;
    saturday: DaySchedule;
    sunday: DaySchedule;
  };
  holidays?: HolidayItem[];
}

export const defaultBusinessHours: BusinessHoursConfig = {
  enabled: false,
  timezone: 'America/Sao_Paulo',
  outOfHoursMessage: 'Olá! Agradecemos sua mensagem. Nosso horário de atendimento é de Segunda a Sexta das 08h às 18h e aos Sábados das 08h às 12h.\n\nNo momento estamos fora do nosso expediente comercial. Deixe sua mensagem ou dúvida por aqui que responderemos assim que retornarmos! 🕒✨',
  schedule: {
    monday: { enabled: true, start: '08:00', end: '18:00', hasLunch: true, lunchStart: '12:00', lunchEnd: '13:00' },
    tuesday: { enabled: true, start: '08:00', end: '18:00', hasLunch: true, lunchStart: '12:00', lunchEnd: '13:00' },
    wednesday: { enabled: true, start: '08:00', end: '18:00', hasLunch: true, lunchStart: '12:00', lunchEnd: '13:00' },
    thursday: { enabled: true, start: '08:00', end: '18:00', hasLunch: true, lunchStart: '12:00', lunchEnd: '13:00' },
    friday: { enabled: true, start: '08:00', end: '18:00', hasLunch: true, lunchStart: '12:00', lunchEnd: '13:00' },
    saturday: { enabled: true, start: '08:00', end: '12:00', hasLunch: false, lunchStart: '12:00', lunchEnd: '13:00' },
    sunday: { enabled: false, start: '08:00', end: '12:00', hasLunch: false, lunchStart: '12:00', lunchEnd: '13:00' }
  },
  holidays: []
};

export interface BotConfig {
  botName: string;
  companyName: string;
  model: string;
  temperature: number;
  systemInstruction: string;
  businessInfo: string;
  handoffKeywords: string[];
  handoffMessage: string;
  mediaHandoffMessage?: string;
  botActiveByDefault: boolean;
  debounceSeconds: number;
  enableTypingSimulation: boolean;
  enableSendSeen: boolean;
  enableAudioTranscription: boolean;
  pauseDurationHours: number;
  pauseDurationMinutes: number;
  llmProvider: 'gemini' | 'openai';
  businessHours: BusinessHoursConfig;
  geminiApiKey?: string;
  openaiApiKey?: string;
  openaiModel?: string;
  wahaBaseUrl?: string;
  wahaApiKey?: string;
  wahaSession?: string;
  webhookPublicUrl?: string;
  adminUser?: string;
  adminPassword?: string;
  // Configurações de Envio Automático de Lembretes D-1
  enableAutoReminders?: boolean;
  autoReminderTime?: string; // ex: "18:00"
  lastAutoReminderDate?: string; // "YYYY-MM-DD"
}


const configPath = path.resolve(process.cwd(), 'data', 'bot_config.json');
const envPath = path.resolve(process.cwd(), '.env');

export function updateEnvFile(key: string, value: string): void {
  try {
    let content = '';
    if (fs.existsSync(envPath)) {
      content = fs.readFileSync(envPath, 'utf-8');
    }
    const regex = new RegExp(`^${key}=.*$`, 'm');
    if (regex.test(content)) {
      content = content.replace(regex, `${key}=${value}`);
    } else {
      content += `\n${key}=${value}`;
    }
    fs.writeFileSync(envPath, content.trim() + '\n', 'utf-8');
  } catch (err) {
    console.error('Erro ao atualizar .env:', err);
  }
}

export function loadBotConfig(): BotConfig {
  let stored: Partial<BotConfig> = {};
  try {
    if (fs.existsSync(configPath)) {
      const data = fs.readFileSync(configPath, 'utf-8');
      stored = JSON.parse(data);
    }
  } catch (err) {
    console.error('Erro ao carregar bot_config.json, usando padrão:', err);
  }

  const hours = stored.pauseDurationHours ?? (stored.pauseDurationMinutes ? stored.pauseDurationMinutes / 60 : 6);

  return {
    botName: stored.botName || 'Assistente Virtual',
    companyName: stored.companyName || 'Minha Empresa',
    model: stored.model || process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    temperature: stored.temperature ?? 0.4,
    systemInstruction: stored.systemInstruction || 'Você é um atendente inteligente e prestativo para WhatsApp.',
    businessInfo: stored.businessInfo || '',
    handoffKeywords: stored.handoffKeywords || ['atendente', 'humano', 'suporte', 'pessoa'],
    handoffMessage: stored.handoffMessage || 'Entendido! Estou transferindo sua conversa para um de nossos atendentes humanos.',
    mediaHandoffMessage: (stored.mediaHandoffMessage && !stored.mediaHandoffMessage.includes('disponibilidade dos seus exames'))
      ? stored.mediaHandoffMessage
      : 'Olá, *{name}*! Recebemos seu arquivo / imagem com sucesso! 📄✅\n\nJá estou encaminhando para a nossa equipe de atendimento 👤 para analisar as informações.\n\nEm instantes um de nossos atendentes irá te responder por aqui! Por favor, aguarde só um momento. 😊',
    botActiveByDefault: stored.botActiveByDefault ?? true,
    debounceSeconds: stored.debounceSeconds ?? 2.5,
    enableTypingSimulation: stored.enableTypingSimulation ?? true,
    enableSendSeen: stored.enableSendSeen ?? true,
    enableAudioTranscription: stored.enableAudioTranscription ?? false,
    pauseDurationHours: hours,
    pauseDurationMinutes: Math.round(hours * 60),
    llmProvider: stored.llmProvider || (process.env.LLM_PROVIDER as 'gemini' | 'openai') || 'gemini',
    businessHours: {
      ...defaultBusinessHours,
      ...(stored.businessHours || {}),
      schedule: {
        ...defaultBusinessHours.schedule,
        ...(stored.businessHours?.schedule || {})
      },
      holidays: Array.isArray(stored.businessHours?.holidays) ? stored.businessHours.holidays : []
    },
    geminiApiKey: stored.geminiApiKey || process.env.GEMINI_API_KEY || '',
    openaiApiKey: stored.openaiApiKey || process.env.OPENAI_API_KEY || '',
    openaiModel: stored.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini',
    wahaBaseUrl: stored.wahaBaseUrl || process.env.WAHA_BASE_URL || 'http://localhost:3000',
    wahaApiKey: stored.wahaApiKey || process.env.WAHA_API_KEY || '',
    wahaSession: stored.wahaSession || process.env.WAHA_SESSION || 'default',
    webhookPublicUrl: stored.webhookPublicUrl || process.env.WEBHOOK_PUBLIC_URL || 'http://localhost:3001',
    adminUser: stored.adminUser || process.env.ADMIN_USER || 'admin',
    adminPassword: stored.adminPassword || process.env.ADMIN_PASSWORD || 'File@152341',
    enableAutoReminders: stored.enableAutoReminders ?? true,
    autoReminderTime: stored.autoReminderTime || '18:00',
    lastAutoReminderDate: stored.lastAutoReminderDate || ''
  };
}


export function saveBotConfig(newConfig: Partial<BotConfig>): BotConfig {
  const current = loadBotConfig();
  
  if (newConfig.pauseDurationHours !== undefined) {
    newConfig.pauseDurationMinutes = Math.round(newConfig.pauseDurationHours * 60);
  } else if (newConfig.pauseDurationMinutes !== undefined) {
    newConfig.pauseDurationHours = Number((newConfig.pauseDurationMinutes / 60).toFixed(1));
  }

  if (newConfig.businessHours) {
    newConfig.businessHours = {
      ...current.businessHours,
      ...newConfig.businessHours,
      schedule: {
        ...current.businessHours.schedule,
        ...(newConfig.businessHours.schedule || {})
      },
      holidays: Array.isArray(newConfig.businessHours.holidays)
        ? newConfig.businessHours.holidays
        : (current.businessHours.holidays || [])
    };
  }

  if (newConfig.wahaBaseUrl) {
    newConfig.wahaBaseUrl = newConfig.wahaBaseUrl.replace(/\/$/, '');
  }
  if (newConfig.webhookPublicUrl) {
    newConfig.webhookPublicUrl = newConfig.webhookPublicUrl.replace(/(\/webhook\/(waha|chatwoot))+/gi, '').replace(/\/$/, '');
  }

  const updated = { ...current, ...newConfig };
  
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');

  // Atualiza também as variáveis em memória do objeto env
  if (updated.wahaBaseUrl) env.wahaBaseUrl = updated.wahaBaseUrl;
  if (updated.wahaApiKey !== undefined) env.wahaApiKey = updated.wahaApiKey;
  if (updated.wahaSession) env.wahaSession = updated.wahaSession;
  if (updated.geminiApiKey) env.geminiApiKey = updated.geminiApiKey;
  if (updated.openaiApiKey !== undefined) env.openaiApiKey = updated.openaiApiKey;
  if (updated.openaiModel) env.openaiModel = updated.openaiModel;
  if (updated.llmProvider) env.llmProvider = updated.llmProvider;
  if (updated.webhookPublicUrl) env.webhookPublicUrl = updated.webhookPublicUrl;
  if (updated.adminUser) env.adminUser = updated.adminUser;
  if (updated.adminPassword) env.adminPassword = updated.adminPassword;
  if (updated.enableAudioTranscription !== undefined) env.enableAudioTranscription = updated.enableAudioTranscription;

  return updated;
}

const initialConfig = loadBotConfig();

export const env = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  wahaBaseUrl: (process.env.WAHA_BASE_URL || initialConfig.wahaBaseUrl || 'http://localhost:3000').replace(/\/$/, ''),
  wahaSession: process.env.WAHA_SESSION || initialConfig.wahaSession || 'default',
  wahaApiKey: process.env.WAHA_API_KEY || initialConfig.wahaApiKey || '',
  geminiApiKey: process.env.GEMINI_API_KEY || initialConfig.geminiApiKey || '',
  geminiModel: process.env.GEMINI_MODEL || initialConfig.model || 'gemini-1.5-flash',
  llmProvider: (process.env.LLM_PROVIDER as 'gemini' | 'openai') || initialConfig.llmProvider || 'gemini',
  openaiApiKey: process.env.OPENAI_API_KEY || initialConfig.openaiApiKey || '',
  openaiModel: process.env.OPENAI_MODEL || initialConfig.openaiModel || 'gpt-4o-mini',
  webhookPublicUrl: (process.env.WEBHOOK_PUBLIC_URL || initialConfig.webhookPublicUrl || 'http://localhost:3001').replace(/\/$/, ''),
  adminUser: process.env.ADMIN_USER || initialConfig.adminUser || 'admin',
  adminPassword: process.env.ADMIN_PASSWORD || initialConfig.adminPassword || 'File@152341',
  enableAudioTranscription: initialConfig.enableAudioTranscription ?? false
};
