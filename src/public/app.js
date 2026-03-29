// Global event helper — all components use this for cross-component communication
function emit(name, detail) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function app() {
  return {
    managed: [],
    managedFolders: [],
    currentId: null,
    inputText: '',
    cwd: localStorage.getItem('agent-link:cwd') || '',
    model: localStorage.getItem('agent-link:model') || '',
    activeSet: new Set(),
    eventSource: null,
    seenUuids: new Set(),
    totalCost: 0,
    totalIn: 0,
    totalOut: 0,
    sidebarWidth: (() => {
      const v = Number(localStorage.getItem('agent-link:sidebar-width'));
      return Math.min(480, Math.max(180, Number.isFinite(v) ? v : 256));
    })(),
    sidebarCollapsed: (() => {
      const v = localStorage.getItem('agent-link:sidebar-collapsed');
      return v !== null ? v === 'true' : !window.matchMedia('(min-width: 768px)').matches;
    })(),
    theme: localStorage.getItem('agent-link:theme') === 'light' ? 'light' : 'dark',

    // Panel mode
    panelMode: false,
    nodes: [],
    selectedNodeId: localStorage.getItem('agent-link:nodeId') || '',

    // Auth state
    authRequired: false,
    authenticated: true,
    loginToken: '',
    loginError: '',

    init() {
      Alpine.store('active', false);
      if (!this.cwd) this.cwd = window.location.hostname === 'localhost' ? '.' : '/';
      this.applyTheme();
      this.checkAuth().then(() => {
        if (!this.authenticated) return;
        this.detectPanelMode().then(() => { this.loadManaged(); this.loadFolders(); });
        this.refreshActive();
        setInterval(() => { this.refreshActive(); if (this.panelMode) this.refreshNodes(); }, 5000);
      });
      this.$watch('cwd', (v) => localStorage.setItem('agent-link:cwd', v));
      this.$watch('model', (v) => localStorage.setItem('agent-link:model', v));
      this.$watch('sidebarCollapsed', (v) => localStorage.setItem('agent-link:sidebar-collapsed', String(v)));
      this.$watch('sidebarWidth', (v) => localStorage.setItem('agent-link:sidebar-width', String(this.clampWidth(v))));
      this.$watch('selectedNodeId', (v) => localStorage.setItem('agent-link:nodeId', v));
      this.$watch('theme', (v) => { localStorage.setItem('agent-link:theme', v); this.applyTheme(); });
    },

    applyTheme() {
      if (this.theme === 'light') document.body.classList.add('light-theme');
      else document.body.classList.remove('light-theme');
    },
    toggleTheme() { this.theme = this.theme === 'light' ? 'dark' : 'light'; },
    toggleSidebar() { this.sidebarCollapsed = !this.sidebarCollapsed; },
    clampWidth(w) { return Math.min(480, Math.max(180, Number.isFinite(w) ? w : 256)); },

    async checkAuth() {
      try {
        const res = await fetch('/api/auth/check');
        const data = await res.json();
        this.authRequired = data.required;
        this.authenticated = data.authenticated;
      } catch {
        this.authenticated = true;
        this.authRequired = false;
      }
    },

    async login() {
      this.loginError = '';
      try {
        const res = await fetch('/api/login', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: this.loginToken }),
        });
        const data = await res.json();
        if (data.error) { this.loginError = data.error; return; }
        this.authenticated = true;
        this.loginToken = '';
        this.detectPanelMode().then(() => { this.loadManaged(); this.loadFolders(); });
        this.refreshActive();
        setInterval(() => { this.refreshActive(); if (this.panelMode) this.refreshNodes(); }, 5000);
      } catch (err) {
        this.loginError = err.message;
      }
    },

    async detectPanelMode() {
      try {
        const res = await fetch('/api/nodes');
        if (res.ok) {
          this.panelMode = true;
          this.nodes = await res.json();
          if (!this.selectedNodeId && this.nodes.length > 0)
            this.selectedNodeId = (this.nodes.find(n => n.online && n.approved) || this.nodes.find(n => n.online) || this.nodes[0]).nodeId;
        }
      } catch { this.panelMode = false; }
    },

    async loadManaged() {
      try {
        const res = await fetch('/api/managed');
        if (res.ok) {
          this.managed = ((await res.json()) || []).map(item => ({
            sessionId: item.id, name: item.name || item.id?.slice(0, 12) || '',
            cwd: item.cwd, nodeId: item.nodeId, createdAt: item.createdAt,
            params: item.params || {},
          }));
          return;
        }
      } catch {}
      this.managed = [];
    },

    async loadFolders() {
      try {
        const res = await fetch('/api/managed-folders');
        if (res.ok) this.managedFolders = (await res.json()) || [];
      } catch { this.managedFolders = []; }
    },

    async refreshNodes() {
      try { const res = await fetch('/api/nodes'); if (res.ok) this.nodes = await res.json(); } catch {}
    },
    async refreshActive() {
      try { this.activeSet = new Set(await (await fetch('/api/active')).json()); this.syncActive(); } catch {}
    },

    syncActive() {
      Alpine.store('active', !!(this.currentId && this.activeSet.has(this.currentId)));
    },
    msg(type, detail) {
      window.dispatchEvent(new CustomEvent('msg:' + type, { detail }));
    },

    async saveManagedItem(item) {
      try {
        await fetch('/api/managed', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: item.sessionId, name: item.name, cwd: item.cwd || '',
            nodeId: item.nodeId, createdAt: item.createdAt || Date.now(),
            params: item.params || {},
          }),
        });
      } catch {}
    },

    // --- Event handlers ---

    newSession() {
      this.currentId = null;
      this.msg('clear');
      this.seenUuids = new Set();
      this.totalCost = 0; this.totalIn = 0; this.totalOut = 0;
      if (this.eventSource) { this.eventSource.close(); this.eventSource = null; }
      this.$nextTick(() => this.$el.querySelector('input[x-model="inputText"]')?.focus());
    },

    // Called from the add-agent dialog with full agent info
    async createAgent(detail) {
      const { name, cwd, nodeId, params, initialPrompt, loadSessionId } = detail;
      if (!name) return;

      // Ensure folder is tracked
      if (cwd) this.addFolder({ cwd, nodeId });

      if (loadSessionId) {
        // Load existing session as agent
        const entry = { sessionId: loadSessionId, name, cwd, nodeId, params: params || {} };
        this.addManaged(entry);
        this.switchSession(loadSessionId);
        return;
      }

      // Create new session with initial prompt
      const prompt = initialPrompt?.trim() || 'hello';
      this.cwd = cwd || this.cwd;
      if (nodeId) this.selectedNodeId = nodeId;

      this.newSession();
      this.msg('append', { type: 'user', message: { content: [{ type: 'text', text: prompt }] } });

      const claudeParams = params?.claude || undefined;
      try {
        const body = {
          prompt, cwd: cwd || this.cwd,
          model: claudeParams?.model || this.model,
          nodeId: nodeId || (this.panelMode ? this.selectedNodeId : undefined),
          claudeParams,
        };
        const res = await fetch('/api/query', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) { this.msg('append', { type: 'error', error: data.error }); return; }

        this.currentId = data.sessionId;
        const entry = { sessionId: data.sessionId, name, cwd: cwd || this.cwd, nodeId, params: params || {} };
        this.addManaged(entry);
        this.activeSet.add(this.currentId);
        this.syncActive();
        this.connectSSE(this.currentId);
      } catch (err) {
        this.msg('append', { type: 'error', error: err.message });
      }
    },

    addManaged(entry) {
      if (this.managed.find(s => s.sessionId === entry.sessionId)) return;
      this.managed.unshift(entry);
      this.saveManagedItem(entry);
    },

    removeManaged(id) {
      this.managed = this.managed.filter(s => s.sessionId !== id);
      try { fetch(`/api/managed/${encodeURIComponent(id)}`, { method: 'DELETE' }); } catch {}
      if (this.currentId === id) {
        this.currentId = null;
        this.msg('clear');
        if (this.eventSource) this.eventSource.close();
      }
    },

    async addFolder(detail) {
      const { cwd, nodeId } = detail;
      if (this.managedFolders.some(f => f.cwd === cwd && (f.nodeId || '') === (nodeId || ''))) return;
      this.managedFolders.push({ cwd, nodeId });
      try {
        await fetch('/api/managed-folders', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd, nodeId }),
        });
      } catch {}
    },

    async removeFolder(detail) {
      const { cwd, nodeId } = detail;
      const nid = nodeId || '';
      this.managedFolders = this.managedFolders.filter(f => !(f.cwd === cwd && (f.nodeId || '') === nid));
      try {
        await fetch('/api/managed-folders', {
          method: 'DELETE', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd, nodeId }),
        });
      } catch {}
      const toRemove = this.managed.filter(s => s.cwd === cwd && (s.nodeId || '') === nid);
      for (const s of toRemove) this.removeManaged(s.sessionId);
    },

    async renameFolder(detail) {
      const { cwd, nodeId, label } = detail;
      const nid = nodeId || '';
      const f = this.managedFolders.find(f => f.cwd === cwd && (f.nodeId || '') === nid);
      if (f) f.label = label || undefined;
      this.managedFolders = [...this.managedFolders];
      try {
        await fetch('/api/managed-folders', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cwd, nodeId, label }),
        });
      } catch {}
    },

    async switchSession(id) {
      if (this.currentId === id) return;
      this.currentId = id;
      this.msg('clear');
      this.seenUuids = new Set();
      this.totalCost = 0; this.totalIn = 0; this.totalOut = 0;

      const s = this.managed.find(s => s.sessionId === id);
      if (s) {
        this.cwd = s.cwd || this.cwd;
        if (s.nodeId) this.selectedNodeId = s.nodeId;
      }

      try {
        const params = new URLSearchParams({ cwd: s?.cwd || this.cwd });
        if (this.panelMode && s?.nodeId) params.set('nodeId', s.nodeId);
        const res = await fetch(`/api/sessions/${id}/messages?${params}`);
        if (res.ok) {
          const msgs = (await res.json()) || [];
          for (const m of msgs) { if (m.uuid) this.seenUuids.add(m.uuid); }
          this.msg('load', msgs);
        }
      } catch {}
      this.connectSSE(id);
    },

    async send() {
      if (!this.inputText.trim() || !this.currentId) return;
      const prompt = this.inputText.trim();
      this.inputText = '';
      this.msg('append', { type: 'user', message: { content: [{ type: 'text', text: prompt }] } });

      const s = this.managed.find(s => s.sessionId === this.currentId);
      const claudeParams = s?.params?.claude || undefined;
      try {
        const body = {
          prompt, sessionId: this.currentId,
          cwd: s?.cwd || this.cwd,
          model: claudeParams?.model || this.model,
          nodeId: s?.nodeId || (this.panelMode ? this.selectedNodeId : undefined),
          claudeParams,
        };
        const res = await fetch('/api/query', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (data.error) { this.msg('append', { type: 'error', error: data.error }); return; }

        this.activeSet.add(this.currentId);
        this.syncActive();
        this.connectSSE(this.currentId);
      } catch (err) {
        this.msg('append', { type: 'error', error: err.message });
      }
    },

    async interruptSession() {
      if (!this.currentId) return;
      const s = this.managed.find(s => s.sessionId === this.currentId);
      const headers = {};
      if (this.panelMode && s?.nodeId) headers['x-node-id'] = s.nodeId;
      try { await fetch(`/api/interrupt/${this.currentId}`, { method: 'POST', headers }); } catch {}
    },

    async changeModel() {
      if (!this.currentId) return;
      const s = this.managed.find(s => s.sessionId === this.currentId);
      try {
        const headers = { 'Content-Type': 'application/json' };
        if (this.panelMode && s?.nodeId) headers['x-node-id'] = s.nodeId;
        await fetch(`/api/model/${this.currentId}`, { method: 'POST', headers, body: JSON.stringify({ model: this.model }) });
      } catch {}
    },

    // --- Config events from right sidebar ---

    onConfigSave(detail) {
      const s = this.managed.find(s => s.sessionId === detail.sessionId);
      if (s) s.params = detail.params;
    },

    connectSSE(id) {
      if (this.eventSource) this.eventSource.close();
      const es = new EventSource(`/api/events/${id}`);
      this.eventSource = es;
      es.addEventListener('message', (e) => {
        if (this.currentId !== id) { es.close(); return; }
        try { this.handleEvent(JSON.parse(e.data)); } catch {}
      });
      es.addEventListener('error', () => {
        if (this.currentId !== id || !this.activeSet.has(id)) {
          es.close();
          if (this.eventSource === es) this.eventSource = null;
        }
      });
    },

    handleEvent(msg) {
      if (msg.uuid && msg.type !== 'stream_event') {
        if (this.seenUuids.has(msg.uuid)) {
          if (msg.type === 'assistant') this.msg('reset-stream');
          return;
        }
        this.seenUuids.add(msg.uuid);
      }
      if (msg.type === 'stream_event') { this.msg('stream', msg.event); }
      else if (msg.type === 'assistant') { this.msg('reset-stream'); this.msg('append', msg); }
      else if (msg.type === 'user') { this.msg('append', msg); }
      else if (msg.type === 'result') {
        this.totalCost += msg.total_cost_usd || 0;
        this.totalIn += msg.usage?.input_tokens || 0;
        this.totalOut += msg.usage?.output_tokens || 0;
        this.msg('append', msg);
      } else if (msg.type === 'system') {
        if (msg.subtype === 'init' && this.seenUuids.size > 0) return;
        this.msg('append', msg);
      } else if (msg.type === 'status') {
        if (msg.status === 'idle') {
          this.activeSet.delete(this.currentId);
          this.activeSet = new Set(this.activeSet);
          this.syncActive();
        }
      } else if (msg.type === 'error') { this.msg('append', msg); }
    },

    refreshData() {
      this.refreshNodes();
    },
  };
}
