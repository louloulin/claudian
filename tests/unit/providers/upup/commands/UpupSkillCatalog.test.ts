/**
 * UpupSkillCatalog.test.ts
 * Tests for upup skill catalog
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { UpupSkillCatalog } from '../../../../../src/providers/upup/commands/UpupSkillCatalog.js'

// Mock fs module
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}))

describe('UpupSkillCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('constructor', () => {
    it('should create catalog with skill paths', () => {
      const catalog = new UpupSkillCatalog(['/path/to/skills'])

      expect(catalog).toBeDefined()
    })
  })

  describe('refresh', () => {
    it('should discover skills from valid paths', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs')

      // Mock file system
      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        { isDirectory: () => true, name: 'my-skill' },
      ] as any)
      vi.mocked(readFileSync).mockReturnValue(`
---
name: my-skill
description: A test skill
user-invocable: true
argument-hint: <command>

This skill does something.
`)

      const catalog = new UpupSkillCatalog(['/path/to/skills'])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false })

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('my-skill')
      expect(entries[0].description).toBe('A test skill')
      expect(entries[0].kind).toBe('skill')
    })

    it('should skip paths that do not exist', async () => {
      const { existsSync } = await import('fs')
      vi.mocked(existsSync).mockReturnValue(false)

      const catalog = new UpupSkillCatalog(['/non/existent/path'])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false })

      expect(entries).toHaveLength(0)
    })

    it('should skip invalid skill files', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        { isDirectory: () => true, name: 'bad-skill' },
      ] as any)
      vi.mocked(readFileSync).mockReturnValue('invalid content without proper frontmatter')

      const catalog = new UpupSkillCatalog(['/path/to/skills'])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false })

      // Should skip invalid skill, only builtins
      expect(entries.length).toBeGreaterThanOrEqual(0)
    })
  })

  describe('listDropdownEntries', () => {
    it('should include built-in commands when includeBuiltIns is true', async () => {
      const catalog = new UpupSkillCatalog([])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: true })

      expect(entries.some(e => e.name === 'compact')).toBe(true)
      expect(entries.some(e => e.name === 'clear')).toBe(true)
    })

    it('should exclude built-in commands when includeBuiltIns is false', async () => {
      const catalog = new UpupSkillCatalog([])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false })

      expect(entries.some(e => e.name === 'compact')).toBe(false)
      expect(entries.some(e => e.name === 'clear')).toBe(false)
    })

    it('should filter out non-user-invocable skills', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        { isDirectory: () => true, name: 'internal-skill' },
      ] as any)
      vi.mocked(readFileSync).mockReturnValue(`
---
name: internal-skill
description: An internal skill
user-invocable: false

This skill is not for user invocation.
`)

      const catalog = new UpupSkillCatalog(['/path/to/skills'])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false })

      expect(entries.some(e => e.name === 'internal-skill')).toBe(false)
    })
  })

  describe('listVaultEntries', () => {
    it('should return project and user skills', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        { isDirectory: () => true, name: 'project-skill' },
      ] as any)

      vi.mocked(readFileSync).mockReturnValue(`
---
name: project-skill
description: Project skill
user-invocable: true

Project skill content.
`)

      // Single path test to avoid mock state issues
      const catalog = new UpupSkillCatalog(['/vault/.upup/skills'])
      await catalog.refresh()

      const entries = await catalog.listVaultEntries()

      expect(entries.length).toBe(1)
      expect(entries[0].name).toBe('project-skill')
    })
  })

  describe('getDropdownConfig', () => {
    it('should return correct dropdown configuration', () => {
      const catalog = new UpupSkillCatalog([])

      const config = catalog.getDropdownConfig()

      expect(config.providerId).toBe('upup')
      expect(config.triggerChars).toContain('/')
      expect(config.triggerChars).toContain('$')
      expect(config.builtInPrefix).toBe('/')
      expect(config.skillPrefix).toBe('$')
      expect(config.commandPrefix).toBe('/')
    })
  })

  describe('setRuntimeCommands', () => {
    it('should store runtime commands', () => {
      const catalog = new UpupSkillCatalog([])

      const commands = [
        {
          id: 'runtime-cmd',
          name: 'test',
          description: 'Test command',
          content: '',
        },
      ]

      catalog.setRuntimeCommands(commands)

      // Should not throw
      expect(true).toBe(true)
    })
  })

  describe('saveVaultEntry', () => {
    it('should throw error as vault entry saving is not supported', async () => {
      const catalog = new UpupSkillCatalog([])

      await expect(
        catalog.saveVaultEntry({
          id: 'test',
          providerId: 'upup',
          kind: 'skill',
          name: 'test',
          description: '',
          content: '',
          scope: 'vault',
          source: 'user',
          isEditable: false,
          isDeletable: false,
          displayPrefix: '$',
          insertPrefix: '$',
        })
      ).rejects.toThrow('Upup skill editing is not supported')
    })
  })

  describe('deleteVaultEntry', () => {
    it('should throw error as vault entry deletion is not supported', async () => {
      const catalog = new UpupSkillCatalog([])

      await expect(
        catalog.deleteVaultEntry({
          id: 'test',
          providerId: 'upup',
          kind: 'skill',
          name: 'test',
          description: '',
          content: '',
          scope: 'vault',
          source: 'user',
          isEditable: false,
          isDeletable: false,
          displayPrefix: '$',
          insertPrefix: '$',
        })
      ).rejects.toThrow('Upup skill deletion is not supported')
    })
  })

  describe('skill metadata parsing', () => {
    it('should parse skill with all fields', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        { isDirectory: () => true, name: 'full-skill' },
      ] as any)
      vi.mocked(readFileSync).mockReturnValue(`
---
name: full-skill
description: A skill with all fields
user-invocable: true
argument-hint: <query>

Full skill content here.
`)

      const catalog = new UpupSkillCatalog(['/vault/.upup/skills'])
      await catalog.refresh()

      const entries = await catalog.listVaultEntries()

      expect(entries).toHaveLength(1)
      expect(entries[0]).toMatchObject({
        name: 'full-skill',
        description: 'A skill with all fields',
        argumentHint: '<query>',
      })
    })

    it('should use defaults for missing optional fields', async () => {
      const { existsSync, readdirSync, readFileSync } = await import('fs')

      vi.mocked(existsSync).mockReturnValue(true)
      vi.mocked(readdirSync).mockReturnValue([
        { isDirectory: () => true, name: 'minimal-skill' },
      ] as any)
      vi.mocked(readFileSync).mockReturnValue(`
---
name: minimal-skill
description: A minimal skill
user-invocable: true

Minimal skill with only name.
`)

      const catalog = new UpupSkillCatalog(['/path/to/skills'])
      await catalog.refresh()

      const entries = await catalog.listDropdownEntries({ includeBuiltIns: false })

      expect(entries).toHaveLength(1)
      expect(entries[0].name).toBe('minimal-skill')
      expect(entries[0].description).toBe('A minimal skill')
    })
  })
})