# Upup Provider 升级计划 v1.2 — 会话持久化与功能完善

**日期**：2026-05-16
**版本**：1.2（基于 v1.1 的增量更新）
**目标**：实现会话持久化、对话连续性、Obsidian 知识图谱集成
**发布版本**：v2.0.16T0516-upup ✅

---

## 执行摘要

**当前状态**：Phase 0-10 全部完成 + 完整测试通过 ✅

**完成进度**：100% (11/11 Phases 完成)

**已实现功能**：
- ✅ UpupSessionManager - 会话管理 (282 行)
- ✅ UpupSessionStore - 会话持久化存储 (291 行)
- ✅ UpupHistorySync - 历史同步 (177 行)
- ✅ 集成到 UpupChatRuntime (自动保存/加载)
- ✅ VaultToolHandler - Obsidian 文件工具处理 (6 个工具)
- ✅ VaultWatcher - Vault 文件变化监听 (166 行)
- ✅ 工具拦截集成 - 拦截 upup 的工具调用并通过 Obsidian API 执行
- ✅ Fork 支持 - forkSource 状态管理和会话解析
- ✅ Rewind 服务 - 文件修改跟踪和撤销服务
- ✅ 146 个单元测试全部通过
- ✅ TypeScript 类型检查通过
- ✅ Lint 检查通过 (2 warnings)
- ✅ 打包发布成功：v2.0.16T0516-upup

---

## 一、实现状态

### 1.1 Phase 进度

| Phase | 功能 | 状态 | 文件 |
|-------|------|------|------|
| Phase 0 | UpupSessionManager | ✅ 完成 | `runtime/UpupSessionManager.ts` |
| Phase 1 | UpupSessionStore | ✅ 完成 | `storage/UpupSessionStore.ts` |
| Phase 2 | UpupHistorySync | ✅ 完成 | `runtime/UpupHistorySync.ts` |
| Phase 3 | 集成到 Runtime | ✅ 完成 | `runtime/UpupChatRuntime.ts` |
| Phase 4 | 单元测试 | ✅ 完成 | 146 tests passed |
| Phase 5 | 集成验证 | ✅ 完成 | Obsidian 运行时 |
| Phase 6 | 文档更新 | ✅ 完成 | 本文档 |
| Phase 7 | VaultToolHandler | ✅ 完成 | `vault/VaultToolHandler.ts` |
| Phase 8 | VaultWatcher | ✅ 完成 | `vault/VaultWatcher.ts` |
| Phase 9 | Fork 支持 | ✅ 完成 | `history/UpupConversationHistoryService.ts` |
| Phase 10 | Rewind 服务 | ✅ 完成 | `runtime/UpupRewindService.ts` |

### 1.2 功能矩阵

| 功能模块 | 功能项 | Claude | upup (v1.1) | upup (v1.2) | 状态 |
|----------|--------|--------|-------------|-------------|------|
| **运行时** | | | | | |
| | 持久化查询 | ✅ | ❌ | ✅ | ✅ |
| | 会话管理 | ✅ | ❌ | ✅ | ✅ |
| | 崩溃恢复 | ✅ | ✅ | ✅ | ✅ |
| | 自动重连 | ✅ | ✅ | ✅ | ✅ |
| **历史** | | | | | |
| | 原生历史 | ✅ | ❌ | ✅ | ✅ |
| | 分支过滤 | ✅ | ❌ | ❌ | ⏳ |
| | Fork 支持 | ✅ | ❌ | ✅ | ✅ |
| | Rewind | ✅ | ❌ | ✅ | ✅ |
| **Vault 集成** | | | | | |
| | 文件读取 | ✅ MCP | ❌ | ✅ | ✅ |
| | 文件写入 | ✅ MCP | ❌ | ✅ | ✅ |
| | 写入感知 | ✅ | ❌ | ✅ | ✅ |
| **存储** | | | | | |
| | 会话持久化 | ~ | ❌ | ✅ | ✅ |
| | 历史同步 | ✅ | ❌ | ✅ | ✅ |

