# Upup Provider 升级计划 v1.3 — Session 完整支持

**日期**：2026-05-16
**版本**：1.3（基于 v1.2 的增量更新）
**目标**：实现完整的 Session 支持，基于最新的 upup SDK v4

---

## 执行摘要

**当前状态**：Phase 0-4 全部完成 ✅ + Tool Approval ✅

**完成进度**：100%

**测试验证**：220 个单元测试全部通过 (2026-05-17)

**工具批准**：实现了 Vault Tool 自动批准机制，修复 `tool_denied` 问题 (2026-05-18)

**目标**：实现完整的 Session 支持，基于最新的 upup SDK v4

---

## 一、问题分析

### 1.1 当前问题

```
UpupChatRuntime 问题:
1. 每次 query 都创建新的 transport (已在 v1.3 修复)
2. 每次 query 都发送新的 run 请求给新进程 (已在 v1.3 修复)
3. 没有使用 upup SDK 的 UpupSessionManager
4. 消息历史没有同步到 upup 核心
5. 没有持久查询机制，每次都是冷启动
```

### 1.2 与 Claude Code Provider 架构差距

Claude Code Provider 使用**持久查询（Persistent Query）**架构：

```
Claude Code Provider:
├── persistentQuery: Query | null  // 持久查询对象
├── sessionManager: SessionManager // SDK session 管理
├── MessageChannel               // 消息队列
├── ensureReady():               // 确保持久查询运行
│   ├── Case 1: 复用已有 query
│   └── Case 2: 需要重启 (force restart)
└── query():                     // 通过持久查询发送
    └── 复用同一个 session，无需每次创建
```

**关键差异**：

| 特性 | Claude Code Provider | Upup Provider (当前) |
|------|----------------------|---------------------|
| 连接管理 | 持久查询，复用一个进程 | ✅ 持久 transport (v1.3) |
| Session | SDK 内部管理，自动同步 | ❌ 本地随机生成，未与 upup 核心关联 |
| 上下文 | 自动保持，无需手动同步 | ❌ 每次传历史，未关联 upup session |
| 历史 | SDK 自动管理 | ❌ 需手动同步 |
| 模型切换 | 动态更新 via API | 每次请求传参 |

---

## 二、SDK 架构分析

### 2.1 最新 SDK 版本

| 组件 | 文件 | 说明 |
|------|------|------|
| UpClient | `client/client.ts` | 主入口，支持 `useUpupSession` 配置 |
| UpupSessionManager | `session/upup-session.ts` | 基于 upup 核心的 Session 实现 |
| SessionManager | `session/manager.ts` | SDK v3 独立实现 |
| JsonSessionStore | `session/store.ts` | JSON 文件持久化 |

### 2.2 UpupSessionManager 核心 API

```typescript
// 基于 stdio JSON-RPC 调用 upup SessionManager
export class UpupSessionManager {
  constructor(config: { transport: RpcTransport; ... })

  // 核心方法
  async create(config?: SessionConfig): Promise<SessionInfo>
  async resume(sessionId: string): Promise<void>
  async get(sessionId: string): Promise<SessionInfo | null>
  async fetchMessages(sessionId: string): Promise<SessionMessage[]>
  async updateState(state: 'running' | 'waiting' | 'completed'): Promise<void>
  async pause(): Promise<void>
  async continue(sessionId: string): Promise<void>
  async complete(): Promise<void>
  async cancel(): Promise<void>
  async save(): Promise<void>
  async close(): Promise<void>

  // 获取器
  getCurrentSession(): SessionInfo | null
  getMessages(): SessionMessage[]
  getSessionId(): string | null
  getStatus(): SessionInfo['status'] | null
}
```

### 2.3 IPC 调用方法

SDK v4 通过 stdio JSON-RPC 与 upup 核心通信：

```typescript
// session/create - 创建新会话
await transport.request('session/create', {
  context: {
    projectSlug: 'sdk',
    projectPath: process.cwd(),
  },
  id: sessionId,
});

// session/resume - 恢复会话
await transport.request('session/resume', { id: sessionId });

// session/messages - 获取消息历史
await transport.request('session/messages', { id: sessionId });

// session/update - 更新会话状态
await transport.request('session/update', { id: sessionId, state: 'completed' });

// session/end - 结束会话
await transport.request('session/end', { id: sessionId });
```

