/**
 * VaultWatcher.test.ts
 * 单元测试 for VaultWatcher
 */

import { TFile } from 'obsidian';

import type { VaultEvent } from '../../../../../src/providers/upup/vault/VaultWatcher';
import { VaultWatcher } from '../../../../../src/providers/upup/vault/VaultWatcher';

// Mock EventRef
interface MockEventRef {
  id: number;
}

// Mock TFile for proper instanceof checks
 
const MockTFile = TFile as any;
function createMockTFile(path: string) {
  const file = new MockTFile();
  Object.defineProperty(file, 'path', { value: path, writable: true });
  Object.defineProperty(file, 'stat', { value: { mtime: Date.now() }, writable: true });
  Object.defineProperty(file, 'basename', { value: '', writable: true });
  Object.defineProperty(file, 'extension', { value: '.md', writable: true });
  return file;
}

// Mock Obsidian API
const createMockPlugin = () => {
  const eventHandlers: Map<string, Set<(file: TFile, oldPath?: string) => void>> = new Map();
  const eventRefs: MockEventRef[] = [];
  let refId = 0;

  return {
    app: {
      vault: {
        on: (event: string, handler: (file: TFile, oldPath?: string) => void): MockEventRef => {
          if (!eventHandlers.has(event)) {
            eventHandlers.set(event, new Set());
          }
          eventHandlers.get(event)!.add(handler);
          const ref = { id: ++refId };
          eventRefs.push(ref);
          return ref;
        },
        off: (_event: string, _handler: () => void) => {},
        offref: (ref: MockEventRef) => {
          // Remove handlers associated with this ref (simplified for tests)
        },
      },
      metadataCache: {
        on: (event: string, handler: (file: TFile, oldPath?: string) => void): MockEventRef => {
          if (!eventHandlers.has(event)) {
            eventHandlers.set(event, new Set());
          }
          eventHandlers.get(event)!.add(handler);
          const ref = { id: ++refId };
          eventRefs.push(ref);
          return ref;
        },
        off: (_event: string, _handler: () => void) => {},
        offref: (ref: MockEventRef) => {},
      },
      // Helper to simulate events
      _simulateEvent: (eventName: string, file: TFile, oldPath?: string) => {
        const handlers = eventHandlers.get(eventName);
        if (handlers) {
          for (const handler of handlers) {
            try {
              if (oldPath) {
                handler(file, oldPath);
              } else {
                handler(file);
              }
            } catch {
              // Ignore handler errors in tests
            }
          }
        }
      },
    },
  };
};

describe('VaultWatcher', () => {
  let watcher: VaultWatcher;
  let mockPlugin: ReturnType<typeof createMockPlugin>;

  beforeEach(() => {
    mockPlugin = createMockPlugin();
    watcher = new VaultWatcher(mockPlugin as any);
  });

  afterEach(() => {
    watcher.stop();
  });

  describe('start/stop', () => {
    it('should start listening', () => {
      expect(watcher.isRunning()).toBe(false);
      watcher.start();
      expect(watcher.isRunning()).toBe(true);
    });

    it('should not start twice', () => {
      watcher.start();
      const firstStart = watcher.isRunning();
      watcher.start(); // should not throw
      expect(watcher.isRunning()).toBe(firstStart);
    });

    it('should stop listening', () => {
      watcher.start();
      expect(watcher.isRunning()).toBe(true);
      watcher.stop();
      expect(watcher.isRunning()).toBe(false);
    });

    it('should do nothing when stopping without start', () => {
      watcher.stop(); // should not throw
      expect(watcher.isRunning()).toBe(false);
    });
  });

  describe('onFileChange', () => {
    it('should register callback and return unsubscribe function', () => {
      const callback = jest.fn();
      const unsubscribe = watcher.onFileChange(callback);
      expect(typeof unsubscribe).toBe('function');
    });

    it('should call callback on file create event', () => {
      const callback = jest.fn();
      watcher.onFileChange(callback);
      watcher.start();

      // Simulate file create event with proper TFile-like object
      const mockFile = createMockTFile('test.md');
      mockPlugin.app._simulateEvent('create', mockFile);

      // The callback should have been called with a VaultEvent
      expect(callback).toHaveBeenCalled();
      const eventArg = callback.mock.calls[0][0] as VaultEvent;
      expect(eventArg.type).toBe('create');
      expect(eventArg.path).toBe('test.md');
    });

    it('should call callback on file modify event', () => {
      const callback = jest.fn();
      watcher.onFileChange(callback);
      watcher.start();

      const mockFile = createMockTFile('modified.md');
      mockPlugin.app._simulateEvent('modify', mockFile);

      expect(callback).toHaveBeenCalled();
      const eventArg = callback.mock.calls[0][0] as VaultEvent;
      expect(eventArg.type).toBe('modify');
    });

    it('should allow multiple callbacks', () => {
      const callback1 = jest.fn();
      const callback2 = jest.fn();

      watcher.onFileChange(callback1);
      watcher.onFileChange(callback2);
      watcher.start();

      const mockFile = createMockTFile('multi.md');
      mockPlugin.app._simulateEvent('create', mockFile);

      expect(callback1).toHaveBeenCalled();
      expect(callback2).toHaveBeenCalled();
    });

    it('should remove callback when unsubscribe is called', () => {
      const callback = jest.fn();
      const unsubscribe = watcher.onFileChange(callback);
      unsubscribe();
      watcher.start();

      // After unsubscribe, callback should not be called
      const mockFile = createMockTFile('unsub-test.md');
      mockPlugin.app._simulateEvent('create', mockFile);

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('file filtering', () => {
    it('should only notify .md files', () => {
      const callback = jest.fn();
      watcher.onFileChange(callback);
      watcher.start();

      // Non-.md files should be filtered out
      const nonMdFile = createMockTFile('document.txt');
      mockPlugin.app._simulateEvent('create', nonMdFile);

      expect(callback).not.toHaveBeenCalled();
    });

    it('should notify .md files', () => {
      const callback = jest.fn();
      watcher.onFileChange(callback);
      watcher.start();

      const mdFile = createMockTFile('my-note.md');
      mockPlugin.app._simulateEvent('create', mdFile);

      expect(callback).toHaveBeenCalled();
    });
  });
});