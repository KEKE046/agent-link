// renderer.js — Alpine.js message rendering component

document.addEventListener('alpine:init', () => {

  const _mdCache = new Map();
  const TASK_NOTE_BLOCK_RE = /(<div class="task-note">[\s\S]*?<\/div>)/g;
  const TASK_NOTE_BLOCK_MATCH_RE = /^<div class="task-note">[\s\S]*<\/div>$/;
  const TASK_NOTIFICATION_RE = /<task-notification>[\s\S]*?<summary>([\s\S]*?)<\/summary>[\s\S]*?<\/task-notification>/g;
  const USER_COLLAPSE_MAX_CHARS = 150;
  const USER_COLLAPSE_MAX_LINES = 3;
  const USER_SUMMARY_MAX_LENGTH = 100;
  const TASK_NOTIFICATION_SUMMARY_PREFIX = 'task-notification: ';

  function esc(text) {
    if (!text) return '';
    return String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function renderMd(text) {
    if (!text) return '';
    let html = _mdCache.get(text);
    if (html !== undefined) return html;
    try { html = marked.parse(text, { breaks: true }); }
    catch { html = esc(text); }
    _mdCache.set(text, html);
    if (_mdCache.size > 500) _mdCache.delete(_mdCache.keys().next().value);
    return html;
  }

  function sizeStr(len) {
    if (len >= 1024) return (len / 1024).toFixed(1) + 'KB';
    return len + 'B';
  }

  function renderTaskNotifications(text) {
    if (!text || !text.includes('<task-notification>')) return text;
    if (text.length > 100_000) return text;
    return text.replace(TASK_NOTIFICATION_RE, (_, summary) => {
      return `\n<div class="task-note"><span class="task-note-tag">task-notification</span><span class="task-note-summary">${esc(summary?.trim() || '')}</span></div>\n`;
    });
  }

  function renderUserTextWithTaskNotifications(text) {
    const rendered = renderTaskNotifications(text);
    if (rendered === text) return esc(text);
    return rendered
      .split(TASK_NOTE_BLOCK_RE)
      .map(part => TASK_NOTE_BLOCK_MATCH_RE.test(part) ? part : esc(part))
      .join('');
  }

  function toolKindClass(name) {
    switch (name) {
      case 'Bash': return 'tool-kind-bash';
      case 'Read': return 'tool-kind-read';
      case 'Write': return 'tool-kind-write';
      case 'Edit': return 'tool-kind-edit';
      case 'Grep':
      case 'Glob': return 'tool-kind-search';
      case 'WebFetch':
      case 'WebSearch': return 'tool-kind-web';
      case 'Agent':
      case 'Skill': return 'tool-kind-agent';
      default: return 'tool-kind-default';
    }
  }

  function shouldCollapseUserMessage(text) {
    if (!text) return false;
    const str = String(text);
    return str.length > USER_COLLAPSE_MAX_CHARS || str.split('\n').length > USER_COLLAPSE_MAX_LINES;
  }

  function userMessageSummary(text) {
    if (!text) return '';
    const replaced = String(text).replace(TASK_NOTIFICATION_RE, (_, summary) => {
      const s = summary?.trim() || '';
      return s ? `${TASK_NOTIFICATION_SUMMARY_PREFIX}${s}` : 'task-notification';
    });
    const first = replaced.split('\n')[0]?.trim() || '';
    const clipped = first.length > USER_SUMMARY_MAX_LENGTH ? first.slice(0, USER_SUMMARY_MAX_LENGTH) + '...' : first;
    return esc(clipped);
  }

  function renderUserMessage(text) {
    const userText = renderUserTextWithTaskNotifications(text);
    if (!shouldCollapseUserMessage(text)) {
      return `<div class="message-row message-user py-1"><div class="user-message-content"><span class="message-prefix">~ </span>${userText}</div></div>`;
    }
    return `<div class="message-row message-user py-1">
      <details class="user-message-details">
        <summary class="user-message-summary"><span class="message-prefix">~ </span>${userMessageSummary(text)}</summary>
        <div class="user-message-content">${userText}</div>
      </details>
    </div>`;
  }

  function renderAssistantMessage(text) {
    return `<div class="message-row message-assistant py-1"><div class="message-content assistant-message md-content">${renderMd(renderTaskNotifications(text))}</div></div>`;
  }

  function renderProcessGroup(innerHtml, shouldOpen = false) {
    if (!innerHtml) return '';
    return `<details${shouldOpen ? ' open' : ''} class="process-details mt-0.5">
      <summary class="process-summary text-xs cursor-pointer select-none">process</summary>
      <div class="process-body">${innerHtml}</div>
    </details>`;
  }

  // --- Tool rendering ---

  function renderToolUse(name, input) {
    const e = esc;
    switch (name) {
      case 'Bash': {
        const cmd = input?.command || '';
        const lines = cmd.split('\n');
        const first = lines[0].length > 100 ? lines[0].slice(0, 100) + '...' : lines[0];
        const more = lines.length > 1 ? ` <span class="tool-meta">(+${lines.length - 1} lines)</span>` : '';
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">$</span> <span class="tool-text">${e(first)}</span>${more}`;
      }
      case 'Read':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Read</span> <span class="tool-path">${e(input?.file_path || input?.filePath || '')}</span>`;
      case 'Write':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Write</span> <span class="tool-path">${e(input?.file_path || '')}</span>`;
      case 'Edit':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Edit</span> <span class="tool-path">${e(input?.file_path || '')}</span>`;
      case 'Grep':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Grep</span> <span class="tool-text">/${e(input?.pattern || '')}/</span> <span class="tool-meta">in ${e(input?.path || '.')}</span>`;
      case 'Glob':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Glob</span> <span class="tool-text">${e(input?.pattern || '')}</span>`;
      case 'ToolSearch':
        return `<span class="tool-kind tool-kind-search font-semibold">ToolSearch</span> <span class="tool-path">${e(input?.query || '')}</span>`;
      case 'WebFetch': {
        const url = input?.url || '';
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Fetch</span> <span class="tool-path">${e(url.length > 60 ? url.slice(0, 60) + '...' : url)}</span>`;
      }
      case 'WebSearch':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Search</span> <span class="tool-text">"${e(input?.query || '')}"</span>`;
      case 'Agent': {
        const p = input?.prompt || '';
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Agent</span> <span class="tool-path">${e(p.length > 80 ? p.slice(0, 80) + '...' : p)}</span>`;
      }
      case 'Skill':
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">Skill</span> <span class="tool-text">${e(input?.skill || '')}</span>${input?.args ? ` <span class="tool-meta">${e(input.args)}</span>` : ''}`;
      default: {
        const sn = name?.includes('__') ? name.split('__').pop() : name;
        const s = JSON.stringify(input || {});
        return `<span class="tool-kind ${toolKindClass(name)} font-semibold">[${e(sn)}]</span> <span class="tool-meta">${e(s.length > 100 ? s.slice(0, 100) + '...' : s)}</span>`;
      }
    }
  }

  function getResultOutput(block) {
    let outputHtml = '';
    let outputSize = 0;
    if (Array.isArray(block.content)) {
      for (const c of block.content) {
        const text = c.text || c.type || '';
        outputSize += text.length;
        outputHtml += `<div class="whitespace-pre-wrap break-all">${esc(text)}</div>`;
      }
    } else if (typeof block.content === 'string') {
      outputSize = block.content.length;
      const t = block.content.length > 3000 ? block.content.slice(0, 3000) + '\n...' : block.content;
      outputHtml = `<div class="whitespace-pre-wrap break-all">${esc(t)}</div>`;
    }
    return { outputHtml, outputSize, hasError: !!block.is_error };
  }

  // Render a tool_use + optional result as one element.
  // Without result: plain div. With result: details (tool line is summary, output is content).
  function renderToolItem(toolBlock, resultBlock) {
    const toolLine = renderToolUse(toolBlock.name, toolBlock.input);
    const tid = esc(toolBlock.id || '');

    if (!resultBlock) {
      return `<div class="tool-item" data-tool-id="${tid}"><div class="tool-line text-xs py-0.5">${toolLine}</div></div>`;
    }

    const { outputHtml, outputSize, hasError } = getResultOutput(resultBlock);
    if (!outputHtml && !hasError) {
      return `<div class="tool-item" data-tool-id="${tid}"><div class="tool-line text-xs py-0.5">${toolLine}</div></div>`;
    }

    const sizeLabel = outputSize > 0 ? ` <span class="tool-meta font-normal">${sizeStr(outputSize)}</span>` : '';
    const errorBadge = hasError ? ` <span class="text-red-400 font-normal">error</span>` : '';

    return `<details class="tool-details" data-tool-id="${tid}">
      <summary class="tool-line text-xs py-0.5 cursor-pointer select-none">${toolLine}${sizeLabel}${errorBadge}</summary>
      <div class="ml-2 border-l border-gray-800/50 pl-2 max-h-60 overflow-y-auto tool-output text-xs">${outputHtml}</div>
    </details>`;
  }

  // Render a tools group
  function renderToolsGroup(tools) {
    if (tools.length === 0) return '';
    const label = `${tools.length} tool${tools.length > 1 ? 's' : ''}`;
    const itemsHtml = tools.map(t => renderToolItem(t.block, t.result)).join('');
    return `<details class="tool-details tool-group mt-0.5">
      <summary class="tool-group-summary text-xs cursor-pointer select-none">${label}</summary>
      <div class="ml-1 border-l border-gray-800/30 pl-2">${itemsHtml}</div>
    </details>`;
  }

  // --- History rendering (processes full message array, groups tools across messages) ---

  function renderHistory(msgs) {
    // Build tool_use_id → tool_result map
    const resultMap = new Map();
    for (const msg of msgs) {
      if (msg.type === 'user' && Array.isArray(msg.message?.content)) {
        for (const b of msg.message.content) {
          if (b.type === 'tool_result' && b.tool_use_id) resultMap.set(b.tool_use_id, b);
        }
      }
    }

    let html = '';
    let pendingTools = [];
    let pendingProcess = '';

    function flushTools() {
      if (pendingTools.length === 0) return;
      pendingProcess += renderToolsGroup(pendingTools);
      pendingTools = [];
    }

    function flushProcess(shouldOpen = false) {
      flushTools();
      if (!pendingProcess) return;
      html += renderProcessGroup(pendingProcess, shouldOpen);
      pendingProcess = '';
    }

    for (const msg of msgs) {
      if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        for (const block of msg.message.content) {
          if (block.type === 'text' && block.text?.trim()) {
            flushTools();
            pendingProcess += renderAssistantMessage(block.text);
          } else if (block.type === 'tool_use') {
            pendingTools.push({ block, result: resultMap.get(block.id) });
          }
        }
      } else if (msg.type === 'user') {
        const content = msg.message?.content;
        const hasText = typeof content === 'string' ||
          (Array.isArray(content) && content.some(b => b.type === 'text'));
        if (hasText) {
          flushProcess();
          if (typeof content === 'string') {
            html += renderUserMessage(content);
          } else {
            let userHtml = '';
            for (const b of content) {
              if (b.type === 'text') userHtml += renderUserMessage(b.text);
            }
            if (userHtml) html += userHtml;
          }
        }
        // tool_result-only user messages: skip (results inlined via resultMap)
      } else if (msg.type === 'system' && msg.subtype === 'init') {
        flushProcess();
        html += `<div class="text-gray-600 text-xs py-1 border-b border-gray-800/50 mb-2">Session ${esc(msg.session_id?.slice(0, 8))} | model: ${esc(msg.model)} | cwd: ${esc(msg.cwd)} | tools: ${msg.tools?.length || 0}</div>`;
      } else if (msg.type === 'result') {
        flushProcess();
        const cls = msg.subtype === 'success' ? 'text-cyan-400/70' : 'text-red-400/70';
        html += `<div class="text-xs py-1.5 mt-2 border-t border-gray-800/50 ${cls}">${esc(msg.subtype)} | cost: $${(msg.total_cost_usd || 0).toFixed(4)} | turns: ${msg.num_turns} | in: ${msg.usage?.input_tokens || 0} out: ${msg.usage?.output_tokens || 0}</div>`;
      } else if (msg.type === 'error') {
        flushProcess();
        html += `<div class="text-red-400 text-sm py-1">${esc(msg.error)}</div>`;
      }
    }
    flushProcess(true);
    return html;
  }

  // --- Live message rendering helpers ---

  // For single messages arriving via SSE (no grouping context)
  function renderSingleMsg(msg) {
    if (msg.type === 'system' && msg.subtype === 'init') {
      return `<div class="text-gray-600 text-xs py-1 border-b border-gray-800/50 mb-2">Session ${esc(msg.session_id?.slice(0, 8))} | model: ${esc(msg.model)} | cwd: ${esc(msg.cwd)} | tools: ${msg.tools?.length || 0}</div>`;
    }
    if (msg.type === 'user') {
        const content = msg.message?.content;
        if (typeof content === 'string') {
        return renderUserMessage(content);
      }
      if (Array.isArray(content)) {
        let html = '';
        for (const b of content) {
          if (b.type === 'text') html += renderUserMessage(b.text);
        }
        return html;
      }
      return '';
    }
    if (msg.type === 'result') {
      const cls = msg.subtype === 'success' ? 'text-cyan-400/70' : 'text-red-400/70';
      return `<div class="text-xs py-1.5 mt-2 border-t border-gray-800/50 ${cls}">${esc(msg.subtype)} | cost: $${(msg.total_cost_usd || 0).toFixed(4)} | turns: ${msg.num_turns} | in: ${msg.usage?.input_tokens || 0} out: ${msg.usage?.output_tokens || 0}</div>`;
    }
    if (msg.type === 'error') {
      return `<div class="text-red-400 text-sm py-1">${esc(msg.error)}</div>`;
    }
    return '';
  }

  // Check if user message has only tool_results
  function isToolResultOnly(msg) {
    if (msg.type !== 'user') return false;
    const c = msg.message?.content;
    return Array.isArray(c) && c.length > 0 && c.every(b => b.type === 'tool_result');
  }

  // Expose for streaming templates
  window.R = { renderMd, renderToolUse };

  // --- Alpine component ---

  Alpine.data('messages', () => ({
    streaming: { text: '', blocks: [], _toolName: '', _toolInput: '', _toolId: '' },

    init() {
      window.addEventListener('msg:load', (e) => this.loadHistory(e.detail));
      window.addEventListener('msg:append', (e) => this.appendMsg(e.detail));
      window.addEventListener('msg:clear', () => this.clear());
      window.addEventListener('msg:stream', (e) => this.handleStreamEvent(e.detail));
      window.addEventListener('msg:reset-stream', () => this.resetStreaming());
    },

    loadHistory(msgs) {
      this.$refs.rendered.innerHTML = renderHistory(msgs);
      this.scrollBottom();
    },

    appendMsg(msg) {
      // Tool results: insert output into corresponding tool items
      if (isToolResultOnly(msg)) {
        for (const block of msg.message.content) {
          if (block.type === 'tool_result' && block.tool_use_id) {
            this.insertToolResult(block);
          }
        }
        this.scrollBottom();
        return;
      }

      // Assistant with tools: merge into existing tool group or create new
      if (msg.type === 'assistant' && Array.isArray(msg.message?.content)) {
        const textBlocks = msg.message.content.filter(b => b.type === 'text' && b.text?.trim());
        const toolBlocks = msg.message.content.filter(b => b.type === 'tool_use');
        if (textBlocks.length === 0 && toolBlocks.length === 0) return;

        const process = this.ensureProcessContainer(true);
        const processBody = process.querySelector(':scope > div');

        for (const block of textBlocks) {
          processBody.insertAdjacentHTML('beforeend', renderAssistantMessage(block.text));
        }

        if (toolBlocks.length > 0) {
          // Try to merge into existing tool group (if it's the last element)
          const last = processBody.lastElementChild;
          let group = (last?.classList?.contains('tool-group')) ? last : null;

          if (!group) {
            processBody.insertAdjacentHTML('beforeend',
              `<details class="tool-details tool-group mt-0.5">
                <summary class="tool-group-summary text-xs cursor-pointer select-none">0 tools</summary>
                <div class="ml-1 border-l border-gray-800/30 pl-2"></div>
              </details>`);
            group = processBody.lastElementChild;
          }

          const container = group.querySelector(':scope > div');
          for (const block of toolBlocks) {
            container.insertAdjacentHTML('beforeend', renderToolItem(block, null));
          }
          const count = container.children.length;
          group.querySelector('summary').textContent = `${count} tool${count > 1 ? 's' : ''}`;
        }

        this.scrollBottom();
        return;
      }

      // Everything else: render normally
      this.removeEmptyTrailingProcess();
      this.collapseProcessDetails();
      const html = renderSingleMsg(msg);
      if (html) this.$refs.rendered.insertAdjacentHTML('beforeend', html);
      this.scrollBottom();
    },

    ensureProcessContainer(open = false) {
      const last = this.$refs.rendered.lastElementChild;
      if (last?.classList?.contains('process-details')) {
        if (open) last.open = true;
        return last;
      }
      this.$refs.rendered.insertAdjacentHTML('beforeend',
        `<details${open ? ' open' : ''} class="process-details mt-0.5">
          <summary class="process-summary text-xs cursor-pointer select-none">process</summary>
          <div class="process-body"></div>
        </details>`);
      return this.$refs.rendered.lastElementChild;
    },

    collapseProcessDetails() {
      this.$refs.rendered.querySelectorAll('.process-details[open]').forEach((details) => {
        details.open = false;
      });
    },

    removeEmptyTrailingProcess() {
      const last = this.$refs.rendered.lastElementChild;
      if (!last?.classList?.contains('process-details')) return;
      const body = last.querySelector(':scope > .process-body');
      if (!body) return;
      if (body.children.length === 0 && !body.textContent?.trim()) last.remove();
    },

    insertToolResult(block) {
      const el = this.$refs.rendered.querySelector(`[data-tool-id="${block.tool_use_id}"]`);
      if (!el) return;

      const { outputHtml, outputSize, hasError } = getResultOutput(block);
      if (!outputHtml && !hasError) return;

      const sizeLabel = outputSize > 0 ? ` <span class="tool-meta font-normal">${sizeStr(outputSize)}</span>` : '';
      const errorBadge = hasError ? ` <span class="text-red-400 font-normal">error</span>` : '';
      const toolLineHtml = el.querySelector('.tool-line')?.innerHTML || '';

      const details = document.createElement('details');
      details.className = 'tool-details';
      details.setAttribute('data-tool-id', block.tool_use_id);
      details.innerHTML = `<summary class="tool-line text-xs py-0.5 cursor-pointer select-none">${toolLineHtml}${sizeLabel}${errorBadge}</summary>
        <div class="ml-2 border-l border-gray-800/50 pl-2 max-h-60 overflow-y-auto tool-output text-xs">${outputHtml}</div>`;
      el.replaceWith(details);
    },

    clear() {
      if (this.$refs.rendered) this.$refs.rendered.innerHTML = '';
      this.resetStreaming();
    },

    resetStreaming() {
      this.streaming = { text: '', blocks: [], _toolName: '', _toolInput: '', _toolId: '' };
    },

    handleStreamEvent(event) {
      if (!event) return;
      if (event.type === 'content_block_start') {
        const cb = event.content_block;
        if (cb?.type === 'text') {
          if (this.streaming.text) {
            this.streaming.blocks.push({ type: 'text', text: this.streaming.text });
            this.streaming.text = '';
          }
        } else if (cb?.type === 'tool_use') {
          if (this.streaming.text) {
            this.streaming.blocks.push({ type: 'text', text: this.streaming.text });
            this.streaming.text = '';
          }
          this.streaming._toolName = cb.name;
          this.streaming._toolInput = '';
          this.streaming._toolId = cb.id;
        }
      } else if (event.type === 'content_block_delta') {
        const d = event.delta;
        if (d?.type === 'text_delta') this.streaming.text += d.text;
        else if (d?.type === 'input_json_delta') this.streaming._toolInput += d.partial_json;
      } else if (event.type === 'content_block_stop') {
        if (this.streaming._toolName) {
          let input = {};
          try { input = JSON.parse(this.streaming._toolInput || '{}'); } catch {}
          this.streaming.blocks.push({
            type: 'tool_use', name: this.streaming._toolName, input, id: this.streaming._toolId,
          });
          this.streaming._toolName = '';
          this.streaming._toolInput = '';
          this.streaming._toolId = '';
        }
      }
      this.scrollBottom();
    },

    scrollBottom() {
      this.$nextTick(() => { this.$el.scrollTop = this.$el.scrollHeight; });
    },
  }));
});