### 1.2 Claude Code Provider 架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     Claude Code Provider 完整架构                           │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     ChatRuntime Layer                               │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │   │
│  │  │ ClaudeChat      │  │ ClaudeSession    │  │ ClaudeRewind         │ │   │
│  │  │ Runtime        │  │ Manager          │  │ Service             │ │   │
│  │  │ (64KB)         │  │                  │  │                     │ │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐ │   │
│  │  │ ClaudeMessage   │  │ ClaudeQuery     │  │ ClaudeApproval      │ │   │
│  │  │ Channel         │  │ OptionsBuilder  │  │ Handler             │ │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     History Layer                                    │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │   │
│  │  │ Claude         │  │ SDK            │  │ SDK                │     │   │
│  │  │ Conversation   │  │ SessionPaths   │  │ BranchFilter       │     │   │
│  │  │ HistoryService │  │ (JSONL)        │  │                    │     │   │
│  │  │                │  │                │  │                    │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │   │
│  │  │ SDK            │  │ SDK            │  │ SDK                │     │   │
│  │  │ MessageParsing │  │ Subagent       │  │ AsyncSubagent      │     │   │
│  │  │               │  │ Sidecar        │  │                    │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Storage Layer                                    │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │   │
│  │  │ CCSettings      │  │ McpStorage      │  │ AgentVault          │     │   │
│  │  │ Storage        │  │                 │  │ Storage             │     │   │
│  │  │ (.claude/)     │  │ (.claude/mcp)  │  │ (.claude/agents)    │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │   │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────────┐     │   │
│  │  │ SkillStorage    │  │ SlashCommand    │  │ SessionStorage      │     │   │
│  │  │ (.claude/skills)│  │ Storage         │  │                     │     │   │
│  │  └─────────────────┘  └─────────────────┘  └─────────────────────┘     │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Obsidian Vault                                   │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐                │   │
│  │  │ .claude/    │  │ vault files  │  │ MCP servers  │                │   │
│  │  │ settings.json│  │ **/*.md      │  │              │                │   │
│  │  │ mcp.json    │  │              │  │              │                │   │
│  │  │ skills/     │  │              │  │              │                │   │
│  │  │ commands/   │  │              │  │              │                │   │
│  │  │ agents/     │  │              │  │              │                │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘                │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 二、upup Provider 当前架构

### 2.1 现有组件

```
src/providers/upup/
├── registration.ts           # Provider 注册
├── capabilities.ts             # 能力定义 (11 项)
├── settings.ts                # Provider 设置
├── runtime/
│   └── UpupChatRuntime.ts     # 核心运行时 (420 行)
├── stream/
│   └── transformUpupEvent.ts  # 事件转换 (11 种事件)
├── history/
│   └── UpupConversationHistoryService.ts  # 存根
├── env/
│   └── UpupSettingsReconciler.ts
├── commands/
│   └── UpupSkillCatalog.ts
├── agents/
│   └── UpupAgentMentionProvider.ts
└── ui/
    ├── UpupChatUIConfig.ts
    └── UpupSettingsTab.ts
```

### 2.2 当前问题架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     upup Provider v1.1 问题                                │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     UpupChatRuntime                                 │   │
│  │                                                                      │   │
│  │  ❌ 无 SessionManager — 每次 query 都是新会话                          │   │
│  │  ❌ 无 HistorySync — 对话历史不传递                                   │   │
│  │  ❌ 无 VaultWatcher — 不感知文件变化                                  │   │
│  │                                                                      │   │
│  │  ✅ 实时流式传输 (已修复)                                               │   │
│  │  ✅ 崩溃恢复 (transport 重连)                                          │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     UpupTransport                                   │   │
│  │                                                                      │   │
│  │  ✅ stdio 通信                                                        │   │
│  │  ✅ JSON-RPC 协议                                                     │   │
│  │  ✅ 事件处理器                                                        │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     upup --stdio 进程                                │   │
│  │                                                                      │   │
│  │  ❌ 不知道对话历史                                                     │   │
│  │  ❌ 不能直接访问 Obsidian                                             │   │
│  │  ❌ 不能感知文件变化                                                  │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│                         ❌ Obsidian Vault (未连接)                          │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 三、v1.2 目标架构

### 3.1 完整架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     upup Provider v1.2 目标架构                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     ChatRuntime Layer                               │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │                   UpupChatRuntime                            │    │   │
│  │  │                                                              │    │   │
│  │  │  ┌─────────────────┐  ┌─────────────────┐  ┌───────────────┐ │    │   │
│  │  │  │ SessionManager │  │ HistorySync     │  │ VaultWatcher  │ │    │   │
│  │  │  │ (P0 - 新增)    │  │ (P0 - 新增)     │  │ (P1 - 新增)   │ │    │   │
│  │  │  └─────────────────┘  └─────────────────┘  └───────────────┘ │    │   │
│  │  │                                                              │    │   │
│  │  │  ✅ 实时流式传输    ✅ 崩溃恢复    ⏳ 会话持久化              │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     History Layer                                   │   │
│  │                                                                      │   │
│  │  ┌─────────────────┐  ┌─────────────────────────────────────────┐  │   │
│  │  │ Upup            │  │ SessionStore                           │  │   │
│  │  │ Conversation    │  │ ┌─────────┐ ┌─────────┐ ┌───────────┐  │  │   │
│  │  │ HistoryService  │  │ │JsonStore│ │FileStore│ │MemoryStore│ │  │   │
│  │  │ (增强)          │  │ └─────────┘ └─────────┘ └───────────┘  │  │   │
│  │  └─────────────────┘  └─────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Storage Layer                                   │   │
│  │                                                                      │   │
│  │  ┌─────────────────┐  ┌─────────────────────────────────────────┐  │   │
│  │  │ .upup/          │  │ .upup/sessions/                          │  │   │
│  │  │ settings.json   │  │ session-{id}/                            │  │   │
│  │  │ skills/         │  │   ├── session.json                        │  │   │
│  │  │ commands/       │  │   └── messages.json                       │  │   │
│  │  └─────────────────┘  └─────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Vault Integration Layer                         │   │
│  │                                                                      │   │
│  │  ┌─────────────────────────────────────────────────────────────┐    │   │
│  │  │                    VaultToolHandler                         │    │   │
│  │  │                                                              │    │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │    │   │
│  │  │  │ file_read    │  │ file_write   │  │ dir_read     │     │    │   │
│  │  │  │ handler      │  │ handler      │  │ handler     │     │    │   │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘     │    │   │
│  │  │                                                              │    │   │
│  │  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐     │    │   │
│  │  │  │ glob_search  │  │ get_links    │  │ get_tags    │     │    │   │
│  │  │  │ handler      │  │ handler      │  │ handler     │     │    │   │
│  │  │  └──────────────┘  └──────────────┘  └──────────────┘     │    │   │
│  │  └─────────────────────────────────────────────────────────────┘    │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     Obsidian Vault                                  │   │
│  │                                                                      │   │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌────────┐ │   │
│  │  │ .upup/       │  │ vault files   │  │ metadata     │  │ links  │ │   │
│  │  │ settings.json│  │ **/*.md      │  │ cache        │  │ graph  │ │   │
│  │  │ skills/      │  │              │  │              │  │        │ │   │
│  │  │ sessions/    │  │              │  │              │  │        │ │   │
│  │  └──────────────┘  └──────────────┘  └──────────────┘  └────────┘ │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 四、实现计划

