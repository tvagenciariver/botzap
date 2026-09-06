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

  // Informações de Parceria / Encaminhamento
  referralType?: 'particular' | 'partner';
  partnerId?: string;
  partnerName?: string;

  notifiedSpecialist: boolean;
  notifiedAt?: string;

  reminderSent: boolean;
  reminderSentAt?: string;

  bookedVia: 'whatsapp' | 'manual' | 'simulator';
  createdAt: string;
  updatedAt: string;
}

export interface Partner {
  id: string;
  agentId: string; // ID da unidade/agente ou '*' para todas
  name: string; // Nome da Empresa Parceira ou Clínica
  document?: string; // CNPJ ou CPF
  phone: string; // WhatsApp para notificações e envio de exames
  contactPerson?: string; // Responsável ou contato principal
  email?: string;
  notes?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type ExamDispatchTarget = 'patient' | 'partner' | 'both';

export interface ExamDispatchAttempt {
  target: 'patient' | 'partner';
  recipientName: string;
  chatId: string;
  phone: string;
  success: boolean;
  error?: string;
  messageId?: string;
  sentAt: string;
}

export interface ExamDispatch {
  id: string;
  agentId: string;
  appointmentId?: string; // Opcional, se vinculado a agendamento
  patientName: string;
  patientPhone: string;
  patientChatId: string;
  referralType: 'particular' | 'partner';
  partnerId?: string;
  partnerName?: string;
  partnerPhone?: string;
  target: ExamDispatchTarget;
  fileName: string;
  originalName: string;
  fileStoredPath: string; // Caminho no disco do servidor
  fileMimeType: string;
  fileSize: number; // Em bytes
  caption: string;
  status: 'sent' | 'partial' | 'failed';
  sentBy: string; // Nome ou username do operador
  sentAt: string;
  attempts: ExamDispatchAttempt[];
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
