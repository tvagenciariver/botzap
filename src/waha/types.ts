export interface WahaMedia {
  url?: string | null;
  mimetype?: string;
  filename?: string | null;
  error?: string | null;
}

export interface WahaMessagePayload {
  id: string;
  timestamp: number;
  from: string;
  to: string;
  fromMe: boolean;
  body: string;
  hasMedia: boolean;
  media?: WahaMedia | null;
  ack?: number;
  replyTo?: {
    id?: string;
    participant?: string;
    body?: string;
  };
  author?: string;
  participant?: string;
  senderPn?: string;
  key?: any;
  _data?: any;
  [key: string]: any;
}

export interface WahaWebhookEvent {
  id?: string;
  timestamp?: number;
  event: string;
  session: string;
  metadata?: Record<string, any>;
  payload: WahaMessagePayload;
}

export interface WahaSendTextRequest {
  session?: string;
  chatId: string;
  text: string;
  reply_to?: string;
  linkPreview?: boolean;
}

export interface WahaSessionStatus {
  name: string;
  status: 'STARTING' | 'SCAN_QR_CODE' | 'WORKING' | 'FAILED' | 'STOPPED' | string;
  config?: any;
  me?: {
    id: string;
    pushName?: string;
  };
}
