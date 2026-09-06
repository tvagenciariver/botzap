import fs from 'fs';
import path from 'path';
import { Partner } from './types.js';

export class PartnerManager {
  private partnersFile: string;
  private partners: Partner[] = [];

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }
    this.partnersFile = path.join(dataDir, 'partners.json');
    this.loadFromDisk();
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.partnersFile)) {
        const raw = fs.readFileSync(this.partnersFile, 'utf-8');
        this.partners = JSON.parse(raw);
        console.log(`[PartnerManager] ${this.partners.length} parceiro(s)/convênio(s) carregado(s).`);
        return;
      }
    } catch (err: any) {
      console.warn('[PartnerManager] Falha ao carregar partners.json:', err.message);
    }

    // Inicialização com dados padrão caso o arquivo não exista
    this.partners = [
      {
        id: 'partner_saolucas',
        agentId: '*',
        name: 'Clínica & Diagnóstico São Lucas',
        document: '12.345.678/0001-90',
        phone: '5587988177877',
        contactPerson: 'Dra. Roberta Santos',
        email: 'contato@clinicasaolucas.com.br',
        notes: 'Convênio corporativo e exames ocupacionais',
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'partner_bemestar',
        agentId: '*',
        name: 'Plano & Saúde Bem Estar',
        document: '98.765.432/0001-10',
        phone: '5587988882222',
        contactPerson: 'Carlos Eduardo (Convênios)',
        email: 'atendimento@bemestarsaude.com.br',
        notes: 'Encaminhamento de pacientes conveniados',
        active: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];

    this.saveToDisk();
    console.log(`[PartnerManager] Criados parceiros padrão de exemplo.`);
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.partnersFile, JSON.stringify(this.partners, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[PartnerManager] Erro ao salvar partners.json:', err.message);
    }
  }

  listPartners(agentId?: string): Partner[] {
    let list = [...this.partners];
    if (agentId && agentId !== 'all') {
      list = list.filter(p => p.agentId === agentId || p.agentId === '*');
    }
    return list.sort((a, b) => a.name.localeCompare(b.name));
  }

  getPartner(id: string): Partner | undefined {
    return this.partners.find(p => p.id === id);
  }

  createPartner(data: {
    agentId?: string;
    name: string;
    document?: string;
    phone: string;
    contactPerson?: string;
    email?: string;
    notes?: string;
    active?: boolean;
  }): Partner {
    if (!data.name || !data.name.trim()) {
      throw new Error('O nome da empresa/clínica parceira é obrigatório.');
    }
    if (!data.phone || !data.phone.trim()) {
      throw new Error('O WhatsApp da empresa/clínica parceira é obrigatório.');
    }

    const newPartner: Partner = {
      id: 'partner_' + Math.random().toString(36).substring(2, 9),
      agentId: data.agentId || '*',
      name: data.name.trim(),
      document: data.document?.trim() || '',
      phone: data.phone.trim(),
      contactPerson: data.contactPerson?.trim() || '',
      email: data.email?.trim() || '',
      notes: data.notes?.trim() || '',
      active: data.active !== false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.partners.push(newPartner);
    this.saveToDisk();
    console.log(`[PartnerManager] Parceiro criado: ${newPartner.name} (${newPartner.id})`);
    return newPartner;
  }

  updatePartner(id: string, updates: Partial<Partner>): Partner {
    const idx = this.partners.findIndex(p => p.id === id);
    if (idx === -1) {
      throw new Error(`Parceiro com ID "${id}" não encontrado.`);
    }

    this.partners[idx] = {
      ...this.partners[idx],
      ...updates,
      id, // Imutável
      updatedAt: new Date().toISOString()
    };

    this.saveToDisk();
    return this.partners[idx];
  }

  deletePartner(id: string): boolean {
    const initialLen = this.partners.length;
    this.partners = this.partners.filter(p => p.id !== id);
    if (this.partners.length !== initialLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }
}

export const partnerManager = new PartnerManager();
