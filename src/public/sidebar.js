// Sidebar component — nested inside app(), inherits parent scope for reading:
//   managed, managedFolders, nodes, currentId, activeSet, panelMode, cwd, sidebarWidth, sidebarCollapsed, clampWidth
// Communicates outward via emit():
//   session-switch, session-new, session-remove, session-add, session-create, folder-add, folder-remove, data-refresh

function sidebar() {
  return {
    expandedGroups: new Set(),

    // Add modal
    addModal: null,  // {nodeId, tab: 'browse'|'add'}
    newCwd: '',
    folderMenu: null,
    browseSessions: [],
    browseLoading: false,
    browseFilter: '',
    browseLimit: 30,
    browseOffset: 0,
    browseHasMore: false,
    browseExpanded: new Set(),
    browseCheckedSessions: new Set(),
    browseCheckedFolders: new Set(),

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
    // Merges managedFolders so empty folders still appear.
    // Standalone mode: always shows a "(local)" node.
    get groupedSessions() {
      const nodeMap = new Map();
      if (!this.panelMode) {
        nodeMap.set('(local)', { nodeId: '(local)', label: '(local)', approved: true, cwdGroups: [] });
      }
      for (const n of this.nodes) {
        nodeMap.set(n.nodeId, { nodeId: n.nodeId, label: n.label, approved: n.approved, cwdGroups: [] });
      }
      const cwdMap = new Map();
      // Add managed folders first (may be empty)
      for (const f of this.managedFolders) {
        const nid = f.nodeId || '(local)';
        const key = nid + ':' + f.cwd;
        if (!cwdMap.has(key)) cwdMap.set(key, { nodeId: nid, cwd: f.cwd, sessions: [], isFolder: true });
      }
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

    // --- Node ---
    isNodeOnline(nodeId) {
      if (nodeId === '(local)') return true;
      return this.nodes.find(n => n.nodeId === nodeId)?.online ?? false;
    },

    // --- Folder management ---
    isManagedFolder(cwd, nodeId) {
      const nid = (!nodeId || nodeId === '(local)') ? '' : nodeId;
      return this.managedFolders.some(f => f.cwd === cwd && (f.nodeId || '') === nid);
    },

    isSessionManaged(sessionId) {
      return this.managed.some(s => s.sessionId === sessionId);
    },

    // --- Add modal ---
    openAddModal(nodeId, cwd) {
      this.addModal = { nodeId: nodeId || '(local)' };
      this.newCwd = cwd || this.cwd;
      this.browseFilter = cwd || '';
      this.browseCheckedSessions = new Set();
      this.browseCheckedFolders = new Set();
      this.browseSessions = [];
      this.browseOffset = 0;
      this.browseHasMore = false;
      this.browseExpanded = new Set();
      // Default to 'browse' tab
      this.addModal.tab = 'browse';
      this.fetchBrowseSessions();
    },

    async fetchBrowseSessions(append = false) {
      this.browseLoading = true;
      try {
        const params = new URLSearchParams({ limit: String(this.browseLimit), offset: String(this.browseOffset) });
        if (this.browseFilter) params.set('cwd', this.browseFilter);
        const data = await (await fetch(`/api/sessions?${params}`)).json();
        this.browseHasMore = Array.isArray(data) && data.length >= this.browseLimit;
        this.browseSessions = append ? [...this.browseSessions, ...data] : data;
      } catch {
        if (!append) this.browseSessions = [];
        this.browseHasMore = false;
      }
      this.browseLoading = false;
      // Auto-expand if only one folder group
      if (!append) {
        const groups = this.groupedBrowse;
        if (groups.length === 1) {
          this.browseExpanded.add(groups[0].cwd);
          this.browseExpanded = new Set(this.browseExpanded);
        }
      }
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

    toggleBrowseSession(sessionId) {
      if (this.browseCheckedSessions.has(sessionId)) this.browseCheckedSessions.delete(sessionId);
      else this.browseCheckedSessions.add(sessionId);
      this.browseCheckedSessions = new Set(this.browseCheckedSessions);
    },

    toggleBrowseFolder(cwd) {
      if (this.browseCheckedFolders.has(cwd)) this.browseCheckedFolders.delete(cwd);
      else this.browseCheckedFolders.add(cwd);
      this.browseCheckedFolders = new Set(this.browseCheckedFolders);
    },

    browseClickFolder(g) {
      if (g.sessions.length === 1) {
        const s = g.sessions[0];
        const nid = this.addModal?.nodeId === '(local)' ? undefined : this.addModal?.nodeId;
        if (!this.isSessionManaged(s.sessionId)) {
          emit('session-add', {
            sessionId: s.sessionId, cwd: s.cwd || this.cwd, nodeId: nid,
            label: s.summary || s.firstPrompt?.slice(0, 40) || s.sessionId.slice(0, 12),
          });
        }
        emit('session-switch', s.sessionId);
        this.addModal = null;
      } else {
        if (this.browseExpanded.has(g.cwd)) this.browseExpanded.delete(g.cwd);
        else this.browseExpanded.add(g.cwd);
        this.browseExpanded = new Set(this.browseExpanded);
      }
    },

    get hasChecked() {
      return this.browseCheckedSessions.size > 0 || this.browseCheckedFolders.size > 0;
    },

    createNewSession() {
      if (!this.newCwd.trim()) return;
      const nodeId = this.addModal?.nodeId;
      emit('session-create', { cwd: this.newCwd.trim(), nodeId: nodeId === '(local)' ? undefined : nodeId });
      this.addModal = null;
    },

    addSelected() {
      const nodeId = this.addModal?.nodeId;
      const nid = nodeId === '(local)' ? undefined : nodeId;
      // Add checked folders
      for (const cwd of this.browseCheckedFolders) {
        emit('folder-add', { cwd, nodeId: nid });
      }
      // Add checked sessions
      for (const sessionId of this.browseCheckedSessions) {
        const session = this.browseSessions.find(s => s.sessionId === sessionId);
        if (session) {
          emit('session-add', {
            sessionId, cwd: session.cwd || this.cwd, nodeId: nid,
            label: session.summary || session.firstPrompt?.slice(0, 40) || sessionId.slice(0, 12),
          });
        }
      }
      // Switch to the first checked session
      if (this.browseCheckedSessions.size > 0) {
        const first = this.browseCheckedSessions.values().next().value;
        emit('session-switch', first);
      }
      this.addModal = null;
    },
  };
}
