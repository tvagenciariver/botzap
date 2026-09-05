import { orchestrator } from '../src/orchestrator/engine.js';
import { memoryStore } from '../src/gemini/memory.js';
import { geminiService } from '../src/gemini/client.js';
import { botTracker } from '../src/orchestrator/bot-tracker.js';
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
  console.log('\nTeste 3: Detecção de mensagem de atendente humano (fromMe: true) com pausa de 6 horas');
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
  const sessionState = memoryStore.getSession(testChatId);
  const remainingHours = sessionState.pausedUntil ? (sessionState.pausedUntil - Date.now()) / (1000 * 60 * 60) : 0;

  console.log(`Status do bot após atendente humano falar: Pausado = ${isPausedAfterHuman ? 'SIM ✅' : 'NÃO ❌'}`);
  console.log(`Tempo de pausa registrado: ~${remainingHours.toFixed(1)} horas (esperado: ~6.0h)`);
  if (!isPausedAfterHuman || remainingHours < 5.8) {
    throw new Error('Falha ao pausar bot após mensagem do atendente pelo intervalo correto');
  }

  // Teste 4: Ecos do próprio bot NÃO devem pausar a conversa
  console.log('\nTeste 4: Eco de mensagem do próprio bot (fromMe: true gerado pelo bot)');
  const echoChatId = '5511999990004@c.us';
  memoryStore.resumeChat(echoChatId);

  // O bot registra que acabou de enviar esta mensagem:
  botTracker.recordBotMessage(echoChatId, 'Olá! Como posso ajudar você hoje?', 'msg_bot_echo_123');

  // A WAHA emite o evento fromMe: true correspondente à resposta do bot:
  const botEchoPayload: WahaMessagePayload = {
    id: 'msg_bot_echo_123',
    timestamp: Date.now(),
    from: '5511888880000@c.us',
    to: echoChatId,
    fromMe: true,
    body: 'Olá! Como posso ajudar você hoje?',
    hasMedia: false
  };

  await orchestrator.processIncomingWahaMessage(botEchoPayload, 'default');
  const isPausedAfterEcho = memoryStore.isChatPaused(echoChatId);
  console.log(`Status do bot após eco da sua própria mensagem: Pausado = ${isPausedAfterEcho ? 'SIM (incorreto) ❌' : 'NÃO (correto) ✅'}`);
  if (isPausedAfterEcho) {
    throw new Error('Falha: o eco do bot causou pausa indevida');
  }

  // Teste 5: Memória Conversacional
  console.log('\nTeste 5: Memória e histórico conversacional');
  const memChatId = '5511999990003@c.us';
  memoryStore.addMessage(memChatId, 'user', 'Mensagem 1');
  memoryStore.addMessage(memChatId, 'model', 'Resposta 1');
  const history = memoryStore.getHistory(memChatId);
  console.log(`Quantidade de mensagens no histórico: ${history.length} (esperado: 2)`);
  if (history.length !== 2) throw new Error('Falha na memória conversacional');

  // Teste 6: Proteção contra erro "First content should be with role 'user', got model"
  console.log('\nTeste 6: Sanitização de histórico para Gemini (primeira mensagem DEVE ser user)');
  const bugChatId = '5511999990005@c.us';
  // Injeta propositalmente uma mensagem 'model' no início
  memoryStore.addMessage(bugChatId, 'model', 'Mensagem inicial do bot');
  memoryStore.addMessage(bugChatId, 'user', 'Pergunta do cliente 1');
  memoryStore.addMessage(bugChatId, 'model', 'Resposta do bot 1');
  memoryStore.addMessage(bugChatId, 'user', 'Pergunta do cliente 2');

  const sanitizedHistory = memoryStore.getHistory(bugChatId);
  console.log(`Primeiro item no histórico: role='${sanitizedHistory[0]?.role}' (DEVE ser 'user')`);
  console.log(`Último item no histórico: role='${sanitizedHistory[sanitizedHistory.length - 1]?.role}' (DEVE ser 'model')`);
  if (sanitizedHistory[0]?.role !== 'user') {
    throw new Error('Falha: histórico sanitizado começou com role diferente de "user"');
  }
  if (sanitizedHistory[sanitizedHistory.length - 1]?.role !== 'model') {
    throw new Error('Falha: histórico para startChat terminou com role diferente de "model"');
  }
  console.log('Sanitização de histórico para Gemini: APROVADO ✅');

  // Teste 7: Descarte de mensagens antigas ou sincronizadas pelo histórico da WAHA (stale messages)
  console.log('\nTeste 7: Descarte de mensagens antigas (stale messages do WhatsApp)');
  const staleChatId = '5511999990006@c.us';
  const initialLogsCount = orchestrator.getLogs().length;

  const stalePayload: WahaMessagePayload = {
    id: 'stale_msg_test_' + Date.now(),
    timestamp: Math.round((Date.now() - 300000) / 1000), // 5 minutos atrás (em segundos)
    from: staleChatId,
    to: '5511888880000@c.us',
    fromMe: false,
    body: 'Oi, mensagem antiga de horas atrás',
    hasMedia: false
  };

  await orchestrator.processIncomingWahaMessage(stalePayload, 'default');
  const logs = orchestrator.getLogs();
  const lastLog = logs[0];
  console.log(`Último log gerado: "${lastLog?.message}" (tipo: ${lastLog?.type})`);
  if (!lastLog?.message?.includes('Mensagem antiga/histórico ignorada')) {
    throw new Error('Falha: mensagem antiga não foi descartada pelo orquestrador');
  }
  console.log('Descarte de mensagens antigas da WAHA: APROVADO ✅');

  console.log('\n✅ TODOS OS TESTES PASSARAM COM SUCESSO!\n');
}

runTests().catch(err => {
  console.error('❌ Erro durante os testes:', err);
  process.exit(1);
});