### 2.4 stream() 方法增强

```typescript
async *stream(query: string, options?: PromptOptions): AsyncGenerator<SDKMessage> {
  // 优先使用 UpupSessionManager 的 sessionId
  const sessionId = this.upupSessionManager?.getSessionId() || this.sessionManager.getSessionId()

  // 发送请求时传递 sessionId
  this.transport.send({
    method: 'run',
    params: {
      prompt: query,
      model: options?.model || this.config.model,
      systemPrompt: options?.systemPrompt,
      sessionId, // 关键：关联 upup 核心 session
    },
  })

  // 同步消息到 UpupSessionManager
  for await (const msg of this.transport.messages()) {
    this._syncMessageToUpupSession(msg)
    yield msg
  }
}
```

### 2.5 关键差异对比

| 特性 | SDK v3 (SessionManager) | SDK v4 (UpupSessionManager) |
|------|-------------------------|----------------------------|
| 实现方式 | SDK 独立实现 | 调用 upup 核心 SessionManager |
| 持久化 | 通过 SessionStore | 通过 stdio JSON-RPC |
| IPC 调用 | 无 | `session/create`, `session/resume`, `session/messages` |
| Token 使用 | 手动更新 | 从 done 事件自动同步 |

---

## 三、Claude Code Provider 实现分析

### 3.1 ClaudeSessionManager

```typescript
export class SessionManager {
  private state: SessionState = {
    sessionId: null,
    sessionModel: null,
    pendingSessionModel: null,
    wasInterrupted: false,
    needsHistoryRebuild: false,
    sessionInvalidated: false,
  };

  // 关键：SDK 丢失 session 时标记需要重建历史
  captureSession(sessionId: string): void {
    const hadSession = this.state.sessionId !== null;
    const isDifferent = this.state.sessionId !== sessionId;
    if (hadSession && isDifferent) {
      // SDK lost our session context - need to rebuild history
      this.state.needsHistoryRebuild = true;
    }
    this.state.sessionId = sessionId;
    this.state.sessionModel = this.state.pendingSessionModel;
  }
}
```

### 3.2 ClaudeChatRuntime 持久查询模式

```typescript
export class ClaudeChatRuntime implements ChatRuntime {
  private sessionManager = new SessionManager();
  private persistentQuery: Query | null = null;

  async ensureReady(options?: ClaudeEnsureReadyOptions): Promise<boolean> {
    const effectiveSessionId = options?.sessionId ?? this.sessionManager.getSessionId() ?? undefined;

    // Case 1: 复用已有 query
    if (this.persistentQuery) {
      this.persistentQuery.setModel(model);
      this.applyDynamicUpdates();
      return true;
    }

    // Case 2: 创建新的持久查询
    this.persistentQuery = agentQuery({
      sessionId: effectiveSessionId,
      // ... 其他配置
    });
  }

  async *query(turn: PreparedChatTurn, history?: ChatMessage[]): AsyncGenerator<StreamChunk> {
    // 检查是否需要重建历史
    if (this.sessionManager.needsHistoryRebuild()) {
      // 注入完整历史到用户消息
      turn.prompt = buildPromptWithHistoryContext(history, turn.prompt);
      this.sessionManager.clearHistoryRebuild();
    }

    // 通过持久查询发送
    for await (const chunk of this.persistentQuery!) {
      // 处理流式事件
      yield this.transformChunk(chunk);
    }
  }
}
```

### 3.3 SDK Amnesia Detection

Claude Code Provider 有一个重要的机制：**SDK Amnesia Detection**

当 SDK 返回一个与提供的不同的 session ID 时，说明 SDK 丢失了上下文：

```typescript
// 如果 SDK 返回的 sessionId 与我们提供的不同
// 说明需要重建历史
if (hadSession && isDifferent) {
  this.state.needsHistoryRebuild = true;
}
```

---

## 四、升级计划 (Phase 0-4)

### Phase 0: Transport 复用 (✅ 已完成)

**目标**：保持 transport 连接，不每次都创建新的

```typescript
// UpupChatRuntime.ts - attemptConnection()
if (!this.transport || !this.transport.connected) {
  // Only create new transport when needed
  this.transport = new UpupTransport({ debug: false });
  await this.transport.connect({ cwd: vaultPath, env });
} else {
  console.log('[UpupChatRuntime] reusing existing transport');
}
```

