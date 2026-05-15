# Upup Provider 升级计划 v1.2 — 会话持久化与功能完善

**日期**：2026-05-16
**版本**：1.2（基于 v1.1 的增量更新）
**目标**：实现会话持久化、对话连续性、Obsidian 知识图谱集成

---

## 执行摘要

**当前状态**：v1.1 已完成核心流式传输，但缺少会话管理和对话连续性。

**关键差距**：
- ❌ 无会话持久化（每次重启丢失历史）
- ❌ 无对话历史同步到 upup
- ❌ 无 Obsidian 内容/知识图谱读取
- ❌ 无 Obsidian 写入感知

**v1.2 目标**：实现最佳最小功能集，保持 upup 轻量优势。

---

## 一、现状分析

### 1.1 v1.1 已完成功能

| 组件 | 状态 | 说明 |
|------|------|------|
| Provider 注册 | ✅ | `upupProviderRegistration` |
| Workspace 注册 | ✅ | `upupWorkspaceRegistration` |
| ChatRuntime | ✅ | 完整实现，支持崩溃恢复 |
| Settings Tab | ✅ | 8 Provider UI |
| Settings Reconciler | ✅ | 环境变量哈希 |
| Agent Mention | ✅ | SKILL.md 发现 |
| Skill Catalog | ✅ | 命令目录 |
| Transform Events | ✅ | 11 种事件类型 |
| Binary Detection | ✅ | 智能查找系统 upup |
| stdio 通信 | ✅ | 使用原生 upup --stdio |
| 实时流式传输 | ✅ | 修复批处理为实时模式 |

### 1.2 当前问题

```
┌─────────────────────────────────────────────────────────────────┐
│                    当前 upup Provider 架构                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Obsidian Vault ──┬──► upup --stdio ──► AI 响应                │
│                    │                                            │
│   ❌ 不读取 Vault 内容   │                                    │
│   ❌ 不传递对话历史     │                                       │
│   ❌ 不感知写入操作     │                                       │
│   ❌ 不持久化会话       │                                       │
│                                                                 │
│   每次 query 都是独立请求，无连续性                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1.3 Claude Code Provider 完整架构

```
┌─────────────────────────────────────────────────────────────────┐
│                  Claude Code Provider 架构                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│   Obsidian Vault ──┬──► Claude SDK ──► AI 响应                 │
│                    │                                            │
│   ✅ 读取 Vault 文件      │                                    │
│   ✅ 读取 .claude/ 目录    │                                    │
│   ✅ 读取 MCP servers      │                                    │
│   ✅ 同步对话历史           │                                    │
│   ✅ 持久化会话到 ~/.claude │                                    │
│   ✅ 感知文件写入           │                                    │
│   ✅ 支持 fork/rewind       │                                    │
│                                                                 │
│   SDK 内部管理完整生命周期                                        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

---

## 二、@upup/sdk Session 功能分析

### 2.1 SessionManager 核心 API

```typescript
class SessionManager {
  async create(config?: SessionConfig): Promise<SessionInfo>
  async continue(sessionId: string): Promise<void>
  async save(): Promise<void>
  async load(sessionId: string): Promise<{ session, messages } | null>
  async pause(): Promise<void>
  async complete(): Promise<void>

  addMessage(message: SessionMessage): void
  getMessages(): SessionMessage[]
  getSessionId(): string | null
  getCurrentSession(): SessionInfo | null
}
```

### 2.2 SessionStore 实现

| Store 类型 | 说明 | 用途 |
|------------|------|------|
| `JsonSessionStore` | 每个会话一个目录 | 开发/调试 |
| `FileSessionStore` | 每个会话一个文件 | 生产环境 |
| `MemorySessionStore` | 仅内存 | 临时会话 |

### 2.3 会话消息格式

```typescript
interface SessionMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: Date
  tokens?: number
  toolCalls?: Array<{ id, name, input }>
  toolResults?: Array<{ toolCallId, result }>
}
```

---

## 三、架构对比

### 3.1 功能差距矩阵

