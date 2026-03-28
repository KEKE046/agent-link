# Claude Agent SDK (Claude Code SDK) 参考文档

基于官方文档整理，覆盖 TypeScript (`@anthropic-ai/claude-agent-sdk`) 和 Python (`claude_agent_sdk`) 两个 SDK。

---

## 1. 如何继续一个 Session

SDK 提供三种方式恢复会话：

### 方式一：通过 session ID 恢复

```typescript
// TypeScript
for await (const message of query({
  prompt: "继续之前的任务",
  options: { resume: sessionId }
})) {
  // 处理消息
}
```

```python
# Python
async for message in query(
    prompt="继续之前的任务",
    options=ClaudeAgentOptions(resume=session_id)
):
    pass
```

### 方式二：自动继续最近的 session

```typescript
// TypeScript - 自动恢复当前 cwd 下最近的 session
for await (const message of query({
  prompt: "下一个任务",
  options: { continue: true }
})) {}
```

```python
# Python
async for message in query(
    prompt="下一个任务",
    options=ClaudeAgentOptions(continue_conversation=True)
):
    pass
```

### 方式三：Fork session（分叉对话）

```typescript
for await (const message of query({
  prompt: "换一种方案",
  options: {
    resume: sessionId,
    forkSession: true  // 基于已有历史创建新 session
  }
})) {}
```

### 获取 Session ID

```typescript
for await (const message of query({ prompt: "..." })) {
  if (message.type === "system" && message.subtype === "init") {
    const sessionId = message.session_id; // 最早可获取的时机
  }
  if (message.type === "result") {
    const sessionId = message.session_id; // 始终存在
  }
}
```

### V2 API（Preview/Unstable）

```typescript
const session = await unstable_v2_resumeSession(sessionId);
for await (const message of session.stream({ prompt: "继续" })) {}
```

---

## 2. 继续 Session 的最低代价

### 核心结论：Resume 不会重新发送完整历史

- 完整上下文从磁盘加载（`~/.claude/projects/<encoded-cwd>/<session-id>.jsonl`）
- Resume 时只发送**新 prompt + 加载的上下文**
- **不会**为之前的 turn 重复计费

### Token 消耗对比

| 场景 | Token 开销 | 说明 |
|------|-----------|------|
| 全新 session | 完整开销 | 每次 Claude 评估 + 工具输出 |
| Resume session | 仅新 prompt + 增量 | 低得多；之前的上下文已在客户端缓存 |
| 手动传入历史 | 完整重传 | 浪费；每次都发送历史 |
| 启用 Prompt Caching | 缓存 token 仅 10% 价格 | 内建；重复前缀自动缓存 |

### 最佳实践

```typescript
// 1. 初始查询
let sessionId: string;
for await (const msg of query({
  prompt: "分析 auth 模块",
  options: { allowedTools: ["Read", "Glob", "Grep"] }
})) {
  if (msg.type === "system" && msg.subtype === "init") {
    sessionId = msg.session_id;
  }
}

// 2. Resume - 只为新 prompt + 新推理付费
for await (const msg of query({
  prompt: "重构为 JWT",
  options: { resume: sessionId }
})) {
  if (msg.type === "result") {
    console.log(`Cost: $${msg.total_cost_usd}`);
  }
}
```

### 累计成本追踪

每次 `query()` 调用（即使是 resume）的 `ResultMessage` 只报告**该次调用**的成本，需手动累加：

```typescript
let totalCost = 0;
for await (const msg of query({ prompt: "...", options: { resume: sessionId } })) {
  if (msg.type === "result") totalCost += msg.total_cost_usd ?? 0;
}
```

---

## 3. 如何创建 Embedded 工具

工具通过 MCP Server 模式嵌入，使用 `tool()` + `createSdkMcpServer()` 组合。

### TypeScript

```typescript
import { tool, createSdkMcpServer } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";

// 1. 定义工具 - 使用 Zod schema
const getTemperature = tool(
  "get_temperature",                                    // 工具名
  "Get the current temperature at a location",          // 描述
  {                                                      // 输入 schema（Zod）
    latitude: z.number().describe("Latitude coordinate"),
    longitude: z.number().describe("Longitude coordinate")
  },
  async (args) => {                                      // handler
    const response = await fetch(`https://api.open-meteo.com/v1/forecast?latitude=${args.latitude}&longitude=${args.longitude}&current=temperature_2m`);
    const data = await response.json();
    return {
      content: [{ type: "text", text: `Temperature: ${data.current.temperature_2m}°F` }]
    };
  },
  {
    annotations: {
      readOnlyHint: true  // 可并行执行
    }
  }
);