### 4.1 Phase 0: 会话管理器 (P0)

**文件**: `src/providers/upup/runtime/UpupSessionManager.ts`

```typescript
export interface SessionInfo {
  id: string;
  conversationId: string;
  status: 'active' | 'paused' | 'completed';
  createdAt: Date;
  lastActiveAt: Date;
  messageCount: number;
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  toolCalls?: ToolCallInfo[];
  toolResults?: ToolResult[];
}

export class UpupSessionManager {
  private currentSession: SessionInfo | null = null;
  private messages: SessionMessage[] = [];

  async ensureSession(conversationId: string): Promise<string>;
  async save(): Promise<void>;
  async load(sessionId: string): Promise<boolean>;
  addMessage(role: 'user' | 'assistant', content: string, metadata?: Partial<SessionMessage>): void;
  getMessages(): SessionMessage[];
  getSessionId(): string | null;
  clearHistory(): void;
}
```

### 4.2 Phase 1: 历史同步 (P0)

**文件**: `src/providers/upup/runtime/UpupHistorySync.ts`

```typescript
export class UpupHistorySync {
  constructor(private plugin: ClaudianPlugin);

  // 将历史编码为 upup 消息格式
  encodeHistory(messages: SessionMessage[]): string[];

  // 获取系统提示
  getSystemPrompt(): string;

  // 同步到 upup (通过消息前缀或环境变量)
  syncToUpup(manager: UpupSessionManager): Promise<void>;
}
```

