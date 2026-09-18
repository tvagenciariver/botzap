import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { billingManager } from '../src/billing/billing-manager.js';
import { billingScheduler } from '../src/billing/billing-scheduler.js';
import { BillingAgent } from '../src/orchestrator/agents/billing-agent.js';
import { AgentContext } from '../src/orchestrator/agents/base.js';
import { agentManager } from '../src/config/agent-manager.js';

console.log('🧪 ======================================================');
console.log('🧪 INICIANDO TESTES DO MÓDULO DE COBRANÇAS & RÉGUA');
console.log('🧪 ======================================================\n');

async function runTests() {
  const defaultAgent = agentManager.getDefaultAgent();
  const testPhone = '5587988887777';
  const testChatId = '5587988887777@c.us';

  // 1. Teste de Criação de Cobrança com Boleto PDF
  console.log('1️⃣ Testando cadastro de cobrança com Boleto PDF...');
  const fakePdfBase64 = Buffer.from('%PDF-1.4 Mock Boleto Content').toString('base64');
  const boletoCharge = await billingManager.createCharge({
    agentId: defaultAgent.id,
    customerName: 'Cliente Teste Boleto',
    customerPhone: testPhone,
    serviceType: 'Consulta Médica',
    serviceDescription: 'Consulta Cardiológica',
    amount: 250.00,
    dueDate: '2026-09-10', // Data no passado (atrasada há mais de 3 dias para testar régua)
    billingMethod: 'boleto',
    pdfBase64: fakePdfBase64,
    pdfFileName: 'boleto_teste.pdf',
    sendImmediately: false
  });

  assert.ok(boletoCharge.id.startsWith('bill_'), 'ID da cobrança deve iniciar com bill_');
  assert.strictEqual(boletoCharge.amount, 250.00, 'Valor deve ser 250.00');
  assert.strictEqual(boletoCharge.billingMethod, 'boleto');
  assert.strictEqual(boletoCharge.statusPagamento, 'pendente');
  assert.ok(boletoCharge.pdfFilePath && fs.existsSync(boletoCharge.pdfFilePath), 'Arquivo do boleto deve existir em disco');
  console.log('✅ Cobrança com Boleto PDF cadastrada com sucesso!');

  // 2. Teste de Criação de Cobrança com PIX (Chave, Copia e Cola, Imagem QR Code)
  console.log('\n2️⃣ Testando cadastro de cobrança com PIX (Chave + Copia e Cola + QR Code)...');
  const fakeQrBase64 = Buffer.from('Fake PNG QR Code Image Content').toString('base64');
  const pixCharge = await billingManager.createCharge({
    agentId: defaultAgent.id,
    customerName: 'Cliente Teste PIX',
    customerPhone: '5587999991111',
    serviceType: 'Exame Laboratorial',
    serviceDescription: 'Hemograma Completo',
    amount: 80.00,
    dueDate: '2026-09-20', // No prazo
    billingMethod: 'pix',
    pixKey: 'clinica@teste.com.br',
    pixKeyType: 'email',
    pixCopiaECola: '00020126580014BR.GOV.BCB.PIX0114clinica@teste.com.br520400005303986540580.005802BR5915CLINICA TESTE6009PETROLINA62070503***6304ABCD',
    pixQrCodeBase64: fakeQrBase64,
    pixQrCodeFileName: 'qrcode_teste.png',
    sendImmediately: false
  });

  assert.ok(pixCharge.id.startsWith('bill_'), 'ID da cobrança PIX deve iniciar com bill_');
  assert.strictEqual(pixCharge.amount, 80.00);
  assert.strictEqual(pixCharge.billingMethod, 'pix');
  assert.strictEqual(pixCharge.pixKey, 'clinica@teste.com.br');
  assert.ok(pixCharge.pixQrCodeFilePath && fs.existsSync(pixCharge.pixQrCodeFilePath), 'Arquivo do QR Code deve existir em disco');
  console.log('✅ Cobrança com PIX cadastrada com sucesso!');

  // 2.1 Teste de Criação de Cobrança com Envio Agendado
  console.log('\n2️⃣.1️⃣ Testando cadastro de cobrança com Envio Agendado...');
  const scheduledTimeStr = new Date(Date.now() + 60000).toISOString(); // 1 minuto no futuro
  const scheduledCharge = await billingManager.createCharge({
    agentId: defaultAgent.id,
    customerName: 'Cliente Agendado Teste',
    customerPhone: '5587981112222',
    serviceType: 'Procedimento Estético',
    amount: 150.00,
    dueDate: '2026-09-25',
    billingMethod: 'pix',
    pixKey: 'estetica@teste.com',
    pixKeyType: 'email',
    sendOption: 'scheduled',
    scheduledSendAt: scheduledTimeStr
  });

  assert.strictEqual(scheduledCharge.statusEnvio, 'agendado', 'Status de envio deve ser "agendado"');
  assert.strictEqual(scheduledCharge.scheduledSendAt, scheduledTimeStr);
  assert.strictEqual(scheduledCharge.sendImmediately, false);

  const scheduledList = billingManager.getCharges({ quickFilter: 'scheduled' });
  assert.ok(scheduledList.some(c => c.id === scheduledCharge.id), 'Cobrança agendada deve constar no filtro quickFilter=scheduled');
  console.log('✅ Cobrança com Envio Agendado criada e validada com sucesso!');

  // 2.2 Teste de Cobrança Recorrente (Mensalidade / Aluguel de Imóvel)
  console.log('\n2️⃣.2️⃣ Testando cadastro de Cobrança Recorrente (Mensalidade de 3 meses)...');
  const recurrentCharge = await billingManager.createCharge({
    agentId: defaultAgent.id,
    customerName: 'Locatário Teste Recorrência',
    customerPhone: '5587999881122',
    serviceType: 'Aluguel de Imóvel',
    serviceDescription: 'Aluguel AP-202',
    amount: 1400.00,
    dueDate: '2026-10-05',
    isRecurring: true,
    recurrenceMonths: 3,
    firstPaymentDate: '2026-10-05',
    billingMethod: 'pix',
    pixKey: '12345678900',
    pixKeyType: 'cpf',
    sendOption: 'manual'
  });

  assert.strictEqual(recurrentCharge.isRecurring, true, 'isRecurring deve ser true');
  assert.ok(recurrentCharge.recurrenceGroupId?.startsWith('rec_'), 'recurrenceGroupId deve iniciar com rec_');
  assert.strictEqual(recurrentCharge.installmentNumber, 1, 'installmentNumber inicial deve ser 1');
  assert.strictEqual(recurrentCharge.totalInstallments, 3, 'totalInstallments deve ser 3');
  assert.strictEqual(recurrentCharge.dueDate, '2026-10-05', 'Data do 1º pagamento deve ser 2026-10-05');

  const groupCharges = billingManager.getChargesByRecurrenceGroup(recurrentCharge.recurrenceGroupId!);
  assert.strictEqual(groupCharges.length, 3, 'Devem existir 3 cobranças geradas para o grupo de recorrência');
  assert.strictEqual(groupCharges[0].dueDate, '2026-10-05');
  assert.strictEqual(groupCharges[1].dueDate, '2026-11-05');
  assert.strictEqual(groupCharges[2].dueDate, '2026-12-05');
  assert.strictEqual(groupCharges[1].installmentNumber, 2);
  assert.strictEqual(groupCharges[2].installmentNumber, 3);
  assert.strictEqual(groupCharges[1].statusEnvio, 'pendente');

  // Validação da função de datas para viradas de ano e meses de 28/30/31 dias
  assert.strictEqual(billingManager.addMonthsToDate('2026-01-31', 1), '2026-02-28', '31 de janeiro + 1 mês deve ser 28 de fevereiro');
  assert.strictEqual(billingManager.addMonthsToDate('2026-01-31', 2), '2026-03-31', '31 de janeiro + 2 meses deve ser 31 de março');
  assert.strictEqual(billingManager.addMonthsToDate('2026-11-15', 3), '2027-02-15', '15 de novembro + 3 meses deve ser 15 de fevereiro de 2027');
  console.log('✅ Cobrança Recorrente e cálculo de parcelas mensais validados com sucesso!');

  // 3. Teste de Indicadores / KPIs (Stats)
  console.log('\n3️⃣ Testando cálculo de métricas (KPIs)...');
  const stats = billingManager.getStats(defaultAgent.id);
  assert.ok(stats.totalCount >= 2, 'Total de cobranças deve ser >= 2');
  assert.ok(stats.overdueCount >= 1, 'Cobrança do boleto (vencida em 2026-09-10) deve constar como inadimplente/régua');
  console.log(`✅ KPIs calculados: Total=${stats.totalCount} (R$ ${stats.totalAmount.toFixed(2)}), Inadimplentes=${stats.overdueCount} (R$ ${stats.overdueAmount.toFixed(2)})`);

  // 4. Teste da Régua de Cobrança Recorrente Diária (simulando execução manual)
  console.log('\n4️⃣ Testando execução da Régua de Cobrança Automática...');
  const schedulerResult = await billingScheduler.checkAndRun('manual', defaultAgent.id);
  assert.ok(schedulerResult.totalEligible >= 1, 'Cobrança vencida há mais de 3 dias deve ser selecionada pela régua');
  console.log(`✅ Régua executada com sucesso! ${schedulerResult.totalEligible} cobrança(s) elegível(is) encontrada(s).`);

  // 5. Teste do BillingAgent (Detecção Inteligente de Comprovante & Intenção "Já paguei")
  console.log('\n5️⃣ Testando BillingAgent com detecção de intenção e comprovante...');
  const billingAgent = new BillingAgent();

  const mockContext: AgentContext = {
    chatId: testChatId,
    userMessage: 'Olá, já fiz o pix e segue o comprovante do pagamento!',
    session: 'default',
    agent: defaultAgent,
    metadata: {
      payload: {
        hasMedia: true,
        media: { url: 'http://fake-waha-url/comprovante.jpg' }
      }
    }
  };

  const canHandle = await billingAgent.canHandle(mockContext);
  assert.strictEqual(canHandle, true, 'BillingAgent deve reconhecer que o cliente possui cobrança pendente e enviou comprovante');

  // Executa o agente
  const response = await billingAgent.execute(mockContext);
  assert.strictEqual(response.handled, true, 'BillingAgent deve tratar a mensagem');
  assert.ok(response.replyText && response.replyText.includes('confirmação de pagamento'), 'Resposta deve conter confirmação cordial');

  // Verifica se o status da cobrança virou "aguardando_confirmacao"
  const updatedCharge = billingManager.getChargeById(boletoCharge.id);
  assert.strictEqual(updatedCharge?.statusPagamento, 'aguardando_confirmacao', 'Status deve mudar para aguardando_confirmacao');
  console.log('✅ BillingAgent interceptou o comprovante e atualizou status para "aguardando_confirmacao"!');

  // 5.1 Teste com variação de número (sem o 9º dígito) e apenas texto ("já fiz o pix!")
  console.log('\n5️⃣.1️⃣ Testando reconhecimento com variação de 9º dígito e apenas texto de pagamento...');
  const altTestChatId = '5587999991111@c.us'; // O pixCharge foi criado com '5587999991111'
  const altContext: AgentContext = {
    chatId: '558799991111@c.us', // Variação sem o 9º dígito!
    userMessage: 'olá, já fiz o pix e tá pago!',
    session: 'default',
    agent: defaultAgent
  };

  const canHandleAlt = await billingAgent.canHandle(altContext);
  assert.strictEqual(canHandleAlt, true, 'BillingAgent deve reconhecer mesmo com variação do 9º dígito');
  const altResponse = await billingAgent.execute(altContext);
  assert.strictEqual(altResponse.handled, true);

  const updatedPixCharge = billingManager.getChargeById(pixCharge.id);
  assert.strictEqual(updatedPixCharge?.statusPagamento, 'aguardando_confirmacao', 'Status da cobrança PIX deve mudar para aguardando_confirmacao');
  console.log('✅ BillingAgent reconheceu com variação do 9º dígito e atualizou status da cobrança PIX!');

  // 5.2 Teste com envio exclusivo de imagem sem legenda (legenda vazia)
  console.log('\n5️⃣.2️⃣ Testando reconhecimento de envio exclusivo de foto sem legenda...');
  const imageOnlyContext: AgentContext = {
    chatId: '5587981112222@c.us', // scheduledCharge
    userMessage: '[Imagem / Comprovante Anexo Enviado pelo Cliente]',
    session: 'default',
    agent: defaultAgent,
    metadata: {
      payload: {
        hasMedia: true,
        type: 'image',
        media: { mimetype: 'image/jpeg' }
      }
    }
  };

  const canHandleImg = await billingAgent.canHandle(imageOnlyContext);
  assert.strictEqual(canHandleImg, true, 'BillingAgent deve reconhecer envio de imagem/foto como comprovante');
  await billingAgent.execute(imageOnlyContext);
  const updatedSchedCharge = billingManager.getChargeById(scheduledCharge.id);
  assert.strictEqual(updatedSchedCharge?.statusPagamento, 'aguardando_confirmacao');
  console.log('✅ BillingAgent reconheceu envio de imagem sem legenda e atualizou status para "aguardando_confirmacao"!');

  // 6. Teste de Baixa Manual com Disparo de Mensagem de Confirmação & Agradecimento
  console.log('\n6️⃣ Testando Baixa Manual do Pagamento (com mensagem de agradecimento)...');
  const paidCharge = await billingManager.markAsPaidManual(boletoCharge.id, {
    paidBy: 'Dr. Financeiro',
    paidMethod: 'PIX',
    notes: 'PIX conferido no extrato bancário',
    sendReceiptMessage: true
  });

  assert.strictEqual(paidCharge.statusPagamento, 'pago', 'Status deve ser pago');
  assert.strictEqual(paidCharge.paidBy, 'Dr. Financeiro');
  assert.ok(paidCharge.paidAt, 'paidAt deve estar preenchido');

  const logs = billingManager.getLogs(boletoCharge.id);
  const bajaLog = logs.find(l => l.type === 'baixa_manual');
  assert.ok(bajaLog, 'Deve existir log do tipo baixa_manual');
  console.log(`✅ Log de baixa manual registrado: "${bajaLog?.message}"`);

  // Re-checa KPIs
  const statsAfterPaid = billingManager.getStats(defaultAgent.id);
  assert.ok(statsAfterPaid.receivedCount >= 1, 'receivedCount deve ter aumentado');
  console.log(`✅ Baixa manual concluída! Cobranças recebidas: ${statsAfterPaid.receivedCount} (R$ ${statsAfterPaid.receivedAmount.toFixed(2)})`);

  // Limpeza dos dados de teste
  console.log('\n7️⃣ Limpando registros de teste...');
  billingManager.deleteCharge(boletoCharge.id);
  billingManager.deleteCharge(pixCharge.id);
  billingManager.deleteCharge(scheduledCharge.id);
  groupCharges.forEach(c => billingManager.deleteCharge(c.id));
  console.log('✅ Cobranças de teste removidas.');

  console.log('\n🎉 ======================================================');
  console.log('🎉 TODOS OS TESTES DO MÓDULO DE COBRANÇAS PASSARAM! (100% OK)');
  console.log('🎉 ======================================================\n');
}

runTests().catch(err => {
  console.error('❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
