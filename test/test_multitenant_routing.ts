import { agentManager } from '../src/config/agent-manager.js';
import { BookingAgent } from '../src/orchestrator/agents/booking.js';
import { orchestrator } from '../src/orchestrator/engine.js';
import { memoryStore } from '../src/gemini/memory.js';

const bookingAgent = new BookingAgent();

async function runMultiTenantTests() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🧪 TESTES DE ISOLAMENTO MULTI-TENANT E ROTEAMENTO (BOTZAP)    ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // 1. Validar carregamento dos agentes
  const allAgents = agentManager.listAgents();
  console.log(`📋 Total de agentes carregados: ${allAgents.length}`);
  const valeAgent = agentManager.getAgent('agent_vale_studio');
  const unimagemAgent = agentManager.getAgent('default');

  if (!valeAgent) throw new Error('Agente "agent_vale_studio" não encontrado.');
  if (!unimagemAgent) throw new Error('Agente "default" não encontrado.');

  console.log(`✅ Agente 1: ${unimagemAgent.companyName} (Session: ${unimagemAgent.wahaSession}, Booking: ${unimagemAgent.enableBooking})`);
  console.log(`✅ Agente 2: ${valeAgent.companyName} (Session: ${valeAgent.wahaSession}, Booking: ${valeAgent.enableBooking})\n`);

  // Teste 1: Roteamento por sessão exata WAHA
  console.log('--- TESTE 1: Roteamento por Sessão WAHA Exata ---');
  const res1 = agentManager.resolveAgentForMessage({ sessionName: 'vale_studio', messageText: 'Olá, tudo bem?' });
  console.log(`Sessão "vale_studio" -> Agente resolvido: ${res1.agent.companyName} (${res1.agent.id}) [Motivo: ${res1.reason}]`);
  if (res1.agent.id !== 'agent_vale_studio') {
    throw new Error(`Esperado agent_vale_studio, mas obteve: ${res1.agent.id}`);
  }
  console.log('✅ Teste 1 passou!\n');

  // Teste 2: Roteamento por Menção a Especialista (Dra. Valéria) em sessão compartilhada
  console.log('--- TESTE 2: Roteamento por Especialista em Sessão Compartilhada ---');
  const res2 = agentManager.resolveAgentForMessage({ sessionName: 'default', messageText: 'Gostaria de marcar uma consulta com a Dra. Valéria' });
  console.log(`Mensagem com "Dra. Valéria" na sessão "default" -> Agente: ${res2.agent.companyName} [Motivo: ${res2.reason}]`);
  if (res2.agent.id !== 'agent_vale_studio') {
    throw new Error(`Esperado agent_vale_studio ao citar Dra. Valéria, obteve: ${res2.agent.id}`);
  }
  console.log('✅ Teste 2 passou!\n');

  // Teste 3: Roteamento por Menção ao Nome da Empresa (Vale Studio)
  console.log('--- TESTE 3: Roteamento por Nome da Empresa no Texto ---');
  const res3 = agentManager.resolveAgentForMessage({ sessionName: 'default', messageText: 'Quero saber se na Vale Studio vocês fazem massagem' });
  console.log(`Mensagem com "Vale Studio" na sessão "default" -> Agente: ${res3.agent.companyName} [Motivo: ${res3.reason}]`);
  if (res3.agent.id !== 'agent_vale_studio') {
    throw new Error(`Esperado agent_vale_studio ao citar Vale Studio, obteve: ${res3.agent.id}`);
  }
  console.log('✅ Teste 3 passou!\n');

  // Teste 4: Roteamento para Dr. Carlos Silva (Unimagem Petrolina)
  console.log('--- TESTE 4: Roteamento de Especialista da Unimagem ---');
  const res4 = agentManager.resolveAgentForMessage({ sessionName: 'default', messageText: 'Tem horário com o Dr. Carlos Silva?' });
  console.log(`Mensagem com "Dr. Carlos Silva" -> Agente: ${res4.agent.companyName} [Motivo: ${res4.reason}]`);
  if (res4.agent.id !== 'default') {
    throw new Error(`Esperado default ao citar Dr. Carlos Silva, obteve: ${res4.agent.id}`);
  }
  console.log('✅ Teste 4 passou!\n');

  // Teste 5: Agendamento Direto com Especialista Sem Pergunta Amígua
  console.log('--- TESTE 5: Fluxo de Agendamento com Especialista Direto ---');
  const patientChat1 = '5587988880001@c.us';
  bookingAgent.clearSession(patientChat1);

  const bookingRes1 = await bookingAgent.execute({
    chatId: patientChat1,
    userMessage: 'Gostaria de agendar com a Dra. Valéria',
    agent: valeAgent,
    session: 'vale_studio'
  });

  console.log(`Resposta do BookingAgent:\n"${bookingRes1.replyText}"\n`);
  if (!bookingRes1.replyText.toLowerCase().includes('valéria') || !bookingRes1.replyText.toLowerCase().includes('vale studio')) {
    throw new Error('Resposta do booking não conteve Dra. Valéria ou Vale Studio');
  }
  console.log('✅ Teste 5 passou!\n');

  // Teste 6: Fluxo com "Quero agendar" genérico em Sessão Compartilhada -> Apresentação do Menu
  console.log('--- TESTE 6: Menu Interativo de Unidades em Mensagem Genérica ---');
  const patientChat2 = '5587988880002@c.us';
  bookingAgent.clearSession(patientChat2);

  // Desativa temporariamente businessHours para testar o pipeline do orquestrador
  const origBh = unimagemAgent.businessHours?.enabled;
  if (unimagemAgent.businessHours) unimagemAgent.businessHours.enabled = false;

  try {
    // Cenário: mensagem genérica "Quero agendar" recebida no orquestrador
    const simResult = await orchestrator.simulateMessage(patientChat2, 'Quero agendar', 'default');
    console.log(`Resposta da simulação:\n"${simResult.replyText}"\n`);

    if (!simResult.replyText.includes('Vale Studio') || !simResult.replyText.includes('Unimagem Petrolina')) {
      throw new Error('Menu de escolha de unidade não apresentou ambas as empresas');
    }
    console.log('✅ Menu com as opções apresentado com sucesso!');

    // Escolhendo opção 2 (Vale Studio)
    console.log('\n--- Paciente seleciona a Opção 2 (Vale Studio) ---');
    const simChoice2 = await orchestrator.simulateMessage(patientChat2, '2', 'default');
    console.log(`Resposta após escolha:\n"${simChoice2.replyText}"\n`);

    if (!simChoice2.replyText.includes('Vale Studio') || !simChoice2.replyText.includes('Valéria')) {
      throw new Error('Não transitou corretamente para o atendimento da Vale Studio / Dra. Valéria!');
    }
    console.log('✅ Paciente foi direcionado para Vale Studio e Dra. Valéria com sucesso!');
    console.log('✅ Teste 6 passou!\n');
  } finally {
    if (unimagemAgent.businessHours && origBh !== undefined) {
      unimagemAgent.businessHours.enabled = origBh;
    }
  }

  // Teste 7: Isolamento de Memória por Chat / Agente
  console.log('--- TESTE 7: Isolamento de Memória por Agente ---');
  const sessionP1 = bookingAgent.getSession(patientChat1, 'agent_vale_studio');
  const sessionP2 = bookingAgent.getSession(patientChat2, 'agent_vale_studio');
  
  // O paciente 1 não pode ter sessão no default
  const sessionWrong = bookingAgent.getSession(patientChat1, 'default');
  if (sessionWrong) {
    throw new Error('Vazamento de memória detectado entre empresas diferentes!');
  }
  console.log('✅ Nenhuma colisão ou vazamento de estado entre empresas!');
  console.log('✅ Teste 7 passou!\n');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🎉 TODOS OS TESTES MULTI-TENANT PASSARAM COM 100% DE SUCESSO!  ');
  console.log('═══════════════════════════════════════════════════════════════');
}

runMultiTenantTests().catch(err => {
  console.error('❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
