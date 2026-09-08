import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { UserProfile, UserSession, AppModule } from './user-types.js';
import { loadBotConfig, env } from '../config/index.js';

export class UserManager {
  private usersFile: string;
  private users: UserProfile[] = [];
  private sessions: Map<string, UserSession> = new Map();

  constructor() {
    const dataDir = path.resolve(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    this.usersFile = path.join(dataDir, 'users.json');
    this.loadUsers();
  }

  private loadUsers(): void {
    if (fs.existsSync(this.usersFile)) {
      try {
        const raw = fs.readFileSync(this.usersFile, 'utf-8');
        this.users = JSON.parse(raw);
      } catch (err) {
        console.error('[UserManager] Erro ao carregar users.json:', err);
        this.users = [];
      }
    }

    // Se não houver usuários cadastrados, inicializa com Admin e Atendente padrão
    if (this.users.length === 0) {
      this.users = this.getSeedUsers();
      this.saveUsers();
    } else {
      // Garante que o admin default esteja sincronizado com as configurações de env/config
      const config = loadBotConfig();
      const adminUser = config.adminUser || env.adminUser || 'admin';
      const adminPass = config.adminPassword || env.adminPassword || 'File@152341';

      const existingAdmin = this.users.find(u => u.username === adminUser);
      if (existingAdmin) {
        if (!existingAdmin.password) {
          existingAdmin.password = adminPass;
          this.saveUsers();
        }
      }
    }
  }

  private saveUsers(): void {
    try {
      fs.writeFileSync(this.usersFile, JSON.stringify(this.users, null, 2), 'utf-8');
    } catch (err) {
      console.error('[UserManager] Falha ao salvar users.json:', err);
    }
  }

  private getSeedUsers(): UserProfile[] {
    const config = loadBotConfig();
    const adminUser = config.adminUser || env.adminUser || 'admin';
    const adminPass = config.adminPassword || env.adminPassword || 'File@152341';

    return [
      {
        id: 'user_admin',
        username: adminUser,
        password: adminPass,
        name: 'Administrador Geral',
        role: 'admin',
        assignedAgentId: '*',
        allowedModules: ['appointments', 'exams', 'chats', 'simulator'],
        active: true,
        createdAt: new Date().toISOString()
      },
      {
        id: 'user_atendimento',
        username: 'atendimento',
        password: 'atendimento123',
        name: 'Recepção / Atendimento',
        role: 'attendant',
        assignedAgentId: '*',
        allowedModules: ['appointments', 'exams', 'chats', 'simulator'],
        active: true,
        createdAt: new Date().toISOString()
      }
    ];
  }

  /**
   * Lista usuários omitindo a senha
   */
  listUsers(): Omit<UserProfile, 'password'>[] {
    return this.users.map(u => {
      const { password, ...safe } = u;
      return safe;
    });
  }

  getUser(id: string): UserProfile | undefined {
    return this.users.find(u => u.id === id);
  }

  getUserByUsername(username: string): UserProfile | undefined {
    return this.users.find(u => u.username.toLowerCase() === username.toLowerCase().trim());
  }

  createUser(data: {
    username: string;
    password: string;
    name: string;
    role: 'admin' | 'attendant';
    assignedAgentId?: string;
    allowedModules?: AppModule[];
  }): Omit<UserProfile, 'password'> {
    const cleanUsername = data.username.toLowerCase().trim();

    if (this.getUserByUsername(cleanUsername)) {
      throw new Error(`O usuário "${cleanUsername}" já está cadastrado.`);
    }

    if (!data.password || data.password.length < 4) {
      throw new Error('A senha deve ter no mínimo 4 caracteres.');
    }

    const defaultModules: AppModule[] = ['appointments', 'exams', 'chats', 'simulator'];

    const newUser: UserProfile = {
      id: 'usr_' + Math.random().toString(36).substring(2, 9),
      username: cleanUsername,
      password: data.password,
      name: data.name.trim(),
      role: data.role || 'attendant',
      assignedAgentId: data.assignedAgentId || '*',
      allowedModules: Array.isArray(data.allowedModules) && data.allowedModules.length > 0
        ? data.allowedModules
        : (data.role === 'admin' ? defaultModules : ['appointments']),
      active: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    this.users.push(newUser);
    this.saveUsers();

    const { password, ...safe } = newUser;
    return safe;
  }

  updateUser(id: string, updates: Partial<UserProfile>): Omit<UserProfile, 'password'> {
    const idx = this.users.findIndex(u => u.id === id);
    if (idx === -1) {
      throw new Error(`Usuário não encontrado.`);
    }

    const current = this.users[idx];

    // Se alterou username, verifica duplicidade
    if (updates.username && updates.username.toLowerCase().trim() !== current.username.toLowerCase()) {
      const exists = this.getUserByUsername(updates.username);
      if (exists && exists.id !== id) {
        throw new Error(`O nome de usuário "${updates.username}" já está em uso.`);
      }
    }

    const updatedUser: UserProfile = {
      ...current,
      ...updates,
      id, // Imutável
      updatedAt: new Date().toISOString()
    };

    if (updates.allowedModules) {
      updatedUser.allowedModules = updates.allowedModules;
    }

    // Só altera senha se tiver sido enviada e preenchida
    if (!updates.password || !updates.password.trim()) {
      updatedUser.password = current.password;
    }

    this.users[idx] = updatedUser;
    this.saveUsers();

    const { password, ...safe } = updatedUser;
    return safe;
  }

  deleteUser(id: string): boolean {
    const user = this.getUser(id);
    if (!user) return false;

    // Impede a exclusão caso seja o único admin ativo
    if (user.role === 'admin') {
      const activeAdmins = this.users.filter(u => u.role === 'admin' && u.active && u.id !== id);
      if (activeAdmins.length === 0) {
        throw new Error('Não é possível excluir o único administrador ativo do sistema.');
      }
    }

    const initialLen = this.users.length;
    this.users = this.users.filter(u => u.id !== id);
    if (this.users.length !== initialLen) {
      this.saveUsers();
      return true;
    }
    return false;
  }

  // =========================================================================
  // GESTÃO DE SESSÕES & AUTENTICAÇÃO
  // =========================================================================

  validateLogin(username: string, pass: string): UserSession | null {
    const user = this.getUserByUsername(username);
    if (!user || !user.active) return null;

    if (user.password !== pass) {
      return null;
    }

    const token = crypto.randomBytes(32).toString('hex');
    const defaultModules: AppModule[] = ['appointments', 'exams', 'chats', 'simulator'];
    const session: UserSession = {
      token,
      userId: user.id,
      username: user.username,
      name: user.name,
      role: user.role,
      assignedAgentId: user.assignedAgentId || '*',
      allowedModules: Array.isArray(user.allowedModules) && user.allowedModules.length > 0
        ? user.allowedModules
        : (user.role === 'admin' ? defaultModules : ['appointments', 'exams', 'chats', 'simulator']),
      createdAt: Date.now()
    };

    this.sessions.set(token, session);
    return session;
  }

  getSession(token: string): UserSession | undefined {
    return this.sessions.get(token);
  }

  deleteSession(token: string): boolean {
    return this.sessions.delete(token);
  }
}

export const userManager = new UserManager();