| 功能 | Claude Code | upup (当前) | upup (v1.2) |
|------|-------------|-------------|-------------|
| **会话管理** | | | |
| 会话持久化 | ✅ ~/.claude/ | ❌ 内存 | ⏳ 实现中 |
| 对话历史同步 | ✅ JSONL | ❌ 无 | ⏳ 实现中 |
| Fork/分支 | ✅ 支持 | ❌ 无 | ⏳ 实现中 |
| Rewind | ✅ 支持 | ❌ 无 | ❌ 延迟 |
| **Obsidian 集成** | | | |
| 读取 Vault 内容 | ✅ MCP | ❌ 无 | ⏳ 实现中 |
| 知识图谱 | ✅ 插件 | ❌ 无 | ❌ 延迟 |
| 写入感知 | ✅ 插件 | ❌ 无 | ⏳ 实现中 |
| **运行时** | | | |
| MCP servers | ✅ 支持 | ❌ 无 | ❌ 延迟 |
| 工具调用 | ✅ 原生 | ✅ 原生 | ✅ 原生 |
| 权限管理 | ✅ SDK | ❌ 无 | ⏳ 实现中 |
| **流式** | | | |
| 实时流式 | ✅ | ✅ | ✅ |
| 思考输出 | ✅ | ✅ | ✅ |

### 3.2 架构图

```
┌─────────────────────────────────────────────────────────────────────┐
│                        upup Provider v1.2                           │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                     UpupChatRuntime                         │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │   │
│  │  │ SessionMgr  │  │ HistorySync │  │ VaultWatcher        │ │   │
│  │  │ (新增)      │  │ (新增)      │  │ (新增)              │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    UpupTransport                             │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │   │
│  │  │ StdioIO     │  │ JSON-RPC    │  │ EventHandler        │ │   │
│  │  └─────────────┘  └─────────────┘  └─────────────────────┘ │   │
│  └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│  ┌──────────────────────────────────────────────────────────────┐   │
│  │                    upup --stdio 进程                          │   │
│  │  ┌─────────────────────────────────────────────────────┐   │   │
│  │  │                   AI Core                            │   │   │
│  │  │  - 工具执行                                            │   │   │
│  │  │  - 思考推理                                            │   │   │
│  │  │  - 对话管理                                            │   │   │
│  │  └─────────────────────────────────────────────────────┘   │   │
│  └───────────────────────────────────────────────────────────-┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                      会话管理流程                                   │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   User Message                                                       │
│        │                                                             │
│        ▼                                                             │
│   ┌─────────────┐    ┌─────────────┐    ┌─────────────────────┐      │
│   │ prepareTurn │───►│ getHistory  │───►│ syncHistoryToUpup   │      │
│   └─────────────┘    └─────────────┘    └─────────────────────┘      │
│                                                │                      │
│                                                ▼                      │
│                                           ┌─────────────┐             │
│                                           │ streamRun   │             │
│                                           └─────────────┘             │
│                                                │                      │
│        ┌──────────────────────────────────────┼──────────────────┐   │
│        │                                      ▼                  │   │
│        │   ┌─────────────┐    ┌─────────────┐    ┌───────────┐   │   │
│        │   │ onEvent     │───►│ addMessage  │───►│ save      │   │   │
│        │   └─────────────┘    └─────────────┘    └───────────┘   │   │
│        │                                      │                  │   │
│        │                              ┌───────┴───────┐          │   │
│        │                              ▼               ▼          │   │
│        │                      ┌───────────┐   ┌───────────┐      │   │
│        │                      │ .upup/    │   │ Obsidian  │      │   │
│        │                      │ sessions/ │   │ Vault     │      │   │
│        │                      └───────────┘   └───────────┘      │   │
│        └─────────────────────────────────────────────────────────┘   │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    Obsidian 内容读取流程                             │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│   upup 请求读取文件                                                   │
│        │                                                             │
│        ▼                                                             │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                    VaultWatcher                             │   │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │   │
│   │  │ file_read   │  │ dir_read    │  │ glob_search         │ │   │
│   │  │ handler     │  │ handler     │  │ handler             │ │   │
│   │  └─────────────┘  └─────────────┘  └─────────────────────┘ │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│   ┌──────────────────────────────────────────────────────────────┐   │
│   │                    Obsidian Vault API                        │   │
│   │  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │   │
│   │  │ vault.get   │  │ vault.list  │  │ metadataCache       │ │   │
│   │  │ AbstractFile│  │ adapter     │  │ get file cache       │ │   │
│   │  └─────────────┘  └─────────────┘  └─────────────────────┘ │   │
│   └──────────────────────────────────────────────────────────────┘   │
│                              │                                      │
│                              ▼                                      │
│   返回文件内容给 upup                                                  │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 四、v1.2 实现计划

### 4.1 核心组件

```
src/providers/upup/
├── runtime/
│   ├── UpupChatRuntime.ts      # 核心运行时（增强）
│   ├── UpupTransport.ts        # 传输层（增强）
│   ├── UpupSessionManager.ts    # [新增] 会话管理器
│   └── UpupHistorySync.ts      # [新增] 历史同步
├── storage/
│   └── UpupSessionStore.ts      # [新增] 会话存储
├── vault/
│   └── VaultWatcher.ts          # [新增] Vault 文件监听
└── tools/
    └── VaultToolHandler.ts      # [新增] Vault 工具处理
