import fs from 'fs';
import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { env, loadBotConfig } from './config/index.js';
import { apiRouter } from './web/routes.js';
import { wahaClient } from './waha/client.js';
import { geminiService } from './gemini/client.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middlewares
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Serve arquivos de uploads (Exames e Laudos)
const uploadsPath = path.resolve(process.cwd(), 'data', 'uploads');
if (!fs.existsSync(uploadsPath)) {
  fs.mkdirSync(uploadsPath, { recursive: true });
}
app.use('/uploads', express.static(uploadsPath));

// Serve arquivos estáticos do Painel Web (Dashboard)
let publicPath = path.resolve(__dirname, 'web', 'public');
if (!fs.existsSync(publicPath)) {
  publicPath = path.resolve(process.cwd(), 'src', 'web', 'public');
}
app.use(express.static(publicPath));

// Rotas da API e Webhooks
app.use(apiRouter);

// Rota de fallback para SPA do Painel
app.get('*', (_req, res) => {
  res.sendFile(path.join(publicPath, 'index.html'));
});

// Inicialização do Servidor
app.listen(env.port, async () => {
  const config = loadBotConfig();
  console.log('\n======================================================');
  console.log('🤖 BotZap: Orquestrador de Agentes IA (WAHA + Gemini Flash)');
  console.log('======================================================');
  console.log(`🌐 Servidor rodando em: http://localhost:${env.port}`);
  console.log(`📡 Webhook para WAHA:   http://localhost:${env.port}/webhook/waha`);
  console.log(`💬 Webhook Chatwoot:    http://localhost:${env.port}/webhook/chatwoot`);
  console.log(`⚡ Sessão WAHA padrão:  ${env.wahaSession} (${env.wahaBaseUrl})`);
  console.log(`✨ Modelo Gemini Flash: ${config.model || env.geminiModel}`);
  console.log(`🔑 Gemini Configurado:  ${geminiService.isConfigured() ? 'SIM ✅' : 'NÃO (Informe a chave no painel web) ⚠️'}`);
  console.log('======================================================\n');

  // Teste de conexão não-bloqueante com a WAHA
  try {
    const status = await wahaClient.getSessionStatus(env.wahaSession);
    if (status) {
      console.log(`[WAHA] Conectado com sucesso! Sessão "${status.name}" está: ${status.status}`);
      // Tenta auto-registrar o webhook
      const webhookTarget = `${env.webhookPublicUrl}/webhook/waha`;
      await wahaClient.configureWebhook(webhookTarget, env.wahaSession);
    } else {
      console.log(`[WAHA] Aviso: Sessão "${env.wahaSession}" não encontrada ou WAHA inicializando em ${env.wahaBaseUrl}.`);
    }
  } catch (err: any) {
    console.log(`[WAHA] Não foi possível conectar imediatamente à WAHA em ${env.wahaBaseUrl} (${err.message}). O orquestrador continuará operando normalmente.`);
  }
});
