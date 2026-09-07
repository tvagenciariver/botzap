import { GoogleGenerativeAI } from '@google/generative-ai';
import axios from 'axios';
import { env, loadBotConfig } from '../config/index.js';
import { AgentProfile } from '../config/agent-types.js';

export class AudioTranscriber {
  /**
   * Limpa e padroniza o mimetype do áudio para compatibilidade com Gemini e Whisper
   */
  private sanitizeMimetype(mimetype: string): string {
    if (!mimetype) return 'audio/ogg';
    let clean = mimetype.split(';')[0].trim().toLowerCase();
    
    // Normalizações comuns para áudios do WhatsApp
    if (clean === 'audio/opus' || clean === 'audio/ogg; codecs=opus') return 'audio/ogg';
    if (clean === 'audio/x-m4a' || clean === 'audio/mp4') return 'audio/mp4';
    if (clean === 'audio/mpeg3' || clean === 'audio/x-mpeg-3') return 'audio/mpeg';
    if (clean === 'application/octet-stream') return 'audio/ogg';
    
    return clean;
  }

  /**
   * Limpa o texto transcrito removendo prefixos de alucinação comuns em LLMs
   */
  private cleanTranscriptionText(text: string): string {
    if (!text) return '';
    let cleaned = text.trim();

    // Remove aspas envolventes se houver
    if ((cleaned.startsWith('"') && cleaned.endsWith('"')) || (cleaned.startsWith("'") && cleaned.endsWith("'"))) {
      cleaned = cleaned.substring(1, cleaned.length - 1).trim();
    }

    // Remove prefixos indesejados
    const prefixesToRemove = [
      /^transcri[cç][aã]o(?:\s+do\s+[aá]udio)?\s*:\s*/i,
      /^[aá]udio\s+transcrito\s*:\s*/i,
      /^o\s+cliente\s+disse\s*:\s*/i,
      /^o\s+usu[aá]rio\s+falou\s*:\s*/i,
      /^aqui\s+est[aá]\s+a\s+transcri[cç][aã]o\s*:\s*/i,
      /^texto\s+falado\s*:\s*/i
    ];

    for (const regex of prefixesToRemove) {
      cleaned = cleaned.replace(regex, '').trim();
    }

    // Se o resultado for indicador de silêncio ou inaudível, trata como vazio
    if (cleaned.toLowerCase() === '[inaudível]' || 
        cleaned.toLowerCase() === '[inaudivel]' || 
        cleaned.toLowerCase() === '[sem áudio]' ||
        cleaned.toLowerCase() === '[silêncio]') {
      return '';
    }

    return cleaned;
  }

