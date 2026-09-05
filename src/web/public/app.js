// Estado Global
let currentChatId = 'simulador_' + Math.random().toString(36).substring(2, 7) + '@c.us';

// Utilitário para formatar texto estilo WhatsApp
function formatWhatsAppText(text) {
  if (!text) return '';
  return text
    .replace(/\*(.*?)\*/g, '<strong>$1</strong>')
    .replace(/_(.*?)_/g, '<em>$1</em>')
    .replace(/~(.*?)~/g, '<del>$1</del>')
    .replace(/```(.*?)```/gs, '<code>$1</code>')
    .replace(/\n/g, '<br>');
}

// Navegação por Abas
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const targetTab = btn.getAttribute('data-tab');
    document.getElementById(`pane-${targetTab}`).classList.add('active');

    const titles = {
      simulator: 'Simulador de Atendimento (WhatsApp)',
      prompts: 'Configuração do Agente & Prompts',
      chats: 'Conversas Ativas & Pausa do Bot',
      logs: 'Logs em Tempo Real do Orquestrador',
      integration: 'Integração WAHA API & Chatwoot'
    };
    document.getElementById('page-title').textContent = titles[targetTab] || 'BotZap';

    if (targetTab === 'chats') loadChats();
    if (targetTab === 'logs') loadLogs();
    if (targetTab === 'prompts') loadConfig();
  });
});

// 1. Checar Status
async function checkStatus() {
  try {
    const res = await fetch('/api/status');
    const data = await res.json();

    // WAHA Status
    const wahaDot = document.getElementById('dot-waha');
    const wahaText = document.getElementById('status-waha');
    if (data.waha.online) {
      wahaDot.className = 'status-dot online';
      wahaText.textContent = data.waha.status || 'Conectada';
      wahaText.className = 'status-val text-green';
    } else {
      wahaDot.className = 'status-dot offline';
      wahaText.textContent = 'Desconectada';
      wahaText.className = 'status-val text-red';
    }

    // Gemini Status
    const geminiDot = document.getElementById('dot-gemini');
    const geminiText = document.getElementById('status-gemini');
    if (data.gemini.configured) {
      geminiDot.className = 'status-dot online';
      geminiText.textContent = 'Configurado ✅';
      geminiText.className = 'status-val text-green';
    } else {
      geminiDot.className = 'status-dot offline';
      geminiText.textContent = 'Chave Pendente ⚠️';
      geminiText.className = 'status-val text-orange';
    }
  } catch (err) {
    console.error('Erro ao checar status:', err);
  }
}

document.getElementById('btn-refresh-status').addEventListener('click', checkStatus);

// 2. Simulador de Chat
const chatMessages = document.getElementById('chat-messages');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');

function appendMessage(text, isOutgoing, isHandoff = false) {
  const msgDiv = document.createElement('div');
  msgDiv.className = `message ${isOutgoing ? 'outgoing' : 'incoming'}`;
  
  const bubble = document.createElement('div');
  bubble.className = 'message-bubble';
  if (isHandoff) {
    bubble.style.backgroundColor = '#b45309';
  }
  bubble.innerHTML = formatWhatsAppText(text);

  const time = document.createElement('span');
  time.className = 'message-time';
  time.textContent = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

  msgDiv.appendChild(bubble);
  msgDiv.appendChild(time);
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  return msgDiv;
}

chatForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const text = chatInput.value.trim();
  if (!text) return;

  chatInput.value = '';

  // Adiciona mensagem do cliente (usuário)
  appendMessage(text, true);

  // Adiciona indicador visual de digitando...
  const typingMsg = document.createElement('div');
  typingMsg.className = 'message incoming';
  typingMsg.id = 'typing-indicator';
  typingMsg.innerHTML = `
    <div class="message-bubble" style="color: #94a3b8; font-style: italic;">
      Digitando resposta... 💭
    </div>
  `;
  chatMessages.appendChild(typingMsg);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const res = await fetch('/api/simulate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chatId: currentChatId,
        message: text
      })
    });

    const data = await res.json();
    typingMsg.remove();

    if (data.replyText) {
      appendMessage(data.replyText, false, data.action === 'transferred_human');
    } else if (data.error) {
      appendMessage(`⚠️ Erro: ${data.error}`, false);
    }
  } catch (err) {
    typingMsg.remove();
    appendMessage(`⚠️ Erro ao comunicar com servidor: ${err.message}`, false);
  }
});

