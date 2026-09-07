import fs from 'fs';
import path from 'path';
import { AgentProfile } from './agent-types.js';
import { loadBotConfig, defaultBusinessHours } from './index.js';

const agentsFilePath = path.resolve(process.cwd(), 'data', 'agents.json');

export class AgentManager {
  private agents: Map<string, AgentProfile> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(agentsFilePath)) {
        const raw = fs.readFileSync(agentsFilePath, 'utf-8');
        const list: AgentProfile[] = JSON.parse(raw);
        if (Array.isArray(list) && list.length > 0) {
          this.agents.clear();
          for (const a of list) {
            if (a && a.id) {
              this.agents.set(a.id, a);
            }
          }
          console.log(`[AgentManager] ${this.agents.size} agente(s) carregado(s) com sucesso.`);
          return;
        }
      }
    } catch (err: any) {
      console.warn('[AgentManager] Aviso ao carregar agents.json:', err.message);
    }

    // Se o arquivo não existir ou estiver vazio, faz a migração automática das configurações existentes
    this.migrateFromBotConfig();
  }

  private migrateFromBotConfig(): void {
    console.log('[AgentManager] Inicializando migração automática do agente a partir de bot_config.json...');
    const config = loadBotConfig();

    const defaultAgent: AgentProfile = {
      id: 'default',
      name: config.botName || 'Assistente Virtual',
      companyName: config.companyName || 'Minha Empresa',
      description: 'Agente Principal Migrado',
      active: true,
      isDefault: true,
      wahaSession: '*',
      llmProvider: config.llmProvider || 'openai',
      model: config.model || 'gemini-flash-lite-latest',
      openaiModel: config.openaiModel || 'gpt-4o-mini',
      temperature: config.temperature ?? 0.4,
      geminiApiKey: config.geminiApiKey || '',
      openaiApiKey: config.openaiApiKey || '',
      systemInstruction: config.systemInstruction || 'Você é um atendente inteligente e prestativo para WhatsApp.',
      businessInfo: config.businessInfo || '',
      handoffKeywords: config.handoffKeywords || ['atendente', 'humano', 'suporte', 'pessoa'],
      handoffMessage: config.handoffMessage || 'Entendido! Estou transferindo sua conversa para um de nossos atendentes humanos.',
      pauseDurationHours: config.pauseDurationHours || 6,
      pauseDurationMinutes: config.pauseDurationMinutes || 360,
      debounceSeconds: config.debounceSeconds ?? 2.5,
      enableTypingSimulation: config.enableTypingSimulation !== false,
      enableSendSeen: config.enableSendSeen !== false,
      enableAudioTranscription: config.enableAudioTranscription ?? false,
      businessHours: config.businessHours || defaultBusinessHours,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    this.agents.set(defaultAgent.id, defaultAgent);
    this.saveToDisk();
    console.log(`[AgentManager] Agente padrão "${defaultAgent.name}" criado com sucesso.`);
  }

  private saveToDisk(): void {
    try {
      const dir = path.dirname(agentsFilePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      const list = Array.from(this.agents.values());
      fs.writeFileSync(agentsFilePath, JSON.stringify(list, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[AgentManager] Erro ao salvar agents.json:', err.message);
    }
  }

  listAgents(): AgentProfile[] {
    return Array.from(this.agents.values()).sort((a, b) => {
      if (a.isDefault) return -1;
      if (b.isDefault) return 1;
      return a.name.localeCompare(b.name);
    });
  }

  getAgent(id: string): AgentProfile | null {
    return this.agents.get(id) || null;
  }

  getDefaultAgent(): AgentProfile {
    for (const a of this.agents.values()) {
      if (a.isDefault && a.active) return a;
    }
    for (const a of this.agents.values()) {
      if (a.isDefault) return a;
    }
    const first = this.agents.values().next().value;
    if (first) return first;

    // Fallback absoluto
    this.migrateFromBotConfig();
    return this.agents.get('default')!;
  }

  /**
   * Encontra o agente correto para a mensagem recebida pelo nome da sessão da WAHA
   */
  getAgentBySession(session: string): AgentProfile {
    if (session) {
      const cleanSession = session.trim().toLowerCase();
      // 1. Busca correspondência exata de sessão
      for (const a of this.agents.values()) {
        if (a.active && a.wahaSession && a.wahaSession.trim().toLowerCase() === cleanSession) {
          return a;
        }
      }
    }

    // 2. Busca agente curinga (*)
    for (const a of this.agents.values()) {
      if (a.active && a.wahaSession === '*') {
        return a;
      }
    }

    // 3. Fallback para agente padrão
    return this.getDefaultAgent();
  }

  createAgent(data: Partial<AgentProfile>): AgentProfile {
    const rawName = (data.name || 'Novo Agente').trim();
    const slug = (data.id || rawName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '') || 'agente')
      + '-' + Math.random().toString(36).substring(2, 6);

    const defaultHours = defaultBusinessHours;

    const newAgent: AgentProfile = {
      id: slug,
      name: rawName,
      companyName: data.companyName || 'Empresa Cliente',
      description: data.description || '',
      active: data.active !== false,
      isDefault: !!data.isDefault,
      wahaSession: data.wahaSession || '*',
      llmProvider: data.llmProvider || 'openai',
      model: data.model || 'gemini-flash-lite-latest',
      openaiModel: data.openaiModel || 'gpt-4o-mini',
      temperature: data.temperature ?? 0.4,
      geminiApiKey: data.geminiApiKey || '',
      openaiApiKey: data.openaiApiKey || '',
      systemInstruction: data.systemInstruction || 'Você é o atendente inteligente da {companyName} no WhatsApp.',
      businessInfo: data.businessInfo || '',
      handoffKeywords: data.handoffKeywords || ['atendente', 'humano', 'suporte'],
      handoffMessage: data.handoffMessage || 'Estou transferindo para nossa equipe humana.',
      pauseDurationHours: data.pauseDurationHours || 6,
      pauseDurationMinutes: data.pauseDurationMinutes || 360,
      debounceSeconds: data.debounceSeconds ?? 2.5,
      enableTypingSimulation: data.enableTypingSimulation !== false,
      enableSendSeen: data.enableSendSeen !== false,
      enableAudioTranscription: !!data.enableAudioTranscription,
      businessHours: data.businessHours || defaultHours,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };

    if (newAgent.isDefault) {
      // Remove isDefault dos demais
      for (const a of this.agents.values()) {
        a.isDefault = false;
      }
    }

    this.agents.set(newAgent.id, newAgent);
    this.saveToDisk();
    return newAgent;
  }

  updateAgent(id: string, updates: Partial<AgentProfile>): AgentProfile {
    const existing = this.agents.get(id);
    if (!existing) {
      throw new Error(`Agente com ID "${id}" não encontrado.`);
    }

    if (updates.isDefault) {
      for (const a of this.agents.values()) {
        if (a.id !== id) a.isDefault = false;
      }
    }

    if (updates.pauseDurationHours !== undefined) {
      updates.pauseDurationMinutes = Math.round(updates.pauseDurationHours * 60);
    }

    const updated: AgentProfile = {
      ...existing,
      ...updates,
      id: existing.id, // ID não muda
      updatedAt: Date.now()
    };

    this.agents.set(id, updated);
    this.saveToDisk();
    return updated;
  }

  duplicateAgent(id: string): AgentProfile {
    const source = this.agents.get(id);
    if (!source) {
      throw new Error(`Agente com ID "${id}" não encontrado para duplicar.`);
    }

    const copyData: Partial<AgentProfile> = {
      ...source,
      name: `${source.name} (Cópia)`,
      isDefault: false,
      wahaSession: ''
    };
    delete copyData.id;

    return this.createAgent(copyData);
  }

  deleteAgent(id: string): boolean {
    if (this.agents.size <= 1) {
      throw new Error('Não é possível excluir o único agente cadastrado no sistema.');
    }

    const agent = this.agents.get(id);
    if (!agent) return false;

    if (agent.isDefault) {
      throw new Error('Não é possível excluir o agente padrão. Defina outro agente como padrão antes de excluir este.');
    }

    this.agents.delete(id);
    this.saveToDisk();
    return true;
  }
}

export const agentManager = new AgentManager();
