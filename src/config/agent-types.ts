import { BusinessHoursConfig } from './index.js';

export interface AgentProfile {
  id: string; // identificador único (slug ou uuid)
  name: string; // nome do bot (ex: "Sofia")
  companyName: string; // nome da empresa (ex: "Unimagem")
  description?: string; // observação interna sobre o cliente
  active: boolean; // se o bot está ativo
  isDefault?: boolean; // se é o agente padrão de contingência
  wahaSession?: string; // sessão da WAHA vinculada (ex: "unimagem" ou "*")
  
  // Provedor de IA e Parâmetros
  llmProvider: 'gemini' | 'openai';
  model: string; // Modelo Gemini (ex: gemini-flash-lite-latest)
  openaiModel: string; // Modelo OpenAI (ex: gpt-4o-mini)
  temperature: number;
  geminiApiKey?: string;
  openaiApiKey?: string;

  // Prompts e Conhecimento
  systemInstruction: string;
  businessInfo: string;

  // Transbordo Humano e Pausa
  handoffKeywords: string[];
  handoffMessage: string;
  mediaHandoffMessage?: string;
  pauseDurationHours: number;
  pauseDurationMinutes: number;
  debounceSeconds: number;
  enableTypingSimulation: boolean;
  enableSendSeen: boolean;
  enableAudioTranscription?: boolean;

  // Horário Comercial Próprio
  businessHours: BusinessHoursConfig;

  createdAt: number;
  updatedAt: number;
}