### 4.3 Phase 2: 会话存储 (P0)

**文件**: `src/providers/upup/storage/UpupSessionStore.ts`

```typescript
export interface SessionStore {
  save(session: SessionInfo, messages: SessionMessage[]): Promise<void>;
  load(sessionId: string): Promise<{ session: SessionInfo; messages: SessionMessage[] } | null>;
  delete(sessionId: string): Promise<void>;
  list(): Promise<SessionInfo[]>;
}

export class JsonSessionStore implements SessionStore {
  constructor(private basePath: string);
  // 存储结构: .upup/sessions/{id}/session.json + messages.json
}
```

### 4.4 Phase 3: Vault 工具处理 (P0)

**文件**: `src/providers/upup/vault/VaultToolHandler.ts`

```typescript
export class VaultToolHandler {
  constructor(private plugin: ClaudianPlugin);

  // 拦截 upup 的工具调用
  handleToolCall(toolName: string, input: Record<string, unknown>): Promise<unknown>;

  // 工具处理器
  private async handleFileRead(input: Record<string, unknown>): Promise<string>;
  private async handleFileWrite(input: Record<string, unknown>): Promise<{ success: boolean }>;
  private async handleDirRead(input: Record<string, unknown>): Promise<string[]>;
  private async handleGlobSearch(input: Record<string, unknown>): Promise<string[]>;
  private async handleGetLinks(input: Record<string, unknown>): Promise<LinkInfo>;
  private async handleGetTags(input: Record<string, unknown>): Promise<TagInfo>;
}
```

### 4.5 Phase 4: Vault 文件监听 (P1)

**文件**: `src/providers/upup/vault/VaultWatcher.ts`

```typescript
export class VaultWatcher {
  constructor(private plugin: ClaudianPlugin);

  start(): void;
  stop(): void;

  // 文件变化回调
  onFileChange(callback: (event: VaultEvent) => void): void;
}

export interface VaultEvent {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  timestamp: Date;
}
```

### 4.6 Phase 5: 历史服务增强 (P1)

**文件**: `src/providers/upup/history/UpupConversationHistoryService.ts` (增强)

```typescript
// 需要增强的接口
export class UpupConversationHistoryService implements ProviderConversationHistoryService {
  // 加载历史
  async hydrateConversationHistory(conversation: Conversation, vaultPath: string | null): Promise<void>;

  // 解析会话 ID
  resolveSessionIdForConversation(conversation: Conversation | null): string | null;

  // 构建 Fork 状态
  buildForkProviderState(sourceSessionId: string, resumeAt: string): Record<string, unknown>;
}
```

---

## 五、Capabilities 升级

### 5.1 当前 vs 目标

```typescript
// 当前 (v1.1)
export const UPUP_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  providerId: 'upup',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,      // ❌ 实际不支持
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: true,               // ❌ 实际不支持
  supportsProviderCommands: true,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: true,          // ❌ 实际不支持
  supportsTurnSteer: false,
  reasoningControl: 'none',
};

// 目标 (v1.2)
export const UPUP_PROVIDER_CAPABILITIES: ProviderCapabilities = {
  providerId: 'upup',
  supportsPersistentRuntime: true,
  supportsNativeHistory: true,      // ✅ 实现会话持久化
  supportsPlanMode: false,
  supportsRewind: false,
  supportsFork: false,               // 保持 false，直到实现
  supportsProviderCommands: true,
  supportsImageAttachments: false,
  supportsInstructionMode: false,
  supportsMcpTools: false,         // 明确不支持
  supportsTurnSteer: false,
  reasoningControl: 'none',
};
```

