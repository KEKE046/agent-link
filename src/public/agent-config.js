// Right sidebar: agent configuration panel
// Reads from parent scope: managed, currentId, activeSet, panelMode
// Emits: config-save, config-compact, config-reload

function agentConfig() {
  return {
    collapsed: (() => {
      const v = localStorage.getItem('agent-link:config-collapsed');
      return v !== null ? v === 'true' : true;
    })(),
    width: (() => {
      const v = Number(localStorage.getItem('agent-link:config-width'));
      return Math.min(480, Math.max(220, Number.isFinite(v) ? v : 300));
    })(),

    // Graphical controls (synced with JSON)
    bio: '',
    model: '',
    thinking: '',
    effort: '',
    permissionMode: '',
    systemPrompt: '',
    envText: '',
    jsonText: '{}',
    jsonError: '',
    dirty: false,

    // Collapsible sections
    showSystemPrompt: false,
    showEnv: false,
    showJson: false,

    init() {
      this.$watch('collapsed', (v) => localStorage.setItem('agent-link:config-collapsed', String(v)));
      this.$watch('width', (v) => localStorage.setItem('agent-link:config-width', String(v)));
      this.$watch('currentId', () => this.loadFromSession());
      this.loadFromSession();
      window.addEventListener('config-toggle', () => { this.collapsed = !this.collapsed; });
    },

    get session() {
      return this.managed.find(s => s.sessionId === this.currentId);
    },

    get isActive() {
      return !!(this.currentId && this.activeSet.has(this.currentId));
    },

    get params() {
      return this.session?.params?.claude || {};
    },

    // --- Load from session ---

    loadFromSession() {
      const p = this.params;
      this.bio = this.session?.bio || '';
      this.model = p.model || '';
      this.thinking = typeof p.thinking === 'object' ? (p.thinking.type || '') : '';
      this.effort = p.effort || '';
      this.permissionMode = p.permissionMode || '';

      // System prompt
      if (typeof p.systemPrompt === 'string') {
        this.systemPrompt = p.systemPrompt;
      } else if (p.systemPrompt?.append) {
        this.systemPrompt = p.systemPrompt.append;
      } else {
        this.systemPrompt = '';
      }

      // ENV
      const env = p.env || {};
      this.envText = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');

      this.syncToJson();
      this.dirty = false;
      this.jsonError = '';
    },

    // --- Build params object from controls ---

    buildParams() {
      const p = {};
      if (this.model) p.model = this.model;
      if (this.thinking) p.thinking = { type: this.thinking };
      if (this.effort) p.effort = this.effort;
      if (this.permissionMode) p.permissionMode = this.permissionMode;

      // System prompt
      if (this.systemPrompt.trim()) {
        p.systemPrompt = { type: 'preset', preset: 'claude_code', append: this.systemPrompt.trim() };
      }

      // ENV
      if (this.envText.trim()) {
        const env = {};
        for (const line of this.envText.split('\n')) {
          const idx = line.indexOf('=');
          if (idx > 0) env[line.slice(0, idx).trim()] = line.slice(idx + 1);
        }
        if (Object.keys(env).length > 0) p.env = env;
      }

      return p;
    },

    // --- Sync graphical controls -> JSON ---

    syncToJson() {
      const p = this.buildParams();
      this.jsonText = JSON.stringify(p, null, 2);
    },

    // --- Sync JSON -> graphical controls ---

    syncFromJson() {
      try {
        const p = JSON.parse(this.jsonText);
        this.jsonError = '';

        this.model = p.model || '';
        this.thinking = typeof p.thinking === 'object' ? (p.thinking?.type || '') : '';
        this.effort = p.effort || '';
        this.permissionMode = p.permissionMode || '';

        if (typeof p.systemPrompt === 'string') {
          this.systemPrompt = p.systemPrompt;
        } else if (p.systemPrompt?.append) {
          this.systemPrompt = p.systemPrompt.append;
        } else {
          this.systemPrompt = '';
        }

        const env = p.env || {};
        this.envText = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
      } catch (e) {
        this.jsonError = e.message;
      }
    },

    // --- Mark dirty on any control change ---

    markDirty() {
      this.dirty = true;
      this.syncToJson();
    },

    // --- Save ---

    async save() {
      if (!this.session) return;
      const params = { claude: this.buildParams() };
      const bio = this.bio.trim();
      try {
        await fetch(`/api/managed/${encodeURIComponent(this.session.sessionId)}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ params, bio: bio || '' }),
        });
        this.session.params = params;
        if (bio) this.session.bio = bio; else delete this.session.bio;
        this.dirty = false;
        emit('config-save', { sessionId: this.session.sessionId, params });
      } catch {}
    },

    async saveJson() {
      this.syncFromJson();
      if (this.jsonError) return;
      this.dirty = true;
      await this.save();
    },

    // --- Custom model management ---

    // --- Actions ---

    async compact() {
      if (!this.currentId || !this.isActive) return;
      emit('config-compact', { sessionId: this.currentId });
    },

    async reload() {
      if (!this.currentId || !this.isActive) return;
      emit('config-reload', { sessionId: this.currentId });
    },

    // --- Resize ---

    clampWidth(w) { return Math.min(480, Math.max(220, Number.isFinite(w) ? w : 300)); },

    startResize(event) {
      if (this.collapsed) return;
      const startX = event.touches?.[0]?.clientX ?? event.clientX;
      const startWidth = this.width;
      let frame = null, nextWidth = this.width;
      const prev = document.body.style.userSelect;
      document.body.style.userSelect = 'none';
      const onMove = (e) => {
        const cx = e.touches?.[0]?.clientX ?? e.clientX;
        if (typeof cx !== 'number') return;
        // Right sidebar: dragging left increases width
        nextWidth = this.clampWidth(startWidth - (cx - startX));
        if (frame) return;
        frame = requestAnimationFrame(() => { this.width = nextWidth; frame = null; });
      };
      const onUp = () => {
        if (frame) cancelAnimationFrame(frame);
        this.width = nextWidth;
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
  };
}
