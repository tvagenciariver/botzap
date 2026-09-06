export type UserRole = 'admin' | 'attendant';

export interface UserProfile {
  id: string;
  username: string;
  password?: string; // Omitido nas respostas públicas da API
  name: string;
  role: UserRole;
  assignedAgentId?: string; // '*' para todas as agendas ou ID de um agente/cliente específico
  active: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface UserSession {
  token: string;
  userId: string;
  username: string;
  name: string;
  role: UserRole;
  assignedAgentId?: string;
  createdAt: number;
}
