import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  BillingCharge,
  BillingLog,
  BillingStats,
  CreateBillingDTO,
  BillingFilter
} from './types.js';
import { wahaClient } from '../waha/client.js';
import { agentManager } from '../config/agent-manager.js';
import { env } from '../config/index.js';
import { formatToWhatsAppChatId, getAllChatIdAliases, matchPhoneOrChatId } from '../appointments/phone-utils.js';
import { botTracker } from '../orchestrator/bot-tracker.js';
import { customerManager } from './customer-manager.js';

export class BillingManager {
  private dataDir: string;
  private billingFile: string;
  private logsFile: string;
  private uploadsBoletosDir: string;
  private uploadsQrCodesDir: string;
  private uploadsReceiptsDir: string;

  private charges: BillingCharge[] = [];
  private logs: BillingLog[] = [];

  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
    this.billingFile = path.join(this.dataDir, 'billing.json');
    this.logsFile = path.join(this.dataDir, 'billing_logs.json');

    this.uploadsBoletosDir = path.join(this.dataDir, 'uploads', 'billing', 'boletos');
    this.uploadsQrCodesDir = path.join(this.dataDir, 'uploads', 'billing', 'qrcodes');
    this.uploadsReceiptsDir = path.join(this.dataDir, 'uploads', 'billing', 'receipts');

