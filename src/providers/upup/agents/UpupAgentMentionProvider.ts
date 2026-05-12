import type { AgentMentionSource } from '../../../core/providers/types';
import type { AgentMentionProvider } from '../../../core/providers/types';

/**
 * Upup skill metadata for agent mention discovery.
 */
export interface UpupSkillInfo {
  id: string;
  name: string;
  description: string;
  source: AgentMentionSource;
  path: string;
}

/**
 * Upup Agent Mention Provider
 *
 * Discovers skills from the upup workspace and exposes them as agents
 * for the @mention feature. Skills are discovered from the upup-agent's
 * skill directories.
 */
export class UpupAgentMentionProvider implements AgentMentionProvider {
  private skills: UpupSkillInfo[] = [];

  constructor(private readonly skillPaths: string[]) {}

  /**
   * Discover skills from configured skill paths.
   * Call this after construction or when skills change.
   */
  async loadAgents(): Promise<void> {
    this.skills = [];

    // Dynamically import to avoid issues when upup-agent is not available
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
                  const metadata = this.parseSkillMetadata(content, skillPath);
                  this.skills.push(metadata);
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
      // FS module not available (browser environment)
    }
  }

  /**
   * Parse skill metadata from SKILL.md content.
   */
  private parseSkillMetadata(content: string, path: string): UpupSkillInfo {
    // Simple frontmatter parsing (name: and description: at the start)
    const nameMatch = content.match(/^name:\s*(.+)$/m);
    const descMatch = content.match(/^description:\s*(.+)$/m);

    const name = nameMatch?.[1]?.trim() ?? 'unknown';
    const description = descMatch?.[1]?.trim() ?? '';

    return {
      id: name,
      name,
      description,
      source: 'vault' as const,
      path,
    };
  }

  /**
   * Search for skills matching the query.
   */
  searchAgents(query: string): UpupSkillInfo[] {
    if (!query) {
      return this.skills;
    }

    const q = query.toLowerCase();
    return this.skills.filter(
      (skill) =>
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q)
    );
  }

  /**
   * Get all available agents (skills).
   */
  getAvailableAgents(): UpupSkillInfo[] {
    return this.skills;
  }
}
