import { spawn } from 'child_process';

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string>;
  args?: string[];
  signal?: AbortSignal;
}

export interface SpawnedProcess {
  stdin: NodeJS.WritableStream | null;
  stdout: NodeJS.ReadableStream | null;
  stderr: NodeJS.ReadableStream | null;
  kill(signal?: string): void;
  on(event: 'exit' | 'close', listener: (code: number | null, signal: string | null) => void): this;
  on(event: 'error', listener: (err: Error) => void): this;
}

/**
 * 创建 upup 子进程生成函数（Electron 兼容）
 */
export function createUpupSpawnFunction(
  cliPath: string,
): (options: SpawnOptions) => SpawnedProcess {
  return (options: SpawnOptions): SpawnedProcess => {
    const { cwd, env, signal } = options;

    const proc = spawn(cliPath, options.args ?? [], {
      cwd,
      env: env as NodeJS.ProcessEnv,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });

    // Electron 兼容：手动处理 AbortSignal
    if (signal) {
      if (signal.aborted) {
        proc.kill();
      } else {
        signal.addEventListener('abort', () => proc.kill(), { once: true });
      }
    }

    return proc as unknown as SpawnedProcess;
  };
}