// 2. 包装为 MCP Server
const weatherServer = createSdkMcpServer({
  name: "weather",
  version: "1.0.0",
  tools: [getTemperature]
});

// 3. 传入 query()
for await (const message of query({
  prompt: "What's the temperature in SF?",
  options: {
    mcpServers: { weather: weatherServer },
    allowedTools: ["mcp__weather__get_temperature"]  // 命名规则: mcp__{server}__{tool}
  }
})) {}
```

### Python

```python
from claude_agent_sdk import tool, create_sdk_mcp_server

@tool("get_temperature", "Get temperature", {"latitude": float, "longitude": float})
async def get_temperature(args: dict) -> dict:
    # ...
    return {"content": [{"type": "text", "text": f"Temperature: {temp}°F"}]}

weather_server = create_sdk_mcp_server(name="weather", version="1.0.0", tools=[get_temperature])

async for message in query(
    prompt="...",
    options=ClaudeAgentOptions(
        mcp_servers={"weather": weather_server},
        allowed_tools=["mcp__weather__get_temperature"]
    )
):
    pass
```

### 工具返回值 Schema

```typescript
interface CallToolResult {
  content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }     // base64
    | { type: "resource"; resource: { uri: string; text?: string; blob?: string; mimeType?: string } }
  >;
  isError?: boolean;  // 设为 true 表示工具执行失败，循环继续
}
```

### 工具注解（Annotations）

```typescript
tool("read_file", "Read a file", { path: z.string() }, handler, {
  annotations: {
    readOnlyHint: true,       // 只读，可与其他只读工具并行
    idempotentHint: true,     // 幂等，重复调用无副作用
    destructiveHint: false,   // 非破坏性
    openWorldHint: false      // 封闭域（不调用外部 API）
  }
});
```

### 工具命名规则

注册到 MCP Server 后，工具名为 `mcp__{server_name}__{tool_name}`。

---

## 4. 事件类型及 Schema

SDK 在运行期间发出 5 种核心消息类型：

### 4.1 SystemMessage

```typescript
interface SDKSystemMessage {
  type: "system";
  subtype: "init" | "compact_boundary";
  uuid: string;
  session_id: string;

  // "init" 子类型特有字段：
  agents?: string[];
  apiKeySource: string;
  betas?: string[];
  claude_code_version: string;
  cwd: string;
  tools: string[];
  mcp_servers: Array<{ name: string; status: string }>;
  model: string;
  permissionMode: string;
  slash_commands: string[];
  output_style: string;
  skills: string[];
  plugins: Array<{ name: string; path: string }>;

  // "compact_boundary" 子类型特有：
  compact_metadata?: {
    trigger: "manual" | "auto";
    pre_tokens: number;
  };
}
```

### 4.2 AssistantMessage

```typescript
interface AssistantMessage {
  type: "assistant";
  message: {
    content: Array<
      | { type: "text"; text: string }          // 文本块
      | { type: "tool_use"; id: string; name: string; input: Record<string, any> }  // 工具调用
    >;
  };
  uuid: string;
  session_id: string;
}
```

### 4.3 UserMessage

```typescript
interface UserMessage {
  type: "user";
  message: {
    content: Array<
      | { type: "tool_result"; tool_use_id: string; content: Array<TextContent | ImageContent | ResourceContent>; is_error?: boolean }
      | { type: "text"; text: string }
    >;
  };
  uuid: string;
  session_id: string;
}
```

### 4.4 StreamEvent（仅 `includePartialMessages: true` 时）

```typescript
interface SDKPartialAssistantMessage {
  type: "stream_event";
  event: BetaRawMessageStreamEvent;  // Anthropic SDK 原始事件类型
  parent_tool_use_id: string | null;
  uuid: string;
  session_id: string;
}
// event 子类型：content_block_start, content_block_delta, message_delta, message_stop
```

### 4.5 ResultMessage（最终消息）

```typescript
interface SDKResultMessage {
  type: "result";
  subtype:
    | "success"
    | "error_max_turns"
    | "error_max_budget_usd"
    | "error_during_execution"
    | "error_max_structured_output_retries";

