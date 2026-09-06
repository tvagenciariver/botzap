export type AppointmentStatus = 
  | 'scheduled'            // Agendado inicialmente
  | 'confirmed'            // Confirmado
  | 'presence_confirmed'   // Presença confirmada pelo paciente no lembrete D-1
  | 'waiting'              // Paciente chegou / Na sala de espera
  | 'in_progress'          // Em atendimento pelo especialista
  | 'completed'            // Atendimento finalizado
  | 'cancelled'            // Cancelado pela clínica / especialista
  | 'cancelled_by_patient';// Desistência informada pelo paciente (vaga liberada para encaixe)

export interface Specialist {
  id: string;
  agentId: string; // Vinculado a um agente/empresa específica
  name: string;
  role: string; // Ex: "Cirurgião-Dentista", "Psicólogo Clínico", "Clínico Geral"
  phone: string; // WhatsApp para receber notificações instantâneas
  email?: string;
  avatar?: string;
  workingDays: string[]; // ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]
  workHoursStart: string; // "08:00"
  workHoursEnd: string; // "18:00"
  breakStart?: string; // "12:00"
  breakEnd?: string; // "13:00"
  slotDurationMinutes: number; // Ex: 30, 45, 60
  serviceIds: string[];
  active: boolean;
  createdAt: string;
}

export interface ServiceItem {
  id: string;
  agentId: string;
  name: string;
  description?: string;
  durationMinutes: number;
  price?: number;
  active: boolean;
  createdAt: string;
}

export interface Appointment {
  id: string;
  agentId: string;
  specialistId: string;
  specialistName: string;
  specialistRole: string;
  serviceId?: string;
  serviceName: string;

  clientChatId: string; // Ex: "5511987654321@c.us"
  clientPhone: string;
  clientName: string;

  date: string; // "YYYY-MM-DD"
  startTime: string; // "14:00"
  endTime: string; // "14:30"

  status: AppointmentStatus;
  notes?: string;

  notifiedSpecialist: boolean;
  notifiedAt?: string;

  reminderSent: boolean;
  reminderSentAt?: string;

  bookedVia: 'whatsapp' | 'manual' | 'simulator';
  createdAt: string;
  updatedAt: string;
}

export interface BookingSession {
  chatId: string;
  agentId: string;
  step: 'select_specialist' | 'select_date' | 'select_slot' | 'confirm_name' | 'cancel_select';
  specialistId?: string;
  specialistName?: string;
  serviceId?: string;
  serviceName?: string;
  date?: string; // "YYYY-MM-DD"
  availableSlots?: string[];
  selectedSlot?: string;
  patientName?: string;
  activeAppointments?: Appointment[];
  lastInteraction: number;
}
