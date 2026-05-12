/**
 * transformUpupEvent.test.ts
 * Tests for upup event transformation
 */

import type { TransformStreamState } from '../../../../../src/providers/upup/stream/transformUpupEvent'
import { transformUpupEvent } from '../../../../../src/providers/upup/stream/transformUpupEvent'

// Helper functions to create test state (matching implementation)
function createStreamState(): TransformStreamState {
  return {
    currentToolId: '',
    accumulatedInput: '',
    partialJson: {},
    accumulatedText: '',
  }
}

function resetStreamState(state: TransformStreamState): void {
  state.currentToolId = ''
  state.accumulatedInput = ''
  state.partialJson = {}
  state.accumulatedText = ''
}

function safeJsonParse(text: string): unknown | null {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

describe('transformUpupEvent', () => {
  describe('thinking events', () => {
    it('should transform thinking event with content', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'thinking', data: { content: 'Let me analyze this problem' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'thinking', content: 'Let me analyze this problem' })
    })

    it('should handle thinking event without content', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'thinking', data: {} }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(0)
    })

    it('should handle thinking event with empty data', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'thinking', data: null }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(0)
    })
  })

  describe('message lifecycle events', () => {
    it('should emit assistant_message_start on message_start', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'message_start', data: { runId: 'run-123' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'assistant_message_start' })
    })

    it('should emit done on message_complete', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'message_complete', data: {} }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'done' })
    })
  })

  describe('content delta events', () => {
    it('should transform content_delta with text content', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'content_delta', data: { content: 'Hello, world!' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'text', content: 'Hello, world!' })
    })

    it('should handle content_delta with incremental text', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event1 = { type: 'content_delta', data: { content: 'Hello' } }
      const event2 = { type: 'content_delta', data: { content: ', world' } }

      const chunks1 = [...transformUpupEvent(event1, options)]
      const chunks2 = [...transformUpupEvent(event2, options)]

      expect(chunks1[0]).toEqual({ type: 'text', content: 'Hello' })
      expect(chunks2[0]).toEqual({ type: 'text', content: ', world' })
    })

    it('should handle content_delta without content', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'content_delta', data: {} }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(0)
    })
  })

  describe('tool call events', () => {
    it('should transform tool_call_start event', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'tool_call_start',
        data: { id: 'tool-1', name: 'bash', args: { command: 'ls' } },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        type: 'tool_use',
        id: 'tool-1',
        name: 'bash',
        input: {},
      })
      expect(state.currentToolId).toBe('tool-1')
    })

    it('should generate tool id if not provided', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'tool_call_start', data: { name: 'read' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        type: 'tool_use',
        name: 'read',
      })
      expect((chunks[0] as { id: string }).id).toMatch(/^tool-\d+$/)
    })

    it('should transform tool_call_delta with string input', () => {
      const state = createStreamState()
      state.currentToolId = 'tool-1'
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'tool_call_delta',
        data: { id: 'tool-1', input: '{"command": "ls -la"}' },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        type: 'tool_use',
        id: 'tool-1',
        input: { command: 'ls -la' },
      })
    })

    it('should accumulate partial JSON input', () => {
      const state = createStreamState()
      state.currentToolId = 'tool-1'
      const options = { streamState: state, contextWindow: 128000 }

      const event1 = {
        type: 'tool_call_delta',
        data: { input: '{"command": "' },
      }
      const event2 = {
        type: 'tool_call_delta',
        data: { input: 'ls -la"}' },
      }

      // First partial should yield nothing (incomplete JSON)
      const chunks1 = [...transformUpupEvent(event1, options)]
      expect(chunks1).toHaveLength(0)

      // After full JSON received, should yield chunk
      const chunks2 = [...transformUpupEvent(event2, options)]
      expect(chunks2).toHaveLength(1)
      expect(chunks2[0]).toMatchObject({
        type: 'tool_use',
        input: { command: 'ls -la' },
      })
    })

    it('should transform tool_call_delta with object input', () => {
      const state = createStreamState()
      state.currentToolId = 'tool-1'
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'tool_call_delta',
        data: { input: { path: '/home' } },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        type: 'tool_use',
        input: { path: '/home' },
      })
    })

    it('should transform tool_call_complete event', () => {
      const state = createStreamState()
      state.currentToolId = 'tool-1'
      state.partialJson = { command: 'ls' }
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'tool_call_complete', data: { id: 'tool-1' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        type: 'tool_use',
        id: 'tool-1',
        input: { command: 'ls' },
      })
      expect(state.currentToolId).toBe('')
    })
  })

  describe('tool result events', () => {
    it('should transform tool_result event', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'tool_result',
        data: { id: 'tool-1', content: 'file1.txt\nfile2.txt' },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool_result',
        id: 'tool-1',
        content: 'file1.txt\nfile2.txt',
        isError: undefined,
      })
    })

    it('should handle tool_result with isError flag', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'tool_result',
        data: { id: 'tool-1', content: 'Error: permission denied', isError: true },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks[0]).toMatchObject({
        type: 'tool_result',
        id: 'tool-1',
        isError: true,
      })
    })

    it('should handle tool_result with empty content', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'tool_result', data: { id: 'tool-1' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'tool_result',
        id: 'tool-1',
        content: '',
        isError: undefined,
      })
    })
  })

  describe('error events', () => {
    it('should transform error event with message', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'error',
        data: { message: 'Connection failed' },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({
        type: 'error',
        content: 'Connection failed',
      })
    })

    it('should handle error with empty message', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'error', data: {} }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks[0]).toEqual({
        type: 'error',
        content: 'Unknown error',
      })
    })

    it('should handle error with no data', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'error', data: null }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks[0]).toEqual({
        type: 'error',
        content: 'Unknown error',
      })
    })
  })

  describe('done events', () => {
    it('should emit done on done event', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'done', data: { output: 'Final response' } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toEqual({ type: 'done' })
    })
  })

  describe('unknown event types', () => {
    it('should ignore unknown event types', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { type: 'unknown_event', data: { anything: true } }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(0)
    })

    it('should handle event with no type', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = { data: {} } as { type: string; data?: unknown }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(0)
    })
  })

  describe('message_delta with usage', () => {
    it('should transform message_delta with usage data', () => {
      const state = createStreamState()
      const options = { streamState: state, contextWindow: 128000 }

      const event = {
        type: 'message_delta',
        data: {
          usage: { inputTokens: 100, outputTokens: 50 },
        },
      }
      const chunks = [...transformUpupEvent(event, options)]

      expect(chunks).toHaveLength(1)
      expect(chunks[0]).toMatchObject({
        type: 'usage',
      })
      expect(chunks[0]).toHaveProperty('usage')
    })
  })
})

