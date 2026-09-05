# 🤖 BotZap: Orquestrador de Agentes IA (WAHA API + Google Gemini Flash + Chatwoot)

Sistema inteligente de orquestração de atendimento para WhatsApp utilizando a **WAHA API (WhatsApp HTTP API)** e **Google Gemini Flash**, com suporte completo à coexistência com o **Chatwoot** e transbordo para atendentes humanos.

---

## 🌟 Principais Recursos

- **⚡ Google Gemini Flash (2.0 / 1.5)**: Atendimento ultra-rápido com latência na casa de milissegundos e baixo custo.
- **🛡️ Anti-Loop & Coexistência com Chatwoot**:
  - Filtra automaticamente mensagens do próprio número (`fromMe: true`).
  - Quando um atendente humano responde no Chatwoot ou no celular, o bot é **pausado automaticamente** para aquele contato durante o período configurado (ex: 60 minutos), evitando que a IA responda por cima do atendente.
- **⏱️ Buffer Inteligente (Debounce)**:
  - Clientes no WhatsApp costumam enviar mensagens picadas ("Oi" -> "tudo bem?" -> "gostaria de saber o preço"). O orquestrador aguarda uma janela de 2,5 segundos para unificar as frases em um único prompt antes de chamar o Gemini.
- **👤 Agente de Transbordo Humano (Handoff)**:
  - Detecta quando o cliente solicita um atendente humano, envia mensagem amigável de transferência e pausa o bot para aquele cliente.
- **💬 Simulador de Atendimento Integrado**:
  - Teste as respostas do Gemini Flash diretamente pelo navegador antes de colocar em produção.
- **⚙️ Painel Web para Edição Dinâmica**:
  - Altere System Prompts, Tom de Voz, Informações da Empresa, Horários de Funcionamento e Modelos sem precisar reiniciar o servidor.
- **✨ Humanização WhatsApp**:
  - Simula digitação (`startTyping`) e confirmação de leitura (`sendSeen`).

---

## 📁 Estrutura do Projeto

```
botzap/
├── data/
│   └── bot_config.json          # Prompts, regras de negócio e configurações editáveis
├── src/
│   ├── config/                  # Variáveis de ambiente e carregador de configurações
│   ├── gemini/
│   │   ├── client.ts            # Integração com o Google Gemini Flash SDK
│   │   └── memory.ts            # Memória conversacional deslizante por chatId
│   ├── waha/
│   │   ├── client.ts            # Cliente HTTP para WAHA (sendText, seen, typing)
│   │   └── types.ts             # Tipagens de eventos da WAHA
│   ├── orchestrator/
│   │   ├── debouncer.ts         # Buffer de mensagens rápidas consecutivas
│   │   ├── engine.ts            # Pipeline do orquestrador e logs
│   │   └── agents/
│   │       ├── base.ts          # Interface base de agentes
│   │       ├── attendant.ts     # Agente de atendimento Gemini Flash
│   │       └── handoff.ts       # Agente de transbordo humano
│   ├── web/
│   │   ├── routes.ts            # Webhooks da WAHA/Chatwoot e APIs REST
│   │   └── public/              # Painel Web interativo (Simulador, Prompts, Logs)
│   └── index.ts                 # Ponto de entrada do servidor Express
├── test/
│   └── simulator.ts             # Testes de integração e simulação
├── docker-compose.yml           # Subida conjunta do WAHA + BotZap
└── Dockerfile                   # Imagem de produção
```

---

## 🚀 Como Iniciar

### 1. Pré-requisitos
- Node.js 20+ ou 22+ instalado
- Uma instância da **WAHA** rodando (local via Docker ou em servidor remoto)
- Chave de API do Google Gemini (gratuita em [Google AI Studio](https://aistudio.google.com/app/apikey))

### 2. Instalação e Execução Local

```bash
# 1. Instalar dependências
npm install

# 2. Configurar o arquivo de ambiente
cp .env.example .env

# 3. Iniciar em modo de desenvolvimento
npm run dev
```

O servidor iniciará em:
- **Painel Web**: [http://localhost:3001](http://localhost:3001)
- **Endpoint do Webhook WAHA**: `http://localhost:3001/webhook/waha`
- **Endpoint do Webhook Chatwoot (opcional)**: `http://localhost:3001/webhook/chatwoot`

---

## 🔗 Conectando com a WAHA API

### Opção 1: Pelo Painel Web do BotZap (1 Clique)
1. Abra o painel em [http://localhost:3001](http://localhost:3001).
2. Vá na aba **"Conectar WAHA / Chatwoot"**.
3. Confirme a URL do webhook e clique em **"🚀 Registrar Webhook na WAHA"**.

### Opção 2: Pelo `docker-compose.yml` da WAHA
Se você já roda a WAHA via Docker, basta adicionar ou ajustar a variável de ambiente:

```yaml
environment:
  - WHATSAPP_HOOK_URL=http://botzap:3001/webhook/waha
  - WHATSAPP_HOOK_EVENTS=message
```

---

## 💬 Integração com o Chatwoot

Como você já usa o Chatwoot integrado com a WAHA:
1. A WAHA recebe a mensagem do WhatsApp e entrega normalmente para o **Chatwoot**.
2. A WAHA envia o evento `message` para o **BotZap**.
3. O BotZap processa via **Gemini Flash** e responde enviando `POST /api/sendText` para a WAHA.
4. Como a WAHA está conectada ao Chatwoot, a mensagem do bot aparece no Chatwoot como resposta enviada.
5. Se um **atendente humano responder** no Chatwoot, a WAHA envia o evento com `fromMe: true`. O BotZap detecta isso automaticamente e **pausa o bot** para aquele cliente pelo tempo configurado (ex: 60 minutos), permitindo que o humano continue a conversa normalmente.

---

## 🧪 Execução de Testes

Para rodar os testes de simulação e validação do orquestrador:

```bash
npm test
```
