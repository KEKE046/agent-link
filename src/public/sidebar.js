// Sidebar component — nested inside app(), inherits parent scope for reading:
//   managed, managedFolders, nodes, currentId, activeSet, panelMode, cwd, sidebarWidth, sidebarCollapsed, clampWidth
// Communicates outward via emit():
//   session-switch, session-remove, agent-create, folder-add, folder-remove, folder-rename, data-refresh

function sidebar() {
  return {
    expandedGroups: new Set(),
    folderMenu: null,
    renamePopup: null,  // {cwd, nodeId, label}
    nodeMenu: null,     // nodeId or null
    agentMenu: null,    // sessionId or null
    confirmDialog: null, // {message, onConfirm}
    folderPopup: null,
    menuPos: { top: 0, left: 0 }, // fixed position for dropdown menus

    // Top-level browse state — nested object mutations don't trigger x-for reactivity in Alpine
    browseSessions: [],
    browseLoading: false,
    browseHasMore: false,

    // Add-agent dialog
    agentDialog: null,  // {nodeId, cwd, tab:'new'|'load', name, initialPrompt, configOpen, ...browseState}

    init() {
      if (!this.panelMode) this.expandGroup('node:(local)');
      this.$watch('currentId', (id) => {
        if (!id) return;
        const s = this.managed.find(s => s.sessionId === id);
        if (!s) return;
        const nid = s.nodeId || '(local)';
        this.expandGroup('node:' + nid);
        this.expandGroup(nid + ':' + (s.cwd || this.cwd));
      });
    },

    // --- Groups ---

    openMenu(el, key, menuType) {
      const rect = el.getBoundingClientRect();
      this.menuPos = { top: rect.bottom + 2, left: rect.right - 112 };
      if (menuType === 'folder') {
        this.folderMenu = this.folderMenu === key ? null : key;
        this.nodeMenu = null; this.agentMenu = null;
      } else if (menuType === 'agent') {
        this.agentMenu = this.agentMenu === key ? null : key;
        this.nodeMenu = null; this.folderMenu = null;
      } else {
        this.nodeMenu = this.nodeMenu === key ? null : key;
        this.folderMenu = null; this.agentMenu = null;
      }
    },

    confirmRemove(message, id, type) {
      this.confirmDialog = { message, id, type };
    },

    toggleGroup(key) {
      this.expandedGroups.has(key) ? this.expandedGroups.delete(key) : this.expandedGroups.add(key);
      this.expandedGroups = new Set(this.expandedGroups);
    },
    expandGroup(key) {
      this.expandedGroups.add(key || '(unknown)');
      this.expandedGroups = new Set(this.expandedGroups);
    },

    get groupedSessions() {
      const nodeMap = new Map();
      if (!this.panelMode) {
        nodeMap.set('(local)', { nodeId: '(local)', label: '(local)', approved: true, cwdGroups: [] });
      }
      for (const n of this.nodes) {
        nodeMap.set(n.nodeId, { nodeId: n.nodeId, label: n.label, approved: n.approved, cwdGroups: [] });
      }
      const cwdMap = new Map();
      for (const f of this.managedFolders) {
        const nid = f.nodeId || '(local)';
        const key = nid + ':' + f.cwd;
        if (!cwdMap.has(key)) cwdMap.set(key, { nodeId: nid, cwd: f.cwd, label: f.label || '', sessions: [], isFolder: true });
      }
      for (const s of this.managed) {
        const nid = s.nodeId || '(local)';
        const key = nid + ':' + (s.cwd || '(unknown)');
        if (!cwdMap.has(key)) cwdMap.set(key, { nodeId: nid, cwd: s.cwd || '(unknown)', label: this.getFolderLabel(s.cwd, nid), sessions: [] });
        cwdMap.get(key).sessions.push(s);
      }
      for (const [, group] of cwdMap) {
        if (!nodeMap.has(group.nodeId))
          nodeMap.set(group.nodeId, { nodeId: group.nodeId, label: group.nodeId, approved: true, cwdGroups: [] });
        nodeMap.get(group.nodeId).cwdGroups.push(group);
      }
      return [...nodeMap.values()];
    },

    // --- Resize ---

    startResize(event) {
      if (this.sidebarCollapsed) return;
      const startX = event.touches?.[0]?.clientX ?? event.clientX;
      const startWidth = this.sidebarWidth;
      let frame = null, nextWidth = this.sidebarWidth;
      const prev = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        if (e.type === 'touchmove' && e.cancelable) e.preventDefault();
        const cx = e.touches?.[0]?.clientX ?? e.clientX;
        if (typeof cx !== 'number') return;
        nextWidth = this.clampWidth(startWidth + (cx - startX));
        if (frame) return;
        frame = requestAnimationFrame(() => { this.sidebarWidth = nextWidth; frame = null; });
      };
      const onUp = () => {
        if (frame) cancelAnimationFrame(frame);
        this.sidebarWidth = nextWidth;
        document.body.style.userSelect = prev;
        window.removeEventListener('mousemove', onMove);
        window.removeEventListener('mouseup', onUp);
        window.removeEventListener('touchmove', onMove);
        window.removeEventListener('touchend', onUp);
      };
      window.addEventListener('mousemove', onMove);
      window.addEventListener('mouseup', onUp);
      window.addEventListener('touchmove', onMove, { passive: false });
      window.addEventListener('touchend', onUp);
    },
    handleResizeKeydown(event) {
      if (this.sidebarCollapsed) return;
      if (event.key === 'ArrowLeft') { event.preventDefault(); this.sidebarWidth = this.clampWidth(this.sidebarWidth - 12); }
      else if (event.key === 'ArrowRight') { event.preventDefault(); this.sidebarWidth = this.clampWidth(this.sidebarWidth + 12); }
    },

    // --- Node ---

    isNodeOnline(nodeId) {
      if (nodeId === '(local)') return true;
      return this.nodes.find(n => n.nodeId === nodeId)?.online ?? false;
    },

    async approveNode(nodeId) {
      try {
        await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/approve`, { method: 'POST' });
        emit('data-refresh');
      } catch {}
    },

    async removeNode(nodeId) {
      try {
        await fetch(`/api/nodes/${encodeURIComponent(nodeId)}`, { method: 'DELETE' });
        emit('node-removed', nodeId);
      } catch {}
    },

    // --- Folder management ---

    isManagedFolder(cwd, nodeId) {
      const nid = (!nodeId || nodeId === '(local)') ? '' : nodeId;
      return this.managedFolders.some(f => f.cwd === cwd && (f.nodeId || '') === nid);
    },

    isSessionManaged(sessionId) {
      return this.managed.some(s => s.sessionId === sessionId);
    },

    getFolderLabel(cwd, nodeId) {
      const nid = (!nodeId || nodeId === '(local)') ? '' : nodeId;
      const f = this.managedFolders.find(f => f.cwd === cwd && (f.nodeId || '') === nid);
      return f?.label || '';
    },

    openRenamePopup(cwd, nodeId) {
      this.renamePopup = { cwd, nodeId, label: this.getFolderLabel(cwd, nodeId) };
      this.$nextTick(() => document.querySelector('#rename-input')?.focus());
    },

    submitRename() {
      if (!this.renamePopup) return;
      const { cwd, nodeId, label } = this.renamePopup;
      emit('folder-rename', { cwd, nodeId: nodeId === '(local)' ? undefined : nodeId, label: label.trim() });
      this.renamePopup = null;
    },

    // --- Add-folder popup ---

    openFolderPopup(nodeId) {
      this.nodeMenu = null;
      this.folderPopup = { nodeId: nodeId || '(local)', cwd: '', folders: [], loading: true };
      this.$nextTick(() => document.querySelector('#folder-cwd-input')?.focus());
      this.fetchFolderList();
    },

    async fetchFolderList() {
      if (!this.folderPopup) return;
      try {
        const data = await (await fetch('/api/sessions?limit=200')).json();
        const cwdSet = new Set();
        for (const s of (data || [])) { if (s.cwd) cwdSet.add(s.cwd); }
        // Exclude already-managed folders for this node
        const nid = this.folderPopup.nodeId;
        const managed = new Set(this.managedFolders.filter(f => (f.nodeId || '(local)') === nid).map(f => f.cwd));
        this.folderPopup.folders = [...cwdSet].filter(c => !managed.has(c)).sort();
      } catch { this.folderPopup.folders = []; }
      this.folderPopup.loading = false;
    },

    submitFolderPopup() {
      if (!this.folderPopup || !this.folderPopup.cwd.trim()) return;
      const nodeId = this.folderPopup.nodeId === '(local)' ? undefined : this.folderPopup.nodeId;
      emit('folder-add', { cwd: this.folderPopup.cwd.trim(), nodeId });
      this.folderPopup = null;
    },

    // --- Add-agent dialog ---

    openAgentDialog(nodeId, cwd) {
      this.nodeMenu = null;
      this.browseSessions = [];
      this.browseLoading = false;
      this.browseHasMore = false;
      this.agentDialog = {
        nodeId: nodeId || '(local)',
        cwd: cwd || this.cwd,
        tab: 'new',
        name: '',
        initialPrompt: '',
        configOpen: false,
        // Config fields
        cfgModel: '',
        cfgThinking: '',
        cfgEffort: '',
        cfgPermission: '',
        cfgSystemPrompt: '',
        cfgEnvText: '',
        cfgJsonText: '{}',
        cfgJsonError: '',
        cfgShowSystemPrompt: false,
        cfgShowEnv: false,
        cfgShowJson: false,
        // Browse state (sessions/loading/hasMore are top-level for Alpine reactivity)
        browseFilter: cwd || '',
        browseExact: !!cwd,
        browseLimit: 30,
        browseOffset: 0,
        browseSelected: null,
      };
    },

    buildDialogParams() {
      const d = this.agentDialog;
      if (!d) return {};
      const p = {};
      if (d.cfgModel) p.model = d.cfgModel;
      if (d.cfgThinking) p.thinking = { type: d.cfgThinking };
      if (d.cfgEffort) p.effort = d.cfgEffort;
      if (d.cfgPermission) p.permissionMode = d.cfgPermission;
      // System prompt: use user's input, or default "Your Name is {name}"
      const sysPrompt = d.cfgSystemPrompt.trim() || (d.name.trim() ? `Your Name is ${d.name.trim()}` : '');
      if (sysPrompt) {
        p.systemPrompt = { type: 'preset', preset: 'claude_code', append: sysPrompt };
      }
      if (d.cfgEnvText.trim()) {
        const env = {};
        for (const line of d.cfgEnvText.split('\n')) {
          const idx = line.indexOf('=');
          if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1);
        }
        if (Object.keys(env).length > 0) p.env = env;
      }
      return p;
    },

    syncDialogJson() {
      const d = this.agentDialog;
      if (!d) return;
      d.cfgJsonText = JSON.stringify(this.buildDialogParams(), null, 2);
    },

    syncDialogFromJson() {
      const d = this.agentDialog;
      if (!d) return;
      try {
        const p = JSON.parse(d.cfgJsonText);
        d.cfgJsonError = '';
        d.cfgModel = p.model || '';
        d.cfgThinking = p.thinking?.type || '';
        d.cfgEffort = p.effort || '';
        d.cfgPermission = p.permissionMode || '';
        if (typeof p.systemPrompt === 'string') d.cfgSystemPrompt = p.systemPrompt;
        else if (p.systemPrompt?.append) d.cfgSystemPrompt = p.systemPrompt.append;
        else d.cfgSystemPrompt = '';
        const env = p.env || {};
        d.cfgEnvText = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
      } catch (e) { d.cfgJsonError = e.message; }
    },

    // Browse sessions for Load tab
    renderSessionsHtml(sessions, loading, selected) {
      if (loading) return '<div class="p-3 text-gray-500 text-xs text-center">Loading...</div>';
      if (!sessions?.length) return '<div class="p-3 text-gray-600 text-xs text-center">No sessions found</div>';
      const esc = s => String(s ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
      return sessions.map(s => {
        const sel = selected === s.sessionId;
        const cls = sel ? 'bg-blue-600/20 border-l-2 border-blue-400' : 'border-l-2 border-transparent';
        const date = s.lastModified ? new Date(s.lastModified).toLocaleString() : '';
        return `<div data-sid="${esc(s.sessionId)}" class="px-3 py-1.5 cursor-pointer hover:bg-gray-800/50 ${cls}">` +
          `<div class="text-xs truncate">${esc(s.summary || s.sessionId.slice(0, 12))}</div>` +
          `<div class="text-[10px] text-gray-600 mt-0.5 flex gap-3">` +
          `<span class="truncate">${esc(s.cwd || '')}</span>` +
          `<span class="flex-shrink-0">${esc(date)}</span></div></div>`;
      }).join('');
    },

    handleSessionClick(event) {
      const div = event.target.closest('[data-sid]');
      if (!div || !this.agentDialog) return;
      const sessionId = div.dataset.sid;
      const s = this.browseSessions.find(s => s.sessionId === sessionId);
      if (!s) return;
      this.agentDialog.browseSelected = this.agentDialog.browseSelected === sessionId ? null : sessionId;
      if (s.cwd) this.agentDialog.cwd = s.cwd;
      if (!this.agentDialog.name && s.summary) this.agentDialog.name = s.summary.slice(0, 30);
    },

    async fetchBrowseSessions(append = false) {
      const d = this.agentDialog;
      if (!d) return;
      this.browseLoading = true;
      try {
        const params = new URLSearchParams({ limit: String(d.browseLimit), offset: String(d.browseOffset) });
        if (d.browseFilter && d.browseExact) params.set('cwd', d.browseFilter);
        const data = await (await fetch(`/api/sessions?${params}`)).json();
        let filtered = Array.isArray(data) ? data : [];
        if (d.browseFilter && !d.browseExact) {
          const q = d.browseFilter.toLowerCase();
          filtered = filtered.filter(s => (s.cwd || '').toLowerCase().includes(q));
        }
        this.browseHasMore = Array.isArray(data) && data.length >= d.browseLimit;
        this.browseSessions = append ? [...this.browseSessions, ...filtered] : filtered;
      } catch {
        if (!append) this.browseSessions = [];
        this.browseHasMore = false;
      }
      this.browseLoading = false;
    },

    submitAgentDialog() {
      const d = this.agentDialog;
      if (!d || !d.name.trim()) return;

      const params = { claude: this.buildDialogParams() };
      const nodeId = d.nodeId === '(local)' ? undefined : d.nodeId;

      if (d.tab === 'load' && d.browseSelected) {
        emit('agent-create', {
          name: d.name.trim(), cwd: d.cwd, nodeId, params,
          loadSessionId: d.browseSelected,
        });
      } else {
        emit('agent-create', {
          name: d.name.trim(), cwd: d.cwd, nodeId, params,
          initialPrompt: d.initialPrompt,
        });
      }
      this.agentDialog = null;
    },
  };
}
