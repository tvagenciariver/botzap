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
  pauseDurationMinutes: number;
  geminiApiKey?: string;
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
    pauseDurationMinutes: stored.pauseDurationMinutes ?? 60,
    geminiApiKey: stored.geminiApiKey || process.env.GEMINI_API_KEY || ''
  };
}

export function saveBotConfig(newConfig: Partial<BotConfig>): BotConfig {
  const current = loadBotConfig();
  const updated = { ...current, ...newConfig };
  
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(configPath, JSON.stringify(updated, null, 2), 'utf-8');
  return updated;
}

export const env = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  wahaBaseUrl: (process.env.WAHA_BASE_URL || 'http://localhost:3000').replace(/\/$/, ''),
  wahaSession: process.env.WAHA_SESSION || 'default',
  wahaApiKey: process.env.WAHA_API_KEY || '',
  geminiApiKey: process.env.GEMINI_API_KEY || loadBotConfig().geminiApiKey || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
  webhookPublicUrl: (process.env.WEBHOOK_PUBLIC_URL || 'http://localhost:3001').replace(/\/$/, '')
};
