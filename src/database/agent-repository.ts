import { query, isDatabaseConnected } from './db.js';
import { AgentProfile } from '../config/agent-types.js';

export function mapRowToAgent(row: any): AgentProfile {
  return {
    id: row.id,
    name: row.name,
    companyName: row.company_name,
    description: row.description || '',
    active: row.active !== false,
    isPausedGlobally: !!row.is_paused_globally,
    pausedGloballyUntil: row.paused_globally_until ? Number(row.paused_globally_until) : undefined,
    isDefault: !!row.is_default,
    wahaSession: row.waha_session || '*',
    phoneNumber: row.phone_number || undefined,
    llmProvider: row.llm_provider || 'openai',
    model: row.model || 'gemini-flash-lite-latest',
    openaiModel: row.openai_model || 'gpt-4o-mini',
    temperature: parseFloat(row.temperature) || 0.4,
    geminiApiKey: row.gemini_api_key || '',
    openaiApiKey: row.openai_api_key || '',
    systemInstruction: row.system_instruction,
    businessInfo: row.business_info || '',
    handoffKeywords: Array.isArray(row.handoff_keywords) ? row.handoff_keywords : (typeof row.handoff_keywords === 'string' ? JSON.parse(row.handoff_keywords) : []),
    handoffMessage: row.handoff_message || '',
    mediaHandoffMessage: row.media_handoff_message || undefined,
    pauseDurationHours: parseFloat(row.pause_duration_hours) || 6,
    pauseDurationMinutes: parseInt(row.pause_duration_minutes, 10) || 360,
    debounceSeconds: parseFloat(row.debounce_seconds) || 2.5,
    enableTypingSimulation: row.enable_typing_simulation !== false,
    enableSendSeen: row.enable_send_seen !== false,
    keepChatUnread: !!row.keep_chat_unread,
    enableAudioTranscription: !!row.enable_audio_transcription,
    ignoredNumbers: Array.isArray(row.ignored_numbers) ? row.ignored_numbers : (typeof row.ignored_numbers === 'string' ? JSON.parse(row.ignored_numbers) : []),
    businessHours: typeof row.business_hours === 'object' && row.business_hours !== null ? row.business_hours : (typeof row.business_hours === 'string' ? JSON.parse(row.business_hours) : {}),
    enableBooking: !!row.enable_booking,
    enableAutoReminders: row.enable_auto_reminders !== false,
    autoReminderTime: row.auto_reminder_time || '18:00',
    lastAutoReminderDate: row.last_auto_reminder_date || '',
    promptHistory: Array.isArray(row.prompt_history) ? row.prompt_history : (typeof row.prompt_history === 'string' ? JSON.parse(row.prompt_history) : []),
    createdAt: Number(row.created_at) || Date.now(),
    updatedAt: Number(row.updated_at) || Date.now(),
  };
}

export async function getAllAgentsFromDb(): Promise<AgentProfile[]> {
  if (!isDatabaseConnected()) return [];
  try {
    const res = await query('SELECT * FROM agents ORDER BY is_default DESC, name ASC');
    return res.rows.map(mapRowToAgent);
  } catch (err: any) {
    console.error('[PostgreSQL] Erro ao buscar agentes:', err.message);
    return [];
  }
}

