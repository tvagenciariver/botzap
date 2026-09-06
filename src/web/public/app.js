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

/**
 * Exibe notificação flutuante suave (Toast Notification)
 */
function showToast(message, type = 'info', duration = 3500) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;

  const icon = type === 'success' ? '✅' : type === 'error' ? '❌' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, duration);
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
      appointments: 'Central de Agendamentos & Agenda Inteligente',
      agents: 'Gerenciador de Agentes & Clientes (Multi-Agentes)',
      prompts: 'Configuração Geral & Agente Padrão',
      schedule: 'Horário Comercial & Mensagem de Ausência',
      chats: 'Conversas Ativas & Pausa do Bot',
      logs: 'Logs em Tempo Real do Orquestrador',
      integration: 'Integração WAHA API & Chatwoot'
    };
    document.getElementById('page-title').textContent = titles[targetTab] || 'BotZap';

    if (getAuthToken()) {
      if (targetTab === 'simulator') loadAgentsForSimulator();
      if (targetTab === 'appointments') loadAppointments();
      if (targetTab === 'agents') loadAgents();
      if (targetTab === 'chats') loadChats();
      if (targetTab === 'logs') loadLogs();
      if (targetTab === 'prompts') loadConfig();
      if (targetTab === 'schedule') loadSchedule();
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
    const wahaBadge = document.getElementById('waha-conn-badge');
    const wahaBadgeTop = document.getElementById('waha-conn-badge-top');

    if (data.waha && data.waha.online) {
      wahaDot.className = 'status-dot online';
      wahaText.textContent = data.waha.status || 'Conectada';
      wahaText.className = 'status-val text-green';
      if (wahaBadge) {
        wahaBadge.textContent = `WAHA: ${data.waha.status || 'Conectada'}`;
        wahaBadge.className = 'badge text-green';
      }
      if (wahaBadgeTop) {
        wahaBadgeTop.textContent = `WAHA: ${data.waha.status || 'Conectada'}`;
        wahaBadgeTop.className = 'badge text-green';
      }
    } else {
      wahaDot.className = 'status-dot offline';
      wahaText.textContent = 'Desconectada';
      wahaText.className = 'status-val text-red';
      if (wahaBadge) {
        wahaBadge.textContent = 'WAHA: Desconectada';
        wahaBadge.className = 'badge text-red';
      }
      if (wahaBadgeTop) {
        wahaBadgeTop.textContent = 'WAHA: Desconectada';
        wahaBadgeTop.className = 'badge text-red';
      }
    }

    // Status Geral de Agentes (Infraestrutura)
    const agentsCountText = document.getElementById('status-agents-count');
    const agentsCountDot = document.getElementById('dot-agents-count');
    if (data.agentsCount) {
      if (agentsCountText) {
        agentsCountText.textContent = `${data.agentsCount.active}/${data.agentsCount.total} Ativos`;
        agentsCountText.className = data.agentsCount.active > 0 ? 'status-val text-indigo' : 'status-val text-muted';
      }
      if (agentsCountDot) {
        agentsCountDot.className = data.agentsCount.active > 0 ? 'status-dot online' : 'status-dot offline';
      }
    }

    // Atualiza status do agente em foco na barra lateral se já selecionado
    const sidebarSelect = document.getElementById('sidebar-agent-select');
    if (sidebarSelect && sidebarSelect.value) {
      updateSidebarAgentStatus(sidebarSelect.value);
    }

    // Status do Horário Comercial (Aba de Horário Padrão / Legado)
    const schedBadge = document.getElementById('schedule-status-badge');
    if (data.businessHours && schedBadge) {
      const isEnabled = data.businessHours.enabled;
      const isOpen = data.businessHours.isOpen;
      const reason = data.businessHours.reason;

      if (!isEnabled) {
        schedBadge.className = 'badge text-muted';
        schedBadge.innerHTML = '<span class="status-dot offline"></span> Desativado (Sempre Aberto)';
      } else if (isOpen) {
        schedBadge.className = 'badge text-green';
        schedBadge.innerHTML = `<span class="status-dot online"></span> Aberto agora (${data.businessHours.currentTime} - ${data.businessHours.currentDay})`;
      } else {
        const reasonLabel = reason === 'lunch' ? 'Almoço 🍽️' : reason === 'day_closed' ? 'Fechado hoje' : 'Fora de expediente';
        schedBadge.className = 'badge text-red';
        schedBadge.innerHTML = `<span class="status-dot offline"></span> Fechado (${reasonLabel} - ${data.businessHours.currentTime})`;
      }
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
        message: text,
        agentId: document.getElementById('sim-agent-select')?.value || undefined
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
function setProviderUI(provider) {
  const geminiCard = document.getElementById('card-provider-gemini');
  const openaiCard = document.getElementById('card-provider-openai');
  const geminiGroup = document.getElementById('group-gemini-settings');
  const openaiGroup = document.getElementById('group-openai-settings');
  const geminiRadio = document.querySelector('input[name="llmProvider"][value="gemini"]');
  const openaiRadio = document.querySelector('input[name="llmProvider"][value="openai"]');

  if (provider === 'openai') {
    openaiCard?.classList.add('active');
    geminiCard?.classList.remove('active');
    if (openaiRadio) openaiRadio.checked = true;
    if (geminiGroup) geminiGroup.style.display = 'none';
    if (openaiGroup) openaiGroup.style.display = 'block';
  } else {
    geminiCard?.classList.add('active');
    openaiCard?.classList.remove('active');
    if (geminiRadio) geminiRadio.checked = true;
    if (geminiGroup) geminiGroup.style.display = 'block';
    if (openaiGroup) openaiGroup.style.display = 'none';
  }
}

document.getElementById('card-provider-gemini')?.addEventListener('click', () => setProviderUI('gemini'));
document.getElementById('card-provider-openai')?.addEventListener('click', () => setProviderUI('openai'));

document.getElementById('btn-toggle-gemini-key')?.addEventListener('click', () => {
  const input = document.getElementById('cfg-apiKey');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-toggle-openai-key')?.addEventListener('click', () => {
  const input = document.getElementById('cfg-openaiApiKey');
  if (input) input.type = input.type === 'password' ? 'text' : 'password';
});

document.getElementById('btn-test-openai')?.addEventListener('click', async () => {
  const key = document.getElementById('cfg-openaiApiKey').value.trim();
  const feedback = document.getElementById('openai-test-feedback');
  if (feedback) {
    feedback.style.display = 'block';
    feedback.className = 'conn-test-feedback test-testing';
    feedback.textContent = '⏳ Conectando e validando chave na OpenAI...';
  }

  try {
    const res = await fetchWithAuth('/api/openai/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apiKey: key || undefined })
    });
    const data = await res.json();
    if (data.success) {
      if (feedback) {
        feedback.className = 'conn-test-feedback test-success';
        feedback.textContent = `✅ ${data.message} (${(data.models || []).length} modelos disponíveis)`;
      }
      showToast('Chave da OpenAI validada com sucesso!', 'success');
    } else {
      if (feedback) {
        feedback.className = 'conn-test-feedback test-error';
        feedback.textContent = `❌ ${data.message}`;
      }
      showToast('Falha ao validar chave da OpenAI.', 'error');
    }
  } catch (err) {
    if (feedback) {
      feedback.className = 'conn-test-feedback test-error';
      feedback.textContent = `❌ Erro: ${err.message}`;
    }
    showToast(`Erro ao testar OpenAI: ${err.message}`, 'error');
  }
});

async function loadConfig() {
  if (!getAuthToken()) return;
  try {
    const res = await fetchWithAuth('/api/config');
    const data = await res.json();
    const cfg = data.config;

    document.getElementById('cfg-botName').value = cfg.botName || '';
    document.getElementById('cfg-companyName').value = cfg.companyName || '';
    
    // Provedor de IA
    const provider = cfg.llmProvider || 'gemini';
    setProviderUI(provider);

    // Gemini
    document.getElementById('cfg-model').value = cfg.model || 'gemini-flash-lite-latest';
    document.getElementById('cfg-temperature').value = cfg.temperature ?? 0.4;
    if (cfg.geminiApiKey) {
      document.getElementById('cfg-apiKey').placeholder = cfg.geminiApiKey;
    }

    // OpenAI
    document.getElementById('cfg-openaiModel').value = cfg.openaiModel || 'gpt-4o-mini';
    document.getElementById('cfg-openai-temperature').value = cfg.temperature ?? 0.4;
    if (cfg.openaiApiKey) {
      document.getElementById('cfg-openaiApiKey').placeholder = cfg.openaiApiKey;
    }

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

  const selectedProvider = document.querySelector('input[name="llmProvider"]:checked')?.value || 'gemini';
  const temperature = selectedProvider === 'openai'
    ? parseFloat(document.getElementById('cfg-openai-temperature').value)
    : parseFloat(document.getElementById('cfg-temperature').value);

  const payload = {
    botName: document.getElementById('cfg-botName').value,
    companyName: document.getElementById('cfg-companyName').value,
    llmProvider: selectedProvider,
    model: document.getElementById('cfg-model').value,
    openaiModel: document.getElementById('cfg-openaiModel').value,
    temperature,
    systemInstruction: document.getElementById('cfg-systemInstruction').value,
    businessInfo: document.getElementById('cfg-businessInfo').value,
    handoffKeywords,
    handoffMessage: document.getElementById('cfg-handoffMessage').value,
    debounceSeconds: parseFloat(document.getElementById('cfg-debounce').value),
    pauseDurationHours: pauseHours,
    pauseDurationMinutes: Math.round(pauseHours * 60),
    enableTypingSimulation: document.getElementById('cfg-typing').checked,
    enableSendSeen: document.getElementById('cfg-seen').checked,
    apiKey: document.getElementById('cfg-apiKey').value,
    openaiApiKey: document.getElementById('cfg-openaiApiKey').value
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
      document.getElementById('cfg-openaiApiKey').value = '';
      if (data.config.openaiApiKey) {
        document.getElementById('cfg-openaiApiKey').placeholder = data.config.openaiApiKey;
      }
      if (data.config.geminiApiKey) {
        document.getElementById('cfg-apiKey').placeholder = data.config.geminiApiKey;
      }
      showToast('Configurações de IA salvas com sucesso!', 'success');
      checkStatus();
      setTimeout(() => { feedback.textContent = ''; }, 3500);
    } else {
      feedback.textContent = `❌ Erro: ${data.error}`;
      feedback.className = 'feedback-msg text-red';
      showToast(`Erro ao salvar: ${data.error}`, 'error');
    }
  } catch (err) {
    feedback.textContent = `❌ Erro ao salvar: ${err.message}`;
    feedback.className = 'feedback-msg text-red';
    showToast(`Erro ao salvar: ${err.message}`, 'error');
  }
});

// ==========================================================================
// 3.1 Horário Comercial & Mensagem de Ausência
// ==========================================================================
const SCHEDULE_DAYS = [
  { key: 'monday', label: 'Segunda-feira' },
  { key: 'tuesday', label: 'Terça-feira' },
  { key: 'wednesday', label: 'Quarta-feira' },
  { key: 'thursday', label: 'Quinta-feira' },
  { key: 'friday', label: 'Sexta-feira' },
  { key: 'saturday', label: 'Sábado' },
  { key: 'sunday', label: 'Domingo' }
];

let currentScheduleData = null;

