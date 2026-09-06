import { AgentProfile } from '../../config/agent-types.js';

export interface AgentContext {
  chatId: string;
  userMessage: string;
  contactName?: string;
  session: string;
  agent?: AgentProfile;
  metadata?: Record<string, any>;
}

export interface AgentResponse {
  handled: boolean;
  replyText?: string;
  action?: 'none' | 'paused_bot' | 'transferred_human';
  agentName: string;
}

export interface IAgent {
  name: string;
  description: string;
  canHandle(context: AgentContext): boolean | Promise<boolean>;
  execute(context: AgentContext): Promise<AgentResponse>;
}