document.getElementById('btn-clear-chat').addEventListener('click', () => {
  chatMessages.innerHTML = '';
  currentChatId = 'simulador_' + Math.random().toString(36).substring(2, 7) + '@c.us';
  appendMessage('Conversa limpa! Nova sessão de simulação iniciada. Como posso ajudar você hoje?', false);
});

// 3. Configurações & Prompts
async function loadConfig() {
  try {
    const res = await fetch('/api/config');
    const data = await res.json();
    const cfg = data.config;

    document.getElementById('cfg-botName').value = cfg.botName || '';
    document.getElementById('cfg-companyName').value = cfg.companyName || '';
    document.getElementById('cfg-model').value = cfg.model || 'gemini-2.0-flash';
    document.getElementById('cfg-temperature').value = cfg.temperature ?? 0.4;
    document.getElementById('cfg-systemInstruction').value = cfg.systemInstruction || '';
    document.getElementById('cfg-businessInfo').value = cfg.businessInfo || '';
    document.getElementById('cfg-handoffKeywords').value = (cfg.handoffKeywords || []).join(', ');
    document.getElementById('cfg-handoffMessage').value = cfg.handoffMessage || '';
    document.getElementById('cfg-debounce').value = cfg.debounceSeconds ?? 2.5;
    const pauseHours = cfg.pauseDurationHours || (cfg.pauseDurationMinutes ? cfg.pauseDurationMinutes / 60 : 6);
    document.getElementById('cfg-pauseDurationHours').value = pauseHours;
    document.getElementById('cfg-typing').checked = cfg.enableTypingSimulation !== false;
    document.getElementById('cfg-seen').checked = cfg.enableSendSeen !== false;

    document.getElementById('sim-bot-name').textContent = cfg.botName || 'Assistente Virtual';
  } catch (err) {
    console.error('Erro ao carregar configurações:', err);
  }
}

document.getElementById('config-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const feedback = document.getElementById('save-feedback');
  feedback.textContent = 'Salvando...';
  feedback.className = 'feedback-msg text-orange';

  const keywordsRaw = document.getElementById('cfg-handoffKeywords').value;
  const handoffKeywords = keywordsRaw.split(',').map(k => k.trim()).filter(k => k.length > 0);
  const pauseHours = parseFloat(document.getElementById('cfg-pauseDurationHours').value) || 6;

  const payload = {
    botName: document.getElementById('cfg-botName').value,
    companyName: document.getElementById('cfg-companyName').value,
    model: document.getElementById('cfg-model').value,
    temperature: parseFloat(document.getElementById('cfg-temperature').value),
    systemInstruction: document.getElementById('cfg-systemInstruction').value,
    businessInfo: document.getElementById('cfg-businessInfo').value,
    handoffKeywords,
    handoffMessage: document.getElementById('cfg-handoffMessage').value,
    debounceSeconds: parseFloat(document.getElementById('cfg-debounce').value),
    pauseDurationHours: pauseHours,
    pauseDurationMinutes: Math.round(pauseHours * 60),
    enableTypingSimulation: document.getElementById('cfg-typing').checked,
    enableSendSeen: document.getElementById('cfg-seen').checked,
    apiKey: document.getElementById('cfg-apiKey').value
  };

  try {
    const res = await fetch('/api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (data.success) {
      feedback.textContent = '✅ Configurações salvas com sucesso!';
      feedback.className = 'feedback-msg text-green';
      document.getElementById('cfg-apiKey').value = '';
      checkStatus();
      setTimeout(() => { feedback.textContent = ''; }, 3000);
    } else {
      feedback.textContent = `❌ Erro: ${data.error}`;
      feedback.className = 'feedback-msg text-red';
    }
  } catch (err) {
    feedback.textContent = `❌ Erro ao salvar: ${err.message}`;
    feedback.className = 'feedback-msg text-red';
  }
});