/*
# Message Rendering Module (renderer.js)

Alpine.js component responsible for all message display in Agent Link.

## Architecture

Parent app (index.html) communicates via window events:
  msg:load    {msgs}   — Load history (full message array, grouped rendering)
  msg:append  {msg}    — Append a single live message
  msg:clear            — Clear all messages
  msg:stream  {event}  — Handle SSE stream event (typing, tool input)
  msg:reset-stream     — Reset streaming state

The component manages two rendering paths:
1. History: renderHistory(msgs) processes the full array, groups tools across
   consecutive assistant messages, and inlines tool results via resultMap.
   Output is one innerHTML assignment for performance.
2. Live: appendMsg(msg) handles individual messages. Assistant tool_use blocks
   merge into the last tool-group element. Tool results replace their
   corresponding tool items via data-tool-id DOM lookup.

## Tool Grouping

Messages from the SDK alternate: user → assistant(tool_use) → user(tool_result) → ...
Between two user text prompts, all tool_use blocks are merged into one
collapsible "<N> tools" group. This avoids showing repeated "1 tool" sections.

In history mode, a linear scan accumulates tool_use blocks into `pendingTools`,
flushing them as a group when text content or a new user prompt appears.

In live mode, appendMsg checks if the last rendered element is a `.tool-group`
and appends to it; otherwise creates a new group.

## Tool Result Inlining

Each tool_use has an `id`; each tool_result has a matching `tool_use_id`.
- History: resultMap (tool_use_id → block) built upfront, passed to renderToolItem.
- Live: insertToolResult finds `[data-tool-id="..."]`, replaces the plain div
  with a <details> element containing the output.

The tool line itself is the <summary>, so expanding/collapsing output is done
directly on the tool line — no separate nested "output" element.

## Tool-Specific Rendering

renderToolUse(name, input) returns formatted HTML per tool type:
  Bash       — "$ <command>" with line count
  Read/Write/Edit — colored label + file path
  Grep/Glob  — pattern display
  ToolSearch  — query
  WebFetch   — truncated URL
  WebSearch   — quoted query
  Agent      — prompt preview
  Skill      — skill name + args
  MCP tools  — last segment of __ -delimited name

## Collapsibility

- Tool groups (≤5 tools): open by default. >5: collapsed.
- Tool output (≤200 chars, no error): open. Otherwise collapsed.
- Native <details>/<summary> elements — no JS needed, works in pre-rendered HTML.

## Streaming

The `streaming` reactive object tracks in-progress content:
  .text       — current text being typed
  .blocks[]   — finalized blocks (text/tool_use) of current response
  ._toolName  — active tool being streamed
  ._toolInput — partial JSON of active tool input
  ._toolId    — id of active tool

Alpine templates in index.html render streaming state reactively.
On content_block_stop, tool input is parsed and pushed to blocks.
On assistant message finalization (msg:reset-stream + msg:append),
streaming is cleared and the message joins the rendered DOM.
*/