describe('createStreamState', () => {
  it('should create a new stream state with defaults', () => {
    const state = createStreamState()

    expect(state).toEqual({
      currentToolId: '',
      accumulatedInput: '',
      partialJson: {},
      accumulatedText: '',
    })
  })
})

describe('resetStreamState', () => {
  it('should reset all state fields', () => {
    const state: TransformStreamState = {
      currentToolId: 'tool-123',
      accumulatedInput: 'some input',
      partialJson: { key: 'value' },
      accumulatedText: 'some text',
    }

    resetStreamState(state)

    expect(state).toEqual({
      currentToolId: '',
      accumulatedInput: '',
      partialJson: {},
      accumulatedText: '',
    })
  })
})

describe('safeJsonParse', () => {
  it('should parse valid JSON', () => {
    const result = safeJsonParse('{"key": "value"}')
    expect(result).toEqual({ key: 'value' })
  })

  it('should parse JSON arrays', () => {
    const result = safeJsonParse('[1, 2, 3]')
    expect(result).toEqual([1, 2, 3])
  })

  it('should return null for invalid JSON', () => {
    const result = safeJsonParse('not valid json')
    expect(result).toBeNull()
  })

  it('should return null for empty string', () => {
    const result = safeJsonParse('')
    expect(result).toBeNull()
  })

  it('should parse nested JSON', () => {
    const result = safeJsonParse('{"nested": {"deep": true}}')
    expect(result).toEqual({ nested: { deep: true } })
  })
})