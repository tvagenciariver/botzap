import { BotConfig, BusinessHoursConfig } from '../config/index.js';

export type DayKey = 'monday' | 'tuesday' | 'wednesday' | 'thursday' | 'friday' | 'saturday' | 'sunday';

export interface BusinessHoursStatus {
  isOpen: boolean;
  reason?: 'disabled' | 'day_closed' | 'before_hours' | 'after_hours' | 'lunch';
  dayKey: DayKey;
  currentDayName: string;
  currentTime: string;
  timezone: string;
  openTime?: string;
  closeTime?: string;
  lunchEnd?: string;
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
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(targetDate);
  let weekdayStr = '';
  let hourStr = '00';
  let minuteStr = '00';

  for (const part of parts) {
    if (part.type === 'weekday') weekdayStr = part.value.toLowerCase();
    if (part.type === 'hour') hourStr = part.value;
    if (part.type === 'minute') minuteStr = part.value;
  }

  // No formatador en-US, 24 pode aparecer como 24 ou 00
  if (hourStr === '24') hourStr = '00';

  const dayKey: DayKey = englishWeekdayToDayKey[weekdayStr] || 'monday';
  const currentDayName = dayNameMap[dayKey] || weekdayStr;
  const currentTime = `${hourStr.padStart(2, '0')}:${minuteStr.padStart(2, '0')}`;
  const currentMinutes = parseInt(hourStr, 10) * 60 + parseInt(minuteStr, 10);

  // 1. Se a funcionalidade estiver desabilitada
  if (!bh || !bh.enabled) {
    return {
      isOpen: true,
      reason: 'disabled',
      dayKey,
      currentDayName,
      currentTime,
      timezone
    };
  }

  const daySchedule = bh.schedule?.[dayKey];

  // 2. Se o dia específico estiver desativado (fechado)
  if (!daySchedule || !daySchedule.enabled) {
    return {
      isOpen: false,
      reason: 'day_closed',
      dayKey,
      currentDayName,
      currentTime,
      timezone
    };
  }

  const startMinutes = parseTimeToMinutes(daySchedule.start || '08:00');
  const endMinutes = parseTimeToMinutes(daySchedule.end || '18:00');

  // 3. Antes do horário de abertura
  if (currentMinutes < startMinutes) {
    return {
      isOpen: false,
      reason: 'before_hours',
      dayKey,
      currentDayName,
      currentTime,
      timezone,
      openTime: daySchedule.start
    };
  }

  // 4. Depois do horário de fechamento
  if (currentMinutes >= endMinutes) {
    return {
      isOpen: false,
      reason: 'after_hours',
      dayKey,
      currentDayName,
      currentTime,
      timezone,
      closeTime: daySchedule.end
    };
  }

  // 5. Intervalo de almoço
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
        timezone,
        lunchEnd: daySchedule.lunchEnd
      };
    }
  }

  // 6. Aberto dentro do expediente
  return {
    isOpen: true,
    dayKey,
    currentDayName,
    currentTime,
    timezone,
    openTime: daySchedule.start,
    closeTime: daySchedule.end
  };
}