function renderScheduleTable(schedule = {}) {
  const tbody = document.getElementById('schedule-table-body');
  if (!tbody) return;

  tbody.innerHTML = SCHEDULE_DAYS.map(day => {
    const d = schedule[day.key] || {
      enabled: day.key !== 'sunday',
      start: '08:00',
      end: day.key === 'saturday' ? '12:00' : '18:00',
      hasLunch: day.key !== 'saturday' && day.key !== 'sunday',
      lunchStart: '12:00',
      lunchEnd: '13:00'
    };

    const isDayDisabled = !d.enabled;
    const isLunchDisabled = !d.hasLunch;

    return `
      <tr class="${isDayDisabled ? 'schedule-row-disabled' : ''}" id="sched-row-${day.key}">
        <td>
          <strong>${day.label}</strong>
        </td>
        <td>
          <label class="mini-switch">
            <input type="checkbox" class="day-enabled-toggle" data-day="${day.key}" ${d.enabled ? 'checked' : ''}>
            <span class="mini-slider"></span>
            <span class="mini-switch-label" id="day-label-${day.key}">${d.enabled ? 'Aberto' : 'Fechado'}</span>
          </label>
        </td>
        <td>
          <div class="time-range-box">
            <input type="time" class="time-input day-start" data-day="${day.key}" value="${d.start || '08:00'}">
            <span class="time-sep">até</span>
            <input type="time" class="time-input day-end" data-day="${day.key}" value="${d.end || '18:00'}">
          </div>
        </td>
        <td>
          <label class="mini-switch">
            <input type="checkbox" class="day-lunch-toggle" data-day="${day.key}" ${d.hasLunch ? 'checked' : ''}>
            <span class="mini-slider"></span>
            <span class="mini-switch-label" id="lunch-label-${day.key}">${d.hasLunch ? 'Ativo' : 'Não'}</span>
          </label>
        </td>
        <td class="${isLunchDisabled ? 'lunch-disabled-cell' : ''}" id="lunch-inputs-${day.key}">
          <div class="time-range-box">
            <input type="time" class="time-input lunch-start" data-day="${day.key}" value="${d.lunchStart || '12:00'}">
            <span class="time-sep">até</span>
            <input type="time" class="time-input lunch-end" data-day="${day.key}" value="${d.lunchEnd || '13:00'}">
          </div>
        </td>
      </tr>
    `;
  }).join('');

  // Adiciona listeners para os switches da tabela
  tbody.querySelectorAll('.day-enabled-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const dayKey = e.target.getAttribute('data-day');
      const isChecked = e.target.checked;
      const row = document.getElementById(`sched-row-${dayKey}`);
      const label = document.getElementById(`day-label-${dayKey}`);
      if (row) {
        if (isChecked) {
          row.classList.remove('schedule-row-disabled');
        } else {
          row.classList.add('schedule-row-disabled');
        }
      }
      if (label) {
        label.textContent = isChecked ? 'Aberto' : 'Fechado';
      }
    });
  });

  tbody.querySelectorAll('.day-lunch-toggle').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const dayKey = e.target.getAttribute('data-day');
      const isChecked = e.target.checked;
      const cell = document.getElementById(`lunch-inputs-${dayKey}`);
      const label = document.getElementById(`lunch-label-${dayKey}`);
      if (cell) {
        if (isChecked) {
          cell.classList.remove('lunch-disabled-cell');
        } else {
          cell.classList.add('lunch-disabled-cell');
        }
      }
      if (label) {
        label.textContent = isChecked ? 'Ativo' : 'Não';
      }
    });
  });
}

async function loadSchedule() {
  if (!getAuthToken()) return;
  try {
    const res = await fetchWithAuth('/api/business-hours/status');
    const data = await res.json();
    const bh = data.businessHours || {};
    currentScheduleData = bh;

    const masterCheckbox = document.getElementById('sched-enabled');
    if (masterCheckbox) {
      masterCheckbox.checked = !!bh.enabled;
    }

    const msgInput = document.getElementById('sched-outOfHoursMessage');
    if (msgInput) {
      msgInput.value = bh.outOfHoursMessage || '';
    }

    renderScheduleTable(bh.schedule || {});
    checkStatus();
  } catch (err) {
    console.error('Erro ao carregar horário comercial:', err);
  }
}

async function handleSaveSchedule() {
  const masterEnabled = document.getElementById('sched-enabled')?.checked || false;
  const outOfHoursMessage = document.getElementById('sched-outOfHoursMessage')?.value || '';
  const feedback = document.getElementById('schedule-save-feedback');

  if (feedback) {
    feedback.textContent = 'Salvando horários...';
    feedback.className = 'feedback-msg text-orange';
  }

  const schedule = {};
  for (const day of SCHEDULE_DAYS) {
    const row = document.getElementById(`sched-row-${day.key}`);
    const enabled = row?.querySelector('.day-enabled-toggle')?.checked ?? true;
    const start = row?.querySelector('.day-start')?.value || '08:00';
    const end = row?.querySelector('.day-end')?.value || '18:00';
    const hasLunch = row?.querySelector('.day-lunch-toggle')?.checked ?? false;
    const lunchStart = row?.querySelector('.lunch-start')?.value || '12:00';
    const lunchEnd = row?.querySelector('.lunch-end')?.value || '13:00';

    schedule[day.key] = {
      enabled,
      start,
      end,
      hasLunch,
      lunchStart,
      lunchEnd
    };
  }

  const payload = {
    businessHours: {
      enabled: masterEnabled,
      timezone: 'America/Sao_Paulo',
      outOfHoursMessage,
      schedule
    }
  };

  try {
    const res = await fetchWithAuth('/api/business-hours', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.success) {
      if (feedback) {
        feedback.textContent = '✅ Horário comercial salvo com sucesso!';
        feedback.className = 'feedback-msg text-green';
        setTimeout(() => { feedback.textContent = ''; }, 3500);
      }
      showToast('Horários de atendimento salvos com sucesso!', 'success');
      checkStatus();
    } else {
      if (feedback) {
        feedback.textContent = `❌ Erro: ${data.error}`;
        feedback.className = 'feedback-msg text-red';
      }
      showToast(`Erro ao salvar: ${data.error}`, 'error');
    }
  } catch (err) {
    if (feedback) {
      feedback.textContent = `❌ Erro ao salvar: ${err.message}`;
      feedback.className = 'feedback-msg text-red';
    }
    showToast(`Erro ao salvar: ${err.message}`, 'error');
  }
}

document.getElementById('btn-save-schedule')?.addEventListener('click', handleSaveSchedule);
document.getElementById('btn-save-schedule-top')?.addEventListener('click', handleSaveSchedule);

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
    const sessionBadgeEl = document.getElementById('waha-session-badge');
    const publicWebhookUrlEl = document.getElementById('waha-publicWebhookUrl');
    const copyWebhookEl = document.getElementById('copy-webhook-input');
    const copyChatwootEl = document.getElementById('copy-chatwoot-input');

    if (baseUrlEl) baseUrlEl.value = cfg.wahaBaseUrl || envData.wahaBaseUrl || 'https://waha3.whatscorporativo.com';
    if (apiKeyEl && cfg.wahaApiKey) apiKeyEl.value = cfg.wahaApiKey;
    if (sessionEl) {
      sessionEl.value = cfg.wahaSession || envData.wahaSession || 'default';
      if (sessionBadgeEl) sessionBadgeEl.textContent = sessionEl.value;
    }

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
async function handleTestWaha() {
  const statusBox = document.getElementById('waha-status-box');
  const badge = document.getElementById('waha-conn-badge');
  const badgeTop = document.getElementById('waha-conn-badge-top');
  const baseUrl = document.getElementById('waha-baseUrl').value.trim();
  const apiKey = document.getElementById('waha-apiKey').value.trim();
  const session = document.getElementById('waha-session').value.trim() || 'default';

  if (!baseUrl) {
    showToast('Por favor, informe a URL da WAHA API antes de testar.', 'error');
    return;
  }

  statusBox.style.display = 'block';
  statusBox.className = 'feedback-msg text-orange';
  statusBox.textContent = 'Testando conexão com o servidor WAHA...';
  showToast('Testando conexão com a WAHA...', 'info');

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
      const txt = `WAHA: ${data.sessionStatus || 'Conectada'}`;
      if (badge) {
        badge.textContent = txt;
        badge.className = 'badge text-green';
      }
      if (badgeTop) {
        badgeTop.textContent = txt;
        badgeTop.className = 'badge text-green';
      }
      showToast(`Conectado com sucesso! Sessão: ${data.sessionStatus || 'OK'}`, 'success');
    } else {
      statusBox.className = 'feedback-msg text-red';
      statusBox.innerHTML = `❌ <strong>Falha na conexão:</strong> ${data.message}`;
      if (badge) {
        badge.textContent = 'WAHA: Desconectada';
        badge.className = 'badge text-red';
      }
      if (badgeTop) {
        badgeTop.textContent = 'WAHA: Desconectada';
        badgeTop.className = 'badge text-red';
      }
      showToast(`Falha na conexão: ${data.message}`, 'error');
    }
    checkStatus();
  } catch (err) {
    statusBox.className = 'feedback-msg text-red';
    statusBox.innerHTML = `❌ Erro de rede ou requisição: ${err.message}`;
    showToast(`Erro ao testar conexão: ${err.message}`, 'error');
  }
}

document.getElementById('btn-test-waha')?.addEventListener('click', handleTestWaha);
document.getElementById('btn-test-waha-top')?.addEventListener('click', handleTestWaha);

// Salvar Configurações de Conexão da WAHA
async function handleSaveWaha() {
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
      const sessionBadge = document.getElementById('waha-session-badge');
      if (sessionBadge) sessionBadge.textContent = session;
      showToast('Configurações da WAHA salvas com sucesso!', 'success');
      checkStatus();
      setTimeout(() => {
        if (statusBox.className.includes('text-green')) statusBox.style.display = 'none';
      }, 4000);
    } else {
      statusBox.className = 'feedback-msg text-red';
      statusBox.innerHTML = `❌ Erro ao salvar: ${data.message || data.error}`;
      showToast(`Erro ao salvar: ${data.message || data.error}`, 'error');
    }
  } catch (err) {
    statusBox.className = 'feedback-msg text-red';
    statusBox.innerHTML = `❌ Erro de rede: ${err.message}`;
    showToast(`Erro de rede: ${err.message}`, 'error');
  }
}

document.getElementById('btn-save-waha')?.addEventListener('click', handleSaveWaha);
document.getElementById('btn-save-waha-top')?.addEventListener('click', handleSaveWaha);

// Mostrar / Ocultar Chave de API
document.getElementById('btn-toggle-waha-key')?.addEventListener('click', () => {
  const input = document.getElementById('waha-apiKey');
  const btn = document.getElementById('btn-toggle-waha-key');
  if (input.type === 'password') {
    input.type = 'text';
    btn.textContent = '🙈';
    btn.title = 'Ocultar Chave';
  } else {
    input.type = 'password';
    btn.textContent = '👁️';
    btn.title = 'Mostrar Chave';
  }
});

// Auto-detectar URL Pública do Webhook pelo navegador
document.getElementById('btn-auto-detect-url')?.addEventListener('click', () => {
  const currentOrigin = window.location.origin;
  const input = document.getElementById('waha-publicWebhookUrl');
  const copyWaha = document.getElementById('copy-webhook-input');
  const copyChatwoot = document.getElementById('copy-chatwoot-input');

  const wahaHook = `${currentOrigin}/webhook/waha`;
  const chatwootHook = `${currentOrigin}/webhook/chatwoot`;

  if (input) input.value = wahaHook;
  if (copyWaha) copyWaha.value = wahaHook;
  if (copyChatwoot) copyChatwoot.value = chatwootHook;

  showToast('URL detectada automaticamente pelo navegador!', 'info');
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
      showToast(data.message, 'success');
    } else {
      statusBox.className = 'feedback-msg text-orange';
      statusBox.innerHTML = `⚠️ ${data.message}`;
      showToast(data.message, 'info');
    }
  } catch (err) {
    statusBox.className = 'feedback-msg text-red';
    statusBox.innerHTML = `❌ Erro ao registrar webhook: ${err.message}`;
    showToast(`Erro ao registrar webhook: ${err.message}`, 'error');
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
    showToast('URL do Webhook da WAHA copiada!', 'success');
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
    showToast('URL do Webhook do Chatwoot copiada!', 'success');
    setTimeout(() => { btn.textContent = old; }, 2000);
  }
});

// Atalho de Teclado Global: Ctrl + S / Cmd + S para Salvar
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    const integrationPane = document.getElementById('pane-integration');
    const promptsPane = document.getElementById('pane-prompts');
    const schedulePane = document.getElementById('pane-schedule');
    if (integrationPane && integrationPane.classList.contains('active')) {
      handleSaveWaha();
    } else if (promptsPane && promptsPane.classList.contains('active')) {
      document.getElementById('btn-save-config')?.click();
    } else if (schedulePane && schedulePane.classList.contains('active')) {
      handleSaveSchedule();
    }
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
      loadSchedule();
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

// ==========================================================================
// 3.2 Gerenciamento de Agentes & Clientes (Multi-Agentes)
// ==========================================================================
let allAgents = [];

async function loadAgents() {
  if (!getAuthToken()) return;
  try {
    const res = await fetchWithAuth('/api/agents');
    const data = await res.json();
    allAgents = data.agents || [];

    const badgeTotal = document.getElementById('badge-total-agents');
    if (badgeTotal) {
      badgeTotal.textContent = `${allAgents.length} ${allAgents.length === 1 ? 'Agente cadastrado' : 'Agentes cadastrados'}`;
    }

    renderAgentsGrid(allAgents);
    populateSimulatorAgentSelect(allAgents);
    populateSidebarAgentSelect(allAgents);
  } catch (err) {
    console.error('Erro ao carregar agentes:', err);
    showToast(`Erro ao carregar agentes: ${err.message}`, 'error');
  }
}

