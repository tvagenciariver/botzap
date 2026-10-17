import fs from 'fs';
import path from 'path';
import { query, isDatabaseConnected } from './db.js';
import { AgentProfile } from '../config/agent-types.js';
import { UserProfile } from '../auth/user-types.js';
import { Specialist, ServiceItem, Appointment } from '../appointments/types.js';

export async function migrateJsonToPostgres(): Promise<void> {
  if (!isDatabaseConnected()) return;

  const dataDir = path.resolve(process.cwd(), 'data');

  try {
    // -------------------------------------------------------------
    // 1. MIGRAÇÃO DE AGENTES
    // -------------------------------------------------------------
    const resAgents = await query<{ count: string }>('SELECT COUNT(*) as count FROM agents');
    if (parseInt(resAgents.rows[0]?.count || '0', 10) === 0) {
      const agentsPath = path.join(dataDir, 'agents.json');
      const bakPath = path.join(dataDir, 'agents.json.bak');
      let raw = '';
      if (fs.existsSync(agentsPath)) raw = fs.readFileSync(agentsPath, 'utf-8');
      else if (fs.existsSync(bakPath)) raw = fs.readFileSync(bakPath, 'utf-8');

      if (raw && raw.trim()) {
        try {
          const list: AgentProfile[] = JSON.parse(raw);
          if (Array.isArray(list) && list.length > 0) {
            console.log(`[PostgreSQL] 🚀 Auto-migrando ${list.length} agente(s) para o PostgreSQL...`);
            for (const a of list) {
              if (!a || !a.id) continue;
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
                ) ON CONFLICT (id) DO NOTHING;`,
                [
                  a.id, a.name, a.companyName, a.description || '', a.active !== false, !!a.isPausedGlobally,
                  a.pausedGloballyUntil || null, !!a.isDefault, a.wahaSession || '*', a.phoneNumber || null,
                  a.llmProvider || 'openai', a.model || 'gemini-flash-lite-latest', a.openaiModel || 'gpt-4o-mini',
                  a.temperature ?? 0.4, a.geminiApiKey || '', a.openaiApiKey || '', a.systemInstruction,
                  a.businessInfo || '', JSON.stringify(a.handoffKeywords || []), a.handoffMessage || '',
                  a.mediaHandoffMessage || '', a.pauseDurationHours || 6, a.pauseDurationMinutes || 360,
                  a.debounceSeconds ?? 2.5, a.enableTypingSimulation !== false, a.enableSendSeen !== false,
                  !!a.keepChatUnread, !!a.enableAudioTranscription, JSON.stringify(a.ignoredNumbers || []),
                  JSON.stringify(a.businessHours || {}), !!a.enableBooking, a.enableAutoReminders !== false,
                  a.autoReminderTime || '18:00', a.lastAutoReminderDate || '', JSON.stringify(a.promptHistory || []),
                  a.createdAt || Date.now(), a.updatedAt || Date.now(),
                ]
              );
            }
            console.log(`[PostgreSQL] ✅ ${list.length} agente(s) migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar agents.json:', e.message);
        }
      }
    }

    // -------------------------------------------------------------
    // 2. MIGRAÇÃO DE USUÁRIOS
    // -------------------------------------------------------------
    const resUsers = await query<{ count: string }>('SELECT COUNT(*) as count FROM users');
    if (parseInt(resUsers.rows[0]?.count || '0', 10) === 0) {
      const usersPath = path.join(dataDir, 'users.json');
      if (fs.existsSync(usersPath)) {
        try {
          const raw = fs.readFileSync(usersPath, 'utf-8');
          const users: UserProfile[] = JSON.parse(raw);
          if (Array.isArray(users) && users.length > 0) {
            console.log(`[PostgreSQL] 🚀 Auto-migrando ${users.length} usuário(s) para o PostgreSQL...`);
            for (const u of users) {
              await query(
                `INSERT INTO users (
                  id, username, password, name, role, assigned_agent_id, allowed_modules, active, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (id) DO NOTHING;`,
                [
                  u.id, u.username, u.password, u.name, u.role, u.assignedAgentId || '*',
                  JSON.stringify(u.allowedModules || []), u.active !== false,
                  u.createdAt || new Date().toISOString(), u.updatedAt || new Date().toISOString()
                ]
              );
            }
            console.log(`[PostgreSQL] ✅ ${users.length} usuário(s) migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar users.json:', e.message);
        }
      }
    }

    // -------------------------------------------------------------
    // 3. MIGRAÇÃO DE ESPECIALISTAS
    // -------------------------------------------------------------
    const resSpecs = await query<{ count: string }>('SELECT COUNT(*) as count FROM specialists');
    if (parseInt(resSpecs.rows[0]?.count || '0', 10) === 0) {
      const specPath = path.join(dataDir, 'specialists.json');
      if (fs.existsSync(specPath)) {
        try {
          const raw = fs.readFileSync(specPath, 'utf-8').replace(/^\uFEFF/, '');
          const specs: Specialist[] = JSON.parse(raw);
          if (Array.isArray(specs) && specs.length > 0) {
            console.log(`[PostgreSQL] 🚀 Auto-migrando ${specs.length} especialista(s)...`);
            for (const s of specs) {
              await query(
                `INSERT INTO specialists (
                  id, agent_id, name, role, phone, email, avatar, working_days,
                  work_hours_start, work_hours_end, break_start, break_end,
                  slot_duration_minutes, service_ids, active, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
                ON CONFLICT (id) DO NOTHING;`,
                [
                  s.id, s.agentId, s.name, s.role, s.phone || '', s.email || '', s.avatar || '',
                  JSON.stringify(s.workingDays || []), s.workHoursStart || '08:00', s.workHoursEnd || '18:00',
                  s.breakStart || '', s.breakEnd || '', s.slotDurationMinutes || 30,
                  JSON.stringify(s.serviceIds || []), s.active !== false, s.createdAt || new Date().toISOString()
                ]
              );
            }
            console.log(`[PostgreSQL] ✅ ${specs.length} especialista(s) migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar specialists.json:', e.message);
        }
      }
    }

    // -------------------------------------------------------------
    // 4. MIGRAÇÃO DE SERVIÇOS
    // -------------------------------------------------------------
    const resSrv = await query<{ count: string }>('SELECT COUNT(*) as count FROM services');
    if (parseInt(resSrv.rows[0]?.count || '0', 10) === 0) {
      const srvPath = path.join(dataDir, 'services.json');
      if (fs.existsSync(srvPath)) {
        try {
          const raw = fs.readFileSync(srvPath, 'utf-8').replace(/^\uFEFF/, '');
          const services: ServiceItem[] = JSON.parse(raw);
          if (Array.isArray(services) && services.length > 0) {
            console.log(`[PostgreSQL] 🚀 Auto-migrando ${services.length} serviço(s)...`);
            for (const s of services) {
              await query(
                `INSERT INTO services (
                  id, agent_id, name, description, duration_minutes, price, active, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                ON CONFLICT (id) DO NOTHING;`,
                [
                  s.id, s.agentId, s.name, s.description || '', s.durationMinutes || 30,
                  s.price || 0, s.active !== false, s.createdAt || new Date().toISOString()
                ]
              );
            }
            console.log(`[PostgreSQL] ✅ ${services.length} serviço(s) migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar services.json:', e.message);
        }
      }
    }

    // -------------------------------------------------------------
    // 5. MIGRAÇÃO DE AGENDAMENTOS
    // -------------------------------------------------------------
    const resApt = await query<{ count: string }>('SELECT COUNT(*) as count FROM appointments');
    if (parseInt(resApt.rows[0]?.count || '0', 10) === 0) {
      const aptPath = path.join(dataDir, 'appointments.json');
      if (fs.existsSync(aptPath)) {
        try {
          const raw = fs.readFileSync(aptPath, 'utf-8').replace(/^\uFEFF/, '');
          const apts: Appointment[] = JSON.parse(raw);
          if (Array.isArray(apts) && apts.length > 0) {
            console.log(`[PostgreSQL] 🚀 Auto-migrando ${apts.length} agendamento(s)...`);
            for (const a of apts) {
              await query(
                `INSERT INTO appointments (
                  id, agent_id, specialist_id, specialist_name, specialist_role, service_id, service_name,
                  client_chat_id, client_phone, client_name, client_cpf, date, start_time, end_time,
                  status, notes, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
                ON CONFLICT (id) DO NOTHING;`,
                [
                  a.id, a.agentId, a.specialistId, a.specialistName || '', a.specialistRole || '',
                  a.serviceId || '', a.serviceName || '', a.clientChatId || '', a.clientPhone || '',
                  a.clientName || '', a.clientCpf || '', a.date, a.startTime, a.endTime,
                  a.status, a.notes || '', a.createdAt || new Date().toISOString(), a.updatedAt || new Date().toISOString()
                ]
              );
            }
            console.log(`[PostgreSQL] ✅ ${apts.length} agendamento(s) migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar appointments.json:', e.message);
        }
      }
    }

    // -------------------------------------------------------------
    // 6. MIGRAÇÃO DE PARCEIROS
    // -------------------------------------------------------------
    const resPartners = await query<{ count: string }>('SELECT COUNT(*) as count FROM partners');
    if (parseInt(resPartners.rows[0]?.count || '0', 10) === 0) {
      const partnersPath = path.join(dataDir, 'partners.json');
      if (fs.existsSync(partnersPath)) {
        try {
          const raw = fs.readFileSync(partnersPath, 'utf-8');
          const partners: any[] = JSON.parse(raw);
          if (Array.isArray(partners) && partners.length > 0) {
            for (const p of partners) {
              await query(
                `INSERT INTO partners (id, agent_id, name, active, created_at)
                 VALUES ($1, $2, $3, $4, $5) ON CONFLICT (id) DO NOTHING;`,
                [p.id, p.agentId, p.name, p.active !== false, p.createdAt || new Date().toISOString()]
              );
            }
            console.log(`[PostgreSQL] ✅ ${partners.length} parceiro(s) migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar partners.json:', e.message);
        }
      }
    }

    // -------------------------------------------------------------
    // 7. MIGRAÇÃO DE SESSÕES DE CHAT (HISTÓRICO)
    // -------------------------------------------------------------
    const resChat = await query<{ count: string }>('SELECT COUNT(*) as count FROM chat_sessions');
    if (parseInt(resChat.rows[0]?.count || '0', 10) === 0) {
      const chatPath = path.join(dataDir, 'chat_sessions.json');
      if (fs.existsSync(chatPath)) {
        try {
          const raw = fs.readFileSync(chatPath, 'utf-8');
          const chats: any[] = JSON.parse(raw);
          if (Array.isArray(chats) && chats.length > 0) {
            for (const c of chats) {
              if (!c.chatId) continue;
              await query(
                `INSERT INTO chat_sessions (
                  chat_id, agent_id, contact_name, messages, is_paused, paused_until, last_message_at,
                  last_out_of_hours_notice_at, created_at, updated_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
                ON CONFLICT (chat_id, agent_id) DO NOTHING;`,
                [
                  c.chatId, c.agentId || 'default', c.contactName || '', JSON.stringify(c.messages || []),
                  !!c.isPaused, c.pausedUntil || null, c.lastMessageAt || Date.now(),
                  c.lastOutOfHoursNoticeAt || null, Date.now(), Date.now()
                ]
              );
            }
            console.log(`[PostgreSQL] ✅ ${chats.length} histórico(s) de chat migrado(s) com sucesso.`);
          }
        } catch (e: any) {
          console.warn('[PostgreSQL] Aviso ao migrar chat_sessions.json:', e.message);
        }
      }
    }

    console.log('[PostgreSQL] 🎉 Verificação de dados e migração inicial finalizada com sucesso!');
  } catch (err: any) {
    console.error('[PostgreSQL] ⚠️ Erro durante execução da migração para PostgreSQL:', err.message);
  }
}
