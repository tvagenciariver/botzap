import fs from 'fs';
import path from 'path';
import { ExamDispatch, ExamDispatchAttempt, ExamDispatchTarget } from './types.js';
import { partnerManager } from './partner-manager.js';
import { wahaClient } from '../waha/client.js';
import { botTracker } from '../orchestrator/bot-tracker.js';
import { formatToWhatsAppChatId, matchPhoneOrChatId } from './phone-utils.js';
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
    patientCpf?: string;
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

    // Se o envio tiver como destinatário o paciente (patient ou both), valida a exigência do CPF (LGPD)
    const referralType = data.referralType || (data.partnerId ? 'partner' : 'particular');
    let effectiveTarget = data.target;
    if (referralType === 'particular') {
      effectiveTarget = 'patient';
    }

    const cleanCpf = (data.patientCpf || '').replace(/\D/g, '');
    if ((effectiveTarget === 'patient' || effectiveTarget === 'both') && (!cleanCpf || cleanCpf.length < 3)) {
      throw new Error('Informe o CPF do paciente (pelo menos os 3 primeiros dígitos) para a validação de segurança LGPD.');
    }

    const examId = 'exam_' + Math.random().toString(36).substring(2, 9);
    const agent = (data.agentId ? agentManager.getAgent(data.agentId) : null) || agentManager.getDefaultAgent();
    const companyName = agent.companyName || 'Nossa Clínica';
    const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : (env.wahaSession || 'default');

    // 1. Salva arquivo em disco
    const savedFile = this.saveFileToDisk(examId, data.fileName, data.fileBase64);

    // 2. Resolve informações de parceiro se aplicável
    let partnerObj = data.partnerId ? partnerManager.getPartner(data.partnerId) : undefined;
    let partnerName = partnerObj ? partnerObj.name : undefined;
    let partnerPhone = partnerObj ? partnerObj.phone : undefined;

    const patientChatId = formatToWhatsAppChatId(data.patientPhone);
    const partnerChatId = partnerPhone ? formatToWhatsAppChatId(partnerPhone) : '';

    const attempts: ExamDispatchAttempt[] = [];
    const base64Prefix = data.fileBase64.startsWith('data:') ? data.fileBase64 : `data:${data.fileMimeType};base64,${data.fileBase64}`;

    // 3. Envio para o Paciente: CAMADA DE SEGURANÇA LGPD
    // O arquivo NÃO é entregue imediatamente. É disparado o desafio solicitando os 3 primeiros dígitos do CPF!
    if (effectiveTarget === 'patient' || effectiveTarget === 'both') {
      const challengeMessage =
        `🏥 *${companyName}*\n` +
        `Olá, *${data.patientName.trim()}*! 👋\n\n` +
        `Informamos que o seu *resultado de exame / laudo médico* está disponível em nosso sistema. 📄🩺\n\n` +
        (partnerName ? `🏢 *Encaminhamento / Convênio:* ${partnerName}\n\n` : '') +
        `🔒 *Confirmação de Segurança (LGPD & Sigilo Médico):*\n` +
        `⚠️ *Digite os 3 primeiros dígitos do seu CPF* para confirmar sua identidade e liberar o envio imediato do seu laudo.`;

      try {
        const sendRes = await wahaClient.sendText(
          patientChatId,
          challengeMessage,
          { session }
        );

        botTracker.recordBotMessage(patientChatId, challengeMessage, sendRes?.id);
        attempts.push({
          target: 'patient',
          recipientName: data.patientName.trim(),
          chatId: patientChatId,
          phone: data.patientPhone.trim(),
          success: true,
          messageId: sendRes?.id,
          sentAt: new Date().toISOString()
        });
        console.log(`[ExamService] Desafio LGPD (3 primeiros dígitos do CPF) enviado com sucesso para ${data.patientName} (${patientChatId}).`);
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
        console.error(`[ExamService] Falha ao enviar desafio de segurança para o paciente:`, err.message);
      }
    }

    // 4. Envio para a Empresa Parceira (DIRETO E IMEDIATO, SEM EXIGÊNCIA DE CPF)
    if ((effectiveTarget === 'partner' || effectiveTarget === 'both') && partnerChatId) {
      const partnerCaption = `📄 *Envio de Resultado de Exame de Paciente*\n\n` +
        `🏢 *Empresa / Parceiro:* ${partnerName}\n` +
        `🏥 *Clínica Emissora:* ${companyName}\n` +
        `👤 *Paciente:* ${data.patientName.trim()}\n` +
        `📱 *Contato do Paciente:* ${data.patientPhone.trim()}\n` +
        (cleanCpf ? `🔒 *CPF Paciente:* ${cleanCpf.substring(0, 3)}.***.***-**\n` : '') +
        `📅 *Data do Envio:* ${new Date().toLocaleDateString('pt-BR')}\n\n` +
        (data.caption ? `📝 *Observação:* ${data.caption}\n\n` : '') +
        `_Laudo oficial enviado pelo sistema BotZap diretamente à empresa conveniada._`;

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
        console.log(`[ExamService] Exame enviado diretamente com sucesso para o parceiro ${partnerName} (${partnerChatId}).`);
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
    let status: 'sent' | 'partial' | 'failed' | 'awaiting_cpf' = 'failed';
    if (effectiveTarget === 'partner') {
      const partnerAttempt = attempts.find(a => a.target === 'partner');
      status = (partnerAttempt && partnerAttempt.success) ? 'sent' : 'failed';
    } else {
      // Se envolve paciente, fica aguardando a confirmação do CPF
      const patientAttempt = attempts.find(a => a.target === 'patient');
      if (patientAttempt && patientAttempt.success) {
        status = 'awaiting_cpf';
      } else {
        status = 'failed';
      }
    }

    const examRecord: ExamDispatch = {
      id: examId,
      agentId: agent.id,
      appointmentId: data.appointmentId,
      patientName: data.patientName.trim(),
      patientPhone: data.patientPhone.trim(),
      patientChatId,
      patientCpf: cleanCpf || undefined,
      cpfVerified: false,
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
   * Localiza exames com status 'awaiting_cpf' pendentes de confirmação para este contato
   */
  getPendingExamsForChat(chatId: string): ExamDispatch[] {
    return this.exams.filter(exam => {
      if (exam.status !== 'awaiting_cpf') return false;
      return matchPhoneOrChatId(exam.patientChatId, chatId) || matchPhoneOrChatId(exam.patientPhone, chatId);
    });
  }

  /**
   * Valida os dígitos informados pelo paciente e entrega os laudos físicos em caso de correspondência
   */
  async verifyCpfAndDeliver(
    chatId: string,
    inputMessage: string,
    sessionName?: string
  ): Promise<{ success: boolean; replyText: string; deliveredExams: ExamDispatch[] }> {
    const pendingExams = this.getPendingExamsForChat(chatId);
    if (pendingExams.length === 0) {
      return { success: false, replyText: '', deliveredExams: [] };
    }

    const inputDigits = inputMessage.replace(/\D/g, '');

    // Se digitou menos de 3 dígitos numéricos
    if (inputDigits.length < 3) {
      const hintMsg =
        `⚠️ *Confirmação de Segurança (LGPD)*\n\n` +
        `Para liberar o seu resultado com total sigilo médico, por favor, *digite os 3 primeiros dígitos do seu CPF*.\n` +
        `_(Exemplo: se o seu CPF começa com 123.456..., digite apenas *123*)_.\n\n` +
        `_Caso precise de outro atendimento, digite *humano* para falar com nossa equipe._`;
      return { success: false, replyText: hintMsg, deliveredExams: [] };
    }

    // Compara com os 3 primeiros dígitos do CPF cadastrado no exame
    const matchedExams = pendingExams.filter(exam => {
      const expected3 = (exam.patientCpf || '').replace(/\D/g, '').substring(0, 3);
      return expected3 && (inputDigits.startsWith(expected3) || inputDigits === expected3);
    });

    // Se os dígitos informados NÃO conferem
    if (matchedExams.length === 0) {
      const mismatchMsg =
        `⚠️ *Os dígitos informados não conferem com o CPF cadastrado.*\n\n` +
        `Por favor, confira e digite novamente os *3 primeiros dígitos do CPF* do titular do exame para que possamos liberar seu documento com segurança.\n\n` +
        `_Caso queira falar diretamente com nossa recepção, digite *humano*._`;
      return { success: false, replyText: mismatchMsg, deliveredExams: [] };
    }

    // Sucesso! Entrega os arquivos de todos os exames validados
    for (const exam of matchedExams) {
      const agent = agentManager.getAgent(exam.agentId) || agentManager.getDefaultAgent();
      const companyName = agent.companyName || 'Nossa Clínica';
      const session = (sessionName && sessionName !== 'simulator' && sessionName !== '*')
        ? sessionName
        : ((agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : (env.wahaSession || 'default'));

      let fileSentOk = false;
      if (fs.existsSync(exam.fileStoredPath)) {
        try {
          const fileBuffer = fs.readFileSync(exam.fileStoredPath);
          const base64Data = fileBuffer.toString('base64');
          const base64Prefix = `data:${exam.fileMimeType};base64,${base64Data}`;

          const patientCaption = exam.caption && exam.caption.trim()
            ? exam.caption.trim()
            : `📄 *Resultado de Exame / Laudo Médico*\n\n` +
              `👤 *Paciente:* ${exam.patientName}\n` +
              (exam.partnerName ? `🏢 *Encaminhamento / Convênio:* ${exam.partnerName}\n` : '') +
              `🏥 *${companyName}*\n\n` +
              `_Documento emitido com segurança e privacidade._`;

          if (sessionName !== 'simulator') {
            const sendRes = await wahaClient.sendFile(
              exam.patientChatId,
              {
                mimetype: exam.fileMimeType,
                filename: exam.originalName,
                base64: base64Prefix
              },
              patientCaption,
              { session }
            );
            botTracker.recordBotMessage(exam.patientChatId, patientCaption, sendRes?.id);
          }
          fileSentOk = true;
          console.log(`[ExamService] Laudo entregue com sucesso após validação de CPF para ${exam.patientName} (${exam.patientChatId}).`);
        } catch (err: any) {
          console.error(`[ExamService] Erro ao enviar arquivo após confirmação de CPF para ${exam.patientChatId}:`, err.message);
        }
      }

      exam.status = fileSentOk ? 'sent' : 'failed';
      exam.cpfVerified = true;
      exam.cpfVerifiedAt = new Date().toISOString();
      exam.updatedAt = new Date().toISOString();
      exam.attempts.push({
        target: 'patient',
        recipientName: exam.patientName,
        chatId: exam.patientChatId,
        phone: exam.patientPhone,
        success: fileSentOk,
        sentAt: new Date().toISOString()
      });
    }

    this.saveToDisk();

    const fileNames = matchedExams.map(e => `*${e.originalName}*`).join(', ');
    const replyText =
      `✅ *Identidade confirmada com sucesso!* 🎉\n\n` +
      `Seu resultado de exame/laudo (${fileNames}) foi autenticado e liberado com segurança! 📄🩺\n\n` +
      `_Agradecemos pela confiança e estamos à inteira disposição para quaisquer dúvidas ou novos agendamentos!_`;

    return {
      success: true,
      replyText,
      deliveredExams: matchedExams
    };
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
      if (exam.cpfVerified) {
        // Já verificou CPF: reenvia o arquivo diretamente
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
      } else {
        // Ainda não verificou CPF: re-dispara a mensagem de confirmação de segurança dos 3 dígitos
        const challengeMessage =
          `🏥 *${companyName}*\n` +
          `Olá, *${exam.patientName}*! 👋\n\n` +
          `Lembramos que o seu *resultado de exame / laudo médico* está pronto em nosso sistema.\n\n` +
          (exam.partnerName ? `🏢 *Encaminhamento / Convênio:* ${exam.partnerName}\n\n` : '') +
          `🔒 *Confirmação de Segurança (LGPD & Sigilo Médico):*\n` +
          `⚠️ *Digite os 3 primeiros dígitos do seu CPF* para confirmar sua identidade e liberar o envio do seu laudo.`;

        try {
          const sendRes = await wahaClient.sendText(exam.patientChatId, challengeMessage, { session });
          botTracker.recordBotMessage(exam.patientChatId, challengeMessage, sendRes?.id);
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
    }

    // Reenvio para Empresa Parceira (DIRETO, SEM CPF)
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
    let status: 'sent' | 'partial' | 'failed' | 'awaiting_cpf' = 'failed';
    if (target === 'partner') {
      status = (successes.length > 0) ? 'sent' : 'failed';
    } else {
      if (exam.cpfVerified) {
        status = (successes.length > 0) ? 'sent' : 'failed';
      } else {
        status = 'awaiting_cpf';
      }
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
        (e.patientCpf && e.patientCpf.includes(q)) ||
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
