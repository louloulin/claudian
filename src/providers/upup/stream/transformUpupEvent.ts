import type { StreamChunk } from '../../../core/types';

interface ToolUseData {
  name?: string;
  id?: string;
  input?: unknown;
}

interface ToolResultData {
  id?: string;
  content?: string;
  isError?: boolean;
}

interface ContentDeltaData {
  content?: string;
}

interface ThinkingData {
  content?: string;
}

interface UsageData {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  contextWindow?: number;
  contextTokens?: number;
}

interface ErrorData {
  message?: string;
  code?: number;
}

export interface TransformStreamState {
  currentToolId: string;
  accumulatedInput: string;
  partialJson: Record<string, unknown>;
  accumulatedText: string;
}

export interface TransformOptions {
  streamState: TransformStreamState;
  contextWindow?: number;
}

function createStreamState(): TransformStreamState {
  return {
    currentToolId: '',
    accumulatedInput: '',
    partialJson: {},
    accumulatedText: '',
  };
}

function resetStreamState(state: TransformStreamState): void {
  state.currentToolId = '';
  state.accumulatedInput = '';
  state.partialJson = {};
  state.accumulatedText = '';
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function buildUsageInfo(data: UsageData, contextWindow?: number): {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  contextWindow: number;
  contextTokens: number;
  percentage: number;
} {
  const inputTokens = data.inputTokens ?? 0;
  const outputTokens = data.outputTokens ?? 0;
  const totalTokens = data.totalTokens ?? 0;
  const cacheCreation = data.cacheCreationInputTokens ?? 0;
  const cacheRead = data.cacheReadInputTokens ?? 0;
  const contextTokens = data.contextTokens ?? inputTokens + cacheCreation + cacheRead;
  const cw = data.contextWindow ?? contextWindow ?? 200_000;
  const percentage = Math.round((contextTokens / cw) * 100);

  return {
    inputTokens,
    outputTokens,
    totalTokens,
    ...(cacheCreation > 0 ? { cacheCreationInputTokens: cacheCreation } : {}),
    ...(cacheRead > 0 ? { cacheReadInputTokens: cacheRead } : {}),
    contextWindow: cw,
    contextTokens,
    percentage,
  };
}

// Partial tool_use chunk (upup-specific extension)
interface PartialToolUseChunk {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
  isPartial: boolean;
}

/**
 * 将 upup StreamEvent 转换为 Claudian StreamChunk
 */
export function* transformUpupEvent(
  event: { type: string; data?: unknown },
  options: TransformOptions,
): Generator<StreamChunk> {
  const { streamState } = options;

  switch (event.type) {
    case 'thinking': {
      const data = event.data as ThinkingData;
      if (data?.content) {
        yield { type: 'thinking', content: data.content };
      }
      break;
    }

    case 'message_start': {
      yield { type: 'assistant_message_start' };
      break;
    }

    case 'content_delta': {
      const data = event.data as ContentDeltaData;
      if (data?.content) {
        yield { type: 'text', content: data.content };
      }
      break;
    }

    case 'message_delta': {
      const data = event.data as UsageData;
      if (data) {
        yield {
          type: 'usage',
          usage: buildUsageInfo(data, options.contextWindow),
        };
      }
      break;
    }

    case 'tool_call_start': {
      const data = event.data as ToolUseData;
      const toolId = data?.id ?? `tool-${Date.now()}`;
      streamState.currentToolId = toolId;
      streamState.accumulatedInput = '';
      streamState.partialJson = {};
      yield {
        type: 'tool_use',
        id: toolId,
        name: data?.name ?? '',
        input: {},
      };
      break;
    }

    case 'tool_call_delta': {
      const data = event.data as ToolUseData;
      if (data?.input) {
        const inputStr = typeof data.input === 'string' ? data.input : JSON.stringify(data.input);
        streamState.accumulatedInput += inputStr;
        const parsed = safeJsonParse(streamState.accumulatedInput);
        if (parsed !== null && typeof parsed === 'object') {
          streamState.partialJson = parsed as Record<string, unknown>;
          yield {
            type: 'tool_use',
            id: streamState.currentToolId,
            name: data?.name ?? '',
            input: streamState.partialJson,
          } as PartialToolUseChunk;
        }
      }
      break;
    }

    case 'tool_call_complete': {
      yield {
        type: 'tool_use',
        id: streamState.currentToolId,
        name: '',
        input: streamState.partialJson,
      };
      resetStreamState(streamState);
      break;
    }

    case 'tool_result': {
      const data = event.data as ToolResultData;
      yield {
        type: 'tool_result',
        id: data?.id ?? '',
        content: data?.content ?? '',
        isError: data?.isError,
      };
      break;
    }

    case 'error': {
      const data = event.data as ErrorData;
      yield {
        type: 'error',
        content: data?.message ?? 'Unknown error',
      };
      break;
    }

    case 'message_complete':
    case 'done': {
      yield { type: 'done' };
      break;
    }

    default:
      break;
  }
}

export { createStreamState };