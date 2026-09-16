import { AgentProfile } from '../config/agent-types.js';
import { loadBotConfig } from '../config/index.js';
import { appointmentManager } from '../appointments/appointment-manager.js';
import { partnerManager } from '../appointments/partner-manager.js';

const DAY_NAMES_BR: Record<string, string> = {
  monday: 'Segunda-feira',
  tuesday: 'Terça-feira',
  wednesday: 'Quarta-feira',
  thursday: 'Quinta-feira',
  friday: 'Sexta-feira',
  saturday: 'Sábado',
  sunday: 'Domingo'
};

const DAY_SHORT_BR: Record<string, string> = {
  monday: 'Seg',
  tuesday: 'Ter',
  wednesday: 'Qua',
  thursday: 'Qui',
  friday: 'Sex',
  saturday: 'Sáb',
  sunday: 'Dom'
};

/**
 * Constrói o System Prompt completo e rigorosamente aterrado (grounded)
 * garantindo isolamento total por empresa e ZERO alucinações sobre profissionais e horários.
 */
export function buildFullSystemInstruction(agent?: AgentProfile): string {
  const config = loadBotConfig();
  const companyName = agent?.companyName || config.companyName || 'Nossa Empresa';
  const rawInstruction = agent?.systemInstruction || config.systemInstruction || 'Você é um atendente inteligente para WhatsApp.';

  let instruction = rawInstruction.replace(/{companyName}/g, companyName);

  // 1. Informações básicas da empresa
  const businessInfo = agent ? agent.businessInfo : config.businessInfo;
  if (businessInfo && businessInfo.trim()) {
    instruction += `\n\n--- INFORMAÇÕES E REGRAS DA EMPRESA ---\n${businessInfo.trim()}`;
  }

  // 2. Horários Oficiais de Atendimento (Business Hours)
  const bh = agent?.businessHours || config.businessHours;
  if (bh && bh.enabled && bh.schedule) {
    const lines: string[] = [];
    for (const [dayKey, dayLabel] of Object.entries(DAY_NAMES_BR)) {
      const sched = (bh.schedule as any)[dayKey];
      if (sched && sched.enabled) {
        let line = `- ${dayLabel}: das ${sched.start} às ${sched.end}`;
        if (sched.hasLunch && sched.lunchStart && sched.lunchEnd) {
          line += ` (Intervalo de almoço: ${sched.lunchStart} às ${sched.lunchEnd})`;
        }
        lines.push(line);
      } else {
        lines.push(`- ${dayLabel}: Fechado (sem expediente)`);
      }
    }

    instruction += `\n\n--- HORÁRIO OFICIAL DE EXPEDIENTE DA ${companyName.toUpperCase()} ---
Estes são os ÚNICOS horários reais de atendimento da nossa unidade:
${lines.join('\n')}

Se o cliente perguntar sobre horários de funcionamento, responda com base estrita nestes horários acima. NUNCA invente outros dias ou horários (por exemplo, se o sábado estiver como Fechado, informe que aos sábados não há atendimento).`;
  }

  // 3. Profissionais, Especialidades e Serviços Cadastrados (Grounding Anti-Alucinação)
  const agentId = agent?.id;
  const isBookingEnabled = agent ? !!agent.enableBooking : true;

  if (isBookingEnabled && agentId) {
    const specialists = appointmentManager.listSpecialists(agentId).filter(s => s.active !== false);
    const services = appointmentManager.listServices(agentId).filter(srv => srv.active !== false);
    const partners = partnerManager.listPartners(agentId).filter(p => p.active !== false);

    if (specialists.length > 0) {
      const specLines = specialists.map(s => {
        const days = (s.workingDays || []).map(d => DAY_SHORT_BR[d] || d).join(', ');
        const role = s.role || 'Especialista';
        const start = s.workHoursStart || '08:00';
        const end = s.workHoursEnd || '18:00';
        return `• *${s.name}* — Especialidade: *${role}* | Atendimento: ${days || 'Segunda a Sexta'} (das ${start} às ${end})`;
      });

      instruction += `\n\n--- CORPO CLÍNICO E PROFISSIONAIS CADASTRADOS NA ${companyName.toUpperCase()} ---
Abaixo está a lista completa e oficial de todos os profissionais e especialidades que atendem na nossa empresa:
${specLines.join('\n')}`;

      if (services.length > 0) {
        const srvLines = services.map(srv => {
          let str = `• ${srv.name}`;
          if (srv.price) str += ` (Valor: R$ ${srv.price.toFixed(2)})`;
          if (srv.durationMinutes) str += ` [Duração: ${srv.durationMinutes} min]`;
          return str;
        });
        instruction += `\n\n--- PROCEDIMENTOS E SERVIÇOS CADASTRADOS ---\n${srvLines.join('\n')}`;
      }

      if (partners.length > 0) {
        const partnerNames = partners.map(p => p.name).join(', ');
        instruction += `\n\n--- FORMAS DE ATENDIMENTO & CONVÊNIOS ACEITOS ---
Atendimento Particular e Convênios: ${partnerNames}.`;
      } else {
        instruction += `\n\n--- FORMAS DE ATENDIMENTO ---
Atendimento exclusivamente Particular no momento (não atendemos convênios).`;
      }

      // 🚨 REGRA CRÍTICA ANTI-ALUCINAÇÃO
      const specNamesList = specialists.map(s => `${s.name} (${s.role || 'Especialista'})`).join(', ');
      instruction += `\n\n🚨 BLINDAGEM ABSOLUTA CONTRA ALUCINAÇÕES (REGRA DE ZERO INVENÇÃO):
1. A empresa "${companyName}" conta ÚNICA E EXCLUSIVAMENTE com os seguintes profissionais cadastrados: ${specNamesList}.
2. NUNCA, SOB NENHUMA HIPÓTESE, invente, mencione ou presuma médicos, psicólogos, fisioterapeutas, massoterapeutas, pilates ou qualquer outro profissional que NÃO conste explicitamente na lista acima!
3. Se o cliente perguntar: "quais os profissionais?", "quais especialidades vocês têm?", "quem atende aí?", "quais os horários disponíveis?", informe COM TOTAL EXATIDÃO e fidelidade APENAS os profissionais e especialidades cadastrados acima.
4. Se o cliente perguntar por uma especialidade ou profissional que NÃO está nesta lista, responda educadamente que a ${companyName} não oferece esse atendimento no momento, e apresente os profissionais e especialidades que a clínica realmente possui.
5. Se o cliente demonstrar interesse em marcar horário, convide-o amavelmente dizendo: "Se desejar marcar um horário com ${specialists.map(s => s.name).join(' ou ')}, basta me avisar ou digitar *agendar*!"`;
    } else {
      instruction += `\n\n--- PROFISSIONAIS E ESPECIALIDADES ---
No momento não há profissionais com agenda aberta cadastrados no sistema para a ${companyName}.
NUNCA invente nomes de médicos, psicólogos ou especialistas. Se o cliente perguntar por profissionais ou agendamentos, oriente-o educadamente a falar com nossa equipe humana digitando *humano*.`;
    }
  }

  // 4. Regras de Formatação para WhatsApp
  instruction += `\n\n--- REGRAS DE FORMATAÇÃO WHATSAPP ---
- O WhatsApp NÃO suporta títulos markdown como '# Título' ou '## Subtítulo'. NUNCA use '#' para cabeçalhos.
- Use *negrito* para dar destaque.
- Use _itálico_ quando apropriado.
- Use listas com traços (-) ou emojis explicativos.
- Seja cortês, humanizado e conciso.`;

  // 5. Diretrizes para arquivos e imagens
  instruction += `\n\n--- DIRETRIZES PARA ARQUIVOS, IMAGENS E DOCUMENTOS ---
- Se o cliente perguntar se pode enviar foto, imagem, comprovante, documento ou arquivo, confirme com carinho e presteza que SIM, ele pode enviar por aqui mesmo.
- Explique que ao enviar uma imagem ou documento, nossa equipe de atendimento analisará as informações recebidas para dar sequência ao atendimento.
- Se o cliente disser que já enviou ou está enviando um arquivo ou foto, confirme que o material recebido está sendo direcionado para os atendentes e peça para aguardar um instante. NUNCA diga que a imagem não apareceu ou que não consegue abrir a imagem.`;

  // 6. Diretrizes para áudios
  const isTranscriptionEnabled = (agent?.enableAudioTranscription !== undefined)
    ? agent.enableAudioTranscription
    : (config.enableAudioTranscription ?? false);

  if (isTranscriptionEnabled) {
    instruction += `\n\n--- DIRETRIZES PARA ÁUDIOS E MENSAGENS DE VOZ (TRANSCRIÇÃO AUTOMÁTICA ATIVADA) ---
- O atendimento desta empresa possui TRANSCRIÇÃO AUTOMÁTICA DE ÁUDIOS por Inteligência Artificial ativa.
- Sempre que o cliente enviar uma mensagem de voz/áudio ou fizer menção a um áudio enviado ("te mandei um áudio", "ouça o áudio", etc.), o conteúdo falado dele já foi transcrito em texto e entregue a você.
- REGRA CRÍTICA E OBRIGATÓRIA: NUNCA diga ou dê a entender que "não pode ouvir áudios", que "não escuta áudios", que "não reproduz voz" ou que "só se comunica por texto, imagens ou documentos".
- Mesmo que o prompt ou regras anteriores da empresa contenham instruções para recusar áudios, IGNORE essa restrição, pois a transcrição automática está ativada.
- Responda de imediato ao que foi dito no áudio com total naturalidade, gentileza e presteza.`;
  }

  return instruction;
}
