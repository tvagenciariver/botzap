// Estado Global, Autenticação e Multiempresa Ativa
const AUTH_TOKEN_KEY = 'botzap_auth_token';
const ACTIVE_COMPANY_KEY = 'botzap_active_company_id';
let currentChatId = 'simulador_' + Math.random().toString(36).substring(2, 7) + '@c.us';
let currentActiveCompanyId = localStorage.getItem(ACTIVE_COMPANY_KEY) || 'all';

function getAuthToken() {
  return localStorage.getItem(AUTH_TOKEN_KEY);
}

function setAuthToken(token) {
  localStorage.setItem(AUTH_TOKEN_KEY, token);
}

function clearAuthToken() {
  localStorage.removeItem(AUTH_TOKEN_KEY);
}

function getActiveCompanyId() {
  return currentActiveCompanyId || 'all';
}

function getEffectiveActiveCompanyId() {
  if (currentUser?.role === 'attendant' && currentUser.assignedAgentId && currentUser.assignedAgentId !== '*') {
    return currentUser.assignedAgentId;
  }
  return currentActiveCompanyId || 'all';
}

function updateTopbarCompanyDisplay() {
  const nameEl = document.getElementById('topbar-company-name');
  if (!nameEl) return;

  const effectiveCompany = getEffectiveActiveCompanyId();

  if (effectiveCompany === 'all') {
    nameEl.textContent = 'Todas as Empresas (Visão Global)';
  } else {
    const agentsList = (typeof allAgents !== 'undefined' && allAgents.length > 0)
      ? allAgents
      : (typeof allAgentsCache !== 'undefined' ? allAgentsCache : []);
    const agent = agentsList.find(a => a.id === effectiveCompany);
    if (agent) {
      nameEl.textContent = agent.companyName || agent.name;
    } else {
      nameEl.textContent = `Empresa #${effectiveCompany.substring(0, 8)}`;
    }
  }
}

function setActiveCompany(companyId, reload = true) {
  // Se for atendente vinculado a uma empresa específica, nunca altera o ID
  if (currentUser?.role === 'attendant' && currentUser.assignedAgentId && currentUser.assignedAgentId !== '*') {
    currentActiveCompanyId = currentUser.assignedAgentId;
  } else {
    currentActiveCompanyId = companyId || 'all';
  }
  localStorage.setItem(ACTIVE_COMPANY_KEY, currentActiveCompanyId);

  const effectiveCompany = getEffectiveActiveCompanyId();
  const agentsList = (typeof allAgents !== 'undefined' && allAgents.length > 0)
    ? allAgents
    : (typeof allAgentsCache !== 'undefined' ? allAgentsCache : []);

  // 1. Atualiza Top Bar
  updateTopbarCompanyDisplay();

  // 2. Sincroniza barra lateral "Agente em Foco" (restringe rigorosamente à empresa ativa)
  if (typeof populateSidebarAgentSelect === 'function') {
    populateSidebarAgentSelect(agentsList);
  }

  // 3. Sincroniza Simulador de Atendimento (restringe rigorosamente à empresa ativa)
  if (typeof populateSimulatorAgentSelect === 'function') {
    populateSimulatorAgentSelect(agentsList);
  }

  // 4. Sincroniza Filtro de Agendamentos e selects de modais
  currentAppointmentsAgentFilter = effectiveCompany;
  if (typeof populateAgentsDropdowns === 'function') {
    populateAgentsDropdowns(agentsList);
  }

  // 5. Sincroniza Filtro e Modal de Exames & Laudos (restringe rigorosamente à empresa ativa)
  if (typeof populateExamAgentsSelect === 'function') {
    populateExamAgentsSelect(effectiveCompany !== 'all' ? effectiveCompany : '*');
  }

  // 6. Recarrega dados da view ativa se solicitado
  if (reload) {
    const activeNav = document.querySelector('.nav-menu .nav-btn.active');
    const activeTab = activeNav ? activeNav.getAttribute('data-tab') : null;

    if (activeTab === 'appointments' && typeof loadAppointments === 'function') {
      loadAppointments();
    } else if (activeTab === 'exams' && typeof loadExams === 'function') {
      loadExams();
    } else if (activeTab === 'simulator' && effectiveCompany !== 'all') {
      const simSelect = document.getElementById('sim-agent-select');
      if (simSelect && simSelect.value !== effectiveCompany) {
        simSelect.value = effectiveCompany;
        simSelect.dispatchEvent(new Event('change'));
      }
    }
  }
}

let isCompanyPickerMandatory = false;

async function openCompanyPickerModal(isMandatory = false) {
  isCompanyPickerMandatory = isMandatory;
  const overlay = document.getElementById('modal-company-picker-overlay');
  if (!overlay) return;

  const closeBtn = document.getElementById('btn-close-company-picker');
  const skipBtn = document.getElementById('btn-skip-company-picker');
  const titleEl = document.getElementById('company-picker-title');
  const subtitleEl = document.getElementById('company-picker-subtitle');
  const searchInput = document.getElementById('company-picker-search');

  if (searchInput) searchInput.value = '';

  if (isMandatory) {
    if (closeBtn) closeBtn.style.display = 'none';
    if (titleEl) titleEl.textContent = '👋 Bem-vindo! Selecione a Empresa para Acessar';
    if (subtitleEl) subtitleEl.textContent = 'Escolha qual empresa ou cliente você deseja gerenciar agora no painel:';
    if (skipBtn) skipBtn.textContent = '🌐 Entrar com Visão Geral (Todas as Empresas)';
  } else {
    if (closeBtn) closeBtn.style.display = 'block';
    if (titleEl) titleEl.textContent = '🏢 Alternar Empresa / Cliente';
    if (subtitleEl) subtitleEl.textContent = 'Selecione a empresa que você deseja focar agora no painel:';
    if (skipBtn) skipBtn.textContent = '🌐 Ver Todas as Empresas (Visão Global)';
  }

  // Garante que temos a lista de agentes
  if (typeof allAgents === 'undefined' || allAgents.length === 0) {
    try {
      const res = await fetchWithAuth('/api/agents');
      if (res.ok) {
        const data = await res.json();
        allAgents = data.agents || [];
        allAgentsCache = allAgents;
      }
    } catch (e) {
      console.warn('Erro ao carregar agentes para modal:', e);
    }
  }

  renderCompanyPickerCards();
  overlay.style.display = 'flex';
  if (searchInput) {
    setTimeout(() => searchInput.focus(), 50);
  }
}

function closeCompanyPickerModal() {
  const overlay = document.getElementById('modal-company-picker-overlay');
  if (overlay) overlay.style.display = 'none';
}

function renderCompanyPickerCards(filterText = '') {
  const grid = document.getElementById('company-picker-grid');
  if (!grid) return;

  const q = (filterText || '').toLowerCase().trim();
  const agents = (typeof allAgents !== 'undefined' && allAgents.length > 0)
    ? allAgents
    : (typeof allAgentsCache !== 'undefined' ? allAgentsCache : []);

  let html = '';

  // 1. Card Todas as Empresas
  const allMatches = !q || 'todas as empresas visao global todas consolidated'.includes(q);
  if (allMatches) {
    const isAllActive = currentActiveCompanyId === 'all';
    html += `
      <div class="company-picker-card card-all-companies ${isAllActive ? 'active-company' : ''}" data-company-id="all">
        <div class="company-card-header">
          <div class="company-card-icon" style="background: rgba(99, 102, 241, 0.2); color: #818cf8;">🌐</div>
          <div>
            <h4 class="company-card-title">Todas as Empresas</h4>
            <p class="company-card-subtitle">Visão Consolidada Multiempresa</p>
          </div>
        </div>
        <div class="company-card-meta">
          <span class="badge badge-primary">${agents.length} ${agents.length === 1 ? 'Unidade' : 'Unidades'}</span>
          <span class="badge badge-secondary">Visão Geral</span>
        </div>
        <div class="company-card-cta">
          <span>${isAllActive ? '✅ Empresa Ativa no Momento' : 'Selecionar Visão Geral'}</span>
          <span>➔</span>
        </div>
      </div>
    `;
  }

  // 2. Cards individuais para cada agente/empresa
  const filteredAgents = agents.filter(a => {
    if (!q) return true;
    const name = (a.name || '').toLowerCase();
    const comp = (a.companyName || '').toLowerCase();
    const session = (a.wahaSession || '').toLowerCase();
    return name.includes(q) || comp.includes(q) || session.includes(q);
  });

  if (filteredAgents.length === 0 && !allMatches) {
    html = `
      <div style="grid-column: 1 / -1; text-align: center; padding: 40px 20px; color: var(--text-muted);">
        <div style="font-size: 32px; margin-bottom: 8px;">🔍</div>
        <p>Nenhuma empresa encontrada com "<strong>${escapeHtml(q)}</strong>".</p>
      </div>
    `;
  } else {
    filteredAgents.forEach(a => {
      const isActive = currentActiveCompanyId === a.id;
      const prov = a.llmProvider === 'openai' ? 'OpenAI' : 'Gemini';
      const isOnline = a.active !== false;

      html += `
        <div class="company-picker-card ${isActive ? 'active-company' : ''}" data-company-id="${a.id}">
          <div class="company-card-header">
            <div class="company-card-icon" style="background: rgba(59, 130, 246, 0.15); color: #60a5fa;">🏢</div>
            <div>
              <h4 class="company-card-title">${escapeHtml(a.companyName || a.name)}</h4>
              <p class="company-card-subtitle">🤖 Bot: ${escapeHtml(a.name)}</p>
            </div>
          </div>
          <div class="company-card-meta">
            <span class="badge ${isOnline ? 'badge-emerald' : 'badge-danger'}">
              <span class="status-dot ${isOnline ? 'online' : 'offline'}" style="margin-right: 4px;"></span>
              ${isOnline ? 'WhatsApp Ativo' : 'Inativo'}
            </span>
            <span class="badge badge-secondary">${prov}</span>
            ${a.isDefault ? '<span class="badge badge-primary">Padrão</span>' : ''}
          </div>
          <div class="company-card-cta">
            <span>${isActive ? '✅ Empresa Ativa no Momento' : 'Acessar Esta Empresa'}</span>
            <span>➔</span>
          </div>
        </div>
      `;
    });
  }

  grid.innerHTML = html;

  grid.querySelectorAll('.company-picker-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = card.getAttribute('data-company-id');
      if (id) {
        setActiveCompany(id, true);
        closeCompanyPickerModal();
        const companyName = id === 'all' ? 'Todas as Empresas' : (card.querySelector('.company-card-title')?.textContent || 'Empresa');
        showToast(`Empresa ativa: ${companyName} 🏢`, 'success');
      }
    });
  });
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

let currentUser = null;

function applyRolePermissions(user) {
  currentUser = user;
  if (!user) return;

  const isAdmin = user.role === 'admin';
  const isAttendant = user.role === 'attendant';

  // 1. Alterna visibilidade dos elementos exclusivos de administrador
  document.querySelectorAll('[data-admin-only="true"]').forEach(el => {
    el.style.display = isAdmin ? '' : 'none';
  });

  // 2. Se for atendente, redireciona caso esteja em uma aba proibida
  if (isAttendant) {
    const activeNav = document.querySelector('.nav-menu .nav-btn.active');
    const activeTab = activeNav ? activeNav.getAttribute('data-tab') : null;
    const allowedTabs = ['appointments', 'simulator', 'chats', 'exams'];

    if (!allowedTabs.includes(activeTab)) {
      switchToTab('appointments');
    }

    // Se vinculado a um cliente/agente específico (não '*'), aplica filtro automático e oculta o switcher
    const switcherPill = document.getElementById('company-switcher-pill');
    if (user.assignedAgentId && user.assignedAgentId !== '*') {
      setActiveCompany(user.assignedAgentId, false);
      if (switcherPill) {
        const actionEl = switcherPill.querySelector('.company-selector-action');
        if (actionEl) actionEl.style.display = 'none';
        const btnSelector = document.getElementById('btn-switch-company');
        if (btnSelector) btnSelector.style.cursor = 'default';
      }
    } else {
      if (switcherPill) {
        const actionEl = switcherPill.querySelector('.company-selector-action');
        if (actionEl) actionEl.style.display = 'inline-flex';
        const btnSelector = document.getElementById('btn-switch-company');
        if (btnSelector) btnSelector.style.cursor = 'pointer';
      }
    }
  } else {
    // Admin: acesso total ao seletor
    const switcherPill = document.getElementById('company-switcher-pill');
    if (switcherPill) {
      const actionEl = switcherPill.querySelector('.company-selector-action');
      if (actionEl) actionEl.style.display = 'inline-flex';
      const btnSelector = document.getElementById('btn-switch-company');
      if (btnSelector) btnSelector.style.cursor = 'pointer';
    }
  }
}

