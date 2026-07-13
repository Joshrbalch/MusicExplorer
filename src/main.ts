import {
    Notice,
    Plugin,
} from 'obsidian';
import {
    DEFAULT_SETTINGS,
    MyPluginSettings,
    SampleSettingTab,
} from './settings';
import { MusicLibraryView, MUSIC_LIBRARY_VIEW_TYPE } from './view';

export default class MusicLibraryPlugin extends Plugin {
    settings!: MyPluginSettings;

    async onload() {
        await this.loadSettings();

        // 1. Register the custom React View creator function
        this.registerView(
            MUSIC_LIBRARY_VIEW_TYPE,
            (leaf) => new MusicLibraryView(
                leaf, 
                this.settings, 
                async () => { await this.saveSettings(); } // <-- Add this save function!
            )
        );

        // 2. Add an icon to the left ribbon panel to trigger the view
        this.addRibbonIcon('disc', 'Open Music Library', () => {
            this.activateView();
        });

        // 3. Add a explicit command to the command palette (Ctrl/Cmd + P)
        this.addCommand({
            id: 'open-music-library',
            name: 'Open Library Explorer',
            callback: () => this.activateView(),
        });

        // Keep the boilerplate settings tab activation
        this.addSettingTab(new SampleSettingTab(this.app, this));
    }

    // Opens or reveals the custom view tab in the workspace workspace area
    async activateView() {
        const { workspace } = this.app;

        let leaf = workspace.getLeavesOfType(MUSIC_LIBRARY_VIEW_TYPE)[0];

        if (!leaf) {
            // Instantiates a new leaf tab in the active workspace split
            const activeLeaf = workspace.getLeaf(true);
            if (activeLeaf) {
                leaf = activeLeaf;
                await leaf.setViewState({
                    type: MUSIC_LIBRARY_VIEW_TYPE,
                    active: true,
                });
            }
        }

        if (leaf) {
            workspace.revealLeaf(leaf);
        }
    }

    onunload() {
        // Obsidian automatically unregisters custom views when the plugin is turned off
    }

    async loadSettings() {
        this.settings = Object.assign(
            {},
            DEFAULT_SETTINGS,
            (await this.loadData()) as Partial<MyPluginSettings>,
        );
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}