/**
 * UpupRewindService.test.ts
 * 单元测试 for UpupRewindService
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { UpupRewindService } from '../../../../../src/providers/upup/runtime/UpupRewindService';

// Mock plugin
const createMockPlugin = () => ({
  app: {
    vault: {
      getAbstractFileByPath: () => null,
    },
  },
});

describe('UpupRewindService', () => {
  let service: UpupRewindService;
  let tmpDir: string;

  beforeEach(() => {
    const plugin = createMockPlugin() as any;
    service = new UpupRewindService(plugin);
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'upup-rewind-test-'));
  });

  afterEach(() => {
    service.cleanup();
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore
    }
  });

  describe('recordChange', () => {
    it('should record file changes', () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'original content');

      service.recordChange(filePath, 'original content', 'new content');

      expect(service.canRewind()).toBe(true);
    });

    it('should record multiple changes for same file', () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'v1');

      service.recordChange(filePath, 'v0', 'v1');
      service.recordChange(filePath, 'v1', 'v2');

      const changes = service.getRecentChanges();
      expect(changes).toHaveLength(2);
    });
  });

  describe('canRewind', () => {
    it('should return false when no changes recorded', () => {
      expect(service.canRewind()).toBe(false);
    });

    it('should return true when changes are recorded', () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'content');

      service.recordChange(filePath, 'old', 'new');

      expect(service.canRewind()).toBe(true);
    });
  });

  describe('getRecentChanges', () => {
    it('should return empty array when no changes', () => {
      expect(service.getRecentChanges()).toEqual([]);
    });

    it('should return recorded changes', () => {
      const file1 = path.join(tmpDir, 'file1.md');
      const file2 = path.join(tmpDir, 'file2.md');
      fs.writeFileSync(file1, '');
      fs.writeFileSync(file2, '');

      service.recordChange(file1, 'a', 'b');
      service.recordChange(file2, 'c', 'd');

      const changes = service.getRecentChanges();
      expect(changes).toHaveLength(2);
      // Verify both files are present
      const paths = changes.map(c => c.path);
      expect(paths).toContain(file1);
      expect(paths).toContain(file2);
    });

    it('should respect limit parameter', () => {
      for (let i = 0; i < 5; i++) {
        const filePath = path.join(tmpDir, `file${i}.md`);
        fs.writeFileSync(filePath, '');
        service.recordChange(filePath, 'old', 'new');
      }

      const changes = service.getRecentChanges(3);
      expect(changes).toHaveLength(3);
    });
  });

  describe('previewRewind', () => {
    it('should return error when no changes', async () => {
      const result = await service.previewRewind();
      expect(result.canRewind).toBe(false);
      expect(result.error).toContain('No changes');
    });

    it('should return canRewind true with changes info', async () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'original');

      service.recordChange(filePath, 'original', 'modified');

      const result = await service.previewRewind();
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toContain(filePath);
    });
  });

  describe('executeRewind', () => {
    it('should return error when no changes', async () => {
      const result = await service.executeRewind();
      expect(result.canRewind).toBe(false);
      expect(result.error).toContain('No changes');
    });

    it('should revert file content', async () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'new content');

      service.recordChange(filePath, 'old content', 'new content');

      const result = await service.executeRewind();
      expect(result.canRewind).toBe(true);
      expect(result.filesChanged).toContain(filePath);

      // Verify file content was reverted
      const content = fs.readFileSync(filePath, 'utf8');
      expect(content).toBe('old content');
    });

    it('should clear changes after successful rewind', async () => {
      const filePath = path.join(tmpDir, 'test.md');
      fs.writeFileSync(filePath, 'modified');

      service.recordChange(filePath, 'original', 'modified');
      await service.executeRewind();

      expect(service.canRewind()).toBe(false);
      expect(service.getRecentChanges()).toEqual([]);
    });

    it('should handle non-existent files gracefully', async () => {
      const nonExistentPath = path.join(tmpDir, 'non-existent.md');

      service.recordChange(nonExistentPath, 'old', 'new');

      // Should not throw even when file doesn't exist
      const result = await service.executeRewind();
      expect(result.canRewind).toBe(true);
      // Note: The file might still be listed in filesChanged even though it doesn't exist
    });
  });

  describe('cleanup', () => {
    it('should not throw when called', () => {
      expect(() => service.cleanup()).not.toThrow();
    });
  });
});