function hideLoginModal(user = 'admin') {
  const overlay = document.getElementById('login-overlay');
  const userBadge = document.getElementById('user-badge-container');
  const userNameEl = document.getElementById('user-badge-name');
  if (overlay) overlay.classList.add('hidden');
  if (userBadge) userBadge.style.display = 'flex';

  const uObj = (typeof user === 'string')
    ? { username: user, role: 'admin', name: user }
    : (user || { username: 'admin', role: 'admin' });

  currentUser = uObj;

  const roleLabel = uObj.role === 'admin' ? '👑 Admin' : '👩‍💼 Atendimento';
  const roleBadgeClass = uObj.role === 'admin' ? 'badge-primary' : 'badge-emerald';
  const displayName = uObj.name || uObj.username || 'admin';

  if (userNameEl) {
    userNameEl.innerHTML = `👤 <strong>${displayName}</strong> <span class="badge ${roleBadgeClass}" style="font-size:10px; margin-left: 5px;">${roleLabel}</span>`;
  }

  applyRolePermissions(uObj);
  updateTopbarCompanyDisplay();
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

function switchToTab(targetTab) {
  document.querySelectorAll('.nav-menu .nav-btn').forEach(b => {
    if (b.getAttribute('data-tab') === targetTab) {
      b.classList.add('active');
    } else {
      b.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  const targetPane = document.getElementById(`pane-${targetTab}`);
  if (targetPane) targetPane.classList.add('active');

  const titles = {
    simulator: 'Simulador de Atendimento (WhatsApp)',
    appointments: 'Central de Agendamentos & Agenda Inteligente',
    exams: 'Envio & Gestão de Exames e Laudos',
    agents: 'Gerenciador de Agentes & Clientes (Multi-Agentes)',
    prompts: 'Configuração Geral & Agente Padrão',
    schedule: 'Horário Comercial & Mensagem de Ausência',
    terminal: 'Console de Comandos em Tempo Real (Admin CLI)',
    chats: 'Conversas Ativas & Pausa do Bot',
    logs: 'Logs em Tempo Real do Orquestrador',
    integration: 'Integração WAHA API & Chatwoot',
    users: 'Gestão de Usuários & Equipe de Atendimento'
  };
  const pageTitle = document.getElementById('page-title');
  if (pageTitle) pageTitle.textContent = titles[targetTab] || 'BotZap';

  if (getAuthToken()) {
    if (targetTab === 'simulator') loadAgentsForSimulator();
    if (targetTab === 'appointments') loadAppointments();
    if (targetTab === 'exams') loadExams();
    if (targetTab === 'agents' && currentUser?.role === 'admin') loadAgents();
    if (targetTab === 'chats') loadChats();
    if (targetTab === 'logs' && currentUser?.role === 'admin') loadLogs();
    if (targetTab === 'prompts' && currentUser?.role === 'admin') {
      loadConfig();
      loadHolidays();
    }
    if (targetTab === 'schedule' && currentUser?.role === 'admin') {
      loadSchedule();
      loadHolidays();
    }
    if (targetTab === 'terminal' && currentUser?.role === 'admin') {
      setTimeout(() => document.getElementById('terminal-input')?.focus(), 50);
    }
    if (targetTab === 'integration' && currentUser?.role === 'admin') loadWahaConfig();
    if (targetTab === 'users' && currentUser?.role === 'admin') loadUsers();
  }
}

// Navegação por Abas
document.querySelectorAll('.nav-menu .nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetTab = btn.getAttribute('data-tab');
    switchToTab(targetTab);
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

// ==========================================
// Gestão de Feriados & Recessos
// ==========================================
let holidaysState = [];

async function loadHolidays() {
  if (!getAuthToken()) return;
  const tbody = document.getElementById('holidays-table-body');
  if (!tbody) return;

  try {
    const res = await fetchWithAuth('/api/business-hours/holidays');
    const data = await res.json();
    holidaysState = data.holidays || [];
    renderHolidaysTable(holidaysState);
  } catch (err) {
    console.error('Erro ao carregar feriados:', err);
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-danger">Erro ao carregar feriados.</td></tr>';
  }
}

function renderHolidaysTable(holidays) {
  const tbody = document.getElementById('holidays-table-body');
  if (!tbody) return;

  if (!holidays || holidays.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="text-center text-muted" style="padding: 24px;">
          Nenhum feriado cadastrado ainda. Clique em "<strong>Adicionar Feriado</strong>" ou "<strong>Carregar Feriados Nacionais</strong>" para começar.
        </td>
      </tr>
    `;
    return;
  }

  // Ordena por data
  const sorted = [...holidays].sort((a, b) => (a.date || '').localeCompare(b.date || ''));

  tbody.innerHTML = sorted.map(h => {
    let typeBadge = '<span class="badge-municipal">🏙️ Municipal</span>';
    if (h.type === 'national') {
      typeBadge = '<span class="badge-national">🇧🇷 Nacional</span>';
    } else if (h.type === 'recess') {
      typeBadge = '<span class="badge-recess">🏖️ Recesso</span>';
    }

    // Formata data
    let displayDate = h.date;
    if (h.date && h.date.length === 10 && h.date.includes('-')) {
      const [y, m, d] = h.date.split('-');
      displayDate = `${d}/${m}/${y}`;
    } else if (h.date && h.date.length === 5 && h.date.includes('-')) {
      const [m, d] = h.date.split('-');
      displayDate = `${d}/${m} (Anual)`;
    }

    const isEnabled = h.enabled !== false;
    const statusBadge = isEnabled
      ? '<span class="badge badge-emerald">✅ Ativo</span>'
      : '<span class="badge badge-secondary">⏸️ Inativo</span>';

    const customMsg = h.outOfHoursMessage ? escapeHtml(h.outOfHoursMessage) : '<span class="text-muted">Mensagem Padrão</span>';

    return `
      <tr>
        <td>${statusBadge}</td>
        <td><strong>${displayDate}</strong></td>
        <td><strong>${escapeHtml(h.name)}</strong></td>
        <td>${typeBadge}</td>
        <td style="font-size: 12px; max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${escapeHtml(h.outOfHoursMessage || '')}">${customMsg}</td>
        <td style="text-align: right;">
          <button type="button" class="btn btn-sm btn-outline text-danger" onclick="deleteHoliday('${h.id}', '${escapeHtml(h.name)}')" title="Excluir feriado">🗑️</button>
        </td>
      </tr>
    `;
  }).join('');

  // Atualiza também o resumo visual na aba de Prompts / Configurações Gerais
  const promptsSummary = document.getElementById('prompts-holidays-summary');
  if (promptsSummary) {
    if (!holidays || holidays.length === 0) {
      promptsSummary.innerHTML = '<em>Nenhum feriado cadastrado no momento. Clique em "<strong>Adicionar Feriado</strong>" ou "<strong>Carregar Nacionais</strong>" acima para configurar.</em>';
    } else {
      const activeHols = holidays.filter(h => h.enabled !== false);
      const badges = activeHols.slice(0, 10).map(h => {
        const icon = h.type === 'national' ? '🇧🇷' : (h.type === 'recess' ? '🏖️' : '🏙️');
        return `<span class="badge ${h.type === 'national' ? 'badge-national' : (h.type === 'recess' ? 'badge-recess' : 'badge-municipal')}" style="font-size: 11px; margin-right: 6px; margin-bottom: 4px; display: inline-flex; align-items: center; gap: 4px;">${icon} <strong>${h.date}</strong>: ${escapeHtml(h.name)}</span>`;
      }).join(' ');
      const extra = activeHols.length > 10 ? `<span class="text-muted" style="font-size: 11px;">+${activeHols.length - 10} mais...</span>` : '';
      promptsSummary.innerHTML = `<div style="margin-bottom: 6px;"><strong>${activeHols.length} feriado(s) ativo(s):</strong></div><div style="display: flex; flex-wrap: wrap; gap: 6px; align-items: center;">${badges} ${extra}</div>`;
    }
  }
}

function openHolidayModal(holiday = null) {
  const overlay = document.getElementById('modal-holiday-overlay');
  if (!overlay) return;

  const idInput = document.getElementById('modal-holiday-id');
  const nameInput = document.getElementById('modal-holiday-name');
  const dateInput = document.getElementById('modal-holiday-date');
  const typeSelect = document.getElementById('modal-holiday-type');
  const msgInput = document.getElementById('modal-holiday-message');
  const enabledInput = document.getElementById('modal-holiday-enabled');
  const titleEl = document.getElementById('modal-holiday-title');

  if (holiday) {
    if (titleEl) titleEl.textContent = 'Editar Feriado / Recesso';
    if (idInput) idInput.value = holiday.id || '';
    if (nameInput) nameInput.value = holiday.name || '';
    if (dateInput) dateInput.value = holiday.date || '';
    if (typeSelect) typeSelect.value = holiday.type || 'municipal';
    if (msgInput) msgInput.value = holiday.outOfHoursMessage || '';
    if (enabledInput) enabledInput.checked = holiday.enabled !== false;
  } else {
    if (titleEl) titleEl.textContent = 'Adicionar Feriado / Recesso';
    if (idInput) idInput.value = '';
    if (nameInput) nameInput.value = '';
    if (dateInput) dateInput.value = '';
    if (typeSelect) typeSelect.value = 'municipal';
    if (msgInput) msgInput.value = '';
    if (enabledInput) enabledInput.checked = true;
  }

  overlay.style.display = 'flex';
  nameInput?.focus();
}

function closeHolidayModal() {
  const overlay = document.getElementById('modal-holiday-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function saveHolidaySubmit(e) {
  e.preventDefault();
  const id = document.getElementById('modal-holiday-id')?.value.trim();
  const name = document.getElementById('modal-holiday-name')?.value.trim();
  const date = document.getElementById('modal-holiday-date')?.value.trim();
  const type = document.getElementById('modal-holiday-type')?.value || 'municipal';
  const outOfHoursMessage = document.getElementById('modal-holiday-message')?.value.trim();
  const enabled = document.getElementById('modal-holiday-enabled')?.checked ?? true;

  if (!name || !date) {
    showToast('Informe o nome e a data do feriado.', 'warning');
    return;
  }

  const payload = { id: id || undefined, name, date, type, outOfHoursMessage, enabled };

  try {
    const res = await fetchWithAuth('/api/business-hours/holidays', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Feriado "${name}" salvo com sucesso!`, 'success');
      closeHolidayModal();
      loadHolidays();
    } else {
      showToast(`Erro ao salvar: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao salvar feriado: ${err.message}`, 'error');
  }
}

window.deleteHoliday = async function(id, name) {
  if (!confirm(`Deseja realmente remover o feriado "${name}"?`)) return;

  try {
    const res = await fetchWithAuth(`/api/business-hours/holidays/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Feriado "${name}" removido com sucesso.`, 'success');
      loadHolidays();
    } else {
      showToast(`Erro ao remover: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro ao excluir: ${err.message}`, 'error');
  }
};

async function loadNationalHolidays() {
  if (!confirm('Deseja carregar os 9 feriados nacionais oficiais do Brasil?\nFeriados já cadastrados com a mesma data serão preservados.')) {
    return;
  }

  try {
    const res = await fetchWithAuth('/api/business-hours/holidays/load-national', {
      method: 'POST'
    });
    const data = await res.json();
    if (data.success) {
      showToast(`Feriados nacionais carregados! (${data.count} cadastrados)`, 'success');
      loadHolidays();
    } else {
      showToast(`Erro ao carregar: ${data.error}`, 'error');
    }
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

// Event Listeners de Feriados
document.getElementById('btn-add-holiday')?.addEventListener('click', () => openHolidayModal());
document.getElementById('btn-load-national-holidays')?.addEventListener('click', loadNationalHolidays);
document.getElementById('btn-close-holiday-modal')?.addEventListener('click', closeHolidayModal);
document.getElementById('btn-cancel-holiday')?.addEventListener('click', closeHolidayModal);
document.getElementById('modal-holiday-form')?.addEventListener('submit', saveHolidaySubmit);
document.getElementById('modal-holiday-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-holiday-overlay') closeHolidayModal();
});

// ==========================================
// Terminal & Console de Comandos em Tempo Real (Admin CLI)
// ==========================================
let terminalHistory = [];
let terminalHistoryIndex = -1;

function appendTerminalLine(text, type = 'system') {
  const screen = document.getElementById('terminal-screen');
  if (!screen) return;

  const line = document.createElement('div');
  line.className = `terminal-line ${type}`;
  line.innerHTML = formatWhatsAppText(text);
  screen.appendChild(line);

  // Auto-scroll para o final
  screen.scrollTop = screen.scrollHeight;
}

async function executeAdminCommand(cmdText, fromTopbar = false) {
  const cleanCmd = (cmdText || '').trim();
  if (!cleanCmd) return;

  // Adiciona ao histórico
  terminalHistory.push(cleanCmd);
  terminalHistoryIndex = terminalHistory.length;

  // Eco do comando no terminal
  appendTerminalLine(`botzap> ${cleanCmd}`, 'cmd');

  try {
    const effectiveCompany = getEffectiveActiveCompanyId();
    const res = await fetchWithAuth('/api/admin/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: cleanCmd,
        agentId: effectiveCompany
      })
    });

    const data = await res.json();

    if (res.ok && data.success) {
      appendTerminalLine(data.message, 'success');

      if (fromTopbar) {
        showToast(data.message.split('\n')[0], 'success');
      }

      // Se o comando alterou dados de feriados, recarrega feriados
      if (cleanCmd.toLowerCase().includes('feriado')) {
        loadHolidays();
      }
      // Se alterou conversas ou pausa, recarrega chats
      if (cleanCmd.toLowerCase().includes('pausar') || cleanCmd.toLowerCase().includes('despausar') || cleanCmd.toLowerCase().includes('memoria')) {
        loadChats();
      }
      // Se alterou configuração de empresa ou horário
      if (cleanCmd.toLowerCase().includes('horario') || cleanCmd.toLowerCase().includes('empresa') || cleanCmd.toLowerCase().includes('modelo') || cleanCmd.toLowerCase().includes('temperatura')) {
        checkStatus();
      }
    } else {
      const errMsg = data.error || data.message || 'Erro ao executar comando.';
      appendTerminalLine(`❌ ${errMsg}`, 'error');
      if (fromTopbar) {
        showToast(errMsg, 'error');
      }
    }
  } catch (err) {
    appendTerminalLine(`❌ Erro de comunicação: ${err.message}`, 'error');
    if (fromTopbar) {
      showToast(`Erro: ${err.message}`, 'error');
    }
  }
}

// Submissão do Terminal
document.getElementById('terminal-form')?.addEventListener('submit', (e) => {
  e.preventDefault();
  const input = document.getElementById('terminal-input');
  if (!input) return;
  const cmd = input.value;
  input.value = '';
  executeAdminCommand(cmd, false);
});

// Navegação de histórico com setas Up/Down no terminal
document.getElementById('terminal-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowUp') {
    e.preventDefault();
    if (terminalHistory.length > 0 && terminalHistoryIndex > 0) {
      terminalHistoryIndex--;
      e.target.value = terminalHistory[terminalHistoryIndex];
    }
  } else if (e.key === 'ArrowDown') {
    e.preventDefault();
    if (terminalHistoryIndex < terminalHistory.length - 1) {
      terminalHistoryIndex++;
      e.target.value = terminalHistory[terminalHistoryIndex];
    } else {
      terminalHistoryIndex = terminalHistory.length;
      e.target.value = '';
    }
  }
});

// Botão Limpar Terminal
document.getElementById('btn-clear-terminal')?.addEventListener('click', () => {
  const screen = document.getElementById('terminal-screen');
  if (screen) {
    screen.innerHTML = `
      <div class="terminal-line system">BotZap Admin Console [Versão 2.4.0-Production]</div>
      <div class="terminal-line system">Tela limpa. Digite <strong>ajuda</strong> para ver os comandos disponíveis.</div>
      <div class="terminal-line system">--------------------------------------------------------------------------------</div>
    `;
  }
  document.getElementById('terminal-input')?.focus();
});

// Botão Ajuda no Terminal
document.getElementById('btn-help-terminal')?.addEventListener('click', () => {
  executeAdminCommand('ajuda', false);
});

// Chips de Ação Rápida
document.querySelectorAll('.terminal-chips-bar .btn-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const cmd = chip.getAttribute('data-cmd');
    if (cmd) {
      const input = document.getElementById('terminal-input');
      if (input) {
        input.value = cmd;
        input.focus();
      }
      executeAdminCommand(cmd, false);
    }
  });
});

// Topbar Quick Command Execution
document.getElementById('btn-topbar-run-cmd')?.addEventListener('click', () => {
  const input = document.getElementById('topbar-command-input');
  if (!input) return;
  const cmd = input.value.trim();
  if (cmd) {
    input.value = '';
    executeAdminCommand(cmd, true);
  }
});

document.getElementById('topbar-command-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    const cmd = e.target.value.trim();
    if (cmd) {
      e.target.value = '';
      executeAdminCommand(cmd, true);
    }
  }
});

// Event Listeners para Feriados e Comandos na Aba de Prompts / Configurações
document.getElementById('btn-prompts-add-holiday')?.addEventListener('click', () => openHolidayModal());
document.getElementById('btn-prompts-load-national')?.addEventListener('click', loadNationalHolidays);

async function handlePromptsCommandRun() {
  const input = document.getElementById('prompts-command-input');
  const output = document.getElementById('prompts-command-output');
  if (!input || !output) return;

  const cmd = input.value.trim();
  if (!cmd) return;

  output.style.display = 'block';
  output.style.color = '#38bdf8';
  output.textContent = `Executando: "${cmd}"... ⏳`;

  try {
    const effectiveCompany = getEffectiveActiveCompanyId();
    const res = await fetchWithAuth('/api/admin/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        command: cmd,
        agentId: effectiveCompany
      })
    });

    const data = await res.json();
    if (res.ok && data.success) {
      output.style.color = '#34d399';
      output.textContent = data.message;
      input.value = '';
      showToast(data.message.split('\n')[0], 'success');
      if (cmd.toLowerCase().includes('feriado')) loadHolidays();
      if (cmd.toLowerCase().includes('horario') || cmd.toLowerCase().includes('modelo') || cmd.toLowerCase().includes('temperatura')) {
        checkStatus();
      }
    } else {
      output.style.color = '#f87171';
      output.textContent = data.error || data.message || 'Erro ao executar comando.';
      showToast(output.textContent, 'error');
    }
  } catch (err) {
    output.style.color = '#f87171';
    output.textContent = `Erro de comunicação: ${err.message}`;
    showToast(output.textContent, 'error');
  }
}

