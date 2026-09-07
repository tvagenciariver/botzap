import { agentManager } from '../config/agent-manager.js';
import { loadBotConfig, saveBotConfig, defaultBrazilianHolidays, HolidayItem } from '../config/index.js';
import { memoryStore } from '../gemini/memory.js';
import { wahaClient } from '../waha/client.js';
import { examService } from '../appointments/exam-service.js';
import { appointmentManager } from '../appointments/appointment-manager.js';
import { formatToWhatsAppChatId, getAlternateBrazilianChatId } from '../appointments/phone-utils.js';
import { checkBusinessHoursStatus } from './schedule-helper.js';
import { llmProviderManager } from './llm-provider.js';

export interface CommandResult {
  success: boolean;
  command: string;
  action: string;
  message: string;
  data?: any;
  timestamp: string;
}

export class CommandExecutor {
  /**
   * Executa um comando administrativo em tempo real
   */
  async execute(
    rawCommand: string,
    contextUser: { name: string; username: string; role: string },
    targetAgentId?: string
  ): Promise<CommandResult> {
    const timestamp = new Date().toLocaleTimeString('pt-BR');
    const cmd = (rawCommand || '').trim();

    if (!cmd) {
      return {
        success: false,
        command: rawCommand,
        action: 'empty',
        message: 'Comando vazio. Digite "ajuda" para ver os comandos disponíveis.',
        timestamp
      };
    }

    const lower = cmd.toLowerCase();

    // Resolve o agente ativo
    const agent = (targetAgentId && targetAgentId !== '*')
      ? agentManager.getAgent(targetAgentId) || agentManager.getDefaultAgent()
      : agentManager.getDefaultAgent();

    // -----------------------------------------------------------------------
    // 1. AJUDA / HELP
    // -----------------------------------------------------------------------
    if (lower === 'ajuda' || lower === 'help' || lower === 'comandos' || lower === '?') {
      return {
        success: true,
        command: cmd,
        action: 'help',
        message:
          `⚡ **Console de Comandos BotZap - Guia Rápido**\n\n` +
          `**🎉 Feriados & Indisponibilidades:**\n` +
          `• \`feriado <data> <nome>\` (Ex: \`feriado 21/09 Aniversário de Petrolina\` ou \`feriado 2026-11-20 Zumbi\`)\n` +
          `• \`listar feriados\` (Exibe todos os feriados ativos)\n` +
          `• \`remover feriado <nome ou id>\`\n` +
          `• \`carregar feriados nacionais\` (Carrega feriados oficiais do Brasil)\n\n` +
          `**⏸️ Pausa & Gestão de Contatos:**\n` +
          `• \`pausar <telefone> [horas]\` (Ex: \`pausar 87988177877 4\`)\n` +
          `• \`despausar <telefone>\` (Ex: \`despausar 87988177877\`)\n` +
          `• \`limpar memoria <telefone>\`\n` +
          `• \`status <telefone>\`\n\n` +
          `**🤖 Parâmetros de IA & Agente:**\n` +
          `• \`modelo <nome>\` (Ex: \`modelo gpt-4o-mini\` ou \`modelo gemini-2.5-flash\`)\n` +
          `• \`temperatura <0.0 a 1.0>\` (Ex: \`temperatura 0.3\`)\n` +
          `• \`provedor <openai | gemini>\`\n` +
          `• \`empresa <Nome da Empresa>\`\n\n` +
          `**🕒 Horário Comercial:**\n` +
          `• \`ativar horario\` ou \`desativar horario\`\n` +
          `• \`fechar hoje [motivo]\`\n\n` +
          `**💬 Mensagens Diretas:**\n` +
          `• \`enviar <telefone>: <mensagem>\`\n\n` +
          `**📊 Diagnóstico Geral:**\n` +
          `• \`ativar transcricao\` / \`desativar transcricao\` (Liga/desliga a transcrição de áudios via IA)\n` +
          `• \`status\` (Exibe saúde do bot, sessões e expediente)`,
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 2. FERIADOS & INDISPONIBILIDADES
    // -----------------------------------------------------------------------

    // A. Adicionar feriado: feriado <data> <nome>
    const holidayAddMatch = cmd.match(/^(?:adicionar\s+feriado|novo\s+feriado|feriado)\s+([0-9\/\-]+)\s+(.+)$/i);
    if (holidayAddMatch) {
      const rawDate = holidayAddMatch[1].trim();
      const holidayName = holidayAddMatch[2].trim();

      const newHoliday: HolidayItem = {
        id: 'hol_' + Math.random().toString(36).substring(2, 9),
        name: holidayName,
        date: rawDate,
        type: rawDate.length === 5 ? 'national' : 'municipal',
        enabled: true,
        createdAt: new Date().toISOString()
      };

      // Adiciona no agente ou na config global
      const currentHolidays = Array.isArray(agent.businessHours?.holidays)
        ? [...agent.businessHours.holidays]
        : [];
      currentHolidays.push(newHoliday);

      agentManager.updateAgent(agent.id, {
        businessHours: {
          ...agent.businessHours,
          holidays: currentHolidays
        }
      });

      // Também salva na config global
      const cfg = loadBotConfig();
      saveBotConfig({
        businessHours: {
          ...cfg.businessHours,
          holidays: currentHolidays
        }
      });

      return {
        success: true,
        command: cmd,
        action: 'holiday_added',
        message: `🎉 Feriado/Indisponibilidade **"${holidayName}"** (${rawDate}) adicionado com sucesso para a empresa **${agent.companyName}**!`,
        data: newHoliday,
        timestamp
      };
    }

    // B. Carregar feriados nacionais padrão
    if (lower === 'carregar feriados nacionais' || lower === 'feriados nacionais') {
      const currentHolidays = Array.isArray(agent.businessHours?.holidays)
        ? [...agent.businessHours.holidays]
        : [];

      let addedCount = 0;
      for (const def of defaultBrazilianHolidays) {
        const exists = currentHolidays.some(h => h.date === def.date && h.name === def.name);
        if (!exists) {
          currentHolidays.push({
            id: 'hol_' + Math.random().toString(36).substring(2, 9),
            ...def,
            createdAt: new Date().toISOString()
          });
          addedCount++;
        }
      }

      agentManager.updateAgent(agent.id, {
        businessHours: {
          ...agent.businessHours,
          holidays: currentHolidays
        }
      });

      const cfg = loadBotConfig();
      saveBotConfig({
        businessHours: {
          ...cfg.businessHours,
          holidays: currentHolidays
        }
      });

      return {
        success: true,
        command: cmd,
        action: 'holidays_loaded',
        message: `🇧🇷 ${addedCount} feriado(s) nacional(is) do Brasil carregado(s) com sucesso para **${agent.companyName}**!`,
        data: { total: currentHolidays.length, added: addedCount },
        timestamp
      };
    }

    // C. Listar feriados
    if (lower === 'listar feriados' || lower === 'feriados' || lower === 'ver feriados') {
      const holidays = agent.businessHours?.holidays || [];
      if (holidays.length === 0) {
        return {
          success: true,
          command: cmd,
          action: 'holidays_list',
          message: `Nenhum feriado configurado no momento para **${agent.companyName}**. Digite \`carregar feriados nacionais\` ou adicione um com \`feriado <data> <nome>\`.`,
          data: [],
          timestamp
        };
      }

      let msg = `🎉 **Feriados e Indisponibilidades Cadastrados (${agent.companyName}):**\n\n`;
      holidays.forEach((h, idx) => {
        const badge = h.type === 'municipal' ? '🟡 Municipal' : '🟢 Nacional/Estadual';
        const status = h.enabled !== false ? '✅ Ativo' : '⚪ Desativado';
        msg += `**${idx + 1}.** \`${h.date}\` - **${h.name}** [${badge}] (${status})\n`;
      });

      return {
        success: true,
        command: cmd,
        action: 'holidays_list',
        message: msg,
        data: holidays,
        timestamp
      };
    }

    // D. Remover feriado: remover feriado <termo>
    const holidayRemoveMatch = cmd.match(/^(?:remover\s+feriado|excluir\s+feriado|deletar\s+feriado)\s+(.+)$/i);
    if (holidayRemoveMatch) {
      const term = holidayRemoveMatch[1].trim().toLowerCase();
      const currentHolidays = Array.isArray(agent.businessHours?.holidays)
        ? [...agent.businessHours.holidays]
        : [];

      const initialLen = currentHolidays.length;
      const filtered = currentHolidays.filter(h =>
        h.id !== term &&
        h.date.toLowerCase() !== term &&
        !h.name.toLowerCase().includes(term)
      );

      if (filtered.length === initialLen) {
        return {
          success: false,
          command: cmd,
          action: 'holiday_not_found',
          message: `Nenhum feriado correspondente a "${term}" foi localizado.`,
          timestamp
        };
      }

      agentManager.updateAgent(agent.id, {
        businessHours: {
          ...agent.businessHours,
          holidays: filtered
        }
      });

      const cfg = loadBotConfig();
      saveBotConfig({
        businessHours: {
          ...cfg.businessHours,
          holidays: filtered
        }
      });

      return {
        success: true,
        command: cmd,
        action: 'holiday_removed',
        message: `🗑️ Feriado removido com sucesso de **${agent.companyName}**. (${filtered.length} feriados restantes)`,
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 3. PAUSA / RETOMADA DE CONTATO NO WHATSAPP
    // -----------------------------------------------------------------------

    // A. Pausar contato: pausar <telefone> [horas]
    const pauseMatch = cmd.match(/^pausar(?:\s+contato)?\s+([0-9+\-()\s]+)(?:\s+(\d+(?:\.\d+)?))?$/i);
    if (pauseMatch) {
      const rawPhone = pauseMatch[1].trim();
      const hours = pauseMatch[2] ? parseFloat(pauseMatch[2]) : (agent.pauseDurationHours || 6);
      const minutes = Math.round(hours * 60);

      const targetChatId = formatToWhatsAppChatId(rawPhone);
      memoryStore.pauseChat(targetChatId, minutes, agent.id);
      const alt = getAlternateBrazilianChatId(targetChatId);
      if (alt) memoryStore.pauseChat(alt, minutes, agent.id);

      return {
        success: true,
        command: cmd,
        action: 'chat_paused',
        message: `⏸️ Bot **[${agent.name}]** pausado para o contato **${targetChatId}** por **${hours} hora(s)**. O atendente humano pode responder com tranquilidade.`,
        data: { chatId: targetChatId, hours, minutes },
        timestamp
      };
    }

    // B. Despausar contato: despausar <telefone> / retomar <telefone>
    const resumeMatch = cmd.match(/^(?:despausar|retomar|desbloquear|liberar)(?:\s+contato)?\s+([0-9+\-()\s]+)$/i);
    if (resumeMatch) {
      const rawPhone = resumeMatch[1].trim();
      const targetChatId = formatToWhatsAppChatId(rawPhone);

      memoryStore.resumeChat(targetChatId, agent.id);
      const alt = getAlternateBrazilianChatId(targetChatId);
      if (alt) memoryStore.resumeChat(alt, agent.id);

      return {
        success: true,
        command: cmd,
        action: 'chat_resumed',
        message: `▶️ Bot **[${agent.name}]** despausado e ativado novamente para o contato **${targetChatId}**. Respostas automáticas reativadas!`,
        data: { chatId: targetChatId },
        timestamp
      };
    }

    // C. Limpar memória do contato: limpar memoria <telefone>
    const clearMemoryMatch = cmd.match(/^(?:limpar\s+memoria|resetar\s+contato|esquecer)\s+([0-9+\-()\s]+)$/i);
    if (clearMemoryMatch) {
      const rawPhone = clearMemoryMatch[1].trim();
      const targetChatId = formatToWhatsAppChatId(rawPhone);

      memoryStore.clearHistory(targetChatId);
      memoryStore.resumeChat(targetChatId, agent.id);
      const alt = getAlternateBrazilianChatId(targetChatId);
      if (alt) {
        memoryStore.clearHistory(alt);
        memoryStore.resumeChat(alt, agent.id);
      }

      return {
        success: true,
        command: cmd,
        action: 'memory_cleared',
        message: `🧹 Memória e histórico de conversa do contato **${targetChatId}** foram completamente limpos no bot.`,
        data: { chatId: targetChatId },
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 4. CONFIGURAÇÃO DO AGENTE & MODELO DE IA
    // -----------------------------------------------------------------------

    // A. Mudar modelo: modelo <nome>
    const modelMatch = cmd.match(/^(?:mudar\s+modelo|trocar\s+modelo|modelo)\s+([a-zA-Z0-9.\-_]+)$/i);
    if (modelMatch) {
      const newModel = modelMatch[1].trim();
      const isGpt = newModel.startsWith('gpt');

      const updates: any = {};
      if (isGpt) {
        updates.llmProvider = 'openai';
        updates.openaiModel = newModel;
      } else {
        updates.llmProvider = 'gemini';
        updates.model = newModel;
      }

      agentManager.updateAgent(agent.id, updates);
      saveBotConfig(updates);

      return {
        success: true,
        command: cmd,
        action: 'model_updated',
        message: `🤖 Modelo de IA do agente **${agent.name}** alterado em tempo real para **${newModel}** (Provedor: ${updates.llmProvider}).`,
        data: { model: newModel, provider: updates.llmProvider },
        timestamp
      };
    }

    // B. Provedor: provedor <openai | gemini>
    const providerMatch = cmd.match(/^(?:mudar\s+provedor|provedor)\s+(openai|gemini)$/i);
    if (providerMatch) {
      const prov = providerMatch[1].toLowerCase() as 'openai' | 'gemini';
      agentManager.updateAgent(agent.id, { llmProvider: prov });
      saveBotConfig({ llmProvider: prov });

      return {
        success: true,
        command: cmd,
        action: 'provider_updated',
        message: `🔄 Provedor de IA alternado para **${prov.toUpperCase()}** no agente **${agent.name}**.`,
        data: { provider: prov },
        timestamp
      };
    }

    // C. Temperatura: temperatura <0.0 a 1.0>
    const tempMatch = cmd.match(/^temperatura\s+([0-1](?:\.\d+)?)$/i);
    if (tempMatch) {
      const temp = parseFloat(tempMatch[1]);
      agentManager.updateAgent(agent.id, { temperature: temp });
      saveBotConfig({ temperature: temp });

      return {
        success: true,
        command: cmd,
        action: 'temperature_updated',
        message: `🌡️ Temperatura do agente **${agent.name}** ajustada para **${temp}**.`,
        data: { temperature: temp },
        timestamp
      };
    }

    // D. Empresa: empresa <Nome>
    const companyMatch = cmd.match(/^(?:mudar\s+empresa|empresa)\s+(.+)$/i);
    if (companyMatch) {
      const newCompany = companyMatch[1].trim();
      agentManager.updateAgent(agent.id, { companyName: newCompany });
      saveBotConfig({ companyName: newCompany });

      return {
        success: true,
        command: cmd,
        action: 'company_updated',
        message: `🏢 Nome da empresa atualizado para **"${newCompany}"** no agente **${agent.name}**.`,
        data: { companyName: newCompany },
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 5. HORÁRIO COMERCIAL / EXPEDIENTE
    // -----------------------------------------------------------------------

    if (lower === 'ativar horario' || lower === 'ligar expediente' || lower === 'ativar expediente') {
      agentManager.updateAgent(agent.id, {
        businessHours: { ...agent.businessHours, enabled: true }
      });
      const cfg = loadBotConfig();
      saveBotConfig({
        businessHours: { ...cfg.businessHours, enabled: true }
      });

      return {
        success: true,
        command: cmd,
        action: 'business_hours_enabled',
        message: `🕒 Controle de Horário Comercial **ATIVADO** para **${agent.companyName}**. Clientes fora de horário receberão aviso de ausência.`,
        timestamp
      };
    }

    if (lower === 'desativar horario' || lower === 'desligar expediente' || lower === 'desativar expediente') {
      agentManager.updateAgent(agent.id, {
        businessHours: { ...agent.businessHours, enabled: false }
      });
      const cfg = loadBotConfig();
      saveBotConfig({
        businessHours: { ...cfg.businessHours, enabled: false }
      });

      return {
        success: true,
        command: cmd,
        action: 'business_hours_disabled',
        message: `🕒 Controle de Horário Comercial **DESATIVADO** para **${agent.companyName}**. O bot responderá 24 horas por dia.`,
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 6. ENVIAR MENSAGEM VIA WHATSAPP
    // -----------------------------------------------------------------------

    const sendMsgMatch = cmd.match(/^enviar\s+([0-9+\-()\s]+):\s*(.+)$/i);
    if (sendMsgMatch) {
      const rawPhone = sendMsgMatch[1].trim();
      const text = sendMsgMatch[2].trim();
      const targetChatId = formatToWhatsAppChatId(rawPhone);

      const session = (agent.wahaSession && agent.wahaSession !== '*') ? agent.wahaSession : 'default';
      const sendRes = await wahaClient.sendText(targetChatId, text, { session });

      return {
        success: true,
        command: cmd,
        action: 'message_sent',
        message: `📤 Mensagem enviada com sucesso para **${targetChatId}** via sessão WAHA "${session}"!\n\n💬 *Conteúdo:* "${text}"`,
        data: { messageId: sendRes?.id, to: targetChatId },
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 7. TRANSCRIÇÃO DE ÁUDIOS (VOZ / PTT)
    // -----------------------------------------------------------------------

    if (
      lower === 'ativar transcricao' ||
      lower === 'ligar transcricao' ||
      lower === 'ativar audio' ||
      lower === 'ligar audio' ||
      lower === 'transcricao on'
    ) {
      agentManager.updateAgent(agent.id, { enableAudioTranscription: true });
      saveBotConfig({ enableAudioTranscription: true });

      return {
        success: true,
        command: cmd,
        action: 'transcription_enabled',
        message: `🎙️ Transcrição automática de áudios **ATIVADA** com sucesso para o agente **${agent.name}** (${agent.companyName})! As mensagens de voz do WhatsApp serão transcritas via IA.`,
        data: { enableAudioTranscription: true },
        timestamp
      };
    }

    if (
      lower === 'desativar transcricao' ||
      lower === 'desligar transcricao' ||
      lower === 'desativar audio' ||
      lower === 'desligar audio' ||
      lower === 'transcricao off'
    ) {
      agentManager.updateAgent(agent.id, { enableAudioTranscription: false });
      saveBotConfig({ enableAudioTranscription: false });

      return {
        success: true,
        command: cmd,
        action: 'transcription_disabled',
        message: `🎙️ Transcrição automática de áudios **DESATIVADA** para o agente **${agent.name}** (${agent.companyName}).`,
        data: { enableAudioTranscription: false },
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 8. STATUS & DIAGNÓSTICO DO SISTEMA
    // -----------------------------------------------------------------------

    if (lower === 'status' || lower === 'info' || lower === 'diagnostico') {
      const bhStatus = checkBusinessHoursStatus(agent);
      const allExams = examService.listExams({ agentId: agent.id });
      const sentExams = allExams.filter(e => e.status === 'sent').length;
      const awaitingExams = allExams.filter(e => e.status === 'awaiting_cpf').length;
      const appointments = appointmentManager.listAppointments();

      const bhLabel = !bhStatus.isOpen
        ? `🔴 Fechado (${bhStatus.reason === 'holiday' ? `Feriado: ${bhStatus.holidayName}` : bhStatus.reason})`
        : `🟢 Aberto (${bhStatus.currentTime} - ${bhStatus.currentDayName})`;

      const audioLabel = agent.enableAudioTranscription ? '🎙️ Ativada (IA)' : '⚪ Desativada';

      return {
        success: true,
        command: cmd,
        action: 'status',
        message:
          `📊 **Status Operacional do BotZap**\n\n` +
          `• **Empresa Ativa:** ${agent.companyName} (${agent.name})\n` +
          `• **IA:** ${agent.llmProvider.toUpperCase()} (${agent.llmProvider === 'openai' ? agent.openaiModel : agent.model})\n` +
          `• **Transcrição de Áudio (Voz):** ${audioLabel}\n` +
          `• **Sessão WAHA:** \`${agent.wahaSession || 'default'}\`\n` +
          `• **Horário Comercial:** ${bhLabel}\n` +
          `• **Feriados Cadastrados:** ${agent.businessHours?.holidays?.length || 0}\n` +
          `• **Exames Entregues/Aguardando:** ${sentExams} entregues / ${awaitingExams} aguardando CPF\n` +
          `• **Total de Agendamentos:** ${appointments.length} agendamento(s) no sistema.`,
        data: { agent, bhStatus, sentExams, awaitingExams },
        timestamp
      };
    }

    // -----------------------------------------------------------------------
    // 8. PROCESSAMENTO EM LINGUAGEM NATURAL COM IA (FALLBACK INTELIGENTE)
    // -----------------------------------------------------------------------
    try {
      const systemPrompt =
        `Você é o Console de Operações Administrativas do BotZap. O administrador executou a seguinte solicitação: "${cmd}".\n` +
        `Empresa: ${agent.companyName}. Modelo atual: ${agent.model || agent.openaiModel}.\n` +
        `Se a solicitação for uma instrução para o bot, resuma como ela deve ser aplicada ou confirme a interpretação de forma executiva, concisa e profissional. Formate com emojis e negrito para WhatsApp.`;

      const aiReply = await llmProviderManager.generateReply(
        'admin_console',
        systemPrompt,
        contextUser.name || 'Admin',
        agent
      );

      return {
        success: true,
        command: cmd,
        action: 'ai_natural_language',
        message: `🤖 **Comando Interpretado pela IA:**\n\n${aiReply.text}`,
        timestamp
      };
    } catch (err: any) {
      return {
        success: false,
        command: cmd,
        action: 'unknown',
        message: `Comando não reconhecido: "${cmd}". Digite \`ajuda\` para listar os comandos suportados.`,
        timestamp
      };
    }
  }
}

export const commandExecutor = new CommandExecutor();
