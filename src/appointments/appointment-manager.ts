import fs from 'fs';
import path from 'path';
import { Specialist, ServiceItem, Appointment, AppointmentStatus } from './types.js';
import { matchPhoneOrChatId } from './phone-utils.js';

export class AppointmentManager {
  private appointmentsFile: string;
  private specialistsFile: string;
  private servicesFile: string;

  private appointments: Appointment[] = [];
  private specialists: Specialist[] = [];
  private services: ServiceItem[] = [];

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.appointmentsFile = path.join(dataDir, 'appointments.json');
    this.specialistsFile = path.join(dataDir, 'specialists.json');
    this.servicesFile = path.join(dataDir, 'services.json');

    this.loadData();
  }

  private loadData(): void {
    // 1. Carrega ou inicializa Especialistas
    if (fs.existsSync(this.specialistsFile)) {
      try {
        const raw = fs.readFileSync(this.specialistsFile, 'utf-8');
        this.specialists = JSON.parse(raw);
      } catch (err) {
        console.error('[AppointmentManager] Erro ao carregar specialists.json:', err);
        this.specialists = [];
      }
    } else {
      this.specialists = this.getSeedSpecialists();
      this.saveSpecialists();
    }

    // 2. Carrega ou inicializa Serviços
    if (fs.existsSync(this.servicesFile)) {
      try {
        const raw = fs.readFileSync(this.servicesFile, 'utf-8');
        this.services = JSON.parse(raw);
      } catch (err) {
        console.error('[AppointmentManager] Erro ao carregar services.json:', err);
        this.services = [];
      }
    } else {
      this.services = this.getSeedServices();
      this.saveServices();
    }

    // 3. Carrega Agendamentos
    if (fs.existsSync(this.appointmentsFile)) {
      try {
        const raw = fs.readFileSync(this.appointmentsFile, 'utf-8');
        this.appointments = JSON.parse(raw);
      } catch (err) {
        console.error('[AppointmentManager] Erro ao carregar appointments.json:', err);
        this.appointments = [];
      }
    } else {
      this.appointments = this.getSeedAppointments();
      this.saveAppointments();
    }
  }

  private saveAppointments(): void {
    try {
      fs.writeFileSync(this.appointmentsFile, JSON.stringify(this.appointments, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AppointmentManager] Falha ao salvar appointments.json:', err);
    }
  }

  private saveSpecialists(): void {
    try {
      fs.writeFileSync(this.specialistsFile, JSON.stringify(this.specialists, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AppointmentManager] Falha ao salvar specialists.json:', err);
    }
  }

  private saveServices(): void {
    try {
      fs.writeFileSync(this.servicesFile, JSON.stringify(this.services, null, 2), 'utf-8');
    } catch (err) {
      console.error('[AppointmentManager] Falha ao salvar services.json:', err);
    }
  }

  // =========================================================================
  // ESPECIALISTAS
  // =========================================================================

  listSpecialists(agentId?: string): Specialist[] {
    if (!agentId || agentId === 'all') {
      return this.specialists;
    }
    return this.specialists.filter(s => s.agentId === agentId || s.agentId === '*');
  }

  getSpecialist(id: string): Specialist | undefined {
    return this.specialists.find(s => s.id === id);
  }

  createSpecialist(data: Omit<Specialist, 'id' | 'createdAt'>): Specialist {
    const newSpec: Specialist = {
      ...data,
      id: 'spec_' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString()
    };
    this.specialists.push(newSpec);
    this.saveSpecialists();
    return newSpec;
  }

  updateSpecialist(id: string, updates: Partial<Specialist>): Specialist {
    const idx = this.specialists.findIndex(s => s.id === id);
    if (idx === -1) {
      throw new Error(`Especialista com ID "${id}" não encontrado.`);
    }
    this.specialists[idx] = {
      ...this.specialists[idx],
      ...updates,
      id // Imutável
    };
    this.saveSpecialists();
    return this.specialists[idx];
  }

  deleteSpecialist(id: string): boolean {
    const initialLen = this.specialists.length;
    this.specialists = this.specialists.filter(s => s.id !== id);
    if (this.specialists.length !== initialLen) {
      this.saveSpecialists();
      return true;
    }
    return false;
  }

  // =========================================================================
  // SERVIÇOS
  // =========================================================================

  listServices(agentId?: string): ServiceItem[] {
    if (!agentId || agentId === 'all') {
      return this.services;
    }
    return this.services.filter(s => s.agentId === agentId || s.agentId === '*');
  }

  getService(id: string): ServiceItem | undefined {
    return this.services.find(s => s.id === id);
  }

  createService(data: Omit<ServiceItem, 'id' | 'createdAt'>): ServiceItem {
    const newService: ServiceItem = {
      ...data,
      id: 'srv_' + Math.random().toString(36).substring(2, 9),
      createdAt: new Date().toISOString()
    };
    this.services.push(newService);
    this.saveServices();
    return newService;
  }

  updateService(id: string, updates: Partial<ServiceItem>): ServiceItem {
    const idx = this.services.findIndex(s => s.id === id);
    if (idx === -1) {
      throw new Error(`Serviço com ID "${id}" não encontrado.`);
    }
    this.services[idx] = {
      ...this.services[idx],
      ...updates,
      id
    };
    this.saveServices();
    return this.services[idx];
  }

  deleteService(id: string): boolean {
    const initialLen = this.services.length;
    this.services = this.services.filter(s => s.id !== id);
    if (this.services.length !== initialLen) {
      this.saveServices();
      return true;
    }
    return false;
  }

  // =========================================================================
  // AGENDAMENTOS
  // =========================================================================

  listAppointments(filters?: {
    agentId?: string;
    date?: string;
    specialistId?: string;
    status?: string;
  }): Appointment[] {
    let list = [...this.appointments];

    if (filters?.agentId && filters.agentId !== 'all') {
      list = list.filter(a => a.agentId === filters.agentId);
    }
    if (filters?.date) {
      list = list.filter(a => a.date === filters.date);
    }
    if (filters?.specialistId && filters.specialistId !== 'all') {
      list = list.filter(a => a.specialistId === filters.specialistId);
    }
    if (filters?.status && filters.status !== 'all') {
      list = list.filter(a => a.status === filters.status);
    }

    // Ordena por data e hora de início
    list.sort((a, b) => {
      const cmpDate = a.date.localeCompare(b.date);
      if (cmpDate !== 0) return cmpDate;
      return a.startTime.localeCompare(b.startTime);
    });

    return list;
  }

  getAppointment(id: string): Appointment | undefined {
    return this.appointments.find(a => a.id === id);
  }

  getAppointmentsByChatId(chatId: string): Appointment[] {
    return this.appointments.filter(a => 
      (matchPhoneOrChatId(a.clientChatId, chatId) || matchPhoneOrChatId(a.clientPhone, chatId)) && 
      a.status !== 'cancelled' && 
      a.status !== 'cancelled_by_patient'
    ).sort((a, b) => a.date.localeCompare(b.date));
  }

  createAppointment(data: {
    agentId: string;
    specialistId: string;
    serviceId?: string;
    clientChatId: string;
    clientPhone: string;
    clientName: string;
    date: string;
    startTime: string;
    notes?: string;
    referralType?: 'particular' | 'partner';
    partnerId?: string;
    partnerName?: string;
    bookedVia?: 'whatsapp' | 'manual' | 'simulator';
  }): Appointment {
    const specialist = this.getSpecialist(data.specialistId);
    if (!specialist) {
      throw new Error('Especialista não encontrado.');
    }

    // Validação Anti-Conflito de Horário
    const isSlotAvailable = this.isSlotAvailable(data.specialistId, data.date, data.startTime);
    if (!isSlotAvailable) {
      throw new Error(`O horário ${data.startTime} em ${data.date} já está ocupado ou indisponível.`);
    }

    let serviceName = 'Consulta / Atendimento';
    let duration = specialist.slotDurationMinutes || 30;

    if (data.serviceId) {
      const srv = this.getService(data.serviceId);
      if (srv) {
        serviceName = srv.name;
        duration = srv.durationMinutes || duration;
      }
    }

    // Calcula horário de término
    const endTime = this.addMinutesToTime(data.startTime, duration);

    // Sanitiza o telefone do cliente para nunca exibir @lid ou jids internos
    let cleanClientPhone = (data.clientPhone || '').trim();
    if (cleanClientPhone.includes('@lid') || cleanClientPhone.includes('@c.us') || cleanClientPhone.includes('@s.whatsapp.net')) {
      cleanClientPhone = cleanClientPhone.replace(/@.*$/, '');
    }

    const newApt: Appointment = {
      id: 'apt_' + Math.random().toString(36).substring(2, 9),
      agentId: data.agentId,
      specialistId: specialist.id,
      specialistName: specialist.name,
      specialistRole: specialist.role,
      serviceId: data.serviceId,
      serviceName,
      clientChatId: data.clientChatId,
      clientPhone: cleanClientPhone,
      clientName: data.clientName.trim(),
      date: data.date,
      startTime: data.startTime,
      endTime,
      status: 'confirmed',
      notes: data.notes,
      referralType: data.referralType || (data.partnerId ? 'partner' : 'particular'),
      partnerId: data.partnerId,
      partnerName: data.partnerName,
      notifiedSpecialist: false,
      reminderSent: false,
      bookedVia: data.bookedVia || 'whatsapp',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.appointments.push(newApt);
    this.saveAppointments();

    console.log(`[AppointmentManager] Novo agendamento criado: ${newApt.id} - ${newApt.clientName} com ${newApt.specialistName} em ${newApt.date} às ${newApt.startTime}`);

    return newApt;
  }

  updateAppointment(id: string, updates: Partial<Appointment>): Appointment {
    const idx = this.appointments.findIndex(a => a.id === id);
    if (idx === -1) {
      throw new Error(`Agendamento "${id}" não encontrado.`);
    }

    const current = this.appointments[idx];

    // Se mudou data ou horário, verifica anti-conflito
    if ((updates.date && updates.date !== current.date) || (updates.startTime && updates.startTime !== current.startTime)) {
      const targetDate = updates.date || current.date;
      const targetTime = updates.startTime || current.startTime;
      const specId = updates.specialistId || current.specialistId;
      
      const isAvailable = this.isSlotAvailable(specId, targetDate, targetTime, id);
      if (!isAvailable) {
        throw new Error(`O horário ${targetTime} em ${targetDate} já está ocupado por outro agendamento.`);
      }
    }

    this.appointments[idx] = {
      ...current,
      ...updates,
      id,
      updatedAt: new Date().toISOString()
    };

    this.saveAppointments();
    return this.appointments[idx];
  }

  cancelAppointment(id: string, byPatient: boolean = false): Appointment {
    const idx = this.appointments.findIndex(a => a.id === id);
    if (idx === -1) {
      throw new Error(`Agendamento "${id}" não encontrado.`);
    }

    const newStatus: AppointmentStatus = byPatient ? 'cancelled_by_patient' : 'cancelled';
    this.appointments[idx].status = newStatus;
    this.appointments[idx].updatedAt = new Date().toISOString();

    this.saveAppointments();
    console.log(`[AppointmentManager] Agendamento ${id} cancelado (${newStatus}). Horário liberado para encaixes.`);

    return this.appointments[idx];
  }

  deleteAppointment(id: string): boolean {
    const initialLen = this.appointments.length;
    this.appointments = this.appointments.filter(a => a.id !== id);
    if (this.appointments.length !== initialLen) {
      this.saveAppointments();
      return true;
    }
    return false;
  }

  // =========================================================================
  // SLOTS LIVRES E ALGORITMO ANTI-COLISÃO
  // =========================================================================

  /**
   * Retorna a lista de horários livres para um especialista em determinada data
   */
  getAvailableSlots(specialistId: string, dateStr: string): string[] {
    const specialist = this.getSpecialist(specialistId);
    if (!specialist || !specialist.active) {
      return [];
    }

    // Converte YYYY-MM-DD para dia da semana
    const dayOfWeek = this.getDayOfWeekFromDate(dateStr);
    if (!specialist.workingDays.includes(dayOfWeek)) {
      return []; // Especialista não atende neste dia da semana
    }

    const startMinutes = this.timeToMinutes(specialist.workHoursStart || '08:00');
    const endMinutes = this.timeToMinutes(specialist.workHoursEnd || '18:00');
    const step = specialist.slotDurationMinutes || 30;

    const breakStart = specialist.breakStart ? this.timeToMinutes(specialist.breakStart) : -1;
    const breakEnd = specialist.breakEnd ? this.timeToMinutes(specialist.breakEnd) : -1;

    // Agendamentos existentes nesta data
    const bookedAppointments = this.appointments.filter(a =>
      a.specialistId === specialistId &&
      a.date === dateStr &&
      a.status !== 'cancelled' &&
      a.status !== 'cancelled_by_patient'
    );

    const bookedSlotStarts = new Set(bookedAppointments.map(a => a.startTime));

    // Verifica se dateStr é hoje no fuso de Brasília para descartar horários passados
    const todayStr = this.getTodayDateString();
    const currentMinutesToday = this.getCurrentTimeMinutesInBrazil();

    const availableSlots: string[] = [];

    for (let m = startMinutes; m + step <= endMinutes; m += step) {
      // 1. Pula se estiver dentro do almoço
      if (breakStart !== -1 && breakEnd !== -1) {
        if (m >= breakStart && m < breakEnd) {
          continue;
        }
      }

      const timeStr = this.minutesToTime(m);

      // 2. Pula se já estiver agendado
      if (bookedSlotStarts.has(timeStr)) {
        continue;
      }

      // 3. Se for hoje, pula se já passou da hora atual (+ 15 min de margem)
      if (dateStr === todayStr && m <= (currentMinutesToday + 15)) {
        continue;
      }

      availableSlots.push(timeStr);
    }

    return availableSlots;
  }

  /**
   * Checa se um slot específico está livre
   */
  isSlotAvailable(specialistId: string, dateStr: string, timeStr: string, ignoreAppointmentId?: string): boolean {
    const available = this.getAvailableSlots(specialistId, dateStr);
    if (available.includes(timeStr)) {
      return true;
    }
    // Se o próprio agendamento que está sendo editado já ocupava esse horário
    if (ignoreAppointmentId) {
      const current = this.getAppointment(ignoreAppointmentId);
      if (current && current.specialistId === specialistId && current.date === dateStr && current.startTime === timeStr) {
        return true;
      }
    }
    return false;
  }

  /**
   * Retorna vagas que foram canceladas e estão disponíveis para encaixe rápido
   */
  getEncaixes(agentId?: string): Appointment[] {
    const today = this.getTodayDateString();
    const tomorrow = this.getTomorrowDateString();

    return this.appointments.filter(a =>
      (a.date === today || a.date === tomorrow) &&
      (a.status === 'cancelled' || a.status === 'cancelled_by_patient') &&
      (!agentId || agentId === 'all' || a.agentId === agentId)
    ).sort((a, b) => a.startTime.localeCompare(b.startTime));
  }

  /**
   * Resumo de Métricas / KPIs para o Dashboard
   */
  getAppointmentsSummary(agentId?: string, targetDate?: string) {
    const date = targetDate || this.getTodayDateString();
    const list = this.listAppointments({ agentId, date });

    const total = list.length;
    const confirmed = list.filter(a => a.status === 'confirmed' || a.status === 'scheduled').length;
    const presenceConfirmed = list.filter(a => a.status === 'presence_confirmed').length;
    const waiting = list.filter(a => a.status === 'waiting').length;
    const inProgress = list.filter(a => a.status === 'in_progress').length;
    const completed = list.filter(a => a.status === 'completed').length;
    const cancelled = list.filter(a => a.status === 'cancelled' || a.status === 'cancelled_by_patient').length;
    const encaixes = this.getEncaixes(agentId).length;

    return {
      date,
      total,
      confirmed,
      presenceConfirmed,
      waiting,
      inProgress,
      completed,
      cancelled,
      encaixes
    };
  }

  // =========================================================================
  // AUXILIARES DE DATA E HORA (FUSO BRASIL)
  // =========================================================================

  getTodayDateString(): string {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(now); // "YYYY-MM-DD"
  }

  getTomorrowDateString(): string {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    });
    return formatter.format(d);
  }

  getDayOfWeekFromDate(dateStr: string): string {
    // Ex: "2026-09-08" -> "tuesday"
    const [y, m, d] = dateStr.split('-').map(Number);
    const date = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
    const day = date.getUTCDay();
    const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    return days[day];
  }

  getCurrentTimeMinutesInBrazil(): number {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });
    const parts = formatter.formatToParts(now);
    let h = 0;
    let m = 0;
    for (const p of parts) {
      if (p.type === 'hour') h = parseInt(p.value, 10);
      if (p.type === 'minute') m = parseInt(p.value, 10);
    }
    return h * 60 + m;
  }

  timeToMinutes(timeStr: string): number {
    const [h, m] = (timeStr || '00:00').split(':').map(Number);
    return (h || 0) * 60 + (m || 0);
  }

  minutesToTime(minutes: number): string {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  addMinutesToTime(timeStr: string, minutesToAdd: number): string {
    const total = this.timeToMinutes(timeStr) + minutesToAdd;
    return this.minutesToTime(total);
  }

  // =========================================================================
  // SEED DATA INICIAL
  // =========================================================================

  private getSeedSpecialists(): Specialist[] {
    return [
      {
        id: 'spec_carlos',
        agentId: '*',
        name: 'Dr. Carlos Medeiros',
        role: 'Clínico Geral & Cardiologista',
        phone: '5511999998888',
        email: 'carlos.medeiros@clinica.com.br',
        avatar: '👨‍⚕️',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        workHoursStart: '08:00',
        workHoursEnd: '18:00',
        breakStart: '12:00',
        breakEnd: '13:00',
        slotDurationMinutes: 30,
        serviceIds: ['srv_consulta_medica'],
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'spec_sofia',
        agentId: '*',
        name: 'Dra. Sofia Nogueira',
        role: 'Psicóloga Clínica (TCC)',
        phone: '5511988887777',
        email: 'sofia.psicologia@clinica.com.br',
        avatar: '👩‍⚕️',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
        workHoursStart: '09:00',
        workHoursEnd: '18:00',
        breakStart: '12:00',
        breakEnd: '13:00',
        slotDurationMinutes: 45,
        serviceIds: ['srv_psicoterapia'],
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'spec_mariana',
        agentId: '*',
        name: 'Dra. Mariana Santos',
        role: 'Cirurgiã-Dentista & Ortodontista',
        phone: '5511977776666',
        email: 'mariana.odonto@clinica.com.br',
        avatar: '🦷',
        workingDays: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'],
        workHoursStart: '08:30',
        workHoursEnd: '17:30',
        breakStart: '12:00',
        breakEnd: '13:00',
        slotDurationMinutes: 30,
        serviceIds: ['srv_avaliacao_odonto'],
        active: true,
        createdAt: new Date().toISOString()
      }
    ];
  }

  private getSeedServices(): ServiceItem[] {
    return [
      {
        id: 'srv_consulta_medica',
        agentId: '*',
        name: 'Consulta Médica Geral',
        description: 'Avaliação clínica completa, check-up e prescrição',
        durationMinutes: 30,
        price: 200,
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'srv_psicoterapia',
        agentId: '*',
        name: 'Sessão de Psicoterapia',
        description: 'Terapia Cognitivo-Comportamental individual',
        durationMinutes: 45,
        price: 180,
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'srv_avaliacao_odonto',
        agentId: '*',
        name: 'Avaliação Odontológica & Limpeza',
        description: 'Profilaxia dental, remoção de tártaro e raio-X preventivo',
        durationMinutes: 30,
        price: 150,
        active: true,
        createdAt: new Date().toISOString()
      }
    ];
  }

  private getSeedAppointments(): Appointment[] {
    const today = this.getTodayDateString();
    return [
      {
        id: 'apt_demo_1',
        agentId: '*',
        specialistId: 'spec_carlos',
        specialistName: 'Dr. Carlos Medeiros',
        specialistRole: 'Clínico Geral & Cardiologista',
        serviceId: 'srv_consulta_medica',
        serviceName: 'Consulta Médica Geral',
        clientChatId: '5511999990001@c.us',
        clientPhone: '(11) 99999-0001',
        clientName: 'Ana Beatriz Souza',
        date: today,
        startTime: '10:00',
        endTime: '10:30',
        status: 'confirmed',
        notes: 'Check-up de rotina',
        notifiedSpecialist: true,
        notifiedAt: new Date().toISOString(),
        reminderSent: true,
        bookedVia: 'whatsapp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      },
      {
        id: 'apt_demo_2',
        agentId: '*',
        specialistId: 'spec_sofia',
        specialistName: 'Dra. Sofia Nogueira',
        specialistRole: 'Psicóloga Clínica (TCC)',
        serviceId: 'srv_psicoterapia',
        serviceName: 'Sessão de Psicoterapia',
        clientChatId: '5511999990002@c.us',
        clientPhone: '(11) 99999-0002',
        clientName: 'Marcos Vinicius Lima',
        date: today,
        startTime: '14:30',
        endTime: '15:15',
        status: 'presence_confirmed',
        notes: 'Paciente confirmou presença pelo lembrete D-1',
        notifiedSpecialist: true,
        notifiedAt: new Date().toISOString(),
        reminderSent: true,
        bookedVia: 'whatsapp',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }
    ];
  }
}

export const appointmentManager = new AppointmentManager();