    this.ensureDirs();
    this.loadFromDisk();
    this.loadLogsFromDisk();
  }

  private ensureDirs(): void {
    const dirs = [
      this.uploadsBoletosDir,
      this.uploadsQrCodesDir,
      this.uploadsReceiptsDir
    ];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.billingFile)) {
        const raw = fs.readFileSync(this.billingFile, 'utf-8');
        this.charges = JSON.parse(raw);
        console.log(`[BillingManager] ${this.charges.length} cobrança(s) carregada(s) do disco.`);
      }
    } catch (err: any) {
      console.warn('[BillingManager] Aviso ao ler billing.json:', err.message);
      this.charges = [];
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.billingFile, JSON.stringify(this.charges, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[BillingManager] Erro ao salvar billing.json:', err.message);
    }
  }

  private loadLogsFromDisk(): void {
    try {
      if (fs.existsSync(this.logsFile)) {
        const raw = fs.readFileSync(this.logsFile, 'utf-8');
        this.logs = JSON.parse(raw);
      }
    } catch (err: any) {
      console.warn('[BillingManager] Aviso ao ler billing_logs.json:', err.message);
      this.logs = [];
    }
  }

  private saveLogsToDisk(): void {
    try {
      fs.writeFileSync(this.logsFile, JSON.stringify(this.logs, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[BillingManager] Erro ao salvar billing_logs.json:', err.message);
    }
  }

  /**
   * Salva arquivo em Base64 no disco
   */
  saveBase64File(
    subDir: 'boletos' | 'qrcodes' | 'receipts',
    prefix: string,
    originalName: string,
    base64Data: string
  ): { filePath: string; fileName: string; url: string } {
    const targetFolder = subDir === 'boletos' 
      ? this.uploadsBoletosDir 
      : subDir === 'qrcodes' 
        ? this.uploadsQrCodesDir 
        : this.uploadsReceiptsDir;

    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const ext = path.extname(originalName) || (subDir === 'boletos' ? '.pdf' : '.png');
    const safeBaseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedFileName = `${prefix}_${safeBaseName}${ext}`;
    const targetPath = path.join(targetFolder, storedFileName);

    fs.writeFileSync(targetPath, buffer);

    return {
      filePath: targetPath,
      fileName: storedFileName,
      url: `/uploads/billing/${subDir}/${storedFileName}`
    };
  }

  /**
   * Salva buffer de arquivo baixado via WAHA (comprovantes recebidos)
   */
  saveBufferFile(
    prefix: string,
    originalName: string,
    buffer: Buffer
  ): { filePath: string; fileName: string; url: string } {
    const ext = path.extname(originalName) || '.jpg';
    const safeBaseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedFileName = `${prefix}_${safeBaseName}${ext}`;
    const targetPath = path.join(this.uploadsReceiptsDir, storedFileName);

    fs.writeFileSync(targetPath, buffer);

    return {
      filePath: targetPath,
      fileName: storedFileName,
      url: `/uploads/billing/receipts/${storedFileName}`
    };
  }

  /**
   * Registra log de auditoria
   */
  addLog(logData: Omit<BillingLog, 'id' | 'timestamp'>): BillingLog {
    const log: BillingLog = {
      id: 'blog_' + crypto.randomBytes(6).toString('hex'),
      timestamp: new Date().toISOString(),
      ...logData
    };
    this.logs.unshift(log); // Mais recente primeiro
    if (this.logs.length > 3000) {
      this.logs = this.logs.slice(0, 3000);
    }
    this.saveLogsToDisk();
    return log;
  }

  /**
   * Consulta cobranças com filtros avançados
   */
  getCharges(filter?: BillingFilter): BillingCharge[] {
    let list = [...this.charges];

    if (filter?.agentId && filter.agentId !== 'all') {
      list = list.filter(c => c.agentId === filter.agentId);
    }

    if (filter?.statusEnvio) {
      list = list.filter(c => c.statusEnvio === filter.statusEnvio);
    }

    if (filter?.statusPagamento) {
      list = list.filter(c => c.statusPagamento === filter.statusPagamento);
    }

    if (filter?.billingMethod) {
      list = list.filter(c => c.billingMethod === filter.billingMethod);
    }

    if (filter?.quickFilter) {
      const todayStr = this.getTodayDateString();
      if (filter.quickFilter === 'sent_initial') {
        list = list.filter(c => c.statusEnvio === 'enviado');
      } else if (filter.quickFilter === 'scheduled') {
        list = list.filter(c => c.statusEnvio === 'agendado');
      } else if (filter.quickFilter === 'not_confirmed') {
        list = list.filter(c => c.statusPagamento === 'pendente');
      } else if (filter.quickFilter === 'awaiting_confirmation') {
        list = list.filter(c => c.statusPagamento === 'aguardando_confirmacao');
      } else if (filter.quickFilter === 'paid') {
        list = list.filter(c => c.statusPagamento === 'pago');
      } else if (filter.quickFilter === 'overdue') {
        // Vencidas há 3 ou mais dias e ainda não pagas
        const threshold = this.getOverdueThresholdDateString(3);
        list = list.filter(c => 
          (c.statusPagamento === 'pendente' || c.statusPagamento === 'aguardando_confirmacao') &&
          c.dueDate <= threshold
        );
      }
    }

    if (filter?.search && filter.search.trim()) {
      const q = filter.search.trim().toLowerCase();
      list = list.filter(c =>
        c.customerName.toLowerCase().includes(q) ||
        c.customerPhone.includes(q) ||
        c.serviceType.toLowerCase().includes(q) ||
        (c.serviceDescription && c.serviceDescription.toLowerCase().includes(q)) ||
        (c.pixKey && c.pixKey.toLowerCase().includes(q))
      );
    }

    // Ordena da mais recente para a mais antiga
    return list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  getChargeById(id: string): BillingCharge | undefined {
    return this.charges.find(c => c.id === id);
  }

  /**
   * Cria nova cobrança
   */
  async createCharge(dto: CreateBillingDTO): Promise<BillingCharge> {
    if (!dto.customerName || !dto.customerName.trim()) {
      throw new Error('O nome do cliente é obrigatório.');
    }
    if (!dto.customerPhone || !dto.customerPhone.trim()) {
      throw new Error('O telefone WhatsApp do cliente é obrigatório.');
    }
    if (!dto.amount || dto.amount <= 0) {
      throw new Error('Informe um valor válido em reais.');
    }
    if (!dto.dueDate) {
      throw new Error('A data de vencimento é obrigatória.');
    }

    const billingId = 'bill_' + crypto.randomBytes(6).toString('hex');
    const agent = (dto.agentId ? agentManager.getAgent(dto.agentId) : null) || agentManager.getDefaultAgent();
    const customerChatId = formatToWhatsAppChatId(dto.customerPhone);

    let customerId = dto.customerId;
    if (!customerId && dto.saveCustomer) {
      try {
        const savedCust = customerManager.upsertCustomerFromBilling(agent.id, dto.customerName, dto.customerPhone);
        customerId = savedCust.id;
      } catch (err: any) {
        console.warn('[BillingManager] Não foi possível salvar cliente automaticamente:', err.message);
      }
    }

    let pdfFileName: string | undefined;
    let pdfFilePath: string | undefined;
    let pdfUrl: string | undefined;

    let pixQrCodeFileName: string | undefined;
    let pixQrCodeFilePath: string | undefined;
    let pixQrCodeUrl: string | undefined;

    // Salva PDF do Boleto se fornecido
    if ((dto.billingMethod === 'boleto' || dto.billingMethod === 'ambos') && dto.pdfBase64) {
      const original = dto.pdfFileName || 'boleto.pdf';
      const saved = this.saveBase64File('boletos', billingId, original, dto.pdfBase64);
      pdfFileName = saved.fileName;
      pdfFilePath = saved.filePath;
      pdfUrl = saved.url;
    }

    // Salva QR Code do PIX se fornecido
    if ((dto.billingMethod === 'pix' || dto.billingMethod === 'ambos') && dto.pixQrCodeBase64) {
      const original = dto.pixQrCodeFileName || 'qrcode_pix.png';
      const saved = this.saveBase64File('qrcodes', billingId, original, dto.pixQrCodeBase64);
      pixQrCodeFileName = saved.fileName;
      pixQrCodeFilePath = saved.filePath;
      pixQrCodeUrl = saved.url;
    }

    const now = new Date().toISOString();
    const charge: BillingCharge = {
      id: billingId,
      agentId: agent.id,
      customerId,
      customerName: dto.customerName.trim(),
      customerPhone: dto.customerPhone.trim(),
      customerChatId,
      serviceType: dto.serviceType || 'Serviço',
      serviceDescription: dto.serviceDescription?.trim(),
      amount: Number(dto.amount),
      dueDate: dto.dueDate,
      billingMethod: dto.billingMethod || 'boleto',

      pdfFileName,
      pdfFilePath,
      pdfUrl,

      pixKey: dto.pixKey?.trim(),
      pixKeyType: dto.pixKeyType,
      pixCopiaECola: dto.pixCopiaECola?.trim(),
      pixQrCodeFileName,
      pixQrCodeFilePath,
      pixQrCodeUrl,

      statusEnvio: (dto.sendOption === 'scheduled' || (!!dto.scheduledSendAt && dto.sendOption !== 'manual' && dto.sendOption !== 'immediate'))
        ? 'agendado'
        : 'pendente',
      statusPagamento: 'pendente',
      sendImmediately: (dto.sendOption === 'scheduled' || dto.sendOption === 'manual' || dto.sendImmediately === false)
        ? false
        : (dto.sendImmediately ?? true),
      scheduledSendAt: (dto.sendOption === 'scheduled' || (!!dto.scheduledSendAt && dto.sendOption !== 'manual' && dto.sendOption !== 'immediate'))
        ? dto.scheduledSendAt
        : undefined,
      customMessageTemplate: dto.customMessageTemplate?.trim(),
      sendAttempts: 0,
      notes: dto.notes?.trim(),

      createdAt: now,
      updatedAt: now
    };

    this.charges.unshift(charge);
    this.saveToDisk();

    if (charge.statusEnvio === 'agendado') {
      this.addLog({
        billingId: charge.id,
        agentId: charge.agentId,
        customerName: charge.customerName,
        customerPhone: charge.customerPhone,
        type: 'envio_agendado',
        status: 'info',
        message: `Cobrança de R$ ${charge.amount.toFixed(2)} cadastrada e AGENDADA para envio em ${charge.scheduledSendAt} (${charge.billingMethod.toUpperCase()}). Vencimento: ${charge.dueDate}.`
      });
    } else {
      this.addLog({
        billingId: charge.id,
        agentId: charge.agentId,
        customerName: charge.customerName,
        customerPhone: charge.customerPhone,
        type: 'envio_inicial',
        status: 'info',
        message: `Cobrança de R$ ${charge.amount.toFixed(2)} cadastrada (${charge.billingMethod.toUpperCase()})${charge.sendImmediately ? ' com envio imediato' : ' (salva sem envio imediato)'}. Vencimento: ${charge.dueDate}.`
      });
    }

    // Envio inicial imediato se solicitado
    if (charge.sendImmediately) {
      try {
        await this.dispatchBilling(charge.id, 'envio_inicial');
      } catch (err: any) {
        console.error(`[BillingManager] Erro no envio imediato da cobrança ${charge.id}:`, err.message);
      }
    }

    return charge;
  }

  /**
   * Formata template de texto substituindo variáveis
   */
  interpolateMessage(template: string, charge: BillingCharge, agentName: string): string {
    const formattedAmount = charge.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formattedDate = this.formatDateBR(charge.dueDate);

    return template
      .replace(/{nome}/g, charge.customerName)
      .replace(/{servico}/g, charge.serviceDescription || charge.serviceType)
      .replace(/{valor}/g, formattedAmount)
      .replace(/{vencimento}/g, formattedDate)
      .replace(/{empresa}/g, agentName)
      .replace(/{chave_pix}/g, charge.pixKey || '')
      .replace(/{pix_copia_cola}/g, charge.pixCopiaECola || '');
  }

  /**
   * Dispara a cobrança para o cliente via WAHA (Inicial, Reenvio ou Régua Recorrente)
   */
  async dispatchBilling(
    chargeId: string,
    triggerType: 'envio_inicial' | 'reenvio_manual' | 'regua_recorrente' | 'envio_agendado'
  ): Promise<boolean> {
    const charge = this.getChargeById(chargeId);
    if (!charge) {
      throw new Error(`Cobrança com ID ${chargeId} não encontrada.`);
    }

    const agent = agentManager.getAgent(charge.agentId) || agentManager.getDefaultAgent();
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : (env.wahaSession || 'default');
    const companyName = agent.companyName || agent.name || 'Setor Financeiro';

    const formattedAmount = charge.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const formattedDate = this.formatDateBR(charge.dueDate);

    try {
      // 1. Constrói mensagem base personalizada
      let baseMessage = charge.customMessageTemplate;

      if (!baseMessage) {
        if (triggerType === 'regua_recorrente') {
          baseMessage =
            `🏢 *${companyName}* — Lembrete de Pagamento ⚠️\n\n` +
            `Olá, *{nome}*! Tudo bem? 😊\n\n` +
            `Notamos em nosso sistema que a fatura referente a *{servico}* no valor de *{valor}* venceu em *{vencimento}*.\n\n` +
            `💳 *Já realizou o pagamento?*\n` +
            `Por favor, nos responda enviando o *comprovante* por aqui para darmos a baixa imediata!\n\n` +
            `📄 Caso precise da 2ª via ou informações para pagamento, estamos à sua inteira disposição.`;
        } else {
          // Envio inicial ou reenvio manual
          if (charge.billingMethod === 'pix') {
            baseMessage =
              `🏢 *${companyName}*\n\n` +
              `Olá, *{nome}*! 👋\n\n` +
              `Segue a sua cobrança referente a *{servico}*:\n\n` +
              `💰 *Valor:* {valor}\n` +
              `📅 *Vencimento:* {vencimento}\n\n` +
              (charge.pixKey ? `🔑 *Chave PIX:* \`${charge.pixKey}\`\n\n` : '') +
              `👇 Abaixo enviamos o código *PIX Copia e Cola* para pagamento rápido e sem complicações.`;
          } else {
            baseMessage =
              `🏢 *${companyName}*\n\n` +
              `Olá, *{nome}*! 👋\n\n` +
              `Segue em anexo a sua fatura/boleto referente a *{servico}*:\n\n` +
              `💰 *Valor:* {valor}\n` +
              `📅 *Vencimento:* {vencimento}\n\n` +
              `Após o pagamento, basta enviar o comprovante por este mesmo número. Muito obrigado! ✨`;
          }
        }
      }

      const textToSend = this.interpolateMessage(baseMessage, charge, companyName);

      // 2. Disparo de Arquivo (Boleto PDF ou QR Code PIX) via WAHA /api/sendFile
      let fileSent = false;

      // Envia Boleto PDF se aplicável
      if ((charge.billingMethod === 'boleto' || charge.billingMethod === 'ambos') && charge.pdfFilePath && fs.existsSync(charge.pdfFilePath)) {
        const fileBuffer = fs.readFileSync(charge.pdfFilePath);
        const base64Data = fileBuffer.toString('base64');

        await wahaClient.sendFile(
          charge.customerChatId,
          {
            mimetype: 'application/pdf',
            filename: charge.pdfFileName || 'Boleto.pdf',
            base64: `data:application/pdf;base64,${base64Data}`
          },
          textToSend,
          { session }
        );
        fileSent = true;
      }

      // Envia Imagem do QR Code PIX se aplicável
      if ((charge.billingMethod === 'pix' || charge.billingMethod === 'ambos') && charge.pixQrCodeFilePath && fs.existsSync(charge.pixQrCodeFilePath)) {
        const fileBuffer = fs.readFileSync(charge.pixQrCodeFilePath);
        const base64Data = fileBuffer.toString('base64');
        const ext = path.extname(charge.pixQrCodeFilePath).toLowerCase();
        const mime = ext === '.pdf' ? 'application/pdf' : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

        await wahaClient.sendFile(
          charge.customerChatId,
          {
            mimetype: mime,
            filename: charge.pixQrCodeFileName || 'QRCode_PIX.png',
            base64: `data:${mime};base64,${base64Data}`
          },
          fileSent ? '💠 QR Code para pagamento via PIX:' : textToSend,
          { session }
        );
        fileSent = true;
      }

      // Se nenhum arquivo foi enviado (ex: PIX só com chave/código ou sem anexo), envia como texto
      if (!fileSent) {
        const res = await wahaClient.sendText(charge.customerChatId, textToSend, { session });
        botTracker.recordBotMessage(charge.customerChatId, textToSend, res?.id);
      }

      // 3. Se for PIX e possuir código Copia e Cola, envia mensagem dedicada para copiar com 1 clique!
      if (charge.pixCopiaECola && charge.pixCopiaECola.trim()) {
        const copyPasteMsg = 
          `📱 *Código PIX Copia e Cola:*\n` +
          `_(Toque na mensagem abaixo para copiar e cole no app do seu banco)_\n\n` +
          `\`\`\`\n${charge.pixCopiaECola.trim()}\n\`\`\``;

        const copyRes = await wahaClient.sendText(charge.customerChatId, copyPasteMsg, { session });
        botTracker.recordBotMessage(charge.customerChatId, copyPasteMsg, copyRes?.id);
      }

      // Atualiza estado da cobrança
      const now = new Date().toISOString();
      charge.statusEnvio = 'enviado';
      charge.lastSentAt = now;
      charge.sendAttempts = (charge.sendAttempts || 0) + 1;
      charge.updatedAt = now;
      this.saveToDisk();

      // Grava log
      this.addLog({
        billingId: charge.id,
        agentId: charge.agentId,
        customerName: charge.customerName,
        customerPhone: charge.customerPhone,
        type: triggerType,
        status: 'sucesso',
        message: `Disparo realizado com sucesso para ${charge.customerPhone} (${triggerType}). Forma: ${charge.billingMethod.toUpperCase()}. Tentativa #${charge.sendAttempts}.`
      });

      return true;
    } catch (err: any) {
      console.error(`[BillingManager] Falha ao disparar cobrança ${charge.id} para ${charge.customerChatId}:`, err.message);

      const now = new Date().toISOString();
      charge.statusEnvio = 'falha';
      charge.updatedAt = now;
      this.saveToDisk();

      this.addLog({
        billingId: charge.id,
        agentId: charge.agentId,
        customerName: charge.customerName,
        customerPhone: charge.customerPhone,
        type: triggerType,
        status: 'falha',
        message: `Falha no disparo (${triggerType}): ${err.message}`
      });

      return false;
    }
  }

  /**
   * Varre cobranças agendadas cujo horário já chegou e realiza o disparo automático
   */
  async checkAndDispatchScheduledCharges(): Promise<number> {
    const now = new Date();
    // Procura cobranças com statusEnvio === 'agendado' e scheduledSendAt <= now
    const eligible = this.charges.filter(c => {
      if (c.statusEnvio !== 'agendado' || !c.scheduledSendAt) return false;
      if (c.statusPagamento === 'pago' || c.statusPagamento === 'cancelado') return false;
      const scheduledTime = new Date(c.scheduledSendAt);
      return !isNaN(scheduledTime.getTime()) && scheduledTime <= now;
    });

    if (eligible.length === 0) return 0;

    console.log(`[BillingManager] ⏰ Processando ${eligible.length} cobrança(s) agendada(s) prontas para disparo...`);
    let dispatched = 0;
    for (const charge of eligible) {
      try {
        console.log(`[BillingManager] ⏰ Disparando cobrança agendada ${charge.id} para ${charge.customerName} (${charge.customerPhone})...`);
        const success = await this.dispatchBilling(charge.id, 'envio_agendado');
        if (success) {
          dispatched++;
        }
        // Pausa de 1.5s entre disparos
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (err: any) {
        console.error(`[BillingManager] Erro ao disparar cobrança agendada ${charge.id}:`, err.message);
      }
    }
    return dispatched;
  }

  /**
   * Baixa manual da cobrança (pagamento confirmado pelo operador)
   * Envia opcionalmente (habilitado por padrão) mensagem de confirmação e agradecimento pelo WhatsApp.
   */
  async markAsPaidManual(
    chargeId: string,
    options?: {
      paidBy?: string;
      notes?: string;
      paidMethod?: string;
      sendReceiptMessage?: boolean;
      customReceiptMessage?: string;
    }
  ): Promise<BillingCharge> {
    const charge = this.getChargeById(chargeId);
    if (!charge) {
      throw new Error(`Cobrança com ID ${chargeId} não encontrada.`);
    }

    const now = new Date().toISOString();
    charge.statusPagamento = 'pago';
    charge.paidAt = now;
    charge.paidMethod = options?.paidMethod || 'manual';
    charge.paidBy = options?.paidBy || 'Operador';
    if (options?.notes) {
      charge.notes = charge.notes ? `${charge.notes}\n[${now}] ${options.notes}` : options.notes;
    }
    charge.updatedAt = now;
    this.saveToDisk();

    let receiptSent = false;
    const shouldSendReceipt = options?.sendReceiptMessage !== false;

    if (shouldSendReceipt && charge.customerChatId) {
      try {
        const agent = agentManager.getAgent(charge.agentId) || agentManager.getDefaultAgent();
        const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : (env.wahaSession || 'default');
        const companyName = agent.companyName || agent.name || 'Setor Financeiro';
        const formattedAmount = charge.amount.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
        const todayDateBR = this.formatDateBR(this.getTodayDateString());
        const methodLabel = options?.paidMethod || charge.paidMethod || 'PIX / Pagamento';

        // Busca dados do imóvel se for cliente locatário
        const customer = (charge.customerId ? customerManager.getCustomerById(charge.customerId) : undefined)
          || customerManager.findCustomerByPhone(charge.customerPhone, charge.agentId);

        let rentalInfoStr = '';
        if (customer?.isRentalCustomer && customer.rentalInfo) {
          const parts: string[] = [];
          if (customer.rentalInfo.propertyCode) parts.push(`Cód. ${customer.rentalInfo.propertyCode}`);
          if (customer.rentalInfo.propertyType) parts.push(customer.rentalInfo.propertyType);
          if (customer.rentalInfo.propertyAddress) parts.push(customer.rentalInfo.propertyAddress);
          rentalInfoStr = parts.join(' - ');
        }

        let messageText = options?.customReceiptMessage?.trim();
        if (!messageText) {
          messageText =
            `🏢 *${companyName}* — Confirmação de Pagamento Recebido ✅\n\n` +
            `Olá, *{nome}*! 👋\n\n` +
            `Confirmamos com sucesso o recebimento do seu pagamento!\n\n` +
            `📋 *Referente a:* {servico}\n` +
            (rentalInfoStr ? `🏠 *Imóvel:* {imovel}\n` : '') +
            `💰 *Valor recebido:* {valor}\n` +
            `💳 *Forma:* {metodo}\n` +
            `📅 *Data de confirmação:* {data}\n\n` +
            `Muito obrigado pela atenção, pontualidade e preferência! A sua fatura já foi devidamente baixada em nosso sistema financeiro. ✨\n\n` +
            `Caso precise de 2ª via, recibo ou qualquer outra informação, estamos à sua inteira disposição. Tenha um ótimo dia! 😊`;
        }

        const interpolated = messageText
          .replace(/{nome}/g, charge.customerName)
          .replace(/{servico}/g, charge.serviceDescription || charge.serviceType)
          .replace(/{valor}/g, formattedAmount)
          .replace(/{metodo}/g, methodLabel)
          .replace(/{data}/g, todayDateBR)
          .replace(/{empresa}/g, companyName)
          .replace(/{imovel}/g, rentalInfoStr || 'Imóvel locado');

        const res = await wahaClient.sendText(charge.customerChatId, interpolated, { session });
        botTracker.recordBotMessage(charge.customerChatId, interpolated, res?.id);
        receiptSent = true;
      } catch (err: any) {
        console.warn(`[BillingManager] Falha ao enviar mensagem de confirmação de recebimento para ${charge.customerChatId}:`, err.message);
      }
    }

    this.addLog({
      billingId: charge.id,
      agentId: charge.agentId,
      customerName: charge.customerName,
      customerPhone: charge.customerPhone,
      type: 'baixa_manual',
      status: 'sucesso',
      message: receiptSent
        ? `Baixa manual efetuada por ${charge.paidBy}. Mensagem de confirmação e agradecimento enviada via WhatsApp para ${charge.customerPhone}. Valor: R$ ${charge.amount.toFixed(2)}.`
        : `Baixa manual efetuada por ${charge.paidBy}. Valor: R$ ${charge.amount.toFixed(2)}.`
    });

    return charge;
  }

  /**
   * Localiza cobrança pendente para um contato específico (com inteligência de números brasileiros, 9º dígito e LID)
   */
  findPendingChargeForCustomer(chatId: string, agentId?: string): BillingCharge | undefined {
    const isCustomerMatch = (c: BillingCharge): boolean => {
      if (matchPhoneOrChatId(chatId, c.customerChatId)) return true;
      if (matchPhoneOrChatId(chatId, c.customerPhone)) return true;
      if (matchPhoneOrChatId(c.customerChatId, chatId)) return true;
      const aliases = getAllChatIdAliases(chatId);
      if (aliases.includes(c.customerChatId)) return true;
      const cleanCustomerDigits = (c.customerPhone || '').replace(/\D/g, '');
      if (cleanCustomerDigits.length >= 8) {
        for (const a of aliases) {
          const cleanA = a.replace(/\D/g, '');
          if (cleanA.includes(cleanCustomerDigits) || cleanCustomerDigits.includes(cleanA)) return true;
        }
      }
      return false;
    };

    // 1. Tenta buscar cobrança pendente estritamente do agente informado (se não for '*' ou 'all')
    if (agentId && agentId !== '*' && agentId !== 'all') {
      const charge = this.charges.find(c => {
        const matchAgent = c.agentId === agentId;
        const matchChat = isCustomerMatch(c);
        const isPending = c.statusPagamento === 'pendente' || c.statusPagamento === 'aguardando_confirmacao';
        return matchAgent && matchChat && isPending;
      });
      if (charge) return charge;
    }

    // 2. Fallback global: busca por telefone em qualquer agente!
    // Se o cliente tem uma cobrança pendente e enviou o comprovante, deve associar imediatamente!
    return this.charges.find(c => {
      const matchChat = isCustomerMatch(c);
      const isPending = c.statusPagamento === 'pendente' || c.statusPagamento === 'aguardando_confirmacao';
      return matchChat && isPending;
    });
  }

  /**
   * Registra comprovante enviado pelo cliente via WhatsApp (IA ou Webhook)
   */
  async registerCustomerReceipt(
    chatId: string,
    options: {
      fileBuffer?: Buffer;
      fileName?: string;
      mimeType?: string;
      messageText?: string;
      agentId?: string;
    }
  ): Promise<{ charge: BillingCharge; isNew: boolean } | null> {
    const charge = this.findPendingChargeForCustomer(chatId, options.agentId);
    if (!charge) return null;

    const now = new Date().toISOString();
    let comprovanteUrl = charge.comprovanteUrl;

    // Se o cliente enviou arquivo (imagem ou PDF), salva no disco
    if (options.fileBuffer && options.fileBuffer.length > 0) {
      const originalName = options.fileName || 'comprovante.jpg';
      const saved = this.saveBufferFile(`receipt_${charge.id}`, originalName, options.fileBuffer);
      comprovanteUrl = saved.url;
    }

    charge.statusPagamento = 'aguardando_confirmacao';
    charge.comprovanteUrl = comprovanteUrl;
    charge.comprovanteReceivedAt = now;
    if (options.messageText) {
      charge.comprovanteNote = options.messageText;
    }
    charge.updatedAt = now;
    this.saveToDisk();

    this.addLog({
      billingId: charge.id,
      agentId: charge.agentId,
      customerName: charge.customerName,
      customerPhone: charge.customerPhone,
      type: 'comprovante_recebido',
      status: 'sucesso',
      message: `Comprovante / confirmação recebida do cliente. Status alterado para "Aguardando Confirmação". Anexo: ${comprovanteUrl || 'Nenhum'}.`
    });

    return { charge, isNew: true };
  }

  /**
   * Calcula as 4 métricas analíticas (KPIs)
   */
  getStats(agentId?: string): BillingStats {
    let list = [...this.charges];
    if (agentId && agentId !== 'all') {
      list = list.filter(c => c.agentId === agentId);
    }

    const threshold = this.getOverdueThresholdDateString(3);

    const stats: BillingStats = {
      totalCount: list.length,
      totalAmount: 0,
      receivedCount: 0,
      receivedAmount: 0,
      awaitingConfirmationCount: 0,
      awaitingConfirmationAmount: 0,
      overdueCount: 0,
      overdueAmount: 0
    };

    for (const c of list) {
      stats.totalAmount += c.amount;

      if (c.statusPagamento === 'pago') {
        stats.receivedCount++;
        stats.receivedAmount += c.amount;
      } else if (c.statusPagamento === 'aguardando_confirmacao') {
        stats.awaitingConfirmationCount++;
        stats.awaitingConfirmationAmount += c.amount;
      }

      // Inadimplentes em cobrança recorrente: vencidas há 3 ou mais dias e não pagas
      if ((c.statusPagamento === 'pendente' || c.statusPagamento === 'aguardando_confirmacao') && c.dueDate <= threshold) {
        stats.overdueCount++;
        stats.overdueAmount += c.amount;
      }
    }

    return stats;
  }

  getLogs(billingId?: string, agentId?: string): BillingLog[] {
    let list = [...this.logs];
    if (billingId) {
      list = list.filter(l => l.billingId === billingId);
    }
    if (agentId && agentId !== 'all') {
      list = list.filter(l => l.agentId === agentId);
    }
    return list;
  }

  deleteCharge(id: string): boolean {
    const index = this.charges.findIndex(c => c.id === id);
    if (index === -1) return false;

    const charge = this.charges[index];
    this.charges.splice(index, 1);
    this.saveToDisk();

    this.addLog({
      billingId: charge.id,
      agentId: charge.agentId,
      customerName: charge.customerName,
      customerPhone: charge.customerPhone,
      type: 'cancelamento',
      status: 'info',
      message: `Cobrança de R$ ${charge.amount.toFixed(2)} excluída/cancelada.`
    });

    return true;
  }

  private getTodayDateString(): string {
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  /**
   * Retorna a data no formato YYYY-MM-DD referente a X dias atrás
   */
  getOverdueThresholdDateString(daysAgo: number = 3): string {
    const date = new Date();
    date.setDate(date.getDate() - daysAgo);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  private formatDateBR(isoDate: string): string {
    if (!isoDate) return '';
    const parts = isoDate.split('-');
    if (parts.length === 3) {
      return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return isoDate;
  }
}

export const billingManager = new BillingManager();
