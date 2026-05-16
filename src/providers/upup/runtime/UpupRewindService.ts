/**
 * UpupRewindService - upup 撤销服务
 *
 * 提供文件修改历史跟踪和撤销功能
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type ClaudianPlugin from '../../../main';

export interface ChatRewindResult {
  canRewind: boolean;
  error?: string;
  filesChanged?: string[];
  insertions?: number;
  deletions?: number;
}

interface FileChange {
  path: string;
  oldContent: string;
  newContent: string;
  timestamp: Date;
}

export class UpupRewindService {
  private fileChanges: Map<string, FileChange[]> = new Map();
  private backupDir: string;

  constructor(private plugin: ClaudianPlugin) {
    // 创建备份目录
    this.backupDir = path.join(os.tmpdir(), `upup-rewind-backup-${Date.now()}`);
    try {
      fs.mkdirSync(this.backupDir, { recursive: true });
    } catch {
      // Ignore
    }
  }

  /**
   * 记录文件修改
   */
  recordChange(filePath: string, oldContent: string, newContent: string): void {
    if (!this.fileChanges.has(filePath)) {
      this.fileChanges.set(filePath, []);
    }

    const changes = this.fileChanges.get(filePath)!;
    changes.push({
      path: filePath,
      oldContent,
      newContent,
      timestamp: new Date(),
    });
  }

  /**
   * 检查是否可以撤销
   */
  canRewind(): boolean {
    // 检查是否有记录的文件修改
    for (const changes of this.fileChanges.values()) {
      if (changes.length > 0) {
        return true;
      }
    }
    return false;
  }

  /**
   * 获取最近修改的文件列表
   */
  getRecentChanges(limit: number = 10): FileChange[] {
    const allChanges: FileChange[] = [];

    for (const changes of this.fileChanges.values()) {
      allChanges.push(...changes);
    }

    // 按时间排序
    allChanges.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    return allChanges.slice(0, limit);
  }

  /**
   * 执行撤销操作 (预览模式)
   */
  async previewRewind(userMessageId?: string): Promise<ChatRewindResult> {
    const changes = this.getRecentChanges();

    if (changes.length === 0) {
      return { canRewind: false, error: 'No changes to rewind' };
    }

    const filesChanged = [...new Set(changes.map(c => c.path))];

    // 统计插入和删除行数
    let insertions = 0;
    let deletions = 0;
    for (const change of changes) {
      const oldLines = change.oldContent.split('\n').length;
      const newLines = change.newContent.split('\n').length;
      deletions += oldLines;
      insertions += newLines;
    }

    return {
      canRewind: true,
      filesChanged,
      insertions,
      deletions,
    };
  }

  /**
   * 执行撤销操作
   */
  async executeRewind(userMessageId?: string): Promise<ChatRewindResult> {
    const changes = this.getRecentChanges();

    if (changes.length === 0) {
      return { canRewind: false, error: 'No changes to rewind' };
    }

    const filesChanged: string[] = [];

    // 创建备份
    for (const change of changes) {
      const backupPath = this.getBackupPath(change.path);
      try {
        // 确保目录存在
        const dir = path.dirname(backupPath);
        fs.mkdirSync(dir, { recursive: true });
        // 写入备份
        fs.writeFileSync(backupPath, change.newContent);
      } catch {
        // Ignore backup errors
      }
    }

    // 执行撤销
    for (const change of changes) {
      try {
        fs.writeFileSync(change.path, change.oldContent);
        filesChanged.push(change.path);
      } catch (err) {
        console.error('[UpupRewind] Failed to revert:', change.path, err);
      }
    }

    // 统计
    let insertions = 0;
    let deletions = 0;
    for (const change of changes) {
      const oldLines = change.oldContent.split('\n').length;
      const newLines = change.newContent.split('\n').length;
      deletions += newLines;
      insertions += oldLines;
    }

    // 清除已撤销的记录
    this.fileChanges.clear();

    return {
      canRewind: true,
      filesChanged,
      insertions,
      deletions,
    };
  }

  /**
   * 清理备份目录
   */
  cleanup(): void {
    try {
      fs.rmSync(this.backupDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  }

  private getBackupPath(filePath: string): string {
    const relativePath = filePath.replace(/^\//, '').replace(/:/, '_');
    return path.join(this.backupDir, relativePath);
  }
}

// ============ Factory ============

export function createRewindService(plugin: ClaudianPlugin): UpupRewindService {
  return new UpupRewindService(plugin);
}