import { GoogleGenerativeAI } from '@google/generative-ai';
import { wahaClient } from '../waha/client.js';
import { agentManager } from '../config/agent-manager.js';
import { env, loadBotConfig } from '../config/index.js';
import { blastStore } from './blast-store.js';
import { BlastCampaign, BlastQueueItem } from './types.js';

/** Aguarda ms milissegundos */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Numero aleatorio entre min e max (inclusive) */
function rand(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/** Formata numero de telefone para chatId WAHA */
function toChatId(phone: string): string {
  const trimmed = (phone || '').trim();
  if (trimmed.includes('@lid') || trimmed.includes('@g.us') || trimmed.includes('@c.us')) {
    return trimmed;
  }
  const digits = trimmed.replace(/\D/g, '');
  return `${digits}@c.us`;
}

/** Reescreve a mensagem usando Gemini (texto humanizado, diferente por contato, com emojis e quebras de linha) */
async function rewriteWithGemini(originalMessage: string, contactName: string, apiKey: string): Promise<string> {
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'gemini-flash-lite-latest' });

    const prompt = `Você é um especialista em copywriting e comunicação via WhatsApp.
Reescreva a mensagem abaixo com palavras diferentes, tornando-a natural, humanizada, atraente e muito bem estruturada para leitura rápida no WhatsApp.

DIRETRIZES OBRIGATÓRIAS:
1. FORMATAÇÃO E ESTRUTURA:
   - Use QUEBRAS DE LINHA (parágrafos curtos) para deixar o texto leve e agradável de ler. NUNCA envie um bloco único de texto sem espaçamento.
   - Use emojis pertinentes e expressivos estrategicamente (ex: 👋 no cumprimento, 💡 ou 🚀 em destaques, 📲 ou 👉 em chamadas/links, 📅 em datas, etc.).
   - Pode usar *negrito* do WhatsApp para destacar pontos-chave importantes (não use '#' para títulos, o WhatsApp não suporta markdown '#' de títulos).

2. FIDELIDADE E DADOS:
   - Mantenha RIGOROSAMENTE o mesmo significado, todos os links (URLs completas e intactas), números de telefone, valores, endereços e dados originais.
   - Dirija-se ao destinatário pelo nome "${contactName}".

3. TOM DE VOZ:
   - Cordial, profissional, empático e envolvente.

4. SAÍDA:
   - Retorne APENAS o texto pronto da mensagem para WhatsApp, sem introduções, aspas extras ou explicações adicionais.

Destinatário: ${contactName}
Mensagem original:
${originalMessage}`;

    const result = await model.generateContent(prompt);
    let text = result.response.text().trim();

    // Sanitizar títulos markdown (# Título) para WhatsApp (*Título*)
    text = text.replace(/^#{1,6}\s*(.+)$/gm, '*$1*');
    // Remover aspas no início e fim se a IA tiver envelopado
    text = text.replace(/^["'](.*)["']$/s, '$1').trim();

    return text || originalMessage;
  } catch (err: any) {
    console.warn('[BlastEngine] Falha ao reescrever com Gemini, usando mensagem original:', err.message);
    return originalMessage;
  }
}

class BlastEngine {
  private runningCampaignId: string | null = null;
  private pauseRequested = false;
  private cancelRequested = false;

  isRunning(): boolean {
    return this.runningCampaignId !== null;
  }

  getCurrentCampaignId(): string | null {
    return this.runningCampaignId;
  }

  async start(campaignId: string): Promise<void> {
    if (this.runningCampaignId && this.runningCampaignId !== campaignId) {
      throw new Error(`Ja existe uma campanha em execucao: ${this.runningCampaignId}. Pause ou cancele-a primeiro.`);
    }

    const campaign = blastStore.get(campaignId);
    if (!campaign) throw new Error('Campanha nao encontrada.');
    if (campaign.status === 'completed' || campaign.status === 'cancelled') {
      throw new Error(`Campanha ja esta ${campaign.status}.`);
    }

    this.runningCampaignId = campaignId;
    this.pauseRequested = false;
    this.cancelRequested = false;

    // Obter sessao WAHA e chave Gemini do agente
    const agent = agentManager.getAgent(campaign.agentId) || agentManager.getDefaultAgent();
    const config = loadBotConfig();
    const wahaSession = agent?.wahaSession || env.wahaSession || 'default';
    const apiKey = (agent?.geminiApiKey && agent.geminiApiKey.trim() !== '' && agent.geminiApiKey !== 'sua_chave_gemini_aqui')
      ? agent.geminiApiKey.trim()
      : (env.geminiApiKey || config.geminiApiKey || '').trim();

    // Marcar campanha como running
    blastStore.updateStatus(campaignId, 'running', {
      startedAt: campaign.startedAt || new Date().toISOString()
    });

    console.log(`[BlastEngine] Iniciando campanha "${campaign.name}" (${campaignId}) — ${campaign.queue.filter(q => q.status === 'pending').length} pendentes.`);

    const settings = campaign.settings;
    let sentInBatch = 0;

    for (const item of campaign.queue) {
      // Verificar cancelamento / pausa
      if (this.cancelRequested) {
        console.log(`[BlastEngine] Cancelamento solicitado. Encerrando campanha ${campaignId}.`);
        this._markRemaining(campaignId, 'cancelled');
        blastStore.updateStatus(campaignId, 'cancelled', { completedAt: new Date().toISOString() });
        this.runningCampaignId = null;
        return;
      }

      if (this.pauseRequested) {
        console.log(`[BlastEngine] Pausa solicitada. Suspendendo campanha ${campaignId}.`);
        blastStore.updateStatus(campaignId, 'paused');
        this.runningCampaignId = null;
        this.pauseRequested = false;
        return;
      }

      // Pular itens ja processados
      if (item.status !== 'pending') continue;

      const chatId = toChatId(item.phone);
      let updatedItem: BlastQueueItem = { ...item };

      try {
        // Passo 1: Reescrever mensagem com IA (se tiver chave configurada)
        let finalMessage = item.originalMessage.replace(/\{\{nome\}\}/gi, item.recipientName);
        if (apiKey && apiKey !== 'sua_chave_gemini_aqui') {
          finalMessage = await rewriteWithGemini(finalMessage, item.recipientName, apiKey);
        }
        updatedItem.generatedMessage = finalMessage;

        // Passo 2: Simular "digitando..."
        await wahaClient.startTyping(chatId, wahaSession);
        await sleep(4000);
        await wahaClient.stopTyping(chatId, wahaSession);

        // Passo 3: Enviar mensagem
        await wahaClient.sendText(chatId, finalMessage, { session: wahaSession });

        updatedItem.status = 'sent';
        updatedItem.sentAt = new Date().toISOString();
        sentInBatch++;
        console.log(`[BlastEngine] ✅ Enviado para ${item.recipientName} (${item.phone})`);

      } catch (err: any) {
        updatedItem.status = 'failed';
        updatedItem.errorMessage = err.message || 'Erro desconhecido';
        console.error(`[BlastEngine] ❌ Falhou para ${item.recipientName} (${item.phone}):`, err.message);
      }

      // Salvar estado do item
      blastStore.updateQueueItem(campaignId, updatedItem);

      // Passo 4: Anti-spam — pausa de lote
      if (sentInBatch > 0 && sentInBatch % settings.batchSize === 0) {
        const pauseMs = settings.batchPauseMinutes * 60 * 1000;
        console.log(`[BlastEngine] Lote de ${settings.batchSize} enviados. Pausando por ${settings.batchPauseMinutes} min...`);

        const pauseEnd = Date.now() + pauseMs;
        while (Date.now() < pauseEnd) {
          if (this.cancelRequested || this.pauseRequested) break;
          await sleep(5000); // verifica a cada 5 segundos
        }

        if (this.cancelRequested) {
          this._markRemaining(campaignId, 'cancelled');
          blastStore.updateStatus(campaignId, 'cancelled', { completedAt: new Date().toISOString() });
          this.runningCampaignId = null;
          return;
        }
        if (this.pauseRequested) {
          blastStore.updateStatus(campaignId, 'paused');
          this.runningCampaignId = null;
          this.pauseRequested = false;
          return;
        }
      } else {
        // Intervalo aleatorio anti-spam entre mensagens
        const delaySec = rand(settings.minInterval, settings.maxInterval);
        console.log(`[BlastEngine] Aguardando ${delaySec}s antes do proximo envio...`);
        const delayEnd = Date.now() + delaySec * 1000;
        while (Date.now() < delayEnd) {
          if (this.cancelRequested || this.pauseRequested) break;
          await sleep(1000);
        }
      }
    }

    // Verificar se algum item ainda esta pendente (apos interrupcoes)
    const fresh = blastStore.get(campaignId);
    const stillPending = fresh?.queue.filter(q => q.status === 'pending').length || 0;

    if (!this.cancelRequested && !this.pauseRequested && stillPending === 0) {
      blastStore.updateStatus(campaignId, 'completed', { completedAt: new Date().toISOString() });
      console.log(`[BlastEngine] Campanha "${campaign.name}" concluida com sucesso.`);
    }

    this.runningCampaignId = null;
  }

  pause(): void {
    this.pauseRequested = true;
  }

  cancel(): void {
    this.cancelRequested = true;
  }

  private _markRemaining(campaignId: string, status: 'cancelled'): void {
    const campaign = blastStore.get(campaignId);
    if (!campaign) return;
    for (const item of campaign.queue) {
      if (item.status === 'pending') {
        blastStore.updateQueueItem(campaignId, { ...item, status });
      }
    }
  }
}

export const blastEngine = new BlastEngine();
