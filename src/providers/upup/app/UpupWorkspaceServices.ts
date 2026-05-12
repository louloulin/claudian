import * as os from 'os';
import { join } from 'path';

import type { ProviderWorkspaceRegistration, ProviderWorkspaceServices } from '../../../core/providers/types';
import type ClaudianPlugin from '../../../main';
import { getVaultPath } from '../../../utils/path';
import { UpupAgentMentionProvider } from '../agents/UpupAgentMentionProvider';
import { UpupSkillCatalog } from '../commands/UpupSkillCatalog';
import { upupSettingsTabRenderer } from '../ui/UpupSettingsTab';

export interface UpupWorkspaceServices extends ProviderWorkspaceServices {
  agentMentionProvider: UpupAgentMentionProvider;
  commandCatalog: UpupSkillCatalog;
  settingsTabRenderer: typeof upupSettingsTabRenderer;
}

/**
 * Get skill paths for upup discovery.
 * Scans in order: user (~/.claude/skills/), project (.upup/skills/, .claude/skills/)
 */
function getSkillPaths(vaultPath: string | null, homePath: string): string[] {
  const paths: string[] = [];

  // User skills: ~/.claude/skills/
  paths.push(join(homePath, 'skills'));

  // Project skills: {vault}/.upup/skills/
  if (vaultPath) {
    paths.push(join(vaultPath, '.upup', 'skills'));
    // Also check .claude/skills in vault
    paths.push(join(vaultPath, '.claude', 'skills'));
  }

  return paths;
}

export async function createUpupWorkspaceServices(
  plugin: ClaudianPlugin,
): Promise<UpupWorkspaceServices> {
  const vaultPath = getVaultPath(plugin.app);
  const homePath = os.homedir();
  const skillPaths = getSkillPaths(vaultPath, homePath);

  // Create agent mention provider
  const agentMentionProvider = new UpupAgentMentionProvider(skillPaths);
  await agentMentionProvider.loadAgents();

  // Create skill catalog
  const commandCatalog = new UpupSkillCatalog(skillPaths);
  await commandCatalog.refresh();

  return {
    agentMentionProvider,
    commandCatalog,
    settingsTabRenderer: upupSettingsTabRenderer,
    refreshAgentMentions: async () => {
      await agentMentionProvider.loadAgents();
      await commandCatalog.refresh();
    },
  };
}

export const upupWorkspaceRegistration: ProviderWorkspaceRegistration<UpupWorkspaceServices> = {
  async initialize({ plugin }) {
    return createUpupWorkspaceServices(plugin);
  },
};