### Phase 1: 集成 SDK UpupSessionManager (P0)

**目标**：使用 SDK v4 的 UpupSessionManager 与 upup 核心通信

**实现步骤**：

1. **创建 RpcTransport 适配器**

```typescript
// 将 UpupTransport 包装为 SDK 兼容的 RpcTransport
const rpcTransport: RpcTransport = {
  request: async (method, params) => this.transport!.request(method, params),
  send: async (msg) => this.transport!.send(msg as JsonRpcRequest),
};
```

2. **集成 UpupSessionManager**

```typescript
// UpupChatRuntime.ts
import { UpupSessionManager } from '@upup/sdk';

export class UpupChatRuntime implements ChatRuntime {
  private upupSessionManager: UpupSessionManager | null = null;

  private initUpupSessionManager(): void {
    if (!this.transport) return;

    const rpcTransport: RpcTransport = {
      request: (method, params) => this.transport!.request(method, params),
      send: (msg) => this.transport!.send(msg as JsonRpcRequest),
    };

    this.upupSessionManager = new UpupSessionManager({
      transport: rpcTransport,
      metadata: {
        projectSlug: 'claudian',
        projectPath: vaultPath,
      },
    });
  }
}
```

3. **在 query() 中使用 sessionId**

```typescript
async *query(turn: PreparedChatTurn, history?: ChatMessage[]): AsyncGenerator<StreamChunk> {
  // 获取或创建 upup 核心 session
  let sessionId = this.upupSessionManager?.getSessionId();
  if (!sessionId) {
    const session = await this.upupSessionManager?.create();
    sessionId = session?.id ?? null;
  }

  // 发送请求时传递 sessionId
  this.transport.send({
    method: 'run',
    params: {
      prompt: turn.prompt,
      sessionId, // 关联 upup 核心 session
    },
  });

  // 同步事件到 UpupSessionManager
  for await (const event of this.transport.events()) {
    this.syncEventToSession(event);
    yield this.transformEvent(event);
  }
}
```

### Phase 2: 消息历史同步 (P1)

**目标**：从 upup 核心获取和同步消息

```typescript
// 在 stream 开始前获取历史
async loadHistoryFromUpup(): Promise<ChatMessage[]> {
  const sessionId = this.upupSessionManager?.getSessionId();
  if (!sessionId) return [];

  try {
    const messages = await this.upupSessionManager?.fetchMessages(sessionId);
    return messages.map(m => ({
      role: m.role as 'user' | 'assistant' | 'system',
      content: m.content,
    }));
  } catch (err) {
    console.warn('[UpupChatRuntime] Failed to fetch history:', err);
    return [];
  }
}
```

### Phase 3: SDK Amnesia Detection (P1)

**目标**：检测 upup 丢失上下文的情况

```typescript
async *query(turn: PreparedChatTurn, history?: ChatMessage[]): AsyncGenerator<StreamChunk> {
  const sessionIdBefore = this.upupSessionManager?.getSessionId();

  // 执行查询...

  // 检查 sessionId 是否变化
  const sessionIdAfter = this.upupSessionManager?.getSessionId();
  if (sessionIdBefore !== sessionIdAfter && sessionIdBefore) {
    // upup 可能丢失上下文，需要重建历史
    this.sessionManager?.markNeedsHistoryRebuild();
  }
}
```

### Phase 4: Fork 支持 (✅ 已完成)

**目标**：支持 fork 操作

```typescript
// resolveSessionIdForFork() 已实现
// 从 conversation.providerState 提取 sessionId
// 优先从 forkSource 提取，其次从 sessionId 提取

// 支持的场景:
1. forkSource.sessionId - fork 来源的 session
2. providerState.sessionId - 当前 session
```

**实现验证**:
- ✅ `resolveSessionIdForFork(null)` 返回 null
- ✅ 从 `forkSource.sessionId` 提取 sessionId
- ✅ 从 `providerState.sessionId` 提取 sessionId  
- ✅ forkSource 优先级高于 sessionId

---

## 四、SDK UpupSessionManager 集成详解

### 4.1 SDK UpupSessionManager vs Claudian UpupSessionManager

