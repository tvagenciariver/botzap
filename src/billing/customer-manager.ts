import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  BillingCustomer,
  CreateCustomerDTO,
  UpdateCustomerDTO,
  CustomerFilter,
  RentalPropertyInfo
} from './types.js';
import { formatToWhatsAppChatId, matchPhoneOrChatId } from '../appointments/phone-utils.js';

export class CustomerManager {
  private dataDir: string;
  private customersFile: string;
  private customers: BillingCustomer[] = [];

  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
    this.customersFile = path.join(this.dataDir, 'billing_customers.json');
    this.ensureDirs();
    this.loadFromDisk();
  }

  private ensureDirs(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(this.customersFile)) {
        const raw = fs.readFileSync(this.customersFile, 'utf-8');
        this.customers = JSON.parse(raw);
        console.log(`[CustomerManager] ${this.customers.length} cliente(s) carregado(s) do disco.`);
      }
    } catch (err: any) {
      console.warn('[CustomerManager] Aviso ao ler billing_customers.json:', err.message);
      this.customers = [];
    }
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(this.customersFile, JSON.stringify(this.customers, null, 2), 'utf-8');
    } catch (err: any) {
      console.error('[CustomerManager] Erro ao gravar billing_customers.json:', err.message);
    }
  }

  public getCustomers(filter?: CustomerFilter): BillingCustomer[] {
    let result = [...this.customers];

    if (filter?.agentId && filter.agentId !== 'all') {
      result = result.filter(c => !c.agentId || c.agentId === filter.agentId || c.agentId === 'all');
    }

    if (typeof filter?.isRentalCustomer === 'boolean') {
      result = result.filter(c => c.isRentalCustomer === filter.isRentalCustomer);
    }

    if (filter?.search) {
      const q = filter.search.toLowerCase().trim();
      result = result.filter(c => {
        const nameMatch = c.name?.toLowerCase().includes(q);
        const phoneMatch = c.phone?.toLowerCase().includes(q);
        const docMatch = c.document?.toLowerCase().includes(q);
        const emailMatch = c.email?.toLowerCase().includes(q);
        const addrMatch = c.rentalInfo?.propertyAddress?.toLowerCase().includes(q);
        const codeMatch = c.rentalInfo?.propertyCode?.toLowerCase().includes(q);
        return nameMatch || phoneMatch || docMatch || emailMatch || addrMatch || codeMatch;
      });
    }

    // Ordenar em ordem alfabética por nome
    return result.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR', { sensitivity: 'base' }));
  }

  public getCustomerById(id: string): BillingCustomer | undefined {
    return this.customers.find(c => c.id === id);
  }

  public findCustomerByPhone(phone: string, agentId?: string): BillingCustomer | undefined {
    if (!phone) return undefined;
    const candidates = agentId && agentId !== 'all'
      ? this.customers.filter(c => !c.agentId || c.agentId === agentId || c.agentId === 'all')
      : this.customers;

    return candidates.find(c => matchPhoneOrChatId(phone, c.phone) || matchPhoneOrChatId(phone, c.chatId));
  }

  public createCustomer(dto: CreateCustomerDTO): BillingCustomer {
    if (!dto.name || !dto.phone) {
      throw new Error('Nome e telefone são obrigatórios para cadastrar o cliente.');
    }

    const chatId = formatToWhatsAppChatId(dto.phone);
    const now = new Date().toISOString();

    const customer: BillingCustomer = {
      id: crypto.randomUUID(),
      agentId: dto.agentId || 'all',
      name: dto.name.trim(),
      phone: dto.phone.trim(),
      chatId,
      document: dto.document?.trim() || undefined,
      email: dto.email?.trim() || undefined,
      notes: dto.notes?.trim() || undefined,
      isRentalCustomer: Boolean(dto.isRentalCustomer),
      rentalInfo: dto.isRentalCustomer && dto.rentalInfo ? {
        propertyCode: dto.rentalInfo.propertyCode?.trim() || undefined,
        propertyAddress: dto.rentalInfo.propertyAddress?.trim() || '',
        propertyType: dto.rentalInfo.propertyType?.trim() || undefined,
        rentAmount: typeof dto.rentalInfo.rentAmount === 'number' ? dto.rentalInfo.rentAmount : (Number(dto.rentalInfo.rentAmount) || undefined),
        dueDay: typeof dto.rentalInfo.dueDay === 'number' ? dto.rentalInfo.dueDay : (Number(dto.rentalInfo.dueDay) || undefined),
        notes: dto.rentalInfo.notes?.trim() || undefined,
      } : undefined,
      createdAt: now,
      updatedAt: now
    };

    this.customers.push(customer);
    this.saveToDisk();
    return customer;
  }

  public updateCustomer(id: string, dto: UpdateCustomerDTO): BillingCustomer {
    const index = this.customers.findIndex(c => c.id === id);
    if (index === -1) {
      throw new Error(`Cliente com ID ${id} não encontrado.`);
    }

    const existing = this.customers[index];
    const now = new Date().toISOString();

    const phone = dto.phone ? dto.phone.trim() : existing.phone;
    const chatId = dto.phone ? formatToWhatsAppChatId(phone) : existing.chatId;

    const isRentalCustomer = typeof dto.isRentalCustomer === 'boolean' 
      ? dto.isRentalCustomer 
      : existing.isRentalCustomer;

    let rentalInfo = existing.rentalInfo;
    if (isRentalCustomer) {
      if (dto.rentalInfo) {
        rentalInfo = {
          propertyCode: dto.rentalInfo.propertyCode !== undefined ? (dto.rentalInfo.propertyCode?.trim() || undefined) : existing.rentalInfo?.propertyCode,
          propertyAddress: dto.rentalInfo.propertyAddress !== undefined ? (dto.rentalInfo.propertyAddress?.trim() || '') : (existing.rentalInfo?.propertyAddress || ''),
          propertyType: dto.rentalInfo.propertyType !== undefined ? (dto.rentalInfo.propertyType?.trim() || undefined) : existing.rentalInfo?.propertyType,
          rentAmount: dto.rentalInfo.rentAmount !== undefined ? (Number(dto.rentalInfo.rentAmount) || undefined) : existing.rentalInfo?.rentAmount,
          dueDay: dto.rentalInfo.dueDay !== undefined ? (Number(dto.rentalInfo.dueDay) || undefined) : existing.rentalInfo?.dueDay,
          notes: dto.rentalInfo.notes !== undefined ? (dto.rentalInfo.notes?.trim() || undefined) : existing.rentalInfo?.notes,
        };
      }
    } else {
      rentalInfo = undefined;
    }

    const updated: BillingCustomer = {
      ...existing,
      agentId: dto.agentId !== undefined ? (dto.agentId || 'all') : existing.agentId,
      name: dto.name ? dto.name.trim() : existing.name,
      phone,
      chatId,
      document: dto.document !== undefined ? (dto.document?.trim() || undefined) : existing.document,
      email: dto.email !== undefined ? (dto.email?.trim() || undefined) : existing.email,
      notes: dto.notes !== undefined ? (dto.notes?.trim() || undefined) : existing.notes,
      isRentalCustomer,
      rentalInfo,
      updatedAt: now
    };

    this.customers[index] = updated;
    this.saveToDisk();
    return updated;
  }

  public deleteCustomer(id: string): boolean {
    const initialLen = this.customers.length;
    this.customers = this.customers.filter(c => c.id !== id);
    if (this.customers.length !== initialLen) {
      this.saveToDisk();
      return true;
    }
    return false;
  }

  public upsertCustomerFromBilling(agentId: string, name: string, phone: string): BillingCustomer {
    const existing = this.findCustomerByPhone(phone, agentId);
    if (existing) {
      if (name && name.trim() && existing.name !== name.trim()) {
        return this.updateCustomer(existing.id, { name: name.trim() });
      }
      return existing;
    }

    return this.createCustomer({
      agentId,
      name: name.trim(),
      phone: phone.trim(),
      isRentalCustomer: false
    });
  }
}

export const customerManager = new CustomerManager();
