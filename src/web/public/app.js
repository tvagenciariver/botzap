// Estado Global e Autenticação
const AUTH_TOKEN_KEY = 'botzap_auth_token';
let currentChatId = 'simulador_' + Math.random().toString(36).substring(2, 7) + '@c.us';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function showLoginModal(errorMsg = '') {
  const overlay = document.getElementById('login-overlay');
  const userBadge = document.getElementById('user-badge-container');
  const errorEl = document.getElementById('login-error');
  if (overlay) overlay.classList.remove('hidden');
  if (userBadge) userBadge.style.display = 'none';
  if (errorEl) {
    if (errorMsg) {
      errorEl.textContent = errorMsg;
      errorEl.style.display = 'block';
    } else {
      errorEl.textContent = '';
      errorEl.style.display = 'none';
    }
  }
}

function hideLoginModal(username = 'admin') {
  const overlay = document.getElementById('login-overlay');
  const userBadge = document.getElementById('user-badge-container');
  const userNameEl = document.getElementById('user-badge-name');
  if (overlay) overlay.classList.add('hidden');
  if (userBadge) userBadge.style.display = 'flex';
  if (userNameEl) userNameEl.textContent = `👤 ${username}`;
}

/**
 * Wrapper de Fetch com token de autorização Bearer
 */
async function fetchWithAuth(url, options = {}) {
  const token = getAuthToken();
  const headers = { ...(options.headers || {}) };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const response = await fetch(url, { ...options, headers });
  if (response.status === 401 && !url.includes('/api/auth/login')) {
    clearAuthToken();
    showLoginModal('Sessão expirada. Por favor, faça login novamente.');
    throw new Error('Não autorizado (401)');
  }
  return response;
}

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

    if (getAuthToken()) {
      if (targetTab === 'chats') loadChats();
      if (targetTab === 'logs') loadLogs();
      if (targetTab === 'prompts') loadConfig();
      if (targetTab === 'integration') loadWahaConfig();
    }
  });
});