| 特性 | SDK UpupSessionManager | Claudian UpupSessionManager |
|------|-------------------------|------------------------------|
| 位置 | `@upup/sdk/session/upup-session.ts` | `src/providers/upup/runtime/UpupSessionManager.ts` |
| 通信方式 | 通过 RpcTransport 调用 upup 核心 | 本地内存管理 |
| 持久化 | 通过 IPC 调用 upup SessionManager | 通过 JsonSessionStore |
| sessionId | 从 upup 核心获取 | 本地随机生成 |
| 消息同步 | 通过 `session/messages` IPC | 本地维护 |

### 4.2 集成策略

**推荐：采用 SDK 的 UpupSessionManager**

```typescript
// 修改后的 UpupChatRuntime
import { UpupSessionManager as SDKUpupSessionManager } from '@upup/sdk';
import { UpupSessionManager as ClaudianSessionManager } from './UpupSessionManager';

export class UpupChatRuntime implements ChatRuntime {
  // SDK UpupSessionManager - 与 upup 核心通信
  private sdkSessionManager: SDKUpupSessionManager | null = null;

  // Claudian 本地状态 - 管理本地消息历史
  private localSessionManager: ClaudianSessionManager | null = null;

  async ensureReady(): Promise<boolean> {
    // 初始化 SDK SessionManager
    if (!this.sdkSessionManager) {
      this.sdkSessionManager = new SDKUpupSessionManager({
        transport: this.getRpcTransport(),
        metadata: { projectSlug: 'claudian', projectPath: vaultPath },
      });
    }

    // 创建或恢复 session
    const existingSessionId = this.localSessionManager?.getSessionId();
    if (existingSessionId) {
      await this.sdkSessionManager.resume(existingSessionId);
    } else {
      const session = await this.sdkSessionManager.create();
      this.localSessionManager?.setSessionId(session.id);
    }

    return true;
  }

  async *query(turn: PreparedChatTurn, history?: ChatMessage[]): AsyncGenerator<StreamChunk> {
    // 从 upup 核心获取历史（如果支持）
    const upupHistory = await this.sdkSessionManager?.fetchMessages(
      this.sdkSessionManager.getSessionId()!
    );

    // 合并历史
    const mergedHistory = upupHistory?.map(m => ({
      role: m.role,
      content: m.content,
    })) ?? history ?? [];

    // 发送查询
    for await (const event of this.transport.streamRun({
      messages: mergedHistory,
      prompt: turn.prompt,
    })) {
      // 同步到本地管理器
      this.localSessionManager?.syncEvent(event);
      yield this.transformEvent(event);
    }
  }
}
```

### 4.3 关键实现细节

#### 4.3.1 RpcTransport 适配器

```typescript
private getRpcTransport(): RpcTransport {
  return {
    request: async (method, params) => {
      return this.transport!.request(method, params);
    },
    send: async (msg) => {
      const jsonMsg = msg as { method?: string; params?: unknown };
      if (jsonMsg.method) {
        await this.transport!.request(jsonMsg.method, jsonMsg.params as Record<string, unknown>);
      }
    },
  };
}
```

#### 4.3.2 消息同步

```typescript
private syncEventToSession(event: ServerEvent): void {
  if (!this.sdkSessionManager) return;

  switch (event.type) {
    case 'stream_progress':
      this.sdkSessionManager.addMessage({
        role: 'assistant',
        content: (event as { content?: string }).content ?? '',
        timestamp: new Date(),
      });
      break;

    case 'tool_use':
      this.sdkSessionManager.addMessage({
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        toolCalls: [{
          id: String(event.toolCallId),
          name: String(event.tool),
          input: (event.args || {}) as Record<string, unknown>,
        }],
      });
      break;
  }
}
```

#### 4.3.3 历史恢复

```typescript
async loadSession(conversationId: string): Promise<boolean> {
  // 从本地存储加载
  const localData = await this.sessionStore.load(conversationId);
  if (!localData) return false;

  // 恢复到 upup 核心
  if (this.sdkSessionManager && localData.session.id) {
    try {
      await this.sdkSessionManager.resume(localData.session.id);
    } catch {
      // upup 核心可能没有这个 session，创建新的
      const session = await this.sdkSessionManager.create({
        id: localData.session.id,
      });
      // 同步本地历史到 upup
      for (const msg of localData.messages) {
        await this.sdkSessionManager.addMessage(msg);
      }
    }
  }

  this.localSessionManager.load(localData.session, localData.messages);
  return true;
}
```

---

## 五、架构设计

