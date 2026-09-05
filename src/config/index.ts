import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

dotenv.config();

export interface BotConfig {
  botName: string;
  companyName: string;
  model: string;
  temperature: number;
  systemInstruction: string;
  businessInfo: string;
  handoffKeywords: string[];
  handoffMessage: string;
  botActiveByDefault: boolean;
  debounceSeconds: number;
  enableTypingSimulation: boolean;
  enableSendSeen: boolean;
  pauseDurationHours: number;
  pauseDurationMinutes: number;
  geminiApiKey?: string;
  wahaBaseUrl?: string;
  wahaApiKey?: string;
  wahaSession?: string;
  webhookPublicUrl?: string;
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
    botActiveByDefault: stored.botActiveByDefault ?? true,
    debounceSeconds: stored.debounceSeconds ?? 2.5,
    enableTypingSimulation: stored.enableTypingSimulation ?? true,
    enableSendSeen: stored.enableSendSeen ?? true,
    pauseDurationHours: hours,
    pauseDurationMinutes: Math.round(hours * 60),
    geminiApiKey: stored.geminiApiKey || process.env.GEMINI_API_KEY || '',
    wahaBaseUrl: stored.wahaBaseUrl || process.env.WAHA_BASE_URL || 'http://localhost:3000',
    wahaApiKey: stored.wahaApiKey || process.env.WAHA_API_KEY || '',
    wahaSession: stored.wahaSession || process.env.WAHA_SESSION || 'default',
    webhookPublicUrl: stored.webhookPublicUrl || process.env.WEBHOOK_PUBLIC_URL || 'http://localhost:3001'
  };
}

export function saveBotConfig(newConfig: Partial<BotConfig>): BotConfig {
  const current = loadBotConfig();
  
  if (newConfig.pauseDurationHours !== undefined) {
    newConfig.pauseDurationMinutes = Math.round(newConfig.pauseDurationHours * 60);
  } else if (newConfig.pauseDurationMinutes !== undefined) {
    newConfig.pauseDurationHours = Number((newConfig.pauseDurationMinutes / 60).toFixed(1));
  }

  if (newConfig.wahaBaseUrl) {
    newConfig.wahaBaseUrl = newConfig.wahaBaseUrl.replace(/\/$/, '');
  }
  if (newConfig.webhookPublicUrl) {
    newConfig.webhookPublicUrl = newConfig.webhookPublicUrl.replace(/\/$/, '');
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
  if (updated.webhookPublicUrl) env.webhookPublicUrl = updated.webhookPublicUrl;

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
  webhookPublicUrl: (process.env.WEBHOOK_PUBLIC_URL || initialConfig.webhookPublicUrl || 'http://localhost:3001').replace(/\/$/, '')
};