function renderAgentsGrid(agents) {
  const grid = document.getElementById('agents-grid');
  if (!grid) return;

  if (!agents || agents.length === 0) {
    grid.innerHTML = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 50px 20px; background: var(--bg-card); border-radius: 14px; border: 1px dashed var(--border);">
        <div style="font-size: 40px; margin-bottom: 12px;">🤖</div>
        <h3 style="margin-bottom: 8px; color: var(--text-main);">Nenhum agente encontrado</h3>
        <p style="color: var(--text-muted); margin-bottom: 20px;">Crie seu primeiro agente para personalizar o atendimento de um cliente.</p>
        <button class="btn btn-primary" onclick="openNewAgentModal()">➕ Criar Primeiro Agente</button>
      </div>
    `;
    return;
  }

  grid.innerHTML = agents.map(agent => {
    const isDefault = agent.isDefault;
    const isActive = agent.active;
    const provider = agent.llmProvider || 'openai';
    const model = provider === 'openai' ? (agent.openaiModel || 'gpt-4o-mini') : (agent.model || 'gemini-flash-lite');
    const sessionLabel = agent.wahaSession ? (agent.wahaSession === '*' ? 'Todas (*)' : agent.wahaSession) : 'Não vinculada';
    
    // Status de Horário Comercial em Tempo Real para este Agente
    const hasSchedule = !!agent.businessHours?.enabled;
    const bh = agent.businessHoursStatus;
    let bhBadgeClass = 'agent-badge-item';
    let bhText = '🕒 Atendimento 24/7';

    if (hasSchedule && bh) {
      if (bh.isOpen) {
        bhBadgeClass += ' agent-badge-bh-open';
        bhText = `🟢 Aberto (${bh.currentTime || ''})`;
      } else {
        if (bh.reason === 'lunch') {
          bhBadgeClass += ' agent-badge-bh-lunch';
          bhText = '🍽️ Em Almoço';
        } else if (bh.reason === 'day_closed') {
          bhBadgeClass += ' agent-badge-bh-closed';
          bhText = '🔴 Fechado Hoje';
        } else {
          bhBadgeClass += ' agent-badge-bh-closed';
          bhText = `🔴 Fora de Horário (${bh.currentTime || ''})`;
        }
      }
    }

    return `
      <div class="agent-card ${isActive ? '' : 'inactive'}" id="agent-card-${agent.id}">
        <div>
          <div class="agent-card-header">
            <div class="agent-card-title-group">
              <div class="agent-card-avatar">${provider === 'openai' ? '🟢' : '🔵'}</div>
              <div>
                <h3 class="agent-card-name">${escapeHtml(agent.name)}</h3>
                <div class="agent-card-company">🏢 ${escapeHtml(agent.companyName)}</div>
              </div>
            </div>
            <div>
              ${isDefault ? '<span class="agent-badge-item agent-badge-default">⭐ Padrão</span>' : ''}
              ${isActive ? '<span class="badge text-green" style="font-size: 11px;">Ativo</span>' : '<span class="badge text-muted" style="font-size: 11px;">Pausado</span>'}
            </div>
          </div>

          <div class="agent-card-badges">
            <span class="agent-badge-item">📱 Sessão: <strong>${escapeHtml(sessionLabel)}</strong></span>
            <span class="agent-badge-item ${provider === 'openai' ? 'agent-badge-provider-openai' : 'agent-badge-provider-gemini'}">
              🧠 ${provider === 'openai' ? 'OpenAI ' : 'Gemini '} ${escapeHtml(model)}
            </span>
            <span class="${bhBadgeClass}">
              ${bhText}
            </span>
          </div>

          <div class="agent-card-desc">
            ${escapeHtml(agent.description || agent.systemInstruction || 'Sem observações.')}
          </div>
        </div>

        <div class="agent-card-actions">
          <button class="btn btn-outline btn-sm" onclick="openEditAgentModal('${agent.id}')" title="Editar Agente">
            ✏️ Editar
          </button>
          <button class="btn btn-secondary btn-sm" onclick="switchToSimulatorWithAgent('${agent.id}')" title="Testar no Simulador">
            💬 Testar
          </button>
          <button class="btn btn-outline btn-sm" onclick="duplicateAgent('${agent.id}')" title="Duplicar">
            📋 Copiar
          </button>
          ${!isDefault ? `
            <button class="btn btn-outline btn-sm text-red" onclick="deleteAgent('${agent.id}', '${escapeHtml(agent.name)}')" title="Excluir">
              🗑️
            </button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Filtro de busca na lista de agentes
document.getElementById('agents-search-input')?.addEventListener('input', (e) => {
  const query = e.target.value.toLowerCase().trim();
  if (!query) {
    renderAgentsGrid(allAgents);
    return;
  }
  const filtered = allAgents.filter(a =>
    a.name.toLowerCase().includes(query) ||
    a.companyName.toLowerCase().includes(query) ||
    (a.wahaSession && a.wahaSession.toLowerCase().includes(query)) ||
    (a.llmProvider && a.llmProvider.toLowerCase().includes(query)) ||
    (a.description && a.description.toLowerCase().includes(query))
  );
  renderAgentsGrid(filtered);
});

// Popula o seletor de agentes do menu lateral (Agente em Foco)
function populateSidebarAgentSelect(agents) {
  const select = document.getElementById('sidebar-agent-select');
  if (!select) return;

  if (!agents || agents.length === 0) {
    select.innerHTML = '<option value="">Nenhum agente cadastrado</option>';
    updateSidebarAgentStatus(null);
    return;
  }

  const currentVal = select.value;
  select.innerHTML = agents.map(a => `
    <option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.companyName)})${a.isDefault ? ' ⭐' : ''}</option>
  `).join('');

  if (currentVal && agents.some(a => a.id === currentVal)) {
    select.value = currentVal;
  } else {
    const def = agents.find(a => a.isDefault) || agents[0];
    select.value = def.id;
  }

  updateSidebarAgentStatus(select.value);
}

// Atualiza os indicadores de IA, Expediente e Sessão do agente em foco na barra lateral
function updateSidebarAgentStatus(agentId) {
  const dotAi = document.getElementById('dot-agent-ai');
  const textAi = document.getElementById('status-agent-ai');
  const dotSched = document.getElementById('dot-agent-schedule');
  const textSched = document.getElementById('status-agent-schedule');
  const dotSession = document.getElementById('dot-agent-session');
  const textSession = document.getElementById('status-agent-session');

  const agent = allAgents.find(a => a.id === agentId);
  if (!agent) {
    if (textAi) { textAi.textContent = 'Nenhum'; textAi.className = 'status-val text-muted'; }
    if (dotAi) dotAi.className = 'status-dot offline';
    if (textSched) { textSched.textContent = '--'; textSched.className = 'status-val text-muted'; }
    if (dotSched) dotSched.className = 'status-dot offline';
    if (textSession) textSession.textContent = '--';
    return;
  }

  // 1. Provedor e Modelo de IA do Agente
  const prov = agent.llmProvider === 'openai' ? 'OpenAI' : 'Gemini';
  const model = agent.llmProvider === 'openai' ? (agent.openaiModel || 'gpt-4o-mini') : (agent.model || 'flash');
  if (textAi) {
    textAi.textContent = `${prov} (${model})`;
    textAi.className = prov === 'openai' ? 'status-val text-green' : 'status-val text-cyan';
  }
  if (dotAi) {
    dotAi.className = 'status-dot online';
  }

  // 2. Expediente e Horário Comercial do Agente
  const bh = agent.businessHoursStatus;
  const hasSched = !!agent.businessHours?.enabled;

  if (!hasSched) {
    if (textSched) {
      textSched.textContent = '24/7 🕒';
      textSched.className = 'status-val text-green';
    }
    if (dotSched) dotSched.className = 'status-dot online';
  } else if (bh && bh.isOpen) {
    if (textSched) {
      textSched.textContent = `Aberto 🟢 (${bh.currentTime})`;
      textSched.className = 'status-val text-green';
    }
    if (dotSched) dotSched.className = 'status-dot online';
  } else if (bh && !bh.isOpen) {
    let reasonText = 'Fechado 🔴';
    if (bh.reason === 'lunch') reasonText = 'Almoço 🍽️';
    else if (bh.reason === 'day_closed') reasonText = 'Fechado hoje 🔴';
    else reasonText = `Fechado 🔴 (${bh.currentTime})`;

    if (textSched) {
      textSched.textContent = reasonText;
      textSched.className = bh.reason === 'lunch' ? 'status-val text-orange' : 'status-val text-red';
    }
    if (dotSched) dotSched.className = 'status-dot offline';
  }

  // 3. Sessão WAHA
  if (textSession) {
    textSession.textContent = agent.wahaSession === '*' ? 'Todas (*)' : (agent.wahaSession || 'Padrão');
  }
  if (dotSession) {
    dotSession.className = agent.active !== false ? 'status-dot online' : 'status-dot offline';
  }
}

document.getElementById('sidebar-agent-select')?.addEventListener('change', (e) => {
  const agentId = e.target.value;
  updateSidebarAgentStatus(agentId);
  const simSelect = document.getElementById('sim-agent-select');
  if (simSelect && simSelect.value !== agentId) {
    simSelect.value = agentId;
    simSelect.dispatchEvent(new Event('change'));
  }
});

// Popula o seletor de agentes do Simulador
function populateSimulatorAgentSelect(agents) {
  const select = document.getElementById('sim-agent-select');
  if (!select) return;

  const currentVal = select.value;
  select.innerHTML = agents.map(a => `
    <option value="${a.id}">
      ${escapeHtml(a.name)} (${escapeHtml(a.companyName)})${a.isDefault ? ' [Padrão]' : ''}
    </option>
  `).join('');

  if (currentVal && agents.some(a => a.id === currentVal)) {
    select.value = currentVal;
  } else if (agents.length > 0) {
    const def = agents.find(a => a.isDefault) || agents[0];
    select.value = def.id;
  }

  updateSimulatorHeaderForSelectedAgent();
}

function updateSimulatorHeaderForSelectedAgent() {
  const select = document.getElementById('sim-agent-select');
  if (!select || !select.value) return;

  const agent = allAgents.find(a => a.id === select.value);
  if (agent) {
    const botNameEl = document.getElementById('sim-bot-name');
    const badgeEl = document.getElementById('sim-agent-badge');
    if (botNameEl) botNameEl.textContent = agent.name;
    if (badgeEl) {
      const prov = agent.llmProvider === 'openai' ? 'OpenAI' : 'Gemini';
      const model = agent.llmProvider === 'openai' ? (agent.openaiModel || 'gpt-4o-mini') : (agent.model || 'flash');
      badgeEl.textContent = `${agent.companyName} • ${prov} (${model})`;
    }
  }
}

document.getElementById('sim-agent-select')?.addEventListener('change', () => {
  const select = document.getElementById('sim-agent-select');
  updateSimulatorHeaderForSelectedAgent();

  // Sincroniza seletor da barra lateral
  const sidebarSelect = document.getElementById('sidebar-agent-select');
  if (sidebarSelect && select && sidebarSelect.value !== select.value) {
    sidebarSelect.value = select.value;
    updateSidebarAgentStatus(select.value);
  }

  currentChatId = 'simulador_' + Math.random().toString(36).substring(2, 7) + '@c.us';
  const chatMessages = document.getElementById('chat-messages');
  if (chatMessages) {
    const agent = allAgents.find(a => a.id === select?.value);
    chatMessages.innerHTML = '';
    appendMessage(`Simulador alternado para o agente <strong>${agent ? agent.name : ''}</strong> (${agent ? agent.companyName : ''}). Olá! Como posso ajudar você hoje? 👋`, false);
  }
});

function switchToSimulatorWithAgent(agentId) {
  const simNavBtn = document.querySelector('.nav-btn[data-tab="simulator"]');
  if (simNavBtn) simNavBtn.click();

  const select = document.getElementById('sim-agent-select');
  if (select) {
    select.value = agentId;
    select.dispatchEvent(new Event('change'));
  }

  const sidebarSelect = document.getElementById('sidebar-agent-select');
  if (sidebarSelect) {
    sidebarSelect.value = agentId;
    updateSidebarAgentStatus(agentId);
  }
}

async function loadAgentsForSimulator() {
  if (allAgents.length === 0) {
    await loadAgents();
  } else {
    populateSimulatorAgentSelect(allAgents);
  }
}

// ==========================================================================
// ==========================================================================
// EDITOR DEDICADO DE AGENTE (CRIAÇÃO / EDIÇÃO)
// ==========================================================================

// Alternância de abas do editor dedicado
document.querySelectorAll('.editor-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.editor-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.modal-tab-pane').forEach(p => p.classList.remove('active'));

    btn.classList.add('active');
    const tabName = btn.getAttribute('data-modaltab');
    const targetPane = document.getElementById(`modal-pane-${tabName}`);
    if (targetPane) targetPane.classList.add('active');
  });
});

// Alternância visual de OpenAI / Gemini no editor
function setModalLLMProviderUI(provider) {
  const openaiBox = document.getElementById('modal-openai-box');
  const geminiBox = document.getElementById('modal-gemini-box');
  if (provider === 'openai') {
    if (openaiBox) openaiBox.style.display = 'block';
    if (geminiBox) geminiBox.style.display = 'none';
  } else {
    if (openaiBox) openaiBox.style.display = 'none';
    if (geminiBox) geminiBox.style.display = 'block';
  }
}

document.getElementById('modal-agent-llmProvider')?.addEventListener('change', (e) => {
  setModalLLMProviderUI(e.target.value);
});

// Renderização da tabela de horários dentro do editor
function renderModalScheduleTable(schedule = {}) {
  const tbody = document.getElementById('modal-schedule-tbody');
  if (!tbody) return;

  tbody.innerHTML = SCHEDULE_DAYS.map(day => {
    const d = schedule[day.key] || {
      enabled: day.key !== 'sunday',
      start: '08:00',
      end: day.key === 'saturday' ? '12:00' : '18:00',
      hasLunch: day.key !== 'saturday' && day.key !== 'sunday',
      lunchStart: '12:00',
      lunchEnd: '13:00'
    };

    const isDayDisabled = !d.enabled;
    const isLunchDisabled = !d.hasLunch;

    return `
      <tr class="${isDayDisabled ? 'schedule-row-disabled' : ''}" id="modal-sched-row-${day.key}">
        <td><strong>${day.label}</strong></td>
        <td>
          <label class="mini-switch">
            <input type="checkbox" class="modal-day-enabled" data-day="${day.key}" ${d.enabled ? 'checked' : ''}>
            <span class="mini-slider"></span>
          </label>
        </td>
        <td>
          <div class="time-range-box">
            <input type="time" class="time-input modal-day-start" data-day="${day.key}" value="${d.start || '08:00'}">
            <span class="time-sep">até</span>
            <input type="time" class="time-input modal-day-end" data-day="${day.key}" value="${d.end || '18:00'}">
          </div>
        </td>
        <td>
          <label class="mini-switch">
            <input type="checkbox" class="modal-day-lunch" data-day="${day.key}" ${d.hasLunch ? 'checked' : ''}>
            <span class="mini-slider"></span>
          </label>
        </td>
        <td class="${isLunchDisabled ? 'lunch-disabled-cell' : ''}" id="modal-lunch-inputs-${day.key}">
          <div class="time-range-box">
            <input type="time" class="time-input modal-lunch-start" data-day="${day.key}" value="${d.lunchStart || '12:00'}">
            <span class="time-sep">até</span>
            <input type="time" class="time-input modal-lunch-end" data-day="${day.key}" value="${d.lunchEnd || '13:00'}">
          </div>
        </td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.modal-day-enabled').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const dayKey = e.target.getAttribute('data-day');
      const row = document.getElementById(`modal-sched-row-${dayKey}`);
      if (row) {
        if (e.target.checked) row.classList.remove('schedule-row-disabled');
        else row.classList.add('schedule-row-disabled');
      }
    });
  });

  tbody.querySelectorAll('.modal-day-lunch').forEach(toggle => {
    toggle.addEventListener('change', (e) => {
      const dayKey = e.target.getAttribute('data-day');
      const cell = document.getElementById(`modal-lunch-inputs-${dayKey}`);
      if (cell) {
        if (e.target.checked) cell.classList.remove('lunch-disabled-cell');
        else cell.classList.add('lunch-disabled-cell');
      }
    });
  });
}