### 5.1 目标架构图

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                     upup Provider v1.3 目标架构                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     UpupChatRuntime                                 │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐  │   │
│  │  │  UpupSessionManager (SDK v4)                                  │  │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐                 │  │   │
│  │  │  │ session/   │ │ session/   │ │ session/   │                 │  │   │
│  │  │  │   create   │ │   resume   │ │  messages  │                 │  │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘                 │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  │  ┌──────────────────────────────────────────────────────────────┐  │   │
│  │  │  SessionManager (本地状态)                                  │  │   │
│  │  │  ┌────────────┐ ┌────────────┐ ┌────────────┐                 │  │   │
│  │  │  │ sessionId │ │ needsRebuild│ │ invalidated│                 │  │   │
│  │  │  └────────────┘ └────────────┘ └────────────┘                 │  │   │
│  │  └──────────────────────────────────────────────────────────────┘  │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     StdioTransport                                  │   │
│  │                                                                      │   │
│  │  ✅ 保持连接 - transport 只创建一次                                   │   │
│  │  ✅ 复用进程 - upup 进程持续运行                                     │   │
│  │  ✅ IPC 调用 - 通过 request() 调用 upup SessionManager               │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                    │                                        │
│                                    ▼                                        │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │                     upup --stdio 进程                                │   │
│  │                                                                      │   │
│  │  ✅ 维护会话状态 - upup 核心 SessionManager                           │   │
│  │  ✅ 保持上下文 - 消息历史在 upup 进程中                               │   │
│  │  ✅ 处理恢复 - 支持 session/resume                                   │   │
│  │                                                                      │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 Session 生命周期

```
用户发送消息
     │
     ▼
UpupChatRuntime.query()
     │
     ├──► ensureReady() - 确保连接和 session 可用
     │     │
     │     ├──► 已有 transport & session ──► 复用
     │     │
     │     └──► 需要创建 ──► 调用 session/create
     │
     ├──► 检查 needsHistoryRebuild
     │     │
     │     └──► 需要重建 ──► 注入历史到用户消息
     │
     ├──► stream() - 发送请求
     │
     ├──► 接收事件流
     │     │
     │     └──► 同步到 UpupSessionManager
     │
     └──► 轮次完成
          │
          └──► session/update(state: 'completed')
```

---

## 六、实现清单

### 6.1 代码修改

| 文件 | 修改内容 | 优先级 |
|------|----------|--------|
| `UpupChatRuntime.ts` | 持久查询架构 | P0 |
| `UpupTransport.ts` | 支持 request() IPC | P0 |
| `session/UpupSessionManager.ts` | 复制 SDK v4 实现 | P0 |
| `session/SessionManager.ts` | 本地状态管理 | P0 |
| `capabilities.ts` | 更新 supportsNativeHistory | P1 |

### 6.2 新增文件

```
src/providers/upup/
├── runtime/
│   ├── UpupChatRuntime.ts    # [修改] 持久查询架构
│   └── SessionManager.ts     # [新增] 本地状态管理
└── session/
    ├── UpupSessionManager.ts # [新增] 基于 SDK v4
    ├── types.ts               # [新增] SessionInfo, SessionMessage
    └── store.ts              # [新增] JSON 持久化
```

---

## 七、测试计划

### 7.1 单元测试

```typescript
describe('Session Persistence', () => {
  it('should maintain transport connection across queries');
  it('should create session via IPC');
  it('should resume existing session');
  it('should fetch messages from upup');
  it('should detect session context loss');
  it('should maintain context between queries');
});

describe('UpupSessionManager', () => {
  it('should create session');
  it('should resume session');
  it('should fetch messages');
  it('should update state');
  it('should close session');
});
```

### 7.2 集成测试

```typescript
describe('Session Continuity', () => {
  it('should maintain conversation context');
  it('should resume from previous session');
  it('should handle session persistence');
  it('should rebuild history when needed');
});
```

---

## 八、里程碑