  result?: string;                // 仅 success 时存在
  total_cost_usd: number;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
  num_turns: number;
  session_id: string;
  stop_reason: string | null;    // "end_turn", "max_tokens", "refusal" 等
  uuid: string;
}
```

### Hook Events（额外可观测事件）

```typescript
type HookEvent =
  | "PreToolUse" | "PostToolUse" | "PostToolUseFailure"
  | "UserPromptSubmit" | "Stop"
  | "SubagentStart" | "SubagentStop"
  | "PreCompact" | "Notification"
  | "SessionStart" | "SessionEnd"    // TS only
  | "Setup"                          // TS only
  | "TeammateIdle" | "TaskCompleted" // TS only
  | "ConfigChange"                   // TS only
  | "WorktreeCreate" | "WorktreeRemove"; // TS only
```

### 消息处理示例

```typescript
for await (const message of query({ prompt: "..." })) {
  switch (message.type) {
    case "system":
      if (message.subtype === "init") console.log(`Session: ${message.session_id}`);
      break;
    case "assistant":
      const tools = message.message.content.filter(b => b.type === "tool_use");
      console.log(`Claude called ${tools.length} tool(s)`);
      break;
    case "stream_event":
      if (message.event.type === "content_block_delta") console.log(message.event.delta);
      break;
    case "result":
      console.log(`${message.subtype}: $${message.total_cost_usd}`);
      break;
  }
}
```

---

## 5. 列出所有 Session 及获取元数据

### TypeScript API

```typescript
import { listSessions, getSessionInfo, getSessionMessages, renameSession, tagSession } from "@anthropic-ai/claude-agent-sdk";

// 列出 sessions
const sessions = await listSessions({
  dir: "/path/to/project",       // 可选
  limit: 10,
  includeWorktrees: true
});

sessions.forEach(s => {
  console.log({
    sessionId: s.sessionId,       // UUID
    summary: s.summary,           // 显示标题或自动摘要
    lastModified: s.lastModified, // 毫秒时间戳
    fileSize: s.fileSize,         // JSONL 文件大小（字节）
    customTitle: s.customTitle,   // 用户设置的标题
    firstPrompt: s.firstPrompt,  // 第一条用户 prompt
    gitBranch: s.gitBranch,       // session 结束时的 git 分支
    cwd: s.cwd,                   // 工作目录
    tag: s.tag,                   // 用户标签
    createdAt: s.createdAt        // 创建时间戳
  });
});

// 获取单个 session 元数据
const info = await getSessionInfo("session-uuid", { dir: "/path/to/project" });

// 读取 session 消息
const messages = await getSessionMessages("session-uuid", { dir: "/path/to/project", limit: 20, offset: 0 });

// 重命名 / 打标签
await renameSession("session-uuid", "My Title", { dir: "/path/to/project" });
await tagSession("session-uuid", "important", { dir: "/path/to/project" });
await tagSession("session-uuid", null, { dir: "/path/to/project" }); // 清除标签
```

### Python API

```python
from claude_agent_sdk import list_sessions, get_session_info, get_session_messages, rename_session, tag_session

sessions = await list_sessions(dir="/path/to/project", limit=10)
info = await get_session_info("session-uuid", dir="/path/to/project")
messages = await get_session_messages("session-uuid", dir="/path/to/project", limit=20)
await rename_session("session-uuid", "New Title", dir="/path/to/project")
await tag_session("session-uuid", "important", dir="/path/to/project")
```

### Session 元数据字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `sessionId` | `string` (UUID) | 唯一标识符，用于 resume |
| `summary` | `string` | 显示标题：自定义标题 > 自动摘要 > 第一条 prompt |
| `lastModified` | `number` | 最后修改时间（毫秒时间戳） |
| `fileSize` | `number \| undefined` | JSONL 文件大小（字节） |
| `customTitle` | `string \| undefined` | 用户自定义标题 |
| `firstPrompt` | `string \| undefined` | 首条用户 prompt |
| `gitBranch` | `string \| undefined` | session 结束时的 git 分支 |
| `cwd` | `string \| undefined` | 工作目录 |
| `tag` | `string \| undefined` | 用户标签 |
| `createdAt` | `number \| undefined` | 创建时间戳 |

### Session 存储位置

```
~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
```

`<encoded-cwd>` 是绝对路径，所有非字母数字字符替换为 `-`。例如：
- `/home/user/agent-link` → `-home-user-agent-link`

每个 session 文件是 JSONL 格式，包含所有 turn、工具调用和结果。

---

## 6. 切换 Session 时原 Session 是否需要保持

### 结论：不需要。Session 是基于磁盘的，不是基于进程的。

```
┌────────────────────────────────┐
│ 当前进程（可以退出）            │
│  ├─ 创建/继续 session          │
│  ├─ 流式处理消息               │
│  └─ 保存 session 到磁盘        │
└────────────────────────────────┘
                ↓
   Session 存储于磁盘：
   ~/.claude/projects/<encoded-cwd>/<session-id>.jsonl
                ↓
   任何未来的进程都可以 resume 它