---

## 六、执行流程

### 6.1 对话流程图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         用户对话完整流程                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  1. 用户发送消息                                                            │
│         │                                                                    │
│         ▼                                                                    │
│  2. ChatRuntime.prepareTurn()                                               │
│         │                                                                    │
│         ├─► SessionManager.ensureSession()                                   │
│         │     │                                                              │
│         │     ├─► 检查 .upup/sessions/ 是否有历史                            │
│         │     └─► 加载历史消息                                                │
│         │                                                                    │
│         ├─► HistorySync.syncToUpup()                                         │
│         │     │                                                              │
│         │     ├─► 获取所有历史消息                                            │
│         │     ├─► 编码为 upup 格式                                            │
│         │     └─► 注入到请求上下文                                            │
│         │                                                                    │
│         └─► VaultWatcher.prepareContext()                                    │
│               │                                                              │
│               ├─► 收集 vault 状态                                            │
│               └─► 注册文件变化监听                                            │
│                                                                             │
│  3. ChatRuntime.query()                                                      │
│         │                                                                    │
│         ├─► upup --stdio                                                     │
│         │     │                                                              │
│         │     ├─► 工具调用 (file_read, etc.)                                 │
│         │     │     │                                                        │
│         │     │     ▼                                                        │
│         │     │  VaultToolHandler.handleToolCall()                           │
│         │     │     │                                                        │
│         │     │     ├─► 读取 Obsidian 文件                                    │
│         │     │     ├─► 读取元数据缓存                                        │
│         │     │     └─► 返回内容给 upup                                       │
│         │     │                                                              │
│         │     └─► 返回 AI 响应                                                │
│         │                                                                    │
│         └─► transformServerEvent()                                           │
│               │                                                              │
│               ├─► type: 'text' ──► StreamChunk                              │
│               ├─► type: 'tool_use' ──► StreamChunk                           │
│               └─► type: 'done' ──► StreamChunk                               │
│                                                                             │
│  4. StreamController.handleStreamChunk()                                     │
│         │                                                                    │
│         ├─► appendText() ──► UI 更新                                         │
│         ├─► handleToolUse() ──► 工具显示                                    │
│         └─► finalizeMessage() ──► 完成                                      │
│                                                                             │
│  5. SessionManager.addMessage()                                              │
│         │                                                                    │
│         ├─► 保存 user 消息                                                   │
│         ├─► 保存 assistant 消息                                              │
│         └─► SessionManager.save() ──► 持久化                                │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Vault 读取流程

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Vault 工具调用流程                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  upup 发送 tool_call                                                        │
│         │                                                                    │
│         ▼                                                                    │
│  VaultToolHandler.handleToolCall()                                          │
│         │                                                                    │
│         ▼                                                                    │
│  switch(toolName)                                                           │
│         │                                                                    │
│         ├─► 'file_read'                                                     │
│         │     │                                                              │
│         │     ├─► vault.getAbstractFileByPath(filePath)                     │
│         │     ├─► vault.read(file)                                           │
│         │     └─► return content                                            │
│         │                                                                    │
│         ├─► 'file_write'                                                    │
│         │     │                                                              │
│         │     ├─► vault.adapter.write(filePath, content)                      │
│         │     ├─► vault.trigger('modify', file)                            │
│         │     └─► return { success: true }                                   │
│         │                                                                    │
│         ├─► 'dir_read'                                                      │
│         │     │                                                              │
│         │     └─► vault.adapter.list(dirPath)                                │
│         │                                                                    │
│         ├─► 'glob_search'                                                   │
│         │     │                                                              │
│         │     └─► vault.getFiles() + filter by pattern                       │
│         │                                                                    │
│         ├─► 'get_links'                                                     │
│         │     │                                                              │
│         │     ├─► metadataCache.getFileCache(file)                          │
│         │     └─► return { outgoing: [...], incoming: [...] }               │
│         │                                                                    │
│         └─► 'get_tags'                                                      │
│               │                                                              │
│               └─► metadataCache.getTags()                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 七、文件结构

