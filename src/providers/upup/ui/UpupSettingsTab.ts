import { Setting } from 'obsidian';

import type { ProviderSettingsTabRenderer } from '../../../core/providers/types';
import { renderEnvironmentSettingsSection } from '../../../features/settings/ui/EnvironmentSettingsSection';
import { t } from '../../../i18n/i18n';
import { getUpupProviderSettings, updateUpupProviderSettings, type UpupLLMProvider } from '../settings';

/**
 * Upup Settings Tab Renderer
 *
 * Provides UI for configuring:
 * - Enable/disable provider
 * - CLI path
 * - LLM provider selection (8 providers)
 * - Environment variables (API keys)
 */
export const upupSettingsTabRenderer: ProviderSettingsTabRenderer = {
  render(container, context) {
    const settingsBag = context.plugin.settings as unknown as Record<string, unknown>;
    const upupSettings = getUpupProviderSettings(settingsBag);

    // --- Setup ---

    new Setting(container).setName(t('settings.setup')).setHeading();

    new Setting(container)
      .setName('Enable Upup provider')
      .setDesc('When enabled, Upup models appear in the model selector for new conversations.')
      .addToggle((toggle) =>
        toggle
          .setValue(upupSettings.enabled)
          .onChange(async (value) => {
            updateUpupProviderSettings(settingsBag, { enabled: value });
            await context.plugin.saveSettings();
            context.refreshModelSelectors();
          })
      );

    // --- CLI Path ---

    new Setting(container)
      .setName('upup-agent CLI path')
      .setDesc('Path to upup-agent TypeScript source. Set UPUP_AGENT_PATH env var or use auto-detect.')
      .addText((text) =>
        text
          .setPlaceholder('auto-detect')
          .setValue(upupSettings.cliPath || '')
          .onChange(async (value) => {
            updateUpupProviderSettings(settingsBag, { cliPath: value || 'auto' });
            await context.plugin.saveSettings();
          })
      );

    // --- LLM Provider ---

    new Setting(container).setName('LLM Provider').setHeading();

    const PROVIDERS: { value: UpupLLMProvider; label: string }[] = [
      { value: 'openai', label: 'OpenAI' },
      { value: 'anthropic', label: 'Anthropic' },
      { value: 'google', label: 'Google' },
      { value: 'xai', label: 'xAI' },
      { value: 'deepseek', label: 'DeepSeek' },
      { value: 'ollama', label: 'Ollama' },
      { value: 'openrouter', label: 'OpenRouter' },
      { value: 'moonshot', label: 'Moonshot' },
    ];

    new Setting(container)
      .setName('Active Provider')
      .setDesc('Select the LLM provider to use by default.')
      .addDropdown((dropdown) => {
        for (const p of PROVIDERS) {
          dropdown.addOption(p.value, p.label);
        }
        dropdown.setValue(upupSettings.provider);
        dropdown.onChange(async (value) => {
          updateUpupProviderSettings(settingsBag, { provider: value as UpupLLMProvider });
          await context.plugin.saveSettings();
        });
      });

    // --- Model ---

    new Setting(container).setName('Default Model').setHeading();

    new Setting(container)
      .setName('Model')
      .setDesc('Default model to use with the selected provider.')
      .addText((text) =>
        text
          .setPlaceholder('gpt-4o')
          .setValue(upupSettings.model)
          .onChange(async (value) => {
            updateUpupProviderSettings(settingsBag, { model: value || 'gpt-4o' });
            await context.plugin.saveSettings();
          })
      );

    // --- Enabled Providers ---

    new Setting(container).setName('Available Providers').setHeading();

    const providerDesc = container.createDiv({ cls: 'setting-item-description' });
    providerDesc.setText('Enable or disable individual LLM providers. Enabled providers appear in the model selector.');

    for (const p of PROVIDERS) {
      const isEnabled = upupSettings.enabledProviders[p.value] ?? false;
      new Setting(container)
        .setName(p.label)
        .addToggle((toggle) =>
          toggle
            .setValue(isEnabled)
            .onChange(async (value) => {
              const newEnabledProviders = {
                ...upupSettings.enabledProviders,
                [p.value]: value,
              };
              updateUpupProviderSettings(settingsBag, { enabledProviders: newEnabledProviders });
              await context.plugin.saveSettings();
              context.refreshModelSelectors();
            })
        );
    }

    // --- Environment ---

    renderEnvironmentSettingsSection({
      container,
      plugin: context.plugin,
      scope: 'provider:upup',
      heading: t('settings.environment'),
      name: 'Upup environment',
      desc: 'Configure API keys and endpoints for LLM providers. Supported variables: OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_API_KEY, etc.',
      placeholder: `OPENAI_API_KEY=your-key\nANTHROPIC_API_KEY=your-key\nGOOGLE_API_KEY=your-key`,
      renderCustomContextLimits: (target) => context.renderCustomContextLimits(target, 'upup'),
    });
  },
};
