import fs from 'fs';
import path from 'path';
import { matchPhoneOrChatId, lidMapper } from './phone-utils.js';

export interface PendingReminderRecord {
  appointmentId: string;
  targetChatId: string;
  clientPhone: string;
  clientName: string;
  agentId: string;
  session: string;
  sentAt: number;
  messageId?: string;
}

export class PendingReminderTracker {
  private reminders: Map<string, PendingReminderRecord> = new Map();
  private filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;
  private readonly MAX_AGE_MS = 48 * 60 * 60 * 1000; // 48 horas de validade

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'data', 'pending_reminders.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8').replace(/^\uFEFF/, '');
        const data = JSON.parse(raw);
        if (Array.isArray(data)) {
          const now = Date.now();
          for (const item of data) {
            if (item && item.appointmentId && item.sentAt && (now - item.sentAt < this.MAX_AGE_MS)) {
              this.reminders.set(item.appointmentId, item);
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[PendingReminderTracker] Aviso ao carregar pending_reminders.json:', err.message);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const list = Array.from(this.reminders.values());
        fs.writeFileSync(this.filePath, JSON.stringify(list, null, 2), 'utf-8');
      } catch (err: any) {
        console.error('[PendingReminderTracker] Erro ao salvar pending_reminders.json:', err.message);
      }
    }, 500);
  }

  /**
   * Registra um lembrete D-1 recém-enviado
   */
  public recordReminder(record: Omit<PendingReminderRecord, 'sentAt'> & { sentAt?: number }): void {
    const fullRecord: PendingReminderRecord = {
      ...record,
      sentAt: record.sentAt || Date.now()
    };
    this.reminders.set(fullRecord.appointmentId, fullRecord);
    this.scheduleSave();
    console.log(`[PendingReminderTracker] 📝 Lembrete registrado para rastreamento: aptId=${fullRecord.appointmentId}, cliente="${fullRecord.clientName}", target=${fullRecord.targetChatId}`);
  }

  /**
   * Atualiza o messageId gerado pela WAHA após o envio
   */
  public setMessageId(appointmentId: string, messageId?: string): void {
    if (!messageId) return;
    const existing = this.reminders.get(appointmentId);
    if (existing) {
      existing.messageId = messageId;
      this.scheduleSave();
    }
  }

  /**
   * Marca o lembrete como respondido/resolvido
   */
  public markResolved(appointmentId: string): void {
    if (this.reminders.delete(appointmentId)) {
      this.scheduleSave();
      console.log(`[PendingReminderTracker] ✅ Lembrete resolvido e removido do rastreamento ativo: aptId=${appointmentId}`);
    }
  }

  /**
   * Busca agendamento pendente a partir dos metadados da mensagem recebida
   */
  public findPendingReminder(params: {
    chatId: string;
    contactName?: string;
    session?: string;
    agentId?: string;
    quotedMessageId?: string;
  }): PendingReminderRecord | undefined {
    const now = Date.now();
    const active = Array.from(this.reminders.values()).filter(r => (now - r.sentAt) < this.MAX_AGE_MS);

    if (active.length === 0) {
      return undefined;
    }

    const { chatId, contactName, session, agentId, quotedMessageId } = params;

    // 1. Match exato por quotedMessageId (se o paciente respondeu citando a mensagem de lembrete)
    if (quotedMessageId) {
      const matchQuote = active.find(r => r.messageId && r.messageId === quotedMessageId);
      if (matchQuote) {
        console.log(`[PendingReminderTracker] 🎯 Match por quotedMessageId: ${quotedMessageId} -> aptId=${matchQuote.appointmentId}`);
        if (chatId.endsWith('@lid')) {
          lidMapper.register(chatId, matchQuote.targetChatId);
        }
        return matchQuote;
      }
    }

    // 2. Match por telefone ou aliases (inclui mapeamentos prévios de LID e nono dígito)
    for (const r of active) {
      if (matchPhoneOrChatId(r.targetChatId, chatId) || matchPhoneOrChatId(r.clientPhone, chatId)) {
        console.log(`[PendingReminderTracker] 🎯 Match por telefone/chatId: ${chatId} -> aptId=${r.appointmentId}`);
        if (chatId.endsWith('@lid')) {
          lidMapper.register(chatId, r.targetChatId);
        }
        return r;
      }
    }

    // 3. Match por correlação de Nome de Contato (especialmente quando WhatsApp usa @lid não mapeado)
    if (contactName && contactName.trim().length >= 3) {
      const cleanContact = contactName.toLowerCase().trim().replace(/[^a-z0-9áéíóúãõç\s]/g, '');
      const contactTokens = cleanContact.split(/\s+/).filter(t => t.length >= 3);

      for (const r of active) {
        const cleanClient = r.clientName.toLowerCase().trim().replace(/[^a-z0-9áéíóúãõç\s]/g, '');
        const clientTokens = cleanClient.split(/\s+/).filter(t => t.length >= 3);

        // Se o primeiro nome bate exatamente (ex: "eugenio" === "eugenio")
        const firstMatch = contactTokens.length > 0 && clientTokens.length > 0 && contactTokens[0] === clientTokens[0];
        
        // Se há pelo menos um token relevante em comum
        const sharedToken = contactTokens.some(ct => clientTokens.includes(ct));

        if (firstMatch || sharedToken) {
          console.log(`[PendingReminderTracker] 🎯 Match por correlação de Nome: contactName="${contactName}", clientName="${r.clientName}" -> aptId=${r.appointmentId}`);
          if (chatId.endsWith('@lid')) {
            lidMapper.register(chatId, r.targetChatId);
          }
          return r;
        }
      }
    }

    // 4. Se a sessão ou o agentId bate e há apenas UM lembrete pendente recente (enviado nas últimas 24h)
    const recentWindow = 24 * 60 * 60 * 1000;
    const sameSessionReminders = active.filter(r => 
      (now - r.sentAt < recentWindow) &&
      (!session || session === '*' || r.session === session) &&
      (!agentId || agentId === 'all' || r.agentId === agentId)
    );

    if (sameSessionReminders.length === 1) {
      const singleMatch = sameSessionReminders[0];
      console.log(`[PendingReminderTracker] 🎯 Match único por sessão recente (${singleMatch.session}): aptId=${singleMatch.appointmentId} (${singleMatch.clientName})`);
      if (chatId.endsWith('@lid')) {
        lidMapper.register(chatId, singleMatch.targetChatId);
      }
      return singleMatch;
    }

    // 5. Se em todo o sistema há apenas UM lembrete pendente recente enviado nas últimas 6 horas
    const superRecent = active.filter(r => (now - r.sentAt < 6 * 60 * 60 * 1000));
    if (superRecent.length === 1) {
      const globalSingle = superRecent[0];
      console.log(`[PendingReminderTracker] 🎯 Match único global super recente (<6h): aptId=${globalSingle.appointmentId} (${globalSingle.clientName})`);
      if (chatId.endsWith('@lid')) {
        lidMapper.register(chatId, globalSingle.targetChatId);
      }
      return globalSingle;
    }

    return undefined;
  }
}

export const pendingReminderTracker = new PendingReminderTracker();