```

### 4.2 最佳最小实现

#### Phase 1: 会话持久化（高优先级）

**目标**：保存对话历史到 `.upup/sessions/`

```typescript
// UpupSessionManager.ts
export class UpupSessionManager {
  private sessionId: string | null = null;
  private messages: SessionMessage[] = [];

  // 创建/继续会话
  async ensureSession(conversationId: string): Promise<string> {
    const store = new JsonSessionStore(this.getSessionPath());
    const existing = await store.load(conversationId);
    if (existing) {
      this.sessionId = existing.session.id;
      this.messages = existing.messages;
      return this.sessionId;
    }
    this.sessionId = conversationId;
    this.messages = [];
    return this.sessionId;
  }

  // 添加消息
  addMessage(role: 'user' | 'assistant', content: string): void {
    this.messages.push({ role, content, timestamp: new Date() });
  }

  // 获取历史
  getHistory(): SessionMessage[] {
    return this.messages;
  }

  // 保存会话
  async save(): Promise<void> {
    if (!this.sessionId) return;
    const store = new JsonSessionStore(this.getSessionPath());
    await store.save({ id: this.sessionId, ... }, this.messages);
  }

  private getSessionPath(): string {
    return path.join(this.plugin.app.vault.path!, '.upup/sessions');
  }
}
```

#### Phase 2: 历史同步（高优先级）

**目标**：将历史传递给 upup 实现对话连续性

```typescript
// UpupHistorySync.ts
export class UpupHistorySync {
  async syncHistory(manager: UpupSessionManager): Promise<void> {
    const messages = manager.getHistory();
    if (messages.length === 0) return;

    // 将历史编码为 upup 期望的格式
    const historyText = messages.map(m =>
      `${m.role}: ${m.content}`
    ).join('\n\n');

    // 通过环境变量或消息传递
    process.env.UPUP_HISTORY = historyText;
  }
}
```

#### Phase 3: Vault 工具处理（中优先级）

**目标**：拦截 upup 的文件读写请求

```typescript
// VaultToolHandler.ts
export class VaultToolHandler {
  constructor(private plugin: ClaudianPlugin) {}

  handleToolCall(toolName: string, input: Record<string, unknown>): Promise<unknown> {
    switch (toolName) {
      case 'file_read':
        return this.handleFileRead(input);
      case 'file_write':
        return this.handleFileWrite(input);
      case 'dir_read':
        return this.handleDirRead(input);
      default:
        return Promise.reject(new Error(`Unknown tool: ${toolName}`));
    }
  }

  private async handleFileRead(input: Record<string, unknown>): Promise<string> {
    const filePath = input.path as string;
    const file = this.plugin.app.vault.getAbstractFileByPath(filePath);
    if (file instanceof TFile) {
      return await this.plugin.app.vault.read(file);
    }
    throw new Error(`File not found: ${filePath}`);
  }