document.getElementById('btn-prompts-run-cmd')?.addEventListener('click', handlePromptsCommandRun);
document.getElementById('prompts-command-input')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    handlePromptsCommandRun();
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
      hideLoginModal(data.user || { username, role: 'admin' });
      passwordInput.value = '';
      checkStatus();
      if (data.user?.role === 'admin') {
        loadConfig();
        loadSchedule();
        loadWahaConfig();
        await loadAgents();
      }
      loadAgentsForSimulator();
      loadAppointments();
      if (data.user?.role === 'attendant') {
        switchToTab('appointments');
      }

      // Se for admin ou atendente com acesso a todas as empresas, abre o seletor obrigatório de empresa logo após o login
      if (!data.user || data.user.role === 'admin' || !data.user.assignedAgentId || data.user.assignedAgentId === '*') {
        openCompanyPickerModal(true);
      }
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
    allAgentsCache = allAgents;
    updateTopbarCompanyDisplay();

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

  const agentsList = (agents && agents.length > 0)
    ? agents
    : ((typeof allAgents !== 'undefined' && allAgents.length > 0) ? allAgents : (allAgentsCache || []));

  if (!agentsList || agentsList.length === 0) {
    select.innerHTML = '<option value="">Nenhum agente cadastrado</option>';
    updateSidebarAgentStatus(null);
    return;
  }

  const effectiveCompany = getEffectiveActiveCompanyId();
  const isCompanyLocked = effectiveCompany !== 'all';

  if (isCompanyLocked) {
    const activeAgent = agentsList.find(a => a.id === effectiveCompany);
    if (activeAgent) {
      select.innerHTML = `<option value="${activeAgent.id}">🏢 ${escapeHtml(activeAgent.companyName || activeAgent.name)} (Bot: ${escapeHtml(activeAgent.name)})</option>`;
      select.value = activeAgent.id;
      select.disabled = true;
      select.title = "Unidade fixada pela empresa ativa ou perfil de acesso. Para alternar, use o botão no topo do painel.";
      updateSidebarAgentStatus(activeAgent.id);
      return;
    }
  }

  select.disabled = false;
  select.title = "Selecione o agente para inspecionar";
  const currentVal = select.value;
  select.innerHTML = agentsList.map(a => `
    <option value="${a.id}">${escapeHtml(a.name)} (${escapeHtml(a.companyName)})${a.isDefault ? ' ⭐' : ''}</option>
  `).join('');

  if (currentVal && agentsList.some(a => a.id === currentVal)) {
    select.value = currentVal;
  } else {
    const def = agentsList.find(a => a.isDefault) || agentsList[0];
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
    if (bh.reason === 'holiday') reasonText = `Feriado 🏖️ ${bh.holidayName ? `(${bh.holidayName})` : ''}`;
    else if (bh.reason === 'lunch') reasonText = 'Almoço 🍽️';
    else if (bh.reason === 'day_closed') reasonText = 'Fechado hoje 🔴';
    else reasonText = `Fechado 🔴 (${bh.currentTime})`;

    if (textSched) {
      textSched.textContent = reasonText;
      textSched.className = (bh.reason === 'lunch' || bh.reason === 'holiday') ? 'status-val text-orange' : 'status-val text-red';
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

  const agentsList = (agents && agents.length > 0)
    ? agents
    : ((typeof allAgents !== 'undefined' && allAgents.length > 0) ? allAgents : (allAgentsCache || []));

  if (!agentsList || agentsList.length === 0) {
    select.innerHTML = '<option value="">Nenhum bot cadastrado</option>';
    return;
  }

  const effectiveCompany = getEffectiveActiveCompanyId();
  const isCompanyLocked = effectiveCompany !== 'all';

  if (isCompanyLocked) {
    const activeAgent = agentsList.find(a => a.id === effectiveCompany);
    if (activeAgent) {
      select.innerHTML = `<option value="${activeAgent.id}">${escapeHtml(activeAgent.name)} (${escapeHtml(activeAgent.companyName)})</option>`;
      select.value = activeAgent.id;
      select.disabled = true;
      select.title = "Bot fixado pela empresa ativa selecionada no painel";
      updateSimulatorHeaderForSelectedAgent();
      return;
    }
  }

  select.disabled = false;
  select.title = "Selecione o agente para testar no simulador";
  const currentVal = select.value;
  select.innerHTML = agentsList.map(a => `
    <option value="${a.id}">
      ${escapeHtml(a.name)} (${escapeHtml(a.companyName)})${a.isDefault ? ' [Padrão]' : ''}
    </option>
  `).join('');

  if (currentVal && agentsList.some(a => a.id === currentVal)) {
    select.value = currentVal;
  } else if (agentsList.length > 0) {
    const def = agentsList.find(a => a.isDefault) || agentsList[0];
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
  currentUser = null;
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

function formatPhoneDisplay(phone) {
  if (!phone) return '--';
  let clean = String(phone).trim().replace(/@.*$/, '');
  const digits = clean.replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('55')) {
    const ddd = digits.substring(2, 4);
    const part1 = digits.substring(4, 9);
    const part2 = digits.substring(9, 13);
    return `(${ddd}) ${part1}-${part2}`;
  }
  if (digits.length === 12 && digits.startsWith('55')) {
    const ddd = digits.substring(2, 4);
    const part1 = digits.substring(4, 8);
    const part2 = digits.substring(8, 12);
    return `(${ddd}) ${part1}-${part2}`;
  }
  if (digits.length === 11) {
    const ddd = digits.substring(0, 2);
    const part1 = digits.substring(2, 7);
    const part2 = digits.substring(7, 11);
    return `(${ddd}) ${part1}-${part2}`;
  }
  if (digits.length === 10) {
    const ddd = digits.substring(0, 2);
    const part1 = digits.substring(2, 6);
    const part2 = digits.substring(6, 10);
    return `(${ddd}) ${part1}-${part2}`;
  }
  return clean;
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

    lastAppointmentsSignature = JSON.stringify(appointmentsState.map(a => `${a.id}:${a.status}:${a.date}:${a.startTime}:${a.updatedAt}:${a.reminderSent}:${a.notifiedSpecialist}`));
    renderAppointments();
  } catch (err) {
    console.error('[Appointments] Erro ao carregar:', err);
  }
}

// ============================================================================
// SINCRONIZAÇÃO EM TEMPO REAL DA AGENDA (REALTIME SEM F5)
// ============================================================================

let appointmentsRealtimeTimer = null;
let lastAppointmentsSignature = '';

function isAnyModalOpen() {
  const modals = [
    document.getElementById('modal-appointment-overlay'),
    document.getElementById('modal-specs-overlay'),
    document.getElementById('modal-print-overlay'),
    document.getElementById('modal-user-overlay')
  ];
  return modals.some(m => m && m.style.display && m.style.display !== 'none');
}

async function syncAppointmentsRealtime() {
  if (!getAuthToken()) return;

  // Não atualiza se o operador estiver preenchendo um formulário em modal
  if (isAnyModalOpen()) return;

  try {
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

    const [aptsRes, sumRes, encRes] = await Promise.all([
      fetchWithAuth(`/api/appointments?${query.toString()}`),
      fetchWithAuth(`/api/appointments/summary?date=${currentAppointmentsDateValue}&agentId=${currentAppointmentsAgentFilter}`),
      fetchWithAuth(`/api/appointments/encaixes?agentId=${currentAppointmentsAgentFilter}`)
    ]);

    if (aptsRes.ok) {
      const data = await aptsRes.json();
      const newApts = data.appointments || [];
      const newSignature = JSON.stringify(newApts.map(a => `${a.id}:${a.status}:${a.date}:${a.startTime}:${a.updatedAt}:${a.reminderSent}:${a.notifiedSpecialist}`));

      // Se houver qualquer alteração na agenda (novo agendamento, cancelamento pelo WhatsApp, confirmação D-1)
      if (newSignature !== lastAppointmentsSignature) {
        lastAppointmentsSignature = newSignature;
        appointmentsState = newApts;
        renderAppointments();

        // Efeito visual sutil de pulso no badge Ao Vivo
        const badge = document.getElementById('badge-appointments-realtime');
        if (badge) {
          badge.classList.add('pulse-highlight');
          setTimeout(() => badge.classList.remove('pulse-highlight'), 1200);
        }
      }
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
  } catch (err) {
    // Silencioso em caso de oscilação momentânea de rede
  }
}

function startAppointmentsRealtimeSync() {
  if (appointmentsRealtimeTimer) clearInterval(appointmentsRealtimeTimer);
  appointmentsRealtimeTimer = setInterval(() => {
    const pane = document.getElementById('pane-appointments');
    if (pane && pane.classList.contains('active')) {
      syncAppointmentsRealtime();
    }
  }, 4000); // Polling em tempo real a cada 4 segundos
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
  const userAgentSelect = document.getElementById('modal-user-agent');

  const agentsList = (agents && agents.length > 0)
    ? agents
    : ((typeof allAgents !== 'undefined' && allAgents.length > 0) ? allAgents : (allAgentsCache || []));

  const effectiveCompany = getEffectiveActiveCompanyId();
  const isCompanyLocked = effectiveCompany !== 'all';

  if (filterSelect) {
    if (isCompanyLocked) {
      const myAgent = agentsList.find(a => a.id === effectiveCompany);
      const name = myAgent ? (myAgent.companyName || myAgent.name) : 'Minha Unidade';
      filterSelect.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(name)}</option>`;
      filterSelect.value = effectiveCompany;
      filterSelect.disabled = true;
      currentAppointmentsAgentFilter = effectiveCompany;
    } else {
      filterSelect.disabled = false;
      const current = filterSelect.value;
      filterSelect.innerHTML = '<option value="all">🌐 Todos os Clientes (Visão Geral)</option>';
      agentsList.forEach(a => {
        filterSelect.innerHTML += `<option value="${a.id}">🏢 ${escapeHtml(a.name)} (${escapeHtml(a.companyName || 'Empresa')})</option>`;
      });
      if (current) filterSelect.value = current;
    }
  }

  if (modalSelect) {
    if (isCompanyLocked) {
      const myAgent = agentsList.find(a => a.id === effectiveCompany);
      const name = myAgent ? (myAgent.companyName || myAgent.name) : 'Minha Unidade';
      modalSelect.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(name)}</option>`;
      modalSelect.value = effectiveCompany;
      modalSelect.disabled = true;
    } else {
      modalSelect.disabled = false;
      const current = modalSelect.value;
      modalSelect.innerHTML = '';
      agentsList.forEach(a => {
        modalSelect.innerHTML += `<option value="${a.id}">🏢 ${escapeHtml(a.name)} - ${escapeHtml(a.companyName || 'Empresa')}</option>`;
      });
      if (current) modalSelect.value = current;
    }
  }

  if (specAgentSelect) {
    if (isCompanyLocked) {
      const myAgent = agentsList.find(a => a.id === effectiveCompany);
      const name = myAgent ? (myAgent.companyName || myAgent.name) : 'Minha Unidade';
      specAgentSelect.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(name)}</option>`;
      specAgentSelect.value = effectiveCompany;
      specAgentSelect.disabled = true;
    } else {
      specAgentSelect.disabled = false;
      const current = specAgentSelect.value;
      specAgentSelect.innerHTML = '<option value="*">🌐 Todos os Clientes (Global)</option>';
      agentsList.forEach(a => {
        specAgentSelect.innerHTML += `<option value="${a.id}">🏢 ${escapeHtml(a.name)} (${escapeHtml(a.companyName || 'Empresa')})</option>`;
      });
      if (current) specAgentSelect.value = current;
    }
  }

  if (srvAgentSelect) {
    if (isCompanyLocked) {
      const myAgent = agentsList.find(a => a.id === effectiveCompany);
      const name = myAgent ? (myAgent.companyName || myAgent.name) : 'Minha Unidade';
      srvAgentSelect.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(name)}</option>`;
      srvAgentSelect.value = effectiveCompany;
      srvAgentSelect.disabled = true;
    } else {
      srvAgentSelect.disabled = false;
      const current = srvAgentSelect.value;
      srvAgentSelect.innerHTML = '<option value="*">🌐 Todos os Clientes (Global)</option>';
      agentsList.forEach(a => {
        srvAgentSelect.innerHTML += `<option value="${a.id}">🏢 ${escapeHtml(a.name)} (${escapeHtml(a.companyName || 'Empresa')})</option>`;
      });
      if (current) srvAgentSelect.value = current;
    }
  }

  if (userAgentSelect) {
    const current = userAgentSelect.value;
    userAgentSelect.innerHTML = '<option value="*">🌐 Todas as Agendas (Global)</option>';
    agentsList.forEach(a => {
      userAgentSelect.innerHTML += `<option value="${a.id}">🏢 ${escapeHtml(a.name)} (${escapeHtml(a.companyName || 'Empresa')})</option>`;
    });
    if (current) userAgentSelect.value = current;
  }

  updateTopbarCompanyDisplay();
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
              ${apt.referralType === 'partner' ? `<div style="font-size: 11px; color: #818cf8; font-weight:600; margin-bottom: 2px;">🏢 ${apt.partnerName || 'Convênio'}</div>` : ''}
              <div class="slot-service-name">🩺 ${apt.serviceName}</div>
              <div class="slot-patient-phone">
                <span>📱 ${formatPhoneDisplay(apt.clientPhone)}</span>
                ${apt.reminderSent ? '<span title="Lembrete D-1 enviado">🔔</span>' : ''}
              </div>
              <div class="slot-card-actions">
                <div class="slot-actions-btns">
                  <a href="https://wa.me/${(apt.clientPhone || '').replace(/@.*$/, '').replace(/\D/g, '')}" target="_blank" class="slot-action-btn btn-act-whatsapp" title="Conversar no WhatsApp">💬</a>
                  <button class="slot-action-btn" onclick="reNotifySpecialist('${apt.id}')" title="Reenviar notificação no WhatsApp do especialista">🔔 Médico</button>
                  <button class="slot-action-btn" onclick="sendIndividualReminder('${apt.id}')" title="Enviar Lembrete D-1 ao Paciente">📩 D-1</button>
                  <button class="slot-action-btn" onclick="openExamDispatchModalForAppointment('${apt.id}')" title="Enviar Exame/Laudo pelo WhatsApp">🔬 Exame</button>
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
              ${apt.referralType === 'partner' ? `<span>🏢 <strong style="color: #818cf8;">${apt.partnerName || 'Convênio'}</strong></span>` : ''}
              <span>👨‍⚕️ ${apt.specialistName} (${apt.specialistRole})</span>
              <span>🩺 ${apt.serviceName}</span>
              <span>📱 ${formatPhoneDisplay(apt.clientPhone)}</span>
              ${apt.notes ? `<span class="text-muted">📝 "${apt.notes}"</span>` : ''}
            </div>
            <div class="kanban-card-actions">
              <div class="d-flex gap-1">
                <a href="https://wa.me/${(apt.clientPhone || '').replace(/@.*$/, '').replace(/\D/g, '')}" target="_blank" class="slot-action-btn btn-act-whatsapp" title="Abrir WhatsApp">💬</a>
                <button class="slot-action-btn" onclick="reNotifySpecialist('${apt.id}')" title="Avisar Médico">👨‍⚕️</button>
                <button class="slot-action-btn" onclick="openExamDispatchModalForAppointment('${apt.id}')" title="Enviar Laudo/Exame">🔬</button>
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
          ${apt.referralType === 'partner' ? `<br><span class="badge badge-sm badge-indigo" style="font-size:10px;">🏢 ${apt.partnerName || 'Convênio'}</span>` : `<br><span class="badge badge-sm badge-outline" style="font-size:10px;">👤 Particular</span>`}
          ${apt.notes ? `<br><small class="text-muted">${apt.notes}</small>` : ''}
        </td>
        <td>
          <a href="https://wa.me/${(apt.clientPhone || '').replace(/@.*$/, '').replace(/\D/g, '')}" target="_blank" class="text-emerald" style="text-decoration: none;">
            📱 ${formatPhoneDisplay(apt.clientPhone)}
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
            <button class="btn btn-sm btn-outline" onclick="openExamDispatchModalForAppointment('${apt.id}')" title="Enviar Laudo/Exame">🔬</button>
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
      showToast(data.error || 'Especialista sem telefone cadastrado ou falha no envio WhatsApp.', 'warning');
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
      showToast(data.error || 'Não foi possível enviar o lembrete.', 'warning');
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

// Alternar exibição de clínica parceira no agendamento manual
document.querySelectorAll('input[name="modal-apt-referral-type"]').forEach(r => {
  r.addEventListener('change', (e) => {
    const wrap = document.getElementById('modal-apt-partner-wrap');
    if (wrap) wrap.style.display = e.target.value === 'partner' ? 'block' : 'none';
  });
});

// Submissão do Formulário de Agendamento Manual
document.getElementById('modal-appointment-form')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const referralType = document.querySelector('input[name="modal-apt-referral-type"]:checked')?.value || 'particular';
  const partnerId = referralType === 'partner' ? document.getElementById('modal-apt-partner')?.value : undefined;

  const payload = {
    agentId: document.getElementById('modal-apt-agent')?.value,
    specialistId: document.getElementById('modal-apt-specialist')?.value,
    serviceId: document.getElementById('modal-apt-service')?.value || undefined,
    date: document.getElementById('modal-apt-date')?.value,
    startTime: document.getElementById('modal-apt-time')?.value,
    clientName: document.getElementById('modal-apt-name')?.value.trim(),
    clientPhone: document.getElementById('modal-apt-phone')?.value.trim(),
    referralType,
    partnerId,
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
  const title = document.getElementById('form-spec-title');
  const idInput = document.getElementById('spec-id');
  const form = document.getElementById('form-specialist');

  if (wrap) {
    if (wrap.style.display === 'none' || !wrap.style.display) {
      if (form) form.reset();
      if (idInput) idInput.value = '';
      if (title) title.textContent = 'Cadastrar Novo Especialista';
      wrap.style.display = 'block';
      wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    } else {
      wrap.style.display = 'none';
    }
  }
});

document.getElementById('btn-cancel-specialist')?.addEventListener('click', () => {
  const wrap = document.getElementById('form-new-specialist-wrap');
  const idInput = document.getElementById('spec-id');
  const title = document.getElementById('form-spec-title');
  if (wrap) wrap.style.display = 'none';
  if (idInput) idInput.value = '';
  if (title) title.textContent = 'Cadastrar Novo Especialista';
});

// Editar Especialista (Abre formulário preenchido)
window.editSpecialist = function(id) {
  const spec = specialistsState.find(s => s.id === id);
  if (!spec) return;

  const wrap = document.getElementById('form-new-specialist-wrap');
  const title = document.getElementById('form-spec-title');
  const idInput = document.getElementById('spec-id');
  const agentSelect = document.getElementById('spec-agent');
  const nameInput = document.getElementById('spec-name');
  const roleInput = document.getElementById('spec-role');
  const phoneInput = document.getElementById('spec-phone');
  const startInput = document.getElementById('spec-hours-start');
  const endInput = document.getElementById('spec-hours-end');
  const breakStartInput = document.getElementById('spec-break-start');
  const breakEndInput = document.getElementById('spec-break-end');
  const durationSelect = document.getElementById('spec-duration');

  if (title) title.textContent = `Editar Especialista: ${spec.name}`;
  if (idInput) idInput.value = spec.id;
  if (agentSelect) agentSelect.value = spec.agentId || '*';
  if (nameInput) nameInput.value = spec.name || '';
  if (roleInput) roleInput.value = spec.role || '';
  if (phoneInput) phoneInput.value = spec.phone || '';
  if (startInput) startInput.value = spec.workHoursStart || '08:00';
  if (endInput) endInput.value = spec.workHoursEnd || '18:00';
  if (breakStartInput) breakStartInput.value = spec.breakStart || '12:00';
  if (breakEndInput) breakEndInput.value = spec.breakEnd || '13:00';
  if (durationSelect) durationSelect.value = String(spec.slotDurationMinutes || 30);

  const days = spec.workingDays || ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'];
  document.querySelectorAll('input[name="spec-days"]').forEach(cb => {
    cb.checked = days.includes(cb.value);
  });

  if (wrap) {
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};

// Salvar Especialista (Criar ou Editar)
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

    showToast(id ? 'Especialista atualizado com sucesso!' : 'Especialista cadastrado com sucesso!', 'success');
    document.getElementById('form-specialist').reset();
    document.getElementById('spec-id').value = '';
    document.getElementById('form-spec-title').textContent = 'Cadastrar Novo Especialista';
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
          <div class="d-flex justify-end gap-1">
            <button class="btn btn-sm btn-outline" onclick="editSpecialist('${s.id}')">✏️ Editar</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteSpecialist('${s.id}')">Excluir</button>
          </div>
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
  const title = document.getElementById('form-service-title');
  const idInput = document.getElementById('service-id');
  const form = document.getElementById('form-service');

  if (wrap) {
    if (wrap.style.display === 'none' || !wrap.style.display) {
      if (form) form.reset();
      if (idInput) idInput.value = '';
      if (title) title.textContent = 'Cadastrar Novo Procedimento';
      wrap.style.display = 'block';
    } else {
      wrap.style.display = 'none';
    }
  }
});

