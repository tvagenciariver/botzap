import assert from 'assert';
import fs from 'fs';
import path from 'path';
import { customerManager } from '../src/billing/customer-manager.js';
import { billingManager } from '../src/billing/billing-manager.js';
import { agentManager } from '../src/config/agent-manager.js';

console.log('🧪 ======================================================');
console.log('🧪 TESTES DO MÓDULO DE CLIENTES & GESTÃO DE LOCATÁRIOS');
console.log('🧪 ======================================================\n');

async function runTests() {
  const defaultAgent = agentManager.getDefaultAgent();

  // 1. Teste de Cadastro de Cliente Comum
  console.log('1️⃣ Testando cadastro de Cliente Comum...');
  const normalCust = customerManager.createCustomer({
    agentId: defaultAgent.id,
    name: 'Maria Fernanda dos Santos',
    phone: '(87) 98822-3344',
    document: '123.456.789-00',
    email: 'maria.santos@email.com',
    notes: 'Cliente de procedimentos clínicos',
    isRentalCustomer: false
  });

  assert.ok(normalCust.id, 'ID deve ser gerado');
  assert.strictEqual(normalCust.name, 'Maria Fernanda dos Santos');
  assert.strictEqual(normalCust.phone, '(87) 98822-3344');
  assert.strictEqual(normalCust.chatId, '5587988223344@c.us');
  assert.strictEqual(normalCust.isRentalCustomer, false);
  assert.strictEqual(normalCust.rentalInfo, undefined);
  console.log('✅ Cliente Comum cadastrado com sucesso!');

  // 2. Teste de Cadastro de Locatário (Imóvel / Aluguel)
  console.log('\n2️⃣ Testando cadastro de Locatário com informações de Imóvel...');
  const rentalCust = customerManager.createCustomer({
    agentId: defaultAgent.id,
    name: 'João Pedro da Silva',
    phone: '(87) 99911-2233',
    document: '987.654.321-11',
    email: 'joao.pedro@locatario.com',
    notes: 'Locatário com contrato de 24 meses',
    isRentalCustomer: true,
    rentalInfo: {
      propertyCode: 'APT-302',
      propertyType: 'Apartamento',
      propertyAddress: 'Av. Guararapes, 450, Apto 302 - Centro, Petrolina/PE',
      rentAmount: 1650.00,
      dueDay: 10,
      notes: 'Aluguel inclui taxa condominial e vaga de garagem nº 12'
    }
  });

  assert.ok(rentalCust.id, 'ID deve ser gerado');
  assert.strictEqual(rentalCust.isRentalCustomer, true);
  assert.ok(rentalCust.rentalInfo, 'rentalInfo deve existir');
  assert.strictEqual(rentalCust.rentalInfo?.propertyCode, 'APT-302');
  assert.strictEqual(rentalCust.rentalInfo?.propertyType, 'Apartamento');
  assert.strictEqual(rentalCust.rentalInfo?.propertyAddress, 'Av. Guararapes, 450, Apto 302 - Centro, Petrolina/PE');
  assert.strictEqual(rentalCust.rentalInfo?.rentAmount, 1650.00);
  assert.strictEqual(rentalCust.rentalInfo?.dueDay, 10);
  console.log('✅ Locatário de Imóvel cadastrado com sucesso com todos os campos!');

  // 3. Teste de Busca e Filtros
  console.log('\n3️⃣ Testando busca e filtros de clientes...');
  
  // Busca por Código do Imóvel
  const searchByCode = customerManager.getCustomers({ search: 'APT-302' });
  assert.ok(searchByCode.some(c => c.id === rentalCust.id), 'Deve encontrar o locatário pela ref do imóvel');

  // Busca por Endereço
  const searchByAddr = customerManager.getCustomers({ search: 'Guararapes' });
  assert.ok(searchByAddr.some(c => c.id === rentalCust.id), 'Deve encontrar pelo endereço do imóvel');

  // Filtro por Locatários
  const rentalOnly = customerManager.getCustomers({ isRentalCustomer: true });
  assert.ok(rentalOnly.every(c => c.isRentalCustomer === true), 'Todos devem ser locatários');
  assert.ok(rentalOnly.some(c => c.id === rentalCust.id), 'Deve conter o locatário cadastrado');

  // Filtro por Clientes Gerais
  const regularOnly = customerManager.getCustomers({ isRentalCustomer: false });
  assert.ok(regularOnly.every(c => !c.isRentalCustomer), 'Nenhum deve ser locatário');
  assert.ok(regularOnly.some(c => c.id === normalCust.id), 'Deve conter a cliente comum');

  // Busca por Telefone Inteligente
  const foundByPhone = customerManager.findCustomerByPhone('87999112233');
  assert.ok(foundByPhone, 'Deve localizar cliente pelo número sem formatação');
  assert.strictEqual(foundByPhone?.id, rentalCust.id);
  console.log('✅ Busca e filtros funcionando perfeitamente!');

  // 4. Teste de Atualização
  console.log('\n4️⃣ Testando atualização de dados do cliente e imóvel...');
  const updatedRental = customerManager.updateCustomer(rentalCust.id, {
    name: 'João Pedro da Silva Sobrinho',
    rentalInfo: {
      propertyAddress: 'Av. Guararapes, 450, Apto 302 - Centro, Petrolina/PE',
      rentAmount: 1800.00,
      dueDay: 15
    }
  });

  assert.strictEqual(updatedRental.name, 'João Pedro da Silva Sobrinho');
  assert.strictEqual(updatedRental.rentalInfo?.rentAmount, 1800.00);
  assert.strictEqual(updatedRental.rentalInfo?.dueDay, 15);
  // Preserva outros campos não alterados
  assert.strictEqual(updatedRental.rentalInfo?.propertyCode, 'APT-302');
  console.log('✅ Atualização de cliente e imóvel validada com sucesso!');

  // 5. Teste de Emissão de Cobrança vinculada ao Cliente / Locatário
  console.log('\n5️⃣ Testando emissão de cobrança vinculada ao Locatário...');
  const charge = await billingManager.createCharge({
    agentId: defaultAgent.id,
    customerId: rentalCust.id,
    customerName: updatedRental.name,
    customerPhone: updatedRental.phone,
    serviceType: 'Aluguel de Imóvel',
    serviceDescription: `Aluguel Ref: ${updatedRental.rentalInfo?.propertyCode} - ${updatedRental.rentalInfo?.propertyAddress}`,
    amount: updatedRental.rentalInfo?.rentAmount || 1800.00,
    dueDate: '2026-10-15',
    billingMethod: 'pix',
    pixKey: 'imobiliaria@financeiro.com',
    pixKeyType: 'email',
    sendImmediately: false
  });

  assert.ok(charge.id.startsWith('bill_'), 'Cobrança deve ser gerada');
  assert.strictEqual(charge.customerId, rentalCust.id, 'Cobrança deve estar vinculada ao customerId');
  assert.strictEqual(charge.amount, 1800.00);
  assert.strictEqual(charge.serviceType, 'Aluguel de Imóvel');
  console.log('✅ Cobrança vinculada ao locatário emitida com sucesso!');

  // 6. Teste de Auto-Save de Cliente ao Emitir Cobrança com saveCustomer: true
  console.log('\n6️⃣ Testando auto-save de cliente novo na emissão de cobrança...');
  const newPhone = '5587977665544';
  const autoCharge = await billingManager.createCharge({
    agentId: defaultAgent.id,
    saveCustomer: true,
    customerName: 'Cliente Auto Salvo',
    customerPhone: newPhone,
    serviceType: 'Mensalidade / Plano',
    amount: 199.90,
    dueDate: '2026-09-30',
    billingMethod: 'pix',
    pixKey: 'clinica@teste.com',
    sendImmediately: false
  });

  assert.ok(autoCharge.customerId, 'customerId deve ser preenchido pelo auto-save');
  const savedAutoCustomer = customerManager.getCustomerById(autoCharge.customerId!);
  assert.ok(savedAutoCustomer, 'Cliente deve existir na base de dados de clientes');
  assert.strictEqual(savedAutoCustomer?.name, 'Cliente Auto Salvo');
  console.log('✅ Auto-save de cliente validado com sucesso!');

  // 7. Teste de Exclusão de Cliente
  console.log('\n7️⃣ Testando exclusão de cliente...');
  const deleted = customerManager.deleteCustomer(normalCust.id);
  assert.strictEqual(deleted, true, 'Deve retornar true ao excluir');
  assert.strictEqual(customerManager.getCustomerById(normalCust.id), undefined, 'Não deve mais existir');
  // 8. Teste de Visibilidade Multiempresa (Geral 'all' e Agente específico)
  console.log('\n8️⃣ Testando visibilidade multiempresa de clientes...');
  const globalCust = customerManager.createCustomer({
    agentId: 'all',
    name: 'Cliente Global Multiuso',
    phone: '(87) 98877-6655',
    isRentalCustomer: false
  });
  const studioCust = customerManager.createCustomer({
    agentId: 'agent_vale_studio',
    name: 'Cliente Exclusivo Vale Studio',
    phone: '(87) 98833-2211',
    isRentalCustomer: false
  });

  const allFiltered = customerManager.getCustomers({ agentId: 'all' });
  assert.ok(allFiltered.some(c => c.id === globalCust.id), 'Visão global deve conter cliente global');
  assert.ok(allFiltered.some(c => c.id === studioCust.id), 'Visão global deve conter cliente da Vale Studio');

  const studioFiltered = customerManager.getCustomers({ agentId: 'agent_vale_studio' });
  assert.ok(studioFiltered.some(c => c.id === studioCust.id), 'Filtro de estúdio deve conter cliente do estúdio');
  assert.ok(studioFiltered.some(c => c.id === globalCust.id), 'Filtro de estúdio deve conter cliente global');

  customerManager.deleteCustomer(globalCust.id);
  customerManager.deleteCustomer(studioCust.id);
  console.log('✅ Visibilidade multiempresa validada com sucesso!');

  // Cleanup dos registros de teste
  customerManager.deleteCustomer(rentalCust.id);
  if (autoCharge.customerId) customerManager.deleteCustomer(autoCharge.customerId);
  billingManager.deleteCharge(charge.id);
  billingManager.deleteCharge(autoCharge.id);

  console.log('\n🎉 TODOS OS TESTES DE CLIENTES E LOCATÁRIOS PASSARAM COM SUCESSO!');
}

runTests().catch(err => {
  console.error('❌ Falha nos testes:', err);
  process.exit(1);
});