  private async handleFileWrite(input: Record<string, unknown>): Promise<void> {
    const filePath = input.path as string;
    const content = input.content as string;
    // 触发 Obsidian 刷新
    await this.plugin.app.vault.adapter.write(filePath, content);
    this.plugin.app.vault.trigger('raw');
  }
}
```

---

## 五、Obsidian 知识图谱集成

### 5.1 读取能力

```
Obsidian Vault
├── 文件内容读取
│   ├── vault.read(file) — 读取文件内容
│   ├── vault.getAbstractFileByPath() — 获取文件引用
│   └── metadataCache.getCache() — 获取 frontmatter/cache
│
├── 目录结构
│   ├── vault.adapter.list() — 列出目录
│   └── vault.getAllLoadedFiles() — 所有文件
│
├── 链接关系
│   ├── file.links — 出链
│   ├── file.backlinks — 入链
│   └── metadataCache.links — 缓存的链接
│
└── 标签/属性
    ├── metadataCache.tags — 标签
    ├── metadataCache.frontmatter — 前置matter
    └── metadataCache.headings — 标题结构
```

### 5.2 知识图谱读取 API

```typescript
// 获取文件的链接关系
function getFileLinks(file: TFile): { outgoing: string[], incoming: string[] } {
  const cache = this.plugin.app.metadataCache.getFileCache(file);
  const outgoing = cache?.links?.map(l => l.link) ?? [];
  const incoming = this.plugin.app.metadataCache.getBacklinksForFile(file)
    .map(ref => ref.source.path);
  return { outgoing, incoming };
}

// 获取标签图谱
function getTagGraph(): Map<string, string[]> {
  const tags = new Map<string, string[]>();
  for (const tag of this.plugin.app.metadataCache.getTags()) {
    tags.set(tag, []);
  }
  return tags;
}

// 获取文件夹结构
function getFolderTree(): FolderNode {
  const root = { name: '/', children: [] };
  for (const file of this.plugin.app.vault.getFiles()) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      // 构建树结构
    }
  }
  return root;
}
```

### 5.3 写入感知

```typescript
// 监听 Vault 变化
this.plugin.app.vault.on('modify', (file) => {
  console.log('[VaultWatcher] File modified:', file.path);
  // 通知 upup 缓存失效
});

this.plugin.app.vault.on('create', (file) => {
  console.log('[VaultWatcher] File created:', file.path);
  // 通知 upup 新文件
});

this.plugin.app.vault.on('delete', (file) => {
  console.log('[VaultWatcher] File deleted:', file.path);
  // 通知 upup 文件删除
});
```

---

## 六、执行流程

### 6.1 完整查询流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                      用户发送消息流程                                │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  1. 用户在 Obsidian 发送消息                                         │
│        │                                                             │
│        ▼                                                             │
│  2. ChatRuntime.prepareTurn()                                        │
│        │                                                             │
│        ├─► SessionManager.ensureSession()                            │
│        │     ├─► 检查 .upup/sessions/ 是否有历史                      │
│        │     └─► 加载历史消息                                        │
│        │                                                             │
│        ├─► HistorySync.syncHistory()                                 │
│        │     └─► 将历史编码为上下文                                  │
│        │                                                             │
│        └─► VaultWatcher.prepareContext()                             │
│              └─► 收集 vault 状态信息                                  │
│                                                                     │
│  3. ChatRuntime.query()                                              │
│        │                                                             │
│        ├─► UpupTransport.streamRun()                                 │
│        │     ├─► 发送 'run' 请求                                      │
│        │     └─► 实时 yield 事件                                     │
│        │                                                             │
│        └─► transformServerEvent()                                    │
│              └─► 转换为 StreamChunk                                   │
│                                                                     │
│  4. StreamController.handleStreamChunk()                             │
│        │                                                             │
│        ├─► type: 'text' ──► appendText()                            │
│        ├─► type: 'tool_use' ──► handleToolUse()                    │
│        └─► type: 'done' ──► finalizeMessage()                       │
│                                                                     │
│  5. SessionManager.addMessage()                                      │
│        │                                                             │
│        ├─► 保存 user 消息                                            │
│        ├─► 保存 assistant 消息                                      │
│        └─► SessionManager.save() ──► 持久化                         │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

### 6.2 Vault 读取流程

```
┌─────────────────────────────────────────────────────────────────────┐
│                      upup 读取文件流程                               │
├─────────────────────────────────────────────────────────────────────┤
│                                                                     │
│  upup 发送 tool_call (file_read)                                    │
│        │                                                             │
│        ▼                                                             │
│  VaultToolHandler.handleToolCall()                                   │
│        │                                                             │
│        ├─► 检查是否为 Vault 文件                                     │
│        │     └─► 判断是否在 vault.path 下                           │
│        │                                                             │
│        ├─► 读取文件                                                  │
│        │     └─► vault.getAbstractFileByPath()                      │
│        │     └─► vault.read(file)                                   │
│        │                                                             │
│        └─► 返回内容                                                  │
│              └─► upup 继续处理                                       │
│                                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

