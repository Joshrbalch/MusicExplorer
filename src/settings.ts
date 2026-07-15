import { App, PluginSettingTab, Setting } from 'obsidian';
import MusicLibraryPlugin from './main';

// 1. Define the shape of our settings
export interface MyPluginSettings {
    collections: string[];
    storageFolder: string;
}

// 2. Set the default collections for when the plugin first installs
export const DEFAULT_SETTINGS: MyPluginSettings = {
    collections: ['Unsorted', 'Favorites', 'To Listen', 'Top 10'],
    storageFolder: 'Music'
}

// 3. Build the actual settings menu UI
export class SampleSettingTab extends PluginSettingTab {
    plugin: MusicLibraryPlugin;

    constructor(app: App, plugin: MusicLibraryPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const {containerEl} = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Music Library Settings' });

        // --- NEW: STORAGE FOLDER SETTING ---
        new Setting(containerEl)
            .setName('Storage folder')
            .setDesc('The folder where album notes will be created.')
            .addText(text => text
                .setPlaceholder('Music')
                .setValue(this.plugin.settings.storageFolder)
                .onChange(async (value) => {
                    this.plugin.settings.storageFolder = value;
                    await this.plugin.saveSettings();
                }));

        // --- EXISTING: COLLECTIONS SETTING ---
        new Setting(containerEl)
            .setName('Library Collections')
            .setDesc('A comma-separated list of your collections.')
            .addText(text => text
                .setPlaceholder('Unsorted, Favorites, Vinyl...')
                .setValue(this.plugin.settings.collections.join(', '))
                .onChange(async (value) => {
                    // Split the string by commas, remove extra spaces, and save
                    this.plugin.settings.collections = value.split(',').map(s => s.trim()).filter(s => s !== '');
                    await this.plugin.saveSettings();
                }));
    }
}