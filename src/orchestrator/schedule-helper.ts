import { BotConfig, BusinessHoursConfig, HolidayItem } from '../config/index.js';

export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface BusinessHoursStatus {
  isOpen: boolean;
  reason?: 'disabled' | 'day_closed' | 'before_hours' | 'after_hours' | 'lunch' | 'holiday';
  dayKey: DayKey;
  currentDayName: string;
  currentTime: string;
  currentDate?: string;
  timezone: string;
  openTime?: string;
  closeTime?: string;
  lunchEnd?: string;
  holidayName?: string;
  holidayMessage?: string;
}

const dayNameMap: Record<DayKey, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo'
};

const englishWeekdayToDayKey: Record<string, DayKey> = {
  monday: 'monday',
  tuesday: 'tuesday',
  wednesday: 'wednesday',
  thursday: 'thursday',
  friday: 'friday',
  saturday: 'saturday',
  sunday: 'sunday'
};

function parseTimeToMinutes(timeStr: string): number {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  return (h || 0) * 60 + (m || 0);
}

/**
 * Normaliza qualquer formato de data (YYYY-MM-DD, DD/MM/YYYY, MM-DD, DD/MM) para comparação
 */
export function isHolidayDate(targetDateStr: string, holidays?: HolidayItem[]): HolidayItem | undefined {
  if (!holidays || !Array.isArray(holidays) || holidays.length === 0) return undefined;
  if (!targetDateStr) return undefined;

  // Normaliza targetDateStr para YYYY-MM-DD e MM-DD
  let cleanTarget = targetDateStr.trim();
  let targetIso = '';
  let targetMonthDay = '';

  if (cleanTarget.includes('/')) {
    const parts = cleanTarget.split('/');
    if (parts.length === 2) {
      const [d, m] = parts;
      targetMonthDay = `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    } else if (parts.length === 3) {
      const [d, m, y] = parts;
      targetIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
      targetMonthDay = `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
    }
  } else if (cleanTarget.includes('-')) {
    if (cleanTarget.length === 10) {
      targetIso = cleanTarget;
      targetMonthDay = cleanTarget.substring(5);
    } else if (cleanTarget.length === 5) {
      targetMonthDay = cleanTarget;
    }
  }

  return holidays.find(h => {
    if (h.enabled === false) return false;
    const hDate = (h.date || '').trim();
    if (!hDate) return false;

    // Correspondência direta com YYYY-MM-DD ou MM-DD
    if (targetIso && hDate === targetIso) return true;
    if (targetMonthDay && hDate === targetMonthDay) return true;

    // Se o feriado foi cadastrado como DD/MM ou DD/MM/YYYY
    if (hDate.includes('/')) {
      const p = hDate.split('/');
      if (p.length === 2) {
        const [d, m] = p;
        const hMonthDay = `${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        if (targetMonthDay && targetMonthDay === hMonthDay) return true;
      } else if (p.length === 3) {
        const [d, m, y] = p;
        const hIso = `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
        if (targetIso && targetIso === hIso) return true;
      }
    }

    return false;
  });
}

/**
 * Avalia se o momento atual (ou data informada) está dentro do horário comercial configurado
 */
export function checkBusinessHoursStatus(
  configOrHours: BotConfig | BusinessHoursConfig | { businessHours?: BusinessHoursConfig },
  targetDate: Date = new Date()
): BusinessHoursStatus {
  const bh: BusinessHoursConfig | undefined = (configOrHours as any)?.businessHours !== undefined
    ? (configOrHours as any).businessHours
    : (configOrHours as BusinessHoursConfig);
  const timezone = bh?.timezone || 'America/Sao_Paulo';

  // Formata a data no timezone configurado
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'long',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(targetDate);
  let weekdayStr = '';
  let yearStr = '2026';
  let monthStr = '01';
  let dayStr = '01';
  let hourStr = '00';
  let minuteStr = '00';

  for (const part of parts) {
    if (part.type === 'weekday') weekdayStr = part.value.toLowerCase();
    if (part.type === 'year') yearStr = part.value;
    if (part.type === 'month') monthStr = part.value;
    if (part.type === 'day') dayStr = part.value;
    if (part.type === 'hour') hourStr = part.value;
    if (part.type === 'minute') minuteStr = part.value;
  }

  // No formatador en-US, 24 pode aparecer como 24 ou 00
  if (hourStr === '24') hourStr = '00';

  const dayKey: DayKey = englishWeekdayToDayKey[weekdayStr] || 'monday';
  const currentDayName = dayNameMap[dayKey] || weekdayStr;
  const currentTime = `${hourStr.padStart(2, '0')}:${minuteStr.padStart(2, '0')}`;
  const currentDate = `${yearStr}-${monthStr.padStart(2, '0')}-${dayStr.padStart(2, '0')}`;
  const currentMinutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);

  // 1. Se a funcionalidade estiver desabilitada
  if (!bh || !bh.enabled) {
    return {
      isOpen: true,
      reason: 'disabled',
      dayKey,
      currentDayName,
      currentTime,
      currentDate,
      timezone
    };
  }

  // 2. Verificação prioritária de Feriados Municipais / Nacionais / Indisponibilidades
  const holiday = isHolidayDate(currentDate, bh.holidays);
  if (holiday) {
    return {
      isOpen: false,
      reason: 'holiday',
      dayKey,
      currentDayName,
      currentTime,
      currentDate,
      timezone,
      holidayName: holiday.name,
      holidayMessage: holiday.outOfHoursMessage
    };
  }

  const daySchedule = bh.schedule?.[dayKey];

  // 3. Se o dia específico da semana estiver desativado (fechado)
  if (!daySchedule || !daySchedule.enabled) {
    return {
      isOpen: false,
      reason: 'day_closed',
      dayKey,
      currentDayName,
      currentTime,
      currentDate,
      timezone
    };
  }

  const startMinutes = parseTimeToMinutes(daySchedule.start || '08:00');
  const endMinutes = parseTimeToMinutes(daySchedule.end || '18:00');

  // 4. Antes do horário de abertura
  if (currentMinutes < startMinutes) {
    return {
      isOpen: false,
      reason: 'before_hours',
      dayKey,
      currentDayName,
      currentTime,
      currentDate,
      timezone,
      openTime: daySchedule.start
    };
  }

  // 5. Depois do horário de fechamento
  if (currentMinutes >= endMinutes) {
    return {
      isOpen: false,
      reason: 'after_hours',
      dayKey,
      currentDayName,
      currentTime,
      currentDate,
      timezone,
      closeTime: daySchedule.end
    };
  }

  // 6. Intervalo de almoço
  if (daySchedule.hasLunch && daySchedule.lunchStart && daySchedule.lunchEnd) {
    const lunchStartMinutes = parseTimeToMinutes(daySchedule.lunchStart);
    const lunchEndMinutes = parseTimeToMinutes(daySchedule.lunchEnd);

    if (currentMinutes >= lunchStartMinutes && currentMinutes < lunchEndMinutes) {
      return {
        isOpen: false,
        reason: 'lunch',
        dayKey,
        currentDayName,
        currentTime,
        currentDate,
        timezone,
        lunchEnd: daySchedule.lunchEnd
      };
    }
  }

  // 7. Aberto dentro do expediente
  return {
    isOpen: true,
    dayKey,
    currentDayName,
    currentTime,
    currentDate,
    timezone,
    openTime: daySchedule.start,
    closeTime: daySchedule.end
  };
}
