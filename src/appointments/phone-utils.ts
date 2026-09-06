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
 * Compara dois números de telefone ou chatIds do WhatsApp de forma inteligente,
 * lidando com sufixos (@c.us, @lid), DDI 55, DDD e a variação do 9º dígito móvel brasileiro.
 */
export function matchPhoneOrChatId(a?: string, b?: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;

  const cleanA = a.split('@')[0].replace(/\D/g, '');
  const cleanB = b.split('@')[0].replace(/\D/g, '');

  if (!cleanA || !cleanB) return false;
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
