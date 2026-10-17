import pg from 'pg';

const { Pool } = pg;

// Configuração da conexão com PostgreSQL
const connectionString = process.env.DATABASE_URL;

const poolConfig: pg.PoolConfig = connectionString
  ? { connectionString }
  : {
      host: process.env.POSTGRES_HOST || 'localhost',
      port: parseInt(process.env.POSTGRES_PORT || '5432', 10),
      user: process.env.POSTGRES_USER || 'botzap',
      password: process.env.POSTGRES_PASSWORD || 'da5507d4f8eb04d894ebfe62a494eaf6',
      database: process.env.POSTGRES_DB || 'botzap',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    };

export const pool = new Pool(poolConfig);

let isConnected = false;

pool.on('error', (err) => {
  console.error('[PostgreSQL] ⚠️ Erro inesperado no pool do PostgreSQL:', err.message);
  isConnected = false;
});

export function isDatabaseConnected(): boolean {
  return isConnected;
}

export async function query<T extends pg.QueryResultRow = any>(text: string, params?: any[]): Promise<pg.QueryResult<T>> {
  return pool.query<T>(text, params);
}

/**
 * Inicializa o banco de dados PostgreSQL criando schemas e tabelas para todos os dados críticos
 */
export async function initDatabase(): Promise<boolean> {
  try {
    const client = await pool.connect();
    isConnected = true;
    console.log('[PostgreSQL] 🐘 Conectado com sucesso ao banco de dados relacional!');

    try {
      // 1. Tabela de Agentes e Prompts
      await client.query(`
        CREATE TABLE IF NOT EXISTS agents (
          id VARCHAR(100) PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          company_name VARCHAR(255) NOT NULL,
          description TEXT,
          active BOOLEAN DEFAULT true,
          is_paused_globally BOOLEAN DEFAULT false,
          paused_globally_until BIGINT,
          is_default BOOLEAN DEFAULT false,
          waha_session VARCHAR(255),
          phone_number VARCHAR(100),
          llm_provider VARCHAR(50) DEFAULT 'openai',
          model VARCHAR(100),
          openai_model VARCHAR(100),
          temperature NUMERIC(4,2) DEFAULT 0.4,
          gemini_api_key TEXT,
          openai_api_key TEXT,
          system_instruction TEXT NOT NULL,
          business_info TEXT,
          handoff_keywords JSONB,
          handoff_message TEXT,
          media_handoff_message TEXT,
          pause_duration_hours NUMERIC(6,2),
          pause_duration_minutes INT,
          debounce_seconds NUMERIC(5,2),
          enable_typing_simulation BOOLEAN DEFAULT true,
          enable_send_seen BOOLEAN DEFAULT true,
          keep_chat_unread BOOLEAN DEFAULT false,
          enable_audio_transcription BOOLEAN DEFAULT false,
          ignored_numbers JSONB,
          business_hours JSONB,
          enable_booking BOOLEAN DEFAULT false,
          enable_auto_reminders BOOLEAN DEFAULT true,
          auto_reminder_time VARCHAR(20),
          last_auto_reminder_date VARCHAR(50),
          prompt_history JSONB,
          created_at BIGINT,
          updated_at BIGINT
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_agents_waha_session ON agents(waha_session);`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_agents_phone_number ON agents(phone_number);`);

      // 2. Tabela de Usuários Administrativos e Atendentes
      await client.query(`
        CREATE TABLE IF NOT EXISTS users (
          id VARCHAR(100) PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password TEXT NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(50) NOT NULL,
          assigned_agent_id VARCHAR(100) DEFAULT '*',
          allowed_modules JSONB,
          active BOOLEAN DEFAULT true,
          created_at VARCHAR(100),
          updated_at VARCHAR(100)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);`);

      // 3. Tabela de Configurações Gerais (bot_config)
      await client.query(`
        CREATE TABLE IF NOT EXISTS bot_config (
          key VARCHAR(100) PRIMARY KEY,
          value JSONB NOT NULL,
          updated_at BIGINT
        );
      `);

      // 4. Tabela de Sessões de Chat e Memória de Conversas
      await client.query(`
        CREATE TABLE IF NOT EXISTS chat_sessions (
          chat_id VARCHAR(150) NOT NULL,
          agent_id VARCHAR(100) NOT NULL,
          contact_name VARCHAR(255),
          messages JSONB,
          is_paused BOOLEAN DEFAULT false,
          paused_until BIGINT,
          last_message_at BIGINT,
          last_out_of_hours_notice_at BIGINT,
          created_at BIGINT,
          updated_at BIGINT,
          PRIMARY KEY (chat_id, agent_id)
        );
      `);

      // 5. Tabela de Especialistas / Profissionais
      await client.query(`
        CREATE TABLE IF NOT EXISTS specialists (
          id VARCHAR(100) PRIMARY KEY,
          agent_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          role VARCHAR(255) NOT NULL,
          phone VARCHAR(100),
          email VARCHAR(255),
          avatar TEXT,
          working_days JSONB,
          work_hours_start VARCHAR(10),
          work_hours_end VARCHAR(10),
          break_start VARCHAR(10),
          break_end VARCHAR(10),
          slot_duration_minutes INT DEFAULT 30,
          service_ids JSONB,
          active BOOLEAN DEFAULT true,
          created_at VARCHAR(100)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_specialists_agent_id ON specialists(agent_id);`);

      // 6. Tabela de Serviços e Exames
      await client.query(`
        CREATE TABLE IF NOT EXISTS services (
          id VARCHAR(100) PRIMARY KEY,
          agent_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          duration_minutes INT DEFAULT 30,
          price NUMERIC(10,2),
          active BOOLEAN DEFAULT true,
          created_at VARCHAR(100)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_services_agent_id ON services(agent_id);`);

      // 7. Tabela de Agendamentos / Consultas
      await client.query(`
        CREATE TABLE IF NOT EXISTS appointments (
          id VARCHAR(100) PRIMARY KEY,
          agent_id VARCHAR(100) NOT NULL,
          specialist_id VARCHAR(100) NOT NULL,
          specialist_name VARCHAR(255),
          specialist_role VARCHAR(255),
          service_id VARCHAR(100),
          service_name VARCHAR(255),
          client_chat_id VARCHAR(150),
          client_phone VARCHAR(100),
          client_name VARCHAR(255),
          client_cpf VARCHAR(50),
          date VARCHAR(20) NOT NULL,
          start_time VARCHAR(10) NOT NULL,
          end_time VARCHAR(10) NOT NULL,
          status VARCHAR(50) NOT NULL,
          notes TEXT,
          created_at VARCHAR(100),
          updated_at VARCHAR(100)
        );
      `);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_appointments_agent_date ON appointments(agent_id, date);`);

      // 8. Tabela de Parceiros e Convênios
      await client.query(`
        CREATE TABLE IF NOT EXISTS partners (
          id VARCHAR(100) PRIMARY KEY,
          agent_id VARCHAR(100) NOT NULL,
          name VARCHAR(255) NOT NULL,
          active BOOLEAN DEFAULT true,
          created_at VARCHAR(100)
        );
      `);

      console.log('[PostgreSQL] 📋 Todas as tabelas relacionais de dados críticos verificadas/criadas com sucesso.');
      return true;
    } finally {
      client.release();
    }
  } catch (err: any) {
    console.warn(`[PostgreSQL] ⚠️ Não foi possível conectar ao PostgreSQL: ${err.message}`);
    console.warn('[PostgreSQL] ℹ️ O sistema utilizará persistência segura em disco com escrita atômica e backup contínuo.');
    isConnected = false;
    return false;
  }
}
