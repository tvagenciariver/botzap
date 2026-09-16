import { bookingAgent } from '../src/orchestrator/agents/booking.js';
import { AgentContext } from '../src/orchestrator/agents/base.js';
import { agentManager } from '../src/config/agent-manager.js';
import { appointmentManager } from '../src/appointments/appointment-manager.js';
import { partnerManager } from '../src/appointments/partner-manager.js';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`❌ [FAIL] ${testName}`);
    failed++;
  }
}

async function runTests() {
  console.log('🧪 Iniciando testes do Fluxo Humanizado de Agendamento (v2.7.8)...\n');

  // ==========================================
  // PARTE 1: Testes unitários do parseSlotChoice
  // ==========================================
  console.log('--- TESTANDO parseSlotChoice (Eliminação de Conflito de Horas vs Índices) ---');
  const sampleSlots = [
    '08:30', // idx 0
    '09:00', // idx 1
    '09:30', // idx 2
    '10:00', // idx 3
    '10:30', // idx 4
    '11:00', // idx 5
    '14:00', // idx 6
    '14:30', // idx 7
    '15:00', // idx 8
    '15:30', // idx 9
  ];

  // 1. "às 9" deve ser 09:00 e JAMAIS o 9º slot (15:00)
  const slotAs9 = bookingAgent.parseSlotChoice('às 9', sampleSlots);
  assert(slotAs9 === '09:00', `parseSlotChoice("às 9") === "09:00" (retornou: ${slotAs9})`);

  // 2. "9" deve ser 09:00
  const slot9 = bookingAgent.parseSlotChoice('9', sampleSlots);
  assert(slot9 === '09:00', `parseSlotChoice("9") === "09:00" (retornou: ${slot9})`);

  // 3. "9h" deve ser 09:00
  const slot9h = bookingAgent.parseSlotChoice('9h', sampleSlots);
  assert(slot9h === '09:00', `parseSlotChoice("9h") === "09:00" (retornou: ${slot9h})`);

  // 4. "10" deve ser 10:00 e JAMAIS o 10º slot (15:30)
  const slot10 = bookingAgent.parseSlotChoice('10', sampleSlots);
  assert(slot10 === '10:00', `parseSlotChoice("10") === "10:00" (retornou: ${slot10})`);

  // 5. "10h" deve ser 10:00
  const slot10h = bookingAgent.parseSlotChoice('10h', sampleSlots);
  assert(slot10h === '10:00', `parseSlotChoice("10h") === "10:00" (retornou: ${slot10h})`);

  // 6. "10:30" deve ser 10:30
  const slot1030 = bookingAgent.parseSlotChoice('10:30', sampleSlots);
  assert(slot1030 === '10:30', `parseSlotChoice("10:30") === "10:30" (retornou: ${slot1030})`);

  // 7. "10h30" deve ser 10:30
  const slot10h30 = bookingAgent.parseSlotChoice('10h30', sampleSlots);
  assert(slot10h30 === '10:30', `parseSlotChoice("10h30") === "10:30" (retornou: ${slot10h30})`);

  // 8. "10 e meia" deve ser 10:30
  const slot10meia = bookingAgent.parseSlotChoice('10 e meia', sampleSlots);
  assert(slot10meia === '10:30', `parseSlotChoice("10 e meia") === "10:30" (retornou: ${slot10meia})`);

  // 9. "11" deve ser 11:00
  const slot11 = bookingAgent.parseSlotChoice('11', sampleSlots);
  assert(slot11 === '11:00', `parseSlotChoice("11") === "11:00" (retornou: ${slot11})`);

  // 10. "14" deve ser 14:00
  const slot14 = bookingAgent.parseSlotChoice('14', sampleSlots);
  assert(slot14 === '14:00', `parseSlotChoice("14") === "14:00" (retornou: ${slot14})`);

  // 11. "2 da tarde" deve ser 14:00
  const slot2tarde = bookingAgent.parseSlotChoice('2 da tarde', sampleSlots);
  assert(slot2tarde === '14:00', `parseSlotChoice("2 da tarde") === "14:00" (retornou: ${slot2tarde})`);

  // 12. "mais cedo" / "primeiro" deve ser 08:30
  const slotCedo = bookingAgent.parseSlotChoice('mais cedo', sampleSlots);
  assert(slotCedo === '08:30', `parseSlotChoice("mais cedo") === "08:30" (retornou: ${slotCedo})`);

  // 13. "último" deve ser 15:30
  const slotUltimo = bookingAgent.parseSlotChoice('o último horário', sampleSlots);
  assert(slotUltimo === '15:30', `parseSlotChoice("o último horário") === "15:30" (retornou: ${slotUltimo})`);

  // 14. "opcao 1" deve selecionar o índice 1 (08:30)
  const slotOpcao1 = bookingAgent.parseSlotChoice('opcao 1', sampleSlots);
  assert(slotOpcao1 === '08:30', `parseSlotChoice("opcao 1") === "08:30" (retornou: ${slotOpcao1})`);

  // ==========================================
  // PARTE 2: Testes unitários do parseDateChoice
  // ==========================================
  console.log('\n--- TESTANDO parseDateChoice (Reconhecimento Natural de Datas) ---');
  const sampleDates = [
    { label: 'Hoje (16/09/2026)', date: '2026-09-16' },
    { label: 'Amanhã (17/09/2026)', date: '2026-09-17' },
    { label: 'Sexta-feira (18/09/2026)', date: '2026-09-18' },
    { label: 'Segunda-feira (21/09/2026)', date: '2026-09-21' },
  ];

  // 1. "hoje"
  const dateHoje = bookingAgent.parseDateChoice('hoje', sampleDates);
  assert(dateHoje === '2026-09-16', `parseDateChoice("hoje") === "2026-09-16" (retornou: ${dateHoje})`);

  // 2. "amanhã"
  const dateAmanha = bookingAgent.parseDateChoice('amanhã', sampleDates);
  assert(dateAmanha === '2026-09-17', `parseDateChoice("amanhã") === "2026-09-17" (retornou: ${dateAmanha})`);

  // 3. "amanha" (sem acento)
  const dateAmanhaSemAcento = bookingAgent.parseDateChoice('amanha', sampleDates);
  assert(dateAmanhaSemAcento === '2026-09-17', `parseDateChoice("amanha") === "2026-09-17" (retornou: ${dateAmanhaSemAcento})`);

  // 4. "sexta"
  const dateSexta = bookingAgent.parseDateChoice('sexta', sampleDates);
  assert(dateSexta === '2026-09-18', `parseDateChoice("sexta") === "2026-09-18" (retornou: ${dateSexta})`);

  // 5. "segunda"
  const dateSegunda = bookingAgent.parseDateChoice('na segunda', sampleDates);
  assert(dateSegunda === '2026-09-21', `parseDateChoice("na segunda") === "2026-09-21" (retornou: ${dateSegunda})`);

  // 6. "dia 18"
  const dateDia18 = bookingAgent.parseDateChoice('dia 18', sampleDates);
  assert(dateDia18 === '2026-09-18', `parseDateChoice("dia 18") === "2026-09-18" (retornou: ${dateDia18})`);

  // 7. "18/09"
  const date1809 = bookingAgent.parseDateChoice('18/09', sampleDates);
  assert(date1809 === '2026-09-18', `parseDateChoice("18/09") === "2026-09-18" (retornou: ${date1809})`);

  // 8. "1" (fallback índice)
  const dateIdx1 = bookingAgent.parseDateChoice('1', sampleDates);
  assert(dateIdx1 === '2026-09-16', `parseDateChoice("1") === "2026-09-16" (retornou: ${dateIdx1})`);

  // ==========================================
  // PARTE 3: Testando Etapa de Convênio / Particular na Unimagem (tem parceiros)
  // ==========================================
  console.log('\n--- TESTANDO SELEÇÃO NATURAL DE CONVÊNIO / PARTICULAR (Empresa com parceiros) ---');
  const unimagemAgent = agentManager.getAgent('default');
  if (unimagemAgent) {
    const unimagemChatId = '5587988887777@c.us';
    bookingAgent.clearAllSessions();

    const uCtx1: AgentContext = {
      chatId: unimagemChatId,
      userMessage: 'Olá, gostaria de agendar um exame na Unimagem',
      agent: unimagemAgent,
      session: 'default'
    };
    const uRes1 = await bookingAgent.execute(uCtx1);
    assert(uRes1.handled, 'Unimagem Passo 1: bookingAgent respondeu');
    assert(
      !uRes1.replyText.includes('Digite 1 para Particular ou 2'),
      'Unimagem Passo 1: NÃO exige número "Digite 1 para Particular ou 2"'
    );
    assert(
      uRes1.replyText.includes('Particular') && uRes1.replyText.includes('Convênio'),
      'Unimagem Passo 1: Pergunta humanizada "Particular ou Convênio"'
    );
    console.log('🤖 Unimagem Resposta 1:\n' + uRes1.replyText + '\n');

    // Responde dizendo "tenho convênio"
    const uCtx2: AgentContext = {
      ...uCtx1,
      userMessage: 'tenho convênio'
    };
    const uRes2 = await bookingAgent.execute(uCtx2);
    assert(uRes2.handled, 'Unimagem Passo 2: aceitou "tenho convênio" de forma natural');
    assert(
      uRes2.replyText.includes('São Lucas') || uRes2.replyText.includes('Bem Estar'),
      'Unimagem Passo 2: Apresentou a lista de convênios/parceiros aceitos com bullets'
    );
    console.log('🤖 Unimagem Resposta 2:\n' + uRes2.replyText + '\n');

    // Responde escolhendo pelo nome "São Lucas"
    const uCtx3: AgentContext = {
      ...uCtx1,
      userMessage: 'São Lucas'
    };
    const uRes3 = await bookingAgent.execute(uCtx3);
    assert(uRes3.handled, 'Unimagem Passo 3: vinculou convênio digitado pelo nome "São Lucas"');
    assert(
      uRes3.replyText.includes('São Lucas') && uRes3.replyText.includes('vinculado com sucesso'),
      'Unimagem Passo 3: Confirmou vinculação do convênio com sucesso!'
    );
    console.log('🤖 Unimagem Resposta 3:\n' + uRes3.replyText + '\n');
  }

  // ==========================================
  // PARTE 4: Simulação de Fluxo Completo na Vale Studio (Dra. Valéria)
  // ==========================================
  console.log('\n--- SIMULANDO FLUXO CONVERSACIONAL COMPLETO VIA WHATSAPP (Vale Studio) ---');

  const valeAgent = agentManager.listAgents().find(a => a.id === 'agent-vale-studio' || a.companyName.toLowerCase().includes('vale'));
  if (!valeAgent) {
    console.error('❌ Agente Vale Studio não encontrado!');
    process.exit(1);
  }

  const testChatId = '5511999990001@c.us';
  bookingAgent.clearAllSessions();

  // 1. Usuário envia "Olá, quero agendar consulta"
  const ctx1: AgentContext = {
    chatId: testChatId,
    userMessage: 'Olá, quero agendar consulta',
    contactName: 'Carlos Silva',
    agent: valeAgent,
    session: valeAgent.wahaSession || 'default'
  };

  const res1 = await bookingAgent.execute(ctx1);
  assert(res1.handled, 'Vale Studio Passo 1: bookingAgent tratou a mensagem inicial de agendar');
  assert(
    res1.replyText.includes('Qual dia você prefere') && res1.replyText.includes('Dra. Valéria'),
    'Vale Studio Passo 1: Apresentou datas com Dra. Valéria (empresa sem parceiros avança direto para datas)'
  );
  assert(
    !res1.replyText.includes('Digite o número do dia escolhido'),
    'Vale Studio Passo 1: NÃO contém mensagem robótica "Digite o número do dia escolhido"'
  );
  console.log('🤖 Resposta 1:\n' + res1.replyText + '\n');

  // 2. Usuário escolhe a data de forma natural: "amanhã"
  const ctx2: AgentContext = {
    ...ctx1,
    userMessage: 'amanhã'
  };
  const res2 = await bookingAgent.execute(ctx2);
  assert(res2.handled, 'Vale Studio Passo 2: bookingAgent aceitou "amanhã"');
  assert(
    res2.replyText.includes('Horários disponíveis') && res2.replyText.includes('•'),
    'Vale Studio Passo 2: Exibiu horários formatados em linha com marcadores'
  );
  assert(
    !res2.replyText.includes('Digite o número do horário desejado'),
    'Vale Studio Passo 2: NÃO contém texto robótico "Digite o número do horário desejado"'
  );
  console.log('🤖 Resposta 2:\n' + res2.replyText + '\n');

  // 3. Usuário escolhe o horário dizendo: "às 9" ou "10"
  let timeChoice = 'mais cedo';
  if (res2.replyText.includes('09:00')) timeChoice = 'às 9';
  else if (res2.replyText.includes('10:00')) timeChoice = '10';
  else if (res2.replyText.includes('11:00')) timeChoice = '11';

  const ctx3: AgentContext = {
    ...ctx1,
    userMessage: timeChoice
  };
  const res3 = await bookingAgent.execute(ctx3);
  assert(res3.handled, `Vale Studio Passo 3: bookingAgent aceitou escolha de horário "${timeChoice}"`);
  assert(
    res3.replyText.includes('Nome Completo do Paciente'),
    'Vale Studio Passo 3: Avançou para solicitação do nome do paciente'
  );
  console.log('🤖 Resposta 3:\n' + res3.replyText + '\n');

  // 4. Usuário informa o nome completo: "Carlos Eduardo Silva"
  const ctx4: AgentContext = {
    ...ctx1,
    userMessage: 'Carlos Eduardo Silva'
  };
  const res4 = await bookingAgent.execute(ctx4);
  assert(res4.handled, 'Vale Studio Passo 4: bookingAgent aceitou o nome completo');
  assert(
    res4.replyText.includes('WhatsApp com DDD'),
    'Vale Studio Passo 4: Solicitou o WhatsApp de confirmação'
  );
  console.log('🤖 Resposta 4:\n' + res4.replyText + '\n');

  // 5. Usuário informa o WhatsApp: "11999990001"
  const ctx5: AgentContext = {
    ...ctx1,
    userMessage: '11999990001'
  };
  const res5 = await bookingAgent.execute(ctx5);
  assert(res5.handled, 'Vale Studio Passo 5: bookingAgent finalizou o agendamento');
  assert(
    res5.replyText.includes('AGENDAMENTO CONFIRMADO COM SUCESSO'),
    'Vale Studio Passo 5: Mensagem de confirmação gerada com sucesso!'
  );
  console.log('🤖 Resposta 5:\n' + res5.replyText + '\n');

  // Limpeza de agendamento de teste criado
  const testApts = appointmentManager.listAppointments().filter(a => a.clientPhone === '5511999990001' || a.clientPhone === '11999990001');
  testApts.forEach(a => {
    appointmentManager.deleteAppointment(a.id);
  });
  bookingAgent.clearAllSessions();

  console.log(`\n==========================================`);
  console.log(`Resultados dos Testes: ${passed} passaram, ${failed} falharam.`);
  console.log(`==========================================`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Erro fatal durante a execução dos testes:', err);
  process.exit(1);
});