  /**
   * Transcreve áudio utilizando Google Gemini Multimodal
   */
  async transcribeWithGemini(
    audioBuffer: Buffer,
    mimetype: string,
    apiKey: string,
    preferredModel?: string
  ): Promise<string> {
    if (!apiKey || apiKey === 'sua_chave_gemini_aqui') {
      throw new Error('Chave de API do Gemini não configurada.');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const cleanMime = this.sanitizeMimetype(mimetype);
    const base64Audio = audioBuffer.toString('base64');

    const candidateModels = Array.from(new Set([
      preferredModel,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-flash-latest',
      'gemini-flash-lite-latest'
    ])).filter(Boolean) as string[];

    const prompt = `Você é um assistente especializado em transcrever áudios e mensagens de voz do WhatsApp em português do Brasil.
Sua tarefa é transcrever de forma estrita, precisa e fiel tudo o que foi falado no áudio enviado.

REGRAS OBRIGATÓRIAS:
1. Retorne EXCLUSIVAMENTE o texto que a pessoa falou.
2. NUNCA adicione introduções, explicações, saudações ou comentários (ex: NUNCA diga "Aqui está o que ele disse:" ou "Transcrição:").
3. NUNCA use aspas em volta da resposta.
4. Mantenha nomes de pessoas, números, termos médicos ou exames com exatidão conforme falados.
5. Se não houver fala discernível ou for apenas estática/ruído, responda apenas: [inaudível].`;

    let lastError: any = null;

    for (const modelName of candidateModels) {
      try {
        const model = genAI.getGenerativeModel({ model: modelName });
        const result = await model.generateContent([
          {
            inlineData: {
              data: base64Audio,
              mimeType: cleanMime
            }
          },
          { text: prompt }
        ]);

        const responseText = result.response.text();
        const cleaned = this.cleanTranscriptionText(responseText);
        if (cleaned) {
          return cleaned;
        }
      } catch (err: any) {
        lastError = err;
        console.warn(`[AudioTranscriber] Falha com modelo Gemini "${modelName}":`, err.message);
      }
    }

    throw lastError || new Error('Não foi possível transcrever o áudio com nenhum dos modelos Gemini testados.');
  }

  /**
   * Transcreve áudio utilizando OpenAI Whisper
   */
  async transcribeWithOpenAI(
    audioBuffer: Buffer,
    mimetype: string,
    apiKey: string
  ): Promise<string> {
    if (!apiKey || apiKey === 'sua_chave_openai_aqui') {
      throw new Error('Chave de API da OpenAI não configurada.');
    }

    const cleanMime = this.sanitizeMimetype(mimetype);
    let extension = 'ogg';
    if (cleanMime.includes('mp4')) extension = 'm4a';
    else if (cleanMime.includes('mpeg') || cleanMime.includes('mp3')) extension = 'mp3';
    else if (cleanMime.includes('wav')) extension = 'wav';

    const formData = new FormData();
    const blob = new Blob([new Uint8Array(audioBuffer)], { type: cleanMime });
    formData.append('file', blob, `voice_note.${extension}`);
    formData.append('model', 'whisper-1');
    formData.append('language', 'pt');
    formData.append('prompt', 'Mensagem de voz de WhatsApp para atendimento ao cliente.');

    const response = await axios.post(
      'https://api.openai.com/v1/audio/transcriptions',
      formData,
      {
        headers: {
          'Authorization': `Bearer ${apiKey.trim()}`
        },
        timeout: 35000
      }
    );

    const rawText = response.data?.text || '';
    return this.cleanTranscriptionText(rawText);
  }

  /**
   * Método principal de transcrição com seleção inteligente de provedor e fallback
   */
  async transcribe(
    audioBuffer: Buffer,
    mimetype: string,
    agent?: AgentProfile
  ): Promise<string> {
    const config = loadBotConfig();

    const geminiKey = (agent?.geminiApiKey && agent.geminiApiKey.trim() && agent.geminiApiKey !== 'sua_chave_gemini_aqui')
      ? agent.geminiApiKey.trim()
      : (env.geminiApiKey || config.geminiApiKey || '').trim();

    const openAIKey = (agent?.openaiApiKey && agent.openaiApiKey.trim() && agent.openaiApiKey !== 'sua_chave_openai_aqui')
      ? agent.openaiApiKey.trim()
      : (env.openaiApiKey || config.openaiApiKey || '').trim();

    const preferredProvider = agent?.llmProvider || config.llmProvider || env.llmProvider || 'gemini';

    // 1. Tenta o provedor preferencial
    if (preferredProvider === 'gemini' && geminiKey && geminiKey !== 'sua_chave_gemini_aqui') {
      try {
        const text = await this.transcribeWithGemini(audioBuffer, mimetype, geminiKey, agent?.model);
        if (text) return text;
      } catch (err: any) {
        console.warn('[AudioTranscriber] Falha na transcrição Gemini primária:', err.message);
      }
    } else if (preferredProvider === 'openai' && openAIKey && openAIKey !== 'sua_chave_openai_aqui') {
      try {
        const text = await this.transcribeWithOpenAI(audioBuffer, mimetype, openAIKey);
        if (text) return text;
      } catch (err: any) {
        console.warn('[AudioTranscriber] Falha na transcrição OpenAI primária:', err.message);
      }
    }

    // 2. Fallback secundário cruzado
    if (geminiKey && geminiKey !== 'sua_chave_gemini_aqui') {
      try {
        console.log('[AudioTranscriber] Tentando fallback para Google Gemini...');
        const text = await this.transcribeWithGemini(audioBuffer, mimetype, geminiKey, agent?.model);
        if (text) return text;
      } catch (err: any) {
        console.warn('[AudioTranscriber] Fallback Gemini também falhou:', err.message);
      }
    }

    if (openAIKey && openAIKey !== 'sua_chave_openai_aqui') {
      try {
        console.log('[AudioTranscriber] Tentando fallback para OpenAI Whisper...');
        const text = await this.transcribeWithOpenAI(audioBuffer, mimetype, openAIKey);
        if (text) return text;
      } catch (err: any) {
        console.warn('[AudioTranscriber] Fallback OpenAI Whisper também falhou:', err.message);
      }
    }

    throw new Error('Nenhum provedor de IA disponível conseguiu transcrever o áudio. Verifique as chaves do Gemini ou OpenAI.');
  }
}

export const audioTranscriber = new AudioTranscriber();
