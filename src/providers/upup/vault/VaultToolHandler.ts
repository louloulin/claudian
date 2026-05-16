/**
 * VaultToolHandler - 处理 upup 工具调用
 *
 * 拦截 upup 的工具调用并通过 Obsidian API 执行
 */

import { TFile, TFolder } from 'obsidian';

import type ClaudianPlugin from '../../../main';

// ============ Types ============

export type VaultToolName = 'file_read' | 'file_write' | 'dir_read' | 'glob_search' | 'get_links' | 'get_tags';

export interface VaultToolResult {
  success: boolean;
  content: string;
  error?: string;
}

export interface LinkInfo {
  outgoing: string[];
  incoming: string[];
}

export interface TagInfo {
  tags: string[];
}

// ============ VaultToolHandler ============

export class VaultToolHandler {
  private readonly vaultTools = new Set<VaultToolName>([
    'file_read',
    'file_write',
    'dir_read',
    'glob_search',
    'get_links',
    'get_tags',
  ]);

  constructor(private plugin: ClaudianPlugin) {}

  /**
   * 检查是否是 Vault 工具
   */
  isVaultTool(toolName: string): boolean {
    return this.vaultTools.has(toolName as VaultToolName);
  }

  /**
   * 获取所有支持的 Vault 工具
   */
  getSupportedTools(): VaultToolName[] {
    return Array.from(this.vaultTools);
  }

  /**
   * 处理工具调用
   */
  async handleTool(toolName: VaultToolName, args: Record<string, unknown>): Promise<VaultToolResult> {
    switch (toolName) {
      case 'file_read':
        return this.readFile(args);
      case 'file_write':
        return this.writeFile(args);
      case 'dir_read':
        return this.readDir(args);
      case 'glob_search':
        return this.globSearch(args);
      case 'get_links':
        return this.getLinks(args);
      case 'get_tags':
        return this.getTags(args);
      default:
        return { success: false, content: '', error: `Unknown tool: ${toolName}` };
    }
  }

  /**
   * 读取文件
   */
  private async readFile(args: Record<string, unknown>): Promise<VaultToolResult> {
    const pathArg = args.path as string;
    if (!pathArg) {
      return { success: false, content: '', error: 'path is required' };
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(pathArg);
      if (!file || !(file instanceof TFile)) {
        return { success: false, content: '', error: `File not found: ${pathArg}` };
      }
      const content = await this.plugin.app.vault.read(file);
      return { success: true, content };
    } catch (err) {
      return { success: false, content: '', error: String(err) };
    }
  }

  /**
   * 写入文件
   */
  private async writeFile(args: Record<string, unknown>): Promise<VaultToolResult> {
    const pathArg = args.path as string;
    const content = args.content as string;
    if (!pathArg) {
      return { success: false, content: '', error: 'path is required' };
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(pathArg);
      if (file instanceof TFile) {
        // 修改已存在的文件
        await this.plugin.app.vault.modify(file, content ?? '');
        return { success: true, content: `Modified: ${pathArg}` };
      } else {
        // 创建新文件
        const created = await this.plugin.app.vault.create(pathArg, content ?? '');
        return { success: true, content: `Created: ${created.path}` };
      }
    } catch (err) {
      return { success: false, content: '', error: String(err) };
    }
  }

  /**
   * 读取目录
   */
  private async readDir(args: Record<string, unknown>): Promise<VaultToolResult> {
    const pathArg = args.path as string;
    if (!pathArg) {
      return { success: false, content: '', error: 'path is required' };
    }

    try {
      const folder = this.plugin.app.vault.getAbstractFileByPath(pathArg);
      if (!folder || !(folder instanceof TFolder)) {
        return { success: false, content: '', error: `Folder not found: ${pathArg}` };
      }

      const files: string[] = [];
      for (const child of folder.children) {
        if (child instanceof TFile) {
          files.push(child.path);
        } else if (child instanceof TFolder) {
          files.push(child.path + '/');
        }
      }

      return { success: true, content: JSON.stringify(files) };
    } catch (err) {
      return { success: false, content: '', error: String(err) };
    }
  }

  /**
   * 模式匹配搜索
   */
  private async globSearch(args: Record<string, unknown>): Promise<VaultToolResult> {
    const pattern = (args.pattern ?? args.glob ?? args.query ?? '') as string;
    if (!pattern) {
      return { success: false, content: '', error: 'pattern is required' };
    }

    try {
      const allFiles = this.plugin.app.vault.getFiles();
      const matchingFiles: string[] = [];

      // 将 glob 模式转换为正则表达式
      const regexPattern = pattern
        .replace(/\./g, '\\.')
        .replace(/\*/g, '.*')
        .replace(/\?/g, '.');

      const regex = new RegExp(`^${regexPattern}$`, 'i');

      for (const file of allFiles) {
        const normalizedPath = file.path.replace(/\\/g, '/');
        if (regex.test(normalizedPath)) {
          matchingFiles.push(file.path);
        }
      }

      return { success: true, content: JSON.stringify(matchingFiles) };
    } catch (err) {
      return { success: false, content: '', error: String(err) };
    }
  }

  /**
   * 获取链接信息
   */
  private async getLinks(args: Record<string, unknown>): Promise<VaultToolResult> {
    const pathArg = args.path as string;
    if (!pathArg) {
      return { success: false, content: '', error: 'path is required' };
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(pathArg);
      if (!(file instanceof TFile)) {
        return { success: false, content: '', error: `File not found: ${pathArg}` };
      }

      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const outgoing = (cache?.links ?? []).map((l: { link: string }) => l.link);

      const links: LinkInfo = {
        outgoing,
        incoming: [], // 计算 incoming 需要遍历所有文件，成本较高
      };

      return { success: true, content: JSON.stringify(links) };
    } catch (err) {
      return { success: false, content: '', error: String(err) };
    }
  }

  /**
   * 获取标签信息
   */
  private async getTags(args: Record<string, unknown>): Promise<VaultToolResult> {
    const pathArg = args.path as string;
    if (!pathArg) {
      return { success: false, content: '', error: 'path is required' };
    }

    try {
      const file = this.plugin.app.vault.getAbstractFileByPath(pathArg);
      if (!(file instanceof TFile)) {
        return { success: false, content: '', error: `File not found: ${pathArg}` };
      }

      const cache = this.plugin.app.metadataCache.getFileCache(file);
      const tags: TagInfo = {
        tags: cache?.tags?.map((t: { tag: string }) => t.tag) ?? [],
      };

      return { success: true, content: JSON.stringify(tags) };
    } catch (err) {
      return { success: false, content: '', error: String(err) };
    }
  }
}

// ============ Factory ============

export function createVaultToolHandler(plugin: ClaudianPlugin): VaultToolHandler {
  return new VaultToolHandler(plugin);
}