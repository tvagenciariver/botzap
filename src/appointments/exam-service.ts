import fs from 'fs';
import path from 'path';
import { ExamDispatch, ExamDispatchAttempt, ExamDispatchTarget } from './types.js';
import { partnerManager } from './partner-manager.js';
import { wahaClient } from '../waha/client.js';
import { botTracker } from '../orchestrator/bot-tracker.js';
import { formatToWhatsAppChatId } from './phone-utils.js';
import { agentManager } from '../config/agent-manager.js';
import { env } from '../config/index.js';

export class ExamService {
  private examsFile: string;
  private uploadsDir: string;
  private exams: ExamDispatch[] = [];

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    this.uploadsDir = path.join(dataDir, 'uploads', 'exams');
    if (!fs.existsSync(this.uploadsDir)) {
      fs.mkdirSync(this.uploadsDir, { recursive: true });
    }
    this.examsFile = path.join(dataDir, 'exams.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.examsFile)) {
        const raw = fs.readFileSync(this.examsFile, 'utf-8');
        this.exams = JSON.parse(raw);
        console.log(`[ExamService] ${this.exams.length} registro(s) de exame(s) carregado(s).`);
      }
    } catch (err: any) {
      console.warn('[ExamService] Aviso ao carregar exams.json:', err.message);
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.examsFile, JSON.stringify(this.exams, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[ExamService] Erro ao salvar exams.json:', err.message);
    }
  }

  getUploadsDir(): string {
    return this.uploadsDir;
  }

  /**
   * Salva arquivo enviado em Base64 para o disco local em data/uploads/exams/
   */
  private saveFileToDisk(examId: string, originalName: string, base64Data: string): { filePath: string; fileName: string; size: number } {
    const cleanBase64 = base64Data.replace(/^data:[^;]+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const ext = path.extname(originalName) || '.pdf';
    const safeBaseName = path.basename(originalName, ext).replace(/[^a-zA-Z0-9_-]/g, '_');
    const storedFileName = `${examId}_${safeBaseName}${ext}`;
    const targetPath = path.join(this.uploadsDir, storedFileName);

    fs.writeFileSync(targetPath, buffer);
    return {
      filePath: targetPath,
      fileName: storedFileName,
      size: buffer.length
    };
  }

  /**
   * Dispara um laudo/exame para o paciente, empresa parceira ou ambos
   */
  async dispatchExam(data: {
    agentId?: string;
    appointmentId?: string;
    patientName: string;
    patientPhone: string;
    referralType?: 'particular' | 'partner';
    partnerId?: string;
    target: ExamDispatchTarget;
    fileName: string;
    fileMimeType: string;
    fileBase64: string;
    caption?: string;
    sentBy?: string;
  }): Promise<ExamDispatch> {
    if (!data.patientName || !data.patientName.trim()) {
      throw new Error('Informe o nome do paciente.');
    }
    if (!data.patientPhone || !data.patientPhone.trim()) {
      throw new Error('Informe o telefone WhatsApp do paciente.');
    }
    if (!data.fileBase64) {
      throw new Error('O arquivo do laudo/exame é obrigatório.');
    }

    const examId = 'exam_' + Math.random().toString(36).substring(2, 9);
    const agent = (data.agentId ? agentManager.getAgent(data.agentId) : null) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : (env.wahaSession || 'default');

    // 1. Salva arquivo em disco
    const savedFile = this.saveFileToDisk(examId, data.fileName, data.fileBase64);

    // 2. Resolve informações de parceiro se aplicável
    const referralType = data.referralType || (data.partnerId ? 'partner' : 'particular');
    let partnerObj = data.partnerId ? partnerManager.getPartner(data.partnerId) : undefined;
    let partnerName = partnerObj ? partnerObj.name : undefined;
    let partnerPhone = partnerObj ? partnerObj.phone : undefined;

    // Se referralType for particular, garante que target seja paciente
    let effectiveTarget = data.target;
    if (referralType === 'particular') {
      effectiveTarget = 'patient';
    }

    const patientChatId = formatToWhatsAppChatId(data.patientPhone);
    const partnerChatId = partnerPhone ? formatToWhatsAppChatId(partnerPhone) : '';

    const attempts: ExamDispatchAttempt[] = [];
    const base64Prefix = data.fileBase64.startsWith('data:') ? data.fileBase64 : `data:${data.fileMimeType};base64,${data.fileBase64}`;

    // 3. Envio para o Paciente
    if (effectiveTarget === 'patient' || effectiveTarget === 'both') {
      const patientCaption = data.caption && data.caption.trim()
        ? data.caption.trim()
        : `Olá, *${data.patientName.trim()}*! 👋\n\n` +
          `Aqui é da equipe da *${companyName}*.\n` +
          `Segue em anexo o resultado do seu exame/laudo. 📄🩺\n\n` +
          (partnerName ? `🏢 *Encaminhamento / Convênio:* ${partnerName}\n\n` : '') +
          `_Qualquer dúvida sobre seus exames ou agendamentos, estamos à sua inteira disposição!_`;

      try {
        const sendRes = await wahaClient.sendFile(
          patientChatId,
          {
            mimetype: data.fileMimeType,
            filename: data.fileName,
            base64: base64Prefix
          },
          patientCaption,
          { session }
        );

        botTracker.recordBotMessage(patientChatId, patientCaption, sendRes?.id);
        attempts.push({
          target: 'patient',
          recipientName: data.patientName.trim(),
          chatId: patientChatId,
          phone: data.patientPhone.trim(),
          success: true,
          messageId: sendRes?.id,
          sentAt: new Date().toISOString()
        });
        console.log(`[ExamService] Exame enviado com sucesso para o paciente ${data.patientName} (${patientChatId}).`);
      } catch (err: any) {
        attempts.push({
          target: 'patient',
          recipientName: data.patientName.trim(),
          chatId: patientChatId,
          phone: data.patientPhone.trim(),
          success: false,
          error: err.message,
          sentAt: new Date().toISOString()
        });
        console.error(`[ExamService] Falha ao enviar exame para o paciente:`, err.message);
      }
    }

    // 4. Envio para a Empresa Parceira
    if ((effectiveTarget === 'partner' || effectiveTarget === 'both') && partnerChatId) {
      const partnerCaption = `📄 *Envio de Resultado de Exame de Paciente*\n\n` +
        `🏢 *Empresa / Parceiro:* ${partnerName}\n` +
        `🏥 *Clínica Emissora:* ${companyName}\n` +
        `👤 *Paciente:* ${data.patientName.trim()}\n` +
        `📱 *Contato do Paciente:* ${data.patientPhone.trim()}\n` +
        `📅 *Data do Envio:* ${new Date().toLocaleDateString('pt-BR')}\n\n` +
        (data.caption ? `📝 *Observação:* ${data.caption}\n\n` : '') +
        `_Laudo oficial enviado pelo sistema BotZap._`;

      try {
        const sendRes = await wahaClient.sendFile(
          partnerChatId,
          {
            mimetype: data.fileMimeType,
            filename: data.fileName,
            base64: base64Prefix
          },
          partnerCaption,
          { session }
        );

        botTracker.recordBotMessage(partnerChatId, partnerCaption, sendRes?.id);
        attempts.push({
          target: 'partner',
          recipientName: partnerName || 'Empresa Parceira',
          chatId: partnerChatId,
          phone: partnerPhone || '',
          success: true,
          messageId: sendRes?.id,
          sentAt: new Date().toISOString()
        });
        console.log(`[ExamService] Exame enviado com sucesso para o parceiro ${partnerName} (${partnerChatId}).`);
      } catch (err: any) {
        attempts.push({
          target: 'partner',
          recipientName: partnerName || 'Empresa Parceira',
          chatId: partnerChatId,
          phone: partnerPhone || '',
          success: false,
          error: err.message,
          sentAt: new Date().toISOString()
        });
        console.error(`[ExamService] Falha ao enviar exame para a empresa parceira:`, err.message);
      }
    }

    // 5. Determina status final
    const successes = attempts.filter(a => a.success);
    let status: 'sent' | 'partial' | 'failed' = 'failed';
    if (successes.length === attempts.length && attempts.length > 0) {
      status = 'sent';
    } else if (successes.length > 0) {
      status = 'partial';
    }

    const examRecord: ExamDispatch = {
      id: examId,
      agentId: agent.id,
      appointmentId: data.appointmentId,
      patientName: data.patientName.trim(),
      patientPhone: data.patientPhone.trim(),
      patientChatId,
      referralType,
      partnerId: data.partnerId,
      partnerName,
      partnerPhone,
      target: effectiveTarget,
      fileName: savedFile.fileName,
      originalName: data.fileName,
      fileStoredPath: savedFile.filePath,
      fileMimeType: data.fileMimeType,
      fileSize: savedFile.size,
      caption: data.caption || '',
      status,
      sentBy: data.sentBy || 'Operador',
      sentAt: new Date().toISOString(),
      attempts,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.exams.unshift(examRecord);
    this.saveToDisk();

    return examRecord;
  }

  /**
   * Reenvia um exame já existente para o paciente, parceiro ou ambos
   */
  async reSendExam(examId: string, customTarget?: ExamDispatchTarget, customCaption?: string): Promise<ExamDispatch> {
    const exam = this.exams.find(e => e.id === examId);
    if (!exam) {
      throw new Error(`Exame com ID "${examId}" não localizado.`);
    }

    if (!fs.existsSync(exam.fileStoredPath)) {
      throw new Error(`Arquivo físico do exame não encontrado em disco.`);
    }

    const fileBuffer = fs.readFileSync(exam.fileStoredPath);
    const base64Data = fileBuffer.toString('base64');
    const target = customTarget || exam.target;

    const agent = agentManager.getAgent(exam.agentId) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : (env.wahaSession || 'default');

    const newAttempts: ExamDispatchAttempt[] = [];
    const base64Prefix = `data:${exam.fileMimeType};base64,${base64Data}`;

    // Reenvio para Paciente
    if (target === 'patient' || target === 'both') {
      const pCaption = customCaption || exam.caption || `Olá, *${exam.patientName}*! Reenviando o seu laudo/exame realizado na *${companyName}*. 📄`;
      try {
        const sendRes = await wahaClient.sendFile(
          exam.patientChatId,
          { mimetype: exam.fileMimeType, filename: exam.originalName, base64: base64Prefix },
          pCaption,
          { session }
        );
        botTracker.recordBotMessage(exam.patientChatId, pCaption, sendRes?.id);
        newAttempts.push({
          target: 'patient',
          recipientName: exam.patientName,
          chatId: exam.patientChatId,
          phone: exam.patientPhone,
          success: true,
          messageId: sendRes?.id,
          sentAt: new Date().toISOString()
        });
      } catch (err: any) {
        newAttempts.push({
          target: 'patient',
          recipientName: exam.patientName,
          chatId: exam.patientChatId,
          phone: exam.patientPhone,
          success: false,
          error: err.message,
          sentAt: new Date().toISOString()
        });
      }
    }

    // Reenvio para Empresa Parceira
    if ((target === 'partner' || target === 'both') && exam.partnerPhone) {
      const partnerChatId = formatToWhatsAppChatId(exam.partnerPhone);
      const partnerCaption = `📄 *Reenvio de Laudo/Exame de Paciente*\n\n` +
        `🏢 *Empresa / Parceiro:* ${exam.partnerName}\n` +
        `👤 *Paciente:* ${exam.patientName}\n` +
        `📱 *WhatsApp do Paciente:* ${exam.patientPhone}\n` +
        `📅 *Data:* ${new Date().toLocaleDateString('pt-BR')}\n\n` +
        `_Reenvio de laudo solicitado via painel BotZap._`;

      try {
        const sendRes = await wahaClient.sendFile(
          partnerChatId,
          { mimetype: exam.fileMimeType, filename: exam.originalName, base64: base64Prefix },
          partnerCaption,
          { session }
        );
        botTracker.recordBotMessage(partnerChatId, partnerCaption, sendRes?.id);
        newAttempts.push({
          target: 'partner',
          recipientName: exam.partnerName || 'Parceiro',
          chatId: partnerChatId,
          phone: exam.partnerPhone,
          success: true,
          messageId: sendRes?.id,
          sentAt: new Date().toISOString()
        });
      } catch (err: any) {
        newAttempts.push({
          target: 'partner',
          recipientName: exam.partnerName || 'Parceiro',
          chatId: partnerChatId,
          phone: exam.partnerPhone,
          success: false,
          error: err.message,
          sentAt: new Date().toISOString()
        });
      }
    }

    // Atualiza registro
    const successes = newAttempts.filter(a => a.success);
    let status: 'sent' | 'partial' | 'failed' = 'failed';
    if (successes.length === newAttempts.length && newAttempts.length > 0) {
      status = 'sent';
    } else if (successes.length > 0) {
      status = 'partial';
    }

    exam.target = target;
    exam.status = status;
    exam.attempts = [...newAttempts, ...exam.attempts];
    exam.updatedAt = new Date().toISOString();

    this.saveToDisk();
    return exam;
  }

  listExams(filters?: {
    agentId?: string;
    partnerId?: string;
    referralType?: string;
    startDate?: string;
    endDate?: string;
    status?: string;
    search?: string;
  }): ExamDispatch[] {
    let list = [...this.exams];

    if (filters?.agentId && filters.agentId !== 'all') {
      list = list.filter(e => e.agentId === filters.agentId);
    }
    if (filters?.partnerId && filters.partnerId !== 'all') {
      list = list.filter(e => e.partnerId === filters.partnerId);
    }
    if (filters?.referralType && filters.referralType !== 'all') {
      list = list.filter(e => e.referralType === filters.referralType);
    }
    if (filters?.status && filters.status !== 'all') {
      list = list.filter(e => e.status === filters.status);
    }
    if (filters?.startDate) {
      list = list.filter(e => e.sentAt.split('T')[0] >= filters.startDate!);
    }
    if (filters?.endDate) {
      list = list.filter(e => e.sentAt.split('T')[0] <= filters.endDate!);
    }
    if (filters?.search && filters.search.trim()) {
      const q = filters.search.toLowerCase().trim();
      list = list.filter(e =>
        e.patientName.toLowerCase().includes(q) ||
        e.patientPhone.includes(q) ||
        (e.partnerName && e.partnerName.toLowerCase().includes(q)) ||
        e.originalName.toLowerCase().includes(q)
      );
    }

    return list.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
  }

  getExam(id: string): ExamDispatch | undefined {
    return this.exams.find(e => e.id === id);
  }

  deleteExam(id: string): boolean {
    const idx = this.exams.findIndex(e => e.id === id);
    if (idx === -1) return false;

    const exam = this.exams[idx];
    if (exam.fileStoredPath && fs.existsSync(exam.fileStoredPath)) {
      try {
        fs.unlinkSync(exam.fileStoredPath);
      } catch (err: any) {
        console.warn(`[ExamService] Erro ao remover arquivo ${exam.fileStoredPath}:`, err.message);
      }
    }

    this.exams.splice(idx, 1);
    this.saveToDisk();
    return true;
  }
}

export const examService = new ExamService();