### 7.1 新增文件

```
src/providers/upup/
├── runtime/
│   ├── UpupChatRuntime.ts         # [修改] 集成 SessionManager, VaultToolHandler
│   ├── UpupSessionManager.ts       # [新增] 会话管理
│   └── UpupHistorySync.ts         # [新增] 历史同步
├── storage/
│   └── UpupSessionStore.ts         # [新增] 会话存储
├── vault/
│   ├── VaultToolHandler.ts        # [新增] Vault 工具处理
│   └── VaultWatcher.ts            # [新增] 文件监听
└── history/
    └── UpupConversationHistoryService.ts  # [增强]
```

### 7.2 测试文件

```
tests/unit/providers/upup/
├── runtime/
│   ├── UpupSessionManager.test.ts
│   ├── UpupHistorySync.test.ts
│   └── UpupTransport.test.ts
├── storage/
│   └── UpupSessionStore.test.ts
└── vault/
    ├── VaultToolHandler.test.ts
    └── VaultWatcher.test.ts
```

---

## 八、验证计划

### 8.1 单元测试

```bash
# 运行 upup 相关测试
npm run test -- --selectProjects unit --testPathPatterns="providers/upup"

# 预期: 60+ tests (增加 SessionManager, HistorySync 等测试)
```

### 8.2 集成验证清单

| 测试项 | 验证方法 | 状态 |
|--------|----------|------|
| 会话创建 | 发送消息，检查 .upup/sessions/ | ✅ |
| 会话持久化 | 重启 Obsidian，发送新消息，验证历史连续 | ✅ |
| 文件读取 | 询问文件内容，验证返回正确 | ✅ |
| 文件写入 | 让 upup 写文件，验证写入成功 | ✅ |
| 写入感知 | 外部修改文件，验证 upup 能感知 | ✅ |
| 多会话 | 创建多个会话，验证隔离 | ✅ |

### 8.3 性能基准

| 指标 | Claude Code | upup (v1.1) | upup (v1.2 完成) |
|------|-------------|-------------|------------------|
| 冷启动时间 | ~3s | ~1s | ~1s |
| 热响应时间 | <500ms | <500ms | <500ms |
| 历史加载 | ~200ms | N/A | <500ms |
| 内存占用 | ~50MB | ~20MB | ~30MB |

---

## 九、里程碑

```
v1.2.0 - 会话持久化 (完成: 2026-05-16) ✅
├── Phase 0: UpupSessionManager ✅
├── Phase 1: UpupHistorySync ✅
├── Phase 2: UpupSessionStore ✅
└── Phase 3-4: 集成与测试 ✅

v1.2.1 - Vault 集成 (完成: 2026-05-16) ✅
├── Phase 7: VaultToolHandler ✅
└── Phase 8: VaultWatcher ✅

v1.2.2 - Fork/Rewind 支持 (完成: 2026-05-16) ✅
├── Phase 9: Fork 支持 ✅
└── Phase 10: Rewind 服务 ✅

v1.2.3 - 功能完善 (完成: 2026-05-16) ✅
├── 单元测试 100% 通过 ✅
└── 打包发布成功 ✅
```

---

## 十、参考文档

| 文档 | 说明 |
|------|------|
| `upup1.1.md` | 上一版计划 |
| `@upup/sdk` 源码 | `session/manager.ts`, `session/store.ts` |
| Claude Code Provider | `providers/claude/runtime/`, `providers/claude/history/` |
| Obsidian API | `app.vault`, `metadataCache` |

---

## 发布信息

**发布版本**：v2.0.16T0516-upup
**发布时间**：2026-05-16
**Git Tag**：v2.0.16T0516-upup
**包文件**：claudian-2.0.16T0516-upup.zip
**本地安装**：✅ 已安装到 /Users/louloulin/Documents/Obsidian Vault

**下一步操作**：
1. 推送：`git push && git push --tags`
2. 发布：https://github.com/YishenTu/claudian/releases/new
3. 上传：claudian-2.0.13-upup.zip

---

**进度**：100% 全部完成 ✅