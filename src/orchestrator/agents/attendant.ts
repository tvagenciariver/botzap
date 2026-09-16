import { IAgent, AgentContext, AgentResponse } from './base.js';
import { llmProviderManager } from '../llm-provider.js';
import { examService } from '../../appointments/exam-service.js';
import { ExamDeliveryAgent } from './exam-delivery.js';
import { BookingAgent } from './booking.js';

export class AttendantAgent implements IAgent {
  name = 'SmartAttendantAgent';
  description = 'Agente de Atendimento ao Cliente alimentado por IA (Google Gemini / OpenAI)';

  canHandle(_context: AgentContext): boolean {
    return true;
  }

  async execute(context: AgentContext): Promise<AgentResponse> {
    // 🛡️ BLINDAGEM CRÍTICA DE LEMBRETE D-1:
    // Se o cliente respondeu a um lembrete (1, 2, "sim", "não", "confirmar", "cancelar", "liberar vaga"),
    // NUNCA deixar a IA (Gemini/OpenAI) responder com alucinações (como "material recebido...").
    const rawClean = (context.userMessage || '')
      .replace(/[\u2000-\u200F\u2028-\u202F\u205F-\u206F\uFEFF\u00A0]/g, '')
      .trim();
    const cleanOnlyDigits = rawClean.replace(/\D/g, '');

    const bookingAgent = new BookingAgent();
    const isReminder = bookingAgent.isReminderChoice(context.userMessage) ||
      cleanOnlyDigits === '1' ||
      cleanOnlyDigits === '2' ||
      rawClean === '1' ||
      rawClean === '2';

    if (isReminder) {
      console.log(`[AttendantAgent] 🛡️ Interceptada escolha de lembrete ("${context.userMessage}"). Tentando resolver via BookingAgent...`);
      const apt = bookingAgent.findReminderAppointment(context);
      if (apt) {
        return await bookingAgent.execute(context);
      } else {
        const isCancel = cleanOnlyDigits === '2' || bookingAgent.isCancelChoice(context.userMessage);
        return {
          handled: true,
          replyText: isCancel
            ? `Entendido! Você escolheu cancelar seu agendamento (opção *2*).\n\nPara localizarmos seu cadastro e liberar o horário no sistema, por favor informe o seu *Nome Completo*, ou digite *humano* para falar diretamente com a recepção.`
            : `Entendido! Você escolheu confirmar sua presença (opção *1*).\n\nPara localizarmos seu cadastro e confirmar sua vaga, por favor informe o seu *Nome Completo*, ou digite *humano* para falar diretamente com a recepção.`,
          action: 'none',
          agentName: this.name
        };
      }
    }

    // PROTEÇÃO CRÍTICA: Se a mensagem do cliente for composta unicamente por dígitos ou formatação de CPF
    // (ex: "123", "582", "123.456.789-00"), NUNCA enviar para a IA (OpenAI / Gemini).
    // Evita respostas alucinadas como: "Olá, notei que continua enviando apenas números, vou te transferir..."
    const rawTrimmed = context.userMessage.trim();
    const cleanDigits = rawTrimmed.replace(/\D/g, '');
    const isPureDigitsOrCpf = /^[\d.\-\s,]{3,20}$/.test(rawTrimmed) && cleanDigits.length >= 3;

    if (isPureDigitsOrCpf && context.agent?.enableBooking) {
      // 1. Tenta validar como entrega de exame
      const pendingExam = examService.findPendingExam(context.chatId, context.userMessage, context.agent?.id);
      if (pendingExam) {
        const examAgent = new ExamDeliveryAgent();
        return await examAgent.execute(context);
      }

      // 2. Se não há exame pendente para esse número/contato:
      return {
        handled: true,
        replyText: `Olá! Recebemos sua resposta (*${cleanDigits}*).\n\n` +
          `Se você está tentando liberar o resultado do seu exame/laudo, verifique se o aviso de exame pronto já foi enviado para este WhatsApp ou digite *humano* para falar com nossa recepção! 👩‍⚕️🤝`,
        action: 'none',
        agentName: this.name
      };
    }

    try {
      const result = await llmProviderManager.generateReply(
        context.chatId,
        context.userMessage,
        context.contactName,
        context.agent
      );

      const providerLabel = result.provider === 'openai' 
        ? `OpenAI (${result.model})` 
        : `Gemini (${result.model})`;

      const agentLabel = context.agent?.name
        ? `${context.agent.name} [${providerLabel}]`
        : providerLabel;

      return {
        handled: true,
        replyText: result.text,
        action: 'none',
        agentName: agentLabel
      };
    } catch (error: any) {
      console.error(`[AttendantAgent] Erro ao processar mensagem com IA:`, error.message);
      const isSimulation = context.chatId.startsWith('simulador_');
      const clientMessage = 'Olá! No momento estamos com uma instabilidade técnica momentânea em nosso atendimento automatizado. Nossa equipe humana já foi notificada e logo te responderá por aqui!';
      return {
        handled: true,
        replyText: isSimulation 
          ? `⚠️ Aviso do Bot: Não foi possível obter resposta da IA (${error.message}). Por favor, verifique sua chave de API e modelo nas configurações.`
          : clientMessage,
        action: 'none',
        agentName: this.name
      };
    }
  }
}
