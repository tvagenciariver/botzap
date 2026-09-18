export type BillingMethod = 'boleto' | 'pix' | 'ambos';
export type PixKeyType = 'cpf' | 'cnpj' | 'telefone' | 'email' | 'aleatoria';
export type BillingSendStatus = 'pendente' | 'agendado' | 'enviado' | 'falha';
export type BillingPaymentStatus = 'pendente' | 'aguardando_confirmacao' | 'pago' | 'cancelado';

export interface BillingCharge {
  id: string;
  agentId: string;
  customerId?: string;
  customerName: string;
  customerPhone: string;
  customerChatId: string;
  serviceType: string;
  serviceDescription?: string;
  amount: number;
  dueDate: string; // YYYY-MM-DD
  billingMethod: BillingMethod;

  // Dados de Boleto (quando aplicável)
  pdfFileName?: string;
  pdfFilePath?: string;
  pdfUrl?: string; // /uploads/billing/boletos/...

  // Dados de PIX (quando aplicável)
  pixKey?: string;
  pixKeyType?: PixKeyType;
  pixCopiaECola?: string; // BR Code
  pixQrCodeFileName?: string;
  pixQrCodeFilePath?: string;
  pixQrCodeUrl?: string; // /uploads/billing/qrcodes/...

  // Status e Automação
  statusEnvio: BillingSendStatus;
  statusPagamento: BillingPaymentStatus;
  sendImmediately: boolean;
  scheduledSendAt?: string; // YYYY-MM-DDTHH:mm:ss (Data e Hora do Agendamento)
  customMessageTemplate?: string;
  lastSentAt?: string;
  sendAttempts: number;

  // Comprovante Recebido
  comprovanteUrl?: string;
  comprovanteReceivedAt?: string;
  comprovanteNote?: string;

  // Baixa / Pagamento
  paidAt?: string;
  paidMethod?: 'automatico' | 'manual' | string;
  paidBy?: string;
  notes?: string;

  // Recorrência / Assinatura / Mensalidade
  isRecurring?: boolean;
  recurrenceGroupId?: string;
  installmentNumber?: number;
  totalInstallments?: number;

  createdAt: string;
  updatedAt: string;
}

export interface BillingLog {
  id: string;
  billingId: string;
  agentId: string;
  customerName: string;
  customerPhone: string;
  type: 
    | 'envio_inicial'
    | 'envio_agendado'
    | 'regua_recorrente'
    | 'reenvio_manual'
    | 'comprovante_recebido'
    | 'confirmacao_cliente'
    | 'baixa_manual'
    | 'cancelamento'
    | 'erro_envio';
  status: 'sucesso' | 'falha' | 'info';
  message: string;
  details?: any;
  timestamp: string;
}

export interface BillingStats {
  totalCount: number;
  totalAmount: number;
  receivedCount: number;
  receivedAmount: number;
  awaitingConfirmationCount: number;
  awaitingConfirmationAmount: number;
  overdueCount: number;
  overdueAmount: number;
}

export interface BillingSchedulerConfig {
  enabled: boolean;
  targetTime: string; // HH:MM (padrão '09:00')
  overdueDaysThreshold: number; // padrão 3 dias
  timezone: string; // padrão 'America/Sao_Paulo'
  reminderTemplateBoleto?: string;
  reminderTemplatePix?: string;
  lastRunDate?: string;
  lastRunSummary?: {
    dispatched: number;
    totalEligible: number;
    timestamp: string;
    trigger: 'auto' | 'manual';
    error?: string;
  };
}

export interface RentalPropertyInfo {
  propertyCode?: string; // ex: 'APT-102', 'CASA-04', 'SALA-301'
  propertyAddress: string; // Endereço Completo
  propertyType?: string; // Apartamento, Casa, Sala Comercial, etc.
  rentAmount?: number; // Valor Padrão do Aluguel
  dueDay?: number; // Dia de Vencimento Mensal (1 a 31)
  notes?: string; // Observações do Contrato / Imóvel
}

export interface BillingCustomer {
  id: string;
  agentId: string;
  name: string;
  phone: string;
  chatId: string;
  document?: string; // CPF / CNPJ
  email?: string;
  notes?: string;
  
  // Imóvel / Aluguel
  isRentalCustomer: boolean;
  rentalInfo?: RentalPropertyInfo;

  createdAt: string;
  updatedAt: string;
}

export interface CreateCustomerDTO {
  agentId?: string;
  name: string;
  phone: string;
  document?: string;
  email?: string;
  notes?: string;
  isRentalCustomer?: boolean;
  rentalInfo?: RentalPropertyInfo;
}

export interface UpdateCustomerDTO {
  agentId?: string;
  name?: string;
  phone?: string;
  document?: string;
  email?: string;
  notes?: string;
  isRentalCustomer?: boolean;
  rentalInfo?: RentalPropertyInfo;
}

export interface CustomerFilter {
  agentId?: string;
  isRentalCustomer?: boolean;
  search?: string;
}

export interface CreateBillingDTO {
  agentId?: string;
  customerId?: string;
  saveCustomer?: boolean;
  customerName: string;
  customerPhone: string;
  serviceType: string;
  serviceDescription?: string;
  amount: number;
  dueDate: string;
  billingMethod: BillingMethod;

  // Boleto
  pdfBase64?: string;
  pdfFileName?: string;

  // PIX
  pixKey?: string;
  pixKeyType?: PixKeyType;
  pixCopiaECola?: string;
  pixQrCodeBase64?: string;
  pixQrCodeFileName?: string;

  sendOption?: 'immediate' | 'scheduled' | 'manual';
  scheduledSendAt?: string; // YYYY-MM-DDTHH:mm ou ISO string
  sendImmediately?: boolean;
  customMessageTemplate?: string;
  notes?: string;

  // Recorrência / Mensalidade / Aluguel
  isRecurring?: boolean;
  recurrenceMonths?: number; // Qtd de meses (ex: 2 a 60)
  firstPaymentDate?: string; // YYYY-MM-DD (Data do 1º pagamento/vencimento)
}

export interface BillingFilter {
  agentId?: string;
  statusEnvio?: BillingSendStatus;
  statusPagamento?: BillingPaymentStatus;
  billingMethod?: BillingMethod;
  quickFilter?: 'all' | 'sent_initial' | 'scheduled' | 'not_confirmed' | 'awaiting_confirmation' | 'paid' | 'overdue';
  search?: string;
  startDate?: string;
  endDate?: string;
}
