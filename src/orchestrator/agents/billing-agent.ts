import { IAgent, AgentContext, AgentResponse } from './base.js';
import { billingManager } from '../../billing/billing-manager.js';
import { wahaClient } from '../../waha/client.js';
import { memoryStore } from '../../gemini/memory.js';

export class BillingAgent implements IAgent {
  name = 'BillingAgent';
  description = 'Detecta envio de comprovantes de pagamento (imagens, PDFs) e confirmações de pagamento ("já paguei", "fiz o pix"), registrando baixa para conferência e respondendo cordialmente.';

  private paymentKeywords = [
    'ja paguei',
    'já paguei',
    'paguei',
    'ta pago',
    'tá pago',
    'fiz o pix',
    'fiz o pagamento',
    'pagamento feito',
    'pagamento realizado',
    'segue o comprovante',
    'segue comprovante',
    'mandei o comprovante',
    'enviei o comprovante',
    'comprovante',
    'comprovante em anexo',
    'comprovante anexo',
    'acabei de pagar',
    'acabei de transferir',
    'fiz a transferencia',
    'fiz a transferência',
    'pix enviado',
    'pix feito',
    'boleto pago',
    'pago hoje',
    'pago agora'
  ];

  async canHandle(context: AgentContext): Promise<boolean> {
    const raw = (context.userMessage || '').trim();
    const lower = raw.toLowerCase();
    const agentId = context.agent?.id;

    // 1. Verifica se o contato possui cobrança pendente para este agente/empresa
    const pendingCharge = billingManager.findPendingChargeForCustomer(context.chatId, agentId);
    if (!pendingCharge) {
      return false;
    }

    // 2. Se tiver mídia (foto ou documento)
    const hasMedia = !!(
      context.metadata?.payload?.hasMedia ||
      context.metadata?.hasMedia ||
      raw.includes('[Imagem') ||
      raw.includes('[Documento') ||
      raw.includes('[Foto') ||
      raw.includes('[Arquivo')
    );

    // 3. Se a mensagem contém palavras-chave explícitas de pagamento
    const hasPaymentIntent = this.paymentKeywords.some(keyword => lower.includes(keyword));

    // Se o cliente possui cobrança pendente e enviou mídia ou texto de pagamento
    if (hasMedia || hasPaymentIntent) {
      return true;
    }

    return false;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    const agentId = context.agent?.id;
    const charge = billingManager.findPendingChargeForCustomer(context.chatId, agentId);
    if (!charge) {
      return { handled: false, agentName: this.name, action: 'none' };
    }

    const payload = context.metadata?.payload;
    const session = context.session;
    let fileBuffer: Buffer | undefined;
    let fileName: string | undefined;
    let mimeType: string | undefined;

    // Se houver mídia recebida no webhook, baixa o arquivo via WAHA
    if (payload?.hasMedia && (payload.media?.url || payload.id)) {
      try {
        console.log(`[BillingAgent] 📥 Baixando comprovante de pagamento enviado por ${context.chatId}...`);
        const downloaded = await wahaClient.downloadMedia(payload.media?.url, payload, session);
        if (downloaded && downloaded.buffer && downloaded.buffer.length > 0) {
          fileBuffer = downloaded.buffer;
          mimeType = downloaded.mimetype;
          const ext = mimeType.includes('pdf') ? '.pdf' : mimeType.includes('png') ? '.png' : '.jpg';
          fileName = `comprovante_${charge.id}${ext}`;
          console.log(`[BillingAgent] ✅ Comprovante baixado com sucesso (${fileBuffer.length} bytes, ${mimeType}).`);
        }
      } catch (err: any) {
        console.warn(`[BillingAgent] Não foi possível baixar a mídia do comprovante:`, err.message);
      }
    }

    // Registra o comprovante/confirmação no BillingManager
    const rawText = (context.userMessage || '').trim();
    await billingManager.registerCustomerReceipt(context.chatId, {
      fileBuffer,
      fileName,
      mimeType,
      messageText: rawText,
      agentId
    });

    // Despausa o bot caso estivesse pausado
    if (agentId) {
      memoryStore.resumeChat(context.chatId, agentId);
    }

    // Resposta acolhedora de confirmação para o cliente
    const companyName = context.agent?.companyName || context.agent?.name || 'Setor Financeiro';
    const formattedAmount = charge.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const serviceName = charge.serviceDescription || charge.serviceType;

    const replyText =
      `🏢 *${companyName}* — Setor Financeiro\n\n` +
      `🎉 *Recebemos a sua confirmação de pagamento!*\n\n` +
      `Muito obrigado, *${charge.customerName}*! Já registramos o recebimento referente a *${serviceName}* no valor de *${formattedAmount}*.\n\n` +
      `✅ O seu comprovante foi encaminhado para a nossa equipe financeira para conferência e baixa no sistema.\n\n` +
      `Qualquer dúvida ou caso precise de algo mais, estamos à disposição! ✨ Tenha um excelente dia!`;

    return {
      handled: true,
      replyText,
      agentName: this.name,
      action: 'none'
    };
  }
}