---

## 七、测试计划

### 7.1 测试用例

| 测试 | 描述 | 状态 |
|------|------|------|
| SessionManager.create | 创建新会话 | ⏳ |
| SessionManager.save/load | 保存和加载会话 | ⏳ |
| SessionManager.addMessage | 添加消息 | ⏳ |
| HistorySync.syncHistory | 同步历史 | ⏳ |
| VaultToolHandler.file_read | 读取文件 | ⏳ |
| VaultToolHandler.file_write | 写入文件 | ⏳ |
| 端到端对话连续性 | 发送多条消息验证连续 | ⏳ |
| 重启后会话恢复 | 重启后加载历史 | ⏳ |

### 7.2 验证清单

```bash
# 1. 构建验证
npm run typecheck  # 通过
npm run lint       # 通过
npm run build      # 成功

# 2. 单元测试
npm run test -- --selectProjects unit --testPathPatterns="providers/upup"

# 3. 集成测试
#    a. 启动 Obsidian
#    b. 启用 Claudian 插件
#    c. 选择 upup provider
#    d. 发送消息验证响应
#    e. 发送第二条消息验证历史连续性
#    f. 重启 Obsidian
#    g. 发送第三条消息验证会话恢复

# 4. 性能测试
#    - 大对话历史（100+ 消息）
#    - 大文件读取（>1MB）
#    - 快速连续消息
```

---

## 八、文件变更记录

### v1.2 (2026-05-16)

| 文件 | 变更 | 优先级 |
|------|------|--------|
| `UpupSessionManager.ts` | 新增会话管理器 | P0 |
| `UpupHistorySync.ts` | 新增历史同步 | P0 |
| `UpupSessionStore.ts` | 新增会话存储 | P0 |
| `VaultToolHandler.ts` | 新增 Vault 工具处理 | P1 |
| `VaultWatcher.ts` | 新增 Vault 文件监听 | P1 |
| `UpupChatRuntime.ts` | 集成会话管理 | P0 |
| `upup1.1.md` → `upup1.2.md` | 更新计划文档 | - |

---

## 九、参考文档

| 文档 | 说明 |
|------|------|
| `upup1.1.md` | 上一版计划 |
| `@upup/sdk` 源码 | `/Users/louloulin/Documents/linchong/touzhi/dexter/packages/sdk/src/session/` |
| Claude Code Provider | `src/providers/claude/runtime/` — 架构参考 |
| Claude History | `src/providers/claude/history/` — 历史管理参考 |

---

## 十、里程碑

```
v1.2.0 - 会话持久化（目标：2026-05-17）
├── Phase 1: SessionManager 实现
├── Phase 2: HistorySync 实现
└── Phase 3: 端到端验证

v1.2.1 - Vault 集成（目标：2026-05-20）
├── Phase 4: VaultToolHandler 实现
└── Phase 5: VaultWatcher 实现

v1.2.2 - 功能完善（目标：TBD）
├── Fork 支持
├── 权限管理
└── MCP 支持
```

---

**进度**：20% 进行中

当前阶段：Phase 1 设计与实现