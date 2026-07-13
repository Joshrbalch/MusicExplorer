import { ItemView, WorkspaceLeaf } from "obsidian";
import * as React from "react";
import { createRoot, Root } from "react-dom/client";
import { AlbumLibraryApp } from "./app";
import { MyPluginSettings } from "./settings"; // <--- Import settings

export const MUSIC_LIBRARY_VIEW_TYPE = "music-library-view";

export class MusicLibraryView extends ItemView {
    root: Root | null = null;
    settings: MyPluginSettings;
    saveSettings: () => Promise<void>; // <-- Declare it here

    constructor(leaf: WorkspaceLeaf, settings: MyPluginSettings, saveSettings: () => Promise<void>) {
        super(leaf);
        this.settings = settings;
        this.saveSettings = saveSettings; // <-- Save it to the class
    }

    getViewType(): string {
        return MUSIC_LIBRARY_VIEW_TYPE;
    }

    getDisplayText(): string {
        return "Music Library Explorer";
    }

    getIcon(): string {
        return "disc"; 
    }

    async onOpen(): Promise<void> {
        const container = this.containerEl.children[1];
        container.empty();
        
        this.root = createRoot(container.createDiv({ cls: "music-library-react-root" }));
        this.root.render(
            <React.StrictMode>
                {/* Pass it down into the React App */}
                <AlbumLibraryApp app={this.app} settings={this.settings} saveSettings={this.saveSettings} /> 
            </React.StrictMode>
        );
    }

    async onClose(): Promise<void> {
        // Clean up React tree to prevent memory leaks when the leaf closes
        if (this.root) {
            this.root.unmount();
        }
    }
}