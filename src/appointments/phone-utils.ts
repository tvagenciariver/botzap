import fs from 'fs';
import path from 'path';

/**
 * Utilitários centralizados para telefone e ChatIDs do WhatsApp
 */

/**
 * Formata telefone para o padrão de chatId do WhatsApp (ex: 5511999998888@c.us)
 * Garante o DDI 55 do Brasil para números com 10 ou 11 dígitos.
 */
export function formatToWhatsAppChatId(phoneStr: string): string {
  if (!phoneStr) return '';
  let digits = phoneStr.replace(/\D/g, '');
  if (!digits) return '';

  // Remove zero inicial se houver (ex: 011999998888 -> 11999998888)
  if (digits.startsWith('0') && (digits.length === 11 || digits.length === 12)) {
    digits = digits.substring(1);
  }

  // Se for número brasileiro com 10 ou 11 dígitos (DDD + número) sem o DDI 55
  if ((digits.length === 10 || digits.length === 11) && !digits.startsWith('55')) {
    digits = '55' + digits;
  }

  return `${digits}@c.us`;
}

/**
 * Retorna o chatId alternativo brasileiro (com ou sem o 9º dígito), se aplicável.
 * No WhatsApp, contas brasileiras mais antigas usam 8 dígitos no JID (55XXYYYYYYYY@c.us),
 * enquanto contas mais novas usam 9 dígitos (55XX9YYYYYYYY@c.us).
 */
export function getAlternateBrazilianChatId(chatId: string): string | null {
  if (!chatId || !chatId.endsWith('@c.us')) return null;
  const num = chatId.replace('@c.us', '');

  // Caso 1: 13 dígitos brasileiros (55 + 2 DDD + 9 + 8 dígitos) -> Retorna versão com 12 dígitos sem o 9
  const match13 = num.match(/^55(\d{2})9(\d{8})$/);
  if (match13) {
    const [, ddd, rest] = match13;
    return `55${ddd}${rest}@c.us`;
  }

  // Caso 2: 12 dígitos brasileiros (55 + 2 DDD + 8 dígitos iniciando em 6, 7, 8 ou 9) -> Retorna versão com 13 dígitos com o 9
  const match12 = num.match(/^55(\d{2})([6-9]\d{7})$/);
  if (match12) {
    const [, ddd, rest] = match12;
    return `55${ddd}9${rest}@c.us`;
  }

  return null;
}

/**
 * Identifica se um chatId pertence ao Simulador de Chat do painel web
 */
export function isSimulatorChatId(chatId?: string): boolean {
  if (!chatId) return false;
  return chatId.startsWith('simulador_') ||
    chatId.startsWith('sim_') ||
    chatId === 'simulacao@c.us' ||
    chatId === 'simulator';
}

/**
 * Compara dois números de telefone ou chatIds do WhatsApp de forma inteligente,
 * lidando com sufixos (@c.us, @lid), DDI 55, DDD e a variação do 9º dígito móvel brasileiro.
 */
export function matchPhoneOrChatId(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  let cleanA = a.split('@')[0].split(':')[0].replace(/\D/g, '');
  let cleanB = b.split('@')[0].split(':')[0].replace(/\D/g, '');

  if (!cleanA || !cleanB) return false;
  if (cleanA === cleanB) return true;

  // Remove zero à esquerda no DDD se houver (ex: 087988177877 -> 87988177877)
  if (cleanA.startsWith('0') && cleanA.length >= 11) cleanA = cleanA.substring(1);
  if (cleanB.startsWith('0') && cleanB.length >= 11) cleanB = cleanB.substring(1);

  if (cleanA === cleanB) return true;

  // Se um terminar com o outro (ex: 5587988177877 termina com 87988177877)
  if (cleanA.endsWith(cleanB) || cleanB.endsWith(cleanA)) return true;

  // Normalização do 9º dígito brasileiro:
  // Se tiver 12 ou 13 dígitos começando com 55, remove o DDI 55
  const numA = cleanA.startsWith('55') && (cleanA.length === 12 || cleanA.length === 13) ? cleanA.substring(2) : cleanA;
  const numB = cleanB.startsWith('55') && (cleanB.length === 12 || cleanB.length === 13) ? cleanB.substring(2) : cleanB;

  // Se ambos tiverem DDD + número (10 ou 11 dígitos)
  if (numA.length >= 10 && numB.length >= 10) {
    const dddA = numA.substring(0, 2);
    const dddB = numB.substring(0, 2);
    const last8A = numA.slice(-8);
    const last8B = numB.slice(-8);
    // Se ambos possuem DDD, os DDDs devem obrigatoriamente ser iguais
    return dddA === dddB && last8A === last8B;
  }

  // Fallback: se um dos dois não possui DDD (ex: número local de 8 ou 9 dígitos)
  if (cleanA.length >= 8 && cleanB.length >= 8 && cleanA.slice(-8) === cleanB.slice(-8)) {
    return true;
  }

  return false;
}

class LidPhoneMapper {
  private lidToPhone: Map<string, string> = new Map();
  private phoneToLid: Map<string, string> = new Map();
  private filePath: string;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor() {
    this.filePath = path.resolve(process.cwd(), 'data', 'lid_mappings.json');
    this.load();
  }

