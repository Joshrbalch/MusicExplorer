import * as React from "react";
import { useState, useEffect } from "react";
import { App as ObsidianApp, TFile, normalizePath, Notice, Menu } from "obsidian";
import { MyPluginSettings } from "./settings";

interface AppProps {
    app: ObsidianApp;
    settings: MyPluginSettings;
    saveSettings: () => Promise<void>;
}

export const AlbumLibraryApp: React.FC<AppProps> = ({ app, settings, saveSettings }) => {
    // 1. Local Library State
    const [localAlbums, setLocalAlbums] = useState<TFile[]>([]);
    const [localSearchQuery, setLocalSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("title"); // NEW: Sort state
    const [activeCollection, setActiveCollection] = useState("All"); // NEW: Collection filter state
    
    // 2. Web Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchType, setSearchType] = useState("all");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    // 3. UI/Modal State
    const [collections, setCollections] = useState<string[]>(settings.collections);
    const [newColInput, setNewColInput] = useState("");
    const [isColModalOpen, setIsColModalOpen] = useState(false);
    const [isAddModalOpen, setIsAddModalOpen] = useState(false);
    
    const [albumToDelete, setAlbumToDelete] = useState<TFile | null>(null);

    useEffect(() => {
        loadLocalLibrary();
        const eventRef = app.metadataCache.on("changed", () => {
            loadLocalLibrary();
        });
        return () => app.metadataCache.offref(eventRef);
    }, []);

    const loadLocalLibrary = () => {
        const files = app.vault.getMarkdownFiles();
        const albums = files.filter(file => {
            const cache = app.metadataCache.getFileCache(file);
            return cache?.frontmatter && cache.frontmatter.album_collection;
        });
        setLocalAlbums(albums);
    };

    // NEW: Data Pipeline - Extract, Filter, and Sort
    const processedAlbums = localAlbums
        .map(file => {
            const cache = app.metadataCache.getFileCache(file);
            return {
                file,
                title: file.basename.replace(".md", ""),
                artist: cache?.frontmatter?.artist || "Unknown Artist",
                cover: cache?.frontmatter?.cover || "",
                collection: cache?.frontmatter?.album_collection || "Unsorted",
                rating: Number(cache?.frontmatter?.rating) || 0 
            };
        })
        .filter(album => {
            const matchesSearch = !localSearchQuery || album.title.toLowerCase().includes(localSearchQuery.toLowerCase()) || album.artist.toLowerCase().includes(localSearchQuery.toLowerCase());
            const matchesCollection = activeCollection === "All" || album.collection === activeCollection;
            return matchesSearch && matchesCollection;
        })
        .sort((a, b) => {
            if (sortBy === "rating") return b.rating - a.rating;
            if (sortBy === "artist") return a.artist.localeCompare(b.artist);
            return a.title.localeCompare(b.title);
        });

    const handleWebSearch = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        
        let queryStr = searchQuery;
        if (searchType === "artist") {
            queryStr = `artist:"${searchQuery}"`;
        } else if (searchType === "album") {
            queryStr = `release:"${searchQuery}"`;
        }

        try {
            const res = await fetch(`https://musicbrainz.org/ws/2/release?query=${encodeURIComponent(queryStr)}&limit=50&fmt=json`);
            const data = await res.json();
            
            let rawReleases = data.releases || [];
            rawReleases.sort((a: any, b: any) => (b.score || 0) - (a.score || 0));

            const uniqueAlbums: any[] = [];
            const seen = new Set();
            
            for (const album of rawReleases) {
                const title = album.title.toLowerCase();
                const artist = album["artist-credit"]?.[0]?.name?.toLowerCase() || "unknown";
                const uniqueKey = `${title}-${artist}`;
                
                if (!seen.has(uniqueKey)) {
                    seen.add(uniqueKey);
                    uniqueAlbums.push(album);
                }
            }

            setSearchResults(uniqueAlbums);
        } catch (error) {
            console.error("Search failed:", error);
            new Notice("Failed to search MusicBrainz.");
        }
        setLoading(false);
    };

    const addToLibrary = async (album: any) => {
        const title = album.title.replace(/[\\/:*?"<>|]/g, ""); 
        const artist = album["artist-credit"]?.[0]?.name || "Unknown Artist";
        const date = album.date ? album.date.substring(0, 4) : "Unknown Year";
        const mbid = album.id; 
        const coverUrl = `https://coverartarchive.org/release/${mbid}/front`;
        const folderName = settings.storageFolder || "";
        const filename = normalizePath(`${folderName}/${title} - ${artist}.md`);

        if (folderName) {
            const folderExists = app.vault.getAbstractFileByPath(folderName);
            if (!folderExists) {
                await app.vault.createFolder(folderName);
            }
        }
        
        let tracks: any[] = [];
        let genres: string[] = [];
        let releaseType = album["release-group"]?.["primary-type"] || "Album";

        try {
            const res = await fetch(`https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings+genres&fmt=json`);
            const deepData = await res.json();
            
            if (deepData.media && deepData.media.length > 0) {
                tracks = deepData.media[0].tracks || [];
            }
            if (deepData.genres && deepData.genres.length > 0) {
                genres = deepData.genres.map((g: any) => g.name);
            }
        } catch (error) {
            console.error("Failed to fetch deep data:", error);
        }

        const genresString = genres.length > 0 ? `[${genres.map(g => `"${g}"`).join(", ")}]` : `[]`;
        
        const tracklistMarkdown = tracks.length > 0 
            ? tracks.map((t: any) => `- [ ] ${t.recording?.title || "Unknown Track"}`).join("\n")
            : "_Tracklist not available._";

        const frontmatter = `---
cover: "${coverUrl}"
artist: "${artist}"
year: "${date}"
album_collection: "Unsorted"
rating: 
genres: ${genresString}
release_type: "${releaseType}"
---
# ${title}

## Review

### Standout Tracks
- 

### Production Notes
- 

### Overall Thoughts
- 

---

## Tracklist
${tracklistMarkdown}

---

## Links
- [MusicBrainz Database](https://musicbrainz.org/release/${mbid})
- [Search Spotify](https://open.spotify.com/search/${encodeURIComponent(artist + " " + title)})
- [Search YouTube](https://www.youtube.com/results?search_query=${encodeURIComponent(artist + " " + title)})
`;

        try {
            const existingFile = app.vault.getAbstractFileByPath(filename);
            if (existingFile) {
                new Notice("Album already exists in library!");
                return;
            }
            await app.vault.create(filename, frontmatter);
            new Notice(`Added ${title} to library!`);
            setSearchResults([]); 
            setIsAddModalOpen(false); 
        } catch (error) {
            console.error("Failed to create file:", error);
        }
    };

    const updateCollection = async (file: TFile, newCollection: string) => {
        try {
            await app.fileManager.processFrontMatter(file, (frontmatter) => {
                frontmatter.album_collection = newCollection;
            });
        } catch (error) {
            console.error("Failed to update collection:", error);
        }
    };

    const executeDelete = async () => {
        if (!albumToDelete) return;
        try {
            await app.vault.trash(albumToDelete, true);
            new Notice(`Deleted ${albumToDelete.basename.replace(".md", "")}`);
            setAlbumToDelete(null); 
            loadLocalLibrary(); 
        } catch (error) {
            console.error("Failed to delete file:", error);
            new Notice("Failed to delete album.");
        }
    };

    const openAlbumNote = async (file: TFile) => {
        const leaf = app.workspace.getLeaf('tab');
        await leaf.openFile(file);
    };

    const handleAddCollection = async (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newColInput.trim();
        if (!trimmed || collections.includes(trimmed)) return;
        
        const updated = [...collections, trimmed];
        setCollections(updated); 
        settings.collections = updated; 
        await saveSettings(); 
        setNewColInput("");
    };

    const handleDeleteCollection = async (colName: string) => {
        const updated = collections.filter(c => c !== colName);
        setCollections(updated);
        settings.collections = updated;
        await saveSettings();
    };

    const closeAddModal = () => {
        setIsAddModalOpen(false);
        setSearchResults([]); 
    };

    const handleContextMenu = (e: React.MouseEvent, file: TFile) => {
        e.preventDefault(); 
        const menu = new Menu();
        menu.addItem((item) => {
            item
                .setTitle("Delete Album")
                .setIcon("trash")
                .onClick(() => {
                    setAlbumToDelete(file);
                });
        });
        menu.showAtMouseEvent(e.nativeEvent);
    };

    return (
        <div className="music-library-container" style={{ position: "relative", height: "100%", paddingBottom: "20px" }}>
            
            {/* TOP ACTION BAR */}
            <div className="header-actions" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "15px", gap: "15px", flexWrap: "wrap" }}>
                <div style={{ display: "flex", gap: "10px", flexGrow: 1, minWidth: "300px" }}>
                    <input 
                        type="text" 
                        value={localSearchQuery} 
                        onChange={(e) => setLocalSearchQuery(e.target.value)} 
                        placeholder="Search my library..."
                        style={{ flexGrow: 1, padding: "8px" }}
                    />
                    <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ padding: "8px", borderRadius: "4px" }}>
                        <option value="title">Sort: Title</option>
                        <option value="artist">Sort: Artist</option>
                        <option value="rating">Sort: Rating</option>
                    </select>
                </div>
                <div style={{ display: "flex", gap: "10px" }}>
                    <button onClick={() => setIsAddModalOpen(true)}>➕ Add Album</button>
                    <button onClick={() => setIsColModalOpen(true)}>⚙️ Collections</button>
                </div>
            </div>

            {/* COLLECTION FILTER BAR - Moved here to be under the search bar */}
            <div style={{ display: "flex", gap: "8px", marginBottom: "25px", overflowX: "auto", paddingBottom: "5px" }}>
                <button 
                    onClick={() => setActiveCollection("All")} 
                    style={{ backgroundColor: activeCollection === "All" ? "var(--interactive-accent)" : "transparent" }}
                >
                    All
                </button>
                {collections.map(col => (
                    <button 
                        key={col} 
                        onClick={() => setActiveCollection(col)}
                        style={{ backgroundColor: activeCollection === col ? "var(--interactive-accent)" : "transparent" }}
                    >
                        {col}
                    </button>
                ))}
            </div>

            {/* ADD ALBUM MODAL */}
            {isAddModalOpen && (
                <div className="modal-overlay" style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.65)", zIndex: 9999,
                    display: "flex", justifyContent: "center", alignItems: "center"
                }}>
                    <div className="modal-content" style={{
                        backgroundColor: "var(--background-primary)", padding: "20px 25px",
                        borderRadius: "8px", border: "1px solid var(--background-modifier-border)",
                        width: "90%", maxWidth: "600px", display: "flex", flexDirection: "column",
                        boxShadow: "0 10px 30px rgba(0,0,0,0.3)"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                            <h3 style={{ margin: 0 }}>Search MusicBrainz</h3>
                            <button onClick={closeAddModal} style={{ padding: "4px 8px", background: "transparent", boxShadow: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
                        </div>

                        <form onSubmit={handleWebSearch} style={{ display: "flex", gap: "10px", marginBottom: "20px" }}>
                            <select 
                                value={searchType}
                                onChange={(e) => setSearchType(e.target.value)}
                                style={{ padding: "8px", borderRadius: "4px", backgroundColor: "var(--background-modifier-form-field)" }}
                            >
                                <option value="all">Keyword</option>
                                <option value="artist">Artist</option>
                                <option value="album">Album</option>
                            </select>
                            <input 
                                type="text" 
                                value={searchQuery} 
                                onChange={(e) => setSearchQuery(e.target.value)} 
                                placeholder="Type to search..."
                                style={{ flexGrow: 1, padding: "8px" }}
                                autoFocus
                            />
                            <button type="submit" disabled={loading}>
                                {loading ? "Searching..." : "Search"}
                            </button>
                        </form>

                        {searchResults.length > 0 && (
                            <div style={{ maxHeight: "55vh", overflowY: "auto", paddingRight: "10px", borderTop: "1px solid var(--background-modifier-border)", paddingTop: "10px" }}>
                                <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
                                    {searchResults.map((album, index) => (
                                        <li key={album.id + index} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 0", borderBottom: "1px solid var(--background-modifier-border)" }}>
                                            <div style={{ display: "flex", flexDirection: "column", paddingRight: "15px" }}>
                                                <strong style={{ fontSize: "14px" }}>{album.title}</strong>
                                                <small style={{ color: "var(--text-muted)" }}>{album["artist-credit"]?.[0]?.name} • {album.date?.substring(0, 4)}</small>
                                            </div>
                                            <button onClick={() => addToLibrary(album)} style={{ whiteSpace: "nowrap" }}>Add</button>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* COLLECTIONS MODAL */}
            {isColModalOpen && (
                <div className="modal-overlay" style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.65)", zIndex: 9999,
                    display: "flex", justifyContent: "center", alignItems: "center"
                }}>
                    <div className="modal-content" style={{
                        backgroundColor: "var(--background-primary)", padding: "20px 25px",
                        borderRadius: "8px", border: "1px solid var(--background-modifier-border)",
                        width: "90%", maxWidth: "450px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)"
                    }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                            <h3 style={{ margin: 0 }}>Manage Collections</h3>
                            <button onClick={() => setIsColModalOpen(false)} style={{ padding: "4px 8px", background: "transparent", boxShadow: "none", color: "var(--text-muted)", cursor: "pointer" }}>✕</button>
                        </div>
                        
                        <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", marginBottom: "20px" }}>
                            {collections.map(col => (
                                <div key={col} style={{ backgroundColor: "var(--background-modifier-active-hover)", padding: "4px 8px", borderRadius: "4px", display: "flex", alignItems: "center", gap: "8px", fontSize: "13px" }}>
                                    {col}
                                    <button 
                                        onClick={() => handleDeleteCollection(col)} 
                                        style={{ padding: "0", background: "transparent", boxShadow: "none", color: "var(--text-error)", cursor: "pointer", height: "auto" }}
                                    >✕</button>
                                </div>
                            ))}
                        </div>

                        <form onSubmit={handleAddCollection} style={{ display: "flex", gap: "10px" }}>
                            <input type="text" value={newColInput} onChange={e => setNewColInput(e.target.value)} placeholder="New collection name..." style={{ flexGrow: 1, padding: "8px" }} />
                            <button type="submit">Add</button>
                        </form>
                    </div>
                </div>
            )}

            {/* DELETE CONFIRMATION MODAL */}
            {albumToDelete && (
                <div className="modal-overlay" style={{
                    position: "fixed", top: 0, left: 0, right: 0, bottom: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.65)", zIndex: 9999,
                    display: "flex", justifyContent: "center", alignItems: "center"
                }}>
                    <div className="modal-content" style={{
                        backgroundColor: "var(--background-primary)", padding: "20px 25px",
                        borderRadius: "8px", border: "1px solid var(--background-modifier-border)",
                        width: "90%", maxWidth: "400px", boxShadow: "0 10px 30px rgba(0,0,0,0.3)",
                        textAlign: "center"
                    }}>
                        <h3 style={{ marginTop: 0 }}>Delete Album?</h3>
                        <p style={{ color: "var(--text-muted)", marginBottom: "25px" }}>
                            Are you sure you want to remove <strong>"{albumToDelete.basename.replace(".md", "")}"</strong> from your library?
                        </p>
                        
                        <div style={{ display: "flex", gap: "15px", justifyContent: "center" }}>
                            <button 
                                onClick={() => setAlbumToDelete(null)} 
                                style={{ flexGrow: 1, background: "transparent", border: "1px solid var(--background-modifier-border)" }}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={executeDelete} 
                                style={{ flexGrow: 1, backgroundColor: "var(--background-modifier-error)", color: "white" }}
                            >
                                Delete
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* LOCAL LIBRARY GRID */}
            <div className="library-grid">
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "15px" }}>
                    {/* NEW: Map over our newly sorted/filtered processedAlbums array */}
                    {processedAlbums.map((album) => {
                        const { file, title, artist, cover, collection, rating } = album;
                        
                        return (
                            <div 
                                key={file.path} 
                                onClick={() => openAlbumNote(file)}
                                onContextMenu={(e) => handleContextMenu(e, file)}
                                style={{ 
                                    display: "flex", flexDirection: "column", border: "1px solid var(--background-modifier-border)", 
                                    padding: "10px", borderRadius: "5px", backgroundColor: "var(--background-secondary)",
                                    cursor: "pointer", position: "relative"
                                }}
                            >
                                {cover && <img src={cover} alt="Cover" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: "4px" }} />}
                                
                                <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", margin: "10px 0" }}>
                                    <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={title}>
                                        {title}
                                    </h4>
                                    <small style={{ color: "var(--text-muted)", fontSize: "12px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={artist}>
                                        {artist}
                                    </small>
                                </div>
                                
                                {/* NEW: Flex container to hold the collection dropdown and the rating badge */}
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
                                    <select 
                                        value={collection} 
                                        onClick={(e) => e.stopPropagation()} 
                                        onChange={(e) => {
                                            e.stopPropagation();
                                            updateCollection(file, e.target.value);
                                        }}
                                        style={{ width: "100%", padding: "5px", borderRadius: "4px", backgroundColor: "var(--background-modifier-form-field)", color: "var(--text-normal)", border: "1px solid var(--background-modifier-border-hover)" }}
                                    >
                                        {collections.map((colName) => (
                                            <option key={colName} value={colName}>
                                                {colName}
                                            </option>
                                        ))}
                                    </select>
                                    
                                    {/* Only display the star and rating if the property actually has a number greater than 0 */}
                                    {rating > 0 && (
                                        <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-accent)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "2px" }}>
                                            ⭐ {rating}
                                        </span>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                    
                    {processedAlbums.length === 0 && localAlbums.length > 0 && (
                        <div style={{ gridColumn: "1 / -1", textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                            No albums found matching "{localSearchQuery}"
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};