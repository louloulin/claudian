/**
 * UpupSettingsReconciler.test.ts
 * Tests for upup settings reconciler
 */

import { describe, expect,it } from 'vitest'

import type { Conversation } from '../../../../../src/core/types/chat.js'
// Import the actual module
import { upupSettingsReconciler } from '../../../../../src/providers/upup/env/UpupSettingsReconciler.js'

// Helper function to simulate env hash computation (mirrors implementation)
function computeEnvHash(envText: string): string {
  const UPUP_ENV_HASH_KEYS = [
    'OPENAI_API_KEY',
    'OPENAI_BASE_URL',
    'ANTHROPIC_API_KEY',
    'ANTHROPIC_BASE_URL',
    'GOOGLE_API_KEY',
    'XAI_API_KEY',
    'DEEPSEEK_API_KEY',
    'MOONSHOT_API_KEY',
    'OLLAMA_BASE_URL',
    'OPENROUTER_API_KEY',
  ]

  const result: Record<string, string> = {}
  if (envText) {
    const lines = envText.split('\n')
    for (const line of lines) {
      const trimmed = line.trim()
      if (trimmed && !trimmed.startsWith('#')) {
        const eqIndex = trimmed.indexOf('=')
        if (eqIndex > 0) {
          const key = trimmed.substring(0, eqIndex).trim()
          const value = trimmed.substring(eqIndex + 1).trim()
          result[key] = value
        }
      }
    }
  }

  return UPUP_ENV_HASH_KEYS
    .filter(key => result[key])
    .map(key => `${key}=${result[key]}`)
    .sort()
    .join('|')
}

const now = Date.now()

describe('upupSettingsReconciler', () => {
  describe('reconcileModelWithEnvironment', () => {
    it('should invalidate upup conversations when hash differs', () => {
      // Set up settings that will produce a different hash
      const settings: Record<string, unknown> = {
        providerConfigs: {
          upup: {
            environmentVariables: 'OPENAI_API_KEY=sk-new-key',
            environmentHash: 'OPENAI_API_KEY=sk-old-key',
          },
        },
      }

      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          providerId: 'upup',
          title: 'Test',
          sessionId: 'session-1',
          createdAt: now,
          updatedAt: now,
          messages: [],
        },
        {
          id: 'conv-2',
          providerId: 'claude',
          title: 'Claude Test',
          sessionId: 'claude-session',
          createdAt: now,
          updatedAt: now,
          messages: [],
        },
      ]

      const result = upupSettingsReconciler.reconcileModelWithEnvironment(settings, conversations)

      expect(result.changed).toBe(true)
      expect(result.invalidatedConversations).toHaveLength(1)
      expect(result.invalidatedConversations[0].id).toBe('conv-1')
      expect(result.invalidatedConversations[0].sessionId).toBeNull()
    })

    it('should clear providerState when invalidating conversations', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          upup: {
            environmentVariables: 'ANTHROPIC_API_KEY=sk-ant-new',
            environmentHash: '',
          },
        },
      }

      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          providerId: 'upup',
          title: 'Test',
          sessionId: 'session-123',
          providerState: { someState: 'value' },
          createdAt: now,
          updatedAt: now,
          messages: [],
        },
      ]

      const result = upupSettingsReconciler.reconcileModelWithEnvironment(settings, conversations)

      expect(result.invalidatedConversations[0].providerState).toBeUndefined()
    })

    it('should detect environment change when API keys change', () => {
      const settings: Record<string, unknown> = {
        providerConfigs: {
          upup: {
            environmentVariables: 'ANTHROPIC_API_KEY=sk-ant-v2',
            environmentHash: 'ANTHROPIC_API_KEY=sk-ant-v1',
          },
        },
      }

      const conversations: Conversation[] = []

      const result = upupSettingsReconciler.reconcileModelWithEnvironment(settings, conversations)

      expect(result.changed).toBe(true)
    })

    it('should return unchanged for non-upup conversations when hash matches', () => {
      const envText = 'OPENAI_API_KEY=sk-test'
      const settings: Record<string, unknown> = {
        providerConfigs: {
          upup: {
            environmentVariables: envText,
            environmentHash: computeEnvHash(envText),
          },
        },
      }

      const conversations: Conversation[] = [
        {
          id: 'conv-1',
          providerId: 'claude',
          title: 'Claude Test',
          sessionId: 'claude-session',
          createdAt: now,
          updatedAt: now,
          messages: [],
        },
      ]

      const result = upupSettingsReconciler.reconcileModelWithEnvironment(settings, conversations)

      // Claude conversations should not be invalidated even if upup hash matches
      expect(result.invalidatedConversations).toHaveLength(0)
    })
  })

  describe('normalizeModelVariantSettings', () => {
    it('should return false when no model is set', () => {
      const settings: Record<string, unknown> = {}

      const result = upupSettingsReconciler.normalizeModelVariantSettings(settings)

      expect(result).toBe(false)
    })

    it('should return false for empty string model', () => {
      const settings: Record<string, unknown> = {
        model: '',
      }

      const result = upupSettingsReconciler.normalizeModelVariantSettings(settings)

      expect(result).toBe(false)
    })
  })

  // Note: handleEnvironmentChange uses getRuntimeEnvironmentText which joins
// shared and provider-specific env vars, making isolated testing complex.
// The reconciliation behavior is tested above.
})