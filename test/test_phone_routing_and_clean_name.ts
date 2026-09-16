import { agentManager } from '../src/config/agent-manager.js';
import { BookingAgent } from '../src/orchestrator/agents/booking.js';
import { appointmentManager } from '../src/appointments/appointment-manager.js';
import { memoryStore } from '../src/gemini/memory.js';
import { wahaClient } from '../src/waha/client.js';

async function runTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 TESTES DE ROTEAMENTO POR NÚMERO, NOME LIMPO E RESET MEMÓRIA ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  const bookingAgent = new BookingAgent();

  // Garante que o agente Vale Studio possui phoneNumber para os testes
  const valeAgent = agentManager.getAgent('agent_vale_studio');
  if (!valeAgent) throw new Error('Agente agent_vale_studio não encontrado');

  agentManager.updateAgent('agent_vale_studio', {
    phoneNumber: '5587999991111'
  });

  const updatedVale = agentManager.getAgent('agent_vale_studio')!;
  console.log(`✅ Vale Studio configurado com phoneNumber: ${updatedVale.phoneNumber}`);

  // Teste 1: Roteamento estrito por recipientPhone (payload.to)
  console.log('\n--- TESTE 1: Mensagem enviada para o WhatsApp da Vale Studio ---');
  const resolution1 = agentManager.resolveAgentForMessage({
    sessionName: 'default', // Mesmo que a sessão venha como default
    messageText: 'Olá, gostaria de agendar um exame',
    recipientPhone: '5587999991111@c.us'
  });

  console.log(`Destino: 5587999991111@c.us -> Agente Resolvido: ${resolution1.agent.companyName} (${resolution1.agent.id}) [${resolution1.reason}]`);
  if (resolution1.agent.id !== 'agent_vale_studio') {
    throw new Error(`FALHA: Esperava agent_vale_studio por recipientPhone, mas obteve ${resolution1.agent.id}`);
  }
  console.log('✅ Teste 1 passou: Roteamento para Vale Studio 100% garantido por número de destino!');

  // Teste 2: Intenção de exame reconhecida pelo BookingAgent
  console.log('\n--- TESTE 2: BookingAgent.canHandle com "marcar exame" ---');
  const canHandleExam = await bookingAgent.canHandle({
    chatId: '5587988887777@c.us',
    userMessage: 'Gostaria de marcar exame',
    agent: updatedVale,
    session: 'vale_studio'
  });
  console.log(`canHandle("Gostaria de marcar exame") no Vale Studio: ${canHandleExam}`);
  if (!canHandleExam) {
    throw new Error('FALHA: canHandle deveria ser true para "marcar exame"');
  }
  console.log('✅ Teste 2 passou: Palavras de exame reconhecidas com sucesso!');

  // Teste 3: Agendamento direto na Vale Studio não pergunta empresa e NUNCA oferece Dr. Carlos
  console.log('\n--- TESTE 3: Início de Agendamento na Vale Studio (Dra. Valéria) ---');
  const testChat = '5587988887777@c.us';
  BookingAgent.clearAllSessions();

  const startRes = await bookingAgent.execute({
    chatId: testChat,
    userMessage: 'quero agendar exame',
    agent: updatedVale,
    session: 'vale_studio',
    contactName: 'Joana Prado' // Simula o perfil do WhatsApp
  });

  console.log(`Resposta:\n"${startRes.replyText}"\n`);
  if (startRes.replyText.toLowerCase().includes('carlos medeiros') || startRes.replyText.toLowerCase().includes('carlos silva')) {
    throw new Error('FALHA GRAVE: Dr. Carlos apareceu no atendimento da Vale Studio!');
  }
  if (!startRes.replyText.includes('Valéria') || !startRes.replyText.includes('Vale Studio')) {
    throw new Error('FALHA: Deveria oferecer Dra. Valéria e mencionar Vale Studio!');
  }
  console.log('✅ Teste 3 passou: Apenas Dra. Valéria da Vale Studio foi oferecida!');

  // Teste 4: Escolha de Data e Horário não sugere nome "Joana Prado"
  console.log('\n--- TESTE 4: Seleção de Data e Horário sem sugestão de nome do perfil ---');
  // Escolhe data 1
  const dateRes = await bookingAgent.execute({
    chatId: testChat,
    userMessage: '1',
    agent: updatedVale,
    session: 'vale_studio',
    contactName: 'Joana Prado'
  });
  console.log(`Resposta Data:\n"${dateRes.replyText}"\n`);

  // Escolhe horário 1
  const slotRes = await bookingAgent.execute({
    chatId: testChat,
    userMessage: '1',
    agent: updatedVale,
    session: 'vale_studio',
    contactName: 'Joana Prado'
  });
  console.log(`Resposta Horário (Solicitação de Nome):\n"${slotRes.replyText}"\n`);

  if (slotRes.replyText.includes('Joana Prado') || slotRes.replyText.includes('responda *1* para confirmar no nome')) {
    throw new Error('FALHA: O bot ainda está sugerindo o nome do perfil Joana Prado!');
  }
  if (!slotRes.replyText.includes('Nome Completo do Paciente')) {
    throw new Error('FALHA: Não solicitou o Nome Completo do Paciente');
  }
  console.log('✅ Teste 4 passou: Sugestão de Joana Prado foi eliminada!');

  // Teste 5: Rejeição de dígito "1" ou "sim" como nome de paciente
  console.log('\n--- TESTE 5: Rejeição de "1" ou "sim" como nome ---');
  const rejectRes = await bookingAgent.execute({
    chatId: testChat,
    userMessage: '1',
    agent: updatedVale,
    session: 'vale_studio'
  });
  console.log(`Resposta para "1":\n"${rejectRes.replyText}"\n`);
  if (!rejectRes.replyText.includes('Nome Completo do Paciente')) {
    throw new Error('FALHA: Deveria ter insistido no Nome Completo do Paciente ao receber "1"');
  }
  console.log('✅ Teste 5 passou: Entrada "1" rejeitada com sucesso!');

  // Teste 6: Fornecer nome real e telefone conclui o agendamento sob Vale Studio
  console.log('\n--- TESTE 6: Cadastro de Nome Real e Conclusão sob Vale Studio ---');
  const nameRes = await bookingAgent.execute({
    chatId: testChat,
    userMessage: 'Eugenio Miranda',
    agent: updatedVale,
    session: 'vale_studio'
  });
  console.log(`Resposta Nome:\n"${nameRes.replyText}"\n`);

  const phoneRes = await bookingAgent.execute({
    chatId: testChat,
    userMessage: '87988887777',
    agent: updatedVale,
    session: 'vale_studio'
  });
  console.log(`Resposta Telefone (Confirmação Final):\n"${phoneRes.replyText}"\n`);
  if (!phoneRes.replyText.toUpperCase().includes('AGENDAMENTO CONFIRMADO') || !phoneRes.replyText.includes('Eugenio Miranda')) {
    throw new Error('FALHA: Agendamento não foi confirmado no nome de Eugenio Miranda!');
  }

  // Verifica se o agendamento foi salvo sob agent_vale_studio no appointmentManager
  const apts = appointmentManager.listAppointments('agent_vale_studio');
  const foundApt = apts.find(a => a.clientName === 'Eugenio Miranda');
  if (!foundApt) {
    throw new Error('FALHA: Agendamento não foi encontrado na agenda da Vale Studio!');
  }
  console.log(`✅ Teste 6 passou: Agendamento ID ${foundApt.id} registrado com sucesso na Vale Studio!`);

  // Limpa o agendamento de teste
  appointmentManager.cancelAppointment(foundApt.id, false);

  // Teste 7: Limpeza global de memória
  console.log('\n--- TESTE 7: Limpeza de Memória ---');
  memoryStore.clearAll();
  BookingAgent.clearAllSessions();
  const activeChats = memoryStore.listActiveChats();
  if (activeChats.length !== 0) {
    throw new Error(`FALHA: Esperava 0 chats ativos após clearAll, obteve ${activeChats.length}`);
  }
  console.log('✅ Teste 7 passou: Memória limpa com sucesso!');

  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('🎉 TODOS OS TESTES PASSARAM COM SUCESSO! 100% CONFORME REGRAS! ');
  console.log('═══════════════════════════════════════════════════════════════\n');
}

runTests().catch(err => {
  console.error('\n❌ ERRO NO TESTE:', err);
  process.exit(1);
});
