/**
 * VaultToolHandler.test.ts
 * 单元测试 for VaultToolHandler
 */

import { TFile, TFolder } from 'obsidian';

import type { VaultToolName } from '../../../../../src/providers/upup/vault/VaultToolHandler';
import { VaultToolHandler } from '../../../../../src/providers/upup/vault/VaultToolHandler';

// Create mock classes that inherit from obsidian TFile/TFolder for instanceof compatibility
 
const MockTFile = TFile as any;
const MockTFolder = TFolder as any;

// Mock Obsidian API
const createMockPlugin = () => {
  const files = new Map<string, TFile | TFolder | null>();
  const fileContents = new Map<string, string>();

  const plugin = {
    app: {
      vault: {
        getAbstractFileByPath: (path: string) => files.get(path) ?? null,
        read: async (file: TFile) => {
          const content = fileContents.get(file.path);
          if (content === undefined) throw new Error('File not found');
          return content;
        },
        modify: async (file: TFile, content: string) => {
          fileContents.set(file.path, content);
        },
        create: async (path: string, content: string) => {
          const newFile = new MockTFile();
          Object.defineProperty(newFile, 'path', { value: path, writable: true });
          files.set(path, newFile);
          fileContents.set(path, content);
          return newFile;
        },
        getFiles: () => Array.from(files.values()).filter((f) => f instanceof TFile),
      },
      metadataCache: {
        getFileCache: (_file: TFile) => ({
          links: [{ link: 'linked-file.md' }],
          tags: [{ tag: '#example' }],
        }),
      },
    },
    // Expose files and contents for test setup
    _testSetup: (testFiles: Array<{ path: string; content: string; isFolder: boolean }>) => {
      for (const tf of testFiles) {
        if (tf.isFolder) {
          const folder = new MockTFolder();
          Object.defineProperty(folder, 'path', { value: tf.path, writable: true });
          files.set(tf.path, folder);
        } else {
          const file = new MockTFile();
          Object.defineProperty(file, 'path', { value: tf.path, writable: true });
          files.set(tf.path, file);
          fileContents.set(tf.path, tf.content);
        }
      }
      // Update folder.children for nested files
      for (const tf of testFiles) {
        if (tf.path.includes('/') && !tf.isFolder) {
          const parts = tf.path.split('/');
          let parentPath = parts[0];
          for (let i = 1; i < parts.length - 1; i++) {
            parentPath += '/' + parts[i];
          }
          const folder = files.get(parentPath);
          if (folder instanceof TFolder) {
            const file = files.get(tf.path);
            if (file) {
              folder.children.push(file);
            }
          }
        }
      }
    },
  };

  return plugin;
};

describe('VaultToolHandler', () => {
  let handler: VaultToolHandler;
  let mockPlugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();

    // Setup default test files
    mockPlugin._testSetup([
      { path: 'test.md', content: '# Test File\n\nHello, world!', isFolder: false },
      { path: 'existing.md', content: 'Original content', isFolder: false },
      { path: 'folder', content: '', isFolder: true },
      { path: 'folder/file.md', content: 'In folder', isFolder: false },
    ]);

    handler = new VaultToolHandler(mockPlugin as any);
  });

  describe('isVaultTool', () => {
    it('should return true for vault tools', () => {
      expect(handler.isVaultTool('file_read')).toBe(true);
      expect(handler.isVaultTool('file_write')).toBe(true);
      expect(handler.isVaultTool('dir_read')).toBe(true);
      expect(handler.isVaultTool('glob_search')).toBe(true);
      expect(handler.isVaultTool('get_links')).toBe(true);
      expect(handler.isVaultTool('get_tags')).toBe(true);
    });

    it('should return false for non-vault tools', () => {
      expect(handler.isVaultTool('unknown_tool')).toBe(false);
      expect(handler.isVaultTool('bash')).toBe(false);
      expect(handler.isVaultTool('read')).toBe(false);
    });
  });

  describe('getSupportedTools', () => {
    it('should return all supported vault tools', () => {
      const tools = handler.getSupportedTools();
      expect(tools).toContain('file_read');
      expect(tools).toContain('file_write');
      expect(tools).toContain('dir_read');
      expect(tools).toContain('glob_search');
      expect(tools).toContain('get_links');
      expect(tools).toContain('get_tags');
    });
  });

  describe('file_read', () => {
    it('should read existing file', async () => {
      const result = await handler.handleTool('file_read', { path: 'test.md' });
      expect(result.success).toBe(true);
      expect(result.content).toBe('# Test File\n\nHello, world!');
    });

    it('should return error for non-existent file', async () => {
      const result = await handler.handleTool('file_read', { path: 'nonexistent.md' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('File not found');
    });

    it('should return error when path is missing', async () => {
      const result = await handler.handleTool('file_read', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('path is required');
    });
  });

  describe('file_write', () => {
    it('should modify existing file', async () => {
      const result = await handler.handleTool('file_write', {
        path: 'existing.md',
        content: 'New content',
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain('existing.md');
    });

    it('should create new file', async () => {
      const result = await handler.handleTool('file_write', {
        path: 'new-file.md',
        content: 'Brand new content',
      });
      expect(result.success).toBe(true);
      expect(result.content).toContain('Created');
    });

    it('should return error when path is missing', async () => {
      const result = await handler.handleTool('file_write', { content: 'test' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('path is required');
    });
  });

  describe('dir_read', () => {
    it('should return empty array for empty folder', async () => {
      // Setup folder with no children
      mockPlugin._testSetup([
        { path: 'empty-folder', content: '', isFolder: true },
      ]);

      const result = await handler.handleTool('dir_read', { path: 'empty-folder' });
      expect(result.success).toBe(true);
      const files = JSON.parse(result.content);
      expect(files).toEqual([]);
    });

    it('should return error for non-existent folder', async () => {
      const result = await handler.handleTool('dir_read', { path: 'nonexistent' });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Folder not found');
    });

    it('should return error when path is missing', async () => {
      const result = await handler.handleTool('dir_read', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('path is required');
    });
  });

  describe('glob_search', () => {
    it('should return empty array when no files match', async () => {
      const result = await handler.handleTool('glob_search', { pattern: 'nonexistent*.md' });
      expect(result.success).toBe(true);
      const files = JSON.parse(result.content);
      expect(files).toEqual([]);
    });

    it('should return error when pattern is missing', async () => {
      const result = await handler.handleTool('glob_search', {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('pattern is required');
    });
  });

  describe('get_links', () => {
    it('should return outgoing links', async () => {
      const result = await handler.handleTool('get_links', { path: 'test.md' });
      expect(result.success).toBe(true);
      const links = JSON.parse(result.content);
      expect(links.outgoing).toContain('linked-file.md');
    });

    it('should return error for non-existent file', async () => {
      const result = await handler.handleTool('get_links', { path: 'nonexistent.md' });
      expect(result.success).toBe(false);
    });
  });

  describe('get_tags', () => {
    it('should return tags', async () => {
      const result = await handler.handleTool('get_tags', { path: 'test.md' });
      expect(result.success).toBe(true);
      const tags = JSON.parse(result.content);
      expect(tags.tags).toContain('#example');
    });

    it('should return error for non-existent file', async () => {
      const result = await handler.handleTool('get_tags', { path: 'nonexistent.md' });
      expect(result.success).toBe(false);
    });
  });

  describe('unknown tool', () => {
    it('should return error for unknown tool', async () => {
      const result = await handler.handleTool('unknown_tool' as VaultToolName, {});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Unknown tool');
    });
  });
});