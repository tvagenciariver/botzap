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

  // 6. Teste de Baixa Manual
  console.log('\n6️⃣ Testando Baixa Manual do Pagamento...');
  const paidCharge = billingManager.markAsPaidManual(boletoCharge.id, {
    paidBy: 'Dr. Financeiro',
    notes: 'PIX conferido no extrato bancário'
  });

  assert.strictEqual(paidCharge.statusPagamento, 'pago', 'Status deve ser pago');
  assert.strictEqual(paidCharge.paidBy, 'Dr. Financeiro');
  assert.ok(paidCharge.paidAt, 'paidAt deve estar preenchido');

  // Re-checa KPIs
  const statsAfterPaid = billingManager.getStats(defaultAgent.id);
  assert.ok(statsAfterPaid.receivedCount >= 1, 'receivedCount deve ter aumentado');
  console.log(`✅ Baixa manual concluída! Cobranças recebidas: ${statsAfterPaid.receivedCount} (R$ ${statsAfterPaid.receivedAmount.toFixed(2)})`);

  // Limpeza dos dados de teste
  console.log('\n7️⃣ Limpando registros de teste...');
  billingManager.deleteCharge(boletoCharge.id);
  billingManager.deleteCharge(pixCharge.id);
  console.log('✅ Cobranças de teste removidas.');

  console.log('\n🎉 ======================================================');
  console.log('🎉 TODOS OS TESTES DO MÓDULO DE COBRANÇAS PASSARAM! (100% OK)');
  console.log('🎉 ======================================================\n');
}

runTests().catch(err => {
  console.error('❌ ERRO NOS TESTES:', err);
  process.exit(1);
});