function showAgentEditor() {
  const listView = document.getElementById('agents-list-view');
  const editorView = document.getElementById('agents-editor-view');
  if (listView) listView.style.display = 'none';
  if (editorView) editorView.style.display = 'block';

  // Rola para o topo suavemente
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.querySelector('.main-content');
  if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeAgentModal() {
  const listView = document.getElementById('agents-list-view');
  const editorView = document.getElementById('agents-editor-view');
  if (listView) listView.style.display = 'block';
  if (editorView) editorView.style.display = 'none';

  window.scrollTo({ top: 0, behavior: 'smooth' });
  const main = document.querySelector('.main-content');
  if (main) main.scrollTo({ top: 0, behavior: 'smooth' });
}

function openNewAgentModal() {
  document.getElementById('modal-agent-id').value = '';
  document.getElementById('agent-modal-title').textContent = '➕ Criar Novo Agente / Cliente';
  document.getElementById('agent-modal-subtitle').textContent = 'Defina os dados, IA, prompts e horários exclusivos deste cliente com amplo conforto.';

  // Default values
  document.getElementById('modal-agent-name').value = '';
  document.getElementById('modal-agent-company').value = '';
  document.getElementById('modal-agent-session').value = '';
  document.getElementById('modal-agent-description').value = '';
  document.getElementById('modal-agent-active').checked = true;
  document.getElementById('modal-agent-isDefault').checked = false;

  document.getElementById('modal-agent-llmProvider').value = 'openai';
  setModalLLMProviderUI('openai');

  document.getElementById('modal-agent-openaiApiKey').value = '';
  document.getElementById('modal-agent-openaiModel').value = 'gpt-4o-mini';
  document.getElementById('modal-agent-geminiApiKey').value = '';
  document.getElementById('modal-agent-model').value = 'gemini-flash-lite-latest';
  document.getElementById('modal-agent-temperature').value = 0.4;

  document.getElementById('modal-agent-systemInstruction').value =
    'Você é Sofia, assistente virtual humanizada da {companyName} no WhatsApp.\nSeja atenciosa, cortês, empática e concisa. Responda às dúvidas dos clientes com clareza com base exclusivamente na Base de Conhecimento.';
  document.getElementById('modal-agent-businessInfo').value = '';

  document.getElementById('modal-agent-handoffKeywords').value = 'atendente, humano, falar com pessoa, suporte, financeiro';
  document.getElementById('modal-agent-handoffMessage').value = 'Entendido! Estou transferindo seu atendimento para nossa equipe humana. Aguarde um instante que já iremos te atender! 👩‍💼';
  document.getElementById('modal-agent-pauseHours').value = 6;
  document.getElementById('modal-agent-debounce').value = 2.5;
  document.getElementById('modal-agent-typing').checked = true;
  document.getElementById('modal-agent-seen').checked = true;

  document.getElementById('modal-sched-enabled').checked = false;
  document.getElementById('modal-sched-outOfHoursMessage').value =
    'Olá! Nosso horário de atendimento encerrou. Deixe sua dúvida que responderemos assim que retornarmos! 🕒';

  renderModalScheduleTable({});

  // Reset para a primeira aba e exibe o editor
  document.querySelector('.editor-tab-btn[data-modaltab="general"]')?.click();
  showAgentEditor();
}

async function openEditAgentModal(agentId) {
  try {
    const res = await fetchWithAuth(`/api/agents/${agentId}`);
    const data = await res.json();
    const agent = data.agent;
    if (!agent) throw new Error('Agente não encontrado.');

    document.getElementById('modal-agent-id').value = agent.id;
    document.getElementById('agent-modal-title').textContent = `✏️ Editando Agente: ${agent.name}`;
    document.getElementById('agent-modal-subtitle').textContent = `Empresa: ${agent.companyName} | Sessão: ${agent.wahaSession || '*'} | ID: ${agent.id}`;

    document.getElementById('modal-agent-name').value = agent.name || '';
    document.getElementById('modal-agent-company').value = agent.companyName || '';
    document.getElementById('modal-agent-session').value = agent.wahaSession || '';
    document.getElementById('modal-agent-description').value = agent.description || '';
    document.getElementById('modal-agent-active').checked = agent.active !== false;
    document.getElementById('modal-agent-isDefault').checked = !!agent.isDefault;

    const prov = agent.llmProvider || 'openai';
    document.getElementById('modal-agent-llmProvider').value = prov;
    setModalLLMProviderUI(prov);

    document.getElementById('modal-agent-openaiApiKey').value = agent.openaiApiKey || '';
    document.getElementById('modal-agent-openaiModel').value = agent.openaiModel || 'gpt-4o-mini';
    document.getElementById('modal-agent-geminiApiKey').value = agent.geminiApiKey || '';
    document.getElementById('modal-agent-model').value = agent.model || 'gemini-flash-lite-latest';
    document.getElementById('modal-agent-temperature').value = agent.temperature ?? 0.4;

    document.getElementById('modal-agent-systemInstruction').value = agent.systemInstruction || '';
    document.getElementById('modal-agent-businessInfo').value = agent.businessInfo || '';

    document.getElementById('modal-agent-handoffKeywords').value = Array.isArray(agent.handoffKeywords) ? agent.handoffKeywords.join(', ') : (agent.handoffKeywords || '');
    document.getElementById('modal-agent-handoffMessage').value = agent.handoffMessage || '';
    document.getElementById('modal-agent-pauseHours').value = agent.pauseDurationHours || (agent.pauseDurationMinutes ? (agent.pauseDurationMinutes / 60) : 6);
    document.getElementById('modal-agent-debounce').value = agent.debounceSeconds ?? 2.5;
    document.getElementById('modal-agent-typing').checked = agent.enableTypingSimulation !== false;
    document.getElementById('modal-agent-seen').checked = agent.enableSendSeen !== false;

    const bh = agent.businessHours || {};
    document.getElementById('modal-sched-enabled').checked = !!bh.enabled;
    document.getElementById('modal-sched-outOfHoursMessage').value = bh.outOfHoursMessage || '';

    renderModalScheduleTable(bh.schedule || {});

    document.querySelector('.editor-tab-btn[data-modaltab="general"]')?.click();
    showAgentEditor();
  } catch (err) {
    showToast(`Erro ao carregar agente: ${err.message}`, 'error');
  }
}

// Event Listeners de Botões
document.getElementById('btn-create-agent')?.addEventListener('click', openNewAgentModal);
document.getElementById('btn-back-to-agents')?.addEventListener('click', closeAgentModal);
document.getElementById('btn-cancel-agent-top')?.addEventListener('click', closeAgentModal);
document.getElementById('btn-cancel-agent-bottom')?.addEventListener('click', closeAgentModal);

// Salvar Agente no Formulário (Top ou Bottom)
document.getElementById('agent-modal-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const id = document.getElementById('modal-agent-id').value.trim();
  const saveBtn = document.getElementById('btn-save-agent-modal');
  const saveBtnTop = document.getElementById('btn-save-agent-top');

  const setSaving = (saving) => {
    if (saveBtn) {
      saveBtn.disabled = saving;
      saveBtn.textContent = saving ? 'Salvando...' : '💾 Salvar Agente';
    }
    if (saveBtnTop) {
      saveBtnTop.disabled = saving;
      saveBtnTop.textContent = saving ? 'Salvando...' : '💾 Salvar Agente';
    }
  };

  setSaving(true);

  try {
    // Coleta dias da semana
    const schedule = {};
    for (const day of SCHEDULE_DAYS) {
      const row = document.getElementById(`modal-sched-row-${day.key}`);
      const enabled = row?.querySelector('.modal-day-enabled')?.checked ?? true;
      const start = row?.querySelector('.modal-day-start')?.value || '08:00';
      const end = row?.querySelector('.modal-day-end')?.value || '18:00';
      const hasLunch = row?.querySelector('.modal-day-lunch')?.checked ?? false;
      const lunchStart = row?.querySelector('.modal-lunch-start')?.value || '12:00';
      const lunchEnd = row?.querySelector('.modal-lunch-end')?.value || '13:00';

      schedule[day.key] = { enabled, start, end, hasLunch, lunchStart, lunchEnd };
    }

    const keywordsRaw = document.getElementById('modal-agent-handoffKeywords').value;
    const keywords = keywordsRaw.split(',').map(k => k.trim()).filter(k => k.length > 0);

    const payload = {
      name: document.getElementById('modal-agent-name').value.trim(),
      companyName: document.getElementById('modal-agent-company').value.trim(),
      wahaSession: document.getElementById('modal-agent-session').value.trim() || '*',
      description: document.getElementById('modal-agent-description').value.trim(),
      active: document.getElementById('modal-agent-active').checked,
      isDefault: document.getElementById('modal-agent-isDefault').checked,
      llmProvider: document.getElementById('modal-agent-llmProvider').value,
      openaiApiKey: document.getElementById('modal-agent-openaiApiKey').value.trim(),
      openaiModel: document.getElementById('modal-agent-openaiModel').value,
      geminiApiKey: document.getElementById('modal-agent-geminiApiKey').value.trim(),
      model: document.getElementById('modal-agent-model').value,
      temperature: parseFloat(document.getElementById('modal-agent-temperature').value) || 0.4,
      systemInstruction: document.getElementById('modal-agent-systemInstruction').value.trim(),
      businessInfo: document.getElementById('modal-agent-businessInfo').value.trim(),
      handoffKeywords: keywords,
      handoffMessage: document.getElementById('modal-agent-handoffMessage').value.trim(),
      pauseDurationHours: parseFloat(document.getElementById('modal-agent-pauseHours').value) || 6,
      debounceSeconds: parseFloat(document.getElementById('modal-agent-debounce').value) || 2.5,
      enableTypingSimulation: document.getElementById('modal-agent-typing').checked,
      enableSendSeen: document.getElementById('modal-agent-seen').checked,
      businessHours: {
        enabled: document.getElementById('modal-sched-enabled').checked,
        outOfHoursMessage: document.getElementById('modal-sched-outOfHoursMessage').value.trim(),
        schedule
      }
    };

    const url = id ? `/api/agents/${id}` : '/api/agents';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao salvar agente.');
    }

    showToast(id ? 'Agente atualizado com sucesso!' : 'Novo agente criado com sucesso!', 'success');
    closeAgentModal();
    await loadAgents();
    checkStatus();
  } catch (err) {
    showToast(`Erro ao salvar: ${err.message}`, 'error');
  } finally {
    setSaving(false);
  }
});

