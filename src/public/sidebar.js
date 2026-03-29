// Sidebar component — nested inside app(), inherits parent scope for reading:
//   managed, nodes, currentId, activeSet, panelMode, vscodeActive, cwd, panelAdminSecret, sidebarWidth, sidebarCollapsed, clampWidth
// Communicates outward via emit():
//   session-switch, session-new, session-remove, session-add, vscode-open, data-refresh

function sidebar() {
  return {
    expandedGroups: new Set(),

    // Load modal
    showLoadModal: false,
    browseSessions: [],
    browseLoading: false,
    browseCwd: '',
    browseLimit: 30,
    browseOffset: 0,
    browseExpanded: new Set(),
    browseHasMore: false,

    // Rename node modal
    renameModal: null,

    init() {
      // Auto-expand the local node in standalone mode
      if (!this.panelMode) this.expandGroup('node:(local)');
      // Auto-expand group when currentId changes
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
    toggleGroup(key) {
      this.expandedGroups.has(key) ? this.expandedGroups.delete(key) : this.expandedGroups.add(key);
      this.expandedGroups = new Set(this.expandedGroups);
    },
    expandGroup(key) {
      this.expandedGroups.add(key || '(unknown)');
      this.expandedGroups = new Set(this.expandedGroups);
    },

    // Unified: always returns [{nodeId, label, approved, cwdGroups: [{cwd, sessions}]}]
    // In standalone mode, one virtual "(local)" node.
    get groupedSessions() {
      const nodeMap = new Map();
      for (const n of this.nodes) {
        nodeMap.set(n.nodeId, { nodeId: n.nodeId, label: n.label, approved: n.approved, cwdGroups: [] });
      }
      const cwdMap = new Map();
      for (const s of this.managed) {
        const nid = s.nodeId || '(local)';
        const key = nid + ':' + (s.cwd || '(unknown)');
        if (!cwdMap.has(key)) cwdMap.set(key, { nodeId: nid, cwd: s.cwd || '(unknown)', sessions: [] });
        cwdMap.get(key).sessions.push(s);
      }
      for (const [, group] of cwdMap) {
        if (!nodeMap.has(group.nodeId))
          nodeMap.set(group.nodeId, { nodeId: group.nodeId, label: group.nodeId, approved: true, cwdGroups: [] });
        nodeMap.get(group.nodeId).cwdGroups.push(group);
      }
      return [...nodeMap.values()];
    },

    get groupedBrowse() {
      const map = new Map();
      for (const s of this.browseSessions) {
        const key = s.cwd || '(unknown)';
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(s);
      }
      return Array.from(map, ([cwd, sessions]) => ({ cwd, sessions }));
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
      else if (event.key === 'Home') { event.preventDefault(); this.sidebarWidth = 180; }
      else if (event.key === 'End') { event.preventDefault(); this.sidebarWidth = 480; }
    },

    // --- VSCode helpers (read-only, for sidebar VS buttons) ---
    isVscodeActive(cwd, nodeId) {
      return !!this.vscodeActive[nodeId + ':' + cwd] || !!this.vscodeActive[cwd];
    },
    vscodeUrl(cwd, nodeId) {
      const item = this.vscodeActive[nodeId + ':' + cwd] || this.vscodeActive[cwd];
      if (!item?.id) return '#';
      return item.nodeId ? `/vscode/${item.nodeId}/${item.id}/` : `/vscode/${item.id}/`;
    },

    // --- Node ---
    isNodeOnline(nodeId) {
      if (nodeId === '(local)') return true;
      return this.nodes.find(n => n.nodeId === nodeId)?.online ?? false;
    },
    async approveNode(nodeId) {
      if (!this.panelAdminSecret) return alert('Set admin secret in header first');
      try { await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${this.panelAdminSecret}` } }); } catch {}
      emit('data-refresh');
    },
    async renameNodePrompt(node) {
      this.renameModal = { nodeId: node.nodeId, label: node.label || node.nodeId };
      await this.$nextTick();
      this.$refs.renameInput?.focus();
      this.$refs.renameInput?.select();
    },
    async renameNodeSubmit() {
      const m = this.renameModal;
      if (!m) return;
      const label = m.label.trim();
      if (!label) { this.renameModal = null; return; }
      if (!this.panelAdminSecret) { this.renameModal = null; return alert('Set admin secret in header first'); }
      try { await fetch(`/api/nodes/${encodeURIComponent(m.nodeId)}/label`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.panelAdminSecret}` }, body: JSON.stringify({ label }) }); } catch {}
      this.renameModal = null;
      emit('data-refresh');
    },

    // --- Load sessions modal ---
    loadSessions() {
      this.showLoadModal = true;
      this.browseCwd = '';
      this.browseOffset = 0;
      this.browseSessions = [];
      this.browseExpanded = new Set();
      this.fetchBrowseSessions();
    },
    async fetchBrowseSessions(append = false) {
      this.browseLoading = true;
      try {
        const params = new URLSearchParams({ limit: String(this.browseLimit), offset: String(this.browseOffset) });
        if (this.browseCwd) params.set('cwd', this.browseCwd);
        const data = await (await fetch(`/api/sessions?${params}`)).json();
        this.browseHasMore = Array.isArray(data) && data.length >= this.browseLimit;
        this.browseSessions = append ? [...this.browseSessions, ...data] : data;
      } catch {
        if (!append) this.browseSessions = [];
        this.browseHasMore = false;
      }
      this.browseLoading = false;
    },
    addToManaged(session) {
      const entry = {
        sessionId: session.sessionId, cwd: session.cwd || this.cwd, model: '',
        label: session.summary || session.firstPrompt?.slice(0, 40) || session.sessionId.slice(0, 12),
      };
      if (session.nodeId) entry.nodeId = session.nodeId;
      emit('session-add', entry);
      this.showLoadModal = false;
      emit('session-switch', session.sessionId);
    },
  };
}
