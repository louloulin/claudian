import type { ProviderCommandCatalog } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandDropdownConfig } from '../../../core/providers/commands/ProviderCommandCatalog';
import type { ProviderCommandEntry } from '../../../core/providers/commands/ProviderCommandEntry';
import type { SlashCommand } from '../../../core/types';

const UPUP_SKILL_ID_PREFIX = 'upup-skill-';

/**
 * Upup Skill Catalog
 *
 * Discovers skills from upup-agent's skill directories and exposes them
 * as commands/skills for the command dropdown.
 *
 * Skill directories scanned:
 * - Builtin: upup-agent/src/skills/
 * - User: .claude/skills/
 * - Project: .upup/skills/
 */
export class UpupSkillCatalog implements ProviderCommandCatalog {
  private skills: UpupSkillInfo[] = [];
  private runtimeCommands: SlashCommand[] = [];

  constructor(private readonly skillPaths: string[]) {}

  /**
   * Discover skills from configured paths.
   */
  async refresh(): Promise<void> {
    this.skills = await this.discoverSkills();
  }

  /**
   * Discover skills from skill paths.
   */
  private async discoverSkills(): Promise<UpupSkillInfo[]> {
    const skills: UpupSkillInfo[] = [];

    try {
      const { existsSync, readdirSync, readFileSync } = await import('fs');
      const { join } = await import('path');

      for (const basePath of this.skillPaths) {
        if (!existsSync(basePath)) {
          continue;
        }

        try {
          const entries = readdirSync(basePath, { withFileTypes: true });

          for (const entry of entries) {
            if (entry.isDirectory()) {
              const skillPath = join(basePath, entry.name, 'SKILL.md');
              if (existsSync(skillPath)) {
                try {
                  const content = readFileSync(skillPath, 'utf-8');
                  const metadata = this.parseSkillMetadata(content, skillPath, basePath);
                  skills.push(metadata);
                } catch {
                  // Skip invalid skill files
                }
              }
            }
          }
        } catch {
          // Skip directories that can't be read
        }
      }
    } catch {
      // FS module not available
    }

    return skills;
  }

  /**
   * Parse skill metadata from SKILL.md content.
   */
  private parseSkillMetadata(
    content: string,
    path: string,
    sourcePath: string
  ): UpupSkillInfo {
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);
    const userInvocableMatch = content.match(/^user-invocable:\s*(true|false)$/m);
    const argumentHintMatch = content.match(/^argument-hint:\s*(.+)$/m);

    const name = nameMatch?.[1]?.trim() ?? 'unknown';
    const description = descMatch?.[1]?.trim() ?? '';
    const userInvocable = userInvocableMatch?.[1]?.trim() === 'true';
    const argumentHint = argumentHintMatch?.[1]?.trim();

    // Determine source based on path
    const source: 'builtin' | 'user' | 'project' =
      path.includes('.upup/skills/') ? 'project' :
      path.includes('.claude/skills/') ? 'user' : 'builtin';

    return {
      id: `${UPUP_SKILL_ID_PREFIX}${name}`,
      name,
      description,
      userInvocable,
      argumentHint,
      source,
      path,
      scope: source === 'builtin' ? 'system' : source === 'user' ? 'user' : 'vault',
    };
  }

  /**
   * List dropdown entries for command palette.
   */
  async listDropdownEntries(context: {
    includeBuiltIns: boolean;
  }): Promise<ProviderCommandEntry[]> {
    const entries = this.skills
      .filter((skill) => skill.userInvocable !== false)
      .map((skill) => this.skillToCommandEntry(skill));

    // Include builtin compact command if requested
    if (context.includeBuiltIns) {
      const builtInEntries = await this.listBuiltInEntries();
      return [...builtInEntries, ...entries];
    }

    return entries;
  }

  /**
   * List vault-specific entries (project skills).
   */
  async listVaultEntries(): Promise<ProviderCommandEntry[]> {
    return this.skills
      .filter((skill) => skill.source === 'project' || skill.source === 'user')
      .map((skill) => this.skillToCommandEntry(skill));
  }

  /**
   * Convert skill to command entry.
   */
  private skillToCommandEntry(skill: UpupSkillInfo): ProviderCommandEntry {
    return {
      id: skill.id,
      providerId: 'upup',
      kind: 'skill',
      name: skill.name,
      description: skill.description,
      content: '', // Loaded on demand
      argumentHint: skill.argumentHint,
      scope: skill.scope,
      source: 'user',
      isEditable: false,
      isDeletable: false,
      displayPrefix: '$',
      insertPrefix: '$',
    };
  }

  /**
   * Built-in commands for upup.
   */
  private async listBuiltInEntries(): Promise<ProviderCommandEntry[]> {
    return [
      {
        id: 'upup-builtin-compact',
        providerId: 'upup',
        kind: 'command',
        name: 'compact',
        description: 'Compact conversation history',
        content: '',
        scope: 'system',
        source: 'builtin',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      },
      {
        id: 'upup-builtin-clear',
        providerId: 'upup',
        kind: 'command',
        name: 'clear',
        description: 'Clear conversation context',
        content: '',
        scope: 'system',
        source: 'builtin',
        isEditable: false,
        isDeletable: false,
        displayPrefix: '/',
        insertPrefix: '/',
      },
    ];
  }

  /**
   * Save vault entry (not supported for upup skills yet).
   */
  async saveVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    // Skills are read-only from file system
    throw new Error('Upup skill editing is not supported');
  }

  /**
   * Delete vault entry (not supported for upup skills yet).
   */
  async deleteVaultEntry(_entry: ProviderCommandEntry): Promise<void> {
    // Skills are read-only from file system
    throw new Error('Upup skill deletion is not supported');
  }

  /**
   * Set runtime commands (from runtime command discovery).
   */
  setRuntimeCommands(commands: SlashCommand[]): void {
    this.runtimeCommands = commands;
  }

  /**
   * Get dropdown configuration.
   */
  getDropdownConfig(): ProviderCommandDropdownConfig {
    return {
      providerId: 'upup',
      triggerChars: ['/', '$'],
      builtInPrefix: '/',
      skillPrefix: '$',
      commandPrefix: '/',
    };
  }
}

/**
 * Skill info interface for internal tracking.
 */
export interface UpupSkillInfo {
  id: string;
  name: string;
  description: string;
  userInvocable?: boolean;
  argumentHint?: string;
  source: 'builtin' | 'user' | 'project';
  scope: 'system' | 'user' | 'vault';
  path: string;
}