document.getElementById('btn-cancel-service')?.addEventListener('click', () => {
  const wrap = document.getElementById('form-new-service-wrap');
  const idInput = document.getElementById('service-id');
  const title = document.getElementById('form-service-title');
  if (wrap) wrap.style.display = 'none';
  if (idInput) idInput.value = '';
  if (title) title.textContent = 'Cadastrar Novo Procedimento';
});

// Editar Serviço (Abre formulário preenchido)
window.editService = function(id) {
  const srv = servicesState.find(s => s.id === id);
  if (!srv) return;

  const wrap = document.getElementById('form-new-service-wrap');
  const title = document.getElementById('form-service-title');
  const idInput = document.getElementById('service-id');
  const agentSelect = document.getElementById('service-agent');
  const nameInput = document.getElementById('service-name');
  const durationInput = document.getElementById('service-duration');
  const priceInput = document.getElementById('service-price');

  if (title) title.textContent = `Editar Procedimento: ${srv.name}`;
  if (idInput) idInput.value = srv.id;
  if (agentSelect) agentSelect.value = srv.agentId || '*';
  if (nameInput) nameInput.value = srv.name || '';
  if (durationInput) durationInput.value = String(srv.durationMinutes || 30);
  if (priceInput) priceInput.value = srv.price !== undefined ? String(srv.price) : '';

  if (wrap) {
    wrap.style.display = 'block';
    wrap.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
};

// Salvar Serviço (Criar ou Editar)
document.getElementById('form-service')?.addEventListener('submit', async (e) => {
  e.preventDefault();

  const id = document.getElementById('service-id')?.value;
  const payload = {
    agentId: document.getElementById('service-agent')?.value || '*',
    name: document.getElementById('service-name')?.value.trim(),
    durationMinutes: parseInt(document.getElementById('service-duration')?.value || '30', 10),
    price: parseFloat(document.getElementById('service-price')?.value || '0'),
    active: true
  };

  try {
    const url = id ? `/api/services/${id}` : '/api/services';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error('Falha ao salvar serviço.');

    showToast(id ? 'Procedimento atualizado com sucesso!' : 'Procedimento cadastrado com sucesso!', 'success');
    document.getElementById('form-service').reset();
    document.getElementById('service-id').value = '';
    document.getElementById('form-service-title').textContent = 'Cadastrar Novo Procedimento';
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
          <div class="d-flex justify-end gap-1">
            <button class="btn btn-sm btn-outline" onclick="editService('${srv.id}')">✏️ Editar</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteService('${srv.id}')">Excluir</button>
          </div>
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
      hideLoginModal(data.user || { username: 'admin', role: 'admin' });
      checkStatus();
      if (data.user?.role === 'admin') {
        loadConfig();
        loadSchedule();
        loadWahaConfig();
        await loadAgents();
      }
      loadAgentsForSimulator();

      // Aplica empresa ativa salva no localStorage ou vinculada ao atendente
      if (data.user?.assignedAgentId && data.user.assignedAgentId !== '*') {
        setActiveCompany(data.user.assignedAgentId, false);
      } else {
        setActiveCompany(currentActiveCompanyId, false);
      }

      await loadAppointments();
      startAppointmentsRealtimeSync();
      if (data.user?.role === 'attendant') {
        switchToTab('appointments');
      }
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

// ============================================================================
// GESTÃO DE USUÁRIOS & EQUIPE (RBAC - EXCLUSIVO ADMIN)
// ============================================================================
let allUsers = [];

async function loadUsers() {
  if (!getAuthToken() || currentUser?.role !== 'admin') return;
  try {
    const res = await fetchWithAuth('/api/users');
    if (!res.ok) throw new Error('Não foi possível carregar a lista de usuários.');
    const data = await res.json();
    allUsers = data.users || [];
    renderUsersTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderUsersTable() {
  const tbody = document.getElementById('users-table-body');
  const countBadge = document.getElementById('users-count-badge');
  if (!tbody) return;

  if (countBadge) {
    countBadge.textContent = `${allUsers.length} usuário${allUsers.length === 1 ? '' : 's'}`;
  }

  if (allUsers.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">Nenhum usuário cadastrado.</td></tr>`;
    return;
  }

  let html = '';
  allUsers.forEach(u => {
    const isSelf = currentUser && (currentUser.userId === u.id || currentUser.username === u.username);
    const roleBadge = u.role === 'admin'
      ? `<span class="badge badge-purple" style="font-size: 11px;">👑 Administrador Geral</span>`
      : `<span class="badge badge-emerald" style="font-size: 11px;">👩‍💼 Atendimento / Recepção</span>`;

    let agentLabel = '<span class="badge badge-info" style="font-size: 11px;">🌐 Todas as Agendas</span>';
    if (u.assignedAgentId && u.assignedAgentId !== '*') {
      const agentObj = allAgentsCache.find(a => a.id === u.assignedAgentId);
      agentLabel = `<span class="badge badge-purple" style="font-size: 11px;">🏢 ${agentObj ? agentObj.name : u.assignedAgentId}</span>`;
    }

    const statusBadge = u.active
      ? `<span class="badge badge-success">Ativo</span>`
      : `<span class="badge badge-danger">Inativo</span>`;

    const dateFormatted = u.createdAt ? formatDateBR(u.createdAt.substring(0, 10)) : '--';

    html += `
      <tr>
        <td>
          <div style="font-weight: 600;">${u.name || u.username} ${isSelf ? '<span class="badge badge-primary" style="font-size: 10px; margin-left: 4px;">Você</span>' : ''}</div>
        </td>
        <td><code>${u.username}</code></td>
        <td>${roleBadge}</td>
        <td>${agentLabel}</td>
        <td>${statusBadge}</td>
        <td><small class="text-muted">${dateFormatted}</small></td>
        <td style="text-align: right;">
          <div class="d-flex justify-end gap-1">
            <button class="btn btn-sm btn-outline" onclick="openEditUserModal('${u.id}')" title="Editar Usuário">✏️ Editar</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteUser('${u.id}')" title="Excluir Usuário" ${isSelf || (u.username === 'admin') ? 'disabled style="opacity:0.4; cursor:not-allowed;"' : ''}>🗑️ Excluir</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function openNewUserModal() {
  document.getElementById('modal-user-id').value = '';
  document.getElementById('modal-user-title').textContent = 'Cadastrar Novo Membro da Equipe';
  document.getElementById('modal-user-subtitle').textContent = 'Defina o nome, credenciais e permissão de acesso à agenda.';
  document.getElementById('modal-user-name').value = '';
  document.getElementById('modal-user-username').value = '';
  document.getElementById('modal-user-username').disabled = false;
  
  const passInput = document.getElementById('modal-user-password');
  passInput.value = '';
  passInput.required = true;
  document.getElementById('modal-user-pass-label').innerHTML = 'Senha de Acesso <span class="text-danger">*</span>';
  document.getElementById('modal-user-pass-hint').textContent = 'Mínimo de 4 caracteres.';
  
  document.getElementById('modal-user-role').value = 'attendant';
  document.getElementById('modal-user-agent').value = '*';
  document.getElementById('modal-user-active').value = 'true';

  populateUserAgentDropdown('*');

  const overlay = document.getElementById('modal-user-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function openEditUserModal(userId) {
  const user = allUsers.find(u => u.id === userId);
  if (!user) return;

  document.getElementById('modal-user-id').value = user.id;
  document.getElementById('modal-user-title').textContent = `Editar Membro: ${user.name || user.username}`;
  document.getElementById('modal-user-subtitle').textContent = 'Altere permissões, vínculo ou redefina a senha de acesso.';
  document.getElementById('modal-user-name').value = user.name || '';
  document.getElementById('modal-user-username').value = user.username;
  document.getElementById('modal-user-username').disabled = (user.username === 'admin');

  const passInput = document.getElementById('modal-user-password');
  passInput.value = '';
  passInput.required = false;
  document.getElementById('modal-user-pass-label').textContent = 'Nova Senha (Opcional)';
  document.getElementById('modal-user-pass-hint').textContent = 'Deixe em branco para manter a senha atual do membro.';

  document.getElementById('modal-user-role').value = user.role || 'attendant';
  document.getElementById('modal-user-active').value = user.active ? 'true' : 'false';

  populateUserAgentDropdown(user.assignedAgentId || '*');

  const overlay = document.getElementById('modal-user-overlay');
  if (overlay) overlay.style.display = 'flex';
}

function populateUserAgentDropdown(selectedVal = '*') {
  const select = document.getElementById('modal-user-agent');
  if (!select) return;
  select.innerHTML = '<option value="*">🌐 Todas as Agendas (Global)</option>';
  allAgentsCache.forEach(a => {
    select.innerHTML += `<option value="${a.id}">🏢 ${a.name} (${a.companyName || 'Empresa'})</option>`;
  });
  select.value = selectedVal;
}

function closeUserModal() {
  const overlay = document.getElementById('modal-user-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function saveUser(e) {
  e.preventDefault();
  const id = document.getElementById('modal-user-id').value;
  const name = document.getElementById('modal-user-name').value.trim();
  const username = document.getElementById('modal-user-username').value.trim();
  const password = document.getElementById('modal-user-password').value;
  const role = document.getElementById('modal-user-role').value;
  const assignedAgentId = document.getElementById('modal-user-agent').value;
  const active = document.getElementById('modal-user-active').value === 'true';

  if (!name || !username) {
    showToast('Informe o nome completo e usuário.', 'error');
    return;
  }

  const submitBtn = document.getElementById('btn-save-user');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Salvando... ⏳';

  try {
    const payload = { name, username, role, assignedAgentId, active };
    if (password && password.trim()) {
      payload.password = password.trim();
    }

    let res;
    if (id) {
      res = await fetchWithAuth(`/api/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } else {
      if (!password || password.length < 4) {
        throw new Error('A senha inicial deve ter pelo menos 4 caracteres.');
      }
      res = await fetchWithAuth('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    }

    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Erro ao salvar usuário.');
    }

    showToast(id ? 'Membro atualizado com sucesso!' : 'Novo membro cadastrado com sucesso!', 'success');
    closeUserModal();
    await loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    submitBtn.disabled = false;
    submitBtn.textContent = '💾 Salvar Membro';
  }
}

async function deleteUser(userId) {
  const user = allUsers.find(u => u.id === userId);
  const name = user ? (user.name || user.username) : 'este usuário';
  if (!confirm(`Deseja realmente remover o usuário "${name}"? Esta ação não pode ser desfeita.`)) return;

  try {
    const res = await fetchWithAuth(`/api/users/${userId}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || 'Erro ao remover usuário.');
    }
    showToast('Usuário removido com sucesso.', 'success');
    await loadUsers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Event Listeners de Gestão de Usuários
document.getElementById('btn-create-user')?.addEventListener('click', openNewUserModal);
document.getElementById('btn-close-user-modal')?.addEventListener('click', closeUserModal);
document.getElementById('btn-cancel-user')?.addEventListener('click', closeUserModal);
document.getElementById('modal-user-form')?.addEventListener('submit', saveUser);
document.getElementById('modal-user-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-user-overlay') closeUserModal();
});

// ============================================================================
// IMPRESSÃO & RELATÓRIOS OFICIAIS DE AGENDAMENTOS (A4 / PDF)
// ============================================================================

function openPrintModal() {
  const overlay = document.getElementById('modal-print-overlay');
  if (!overlay) return;

  // 1. Popula Especialidades a partir de specialistsState
  const roleSelect = document.getElementById('print-filter-role');
  if (roleSelect) {
    const roles = Array.from(new Set(specialistsState.map(s => (s.role || '').trim()).filter(Boolean))).sort();
    let rHtml = '<option value="all" selected>🩺 Todas as Especialidades</option>';
    roles.forEach(r => {
      rHtml += `<option value="${r}">${r}</option>`;
    });
    roleSelect.innerHTML = rHtml;
  }

  // 2. Popula Especialistas
  populatePrintSpecialistsDropdown();

  // 3. Popula Unidades / Agentes
  const agentSelect = document.getElementById('print-filter-agent');
  if (agentSelect) {
    const effectiveCompany = getEffectiveActiveCompanyId();
    if (effectiveCompany !== 'all') {
      const myAgent = allAgentsCache.find(a => a.id === effectiveCompany) || allAgents.find(a => a.id === effectiveCompany);
      agentSelect.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(myAgent ? (myAgent.companyName || myAgent.name) : 'Minha Unidade')}</option>`;
      agentSelect.value = effectiveCompany;
      agentSelect.disabled = true;
    } else {
      agentSelect.disabled = false;
      let aHtml = '<option value="all" selected>🌐 Todas as Unidades (Visão Geral)</option>';
      allAgentsCache.forEach(a => {
        aHtml += `<option value="${a.id}">🏢 ${a.name} (${a.companyName || 'Empresa'})</option>`;
      });
      agentSelect.innerHTML = aHtml;
      if (currentAppointmentsAgentFilter && currentAppointmentsAgentFilter !== 'all') {
        agentSelect.value = currentAppointmentsAgentFilter;
      }
    }
  }

  // 4. Sincroniza Data inicial com base no filtro da tela
  const dateTypeSelect = document.getElementById('print-filter-date-type');
  const dateValInput = document.getElementById('print-filter-date-val');
  const dateValWrap = document.getElementById('print-custom-date-wrap');

  if (dateTypeSelect) {
    if (currentAppointmentsDateFilter === 'tomorrow') {
      dateTypeSelect.value = 'tomorrow';
      if (dateValWrap) dateValWrap.style.display = 'none';
    } else if (currentAppointmentsDateFilter === 'all') {
      dateTypeSelect.value = 'all';
      if (dateValWrap) dateValWrap.style.display = 'none';
    } else if (currentAppointmentsDateFilter === 'custom') {
      dateTypeSelect.value = 'custom';
      if (dateValInput) dateValInput.value = currentAppointmentsDateValue || getTodayString();
      if (dateValWrap) dateValWrap.style.display = 'block';
    } else {
      dateTypeSelect.value = 'today';
      if (dateValWrap) dateValWrap.style.display = 'none';
    }
  }

  if (dateValInput && !dateValInput.value) {
    dateValInput.value = getTodayString();
  }

  // Exibe o modal e calcula o preview count
  overlay.style.display = 'flex';
  updatePrintPreviewCount();
}

function closePrintModal() {
  const overlay = document.getElementById('modal-print-overlay');
  if (overlay) overlay.style.display = 'none';
}

function populatePrintSpecialistsDropdown() {
  const specSelect = document.getElementById('print-filter-specialist');
  const selectedRole = document.getElementById('print-filter-role')?.value || 'all';
  if (!specSelect) return;

  let specs = specialistsState.filter(s => s.active);
  if (selectedRole !== 'all') {
    specs = specs.filter(s => s.role === selectedRole);
  }

  let html = '<option value="all" selected>👨‍⚕️ Todos os Especialistas</option>';
  specs.forEach(s => {
    html += `<option value="${s.id}">${s.name} (${s.role})</option>`;
  });
  specSelect.innerHTML = html;
}

async function getFilteredAppointmentsForPrint() {
  const dateType = document.getElementById('print-filter-date-type')?.value || 'today';
  const customDate = document.getElementById('print-filter-date-val')?.value;
  const role = document.getElementById('print-filter-role')?.value || 'all';
  const specialistId = document.getElementById('print-filter-specialist')?.value || 'all';
  const statusFilter = document.getElementById('print-filter-status')?.value || 'active';
  const effectiveCompany = getEffectiveActiveCompanyId();
  const agentId = (effectiveCompany !== 'all') ? effectiveCompany : (document.getElementById('print-filter-agent')?.value || 'all');

  // Monta parâmetros para o backend
  const query = new URLSearchParams();
  if (dateType === 'today') {
    query.set('date', getTodayString());
  } else if (dateType === 'tomorrow') {
    query.set('date', getTomorrowString());
  } else if (dateType === 'custom' && customDate) {
    query.set('date', customDate);
  }

  if (agentId !== 'all') {
    query.set('agentId', agentId);
  }

  if (specialistId !== 'all') {
    query.set('specialistId', specialistId);
  }

  try {
    const res = await fetchWithAuth(`/api/appointments?${query.toString()}`);
    if (!res.ok) throw new Error('Falha ao buscar agendamentos para impressão.');
    const data = await res.json();
    let list = data.appointments || [];

    // Filtra por especialidade se selecionada
    if (role !== 'all') {
      list = list.filter(apt => {
        if (apt.specialistRole && apt.specialistRole.toLowerCase() === role.toLowerCase()) return true;
        const spec = specialistsState.find(s => s.id === apt.specialistId);
        return spec && spec.role && spec.role.toLowerCase() === role.toLowerCase();
      });
    }

    // Filtra por status
    if (statusFilter === 'active') {
      const activeStatuses = ['scheduled', 'confirmed', 'presence_confirmed', 'waiting', 'in_progress'];
      list = list.filter(apt => activeStatuses.includes(apt.status));
    } else if (statusFilter === 'confirmed_only') {
      const confirmedStatuses = ['scheduled', 'confirmed', 'presence_confirmed'];
      list = list.filter(apt => confirmedStatuses.includes(apt.status));
    } else if (statusFilter === 'completed') {
      list = list.filter(apt => apt.status === 'completed');
    } else if (statusFilter === 'cancelled') {
      const cancelledStatuses = ['cancelled', 'cancelled_by_patient', 'no_show'];
      list = list.filter(apt => cancelledStatuses.includes(apt.status));
    }

    // Ordenação por data ascendente e horário ascendente
    list.sort((a, b) => {
      if (a.date !== b.date) return a.date.localeCompare(b.date);
      return (a.startTime || '').localeCompare(b.startTime || '');
    });

    return list;
  } catch (err) {
    console.error('Erro ao filtrar agendamentos para impressão:', err);
    return [];
  }
}

async function updatePrintPreviewCount() {
  const countEl = document.getElementById('print-preview-count');
  if (!countEl) return;
  countEl.textContent = 'Calculando... ⏳';

  const list = await getFilteredAppointmentsForPrint();
  countEl.textContent = `${list.length} paciente${list.length === 1 ? '' : 's'} selecionado${list.length === 1 ? '' : 's'}`;
}

async function generateAndPrintReport() {
  const executeBtn = document.getElementById('btn-execute-print');
  if (executeBtn) {
    executeBtn.disabled = true;
    executeBtn.textContent = 'Gerando Relatório... ⏳';
  }

  try {
    const list = await getFilteredAppointmentsForPrint();
    if (list.length === 0) {
      if (!confirm('Nenhum agendamento encontrado para os filtros selecionados. Deseja visualizar a folha de relatório mesmo assim?')) {
        return;
      }
    }

    // Identifica filtros para o cabeçalho do documento
    const dateType = document.getElementById('print-filter-date-type')?.value;
    const customDate = document.getElementById('print-filter-date-val')?.value;
    const role = document.getElementById('print-filter-role')?.value;
    const specialistId = document.getElementById('print-filter-specialist')?.value;
    const statusFilter = document.getElementById('print-filter-status')?.value;
    const agentId = document.getElementById('print-filter-agent')?.value;

    let periodLabel = 'Todas as Datas';
    if (dateType === 'today') periodLabel = `Hoje (${formatDateBR(getTodayString())})`;
    else if (dateType === 'tomorrow') periodLabel = `Amanhã (${formatDateBR(getTomorrowString())})`;
    else if (dateType === 'custom' && customDate) periodLabel = formatDateBR(customDate);

    let specialtyLabel = role === 'all' || !role ? 'Todas as Especialidades' : role;
    let specialistLabel = 'Todos os Especialistas';
    if (specialistId !== 'all') {
      const spec = specialistsState.find(s => s.id === specialistId);
      if (spec) specialistLabel = `${spec.name} (${spec.role})`;
    }

    let unitLabel = 'Todas as Unidades (Visão Geral)';
    if (agentId !== 'all') {
      const ag = allAgentsCache.find(a => a.id === agentId);
      if (ag) unitLabel = `${ag.name} - ${ag.companyName || 'Empresa'}`;
    }

    let statusLabel = 'Ativos / Válidos';
    if (statusFilter === 'confirmed_only') statusLabel = 'Apenas Confirmados & Presença';
    else if (statusFilter === 'completed') statusLabel = 'Apenas Concluídos';
    else if (statusFilter === 'cancelled') statusLabel = 'Cancelados / Desistências';
    else if (statusFilter === 'all') statusLabel = 'Todos os Status';

    const now = new Date();
    const emitDate = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const emittedBy = currentUser?.name || currentUser?.username || 'Recepção';

    // Monta linhas da tabela
    let rowsHtml = '';
    if (list.length === 0) {
      rowsHtml = `<tr><td colspan="8" style="text-align:center; padding: 25px; color: #6b7280;">Nenhum agendamento registrado para os filtros selecionados.</td></tr>`;
    } else {
      list.forEach((apt, idx) => {
        let statusBadge = 'Confirmado';
        if (apt.status === 'presence_confirmed') statusBadge = 'Presença D-1 ✅';
        else if (apt.status === 'waiting') statusBadge = 'Recepção / Espera';
        else if (apt.status === 'in_progress') statusBadge = 'Em Atendimento';
        else if (apt.status === 'completed') statusBadge = 'Concluído';
        else if (apt.status === 'cancelled' || apt.status === 'cancelled_by_patient') statusBadge = 'Cancelado';

        const phoneDisplay = formatPhoneDisplay(apt.clientPhone);
        const dateFormatted = formatDateBR(apt.date);

        rowsHtml += `
          <tr>
            <td style="text-align: center; font-weight: bold; width: 32px;">${idx + 1}</td>
            <td style="white-space: nowrap; width: 95px;">
              <div style="font-weight: 700; font-size: 13px; color: #111827;">${apt.startTime || '--:--'}</div>
              <div style="font-size: 10px; color: #6b7280;">${dateFormatted}</div>
            </td>
            <td style="width: 200px;">
              <div style="font-weight: 600; font-size: 13px; color: #111827;">${apt.clientName || 'Paciente'}</div>
              ${apt.notes ? `<div style="font-size: 10px; color: #4b5563; font-style: italic;">Obs: ${apt.notes}</div>` : ''}
            </td>
            <td style="white-space: nowrap; width: 125px; font-family: monospace; font-size: 12px;">
              ${phoneDisplay}
            </td>
            <td>
              <div style="font-weight: 500;">${apt.serviceName || 'Consulta'}</div>
            </td>
            <td>
              <div style="font-weight: 600;">${apt.specialistName || 'Profissional'}</div>
              <div style="font-size: 10px; color: #6b7280;">${apt.specialistRole || 'Especialista'}</div>
            </td>
            <td style="text-align: center; white-space: nowrap; width: 95px;">
              <span style="font-size: 11px; font-weight: 600; padding: 2px 6px; border-radius: 4px; background: #f3f4f6; border: 1px solid #d1d5db;">
                ${statusBadge}
              </span>
            </td>
            <td style="width: 130px; text-align: center;">
              <div style="border-bottom: 1px dashed #9ca3af; height: 22px; margin-top: 4px;"></div>
            </td>
          </tr>
        `;
      });
    }

    const printHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Lista de Agendamentos - ${periodLabel}</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 10mm 12mm 10mm 12mm;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      margin: 0;
      padding: 0;
      color: #1f2937;
      background: #ffffff;
      font-size: 12px;
      line-height: 1.35;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 8px;
      margin-bottom: 10px;
    }
    .clinic-info h1 {
      margin: 0;
      font-size: 18px;
      font-weight: 800;
      color: #1e3a8a;
      letter-spacing: -0.5px;
      text-transform: uppercase;
    }
    .clinic-info p {
      margin: 2px 0 0 0;
      font-size: 12px;
      color: #4b5563;
      font-weight: 500;
    }
    .meta-info {
      text-align: right;
      font-size: 10.5px;
      color: #6b7280;
    }
    .meta-info strong {
      color: #1f2937;
    }
    .filters-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 6px 12px;
      margin-bottom: 12px;
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 8px;
      font-size: 11px;
    }
    .filter-item strong {
      display: block;
      color: #64748b;
      font-size: 9.5px;
      text-transform: uppercase;
      letter-spacing: 0.3px;
    }
    .filter-item span {
      font-weight: 600;
      color: #0f172a;
    }
    table.report-table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 14px;
    }
    table.report-table th {
      background: #1e293b;
      color: #ffffff;
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      padding: 6px 8px;
      border: 1px solid #1e293b;
      text-align: left;
    }
    table.report-table td {
      padding: 6px 8px;
      border: 1px solid #e5e7eb;
      vertical-align: middle;
      font-size: 11px;
    }
    table.report-table tr:nth-child(even) td {
      background: #f9fafb;
    }
    .report-footer {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 14px;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 10.5px;
      color: #6b7280;
    }
    .signature-area {
      text-align: center;
      width: 250px;
    }
    .signature-line {
      border-bottom: 1px solid #111827;
      margin-bottom: 4px;
      height: 30px;
    }
    .signature-title {
      font-size: 10px;
      color: #4b5563;
      font-weight: 600;
    }
    .no-print-bar {
      background: #1e293b;
      color: white;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .btn-print {
      background: #2563eb;
      color: white;
      border: none;
      padding: 6px 16px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    @media print {
      .no-print-bar {
        display: none !important;
      }
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <span>🖨️ Pré-visualização de Impressão Oficial • Pressione <strong>Imprimir</strong> ou <code>Ctrl+P</code></span>
    <button class="btn-print" onclick="window.print()">Imprimir / Salvar PDF</button>
  </div>

  <div style="padding: 14px 16px;">
    <div class="report-header">
      <div class="clinic-info">
        <h1>Relatório Oficial de Agendamentos</h1>
        <p>Unidade: <strong>${unitLabel}</strong></p>
      </div>
      <div class="meta-info">
        <div>Emissão: <strong>${emitDate}</strong></div>
        <div>Responsável: <strong>${emittedBy}</strong></div>
        <div>Total de Pacientes: <strong>${list.length}</strong></div>
      </div>
    </div>

    <div class="filters-box">
      <div class="filter-item">
        <strong>Período</strong>
        <span>${periodLabel}</span>
      </div>
      <div class="filter-item">
        <strong>Especialidade</strong>
        <span>${specialtyLabel}</span>
      </div>
      <div class="filter-item">
        <strong>Profissional</strong>
        <span>${specialistLabel}</span>
      </div>
      <div class="filter-item">
        <strong>Filtro de Status</strong>
        <span>${statusLabel}</span>
      </div>
    </div>

    <table class="report-table">
      <thead>
        <tr>
          <th style="text-align: center; width: 30px;">#</th>
          <th style="width: 95px;">Horário</th>
          <th style="width: 200px;">Paciente</th>
          <th style="width: 120px;">WhatsApp</th>
          <th>Procedimento</th>
          <th>Especialista</th>
          <th style="text-align: center; width: 95px;">Status</th>
          <th style="text-align: center; width: 130px;">Visto / Assinatura</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="report-footer">
      <div>
        <div><strong>Total de Atendimentos Listados:</strong> ${list.length} paciente(s)</div>
        <div style="margin-top: 3px; font-size: 9.5px; color: #9ca3af;">Sistema Multiagente de Agendamento Inteligente & IA WhatsApp</div>
      </div>
      <div class="signature-area">
        <div class="signature-line"></div>
        <div class="signature-title">Visto da Recepção / Coordenação</div>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('load', () => {
      setTimeout(() => {
        window.print();
      }, 400);
    });
  <\/script>
</body>
</html>`;

    const printWin = window.open('', '_blank', 'width=960,height=750');
    if (!printWin) {
      showToast('O navegador bloqueou o pop-up de impressão. Permita pop-ups para este site.', 'warning');
      return;
    }

    printWin.document.open();
    printWin.document.write(printHtml);
    printWin.document.close();

    closePrintModal();
    showToast('Relatório de impressão gerado com sucesso!', 'success');
  } catch (err) {
    showToast(`Erro ao gerar relatório: ${err.message}`, 'error');
  } finally {
    if (executeBtn) {
      executeBtn.disabled = false;
      executeBtn.textContent = '🖨️ Visualizar & Imprimir (PDF)';
    }
  }
}

// Event Listeners da Impressão de Agendamentos
document.getElementById('btn-print-appointments')?.addEventListener('click', openPrintModal);
document.getElementById('btn-close-print-modal')?.addEventListener('click', closePrintModal);
document.getElementById('btn-cancel-print')?.addEventListener('click', closePrintModal);
document.getElementById('modal-print-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-print-overlay') closePrintModal();
});

document.getElementById('print-filter-date-type')?.addEventListener('change', (e) => {
  const wrap = document.getElementById('print-custom-date-wrap');
  if (wrap) wrap.style.display = e.target.value === 'custom' ? 'block' : 'none';
  updatePrintPreviewCount();
});

document.getElementById('print-filter-date-val')?.addEventListener('change', updatePrintPreviewCount);

document.getElementById('print-filter-role')?.addEventListener('change', () => {
  populatePrintSpecialistsDropdown();
  updatePrintPreviewCount();
});

document.getElementById('print-filter-specialist')?.addEventListener('change', updatePrintPreviewCount);
document.getElementById('btn-execute-print')?.addEventListener('click', generateAndPrintReport);

// ============================================================================
// GESTÃO DE PARCEIROS & CONVÊNIOS (CLÍNICAS PARCEIRAS)
// ============================================================================

let currentPartnersList = [];

async function loadPartners() {
  try {
    const res = await fetchWithAuth('/api/partners');
    if (!res.ok) throw new Error('Falha ao carregar parceiros.');
    const data = await res.json();
    currentPartnersList = data.partners || [];
    renderPartners(currentPartnersList);
    populatePartnersDropdowns();
  } catch (err) {
    console.error('Erro ao carregar parceiros:', err);
  }
}

function renderPartners(partners) {
  const tbody = document.getElementById('partners-table-body');
  if (!tbody) return;

  if (partners.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center p-4 text-muted">Nenhum parceiro ou convênio cadastrado.</td></tr>`;
    return;
  }

  let html = '';
  partners.forEach(p => {
    html += `
      <tr>
        <td>
          <strong>${escapeHtml(p.name)}</strong>
          ${p.notes ? `<br><small class="text-muted">${escapeHtml(p.notes)}</small>` : ''}
        </td>
        <td><small style="font-family: monospace;">${p.document || '-'}</small></td>
        <td>
          <a href="https://wa.me/${(p.phone || '').replace(/\D/g, '')}" target="_blank" class="text-emerald" style="text-decoration: none;">
            📱 ${formatPhoneDisplay(p.phone)}
          </a>
        </td>
        <td>${escapeHtml(p.contactPerson || '-')}</td>
        <td><small>${escapeHtml(p.email || '-')}</small></td>
        <td>
          <span class="badge ${p.active ? 'badge-emerald' : 'badge-rose'}" style="font-size: 11px;">
            ${p.active ? '✅ Ativo' : '⛔ Inativo'}
          </span>
        </td>
        <td style="text-align: right;">
          <div class="d-flex justify-end gap-1">
            <button class="btn btn-sm btn-outline" onclick="openEditPartnerModal('${p.id}')" title="Editar Dados">✏️</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deletePartnerRecord('${p.id}')" title="Remover Parceiro">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function populatePartnersDropdowns() {
  const selects = [
    document.getElementById('modal-apt-partner'),
    document.getElementById('modal-exam-partner-select'),
    document.getElementById('exam-filter-partner'),
    document.getElementById('print-exams-filter-partner')
  ];

  selects.forEach(sel => {
    if (!sel) return;
    const isFilter = sel.id.includes('filter');
    const defaultText = isFilter ? (sel.id.includes('print') ? '🏢 Todas as Clínicas Parceiras & Particulares' : 'Todas as Clínicas') : 'Selecione a empresa conveniada...';
    const currentVal = sel.value;

    let opts = isFilter ? `<option value="all">${defaultText}</option>` : `<option value="">${defaultText}</option>`;
    currentPartnersList.forEach(p => {
      if (isFilter || p.active) {
        opts += `<option value="${p.id}">${escapeHtml(p.name)} (${formatPhoneDisplay(p.phone)})</option>`;
      }
    });

    sel.innerHTML = opts;
    if (currentVal) sel.value = currentVal;
  });
}

function openPartnersModal() {
  const overlay = document.getElementById('modal-partners-overlay');
  if (overlay) {
    overlay.style.display = 'flex';
    hidePartnerForm();
    loadPartners();
  }
}

function closePartnersModal() {
  const overlay = document.getElementById('modal-partners-overlay');
  if (overlay) overlay.style.display = 'none';
}

function showPartnerForm(partner = null) {
  const card = document.getElementById('partner-form-card');
  const title = document.getElementById('partner-form-title');
  const idInput = document.getElementById('partner-form-id');
  if (!card) return;

  document.getElementById('partner-edit-form').reset();

  if (partner) {
    title.textContent = 'Editar Empresa Parceira';
    idInput.value = partner.id;
    document.getElementById('partner-form-name').value = partner.name || '';
    document.getElementById('partner-form-phone').value = partner.phone || '';
    document.getElementById('partner-form-doc').value = partner.document || '';
    document.getElementById('partner-form-contact').value = partner.contactPerson || '';
    document.getElementById('partner-form-email').value = partner.email || '';
    document.getElementById('partner-form-notes').value = partner.notes || '';
    document.getElementById('partner-form-active').value = partner.active ? 'true' : 'false';
  } else {
    title.textContent = 'Cadastrar Nova Empresa Parceira';
    idInput.value = '';
    document.getElementById('partner-form-active').value = 'true';
  }

  card.style.display = 'block';
  document.getElementById('partner-form-name').focus();
}

function hidePartnerForm() {
  const card = document.getElementById('partner-form-card');
  if (card) card.style.display = 'none';
}

function openEditPartnerModal(id) {
  const partner = currentPartnersList.find(p => p.id === id);
  if (partner) showPartnerForm(partner);
}

async function handlePartnerFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById('partner-form-id')?.value;
  const name = document.getElementById('partner-form-name')?.value.trim();
  const phone = document.getElementById('partner-form-phone')?.value.trim();
  const documentVal = document.getElementById('partner-form-doc')?.value.trim();
  const contactPerson = document.getElementById('partner-form-contact')?.value.trim();
  const email = document.getElementById('partner-form-email')?.value.trim();
  const notes = document.getElementById('partner-form-notes')?.value.trim();
  const active = document.getElementById('partner-form-active')?.value === 'true';

  if (!name || !phone) {
    showToast('Nome e WhatsApp da clínica/empresa são obrigatórios.', 'warning');
    return;
  }

  const payload = { name, phone, document: documentVal, contactPerson, email, notes, active };

  try {
    const url = id ? `/api/partners/${id}` : '/api/partners';
    const method = id ? 'PUT' : 'POST';

    const res = await fetchWithAuth(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao salvar parceiro.');

    showToast(`Parceiro ${id ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
    hidePartnerForm();
    await loadPartners();
  } catch (err) {
    showToast(`Erro: ${err.message}`, 'error');
  }
}

async function deletePartnerRecord(id) {
  const partner = currentPartnersList.find(p => p.id === id);
  const name = partner ? partner.name : 'este parceiro';
  if (!confirm(`Deseja realmente remover o parceiro "${name}"?`)) return;

  try {
    const res = await fetchWithAuth(`/api/partners/${id}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha ao excluir parceiro.');
    showToast('Parceiro excluído com sucesso!', 'success');
    await loadPartners();
  } catch (err) {
    showToast(`Erro ao excluir: ${err.message}`, 'error');
  }
}

// ============================================================================
// SISTEMA DE ENVIO & GESTÃO DE EXAMES / LAUDOS
// ============================================================================

let currentExamsList = [];

async function loadExams() {
  try {
    const referralFilter = document.getElementById('exam-filter-referral')?.value || 'all';
    const partnerFilter = document.getElementById('exam-filter-partner')?.value || 'all';
    const statusFilter = document.getElementById('exam-filter-status')?.value || 'all';
    const effectiveCompany = getEffectiveActiveCompanyId();
    const agentFilter = (effectiveCompany !== 'all') ? effectiveCompany : (document.getElementById('exam-filter-agent')?.value || 'all');
    const searchVal = document.getElementById('exam-search-input')?.value || '';

    const params = new URLSearchParams();
    if (referralFilter !== 'all') params.append('referralType', referralFilter);
    if (partnerFilter !== 'all') params.append('partnerId', partnerFilter);
    if (statusFilter !== 'all') params.append('status', statusFilter);
    if (agentFilter !== 'all') params.append('agentId', agentFilter);
    if (searchVal.trim()) params.append('search', searchVal.trim());

    const res = await fetchWithAuth(`/api/exams?${params.toString()}`);
    if (!res.ok) throw new Error('Falha ao carregar exames.');
    const data = await res.json();
    currentExamsList = data.exams || [];

    renderExams(currentExamsList);
    updateExamKPIs(currentExamsList);

    // Carrega parceiros para dropdowns caso ainda não carregados
    if (currentPartnersList.length === 0) {
      loadPartners();
    }
  } catch (err) {
    console.error('Erro ao carregar exames:', err);
    showToast(`Erro ao carregar exames: ${err.message}`, 'error');
  }
}

function formatCpf(cpf) {
  if (!cpf) return '';
  const digits = String(cpf).replace(/\D/g, '').slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9, 11)}`;
}

function maskCpf(cpf) {
  if (!cpf) return '';
  const digits = String(cpf).replace(/\D/g, '');
  if (digits.length < 3) return digits;
  const first3 = digits.substring(0, 3);
  return `${first3}.***.***-**`;
}

function updateExamKPIs(exams) {
  const totalEl = document.getElementById('kpi-exams-total');
  const successEl = document.getElementById('kpi-exams-success');
  const awaitingCpfEl = document.getElementById('kpi-exams-awaiting-cpf');
  const partnerEl = document.getElementById('kpi-exams-partner');
  const particularEl = document.getElementById('kpi-exams-particular');
  const failedEl = document.getElementById('kpi-exams-failed');
  const badgeTotal = document.getElementById('badge-total-exams');

  const total = exams.length;
  const success = exams.filter(e => e.status === 'sent').length;
  const awaitingCpf = exams.filter(e => e.status === 'awaiting_cpf').length;
  const partnerCount = exams.filter(e => e.referralType === 'partner').length;
  const particularCount = exams.filter(e => e.referralType !== 'partner').length;
  const failed = exams.filter(e => e.status === 'failed').length;

  if (totalEl) totalEl.textContent = total;
  if (successEl) successEl.textContent = success;
  if (awaitingCpfEl) awaitingCpfEl.textContent = awaitingCpf;
  if (partnerEl) partnerEl.textContent = partnerCount;
  if (particularEl) particularEl.textContent = particularCount;
  if (failedEl) failedEl.textContent = failed;
  if (badgeTotal) badgeTotal.textContent = `${total} Exame(s) Registrado(s)`;
}

function renderExams(exams) {
  const tbody = document.getElementById('exams-table-body');
  if (!tbody) return;

  if (exams.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="text-center p-4 text-muted">Nenhum exame ou laudo encontrado para os filtros selecionados.</td></tr>`;
    return;
  }

  let html = '';
  exams.forEach(exam => {
    let targetBadge = '';
    if (exam.target === 'both') {
      targetBadge = `<span class="exam-badge-target exam-badge-both">👥 Ambos (Paciente + Clínica)</span>`;
    } else if (exam.target === 'partner') {
      targetBadge = `<span class="exam-badge-target exam-badge-partner">🏢 Somente Clínica Parceira</span>`;
    } else {
      targetBadge = `<span class="exam-badge-target exam-badge-patient">👤 Somente Paciente</span>`;
    }

    let statusPill = '';
    if (exam.status === 'awaiting_cpf') {
      if ((exam.failedCpfAttempts || 0) >= 3) {
        statusPill = `<span class="badge badge-rose" style="font-size: 11px;" title="Paciente errou 3 vezes o CPF. Atendimento transferido para equipe humana.">⛔ Bloqueado (3 erros CPF)</span>`;
      } else if ((exam.failedCpfAttempts || 0) > 0) {
        statusPill = `<span class="badge badge-amber" style="font-size: 11px;" title="Paciente errou ${exam.failedCpfAttempts} de 3 tentativas">🟡 Aguardando CPF (${exam.failedCpfAttempts}/3 erros)</span>`;
      } else {
        statusPill = `<span class="badge badge-amber" style="font-size: 11px;" title="Aguardando paciente digitar os 3 primeiros dígitos do CPF no WhatsApp para liberar o envio">🟡 Aguardando CPF</span>`;
      }
    } else if (exam.status === 'sent') {
      statusPill = `<span class="badge badge-emerald" style="font-size: 11px;">✅ Entregue ${exam.cpfVerified ? '<span title="CPF validado com sucesso">🔒</span>' : ''}</span>`;
    } else if (exam.status === 'partial') {
      statusPill = `<span class="badge badge-amber" style="font-size: 11px;">⚠️ Parcial</span>`;
    } else {
      statusPill = `<span class="badge badge-rose" style="font-size: 11px;">❌ Falha</span>`;
    }

    const dt = new Date(exam.sentAt);
    const dateStr = dt.toLocaleDateString('pt-BR');
    const timeStr = dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const isPdf = exam.fileMimeType?.includes('pdf') || exam.originalName?.toLowerCase().endsWith('.pdf');
    const fileIcon = isPdf ? '📄' : '🖼️';
    const fileSizeKb = Math.round(exam.fileSize / 1024);

    html += `
      <tr>
        <td>
          <strong>${dateStr}</strong><br>
          <span class="text-muted" style="font-family: monospace;">${timeStr}</span>
        </td>
        <td>
          <strong>${escapeHtml(exam.patientName)}</strong>
          ${exam.patientCpf ? `<br><small class="text-muted" title="3 primeiros dígitos para segurança LGPD">🔒 CPF: <strong>${maskCpf(exam.patientCpf)}</strong></small>` : ''}
          ${exam.caption ? `<br><small class="text-muted" title="${escapeHtml(exam.caption)}">💬 "${escapeHtml(exam.caption.substring(0, 45))}..."</small>` : ''}
        </td>
        <td>
          <a href="https://wa.me/${(exam.patientPhone || '').replace(/\D/g, '')}" target="_blank" class="text-emerald" style="text-decoration: none;">
            📱 ${formatPhoneDisplay(exam.patientPhone)}
          </a>
        </td>
        <td>
          ${exam.referralType === 'partner'
            ? `<span class="badge badge-sm badge-indigo" style="font-size: 11px;">🏢 ${escapeHtml(exam.partnerName || 'Convênio')}</span>`
            : `<span class="badge badge-sm badge-outline" style="font-size: 11px;">👤 Particular</span>`
          }
        </td>
        <td>${targetBadge}</td>
        <td>
          <div class="d-flex align-center gap-1">
            <span>${fileIcon}</span>
            <div>
              <strong style="font-size: 12px;">${escapeHtml(exam.originalName)}</strong><br>
              <small class="text-muted">${fileSizeKb} KB</small>
            </div>
          </div>
        </td>
        <td>${statusPill}</td>
        <td><small>${escapeHtml(exam.sentBy || 'Operador')}</small></td>
        <td style="text-align: right;">
          <div class="d-flex justify-end gap-1">
            <button class="btn btn-sm btn-outline" onclick="downloadExamFile('${exam.id}')" title="Baixar / Visualizar Arquivo">📥</button>
            <button class="btn btn-sm btn-outline" onclick="openResendExamModal('${exam.id}')" title="Reenviar pelo WhatsApp">🔁</button>
            <button class="btn btn-sm btn-danger-outline" onclick="deleteExamRecord('${exam.id}')" title="Excluir Registro e Arquivo">🗑️</button>
          </div>
        </td>
      </tr>
    `;
  });

  tbody.innerHTML = html;
}

function openExamDispatchModal(prefill = {}) {
  const overlay = document.getElementById('modal-exam-dispatch-overlay');
  if (!overlay) return;

  document.getElementById('modal-exam-dispatch-form').reset();
  document.getElementById('modal-exam-appointment-id').value = prefill.appointmentId || '';
  document.getElementById('modal-exam-file-base64').value = '';
  document.getElementById('modal-exam-file-name').value = '';
  document.getElementById('modal-exam-file-mimetype').value = '';

  const emptyState = document.getElementById('dropzone-empty-state');
  const fileSelectedState = document.getElementById('dropzone-file-selected');
  if (emptyState) emptyState.style.display = 'block';
  if (fileSelectedState) fileSelectedState.style.display = 'none';

  if (prefill.clientName) {
    document.getElementById('modal-exam-patient-name').value = prefill.clientName;
  }
  if (prefill.clientPhone) {
    document.getElementById('modal-exam-patient-phone').value = prefill.clientPhone.replace(/@.*$/, '').replace(/\D/g, '');
  }
  const cpfInput = document.getElementById('modal-exam-patient-cpf');
  if (cpfInput) {
    cpfInput.value = prefill.clientCpf ? formatCpf(prefill.clientCpf) : '';
  }

  const effectiveCompany = getEffectiveActiveCompanyId();
  const targetAgent = (effectiveCompany !== 'all') ? effectiveCompany : (prefill.agentId || '*');
  populatePartnersDropdowns();
  populateExamAgentsSelect(targetAgent);
  populateAppointmentsPickerForExams(prefill.appointmentId);

  const isPartner = prefill.referralType === 'partner';
  const partRadio = document.getElementById('exam-ref-particular');
  const partnerRadio = document.getElementById('exam-ref-partner');
  if (isPartner && partnerRadio) {
    partnerRadio.checked = true;
  } else if (partRadio) {
    partRadio.checked = true;
  }

  const partnerWrap = document.getElementById('modal-exam-partner-wrap');
  if (partnerWrap) {
    partnerWrap.style.display = isPartner ? 'block' : 'none';
  }

  if (isPartner && prefill.partnerId) {
    const partnerSelect = document.getElementById('modal-exam-partner-select');
    if (partnerSelect) partnerSelect.value = prefill.partnerId;
  }

  updateExamTargetOptions(isPartner);
  syncExamTargetCardClasses();
  overlay.style.display = 'flex';
}

function syncExamTargetCardClasses() {
  document.querySelectorAll('.exam-target-card').forEach(card => {
    const radio = card.querySelector('input[type="radio"]');
    if (radio && radio.checked) {
      card.classList.add('selected');
    } else {
      card.classList.remove('selected');
    }
  });
  updateExamCpfRequirement();
}

function updateExamCpfRequirement() {
  const target = document.querySelector('input[name="modal-exam-target"]:checked')?.value || 'patient';
  const cpfRequired = document.getElementById('modal-exam-cpf-required');
  const cpfHint = document.getElementById('modal-exam-cpf-hint');
  const cpfInput = document.getElementById('modal-exam-patient-cpf');

  if (target === 'partner') {
    if (cpfRequired) cpfRequired.textContent = ' (Opcional)';
    if (cpfHint) cpfHint.textContent = 'Dispensa validação (envio direto à parceira)';
    if (cpfInput) cpfInput.required = false;
  } else {
    if (cpfRequired) cpfRequired.textContent = ' *';
    if (cpfHint) cpfHint.textContent = '🔒 Desafio LGPD (3 dígitos)';
    if (cpfInput) cpfInput.required = true;
  }
}

function updateExamTargetOptions(isPartner) {
  const optPartner = document.getElementById('target-opt-partner');
  const optBoth = document.getElementById('target-opt-both');
  const radioPatient = document.querySelector('input[name="modal-exam-target"][value="patient"]');
  const radioPartner = document.querySelector('input[name="modal-exam-target"][value="partner"]');

  if (isPartner) {
    if (optPartner) optPartner.style.display = 'flex';
    if (optBoth) optBoth.style.display = 'flex';
    if (radioPartner) radioPartner.checked = true;
  } else {
    if (optPartner) optPartner.style.display = 'none';
    if (optBoth) optBoth.style.display = 'none';
    if (radioPatient) radioPatient.checked = true;
  }
  syncExamTargetCardClasses();
}

function openExamDispatchModalForAppointment(aptId) {
  const apt = (typeof currentAppointmentsList !== 'undefined' ? currentAppointmentsList : []).find(a => a.id === aptId);
  if (apt) {
    openExamDispatchModal({
      appointmentId: apt.id,
      clientName: apt.clientName,
      clientPhone: apt.clientPhone,
      clientCpf: apt.clientCpf || '',
      referralType: apt.referralType || (apt.partnerId ? 'partner' : 'particular'),
      partnerId: apt.partnerId || '',
      agentId: apt.agentId || '*'
    });
  } else {
    fetchWithAuth(`/api/appointments/${aptId}`)
      .then(res => res.json())
      .then(data => {
        if (data.appointment) {
          const a = data.appointment;
          openExamDispatchModal({
            appointmentId: a.id,
            clientName: a.clientName,
            clientPhone: a.clientPhone,
            clientCpf: a.clientCpf || '',
            referralType: a.referralType || (a.partnerId ? 'partner' : 'particular'),
            partnerId: a.partnerId || '',
            agentId: a.agentId || '*'
          });
        } else {
          openExamDispatchModal();
        }
      })
      .catch(() => openExamDispatchModal());
  }
}

function closeExamDispatchModal() {
  const overlay = document.getElementById('modal-exam-dispatch-overlay');
  if (overlay) overlay.style.display = 'none';
}

function populateExamAgentsSelect(targetAgentId) {
  const sel = document.getElementById('modal-exam-agent');
  const filterSel = document.getElementById('exam-filter-agent');
  if (!sel && !filterSel) return;

  const agentsList = (typeof allAgents !== 'undefined' && allAgents.length > 0)
    ? allAgents
    : (typeof allAgentsCache !== 'undefined' ? allAgentsCache : []);

  const effectiveCompany = getEffectiveActiveCompanyId();
  const isCompanyLocked = effectiveCompany !== 'all';

  if (sel) {
    if (isCompanyLocked) {
      const activeAgent = agentsList.find(a => a.id === effectiveCompany);
      const companyTitle = activeAgent ? (activeAgent.companyName || activeAgent.name) : 'Unidade Vinculada';
      sel.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(companyTitle)} (Unidade Vinculada)</option>`;
      sel.value = effectiveCompany;
      sel.disabled = true;
      sel.title = "O envio é realizado exclusivamente pela empresa ativa no painel";
    } else {
      let opts = '<option value="*">🌐 Agente Padrão (Global)</option>';
      agentsList.forEach(a => {
        opts += `<option value="${a.id}">🏢 ${escapeHtml(a.companyName || a.name)}</option>`;
      });
      sel.innerHTML = opts;
      sel.value = targetAgentId || '*';
      sel.disabled = false;
      sel.title = "Selecione a unidade emissora do laudo/exame";
    }
  }

  if (filterSel) {
    if (isCompanyLocked) {
      const activeAgent = agentsList.find(a => a.id === effectiveCompany);
      const companyTitle = activeAgent ? (activeAgent.companyName || activeAgent.name) : 'Unidade Vinculada';
      filterSel.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(companyTitle)}</option>`;
      filterSel.value = effectiveCompany;
      filterSel.disabled = true;
    } else {
      let filterOpts = '<option value="all">🌐 Todas as Unidades (Visão Geral)</option>';
      agentsList.forEach(a => {
        filterOpts += `<option value="${a.id}">🏢 ${escapeHtml(a.companyName || a.name)}</option>`;
      });
      filterSel.innerHTML = filterOpts;
      filterSel.value = 'all';
      filterSel.disabled = false;
    }
  }
}

function populateAppointmentsPickerForExams(selectedAptId) {
  const sel = document.getElementById('modal-exam-select-appointment');
  if (!sel) return;

  let opts = '<option value="">✍️ Digitação Manual de Paciente</option>';
  const rawList = typeof currentAppointmentsList !== 'undefined' ? currentAppointmentsList : [];
  const effectiveCompany = getEffectiveActiveCompanyId();
  const list = (effectiveCompany !== 'all')
    ? rawList.filter(a => a.agentId === effectiveCompany)
    : rawList;

  list.forEach(apt => {
    const label = `${apt.clientName} • ${formatDateBR(apt.date)} (${apt.startTime}) • ${apt.specialistName}`;
    opts += `<option value="${apt.id}" ${apt.id === selectedAptId ? 'selected' : ''}>${escapeHtml(label)}</option>`;
  });

  sel.innerHTML = opts;

  sel.onchange = () => {
    const aptId = sel.value;
    if (!aptId) return;
    const found = list.find(a => a.id === aptId);
    if (!found) return;

    document.getElementById('modal-exam-appointment-id').value = found.id;
    document.getElementById('modal-exam-patient-name').value = found.clientName;
    document.getElementById('modal-exam-patient-phone').value = found.clientPhone.replace(/@.*$/, '').replace(/\D/g, '');
    const cpfEl = document.getElementById('modal-exam-patient-cpf');
    if (cpfEl) cpfEl.value = found.clientCpf ? formatCpf(found.clientCpf) : '';

    const isPartner = found.referralType === 'partner';
    const partRadio = document.getElementById('exam-ref-particular');
    const partnerRadio = document.getElementById('exam-ref-partner');
    if (isPartner && partnerRadio) partnerRadio.checked = true;
    else if (partRadio) partRadio.checked = true;

    const partnerWrap = document.getElementById('modal-exam-partner-wrap');
    if (partnerWrap) partnerWrap.style.display = isPartner ? 'block' : 'none';

    if (isPartner && found.partnerId) {
      const pSel = document.getElementById('modal-exam-partner-select');
      if (pSel) pSel.value = found.partnerId;
    }

    updateExamTargetOptions(isPartner);
  };
}

function setupExamDropzone() {
  const dropzone = document.getElementById('exam-dropzone');
  const fileInput = document.getElementById('modal-exam-file-input');
  const emptyState = document.getElementById('dropzone-empty-state');
  const fileSelectedState = document.getElementById('dropzone-file-selected');
  const fileNameEl = document.getElementById('dropzone-file-name');
  const fileSizeEl = document.getElementById('dropzone-file-size');
  const fileIconEl = document.getElementById('dropzone-file-icon');
  const btnRemove = document.getElementById('btn-remove-selected-file');

  if (!dropzone || !fileInput) return;

  dropzone.addEventListener('click', (e) => {
    if (e.target !== btnRemove && !btnRemove?.contains(e.target)) {
      fileInput.click();
    }
  });

  ['dragenter', 'dragover'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.add('drag-over');
    });
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropzone.addEventListener(eventName, (e) => {
      e.preventDefault();
      e.stopPropagation();
      dropzone.classList.remove('drag-over');
    });
  });

  dropzone.addEventListener('drop', (e) => {
    const files = e.dataTransfer?.files;
    if (files && files.length > 0) {
      handleExamFile(files[0]);
    }
  });

  fileInput.addEventListener('change', (e) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleExamFile(files[0]);
    }
  });

  if (btnRemove) {
    btnRemove.addEventListener('click', (e) => {
      e.stopPropagation();
      fileInput.value = '';
      document.getElementById('modal-exam-file-base64').value = '';
      document.getElementById('modal-exam-file-name').value = '';
      document.getElementById('modal-exam-file-mimetype').value = '';
      if (emptyState) emptyState.style.display = 'block';
      if (fileSelectedState) fileSelectedState.style.display = 'none';
    });
  }

  function handleExamFile(file) {
    if (file.size > 30 * 1024 * 1024) {
      showToast('O arquivo excede o limite máximo de 30MB.', 'warning');
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const base64Data = reader.result;
      document.getElementById('modal-exam-file-base64').value = base64Data;
      document.getElementById('modal-exam-file-name').value = file.name;
      document.getElementById('modal-exam-file-mimetype').value = file.type || 'application/octet-stream';

      if (fileNameEl) fileNameEl.textContent = file.name;
      if (fileSizeEl) fileSizeEl.textContent = `${Math.round(file.size / 1024)} KB`;
      if (fileIconEl) {
        fileIconEl.textContent = file.type?.includes('pdf') || file.name.toLowerCase().endsWith('.pdf') ? '📄' : '🖼️';
      }

      if (emptyState) emptyState.style.display = 'none';
      if (fileSelectedState) fileSelectedState.style.display = 'flex';
    };
    reader.readAsDataURL(file);
  }
}

async function handleExamDispatchSubmit(e) {
  e.preventDefault();

  const patientName = document.getElementById('modal-exam-patient-name')?.value.trim();
  const patientPhone = document.getElementById('modal-exam-patient-phone')?.value.trim();
  const patientCpf = document.getElementById('modal-exam-patient-cpf')?.value.trim();
  const referralType = document.querySelector('input[name="modal-exam-referral-type"]:checked')?.value || 'particular';
  const partnerId = referralType === 'partner' ? document.getElementById('modal-exam-partner-select')?.value : undefined;
  const target = document.querySelector('input[name="modal-exam-target"]:checked')?.value || 'patient';
  const fileBase64 = document.getElementById('modal-exam-file-base64')?.value;
  const fileName = document.getElementById('modal-exam-file-name')?.value;
  const fileMimeType = document.getElementById('modal-exam-file-mimetype')?.value;
  const caption = document.getElementById('modal-exam-caption')?.value.trim();
  const effectiveCompany = getEffectiveActiveCompanyId();
  const agentId = (effectiveCompany !== 'all') ? effectiveCompany : (document.getElementById('modal-exam-agent')?.value || '*');
  const appointmentId = document.getElementById('modal-exam-appointment-id')?.value || undefined;

  if (!patientName) {
    showToast('Informe o nome do paciente.', 'warning');
    return;
  }
  if (!patientPhone) {
    showToast('Informe o WhatsApp do paciente.', 'warning');
    return;
  }
  if (target !== 'partner') {
    const cleanCpf = (patientCpf || '').replace(/\D/g, '');
    if (!cleanCpf || cleanCpf.length < 3) {
      showToast('Informe o CPF do paciente (pelo menos os 3 primeiros dígitos) para a validação de segurança LGPD.', 'warning');
      return;
    }
  }
  if (referralType === 'partner' && !partnerId) {
    showToast('Selecione a empresa/clínica conveniada.', 'warning');
    return;
  }
  if (!fileBase64) {
    showToast('Por favor, anexe o arquivo do laudo/exame.', 'warning');
    return;
  }

  const submitBtn = document.getElementById('btn-submit-exam');
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Enviando pelo WhatsApp...';
  }

  try {
    showToast('Disparando exame pelo WhatsApp...', 'info');
    const res = await fetchWithAuth('/api/exams/dispatch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        appointmentId,
        agentId,
        patientName,
        patientPhone,
        patientCpf,
        referralType,
        partnerId,
        target,
        fileBase64,
        fileName,
        fileMimeType,
        caption
      })
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error(data.error || 'Falha ao enviar exame.');
    }

    const exam = data.exam;
    if (exam.status === 'awaiting_cpf') {
      showToast('Desafio de segurança LGPD enviado ao WhatsApp do paciente! Aguardando os 3 dígitos do CPF. 🟡', 'info');
    } else if (exam.status === 'sent') {
      showToast('Exame e laudo enviados com sucesso pelo WhatsApp! ✅', 'success');
    } else if (exam.status === 'partial') {
      showToast('Exame enviado parcialmente. Verifique as tentativas.', 'warning');
    } else {
      showToast('Houve falha ao entregar o exame no WhatsApp. O arquivo foi salvo para reenvio.', 'error');
    }

    closeExamDispatchModal();
    await loadExams();
  } catch (err) {
    showToast(`Erro ao enviar: ${err.message}`, 'error');
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = '🚀 Enviar Exame pelo WhatsApp';
    }
  }
}

function openResendExamModal(examId) {
  const exam = currentExamsList.find(e => e.id === examId);
  if (!exam) return;

  const overlay = document.getElementById('modal-exam-resend-overlay');
  if (!overlay) return;

  document.getElementById('resend-exam-id').value = exam.id;
  document.getElementById('resend-patient-name').textContent = exam.patientName;
  document.getElementById('resend-patient-phone').textContent = formatPhoneDisplay(exam.patientPhone);
  document.getElementById('resend-file-name').textContent = exam.originalName;

  const cpfInfoEl = document.getElementById('resend-patient-cpf');
  const cpfBadgeEl = document.getElementById('resend-cpf-badge');
  if (cpfInfoEl) cpfInfoEl.textContent = exam.patientCpf ? maskCpf(exam.patientCpf) : 'Não informado';
  if (cpfBadgeEl) {
    if (exam.cpfVerified) {
      cpfBadgeEl.className = 'badge badge-sm badge-emerald';
      cpfBadgeEl.textContent = '✅ CPF Confirmado (Liberado)';
    } else if ((exam.failedCpfAttempts || 0) >= 3) {
      cpfBadgeEl.className = 'badge badge-sm badge-rose';
      cpfBadgeEl.textContent = '⛔ Bloqueado (3 erros - Reenviar reativa)';
    } else if ((exam.failedCpfAttempts || 0) > 0) {
      cpfBadgeEl.className = 'badge badge-sm badge-amber';
      cpfBadgeEl.textContent = `🟡 Aguardando Confirmação (${exam.failedCpfAttempts}/3 erros)`;
    } else {
      cpfBadgeEl.className = 'badge badge-sm badge-amber';
      cpfBadgeEl.textContent = '🟡 Aguardando Confirmação (3 dígitos)';
    }
  }

  const partnerInfo = document.getElementById('resend-partner-info');
  const optPartner = document.getElementById('resend-opt-partner');
  const optBoth = document.getElementById('resend-opt-both');

  if (exam.referralType === 'partner') {
    if (partnerInfo) {
      partnerInfo.style.display = 'block';
      document.getElementById('resend-partner-name').textContent = exam.partnerName || 'Convênio';
    }
    if (optPartner) optPartner.style.display = 'block';
    if (optBoth) optBoth.style.display = 'block';
    document.getElementById('resend-target-select').value = exam.target || 'partner';
  } else {
    if (partnerInfo) partnerInfo.style.display = 'none';
    if (optPartner) optPartner.style.display = 'none';
    if (optBoth) optBoth.style.display = 'none';
    document.getElementById('resend-target-select').value = 'patient';
  }

  document.getElementById('resend-caption').value = '';
  overlay.style.display = 'flex';
}

function closeResendExamModal() {
  const overlay = document.getElementById('modal-exam-resend-overlay');
  if (overlay) overlay.style.display = 'none';
}

async function handleResendExamSubmit(e) {
  e.preventDefault();
  const examId = document.getElementById('resend-exam-id')?.value;
  const target = document.getElementById('resend-target-select')?.value;
  const caption = document.getElementById('resend-caption')?.value.trim();

  if (!examId) return;

  const btn = document.getElementById('btn-confirm-resend');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Reenviando...';
  }

  try {
    showToast('Reenviando exame pelo WhatsApp...', 'info');
    const res = await fetchWithAuth(`/api/exams/${examId}/resend`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ target, caption: caption || undefined })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Falha ao reenviar exame.');

    showToast('Exame reenviado com sucesso pelo WhatsApp!', 'success');
    closeResendExamModal();
    await loadExams();
  } catch (err) {
    showToast(`Erro ao reenviar: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '🚀 Reenviar Agora';
    }
  }
}

function downloadExamFile(examId) {
  window.open(`/api/exams/${examId}/download`, '_blank');
}

async function deleteExamRecord(examId) {
  const exam = currentExamsList.find(e => e.id === examId);
  const name = exam ? exam.patientName : 'este exame';
  if (!confirm(`Deseja realmente remover o registro e arquivo do exame do paciente "${name}"?`)) return;

  try {
    const res = await fetchWithAuth(`/api/exams/${examId}`, { method: 'DELETE' });
    if (!res.ok) throw new Error('Falha ao excluir exame.');
    showToast('Exame removido com sucesso!', 'success');
    await loadExams();
  } catch (err) {
    showToast(`Erro ao excluir: ${err.message}`, 'error');
  }
}

// ============================================================================
// RELATÓRIO OFICIAL IMPRESSO A4 / PDF DE EXAMES POR PARCEIRO & CONVÊNIO
// ============================================================================

function openPrintExamsModal() {
  const overlay = document.getElementById('modal-print-exams-overlay');
  if (!overlay) return;

  populatePartnersDropdowns();

  const agentSelect = document.getElementById('print-exams-filter-agent');
  if (agentSelect) {
    const effectiveCompany = getEffectiveActiveCompanyId();
    const agentsList = (typeof allAgents !== 'undefined' && allAgents.length > 0)
      ? allAgents
      : (typeof allAgentsCache !== 'undefined' ? allAgentsCache : []);

    if (effectiveCompany !== 'all') {
      const activeAgent = agentsList.find(a => a.id === effectiveCompany);
      const companyTitle = activeAgent ? (activeAgent.companyName || activeAgent.name) : 'Minha Unidade';
      agentSelect.innerHTML = `<option value="${effectiveCompany}">🏢 ${escapeHtml(companyTitle)}</option>`;
      agentSelect.value = effectiveCompany;
      agentSelect.disabled = true;
    } else {
      agentSelect.disabled = false;
      let opts = '<option value="all" selected>🌐 Todas as Unidades (Visão Geral)</option>';
      agentsList.forEach(a => {
        opts += `<option value="${a.id}">🏢 ${escapeHtml(a.companyName || a.name)}</option>`;
      });
      agentSelect.innerHTML = opts;
    }
  }

  const startInput = document.getElementById('print-exams-start-date');
  const endInput = document.getElementById('print-exams-end-date');
  const today = getTodayString();
  if (startInput) startInput.value = today;
  if (endInput) endInput.value = today;

  overlay.style.display = 'flex';
  updatePrintExamsPreviewCount();
}

function closePrintExamsModal() {
  const overlay = document.getElementById('modal-print-exams-overlay');
  if (overlay) overlay.style.display = 'none';
}

function getFilteredExamsForReport() {
  const dateType = document.getElementById('print-exams-date-type')?.value || 'today';
  const partnerId = document.getElementById('print-exams-filter-partner')?.value || 'all';
  const referralType = document.getElementById('print-exams-filter-referral')?.value || 'all';
  const status = document.getElementById('print-exams-filter-status')?.value || 'all';
  const effectiveCompany = getEffectiveActiveCompanyId();
  const agentId = (effectiveCompany !== 'all') ? effectiveCompany : (document.getElementById('print-exams-filter-agent')?.value || 'all');

  const todayStr = getTodayString();
  let startDate = '';
  let endDate = '';

  if (dateType === 'today') {
    startDate = todayStr;
    endDate = todayStr;
  } else if (dateType === 'this_week') {
    const d = new Date();
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d.setDate(diff));
    startDate = monday.toISOString().split('T')[0];
    endDate = todayStr;
  } else if (dateType === 'this_month') {
    const d = new Date();
    startDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
    endDate = todayStr;
  } else if (dateType === 'custom') {
    startDate = document.getElementById('print-exams-start-date')?.value || '';
    endDate = document.getElementById('print-exams-end-date')?.value || '';
  }

  let list = [...currentExamsList];

  if (startDate) {
    list = list.filter(e => e.sentAt.split('T')[0] >= startDate);
  }
  if (endDate) {
    list = list.filter(e => e.sentAt.split('T')[0] <= endDate);
  }
  if (partnerId !== 'all') {
    list = list.filter(e => e.partnerId === partnerId);
  }
  if (referralType !== 'all') {
    list = list.filter(e => e.referralType === referralType);
  }
  if (status !== 'all') {
    list = list.filter(e => e.status === status);
  }
  if (agentId !== 'all') {
    list = list.filter(e => e.agentId === agentId);
  }

  return list;
}

function updatePrintExamsPreviewCount() {
  const countEl = document.getElementById('print-exams-preview-count');
  if (!countEl) return;
  const list = getFilteredExamsForReport();
  countEl.textContent = `${list.length} exame(s) selecionado(s) para o relatório`;
}

function generateAndPrintExamsReport() {
  const executeBtn = document.getElementById('btn-execute-print-exams');
  if (executeBtn) {
    executeBtn.disabled = true;
    executeBtn.textContent = '⏳ Gerando Relatório...';
  }

  try {
    const list = getFilteredExamsForReport();
    if (list.length === 0) {
      showToast('Nenhum exame localizado com os filtros selecionados.', 'warning');
      return;
    }

    const dateType = document.getElementById('print-exams-date-type')?.value || 'today';
    const partnerSelect = document.getElementById('print-exams-filter-partner');
    const partnerLabel = partnerSelect && partnerSelect.value !== 'all' ? partnerSelect.options[partnerSelect.selectedIndex].text : 'Todos os Convênios e Parceiros';

    const referralSelect = document.getElementById('print-exams-filter-referral');
    const referralLabel = referralSelect ? referralSelect.options[referralSelect.selectedIndex].text : 'Todos';

    const agentSelect = document.getElementById('print-exams-filter-agent');
    const unitLabel = agentSelect && agentSelect.value !== 'all' ? agentSelect.options[agentSelect.selectedIndex].text : 'Todas as Unidades';

    let periodLabel = 'Hoje';
    if (dateType === 'today') periodLabel = `Hoje (${formatDateBR(getTodayString())})`;
    else if (dateType === 'this_week') periodLabel = 'Semana Vigente';
    else if (dateType === 'this_month') periodLabel = 'Mês Atual';
    else if (dateType === 'custom') {
      const s = document.getElementById('print-exams-start-date')?.value;
      const e = document.getElementById('print-exams-end-date')?.value;
      periodLabel = `${formatDateBR(s)} até ${formatDateBR(e)}`;
    } else {
      periodLabel = 'Histórico Geral';
    }

    const now = new Date();
    const emitDate = `${now.toLocaleDateString('pt-BR')} às ${now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
    const emittedBy = currentUser ? (currentUser.name || currentUser.username) : 'Administração';

    const totalExams = list.length;
    const partnerExams = list.filter(e => e.referralType === 'partner').length;
    const particularExams = list.filter(e => e.referralType !== 'partner').length;
    const deliveredSuccess = list.filter(e => e.status === 'sent').length;
    const failedDeliveries = list.filter(e => e.status === 'failed').length;

    let rowsHtml = '';
    list.forEach((exam, idx) => {
      const dt = new Date(exam.sentAt);
      const dtStr = `${dt.toLocaleDateString('pt-BR')} ${dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;

      let targetText = 'Paciente';
      if (exam.target === 'both') targetText = 'Ambos (Paciente + Clínica)';
      else if (exam.target === 'partner') targetText = 'Clínica Parceira';

      let statusText = 'Falha';
      let badgeClass = 'badge-danger';
      if (exam.status === 'awaiting_cpf') {
        statusText = 'Aguardando CPF';
        badgeClass = 'badge-warning';
      } else if (exam.status === 'sent') {
        statusText = exam.cpfVerified ? 'Entregue (CPF OK)' : 'Entregue';
        badgeClass = 'badge-success';
      } else if (exam.status === 'partial') {
        statusText = 'Parcial';
        badgeClass = 'badge-warning';
      }
      const protocol = exam.attempts && exam.attempts[0]?.messageId ? exam.attempts[0].messageId.substring(0, 18) + '...' : 'WPP-' + exam.id;

      rowsHtml += `
        <tr>
          <td style="text-align: center; font-weight: bold; width: 30px;">${idx + 1}</td>
          <td>${dtStr}</td>
          <td>
            <strong>${escapeHtml(exam.patientName)}</strong><br>
            <span style="font-size: 11px; color: #4b5563;">📱 ${formatPhoneDisplay(exam.patientPhone)}</span>
            ${exam.patientCpf ? `<br><span style="font-size: 10px; color: #6b7280;">🔒 CPF: ${maskCpf(exam.patientCpf)}</span>` : ''}
          </td>
          <td>
            <strong>${escapeHtml(partnerText)}</strong>
          </td>
          <td>${targetText}</td>
          <td>
            <span style="font-weight: 500;">${escapeHtml(exam.originalName)}</span>
          </td>
          <td style="font-size: 10px; font-family: monospace; color: #4b5563;">${protocol}</td>
          <td>
            <span class="status-badge ${badgeClass}">
              ${statusText}
            </span>
          </td>
        </tr>
      `;
    });

    const printHtml = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <title>Relatório Oficial de Exames Realizados e Enviados</title>
  <style>
    @page {
      size: A4 portrait;
      margin: 12mm 15mm;
    }
    * {
      box-sizing: border-box;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
    }
    body {
      background: white;
      color: #111827;
      margin: 0;
      padding: 0;
      font-size: 11.5px;
      line-height: 1.4;
    }
    .report-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #2563eb;
      padding-bottom: 12px;
      margin-bottom: 12px;
    }
    .clinic-info h1 {
      font-size: 18px;
      font-weight: 800;
      color: #1e3a8a;
      margin: 0 0 4px 0;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .clinic-info p {
      margin: 0;
      font-size: 12px;
      color: #4b5563;
    }
    .meta-info {
      text-align: right;
      font-size: 11px;
      color: #374151;
    }
    .meta-info div {
      margin-bottom: 2px;
    }
    .filters-box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 12px;
      margin-bottom: 14px;
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      font-size: 11px;
    }
    .filter-item strong {
      color: #1e293b;
      display: block;
      font-size: 10px;
      text-transform: uppercase;
    }
    .kpi-summary-strip {
      display: flex;
      gap: 10px;
      margin-bottom: 14px;
    }
    .kpi-box {
      flex: 1;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      padding: 8px 10px;
      background: #ffffff;
      text-align: center;
    }
    .kpi-box .val {
      font-size: 16px;
      font-weight: 800;
      color: #1e3a8a;
    }
    .kpi-box .lbl {
      font-size: 9.5px;
      color: #64748b;
      text-transform: uppercase;
      font-weight: 600;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 16px;
    }
    th {
      background: #f1f5f9;
      color: #334155;
      font-weight: 700;
      font-size: 10.5px;
      text-transform: uppercase;
      text-align: left;
      padding: 7px 8px;
      border-bottom: 2px solid #cbd5e1;
    }
    td {
      padding: 6px 8px;
      border-bottom: 1px solid #e2e8f0;
      vertical-align: middle;
      font-size: 11px;
    }
    tr:nth-child(even) td {
      background: #fcfcfd;
    }
    .status-badge {
      display: inline-block;
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 9.5px;
      font-weight: 700;
    }
    .badge-success {
      background: #dcfce7;
      color: #15803d;
      border: 1px solid #bbf7d0;
    }
    .badge-danger {
      background: #fee2e2;
      color: #b91c1c;
      border: 1px solid #fecaca;
    }
    .badge-warning {
      background: #fef3c7;
      color: #b45309;
      border: 1px solid #fde68a;
    }
    .report-footer {
      margin-top: 30px;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding-top: 10px;
      border-top: 1px solid #e5e7eb;
      font-size: 10.5px;
      color: #6b7280;
    }
    .signature-area {
      text-align: center;
      width: 250px;
    }
    .signature-line {
      border-bottom: 1px solid #111827;
      margin-bottom: 4px;
      height: 30px;
    }
    .signature-title {
      font-size: 10px;
      color: #4b5563;
      font-weight: 600;
    }
    .no-print-bar {
      background: #1e293b;
      color: white;
      padding: 10px 16px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 13px;
    }
    .btn-print {
      background: #2563eb;
      color: white;
      border: none;
      padding: 6px 16px;
      border-radius: 4px;
      font-weight: 600;
      cursor: pointer;
      font-size: 13px;
    }
    @media print {
      .no-print-bar {
        display: none !important;
      }
      body {
        padding: 0;
      }
    }
  </style>
</head>
<body>
  <div class="no-print-bar">
    <span>🖨️ Relatório Oficial de Exames & Laudos • Pressione <strong>Imprimir</strong> ou <code>Ctrl+P</code></span>
    <button class="btn-print" onclick="window.print()">Imprimir / Salvar PDF</button>
  </div>

  <div style="padding: 14px 16px;">
    <div class="report-header">
      <div class="clinic-info">
        <h1>Relatório de Exames Enviados • Convênios & Particulares</h1>
        <p>Unidade: <strong>${unitLabel}</strong></p>
      </div>
      <div class="meta-info">
        <div>Emissão: <strong>${emitDate}</strong></div>
        <div>Operador: <strong>${emittedBy}</strong></div>
        <div>Total de Exames: <strong>${totalExams}</strong></div>
      </div>
    </div>

    <div class="filters-box">
      <div class="filter-item">
        <strong>Período</strong>
        <span>${periodLabel}</span>
      </div>
      <div class="filter-item">
        <strong>Clínica / Convênio</strong>
        <span>${partnerLabel}</span>
      </div>
      <div class="filter-item">
        <strong>Tipo de Atendimento</strong>
        <span>${referralLabel}</span>
      </div>
    </div>

    <div class="kpi-summary-strip">
      <div class="kpi-box">
        <div class="val">${totalExams}</div>
        <div class="lbl">Total de Laudos</div>
      </div>
      <div class="kpi-box">
        <div class="val" style="color: #4f46e5;">${partnerExams}</div>
        <div class="lbl">Convênios / Parceiros</div>
      </div>
      <div class="kpi-box">
        <div class="val" style="color: #0891b2;">${particularExams}</div>
        <div class="lbl">Particulares</div>
      </div>
      <div class="kpi-box">
        <div class="val" style="color: #16a34a;">${deliveredSuccess}</div>
        <div class="lbl">Entregues com Sucesso</div>
      </div>
      <div class="kpi-box">
        <div class="val" style="color: #dc2626;">${failedDeliveries}</div>
        <div class="lbl">Falhas de Envio</div>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th style="text-align: center;">#</th>
          <th>Data / Hora</th>
          <th>Paciente / WhatsApp</th>
          <th>Origem / Convênio</th>
          <th>Destinatário</th>
          <th>Arquivo / Laudo</th>
          <th>Protocolo WPP</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>

    <div class="report-footer">
      <div>
        <div>Documento oficial expedido via Sistema BotZap Clínica & Diagnósticos.</div>
        <div>Comprovante auditável com protocolo de entrega no WhatsApp (WAHA).</div>
      </div>
      <div class="signature-area">
        <div class="signature-line"></div>
        <div class="signature-title">Responsável Técnico / Recepção de Convênios</div>
      </div>
    </div>
  </div>

  <script>
    window.addEventListener('DOMContentLoaded', () => {
      setTimeout(() => {
        window.print();
      }, 400);
    });
  <\/script>
</body>
</html>`;

    const printWin = window.open('', '_blank', 'width=980,height=780');
    if (!printWin) {
      showToast('O navegador bloqueou o pop-up de impressão. Permita pop-ups para este site.', 'warning');
      return;
    }

    printWin.document.open();
    printWin.document.write(printHtml);
    printWin.document.close();

    closePrintExamsModal();
    showToast('Relatório oficial de exames gerado para impressão!', 'success');
  } catch (err) {
    showToast(`Erro ao gerar relatório de exames: ${err.message}`, 'error');
  } finally {
    if (executeBtn) {
      executeBtn.disabled = false;
      executeBtn.textContent = '🖨️ Visualizar & Imprimir Relatório (PDF)';
    }
  }
}

// ============================================================================
// EVENT LISTENERS DE PARCEIROS & EXAMES
// ============================================================================

// Parceiros
document.getElementById('btn-manage-partners')?.addEventListener('click', openPartnersModal);
document.getElementById('btn-close-partners-modal')?.addEventListener('click', closePartnersModal);
document.getElementById('btn-close-partners-footer')?.addEventListener('click', closePartnersModal);
document.getElementById('modal-partners-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-partners-overlay') closePartnersModal();
});
document.getElementById('btn-add-new-partner')?.addEventListener('click', () => showPartnerForm());
document.getElementById('btn-cancel-partner-form')?.addEventListener('click', hidePartnerForm);
document.getElementById('partner-edit-form')?.addEventListener('submit', handlePartnerFormSubmit);
document.getElementById('partner-search-input')?.addEventListener('input', (e) => {
  const q = e.target.value.toLowerCase().trim();
  if (!q) {
    renderPartners(currentPartnersList);
  } else {
    renderPartners(currentPartnersList.filter(p =>
      p.name.toLowerCase().includes(q) ||
      (p.phone && p.phone.includes(q)) ||
      (p.document && p.document.includes(q)) ||
      (p.contactPerson && p.contactPerson.toLowerCase().includes(q))
    ));
  }
});

// Envio de Exames
document.getElementById('btn-new-exam')?.addEventListener('click', () => openExamDispatchModal());
document.getElementById('btn-close-exam-modal')?.addEventListener('click', closeExamDispatchModal);
document.getElementById('btn-cancel-exam')?.addEventListener('click', closeExamDispatchModal);
document.getElementById('modal-exam-dispatch-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-exam-dispatch-overlay') closeExamDispatchModal();
});
document.getElementById('modal-exam-dispatch-form')?.addEventListener('submit', handleExamDispatchSubmit);

// Máscara automática de formatação para o CPF do paciente (LGPD)
document.getElementById('modal-exam-patient-cpf')?.addEventListener('input', (e) => {
  e.target.value = formatCpf(e.target.value);
});

document.querySelectorAll('input[name="modal-exam-referral-type"]').forEach(r => {
  r.addEventListener('change', (e) => {
    const isPartner = e.target.value === 'partner';
    const wrap = document.getElementById('modal-exam-partner-wrap');
    if (wrap) wrap.style.display = isPartner ? 'block' : 'none';
    updateExamTargetOptions(isPartner);
  });
});

// Listener para alternar visual dos cards de destinatário no modal de exames e atualizar exigência de CPF
document.querySelectorAll('input[name="modal-exam-target"]').forEach(r => {
  r.addEventListener('change', syncExamTargetCardClasses);
});

// Reenvio de Exame
document.getElementById('btn-close-resend-modal')?.addEventListener('click', closeResendExamModal);
document.getElementById('btn-cancel-resend')?.addEventListener('click', closeResendExamModal);
document.getElementById('modal-exam-resend-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-exam-resend-overlay') closeResendExamModal();
});
document.getElementById('modal-exam-resend-form')?.addEventListener('submit', handleResendExamSubmit);

// Filtros de Exames
document.getElementById('exam-search-input')?.addEventListener('input', loadExams);
document.getElementById('exam-filter-referral')?.addEventListener('change', loadExams);
document.getElementById('exam-filter-partner')?.addEventListener('change', loadExams);
document.getElementById('exam-filter-status')?.addEventListener('change', loadExams);
document.getElementById('exam-filter-agent')?.addEventListener('change', (e) => {
  setActiveCompany(e.target.value, false);
  loadExams();
});
document.getElementById('btn-refresh-exams')?.addEventListener('click', loadExams);

// Sincroniza alteração no select de agendamentos com o estado global da empresa
document.getElementById('apt-filter-agent')?.addEventListener('change', (e) => {
  setActiveCompany(e.target.value, false);
});

// Impressão de Relatório de Exames
document.getElementById('btn-open-print-exams')?.addEventListener('click', openPrintExamsModal);
document.getElementById('btn-close-print-exams-modal')?.addEventListener('click', closePrintExamsModal);
document.getElementById('btn-cancel-print-exams')?.addEventListener('click', closePrintExamsModal);
document.getElementById('modal-print-exams-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-print-exams-overlay') closePrintExamsModal();
});

document.getElementById('print-exams-date-type')?.addEventListener('change', (e) => {
  const wrap = document.getElementById('print-exams-custom-date-wrap');
  if (wrap) wrap.style.display = e.target.value === 'custom' ? 'block' : 'none';
  updatePrintExamsPreviewCount();
});

document.getElementById('print-exams-start-date')?.addEventListener('change', updatePrintExamsPreviewCount);
document.getElementById('print-exams-end-date')?.addEventListener('change', updatePrintExamsPreviewCount);
document.getElementById('print-exams-filter-partner')?.addEventListener('change', updatePrintExamsPreviewCount);
document.getElementById('print-exams-filter-referral')?.addEventListener('change', updatePrintExamsPreviewCount);
document.getElementById('print-exams-filter-status')?.addEventListener('change', updatePrintExamsPreviewCount);
document.getElementById('print-exams-filter-agent')?.addEventListener('change', updatePrintExamsPreviewCount);
document.getElementById('btn-execute-print-exams')?.addEventListener('click', generateAndPrintExamsReport);

// ============================================================================
// Event Listeners: Seletor e Alternador de Empresa Ativa (Topbar & Modal)
// ============================================================================
document.getElementById('btn-switch-company')?.addEventListener('click', () => {
  // Se for atendente vinculado a uma empresa fixa, impede alternar
  if (currentUser?.role === 'attendant' && currentUser.assignedAgentId && currentUser.assignedAgentId !== '*') {
    showToast('Seu usuário de atendimento está vinculado exclusivamente a esta unidade.', 'warning');
    return;
  }
  openCompanyPickerModal(false);
});

document.getElementById('btn-close-company-picker')?.addEventListener('click', closeCompanyPickerModal);

document.getElementById('btn-skip-company-picker')?.addEventListener('click', () => {
  setActiveCompany('all', true);
  closeCompanyPickerModal();
  showToast('Visão consolidada para todas as empresas ativada. 🌐', 'info');
});

document.getElementById('modal-company-picker-overlay')?.addEventListener('click', (e) => {
  if (e.target.id === 'modal-company-picker-overlay' && !isCompanyPickerMandatory) {
    closeCompanyPickerModal();
  }
});

document.getElementById('company-picker-search')?.addEventListener('input', (e) => {
  renderCompanyPickerCards(e.target.value);
});

// Inicializa Drag & Drop de exames no carregamento
setupExamDropzone();

// ============================================================================
// Inicialização Automática da Aplicação e Restauração de Sessão
// ============================================================================
async function initApp() {
  const token = getAuthToken();
  if (token) {
    try {
      const res = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          hideLoginModal(data.user);
          checkStatus();
          if (data.user.role === 'admin') {
            loadConfig();
            loadSchedule();
            loadHolidays();
            loadWahaConfig();
            await loadAgents();
          }
          loadAgentsForSimulator();
          loadAppointments();
          return;
        }
      }
    } catch (e) {
      console.warn('Falha ao restaurar sessão existente:', e);
    }
  }
  // Se não houver token ou for inválido, exibe tela de login
  showLoginModal();
}

// Executa inicialização
initApp();