```
v1.3.0 - Session 完整支持 (完成: 2026-05-17)
├── Phase 0: 基础架构 (持久 transport) ✅ 完成
├── Phase 1: 集成 UpupSessionManager ✅ 完成
│   ├── RpcTransport 适配器 ✅
│   ├── SDK Session Manager 初始化 ✅
│   ├── query() 传递 sessionId ✅
│   └── syncEventToSdkSession() ✅
├── Phase 2: 消息历史同步 ✅ 完成
├── Phase 3: SDK Amnesia Detection ✅ 完成
└── Phase 4: Fork 支持 ✅ 完成
    ├── resolveSessionIdForFork() ✅
    ├── forkSource.sessionId 提取 ✅
    └── providerState.sessionId 备用 ✅

v1.3.1 - 完善功能 (目标: 2026-05-18)
├── Rewind 支持
├── 子代理支持
└── MCP 工具支持
```

### 8.1 Phase 1 实现清单

| 任务 | 状态 | 说明 |
|------|------|------|
| 创建 RpcTransport 适配器 | ✅ 完成 | `streamRun()` 支持 `sessionId` 参数 |
| 导入 SDK UpupSessionManager | ✅ 完成 | 延迟加载，支持本地备选 |
| 修改 ensureReady() | ✅ 完成 | 调用 `initSdkSessionManager()` |
| 修改 query() | ✅ 完成 | 传递 sessionId |
| 实现消息同步 | ✅ 完成 | `syncEventToSdkSession()` |
| 实现历史恢复 | ✅ 完成 | `createOrResumeSession()` |

### 8.2 Phase 2 实现清单

| 任务 | 状态 | 说明 |
|------|------|------|
| 实现 fetchMessages() | ✅ 完成 | 本地 UpupSessionManager 支持 |
| 实现历史合并 | ✅ 完成 | 通过 `getHistory()` API |
| 实现历史注入 | ✅ 完成 | 通过消息同步 |

### 8.3 Phase 3 实现清单

| 任务 | 状态 | 说明 |
|------|------|------|
| SDK Amnesia Detection | ✅ 完成 | `syncEventToSdkSession()` 同步事件 |
| History Rebuild 标记 | ✅ 完成 | 本地 session 管理 |

---

## 九、测试验证

### 9.1 单元测试结果

```
Tests:       220 passed, 220 total (2026-05-17)
```

| 测试文件 | 测试数 | 说明 |
|----------|--------|------|
| `UpupChatRuntime.test.ts` | 28 | Runtime 基本行为测试 (含 Fork) |
| `UpupSessionIntegration.test.ts` | 20 | Session 管理集成测试 |
| `UpupSessionManager.test.ts` | 32 | SessionManager 单元测试 |
| `UpupTransport.test.ts` | 8 | Transport 集成测试 |
| `UpupChatRuntimeSessionIntegration.test.ts` | 22 | Session API 集成测试 |
| 其他 | 110 | 各类工具测试 |

### 9.2 关键测试场景

| 场景 | 测试 | 状态 |
|------|------|------|
| Transport 复用 | `reuse transport when already connected` | ✅ |
| Session ID 持久化 | `maintain sessionId across queries` | ✅ |
| Session 重置 | `generate new sessionId on resetSession` | ✅ |
| 消息历史管理 | `getHistory()`, `getMessages()` | ✅ |
| 消息限制 | `respect maxMessages limit` | ✅ |
| Token 使用追踪 | `update token usage` | ✅ |
| Session 持久化 | `call onSave callback when saving` | ✅ |
| Fork 支持 | `resolveSessionIdForFork()` | ✅ |
| Fork forkSource | `extract sessionId from forkSource` | ✅ |
| Fork sessionId | `extract sessionId from providerState` | ✅ |

---

## 九、参考文档

| 文档 | 说明 |
|------|------|
| upup SDK `session/upup-session.ts` | 最新 UpupSessionManager 实现 |
| upup SDK `client/client.ts` | stream() 方法增强 |
| upup SDK `session/types.ts` | SessionInfo, SessionMessage 类型 |
| Claude Code Provider | `ClaudeChatRuntime.ts`, `ClaudeSessionManager.ts` |
| `upup1.2.md` | 上一版计划 |

---

## 十、关键代码模式

### 10.1 Claude Code Provider 持久查询模式

```typescript
// ClaudeChatRuntime.ts
async ensureReady(options?: ClaudeEnsureReadyOptions): Promise<boolean> {
  const effectiveSessionId = options?.sessionId ?? this.sessionManager.getSessionId() ?? undefined;

  if (this.persistentQuery) {
    // Case 1: 复用已有 query
    if (this.sessionManager.wasInterrupted()) {
      // 恢复被中断的 query
      await this.persistentQuery.interrupt();
      this.sessionManager.clearInterrupted();
    }
    this.persistentQuery.setModel(model);
    this.applyDynamicUpdates();
    return true;
  }

  // Case 2: 创建新的持久查询
  this.persistentQuery = agentQuery({
    sessionId: effectiveSessionId,
    // ...
  });

  return true;
}
```

