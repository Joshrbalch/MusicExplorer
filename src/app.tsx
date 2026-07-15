import * as React from "react";
import { useState, useEffect } from "react";
import { App as ObsidianApp, TFile, normalizePath, Notice, Menu } from "obsidian";
import { MyPluginSettings } from "./settings";
// NEW: Import Recharts components
import { PieChart, Pie, Cell, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid, ResponsiveContainer, Legend } from "recharts";

interface AppProps {
    app: ObsidianApp;
    settings: MyPluginSettings;
    saveSettings: () => Promise<void>;
}

export const AlbumLibraryApp: React.FC<AppProps> = ({ app, settings, saveSettings }) => {
    // 1. Local Library State
    const [localAlbums, setLocalAlbums] = useState<TFile[]>([]);
    const [localSearchQuery, setLocalSearchQuery] = useState("");
    const [sortBy, setSortBy] = useState("title"); 
    const [activeCollection, setActiveCollection] = useState("All"); 
    const [activeGenre, setActiveGenre] = useState("All");
    
    // NEW: Dashboard Tab State
    const [currentTab, setCurrentTab] = useState<"library" | "analytics">("library");
    
    // 2. Bulk Edit State
    const [isManageMode, setIsManageMode] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<TFile[]>([]);
    const [bulkTargetCollection, setBulkTargetCollection] = useState(settings.collections[0] || "Unsorted");
    const [isBulkDeleteModalOpen, setIsBulkDeleteModalOpen] = useState(false);
    
    // 3. Web Search State
    const [searchQuery, setSearchQuery] = useState("");
    const [searchType, setSearchType] = useState("all");
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);
    
    // 4. UI/Modal State
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

    const allMappedAlbums = localAlbums.map(file => {
        const cache = app.metadataCache.getFileCache(file);
        let rawGenres = cache?.frontmatter?.genres || [];
        if (typeof rawGenres === "string") rawGenres = [rawGenres];

        return {
            file,
            title: file.basename.replace(".md", ""),
            artist: cache?.frontmatter?.artist || "Unknown Artist",
            cover: cache?.frontmatter?.cover || "",
            collection: cache?.frontmatter?.album_collection || "Unsorted",
            rating: Number(cache?.frontmatter?.rating) || 0,
            genres: rawGenres,
            year: cache?.frontmatter?.year || "Unknown"
        };
    });

    const availableGenres = Array.from(
        new Set(allMappedAlbums.flatMap(album => album.genres))
    ).filter(Boolean).sort();

    const processedAlbums = allMappedAlbums
        .filter(album => {
            const matchesSearch = !localSearchQuery || album.title.toLowerCase().includes(localSearchQuery.toLowerCase()) || album.artist.toLowerCase().includes(localSearchQuery.toLowerCase());
            const matchesCollection = activeCollection === "All" || album.collection === activeCollection;
            const matchesGenre = activeGenre === "All" || album.genres.includes(activeGenre); 
            return matchesSearch && matchesCollection && matchesGenre;
        })
        .sort((a, b) => {
            if (sortBy === "rating") return b.rating - a.rating;
            if (sortBy === "artist") return a.artist.localeCompare(b.artist);
            return a.title.localeCompare(b.title);
        });

    const handleWebSearch = async (e: React.FormEvent) => {
        e.preventDefault(); 
        if (!searchQuery.trim()) return;
        
        setLoading(true);

        const cleanQuery = searchQuery.replace(/["]/g, "").trim();
        let luceneQuery = "";

        if (searchType === "artist") {
            luceneQuery = `artist:"${cleanQuery}" AND status:official AND primarytype:album`;
        } else if (searchType === "album") {
            luceneQuery = `release:"${cleanQuery}" AND status:official AND primarytype:album`;
        } else {
            luceneQuery = `${cleanQuery} AND status:official AND primarytype:album`;
        }
        
        const url = `https://musicbrainz.org/ws/2/release/?query=${encodeURIComponent(luceneQuery)}&fmt=json&limit=40`;

        try {
            const response = await fetch(url, {
                headers: {
                    "User-Agent": "ObsidianMusicExplorer/1.0.1" 
                }
            });
            
            const data = await response.json();
            
            if (data.releases) {
                const sortedResults = data.releases.sort((a: any, b: any) => {
                    const aTitle = a.title?.toLowerCase() || "";
                    const bTitle = b.title?.toLowerCase() || "";
                    const searchLower = cleanQuery.toLowerCase();
                    
                    const aIsExact = aTitle === searchLower;
                    const bIsExact = bTitle === searchLower;
                    
                    if (searchType === "album" || searchType === "all") {
                        if (aIsExact && !bIsExact) return -1;
                        if (!aIsExact && bIsExact) return 1;
                    }
                    return (b.score || 0) - (a.score || 0);
                });

                const uniqueAlbums: any[] = [];
                const seen = new Set();
                
                for (const album of sortedResults) {
                    const title = album.title?.toLowerCase() || "";
                    const artist = album["artist-credit"]?.[0]?.name?.toLowerCase() || "unknown";
                    const disambig = album.disambiguation ? album.disambiguation.toLowerCase() : "";
                    const uniqueKey = `${title}-${artist}-${disambig}`;
                    
                    if (!seen.has(uniqueKey)) {
                        seen.add(uniqueKey);
                        uniqueAlbums.push(album);
                    }
                }

                setSearchResults(uniqueAlbums);
            }
        } catch (error) {
            console.error("MusicBrainz search failed:", error);
            new Notice("Failed to search MusicBrainz.");
        } finally {
            setLoading(false);
        }
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
            const url = `https://musicbrainz.org/ws/2/release/${mbid}?inc=recordings+genres+release-groups&fmt=json`;
            const res = await fetch(url, {
                headers: {
                    "User-Agent": "ObsidianMusicExplorer/1.0.1" 
                }
            });
            const deepData = await res.json();
            
            if (deepData.media && deepData.media.length > 0) {
                tracks = deepData.media[0].tracks || [];
            }
            
            if (deepData.genres && deepData.genres.length > 0) {
                genres = deepData.genres.map((g: any) => g.name);
            } 
            else if (deepData["release-group"]?.genres && deepData["release-group"].genres.length > 0) {
                genres = deepData["release-group"].genres.map((g: any) => g.name);
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
            setSearchQuery("");
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

    const executeBulkUpdate = async () => {
        if (!bulkTargetCollection || selectedFiles.length === 0) return;
        try {
            for (const file of selectedFiles) {
                await app.fileManager.processFrontMatter(file, (frontmatter) => {
                    frontmatter.album_collection = bulkTargetCollection;
                });
            }
            new Notice(`Successfully moved ${selectedFiles.length} albums to ${bulkTargetCollection}`);
            setSelectedFiles([]);
            setIsManageMode(false);
        } catch (error) {
            console.error("Failed during bulk update:", error);
            new Notice("Failed to update all albums.");
        }
    };

    const executeBulkDelete = async () => {
        if (selectedFiles.length === 0) return;
        try {
            for (const file of selectedFiles) {
                await app.vault.trash(file, true); 
            }
            new Notice(`Deleted ${selectedFiles.length} albums`);
            setSelectedFiles([]);
            setIsManageMode(false);
            setIsBulkDeleteModalOpen(false);
            loadLocalLibrary(); 
        } catch (error) {
            console.error("Failed during bulk delete:", error);
            new Notice("Failed to delete all selected albums.");
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

    // ==========================================
    // NEW: DATA AGGREGATION FOR DASHBOARD
    // ==========================================
    const getGenreChartData = () => {
        const counts: { [key: string]: number } = {};
        allMappedAlbums.forEach(album => {
            album.genres.forEach((g: string) => {
                if (g) counts[g] = (counts[g] || 0) + 1;
            });
        });
        return Object.entries(counts)
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 10); // Top 10 genres to keep pie clean
    };

    const getRatingChartData = () => {
        // 1. Find the maximum rating in your library
        const maxRating = Math.max(...allMappedAlbums.map(a => a.rating), 5); // Default to 5 if empty
        const ceilMax = Math.ceil(maxRating);

        // 2. Initialize dynamic array based on the highest rating found
        const counts = new Array(ceilMax).fill(0);

        // 3. Count albums
        allMappedAlbums.forEach(album => {
            const r = Math.round(album.rating);
            if (r >= 1 && r <= ceilMax) {
                counts[r - 1]++;
            }
        });

        // 4. Map to chart format
        return counts.map((count, index) => ({
            rating: `${index + 1}`, // Label is just the number
            count
        }));
    };

    const CHART_COLORS = ['#8884d8', '#82ca9d', '#ffc658', '#ff8042', '#0088FE', '#00C49F', '#FFBB28', '#FF8042'];

    return (
        <div className="music-library-container" style={{ position: "relative", height: "100%", paddingBottom: "80px" }}>
            
            {/* TAB SELECTOR (MOVED TO VERY TOP) */}
            <div style={{ display: "flex", gap: "15px", borderBottom: "1px solid var(--background-modifier-border)", marginBottom: "20px", paddingBottom: "10px" }}>
                <button 
                    onClick={() => setCurrentTab("library")} 
                    style={{ fontWeight: currentTab === "library" ? "bold" : "normal", borderBottom: currentTab === "library" ? "2px solid var(--interactive-accent)" : "none", background: "transparent", boxShadow: "none", color: currentTab === "library" ? "var(--text-normal)" : "var(--text-muted)" }}
                >
                    Library
                </button>
                <button 
                    onClick={() => {
                        setCurrentTab("analytics");
                        setIsManageMode(false); // Cancel manage mode if they swap to analytics
                        setSelectedFiles([]);
                    }} 
                    style={{ fontWeight: currentTab === "analytics" ? "bold" : "normal", borderBottom: currentTab === "analytics" ? "2px solid var(--interactive-accent)" : "none", background: "transparent", boxShadow: "none", color: currentTab === "analytics" ? "var(--text-normal)" : "var(--text-muted)" }}
                >
                    Analytics
                </button>
            </div>

            {/* ========================================= */}
            {/* VIEW 1: THE LIBRARY GRID                  */}
            {/* ========================================= */}
            <div style={{ display: currentTab === "library" ? "block" : "none" }}>
                    {/* TOP ACTION BAR (MOVED INSIDE THE LIBRARY VIEW) */}
                    <div className="header-actions" style={{ display: "flex", alignItems: "center", marginBottom: "15px", gap: "10px", flexWrap: "wrap" }}>
                        
                        <input 
                            type="text" 
                            value={localSearchQuery} 
                            onChange={(e) => setLocalSearchQuery(e.target.value)} 
                            placeholder="Search my library..."
                            style={{ flexGrow: 1, padding: "8px", minWidth: "150px" }}
                        />
                        
                        <button onClick={() => setIsAddModalOpen(true)} style={{ whiteSpace: "nowrap" }}>
                            Add to Library
                        </button>

                        <select value={activeGenre} onChange={(e) => setActiveGenre(e.target.value)} style={{ padding: "8px", borderRadius: "4px" }}>
                            <option value="All">All Genres</option>
                            {availableGenres.map(genre => (
                                <option key={genre} value={genre}>{genre}</option>
                            ))}
                        </select>

                        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={{ padding: "8px", borderRadius: "4px" }}>
                            <option value="title">Sort: Title</option>
                            <option value="artist">Sort: Artist</option>
                            <option value="rating">Sort: Rating</option>
                        </select>

                        {isManageMode && (
                            <button 
                                onClick={() => {
                                    setIsManageMode(false);
                                    setSelectedFiles([]);
                                }}
                                style={{ backgroundColor: "var(--interactive-accent)", color: "var(--text-on-accent)", whiteSpace: "nowrap" }}
                            >
                                ✓ Done
                            </button>
                        )}

                        <button 
                            onClick={(e) => {
                                const menu = new Menu();
                                
                                if (!isManageMode) {
                                    menu.addItem((item) => {
                                        item.setTitle("Bulk Manage")
                                            .setIcon("pencil")
                                            .onClick(() => {
                                                setIsManageMode(true);
                                                setCurrentTab("library"); 
                                            });
                                    });
                                    menu.addSeparator();
                                }

                                menu.addItem((item) => {
                                    item.setTitle("Edit Collections")
                                        .setIcon("settings")
                                        .onClick(() => setIsColModalOpen(true));
                                });

                                const rect = e.currentTarget.getBoundingClientRect();
                                menu.showAtPosition({ x: rect.left - 4, y: rect.bottom + 4 });
                            }}
                            style={{ padding: "8px 12px" }}
                            title="More Options"
                        >
                            ⋮
                        </button>
                    </div>

                    {/* COLLECTION FILTER BAR */}
                    <div style={{ display: "flex", gap: "8px", marginBottom: "25px", overflowX: "auto", paddingBottom: "5px" }}>
                        <button 
                            onClick={() => setActiveCollection("All")} 
                            style={{ backgroundColor: activeCollection === "All" ? "var(--interactive-accent)" : "transparent", whiteSpace: "nowrap" }}
                        >
                            All
                        </button>
                        {collections.map(col => (
                            <button 
                                key={col} 
                                onClick={() => setActiveCollection(col)}
                                style={{ backgroundColor: activeCollection === col ? "var(--interactive-accent)" : "transparent", whiteSpace: "nowrap" }}
                            >
                                {col}
                            </button>
                        ))}
                    </div>

                    <div className="library-grid">
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: "15px" }}>
                            {processedAlbums.map((album) => {
                                // CHANGE: Split the basename to get only the title (before the " - ")
                                const displayTitle = album.file.basename.split(" - ")[0];
                                const { file, artist, cover, collection, rating } = album;
                                const isSelected = selectedFiles.some(f => f.path === file.path);
                                
                                return (
                                    <div 
                                        key={file.path} 
                                        onClick={() => {
                                            if (isManageMode) {
                                                if (isSelected) {
                                                    setSelectedFiles(selectedFiles.filter(f => f.path !== file.path));
                                                } else {
                                                    setSelectedFiles([...selectedFiles, file]);
                                                }
                                            } else {
                                                openAlbumNote(file);
                                            }
                                        }}
                                        onContextMenu={(e) => handleContextMenu(e, file)}
                                        style={{ 
                                            display: "flex", flexDirection: "column", 
                                            border: isSelected ? "3px solid var(--interactive-accent)" : "1px solid var(--background-modifier-border)", 
                                            padding: "10px", borderRadius: "5px", backgroundColor: "var(--background-secondary)",
                                            cursor: "pointer", position: "relative",
                                            transform: isSelected ? "scale(0.98)" : "none",
                                            transition: "all 0.1s ease-in-out"
                                        }}
                                    >
                                        {cover && <img src={cover} alt="Cover" style={{ width: "100%", aspectRatio: "1/1", objectFit: "cover", borderRadius: "4px", opacity: isManageMode && !isSelected ? 0.6 : 1 }} />}
                                        
                                        <div style={{ display: "flex", flexDirection: "column", overflow: "hidden", margin: "10px 0" }}>
                                            {/* CHANGE: Use displayTitle here */}
                                            <h4 style={{ margin: "0 0 4px 0", fontSize: "14px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={displayTitle}>
                                                {displayTitle}
                                            </h4>
                                            <small style={{ color: "var(--text-muted)", fontSize: "12px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }} title={artist}>
                                                {artist}
                                            </small>
                                        </div>
                                        
                                        {!isManageMode && (
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
                                                
                                                {rating > 0 && (
                                                    <span style={{ fontSize: "13px", fontWeight: "bold", color: "var(--text-accent)", whiteSpace: "nowrap", display: "flex", alignItems: "center", gap: "2px" }}>
                                                        ⭐ {rating}
                                                    </span>
                                                )}
                                            </div>
                                        )}
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

            {/* ========================================= */}
            {/* VIEW 2: THE ANALYTICS DASHBOARD           */}
            {/* ========================================= */}
            <div style={{ display: currentTab === "analytics" ? "flex" : "none", flexDirection: "column", gap: "30px", marginTop: "20px" }}>
                    
                    {/* Top Stats Row */}
                    <div style={{ display: "flex", gap: "15px", flexWrap: "wrap" }}>
                        <div style={{ flex: 1, minWidth: "200px", padding: "20px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--background-modifier-border)", textAlign: "center" }}>
                            <h3 style={{ margin: "0 0 10px 0", color: "var(--text-muted)" }}>Total Albums</h3>
                            <div style={{ fontSize: "36px", fontWeight: "bold", color: "var(--interactive-accent)" }}>{allMappedAlbums.length}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: "200px", padding: "20px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--background-modifier-border)", textAlign: "center" }}>
                            <h3 style={{ margin: "0 0 10px 0", color: "var(--text-muted)" }}>Unique Genres</h3>
                            <div style={{ fontSize: "36px", fontWeight: "bold", color: "var(--interactive-accent)" }}>{availableGenres.length}</div>
                        </div>
                        <div style={{ flex: 1, minWidth: "200px", padding: "20px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--background-modifier-border)", textAlign: "center" }}>
                            <h3 style={{ margin: "0 0 10px 0", color: "var(--text-muted)" }}>Average Rating</h3>
                            <div style={{ fontSize: "36px", fontWeight: "bold", color: "var(--interactive-accent)" }}>
                                {allMappedAlbums.filter(a => a.rating > 0).length > 0 
                                    ? (allMappedAlbums.reduce((sum, a) => sum + (a.rating > 0 ? a.rating : 0), 0) / allMappedAlbums.filter(a => a.rating > 0).length).toFixed(1)
                                    : "N/A"
                                }
                            </div>
                        </div>
                    </div>

                    {/* Charts Row */}
                    <div style={{ display: "flex", gap: "20px", flexWrap: "wrap" }}>
                        
                        {/* Genre Pie Chart */}
                        <div style={{ flex: 1, minWidth: "300px", padding: "20px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--background-modifier-border)" }}>
                            <h3 style={{ marginTop: 0 }}>Top Genres</h3>
                            <div style={{ height: "300px" }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={getGenreChartData()}
                                            cx="50%"
                                            cy="50%"
                                            innerRadius={60}
                                            outerRadius={100}
                                            paddingAngle={5}
                                            dataKey="value"
                                        >
                                            {getGenreChartData().map((entry, index) => (
                                                <Cell key={`cell-${index}`} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                                            ))}
                                        </Pie>
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" }}
                                            itemStyle={{ color: "var(--text-normal)" }}
                                        />
                                        <Legend />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        {/* Ratings Bar Chart */}
                        <div style={{ flex: 1, minWidth: "300px", padding: "20px", backgroundColor: "var(--background-secondary)", borderRadius: "8px", border: "1px solid var(--background-modifier-border)" }}>
                            <h3 style={{ marginTop: 0 }}>Rating Distribution</h3>
                            <div style={{ height: "300px" }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart data={getRatingChartData()} margin={{ top: 20, right: 30, left: 0, bottom: 5 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="var(--background-modifier-border)" vertical={false} />
                                        {/* Dynamic X-Axis label */}
                                        <XAxis dataKey="rating" stroke="var(--text-muted)" label={{ value: 'Rating', position: 'insideBottom', offset: -5 }} />
                                        <YAxis allowDecimals={false} stroke="var(--text-muted)" />
                                        <Tooltip 
                                            contentStyle={{ backgroundColor: "var(--background-primary)", border: "1px solid var(--background-modifier-border)", borderRadius: "4px" }}
                                            cursor={{ fill: 'var(--background-modifier-hover)' }}
                                        />
                                        <Bar dataKey="count" fill="var(--interactive-accent)" radius={[4, 4, 0, 0]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                    </div>
                </div>


            {/* ========================================= */}
            {/* MODALS AND FLOATING BARS (Unchanged)      */}
            {/* ========================================= */}
            
            {/* FLOATING BULK ACTION TOOLBAR */}
            {isManageMode && selectedFiles.length > 0 && currentTab === "library" && (
                <div style={{
                    position: "fixed",
                    bottom: "30px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    backgroundColor: "var(--background-secondary-alt)",
                    padding: "15px 25px",
                    borderRadius: "12px",
                    boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
                    display: "flex",
                    alignItems: "center",
                    gap: "20px",
                    zIndex: 1000,
                    border: "1px solid var(--background-modifier-border)"
                }}>
                    <div style={{ fontWeight: "bold", color: "var(--interactive-accent)" }}>
                        {selectedFiles.length} selected
                    </div>
                    
                    <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                        <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>Move to:</span>
                        <select 
                            value={bulkTargetCollection} 
                            onChange={(e) => setBulkTargetCollection(e.target.value)}
                            style={{ padding: "6px", borderRadius: "4px" }}
                        >
                            {collections.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                    </div>

                    <div style={{ display: "flex", gap: "10px" }}>
                        <button 
                            onClick={() => setIsBulkDeleteModalOpen(true)} 
                            style={{ backgroundColor: "var(--background-modifier-error)", color: "white", border: "none" }}
                        >
                            Delete
                        </button>
                        <button onClick={() => setSelectedFiles([])} style={{ background: "transparent", border: "1px solid var(--background-modifier-border)" }}>Clear</button>
                        <button onClick={executeBulkUpdate} style={{ backgroundColor: "var(--interactive-accent)", color: "var(--text-on-accent)" }}>Apply</button>
                    </div>
                </div>
            )}

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
                                                <small style={{ color: "var(--text-muted)" }}>
                                                    {album["artist-credit"]?.[0]?.name} • {album.date?.substring(0, 4) || "Unknown"}
                                                    {album.country ? ` • ${album.country}` : ""}
                                                    {album.disambiguation && (
                                                        <span style={{ fontStyle: "italic", marginLeft: "6px" }}>
                                                            ({album.disambiguation})
                                                        </span>
                                                    )}
                                                </small>
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

            {/* BULK DELETE CONFIRMATION MODAL */}
            {isBulkDeleteModalOpen && (
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
                        <h3 style={{ marginTop: 0 }}>Delete {selectedFiles.length} Albums?</h3>
                        <p style={{ color: "var(--text-muted)", marginBottom: "25px" }}>
                            Are you sure you want to remove <strong>{selectedFiles.length}</strong> albums from your library? This will move the files to your system trash.
                        </p>
                        
                        <div style={{ display: "flex", gap: "15px", justifyContent: "center" }}>
                            <button 
                                onClick={() => setIsBulkDeleteModalOpen(false)} 
                                style={{ flexGrow: 1, background: "transparent", border: "1px solid var(--background-modifier-border)" }}
                            >
                                Cancel
                            </button>
                            <button 
                                onClick={executeBulkDelete} 
                                style={{ flexGrow: 1, backgroundColor: "var(--background-modifier-error)", color: "white" }}
                            >
                                Delete All
                            </button>
                        </div>
                    </div>
                </div>
            )}

        </div>
    );
};