export async function saveAgentToDb(a: AgentProfile): Promise<boolean> {
  if (!isDatabaseConnected()) return false;
  try {
    await query(
      `INSERT INTO agents (
        id, name, company_name, description, active, is_paused_globally, paused_globally_until,
        is_default, waha_session, phone_number, llm_provider, model, openai_model, temperature,
        gemini_api_key, openai_api_key, system_instruction, business_info, handoff_keywords,
        handoff_message, media_handoff_message, pause_duration_hours, pause_duration_minutes,
        debounce_seconds, enable_typing_simulation, enable_send_seen, keep_chat_unread,
        enable_audio_transcription, ignored_numbers, business_hours, enable_booking,
        enable_auto_reminders, auto_reminder_time, last_auto_reminder_date, prompt_history,
        created_at, updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19,
        $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, $33, $34, $35, $36, $37
      ) ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        company_name = EXCLUDED.company_name,
        description = EXCLUDED.description,
        active = EXCLUDED.active,
        is_paused_globally = EXCLUDED.is_paused_globally,
        paused_globally_until = EXCLUDED.paused_globally_until,
        is_default = EXCLUDED.is_default,
        waha_session = EXCLUDED.waha_session,
        phone_number = EXCLUDED.phone_number,
        llm_provider = EXCLUDED.llm_provider,
        model = EXCLUDED.model,
        openai_model = EXCLUDED.openai_model,
        temperature = EXCLUDED.temperature,
        gemini_api_key = EXCLUDED.gemini_api_key,
        openai_api_key = EXCLUDED.openai_api_key,
        system_instruction = EXCLUDED.system_instruction,
        business_info = EXCLUDED.business_info,
        handoff_keywords = EXCLUDED.handoff_keywords,
        handoff_message = EXCLUDED.handoff_message,
        media_handoff_message = EXCLUDED.media_handoff_message,
        pause_duration_hours = EXCLUDED.pause_duration_hours,
        pause_duration_minutes = EXCLUDED.pause_duration_minutes,
        debounce_seconds = EXCLUDED.debounce_seconds,
        enable_typing_simulation = EXCLUDED.enable_typing_simulation,
        enable_send_seen = EXCLUDED.enable_send_seen,
        keep_chat_unread = EXCLUDED.keep_chat_unread,
        enable_audio_transcription = EXCLUDED.enable_audio_transcription,
        ignored_numbers = EXCLUDED.ignored_numbers,
        business_hours = EXCLUDED.business_hours,
        enable_booking = EXCLUDED.enable_booking,
        enable_auto_reminders = EXCLUDED.enable_auto_reminders,
        auto_reminder_time = EXCLUDED.auto_reminder_time,
        last_auto_reminder_date = EXCLUDED.last_auto_reminder_date,
        prompt_history = EXCLUDED.prompt_history,
        updated_at = EXCLUDED.updated_at;`,
      [
        a.id,
        a.name,
        a.companyName,
        a.description || '',
        a.active !== false,
        !!a.isPausedGlobally,
        a.pausedGloballyUntil || null,
        !!a.isDefault,
        a.wahaSession || '*',
        a.phoneNumber || null,
        a.llmProvider || 'openai',
        a.model || 'gemini-flash-lite-latest',
        a.openaiModel || 'gpt-4o-mini',
        a.temperature ?? 0.4,
        a.geminiApiKey || '',
        a.openaiApiKey || '',
        a.systemInstruction,
        a.businessInfo || '',
        JSON.stringify(a.handoffKeywords || []),
        a.handoffMessage || '',
        a.mediaHandoffMessage || '',
        a.pauseDurationHours || 6,
        a.pauseDurationMinutes || 360,
        a.debounceSeconds ?? 2.5,
        a.enableTypingSimulation !== false,
        a.enableSendSeen !== false,
        !!a.keepChatUnread,
        !!a.enableAudioTranscription,
        JSON.stringify(a.ignoredNumbers || []),
        JSON.stringify(a.businessHours || {}),
        !!a.enableBooking,
        a.enableAutoReminders !== false,
        a.autoReminderTime || '18:00',
        a.lastAutoReminderDate || '',
        JSON.stringify(a.promptHistory || []),
        a.createdAt || Date.now(),
        a.updatedAt || Date.now(),
      ]
    );
    return true;
  } catch (err: any) {
    console.error(`[PostgreSQL] Erro ao salvar agente "${a.name}" (${a.id}):`, err.message);
    return false;
  }
}

export async function deleteAgentFromDb(id: string): Promise<boolean> {
  if (!isDatabaseConnected()) return false;
  try {
    await query('DELETE FROM agents WHERE id = $1', [id]);
    return true;
  } catch (err: any) {
    console.error(`[PostgreSQL] Erro ao excluir agente "${id}":`, err.message);
    return false;
  }
}