  private load(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const data = JSON.parse(raw);
        if (data && typeof data === 'object') {
          for (const [lid, phone] of Object.entries(data)) {
            if (typeof phone === 'string') {
              this.lidToPhone.set(lid, phone);
              this.phoneToLid.set(phone, lid);
              const alt = getAlternateBrazilianChatId(phone);
              if (alt) {
                this.phoneToLid.set(alt, lid);
              }
            }
          }
        }
      }
    } catch (err: any) {
      console.warn('[LidPhoneMapper] Aviso ao carregar lid_mappings.json:', err.message);
    }
  }

  private scheduleSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      try {
        const dir = path.dirname(this.filePath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const obj: Record<string, string> = {};
        for (const [lid, phone] of this.lidToPhone.entries()) {
          obj[lid] = phone;
        }
        fs.writeFileSync(this.filePath, JSON.stringify(obj, null, 2), 'utf-8');
      } catch (err: any) {
        console.error('[LidPhoneMapper] Erro ao salvar lid_mappings.json:', err.message);
      }
    }, 1000);
  }

  register(a: string, b: string): void {
    if (!a || !b || a === b) return;
    let lid = '';
    let phone = '';

    if (a.endsWith('@lid')) {
      lid = a;
      phone = b;
    } else if (b.endsWith('@lid')) {
      lid = b;
      phone = a;
    } else {
      return;
    }

    if (lid.includes(':')) {
      const atIdx = lid.indexOf('@');
      const colonIdx = lid.indexOf(':');
      if (colonIdx !== -1 && colonIdx < atIdx) {
        lid = lid.substring(0, colonIdx) + lid.substring(atIdx);
      }
    }

    let cleanPhone = phone;
    if (cleanPhone.includes(':')) {
      const atIdx = cleanPhone.indexOf('@');
      const colonIdx = cleanPhone.indexOf(':');
      if (colonIdx !== -1 && colonIdx < atIdx) {
        cleanPhone = cleanPhone.substring(0, colonIdx) + cleanPhone.substring(atIdx);
      }
    }
    if (cleanPhone.endsWith('@s.whatsapp.net')) {
      cleanPhone = cleanPhone.replace('@s.whatsapp.net', '@c.us');
    } else if (!cleanPhone.endsWith('@c.us')) {
      cleanPhone = formatToWhatsAppChatId(cleanPhone);
    }

    if (!cleanPhone || !cleanPhone.endsWith('@c.us')) return;

    this.lidToPhone.set(lid, cleanPhone);
    this.phoneToLid.set(cleanPhone, lid);

    const alt = getAlternateBrazilianChatId(cleanPhone);
    if (alt) {
      this.phoneToLid.set(alt, lid);
    }

    this.scheduleSave();
  }

  getPhone(lid: string): string | undefined {
    let cleanLid = lid;
    if (cleanLid.includes(':')) {
      const atIdx = cleanLid.indexOf('@');
      const colonIdx = cleanLid.indexOf(':');
      if (colonIdx !== -1 && colonIdx < atIdx) {
        cleanLid = cleanLid.substring(0, colonIdx) + cleanLid.substring(atIdx);
      }
    }
    return this.lidToPhone.get(cleanLid) || this.lidToPhone.get(lid);
  }

  getLid(phone: string): string | undefined {
    let cleanPhone = phone;
    if (cleanPhone.includes(':')) {
      const atIdx = cleanPhone.indexOf('@');
      const colonIdx = cleanPhone.indexOf(':');
      if (colonIdx !== -1 && colonIdx < atIdx) {
        cleanPhone = cleanPhone.substring(0, colonIdx) + cleanPhone.substring(atIdx);
      }
    }
    if (cleanPhone.endsWith('@s.whatsapp.net')) {
      cleanPhone = cleanPhone.replace('@s.whatsapp.net', '@c.us');
    }
    const direct = this.phoneToLid.get(cleanPhone) || this.phoneToLid.get(phone);
    if (direct) return direct;

    const alt = getAlternateBrazilianChatId(cleanPhone);
    if (alt) {
      return this.phoneToLid.get(alt);
    }
    return undefined;
  }
}

export const lidMapper = new LidPhoneMapper();

/**
 * Retorna todos os aliases conhecidos para um chatId (incluindo variações de 9º dígito
 * e mapeamentos de @lid para @c.us e vice-versa).
 */
export function getAllChatIdAliases(chatId: string): string[] {
  if (!chatId) return [];
  const aliases = new Set<string>();

  aliases.add(chatId);

  // Remove sufixo de dispositivo multi-device (:1, :0) se houver
  let cleanId = chatId;
  if (cleanId.includes(':')) {
    const atIdx = cleanId.indexOf('@');
    const colonIdx = cleanId.indexOf(':');
    if (colonIdx !== -1 && colonIdx < atIdx) {
      cleanId = cleanId.substring(0, colonIdx) + cleanId.substring(atIdx);
      aliases.add(cleanId);
    }
  }

  // Normaliza @s.whatsapp.net para @c.us
  if (cleanId.endsWith('@s.whatsapp.net')) {
    const cUs = cleanId.replace('@s.whatsapp.net', '@c.us');
    aliases.add(cUs);
    cleanId = cUs;
  }

  // Se for LID
  if (cleanId.endsWith('@lid')) {
    const mappedPhone = lidMapper.getPhone(cleanId);
    if (mappedPhone) {
      aliases.add(mappedPhone);
      const altPhone = getAlternateBrazilianChatId(mappedPhone);
      if (altPhone) aliases.add(altPhone);
    }
  } else if (cleanId.endsWith('@c.us')) {
    const altPhone = getAlternateBrazilianChatId(cleanId);
    if (altPhone) {
      aliases.add(altPhone);
    }
    const mappedLid = lidMapper.getLid(cleanId);
    if (mappedLid) {
      aliases.add(mappedLid);
    }
    if (altPhone) {
      const altLid = lidMapper.getLid(altPhone);
      if (altLid) aliases.add(altLid);
    }
  }

  return Array.from(aliases);
}

