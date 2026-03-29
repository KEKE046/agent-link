// VSCode modal component — listens for vscode-open event, emits data-refresh
// Reads from parent scope: vscodeActive

function vscodeUi() {
  return {
    show: false,
    versions: [],
    targetCwd: '',
    targetNodeId: '',
    tab: 'start',
    selectedCommit: '',
    installVersion: '1.112.0',
    install: null,
    loading: false,
    startedUrl: '',

    init() {
      window.addEventListener('vscode-open', (e) => this.open(e.detail));
    },

    vscodeUrl(cwd, nodeId) {
      const key = nodeId ? (nodeId + ':' + cwd) : cwd;
      const item = this.vscodeActive[key];
      if (!item?.id) return '#';
      return item.nodeId ? `/vscode/${item.nodeId}/${item.id}/` : `/vscode/${item.id}/`;
    },

    async open({ cwd, nodeId }) {
      this.targetCwd = cwd;
      this.targetNodeId = nodeId || '';
      this.tab = 'start';
      this.selectedCommit = '';
      this.startedUrl = '';
      this.loading = true;
      this.show = true;
      try {
        const params = nodeId ? `?nodeId=${encodeURIComponent(nodeId)}` : '';
        this.versions = await (await fetch('/api/vscode/versions' + params)).json();
        this.tab = this.versions.length === 0 ? 'install' : 'start';
        await this.fetchInstallInfo();
        if (this.versions.length > 0) this.selectedCommit = this.versions[0].commit;
      } catch { this.versions = []; }
      this.loading = false;
    },

    async fetchInstallInfo() {
      try {
        const params = new URLSearchParams({ version: this.installVersion || '1.112.0' });
        if (this.targetNodeId) params.set('nodeId', this.targetNodeId);
        this.install = await (await fetch(`/api/vscode/install-command?${params}`)).json();
      } catch { this.install = null; }
    },

    async start() {
      if (!this.targetCwd || !this.selectedCommit) return;
      this.loading = true;
      try {
        const body = { cwd: this.targetCwd, commit: this.selectedCommit };
        if (this.targetNodeId) body.nodeId = this.targetNodeId;
        const data = await (await fetch('/api/vscode/start', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })).json();
        if (data.error) throw new Error(data.error);
        emit('data-refresh');
        // Small delay to let vscodeActive refresh before reading URL
        await new Promise(r => setTimeout(r, 200));
        this.startedUrl = this.vscodeUrl(this.targetCwd, this.targetNodeId);
      } catch (err) { alert(err?.message || 'Failed to start VSCode server'); }
      this.loading = false;
    },

    async stop(cwd, nodeId) {
      const key = nodeId ? nodeId + ':' + cwd : cwd;
      if (!this.vscodeActive[key]) return;
      if (!confirm(`Stop VSCode server for ${cwd}?`)) return;
      try {
        const body = { cwd };
        if (nodeId) body.nodeId = nodeId;
        await fetch('/api/vscode/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      } catch {}
      emit('data-refresh');
    },
  };
}