// 1. Checar Status
async function checkStatus() {
  if (!getAuthToken()) return;
  try {
    const res = await fetchWithAuth('/api/status');
    const data = await res.json();

    // WAHA Status
    const wahaDot = document.getElementById('dot-waha');
    const wahaText = document.getElementById('status-waha');
    if (data.waha && data.waha.online) {
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
    if (data.gemini && data.gemini.configured) {
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

document.getElementById('btn-refresh-status')?.addEventListener('click', checkStatus);

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

chatForm?.addEventListener('submit', async (e) => {
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
    const res = await fetchWithAuth('/api/simulate', {
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
  if (!getAuthToken()) return;
  try {
    const res = await fetchWithAuth('/api/config');
    const data = await res.json();
    const cfg = data.config;

    document.getElementById('cfg-botName').value = cfg.botName || '';
    document.getElementById('cfg-companyName').value = cfg.companyName || '';
    document.getElementById('cfg-model').value = cfg.model || 'gemini-flash-lite-latest';
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

document.getElementById('config-form')?.addEventListener('submit', async (e) => {
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
    const res = await fetchWithAuth('/api/config', {
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
      setTimeout(() => { feedback.textContent = ''; }, 3500);
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
  if (!getAuthToken()) return;
  const tbody = document.getElementById('chats-tbody');
  try {
    const res = await fetchWithAuth('/api/chats');
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

document.getElementById('btn-refresh-chats')?.addEventListener('click', loadChats);

window.pauseChat = async function(chatId) {
  await fetchWithAuth(`/api/chats/${encodeURIComponent(chatId)}/pause`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ minutes: 360 })
  });
  loadChats();
};

window.resumeChat = async function(chatId) {
  await fetchWithAuth(`/api/chats/${encodeURIComponent(chatId)}/resume`, { method: 'POST' });
  loadChats();
};

window.clearChat = async function(chatId) {
  await fetchWithAuth(`/api/chats/${encodeURIComponent(chatId)}/clear`, { method: 'POST' });
  loadChats();
};

// 5. Logs em Tempo Real
async function loadLogs() {
  if (!getAuthToken()) return;
  const consoleEl = document.getElementById('logs-console');
  try {
    const res = await fetchWithAuth('/api/logs');
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

document.getElementById('btn-refresh-logs')?.addEventListener('click', loadLogs);
document.getElementById('btn-clear-logs')?.addEventListener('click', async () => {
  await fetchWithAuth('/api/logs', { method: 'DELETE' });
  loadLogs();
});

// 6. Integração com a WAHA API
async function loadWahaConfig() {
  if (!getAuthToken()) return;
  try {
    const res = await fetchWithAuth('/api/config');
    const data = await res.json();
    const cfg = data.config || {};
    const envData = data.env || {};

    const baseUrlEl = document.getElementById('waha-baseUrl');
    const apiKeyEl = document.getElementById('waha-apiKey');
    const sessionEl = document.getElementById('waha-session');
    const publicWebhookUrlEl = document.getElementById('waha-publicWebhookUrl');
    const copyWebhookEl = document.getElementById('copy-webhook-input');
    const copyChatwootEl = document.getElementById('copy-chatwoot-input');

    if (baseUrlEl) baseUrlEl.value = cfg.wahaBaseUrl || envData.wahaBaseUrl || 'https://waha3.whatscorporativo.com';
    if (apiKeyEl && cfg.wahaApiKey) apiKeyEl.value = cfg.wahaApiKey;
    if (sessionEl) sessionEl.value = cfg.wahaSession || envData.wahaSession || 'default';

    // Auto-detect URL pública do webhook baseada na origem atual ou na configurada
    const currentOrigin = window.location.origin;
    let rawUrl = cfg.webhookPublicUrl || envData.webhookPublicUrl || currentOrigin;
    let baseOrigin = rawUrl.replace(/(\/webhook\/(waha|chatwoot))+/gi, '').replace(/\/$/, '');
    if (!baseOrigin || baseOrigin.includes('localhost')) {
      baseOrigin = currentOrigin;
    }
    const fullWahaHook = `${baseOrigin}/webhook/waha`;
    const fullChatwootHook = `${baseOrigin}/webhook/chatwoot`;

    if (publicWebhookUrlEl) publicWebhookUrlEl.value = fullWahaHook;
    if (copyWebhookEl) copyWebhookEl.value = fullWahaHook;
    if (copyChatwootEl) copyChatwootEl.value = fullChatwootHook;
  } catch (err) {
    console.error('Erro ao carregar dados da WAHA:', err);
  }
}

// Testar Conexão com a WAHA
document.getElementById('btn-test-waha')?.addEventListener('click', async () => {
  const statusBox = document.getElementById('waha-status-box');
  const badge = document.getElementById('waha-conn-badge');
  const baseUrl = document.getElementById('waha-baseUrl').value.trim();
  const apiKey = document.getElementById('waha-apiKey').value.trim();
  const session = document.getElementById('waha-session').value.trim() || 'default';

  statusBox.style.display = 'block';
  statusBox.className = 'feedback-msg text-orange';
  statusBox.textContent = 'Testando conexão com o servidor WAHA...';

  try {
    const res = await fetchWithAuth('/api/waha/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, session })
    });
    const data = await res.json();

    if (data.success) {
      statusBox.className = 'feedback-msg text-green';
      statusBox.innerHTML = `✅ <strong>Conexão bem sucedida:</strong> ${data.message} ${data.sessionStatus ? `<br>Status da Sessão: <strong>${data.sessionStatus}</strong>` : ''}`;
      if (badge) {
        badge.textContent = `WAHA: ${data.sessionStatus || 'Conectada'}`;
        badge.className = 'badge text-green';
      }
    } else {
      statusBox.className = 'feedback-msg text-red';
      statusBox.innerHTML = `❌ <strong>Falha na conexão:</strong> ${data.message}`;
      if (badge) {
        badge.textContent = 'WAHA: Desconectada';
        badge.className = 'badge text-red';
      }
    }
    checkStatus();
  } catch (err) {
    statusBox.className = 'feedback-msg text-red';
    statusBox.innerHTML = `❌ Erro de rede ou requisição: ${err.message}`;
  }
});

// Salvar Configurações de Conexão da WAHA
document.getElementById('btn-save-waha')?.addEventListener('click', async () => {
  const statusBox = document.getElementById('waha-status-box');
  const baseUrl = document.getElementById('waha-baseUrl').value.trim();
  const apiKey = document.getElementById('waha-apiKey').value.trim();
  const session = document.getElementById('waha-session').value.trim() || 'default';
  const rawHook = document.getElementById('waha-publicWebhookUrl').value.trim();
  const cleanBaseHook = rawHook.replace(/(\/webhook\/(waha|chatwoot))+/gi, '').replace(/\/$/, '');

  statusBox.style.display = 'block';
  statusBox.className = 'feedback-msg text-orange';
  statusBox.textContent = 'Salvando configurações da WAHA...';

  try {
    const res = await fetchWithAuth('/api/waha/save-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ baseUrl, apiKey, session, webhookPublicUrl: cleanBaseHook })
    });
    const data = await res.json();

    if (data.success) {
      statusBox.className = 'feedback-msg text-green';
      statusBox.innerHTML = `✅ <strong>${data.message}</strong>`;
      checkStatus();
      setTimeout(() => {
        if (statusBox.className.includes('text-green')) statusBox.style.display = 'none';
      }, 4000);
    } else {
      statusBox.className = 'feedback-msg text-red';
      statusBox.innerHTML = `❌ Erro ao salvar: ${data.message || data.error}`;
    }
  } catch (err) {
    statusBox.className = 'feedback-msg text-red';
    statusBox.innerHTML = `❌ Erro de rede: ${err.message}`;
  }
});

// Registrar Webhook Automaticamente na WAHA
document.getElementById('btn-register-waha-hook')?.addEventListener('click', async () => {
  const statusBox = document.getElementById('waha-status-box');
  const publicWebhookUrl = document.getElementById('waha-publicWebhookUrl').value.trim();
  const session = document.getElementById('waha-session').value.trim() || 'default';

  statusBox.style.display = 'block';
  statusBox.className = 'feedback-msg text-orange';
  statusBox.textContent = 'Enviando comando para registrar webhook na WAHA...';

  try {
    const res = await fetchWithAuth('/api/waha/setup-webhook', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: publicWebhookUrl, session })
    });
    const data = await res.json();

    if (data.success) {
      statusBox.className = 'feedback-msg text-green';
      statusBox.innerHTML = `✅ ${data.message}`;
    } else {
      statusBox.className = 'feedback-msg text-orange';
      statusBox.innerHTML = `⚠️ ${data.message}`;
    }
  } catch (err) {
    statusBox.className = 'feedback-msg text-red';
    statusBox.innerHTML = `❌ Erro ao registrar webhook: ${err.message}`;
  }
});

// Copiar Webhook da WAHA
document.getElementById('btn-copy-webhook-btn')?.addEventListener('click', () => {
  const input = document.getElementById('copy-webhook-input');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('btn-copy-webhook-btn');
    const old = btn.textContent;
    btn.textContent = '✅ Copiado!';
    setTimeout(() => { btn.textContent = old; }, 2000);
  }
});

// Copiar Webhook do Chatwoot
document.getElementById('btn-copy-chatwoot-btn')?.addEventListener('click', () => {
  const input = document.getElementById('copy-chatwoot-input');
  if (input && input.value) {
    navigator.clipboard.writeText(input.value);
    const btn = document.getElementById('btn-copy-chatwoot-btn');
    const old = btn.textContent;
    btn.textContent = '✅ Copiado!';
    setTimeout(() => { btn.textContent = old; }, 2000);
  }
});

// ==========================================
// Handlers de Login e Logout
// ==========================================
document.getElementById('login-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const usernameInput = document.getElementById('login-username');
  const passwordInput = document.getElementById('login-password');
  const submitBtn = document.getElementById('btn-login-submit');
  const errorEl = document.getElementById('login-error');

  const username = usernameInput.value.trim();
  const password = passwordInput.value;

  if (!username || !password) return;

  submitBtn.disabled = true;
  submitBtn.textContent = 'Verificando... ⏳';
  errorEl.style.display = 'none';

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();
    if (res.ok && data.success && data.token) {
      setAuthToken(data.token);
      hideLoginModal(data.user?.username || username);
      passwordInput.value = '';
      checkStatus();
      loadConfig();
      loadWahaConfig();
    } else {
      errorEl.textContent = data.error || 'Credenciais inválidas. Verifique usuário e senha.';
      errorEl.style.display = 'block';
    }
  } catch (err) {
    errorEl.textContent = `Erro ao conectar com o servidor: ${err.message}`;
    errorEl.style.display = 'block';
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = 'Entrar no Painel 🚀';
  }
});

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  try {
    await fetchWithAuth('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  clearAuthToken();
  showLoginModal();
});

// Inicialização da Aplicação
async function initApp() {
  const token = getAuthToken();
  if (!token) {
    showLoginModal();
    return;
  }

  try {
    const res = await fetch('/api/auth/me', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (res.ok) {
      const data = await res.json();
      hideLoginModal(data.user?.username || 'admin');
      checkStatus();
      loadConfig();
      loadWahaConfig();
    } else {
      clearAuthToken();
      showLoginModal();
    }
  } catch (err) {
    showLoginModal();
  }
}

// Auto-refresh do status a cada 15 segundos se logado
setInterval(() => {
  const overlay = document.getElementById('login-overlay');
  if (getAuthToken() && overlay && overlay.classList.contains('hidden')) {
    checkStatus();
  }
}, 15000);

initApp();

