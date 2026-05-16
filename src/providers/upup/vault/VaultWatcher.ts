/**
 * VaultWatcher - 监听 Obsidian vault 文件变化
 *
 * 监听 vault 中的文件创建、修改、删除事件
 */

import type { EventRef, TAbstractFile} from 'obsidian';
import { TFile } from 'obsidian';

import type ClaudianPlugin from '../../../main';

// ============ Types ============

export interface VaultEvent {
  type: 'create' | 'modify' | 'delete' | 'rename';
  path: string;
  timestamp: Date;
  file?: TFile;
  oldPath?: string;
}

export type VaultEventCallback = (event: VaultEvent) => void;

// ============ VaultWatcher ============

export class VaultWatcher {
  private callbacks: VaultEventCallback[] = [];
  private eventRefs: EventRef[] = [];
  private enabled = false;

  constructor(private plugin: ClaudianPlugin) {}

  /**
   * 启动监听
   */
  start(): void {
    if (this.enabled) return;
    this.enabled = true;

    // 文件创建事件
    this.eventRefs.push(
      this.plugin.app.vault.on('create', (file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        this.notify({
          type: 'create',
          path: file.path,
          timestamp: new Date(),
          file,
        });
      })
    );

    // 文件修改事件
    this.eventRefs.push(
      this.plugin.app.vault.on('modify', (file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        this.notify({
          type: 'modify',
          path: file.path,
          timestamp: new Date(),
          file,
        });
      })
    );

    // 文件删除事件
    this.eventRefs.push(
      this.plugin.app.vault.on('delete', (file: TAbstractFile) => {
        if (!(file instanceof TFile)) return;
        this.notify({
          type: 'delete',
          path: file.path,
          timestamp: new Date(),
          file,
        });
      })
    );

    // 文件重命名事件
    this.eventRefs.push(
      this.plugin.app.vault.on('rename', (file: TAbstractFile, oldPath: string) => {
        if (!(file instanceof TFile)) return;
        this.notify({
          type: 'rename',
          path: file.path,
          timestamp: new Date(),
          file,
          oldPath,
        });
      })
    );

    // 元数据缓存变化事件 (更快的文件内容变化通知)
    this.eventRefs.push(
      this.plugin.app.metadataCache.on('changed', (file: TFile) => {
        this.notify({
          type: 'modify',
          path: file.path,
          timestamp: new Date(),
          file,
        });
      })
    );

    console.log('[VaultWatcher] started, event refs:', this.eventRefs.length);
  }

  /**
   * 停止监听
   */
  stop(): void {
    if (!this.enabled) return;
    this.enabled = false;

    // 取消所有事件注册
    for (const ref of this.eventRefs) {
      this.plugin.app.vault.offref(ref);
      this.plugin.app.metadataCache.offref(ref);
    }
    this.eventRefs = [];
    this.callbacks = [];

    console.log('[VaultWatcher] stopped');
  }

  /**
   * 检查是否正在监听
   */
  isRunning(): boolean {
    return this.enabled;
  }

  /**
   * 注册文件变化回调
   * 返回取消注册函数
   */
  onFileChange(callback: VaultEventCallback): () => void {
    this.callbacks.push(callback);
    return () => {
      this.callbacks = this.callbacks.filter(cb => cb !== callback);
    };
  }

  /**
   * 通知所有回调
   */
  private notify(event: VaultEvent): void {
    // 只通知 .md 文件的变化
    if (!event.path.endsWith('.md')) return;

    // 不通知隐藏文件
    if (event.path.startsWith('.') || event.path.includes('/.')) return;

    for (const callback of this.callbacks) {
      try {
        callback(event);
      } catch (err) {
        console.error('[VaultWatcher] callback error:', err);
      }
    }
  }
}

// ============ Factory ============

export function createVaultWatcher(plugin: ClaudianPlugin): VaultWatcher {
  return new VaultWatcher(plugin);
}