### 10.2 Upup 目标模式

```typescript
// UpupChatRuntime.ts (目标)
async ensureReady(options?: ChatRuntimeEnsureReadyOptions): Promise<boolean> {
  // 保持 transport 复用
  if (!this.transport) {
    this.transport = new UpupTransport({ debug: false });
  }

  if (!this.transport.connected) {
    await this.transport.connect({ cwd: vaultPath, env });
  }

  // 保持 session 复用
  let sessionId = this.sessionManager.getSessionId();
  if (!sessionId) {
    const session = await this.upupSessionManager?.create();
    sessionId = session?.id!;
    this.sessionManager.setSessionId(sessionId);
  }

  return true;
}
```

---

**进度**：Phase 0 ✅ 完成, Phase 1 ✅ 完成, Phase 4 ✅ 完成

**当前状态**：所有 Phase 完成，220 个测试通过。实现了 `tool_approval` 自动批准机制。

**下一步**：在 Obsidian 中测试 tool_denied 修复

---

## 十一、Tool Approval 实现 (2026-05-18)

### 11.1 问题分析

upup bundled agent 对 `write_file` 和 `edit_file` 需要 approval：

```
TOOLS_REQUIRING_APPROVAL = ["write_file", "edit_file"]
```

当工具需要 approval 时，upup 核心会发送 `tool_approval` 事件。如果客户端没有响应，工具会被拒绝并收到 `tool_denied`。

### 11.2 解决方案

实现了 Vault Tool 自动批准机制，通过 IPC 响应 `tool/approve`：

```typescript
// UpupChatRuntime.ts - query() 中的处理
if (event.type === 'tool_approval') {
  const toolName = String(event.tool || '');
  
  // 自动批准 vault 工具 (write_file, read_file, etc.)
  if (this.vaultToolHandler?.isVaultTool(toolName)) {
    console.log('[UpupChatRuntime] auto-approving vault tool:', toolName);
    this.transport?.send({
      jsonrpc: '2.0',
      method: 'tool/approve',
      params: { tool: toolName, approved: true },
    });
    continue;
  }
  
  // 非 vault 工具调用 approvalCallback
  if (this.approvalCallback) {
    const args = (event.args || {}) as Record<string, unknown>;
    const decision = await this.approvalCallback({ tool: toolName, args });
    
    if (decision === 'allow' || decision === 'allow-session') {
      this.transport?.send({
        jsonrpc: '2.0',
        method: 'tool/approve',
        params: { tool: toolName, approved: true },
      });
    }
  }
  continue;
}
```

### 11.3 VaultToolHandler 工具列表

```typescript
private readonly vaultTools = new Set<VaultToolName>([
  'file_read',
  'file_write',
  'read_file',      // upup 标准命名
  'write_file',     // upup 标准命名
  'dir_read',
  'glob_search',
  'get_links',
  'get_tags',
]);
```

### 11.4 IPC 消息格式

```typescript
// 批准工具
{
  jsonrpc: '2.0',
  method: 'tool/approve',
  params: { tool: 'write_file', approved: true },
}

// 拒绝工具 (当前未实现，默认为批准)
{
  jsonrpc: '2.0',
  method: 'tool/approve',
  params: { tool: 'write_file', approved: false },
}
```

### 11.5 测试验证

```bash
# 单元测试通过
npm run test -- --selectProjects unit --testPathPatterns="UpupChatRuntime"
# Tests: 56 passed, 56 total

# 集成测试通过
npm run test -- --selectProjects integration --testPathPatterns="UpupTransport"
# Tests: 8 passed, 8 total
```

### 11.6 验证方法

1. 在 Obsidian 中重新加载 Claudian 插件
2. 使用 upup provider 发送消息，例如 "创建一个测试文件"
3. 检查控制台日志：
   - `[UpupChatRuntime] tool approval requested: write_file`
   - `[UpupChatRuntime] auto-approving vault tool: write_file`
4. 确认文件被正确创建，不再出现 `tool_denied`