```

- 进程退出后 session 文件仍在磁盘上
- 进程崩溃/中断后仍可 resume
- 多窗口/多 agent 可以独立操作不同 session
- 一个窗口退出不影响其他窗口

### 注意事项

1. **文件变更是真实的** — session 保存对话历史，不是文件系统快照。编辑过的文件即使 session 结束也保持修改。
2. **Session 文件必须在同一台机器上**（或手动复制）。
3. **跨机器恢复** — 对于 CI/容器/无服务器环境，建议将结果捕获为应用状态传入新 session，而非复制 session 文件。

---

## 7. 继续 Session 是否会造成更多 Token 调用

### 结论：不会为之前的 turn 额外消耗 token

Resume 时只为以下内容付费：
- **新 prompt**
- **新的工具调用及其结果**
- **Claude 的新推理和输出**

**不会**重复付费：
- 之前的对话 turn
- 之前读取的文件内容
- 之前执行的工具调用

### Prompt Caching 加成（自动）

Resume 同一 session 时：
- System prompt 和工具定义保持不变
- 自动被 API **prompt-cached**
- 缓存内容仅收取 **10% 的输入 token 价格**

```
首次 Resume: system prompt + tools 完整计费（之后被缓存）
第二次 Resume: 缓存的 system prompt + tools 仅 10% 价格
第三次 Resume: 同上
...
```

### Session Compaction（自动压缩）

当上下文窗口接近容量时，SDK 自动压缩旧历史：

```typescript
for await (const msg of query({ prompt: "...", options: { maxTurns: 100 } })) {
  if (msg.type === "system" && msg.subtype === "compact_boundary") {
    console.log("对话已压缩以腾出空间");
    // 旧 turn 被替换为摘要，保留关键决策和上下文
  }
}
```

---

## 速查表

| 问题 | 答案 |
|------|------|
| 通过 ID 恢复？ | `options: { resume: sessionId }` |
| 自动继续？ | `options: { continue: true }` (TS) / `continue_conversation=True` (Python) |
| Resume 的 token 成本？ | 仅新 prompt + 新工具调用；之前的上下文被缓存（~10% 价格） |
| 列出 sessions？ | `listSessions()` (TS) / `list_sessions()` (Python) |
| Session 存储？ | `~/.claude/projects/<encoded-cwd>/<session-id>.jsonl` |
| 元数据？ | sessionId, summary, lastModified, customTitle, cwd, tag, gitBranch, createdAt |
| 自定义工具？ | `tool()` + `createSdkMcpServer()` |
| 工具返回格式？ | `{ content: [{type: "text" \| "image" \| "resource", ...}], isError?: boolean }` |
| 核心事件？ | SystemMessage, AssistantMessage, UserMessage, StreamEvent, ResultMessage |
| 切换时原 session 需保持？ | 不需要，基于磁盘 |
| Fork session？ | `options: { resume: sessionId, forkSession: true }` |

## 参考资料

- [Sessions - Claude API Docs](https://platform.claude.com/docs/en/agent-sdk/sessions)
- [TypeScript SDK Reference](https://platform.claude.com/docs/en/agent-sdk/typescript)
- [Custom Tools](https://platform.claude.com/docs/en/agent-sdk/custom-tools)
- [Agent Loop](https://platform.claude.com/docs/en/agent-sdk/agent-loop)
- [Cost Tracking](https://platform.claude.com/docs/en/agent-sdk/cost-tracking)
- [@anthropic-ai/claude-agent-sdk - npm](https://www.npmjs.com/package/@anthropic-ai/claude-agent-sdk)
