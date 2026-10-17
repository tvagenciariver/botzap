import { agentManager, sanitizeIgnoredNumber } from '../src/config/agent-manager.js';
import { lidMapper } from '../src/appointments/phone-utils.js';
import { AgentProfile } from '../src/config/agent-types.js';

console.log('🧪 INICIANDO TESTES DO SISTEMA DE BLOQUEIO / IGNORE DE NÚMEROS E @LID...\n');

// 1. Testes de sanitização
console.log('--- 1. Testando sanitizeIgnoredNumber ---');
const t1 = sanitizeIgnoredNumber('avi-a2o1:62887095701679@lid');
console.log('avi-a2o1:62887095701679@lid ->', t1);
if (t1 !== '62887095701679@lid') throw new Error(`Falha no t1: esperava 62887095701679@lid, obteve ${t1}`);

const t2 = sanitizeIgnoredNumber('62887095701679@lid');
console.log('62887095701679@lid ->', t2);
if (t2 !== '62887095701679@lid') throw new Error(`Falha no t2: esperava 62887095701679@lid, obteve ${t2}`);

const t3 = sanitizeIgnoredNumber('62887095701679:0@lid');
console.log('62887095701679:0@lid ->', t3);
if (t3 !== '62887095701679@lid') throw new Error(`Falha no t3: esperava 62887095701679@lid, obteve ${t3}`);

const t4 = sanitizeIgnoredNumber('62887095701679');
console.log('62887095701679 (14 dígitos) ->', t4);
if (t4 !== '62887095701679@lid') throw new Error(`Falha no t4: esperava 62887095701679@lid, obteve ${t4}`);

const t5 = sanitizeIgnoredNumber('(87) 98817-7877');
console.log('(87) 98817-7877 ->', t5);
if (t5 !== '87988177877') throw new Error(`Falha no t5: esperava 87988177877, obteve ${t5}`);

const t6 = sanitizeIgnoredNumber('558788177877@c.us');
console.log('558788177877@c.us ->', t6);
if (t6 !== '558788177877') throw new Error(`Falha no t6: esperava 558788177877, obteve ${t6}`);

console.log('✅ Todos os testes de sanitização passaram com sucesso!\n');

// 2. Testes de isNumberIgnored
console.log('--- 2. Testando isNumberIgnored ---');

// Cenário A: Usuário cadastrou o LID com prefixo de agente copiado da tabela
const agentWithLidPrefix: AgentProfile = {
  id: 'avi-a2o1',
  name: 'Aviva Sport',
  companyName: 'Aviva Sport',
  active: true,
  isDefault: false,
  ignoredNumbers: ['avi-a2o1:62887095701679@lid']
} as any;

const matchA1 = agentManager.isNumberIgnored(agentWithLidPrefix, '62887095701679@lid');
console.log('Match A1 (LID puro vs agentId:LID):', matchA1);
if (!matchA1) throw new Error('Falha no Match A1');

const matchA2 = agentManager.isNumberIgnored(agentWithLidPrefix, 'avi-a2o1:62887095701679@lid');
console.log('Match A2 (agentId:LID vs agentId:LID):', matchA2);
if (!matchA2) throw new Error('Falha no Match A2');

// Cenário B: Usuário cadastrou o telefone real (558788177877) e a mensagem chega como @lid resolvido via lidMapper
lidMapper.register('62887095701679@lid', '558788177877@c.us');

const agentWithPhone: AgentProfile = {
  id: 'avi-a2o1',
  name: 'Aviva Sport',
  companyName: 'Aviva Sport',
  active: true,
  isDefault: false,
  ignoredNumbers: ['558788177877']
} as any;

const matchB1 = agentManager.isNumberIgnored(agentWithPhone, '62887095701679@lid');
console.log('Match B1 (LID mapeado vs Telefone 558788177877 cadastrado):', matchB1);
if (!matchB1) throw new Error('Falha no Match B1');

// Cenário C: Variação de 9º dígito brasileiro no telefone ignorado
const agentWith9: AgentProfile = {
  id: 'avi-a2o1',
  name: 'Aviva Sport',
  companyName: 'Aviva Sport',
  active: true,
  isDefault: false,
  ignoredNumbers: ['87988177877'] // Com 9
} as any;

const matchC1 = agentManager.isNumberIgnored(agentWith9, '558788177877@c.us'); // Sem 9
console.log('Match C1 (Telefone com 9 vs Telefone sem 9):', matchC1);
if (!matchC1) throw new Error('Falha no Match C1');

const matchC2 = agentManager.isNumberIgnored(agentWith9, '62887095701679@lid'); // LID mapeado para telefone sem 9
console.log('Match C2 (Telefone com 9 vs LID mapeado para sem 9):', matchC2);
if (!matchC2) throw new Error('Falha no Match C2');

// Cenário D: Mensagem de cliente que NÃO está na lista
const matchD1 = agentManager.isNumberIgnored(agentWithPhone, '5587999990000@c.us');
console.log('Match D1 (Número de cliente não ignorado):', matchD1);
if (matchD1) throw new Error('Falha no Match D1: cliente real não pode ser ignorado!');

console.log('\n🎉 TODOS OS TESTES PASSARAM COM 100% DE SUCESSO!');