async function duplicateAgent(id) {
  try {
    const res = await fetchWithAuth(`/api/agents/${id}/duplicate`, { method: 'POST' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao duplicar.');
    showToast(`Agente duplicado com sucesso: "${data.agent?.name}"`, 'success');
    await loadAgents();
  } catch (err) {
    showToast(`Erro ao duplicar agente: ${err.message}`, 'error');
  }
}

async function deleteAgent(id, name) {
  if (!confirm(`Tem certeza que deseja excluir o agente "${name}"?\nEsta ação não poderá ser desfeita.`)) {
    return;
  }

  try {
    const res = await fetchWithAuth(`/api/agents/${id}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao excluir.');
    showToast(`Agente "${name}" excluído com sucesso.`, 'success');
    await loadAgents();
  } catch (err) {
    showToast(`Erro ao excluir agente: ${err.message}`, 'error');
  }
}

document.getElementById('btn-logout')?.addEventListener('click', async () => {
  try {
    await fetchWithAuth('/api/auth/logout', { method: 'POST' });
  } catch (_) {}
  clearAuthToken();
  showLoginModal();
});

// ============================================================================
// SISTEMA DE AGENDAMENTO, TIMELINE, KANBAN E NOTIFICAÇÕES (FRONTEND)
// ============================================================================

let appointmentsState = [];
let specialistsState = [];
let servicesState = [];
let encaixesState = [];
let allAgentsCache = [];
let currentAppointmentsView = 'timeline'; // 'timeline' | 'kanban' | 'table'
let currentAppointmentsDateFilter = 'today';
let currentAppointmentsDateValue = '';
let currentAppointmentsAgentFilter = 'all';
let currentAppointmentsSpecialistFilter = 'all';
let currentAppointmentsStatusFilter = 'all';
let currentAppointmentsSearch = '';

function getTodayString() {
  const d = new Date();
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getTomorrowString() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateBR(dateStr) {
  if (!dateStr || !dateStr.includes('-')) return dateStr || '';
  const [y, m, d] = dateStr.split('-');
  return `${d}/${m}/${y}`;
}

function getStatusPill(status) {
  switch (status) {
    case 'scheduled':
    case 'confirmed':
      return `<span class="status-pill pill-confirmed">🔵 Confirmado</span>`;
    case 'presence_confirmed':
      return `<span class="status-pill pill-presence_confirmed">✅ Presença D-1</span>`;
    case 'waiting':
      return `<span class="status-pill pill-waiting">⏳ Recepção</span>`;
    case 'in_progress':
      return `<span class="status-pill pill-in_progress">🩺 Em Atendimento</span>`;
    case 'completed':
      return `<span class="status-pill pill-completed">🟣 Concluído</span>`;
    case 'cancelled':
      return `<span class="status-pill pill-cancelled">❌ Cancelado</span>`;
    case 'cancelled_by_patient':
      return `<span class="status-pill pill-cancelled_by_patient">⚠️ Desistência D-1</span>`;
    default:
      return `<span class="status-pill">${status}</span>`;
  }
}

/**
 * Carrega todos os dados da Central de Agendamentos
 */
async function loadAppointments() {
  if (!getAuthToken()) return;

  if (!currentAppointmentsDateValue) {
    currentAppointmentsDateValue = getTodayString();
    const dateInput = document.getElementById('apt-filter-date');
    if (dateInput) dateInput.value = currentAppointmentsDateValue;
  }

  try {
    // 1. Carrega Especialistas, Serviços e Agentes
    const [specRes, srvRes, agentsRes] = await Promise.all([
      fetchWithAuth('/api/specialists'),
      fetchWithAuth('/api/services'),
      fetchWithAuth('/api/agents')
    ]);

    if (agentsRes.ok) {
      const data = await agentsRes.json();
      allAgentsCache = data.agents || [];
      populateAgentsDropdowns(allAgentsCache);
    }

    if (specRes.ok) {
      const data = await specRes.json();
      specialistsState = data.specialists || [];
      populateSpecialistsDropdowns(currentAppointmentsAgentFilter);
    }

    if (srvRes.ok) {
      const data = await srvRes.json();
      servicesState = data.services || [];
      populateServicesDropdowns(currentAppointmentsAgentFilter);
    }

    // 2. Parâmetros de busca de agendamentos
    const query = new URLSearchParams();
    if (currentAppointmentsDateFilter !== 'all' && currentAppointmentsDateValue) {
      query.set('date', currentAppointmentsDateValue);
    }
    if (currentAppointmentsAgentFilter !== 'all') {
      query.set('agentId', currentAppointmentsAgentFilter);
    }
    if (currentAppointmentsSpecialistFilter !== 'all') {
      query.set('specialistId', currentAppointmentsSpecialistFilter);
    }
    if (currentAppointmentsStatusFilter !== 'all') {
      query.set('status', currentAppointmentsStatusFilter);
    }

    // 3. Busca Agendamentos, Resumo e Encaixes
    const [aptsRes, sumRes, encRes] = await Promise.all([
      fetchWithAuth(`/api/appointments?${query.toString()}`),
      fetchWithAuth(`/api/appointments/summary?date=${currentAppointmentsDateValue}&agentId=${currentAppointmentsAgentFilter}`),
      fetchWithAuth(`/api/appointments/encaixes?agentId=${currentAppointmentsAgentFilter}`)
    ]);

    if (aptsRes.ok) {
      const data = await aptsRes.json();
      appointmentsState = data.appointments || [];
    }

    if (sumRes.ok) {
      const data = await sumRes.json();
      renderKPIs(data.summary);
    }

    if (encRes.ok) {
      const data = await encRes.json();
      encaixesState = data.encaixes || [];
      renderEncaixeBanner();
    }

    // Atualiza badge de data
    const dateBadge = document.getElementById('badge-appointments-date');
    if (dateBadge) {
      let clientPrefix = '';
      if (currentAppointmentsAgentFilter !== 'all') {
        const found = allAgentsCache.find(a => a.id === currentAppointmentsAgentFilter);
        if (found) clientPrefix = `[${found.name}] `;
      }

      if (currentAppointmentsDateFilter === 'today') {
        dateBadge.textContent = `${clientPrefix}📅 Hoje: ${formatDateBR(currentAppointmentsDateValue)}`;
      } else if (currentAppointmentsDateFilter === 'tomorrow') {
        dateBadge.textContent = `${clientPrefix}📅 Amanhã: ${formatDateBR(currentAppointmentsDateValue)}`;
      } else if (currentAppointmentsDateFilter === 'all') {
        dateBadge.textContent = `${clientPrefix}📅 Todas as Datas`;
      } else {
        dateBadge.textContent = `${clientPrefix}📅 Data: ${formatDateBR(currentAppointmentsDateValue)}`;
      }
    }

    renderAppointments();
  } catch (err) {
    console.error('[Appointments] Erro ao carregar:', err);
  }
}

/**
 * Atualiza cards de KPIs
 */
function renderKPIs(summary) {
  if (!summary) return;
  document.getElementById('kpi-total').textContent = summary.total || 0;
  document.getElementById('kpi-confirmed').textContent = summary.confirmed || 0;
  document.getElementById('kpi-presence').textContent = summary.presenceConfirmed || 0;
  document.getElementById('kpi-progress').textContent = summary.inProgress || 0;
  document.getElementById('kpi-completed').textContent = summary.completed || 0;
  document.getElementById('kpi-cancelled').textContent = summary.cancelled || 0;
  document.getElementById('kpi-encaixes').textContent = summary.encaixes || 0;
}

/**
 * Banner de Oportunidades de Encaixe
 */
function renderEncaixeBanner() {
  const banner = document.getElementById('encaixe-alert-banner');
  const msgEl = document.getElementById('encaixe-banner-msg');
  if (!banner || !msgEl) return;

  if (encaixesState.length > 0) {
    banner.style.display = 'flex';
    msgEl.textContent = `Existem ${encaixesState.length} vaga(s) liberada(s) por cancelamento ou desistência de pacientes para Hoje / Amanhã. Aproveite para encaixar novos pacientes!`;
  } else {
    banner.style.display = 'none';
  }
}

/**
 * Preenche dropdowns de agentes em todas as áreas
 */
function populateAgentsDropdowns(agents) {
  const filterSelect = document.getElementById('apt-filter-agent');
  const modalSelect = document.getElementById('modal-apt-agent');
  const specAgentSelect = document.getElementById('spec-agent');
  const srvAgentSelect = document.getElementById('service-agent');

  if (filterSelect) {
    const current = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">🌐 Todos os Clientes (Visão Geral)</option>';
    agents.forEach(a => {
      filterSelect.innerHTML += `<option value="${a.id}">🏢 ${a.name} (${a.companyName || 'Empresa'})</option>`;
    });
    if (current) filterSelect.value = current;
  }

  if (modalSelect) {
    const current = modalSelect.value;
    modalSelect.innerHTML = '';
    agents.forEach(a => {
      modalSelect.innerHTML += `<option value="${a.id}">🏢 ${a.name} - ${a.companyName || 'Empresa'}</option>`;
    });
    if (current) modalSelect.value = current;
  }

  if (specAgentSelect) {
    const current = specAgentSelect.value;
    specAgentSelect.innerHTML = '<option value="*">🌐 Todos os Clientes (Global)</option>';
    agents.forEach(a => {
      specAgentSelect.innerHTML += `<option value="${a.id}">🏢 ${a.name} (${a.companyName || 'Empresa'})</option>`;
    });
    if (current) specAgentSelect.value = current;
  }

  if (srvAgentSelect) {
    const current = srvAgentSelect.value;
    srvAgentSelect.innerHTML = '<option value="*">🌐 Todos os Clientes (Global)</option>';
    agents.forEach(a => {
      srvAgentSelect.innerHTML += `<option value="${a.id}">🏢 ${a.name} (${a.companyName || 'Empresa'})</option>`;
    });
    if (current) srvAgentSelect.value = current;
  }
}

/**
 * Preenche dropdowns de especialistas (opcionalmente filtrado por agente/cliente)
 */
function populateSpecialistsDropdowns(forAgentId) {
  const filterSelect = document.getElementById('apt-filter-specialist');
  const modalSelect = document.getElementById('modal-apt-specialist');

  let list = specialistsState.filter(s => s.active);
  if (forAgentId && forAgentId !== 'all') {
    list = list.filter(s => s.agentId === forAgentId || s.agentId === '*' || !s.agentId);
  }

  if (filterSelect) {
    const current = filterSelect.value;
    filterSelect.innerHTML = '<option value="all">Todos os Especialistas</option>';
    list.forEach(s => {
      filterSelect.innerHTML += `<option value="${s.id}">${s.name} (${s.role})</option>`;
    });
    if (current && list.some(s => s.id === current)) filterSelect.value = current;
    else filterSelect.value = 'all';
  }

  if (modalSelect) {
    const current = modalSelect.value;
    modalSelect.innerHTML = '<option value="">Selecione um profissional...</option>';
    list.forEach(s => {
      modalSelect.innerHTML += `<option value="${s.id}">${s.name} - ${s.role}</option>`;
    });
    if (current && list.some(s => s.id === current)) modalSelect.value = current;
  }
}

/**
 * Preenche dropdowns de serviços (opcionalmente filtrado por agente/cliente)
 */
function populateServicesDropdowns(forAgentId) {
  const modalSelect = document.getElementById('modal-apt-service');
  if (modalSelect) {
    let list = servicesState.filter(s => s.active);
    if (forAgentId && forAgentId !== 'all') {
      list = list.filter(s => s.agentId === forAgentId || s.agentId === '*' || !s.agentId);
    }

    const current = modalSelect.value;
    modalSelect.innerHTML = '<option value="">Consulta Padrão</option>';
    list.forEach(s => {
      modalSelect.innerHTML += `<option value="${s.id}">${s.name} (${s.durationMinutes} min) ${s.price ? `- R$ ${s.price.toFixed(2)}` : ''}</option>`;
    });
    if (current && list.some(s => s.id === current)) modalSelect.value = current;
  }
}

/**
 * Filtra e despacha renderização da visão ativa
 */
function renderAppointments() {
  let list = [...appointmentsState];

  // Filtro de busca textual
  if (currentAppointmentsSearch.trim()) {
    const q = currentAppointmentsSearch.toLowerCase().trim();
    list = list.filter(a =>
      a.clientName.toLowerCase().includes(q) ||
      a.clientPhone.includes(q) ||
      a.specialistName.toLowerCase().includes(q) ||
      a.serviceName.toLowerCase().includes(q) ||
      (a.notes && a.notes.toLowerCase().includes(q))
    );
  }

  // Alterna visibilidade dos containers
  const timelineView = document.getElementById('appointments-timeline-view');
  const kanbanView = document.getElementById('appointments-kanban-view');
  const tableView = document.getElementById('appointments-table-view');

  if (timelineView) timelineView.style.display = currentAppointmentsView === 'timeline' ? 'block' : 'none';
  if (kanbanView) kanbanView.style.display = currentAppointmentsView === 'kanban' ? 'block' : 'none';
  if (tableView) tableView.style.display = currentAppointmentsView === 'table' ? 'block' : 'none';

  if (currentAppointmentsView === 'timeline') {
    renderTimelineView(list);
  } else if (currentAppointmentsView === 'kanban') {
    renderKanbanView(list);
  } else if (currentAppointmentsView === 'table') {
    renderTableView(list);
  }
}

/**
 * VISÃO 1: Linha do Tempo / Grade de Horários por Especialista
 */
async function renderTimelineView(apts) {
  const container = document.getElementById('appointments-timeline-view');
  if (!container) return;

  const targetDate = currentAppointmentsDateValue || getTodayString();
  let specialists = specialistsState.filter(s => s.active);

  if (currentAppointmentsAgentFilter !== 'all') {
    specialists = specialists.filter(s => s.agentId === currentAppointmentsAgentFilter || s.agentId === '*' || !s.agentId);
  }

  if (currentAppointmentsSpecialistFilter !== 'all') {
    specialists = specialists.filter(s => s.id === currentAppointmentsSpecialistFilter);
  }

  if (specialists.length === 0) {
    container.innerHTML = `
      <div class="card text-center p-5">
        <p class="text-muted">Nenhum especialista cadastrado ou ativo para o cliente selecionado.</p>
        <button class="btn btn-primary btn-sm mt-2" onclick="openSpecialistsModal()">Cadastrar Especialista</button>
      </div>`;
    return;
  }

  let html = '';

  for (const spec of specialists) {
    const specApts = apts.filter(a => a.specialistId === spec.id);
    const specAgent = allAgentsCache.find(a => a.id === spec.agentId);
    const agentTag = spec.agentId && spec.agentId !== '*'
      ? `<span class="badge badge-purple" style="font-size: 11px;">🏢 ${specAgent ? specAgent.name : spec.agentId}</span>`
      : `<span class="badge badge-info" style="font-size: 11px;">🌐 Global</span>`;

    html += `
      <div class="timeline-specialist-block">
        <div class="timeline-header">
          <div class="timeline-spec-info">
            <div class="timeline-spec-avatar">👨‍⚕️</div>
            <div class="timeline-spec-text">
              <h3>${spec.name}</h3>
              <p>${spec.role} • WhatsApp: ${spec.phone} • Atendimento: ${spec.workHoursStart} às ${spec.workHoursEnd}</p>
            </div>
          </div>
          <div class="timeline-spec-badges">
            ${agentTag}
            <span class="badge badge-info">${specApts.length} atendimento(s) no dia</span>
            <button class="btn btn-sm btn-outline" onclick="openNewAppointmentModal({ specialistId: '${spec.id}', agentId: '${spec.agentId !== '*' ? spec.agentId : ''}', date: '${targetDate}' })">
              ➕ Agendar com ${spec.name.split(' ')[0]}
            </button>
          </div>
        </div>

        <div class="timeline-slots-grid" id="slots-grid-${spec.id}">
          <div class="p-3 text-muted"><small>Calculando horários livres e consultas...</small></div>
        </div>
      </div>
    `;
  }

  container.innerHTML = html;

  // Carrega assincronamente os slots de cada especialista para não travar a UI
  for (const spec of specialists) {
    loadSpecialistTimelineSlots(spec, targetDate, apts.filter(a => a.specialistId === spec.id));
  }
}

/**
 * Carrega e renderiza a grade completa de horários (ocupados + livres + encaixes)
 */
async function loadSpecialistTimelineSlots(specialist, targetDate, specApts) {
  const gridEl = document.getElementById(`slots-grid-${specialist.id}`);
  if (!gridEl) return;

  try {
    const res = await fetchWithAuth(`/api/appointments/slots?specialistId=${specialist.id}&date=${targetDate}`);
    const data = await res.json();
    const freeSlots = data.slots || [];

    // Mapeia agendamentos por startTime
    const aptsByTime = new Map();
    specApts.forEach(a => aptsByTime.set(a.startTime, a));

    // Monta todos os horários únicos ordenados
    const allTimes = Array.from(new Set([...freeSlots, ...specApts.map(a => a.startTime)])).sort();

    if (allTimes.length === 0) {
      gridEl.innerHTML = `<div class="p-3 text-muted" style="grid-column: 1 / -1;"><small>Sem horários disponíveis ou expediente encerrado para esta data.</small></div>`;
      return;
    }

    let cardsHtml = '';

    allTimes.forEach(time => {
      const apt = aptsByTime.get(time);

      if (apt) {
        // Se foi cancelado, destaca como vaga de encaixe
        const isCancelled = apt.status === 'cancelled' || apt.status === 'cancelled_by_patient';

        if (isCancelled) {
          cardsHtml += `
            <div class="slot-card slot-card-encaixe" onclick="openNewAppointmentModal({ specialistId: '${specialist.id}', date: '${targetDate}', startTime: '${time}' })" title="Clique para agendar novo paciente nesta vaga liberada!">
              <div class="slot-header">
                <span class="slot-time">🕒 ${apt.startTime}</span>
                <span class="badge badge-warning" style="font-size: 10px;">⚡ ENCAIXE LIVRE</span>
              </div>
              <div class="slot-patient-name text-amber">${apt.clientName} (Desistiu)</div>
              <div class="slot-service-name">${apt.serviceName}</div>
              <div class="slot-free-cta">✨ Vaga liberada! Clique para realocar</div>
            </div>
          `;
        } else {
          // Consulta agendada ativa
          cardsHtml += `
            <div class="slot-card slot-card-booked status-${apt.status}">
              <div class="slot-header">
                <span class="slot-time">🕒 ${apt.startTime} às ${apt.endTime}</span>
                ${getStatusPill(apt.status)}
              </div>
              <div class="slot-patient-name" title="${apt.clientName}">👤 ${apt.clientName}</div>
              <div class="slot-service-name">🩺 ${apt.serviceName}</div>
              <div class="slot-patient-phone">
                <span>📱 ${apt.clientPhone}</span>
                ${apt.reminderSent ? '<span title="Lembrete D-1 enviado">🔔</span>' : ''}
              </div>
              <div class="slot-card-actions">
                <div class="slot-actions-btns">
                  <a href="https://wa.me/${apt.clientPhone.replace(/\D/g, '')}" target="_blank" class="slot-action-btn btn-act-whatsapp" title="Conversar no WhatsApp">💬</a>
                  <button class="slot-action-btn" onclick="reNotifySpecialist('${apt.id}')" title="Reenviar notificação no WhatsApp do especialista">🔔 Médico</button>
                  <button class="slot-action-btn" onclick="sendIndividualReminder('${apt.id}')" title="Enviar Lembrete D-1 ao Paciente">📩 D-1</button>
                </div>
                <div class="dropdown-quick-status">
                  <select class="kanban-card-status-select" onchange="updateAppointmentStatus('${apt.id}', this.value)">
                    <option value="confirmed" ${apt.status === 'confirmed' ? 'selected' : ''}>Confirmado</option>
                    <option value="presence_confirmed" ${apt.status === 'presence_confirmed' ? 'selected' : ''}>Presença D-1</option>
                    <option value="waiting" ${apt.status === 'waiting' ? 'selected' : ''}>Recepção</option>
                    <option value="in_progress" ${apt.status === 'in_progress' ? 'selected' : ''}>Em Atendimento</option>
                    <option value="completed" ${apt.status === 'completed' ? 'selected' : ''}>Concluído</option>
                    <option value="cancelled" ${apt.status === 'cancelled' ? 'selected' : ''}>Cancelar</option>
                  </select>
                </div>
              </div>
            </div>
          `;
        }
      } else {
        // Horário vago disponível para marcação imediata
        cardsHtml += `
          <div class="slot-card slot-card-free" onclick="openNewAppointmentModal({ specialistId: '${specialist.id}', date: '${targetDate}', startTime: '${time}' })" title="Clique para agendar neste horário">
            <div class="slot-free-time">🕒 ${time}</div>
            <div class="slot-free-cta">➕ Vaga Livre (Marcar)</div>
          </div>
        `;
      }
    });

    gridEl.innerHTML = cardsHtml;
  } catch (err) {
    gridEl.innerHTML = `<div class="p-3 text-danger"><small>Erro ao carregar horários livres.</small></div>`;
  }
}

/**
 * VISÃO 2: Visualização Kanban por Status
 */
function renderKanbanView(apts) {
  const container = document.getElementById('appointments-kanban-view');
  if (!container) return;

  const columns = [
    { key: 'confirmed', label: '🔵 Confirmados', statuses: ['confirmed', 'scheduled'] },
    { key: 'presence_confirmed', label: '✅ Presença Confirmada (D-1)', statuses: ['presence_confirmed'] },
    { key: 'waiting', label: '⏳ Aguardando Recepção', statuses: ['waiting'] },
    { key: 'in_progress', label: '🩺 Em Atendimento', statuses: ['in_progress'] },
    { key: 'completed', label: '🟣 Concluídos', statuses: ['completed'] },
    { key: 'cancelled', label: '❌ Cancelados / Encaixes', statuses: ['cancelled', 'cancelled_by_patient'] }
  ];

  let boardHtml = `<div class="kanban-board">`;

  columns.forEach(col => {
    const colApts = apts.filter(a => col.statuses.includes(a.status));

    boardHtml += `
      <div class="kanban-column">
        <div class="kanban-column-header">
          <div class="kanban-column-title">${col.label}</div>
          <span class="kanban-column-badge">${colApts.length}</span>
        </div>
        <div class="kanban-column-cards">
    `;

    if (colApts.length === 0) {
      boardHtml += `<div class="p-3 text-center text-muted"><small>Nenhum atendimento nesta coluna</small></div>`;
    } else {
      colApts.forEach(apt => {
        boardHtml += `
          <div class="kanban-card">
            <div class="d-flex justify-between align-center">
              <span class="slot-time">🕒 ${apt.startTime} - ${apt.endTime}</span>
              <span class="badge badge-sm badge-info">${formatDateBR(apt.date)}</span>
            </div>
            <div class="kanban-card-patient">${apt.clientName}</div>
            <div class="kanban-card-meta">
              <span>👨‍⚕️ ${apt.specialistName} (${apt.specialistRole})</span>
              <span>🩺 ${apt.serviceName}</span>
              <span>📱 ${apt.clientPhone}</span>
              ${apt.notes ? `<span class="text-muted">📝 "${apt.notes}"</span>` : ''}
            </div>
            <div class="kanban-card-actions">
              <div class="d-flex gap-1">
                <a href="https://wa.me/${apt.clientPhone.replace(/\D/g, '')}" target="_blank" class="slot-action-btn btn-act-whatsapp" title="Abrir WhatsApp">💬</a>
                <button class="slot-action-btn" onclick="reNotifySpecialist('${apt.id}')" title="Avisar Médico">👨‍⚕️</button>
              </div>
              <select class="kanban-card-status-select" onchange="updateAppointmentStatus('${apt.id}', this.value)">
                <option value="confirmed" ${apt.status === 'confirmed' ? 'selected' : ''}>Confirmado</option>
                <option value="presence_confirmed" ${apt.status === 'presence_confirmed' ? 'selected' : ''}>Presença D-1</option>
                <option value="waiting" ${apt.status === 'waiting' ? 'selected' : ''}>Recepção</option>
                <option value="in_progress" ${apt.status === 'in_progress' ? 'selected' : ''}>Em Atendimento</option>
                <option value="completed" ${apt.status === 'completed' ? 'selected' : ''}>Concluído</option>
                <option value="cancelled" ${apt.status === 'cancelled' ? 'selected' : ''}>Cancelar</option>
              </select>
            </div>
          </div>
        `;
      });
    }

    boardHtml += `
        </div>
      </div>
    `;
  });

  boardHtml += `</div>`;
  container.innerHTML = boardHtml;
}

/**
 * VISÃO 3: Tabela Detalhada
 */
function renderTableView(apts) {
  const tbody = document.getElementById('appointments-table-body');
  if (!tbody) return;

  if (apts.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center p-4 text-muted">Nenhum agendamento localizado para os filtros selecionados.</td></tr>`;
    return;
  }

  let html = '';
  apts.forEach(apt => {
    html += `
      <tr>
        <td>
          <strong>${formatDateBR(apt.date)}</strong><br>
          <span class="text-muted" style="font-family: monospace;">${apt.startTime} às ${apt.endTime}</span>
        </td>
        <td>
          <strong>${apt.clientName}</strong>
          ${apt.notes ? `<br><small class="text-muted">${apt.notes}</small>` : ''}
        </td>
        <td>
          <a href="https://wa.me/${apt.clientPhone.replace(/\D/g, '')}" target="_blank" class="text-emerald" style="text-decoration: none;">
            📱 ${apt.clientPhone}
          </a>
        </td>
        <td>
          <strong>${apt.specialistName}</strong><br>
          <small class="text-muted">${apt.specialistRole}</small>
        </td>
        <td>${apt.serviceName}</td>
        <td>${getStatusPill(apt.status)}</td>
        <td>
          <span class="badge ${apt.bookedVia === 'whatsapp' ? 'badge-info' : 'badge-outline'}" style="font-size: 10.5px;">
            ${apt.bookedVia === 'whatsapp' ? '🟢 WhatsApp' : '🖥️ Painel'}
          </span>
        </td>
        <td>
          <small>
            ${apt.notifiedSpecialist ? '👨‍⚕️ Médico avisado ✅' : '👨‍⚕️ Pendente'}<br>
            ${apt.reminderSent ? '🔔 Lembrete D-1 enviado ✅' : '🔔 Sem lembrete'}
          </small>
        </td>
        <td style="text-align: right;">
          <div class="d-flex justify-end gap-1">
            <select class="kanban-card-status-select" onchange="updateAppointmentStatus('${apt.id}', this.value)" style="max-width: 120px;">
              <option value="confirmed" ${apt.status === 'confirmed' ? 'selected' : ''}>Confirmado</option>
              <option value="presence_confirmed" ${apt.status === 'presence_confirmed' ? 'selected' : ''}>Presença D-1</option>
              <option value="waiting" ${apt.status === 'waiting' ? 'selected' : ''}>Recepção</option>
              <option value="in_progress" ${apt.status === 'in_progress' ? 'selected' : ''}>Atendimento</option>
              <option value="completed" ${apt.status === 'completed' ? 'selected' : ''}>Concluído</option>
              <option value="cancelled" ${apt.status === 'cancelled' ? 'selected' : ''}>Cancelar</option>
            </select>
            <button class="btn btn-sm btn-outline" onclick="reNotifySpecialist('${apt.id}')" title="Reenviar Alerta ao Especialista">🔔</button>
            <button class="btn btn-sm btn-outline" onclick="sendIndividualReminder('${apt.id}')" title="Enviar Lembrete D-1">📩</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteAppointment('${apt.id}')" title="Excluir Definitivamente">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

/**
 * Atualiza status de um agendamento
 */
async function updateAppointmentStatus(id, newStatus) {
  try {
    const res = await fetchWithAuth(`/api/appointments/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus })
    });

    if (!res.ok) {
      const data = await res.json();
      throw new Error(data.error || 'Falha ao atualizar status.');
    }

    showToast(`Status atualizado com sucesso!`, 'success');
    await loadAppointments();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

/**
 * Reenvia notificação no WhatsApp do especialista
 */
async function reNotifySpecialist(id) {
  try {
    showToast('Enviando alerta para o WhatsApp do especialista...', 'info');
    const res = await fetchWithAuth(`/api/appointments/${id}/notify`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.sent) {
      showToast('Notificação enviada com sucesso no WhatsApp do especialista!', 'success');
      loadAppointments();
    } else {
      showToast('Especialista sem telefone cadastrado ou falha no envio.', 'warning');
    }
  } catch (err) {
    showToast(`Erro ao notificar: ${err.message}`, 'error');
  }
}

/**
 * Envia lembrete D-1 individual para um paciente
 */
async function sendIndividualReminder(id) {
  try {
    showToast('Enviando lembrete D-1 ao paciente...', 'info');
    const res = await fetchWithAuth(`/api/appointments/${id}/send-reminder`, { method: 'POST' });
    const data = await res.json();

    if (res.ok && data.sent) {
      showToast('Lembrete D-1 enviado ao WhatsApp do paciente!', 'success');
      loadAppointments();
    } else {
      showToast('Não foi possível enviar o lembrete.', 'warning');
    }
  } catch (err) {
    showToast(`Erro ao enviar lembrete: ${err.message}`, 'error');
  }
}

/**
 * Disparo em lote de Lembretes D-1 para amanhã
 */
async function triggerBatchReminders() {
  const tomorrowStr = getTomorrowString();
  if (!confirm(`Deseja disparar lembretes de confirmação de presença (D-1) pelo WhatsApp para TODOS os pacientes com consulta agendada para amanhã (${formatDateBR(tomorrowStr)})?`)) {
    return;
  }

  try {
    showToast('Disparando lembretes D-1 em lote...', 'info');
    const res = await fetchWithAuth('/api/appointments/send-reminders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agentId: currentAppointmentsAgentFilter })
    });
    const data = await res.json();

    if (res.ok) {
      showToast(`Disparo concluído: ${data.sent} de ${data.total} lembrete(s) enviado(s) para amanhã!`, 'success');
      loadAppointments();
    } else {
      showToast(data.error || 'Erro ao disparar lembretes.', 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

/**
 * Exclui agendamento
 */
async function deleteAppointment(id) {
  if (!confirm('Deseja realmente excluir este agendamento?')) return;

  try {
    const res = await fetchWithAuth(`/api/appointments/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Agendamento excluído com sucesso.', 'success');
      loadAppointments();
    }
  } catch (err) {
    showToast(`Erro ao excluir: ${err.message}`, 'error');
  }
}

// ============================================================================
// MODAL DE NOVO / EDITAR AGENDAMENTO
// ============================================================================

async function openNewAppointmentModal(prefill = {}) {
  const overlay = document.getElementById('modal-appointment-overlay');
  if (!overlay) return;

  document.getElementById('modal-appointment-form').reset();
  document.getElementById('modal-apt-id').value = '';

  const dateInput = document.getElementById('modal-apt-date');
  const specSelect = document.getElementById('modal-apt-specialist');
  const agentSelect = document.getElementById('modal-apt-agent');
  const serviceSelect = document.getElementById('modal-apt-service');

  // Seleciona o cliente/agente apropriado
  const targetAgentId = prefill.agentId || (currentAppointmentsAgentFilter !== 'all' ? currentAppointmentsAgentFilter : '');
  if (targetAgentId && agentSelect) {
    agentSelect.value = targetAgentId;
  } else if (agentSelect && agentSelect.options.length > 0) {
    agentSelect.selectedIndex = 0;
  }

  const effectiveAgent = agentSelect?.value || 'default';
  populateSpecialistsDropdowns(effectiveAgent);
  populateServicesDropdowns(effectiveAgent);

  // Preenche especialista
  if (prefill.specialistId && specSelect) {
    specSelect.value = prefill.specialistId;
  } else if (specSelect && specSelect.options.length > 1) {
    specSelect.selectedIndex = 1;
  }

  // Preenche data
  const targetDate = prefill.date || currentAppointmentsDateValue || getTodayString();
  if (dateInput) {
    dateInput.value = targetDate;
  }

  // Preenche serviço se fornecido
  if (prefill.serviceId && serviceSelect) {
    serviceSelect.value = prefill.serviceId;
  }

  overlay.style.display = 'flex';

  // Carrega horários livres dinamicamente
  await loadAvailableSlotsForModal(prefill.startTime);
}

function closeAppointmentModal() {
  const overlay = document.getElementById('modal-appointment-overlay');
  if (overlay) overlay.style.display = 'none';
}

/**
 * Atualiza horários livres no modal ao mudar Especialista ou Data
 */
async function loadAvailableSlotsForModal(preferredSlot = '') {
  const specId = document.getElementById('modal-apt-specialist')?.value;
  const dateStr = document.getElementById('modal-apt-date')?.value;
  const timeSelect = document.getElementById('modal-apt-time');
  const hintEl = document.getElementById('modal-slot-hint');

  if (!timeSelect) return;

  if (!specId || !dateStr) {
    timeSelect.innerHTML = '<option value="">Selecione especialista e data...</option>';
    return;
  }

  timeSelect.innerHTML = '<option value="">Buscando horários disponíveis...</option>';

  try {
    const res = await fetchWithAuth(`/api/appointments/slots?specialistId=${specId}&date=${dateStr}`);
    const data = await res.json();
    const slots = data.slots || [];

    if (slots.length === 0) {
      timeSelect.innerHTML = '<option value="">Nenhum horário livre nesta data</option>';
      if (hintEl) hintEl.textContent = 'Todos os horários estão ocupados ou o especialista não atende neste dia.';
      return;
    }

    let optionsHtml = '<option value="">Selecione um horário disponível...</option>';
    slots.forEach(s => {
      const isPref = s === preferredSlot ? 'selected' : '';
      optionsHtml += `<option value="${s}" ${isPref}>🕒 ${s}</option>`;
    });

    timeSelect.innerHTML = optionsHtml;
    if (hintEl) hintEl.textContent = `${slots.length} horário(s) livre(s) encontrado(s) sem conflitos.`;
  } catch (err) {
    timeSelect.innerHTML = '<option value="">Erro ao buscar horários</option>';
  }
}

// Event Listeners para recarregar slots livres no modal
document.getElementById('modal-apt-specialist')?.addEventListener('change', () => loadAvailableSlotsForModal());
document.getElementById('modal-apt-date')?.addEventListener('change', () => loadAvailableSlotsForModal());

// Atualiza especialistas e serviços quando trocar o cliente no modal
document.getElementById('modal-apt-agent')?.addEventListener('change', (e) => {
  const agentId = e.target.value;
  populateSpecialistsDropdowns(agentId);
  populateServicesDropdowns(agentId);
  loadAvailableSlotsForModal();
});

// Submissão do Formulário de Agendamento Manual
document.getElementById('modal-appointment-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    agentId: document.getElementById('modal-apt-agent')?.value,
    specialistId: document.getElementById('modal-apt-specialist')?.value,
    serviceId: document.getElementById('modal-apt-service')?.value || undefined,
    date: document.getElementById('modal-apt-date')?.value,
    startTime: document.getElementById('modal-apt-time')?.value,
    clientName: document.getElementById('modal-apt-name')?.value.trim(),
    clientPhone: document.getElementById('modal-apt-phone')?.value.trim(),
    notes: document.getElementById('modal-apt-notes')?.value.trim(),
    notifySpecialist: document.getElementById('modal-apt-notify')?.checked
  };

  if (!payload.startTime) {
    showToast('Por favor, selecione um horário disponível.', 'warning');
    return;
  }

  try {
    const btn = document.getElementById('btn-save-apt');
    if (btn) btn.disabled = true;

    const res = await fetchWithAuth('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Erro ao criar agendamento.');
    }

    showToast(`Agendamento confirmado para ${data.appointment.clientName}!`, 'success');
    closeAppointmentModal();
    await loadAppointments();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    const btn = document.getElementById('btn-save-apt');
    if (btn) btn.disabled = false;
  }
});

// Botões de fechar modal de agendamento
document.getElementById('btn-close-apt-modal')?.addEventListener('click', closeAppointmentModal);
document.getElementById('btn-cancel-apt')?.addEventListener('click', closeAppointmentModal);

// ============================================================================
// MODAL DE GERENCIAMENTO DE ESPECIALISTAS & SERVIÇOS
// ============================================================================

function openSpecialistsModal() {
  const overlay = document.getElementById('modal-specialists-overlay');
  if (overlay) overlay.style.display = 'flex';
  renderSpecialistsTable();
  renderServicesTable();
}

function closeSpecialistsModal() {
  const overlay = document.getElementById('modal-specialists-overlay');
  if (overlay) overlay.style.display = 'none';
}

document.getElementById('btn-close-specs-modal')?.addEventListener('click', closeSpecialistsModal);
document.getElementById('btn-close-specs-bottom')?.addEventListener('click', closeSpecialistsModal);

// Abas internas do Modal
document.querySelectorAll('.modal-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.modal-tab-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.spec-tab-pane').forEach(p => p.style.display = 'none');

    btn.classList.add('active');
    const tabKey = btn.getAttribute('data-spectab');
    const pane = document.getElementById(`spec-tab-${tabKey}`);
    if (pane) pane.style.display = 'block';
  });
});

// Toggle formulário novo especialista
document.getElementById('btn-show-add-specialist')?.addEventListener('click', () => {
  const wrap = document.getElementById('form-new-specialist-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('btn-cancel-specialist')?.addEventListener('click', () => {
  const wrap = document.getElementById('form-new-specialist-wrap');
  if (wrap) wrap.style.display = 'none';
});

// Salvar Especialista
document.getElementById('form-specialist')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('spec-id')?.value;
  const daysChecked = Array.from(document.querySelectorAll('input[name="spec-days"]:checked')).map(c => c.value);

  const payload = {
    agentId: document.getElementById('spec-agent')?.value || '*',
    name: document.getElementById('spec-name')?.value.trim(),
    role: document.getElementById('spec-role')?.value.trim(),
    phone: document.getElementById('spec-phone')?.value.trim(),
    workHoursStart: document.getElementById('spec-hours-start')?.value || '08:00',
    workHoursEnd: document.getElementById('spec-hours-end')?.value || '18:00',
    breakStart: document.getElementById('spec-break-start')?.value || '12:00',
    breakEnd: document.getElementById('spec-break-end')?.value || '13:00',
    slotDurationMinutes: parseInt(document.getElementById('spec-duration')?.value || '30', 10),
    workingDays: daysChecked.length > 0 ? daysChecked : ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'],
    active: true
  };

  try {
    const url = id ? `/api/specialists/${id}` : '/api/specialists';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha ao salvar especialista.');

    showToast('Especialista salvo com sucesso!', 'success');
    document.getElementById('form-specialist').reset();
    document.getElementById('form-new-specialist-wrap').style.display = 'none';
    await loadAppointments();
    renderSpecialistsTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function renderSpecialistsTable() {
  const tbody = document.getElementById('specialists-table-body');
  if (!tbody) return;

  if (specialistsState.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="text-center p-3 text-muted">Nenhum especialista cadastrado.</td></tr>`;
    return;
  }

  let html = '';
  specialistsState.forEach(s => {
    const agentObj = allAgentsCache.find(a => a.id === s.agentId);
    const agentLabel = s.agentId === '*' || !s.agentId
      ? '<span class="badge badge-info" style="font-size: 11px;">🌐 Global (Todos)</span>'
      : `<span class="badge badge-purple" style="font-size: 11px;">🏢 ${agentObj ? agentObj.name : s.agentId}</span>`;

    html += `
      <tr>
        <td>${agentLabel}</td>
        <td><strong>${s.name}</strong></td>
        <td>${s.role}</td>
        <td>📱 ${s.phone}</td>
        <td>${s.workHoursStart} às ${s.workHoursEnd} (Almoço: ${s.breakStart || '--'} - ${s.breakEnd || '--'})</td>
        <td>${s.slotDurationMinutes} min</td>
        <td><span class="badge ${s.active ? 'badge-success' : 'badge-danger'}">${s.active ? 'Ativo' : 'Inativo'}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-sm btn-danger-outline" onclick="deleteSpecialist('${s.id}')">Excluir</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function deleteSpecialist(id) {
  if (!confirm('Deseja realmente remover este especialista?')) return;
  try {
    const res = await fetchWithAuth(`/api/specialists/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Especialista removido.', 'success');
      await loadAppointments();
      renderSpecialistsTable();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Toggle formulário novo serviço
document.getElementById('btn-show-add-service')?.addEventListener('click', () => {
  const wrap = document.getElementById('form-new-service-wrap');
  if (wrap) wrap.style.display = wrap.style.display === 'none' ? 'block' : 'none';
});

document.getElementById('btn-cancel-service')?.addEventListener('click', () => {
  const wrap = document.getElementById('form-new-service-wrap');
  if (wrap) wrap.style.display = 'none';
});

// Salvar Serviço
document.getElementById('form-service')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const payload = {
    agentId: document.getElementById('service-agent')?.value || '*',
    name: document.getElementById('service-name')?.value.trim(),
    durationMinutes: parseInt(document.getElementById('service-duration')?.value || '30', 10),
    price: parseFloat(document.getElementById('service-price')?.value || '0'),
    active: true
  };

  try {
    const res = await fetchWithAuth('/api/services', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha ao salvar serviço.');

    showToast('Procedimento cadastrado com sucesso!', 'success');
    document.getElementById('form-service').reset();
    document.getElementById('form-new-service-wrap').style.display = 'none';
    await loadAppointments();
    renderServicesTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
});

function renderServicesTable() {
  const tbody = document.getElementById('services-table-body');
  if (!tbody) return;

  if (servicesState.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center p-3 text-muted">Nenhum procedimento cadastrado.</td></tr>`;
    return;
  }

  let html = '';
  servicesState.forEach(srv => {
    const agentObj = allAgentsCache.find(a => a.id === srv.agentId);
    const agentLabel = srv.agentId === '*' || !srv.agentId
      ? '<span class="badge badge-info" style="font-size: 11px;">🌐 Global (Todos)</span>'
      : `<span class="badge badge-purple" style="font-size: 11px;">🏢 ${agentObj ? agentObj.name : srv.agentId}</span>`;

    html += `
      <tr>
        <td>${agentLabel}</td>
        <td><strong>${srv.name}</strong></td>
        <td>${srv.durationMinutes} min</td>
        <td>${srv.price ? `R$ ${srv.price.toFixed(2)}` : 'Não definido'}</td>
        <td><span class="badge ${srv.active ? 'badge-success' : 'badge-danger'}">${srv.active ? 'Ativo' : 'Inativo'}</span></td>
        <td style="text-align: right;">
          <button class="btn btn-sm btn-danger-outline" onclick="deleteService('${srv.id}')">Excluir</button>
        </td>
      </tr>
    `;
  });
  tbody.innerHTML = html;
}

async function deleteService(id) {
  if (!confirm('Deseja realmente remover este procedimento?')) return;
  try {
    const res = await fetchWithAuth(`/api/services/${id}`, { method: 'DELETE' });
    if (res.ok) {
      showToast('Procedimento removido.', 'success');
      await loadAppointments();
      renderServicesTable();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// ============================================================================
// EVENT LISTENERS DA BARRA DE FERRAMENTAS E FILTROS DE AGENDAMENTO
// ============================================================================

// Filtros de Data Rápida (Hoje, Amanhã, Todos, Custom)
document.getElementById('btn-quick-today')?.addEventListener('click', () => {
  document.querySelectorAll('.btn-date-filter').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-quick-today')?.classList.add('active');
  currentAppointmentsDateFilter = 'today';
  currentAppointmentsDateValue = getTodayString();
  const dateInput = document.getElementById('apt-filter-date');
  if (dateInput) dateInput.value = currentAppointmentsDateValue;
  loadAppointments();
});

document.getElementById('btn-quick-tomorrow')?.addEventListener('click', () => {
  document.querySelectorAll('.btn-date-filter').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-quick-tomorrow')?.classList.add('active');
  currentAppointmentsDateFilter = 'tomorrow';
  currentAppointmentsDateValue = getTomorrowString();
  const dateInput = document.getElementById('apt-filter-date');
  if (dateInput) dateInput.value = currentAppointmentsDateValue;
  loadAppointments();
});

document.getElementById('btn-quick-all')?.addEventListener('click', () => {
  document.querySelectorAll('.btn-date-filter').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-quick-all')?.classList.add('active');
  currentAppointmentsDateFilter = 'all';
  currentAppointmentsDateValue = '';
  const dateInput = document.getElementById('apt-filter-date');
  if (dateInput) dateInput.value = '';
  loadAppointments();
});

document.getElementById('apt-filter-date')?.addEventListener('change', (e) => {
  document.querySelectorAll('.btn-date-filter').forEach(b => b.classList.remove('active'));
  currentAppointmentsDateFilter = 'custom';
  currentAppointmentsDateValue = e.target.value;
  loadAppointments();
});

// Dropdowns de Filtro
document.getElementById('apt-filter-agent')?.addEventListener('change', (e) => {
  currentAppointmentsAgentFilter = e.target.value;
  loadAppointments();
});

document.getElementById('apt-filter-specialist')?.addEventListener('change', (e) => {
  currentAppointmentsSpecialistFilter = e.target.value;
  loadAppointments();
});

document.getElementById('apt-filter-status')?.addEventListener('change', (e) => {
  currentAppointmentsStatusFilter = e.target.value;
  loadAppointments();
});

// Busca textual com debounce
let searchDebounceTimer;
document.getElementById('apt-search-input')?.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    currentAppointmentsSearch = e.target.value;
    renderAppointments();
  }, 250);
});

// Alternador de Visualização (Timeline, Kanban, Tabela)
document.getElementById('btn-view-timeline')?.addEventListener('click', () => {
  document.querySelectorAll('.view-switch-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-view-timeline')?.classList.add('active');
  currentAppointmentsView = 'timeline';
  renderAppointments();
});

document.getElementById('btn-view-kanban')?.addEventListener('click', () => {
  document.querySelectorAll('.view-switch-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-view-kanban')?.classList.add('active');
  currentAppointmentsView = 'kanban';
  renderAppointments();
});

document.getElementById('btn-view-table')?.addEventListener('click', () => {
  document.querySelectorAll('.view-switch-btn').forEach(b => b.classList.remove('active'));
  document.getElementById('btn-view-table')?.classList.add('active');
  currentAppointmentsView = 'table';
  renderAppointments();
});

// Botões principais do cabeçalho
document.getElementById('btn-new-appointment')?.addEventListener('click', () => openNewAppointmentModal());
document.getElementById('btn-manage-specialists')?.addEventListener('click', openSpecialistsModal);
document.getElementById('btn-trigger-reminders')?.addEventListener('click', triggerBatchReminders);
document.getElementById('btn-filter-encaixes')?.addEventListener('click', () => {
  // Filtra cancelados/encaixes na tabela ou timeline
  currentAppointmentsStatusFilter = 'cancelled';
  const statusSelect = document.getElementById('apt-filter-status');
  if (statusSelect) statusSelect.value = 'cancelled';
  loadAppointments();
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
      loadSchedule();
      loadWahaConfig();
      loadAgents();
      loadAgentsForSimulator();
      loadAppointments();
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