// 4. Conversas Ativas & Pausa
async function loadChats() {
  const tbody = document.getElementById('chats-tbody');
  try {
    const res = await fetch('/api/chats');
    const data = await res.json();

    if (!data.chats || data.chats.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">Nenhuma conversa registrada ainda.</td></tr>';
      return;
    }

    tbody.innerHTML = data.chats.map(chat => {
      const isPaused = chat.isPaused;
      let remainingText = '';
      if (isPaused && chat.pausedUntil) {
        const diffMs = chat.pausedUntil - Date.now();
        if (diffMs > 0) {
          const h = Math.floor(diffMs / (1000 * 60 * 60));
          const m = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
          remainingText = ` (${h}h ${m}m restantes)`;
        }
      }

      const statusBadge = isPaused
        ? `<span class="badge badge-paused">⏸️ Pausado (Humano)${remainingText}</span>`
        : '<span class="badge badge-active">🤖 Bot Ativo</span>';

      const lastDate = new Date(chat.lastMessageAt).toLocaleTimeString('pt-BR');

      return `
        <tr>
          <td><strong>${chat.chatId}</strong></td>
          <td>${chat.contactName || '-'}</td>
          <td>${statusBadge}</td>
          <td>${chat.messageCount} msgs</td>
          <td>${lastDate}</td>
          <td>
            ${isPaused 
              ? `<button class="btn btn-secondary btn-sm" onclick="resumeChat('${chat.chatId}')">▶️ Reativar Bot</button>` 
              : `<button class="btn btn-outline btn-sm" onclick="pauseChat('${chat.chatId}')">⏸️ Pausar 6h</button>`}
            <button class="btn btn-outline btn-sm" onclick="clearChat('${chat.chatId}')">🗑️ Limpar</button>
          </td>
        </tr>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar conversas:', err);
  }
}

document.getElementById('btn-refresh-chats').addEventListener('click', loadChats);

window.pauseChat = async function(chatId) {
  await fetch(`/api/chats/${encodeURIComponent(chatId)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: 360 })
  });
  loadChats();
};

window.resumeChat = async function(chatId) {
  await fetch(`/api/chats/${encodeURIComponent(chatId)}/resume`, { method: 'POST' });
  loadChats();
};

window.clearChat = async function(chatId) {
  await fetch(`/api/chats/${encodeURIComponent(chatId)}/clear`, { method: 'POST' });
  loadChats();
};

// 5. Logs em Tempo Real
async function loadLogs() {
  const consoleEl = document.getElementById('logs-console');
  try {
    const res = await fetch('/api/logs');
    const data = await res.json();

    if (!data.logs || data.logs.length === 0) {
      consoleEl.innerHTML = '<div class="log-entry info"><span class="log-text">Nenhum evento registrado ainda.</span></div>';
      return;
    }

    consoleEl.innerHTML = data.logs.map(log => {
      const tagClass = `tag-${log.type}`;
      return `
        <div class="log-entry">
          <span class="log-time">${log.timestamp}</span>
          <span class="log-tag ${tagClass}">${log.type.toUpperCase()}</span>
          <span class="log-text"><strong>[${log.chatId}]</strong> ${log.message}</span>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Erro ao carregar logs:', err);
  }
}

document.getElementById('btn-refresh-logs').addEventListener('click', loadLogs);
document.getElementById('btn-clear-logs').addEventListener('click', async () => {
  await fetch('/api/logs', { method: 'DELETE' });
  loadLogs();
});

// 6. Registro do Webhook na WAHA
document.getElementById('btn-register-waha-hook').addEventListener('click', async () => {
  const targetUrl = document.getElementById('target-webhook-url').value;
  const resultEl = document.getElementById('waha-hook-result');

  resultEl.textContent = 'Enviando requisição para a WAHA...';
  resultEl.className = 'feedback-msg text-orange';

  try {
    const res = await fetch('/api/waha/setup-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: targetUrl })
    });

    const data = await res.json();
    if (data.success) {
      resultEl.textContent = `✅ ${data.message}`;
      resultEl.className = 'feedback-msg text-green';
    } else {
      resultEl.textContent = `⚠️ ${data.message}`;
      resultEl.className = 'feedback-msg text-orange';
    }
  } catch (err) {
    resultEl.textContent = `❌ Erro ao conectar com WAHA: ${err.message}`;
    resultEl.className = 'feedback-msg text-red';
  }
});

// Inicialização
checkStatus();
loadConfig();
setInterval(checkStatus, 15000);
