import { orchestrator } from '../src/orchestrator/engine.js';
import { memoryStore } from '../src/gemini/memory.js';
import { geminiService } from '../src/gemini/client.js';
import { WahaMessagePayload } from '../src/waha/types.js';

async function runTests() {
  console.log('--- INICIANDO TESTES DO ORQUESTRADOR BOTZAP ---\n');

  // Teste 1: Detecção de Transbordo Humano
  console.log('Teste 1: Verificação de intenção de transbordo humano');
  const phrase1 = 'Olá, gostaria de falar com um atendente humano por favor';
  const isHandoff1 = geminiService.checkHandoffIntent(phrase1);
  console.log(`Frase: "${phrase1}" -> Transbordo detectado: ${isHandoff1 ? 'SIM ✅' : 'NÃO ❌'}`);
  if (!isHandoff1) throw new Error('Falha no teste de transbordo');

  const phrase2 = 'Qual o horário de funcionamento de vocês?';
  const isHandoff2 = geminiService.checkHandoffIntent(phrase2);
  console.log(`Frase: "${phrase2}" -> Transbordo detectado: ${isHandoff2 ? 'SIM ❌' : 'NÃO (correto) ✅'}`);
  if (isHandoff2) throw new Error('Falso positivo no transbordo');

  // Teste 2: Processamento de Mensagem do Cliente com HandoffAgent
  console.log('\nTeste 2: Execução de simulação com pedido de humano');
  const simResult = await orchestrator.simulateMessage('5511999990001@c.us', 'Preciso de um atendente');
  console.log(`Resposta do agente (${simResult.agentName}): "${simResult.replyText}"`);
  console.log(`Ação: ${simResult.action}`);
  const isPaused = memoryStore.isChatPaused('5511999990001@c.us');
  console.log(`Bot pausado para o cliente: ${isPaused ? 'SIM ✅' : 'NÃO ❌'}`);
  if (!isPaused || simResult.action !== 'transferred_human') {
    throw new Error('Falha ao pausar bot no transbordo');
  }

  // Teste 3: Anti-Loop e Detecção de Atendente Humano (fromMe: true)
  console.log('\nTeste 3: Detecção de mensagem de atendente (fromMe: true)');
  const testChatId = '5511999990002@c.us';
  memoryStore.resumeChat(testChatId);
  console.log(`Status inicial do bot para ${testChatId}: Pausado = ${memoryStore.isChatPaused(testChatId)}`);

  const humanPayload: WahaMessagePayload = {
    id: 'msg_human_test',
    timestamp: Date.now(),
    from: '5511888880000@c.us',
    to: testChatId,
    fromMe: true, // Enviado pelo atendente humano via Chatwoot / WhatsApp
    body: 'Olá! Sou o atendente humano Pedro, em que posso ajudar?',
    hasMedia: false
  };

  await orchestrator.processIncomingWahaMessage(humanPayload, 'default');
  const isPausedAfterHuman = memoryStore.isChatPaused(testChatId);
  console.log(`Status do bot após atendente humano falar: Pausado = ${isPausedAfterHuman ? 'SIM ✅' : 'NÃO ❌'}`);
  if (!isPausedAfterHuman) {
    throw new Error('Falha ao pausar bot após mensagem do atendente');
  }

  // Teste 4: Memória Conversacional
  console.log('\nTeste 4: Memória e histórico conversacional');
  const memChatId = '5511999990003@c.us';
  memoryStore.addMessage(memChatId, 'user', 'Mensagem 1');
  memoryStore.addMessage(memChatId, 'model', 'Resposta 1');
  const history = memoryStore.getHistory(memChatId);
  console.log(`Quantidade de mensagens no histórico: ${history.length} (esperado: 2)`);
  if (history.length !== 2) throw new Error('Falha na memória conversacional');

  console.log('\n✅ TODOS OS TESTES UNITÁRIOS E DE FLUXO PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Erro durante os testes:', err);
  process.exit(1);
});
