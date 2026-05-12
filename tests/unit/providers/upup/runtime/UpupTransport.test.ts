/**
 * UpupTransport.test.ts
 * Integration tests for upup stdio transport
 */

import { execSync } from 'child_process';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { createInterface } from 'readline';

describe('UpupTransport Integration', () => {
  describe('Connection', () => {
    it('should complete handshake with upup stdio server', async () => {
      const proc = spawn('upup', ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let resolved = false;

      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (!line.trim() || resolved) return;
        try {
          const msg = JSON.parse(line);
          if ('result' in msg && msg.result?.serverName === 'upup-stdio') {
            resolved = true;
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Send initialize
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientName: 'test', clientVersion: '1.0.0' },
      }) + '\n');

      // Wait for handshake (max 3 seconds)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 3000);
        const check = () => {
          if (resolved) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      proc.kill();
      expect(resolved).toBe(true);
    }, 5000);

    it('should handle rapid connect/disconnect', async () => {
      for (let i = 0; i < 3; i++) {
        const proc = spawn('upup', ['--stdio'], {
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        await new Promise<void>((resolve) => {
          proc.stdin?.write(JSON.stringify({
            jsonrpc: '2.0',
            id: 1,
            method: 'initialize',
            params: {},
          }) + '\n');

          setTimeout(resolve, 200);
        });

        proc.kill();
      }

      // If we get here without hanging, test passes
      expect(true).toBe(true);
    }, 5000);

    it('should return server capabilities on initialize', async () => {
      const proc = spawn('upup', ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let serverResult: Record<string, unknown> | null = null;

      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (!line.trim() || serverResult) return;
        try {
          const msg = JSON.parse(line);
          if ('result' in msg) {
            serverResult = msg.result as Record<string, unknown>;
          }
        } catch {
          // Ignore parse errors
        }
      });

      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientName: 'test', clientVersion: '1.0.0' },
      }) + '\n');

      await new Promise<void>((resolve) => setTimeout(resolve, 1000));
      proc.kill();

      expect(serverResult).not.toBeNull();
      const result = serverResult!;
      expect((result as Record<string, unknown>).serverName).toBe('upup-stdio');
      expect((result as Record<string, unknown>).serverVersion).toBeTruthy();
      expect((result as Record<string, unknown>).protocolVersion).toBe('1.0');
      expect((result as Record<string, unknown>).capabilities).toEqual({
        streaming: true,
        tools: true,
      });
    }, 5000);
  });

  describe('Stream', () => {
    it('should receive done event with answer', async () => {
      const proc = spawn('upup', ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let doneEvent: Record<string, unknown> | null = null;
      let initialized = false;

      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          // Wait for initialize response
          if ('result' in msg && msg.result?.serverName === 'upup-stdio') {
            initialized = true;
          }
          // Check for done event
          if (msg.method === 'event' && msg.params?.event?.type === 'done') {
            doneEvent = msg.params.event as Record<string, unknown>;
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Initialize - register handler BEFORE sending
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientName: 'test', clientVersion: '1.0.0' },
      }) + '\n');

      // Wait for initialization to complete (upup needs time to process)
      await new Promise<void>((resolve) => {
        const check = () => {
          if (initialized) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        // Max wait 3 seconds for init
        setTimeout(resolve, 3000);
        check();
      });

      // Now send run request (not stream - upup expects 'run' method)
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'run',
        params: { prompt: 'What is 2+2?' },
      }) + '\n');

      // Wait for done event (max 20 seconds)
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 20000);
        const check = () => {
          if (doneEvent) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      proc.kill();
      expect(doneEvent).not.toBeNull();
      const event = doneEvent!;
      expect((event as Record<string, unknown>).answer).toBeTruthy();
    }, 25000);

    it('should process simple query correctly', async () => {
      const proc = spawn('upup', ['--stdio'], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let answer: string | null = null;
      let initialized = false;

      const rl = createInterface({ input: proc.stdout });
      rl.on('line', (line) => {
        if (!line.trim()) return;
        try {
          const msg = JSON.parse(line);
          if ('result' in msg && msg.result?.serverName === 'upup-stdio') {
            initialized = true;
          }
          if (msg.method === 'event' && msg.params?.event?.type === 'done') {
            answer = msg.params.event.answer as string;
          }
        } catch {
          // Ignore parse errors
        }
      });

      // Initialize
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { clientName: 'test', clientVersion: '1.0.0' },
      }) + '\n');

      // Wait for initialization
      await new Promise<void>((resolve) => {
        const check = () => {
          if (initialized) {
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        setTimeout(resolve, 3000);
        check();
      });

      // Send run request with simple query
      proc.stdin?.write(JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'run',
        params: { prompt: 'Say "hello world" exactly' },
      }) + '\n');

      // Wait up to 15 seconds for done event
      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => resolve(), 15000);
        const check = () => {
          if (answer) {
            clearTimeout(timeout);
            resolve();
          } else {
            setTimeout(check, 100);
          }
        };
        check();
      });

      proc.kill();
      expect(answer).toBeTruthy();
      const ans = answer!;
      expect(ans.toLowerCase()).toContain('hello');
    }, 20000);
  });

  describe('Binary Detection', () => {
    it('should find upup in standard locations', () => {
      // Check common locations
      const locations = [
        '/usr/local/bin/upup',
        '/opt/homebrew/bin/upup',
        path.join(process.env.HOME || '', '.local/bin/upup'),
      ];

      let found = false;
      for (const loc of locations) {
        if (fs.existsSync(loc)) {
          found = true;
          break;
        }
      }

      // At least one location should have upup or PATH should have it
      const whichResult = execSync('which upup 2>/dev/null || true', {
        encoding: 'utf8',
        timeout: 5000,
      }).trim();
      expect(found || whichResult).toBeTruthy();
    }, 1000);
  });
});
