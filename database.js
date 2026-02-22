const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcrypt');

const db = new sqlite3.Database('./game.db');

// Initialize Database
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE,
        password TEXT,
        inventory TEXT DEFAULT '[]',
        health INTEGER DEFAULT 200,
        x REAL DEFAULT 0,
        y REAL DEFAULT 40.0,
        z REAL DEFAULT 0,
        rotation REAL DEFAULT 0,
        kills INTEGER DEFAULT 0,
        deaths INTEGER DEFAULT 0,
        model TEXT DEFAULT 'Ninja'
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS calibration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT UNIQUE,
        data TEXT
    )`);
    // Terrain chunks: stores heightmap & trees per chunk
    db.run(`CREATE TABLE IF NOT EXISTS terrain_chunks (
        cx INTEGER,
        cz INTEGER,
        data TEXT,
        PRIMARY KEY (cx, cz)
    )`);
    // World items: weapons on ground
    db.run(`CREATE TABLE IF NOT EXISTS world_items (
        id TEXT PRIMARY KEY,
        type TEXT,
        x REAL,
        y REAL,
        z REAL
    )`);
    // Tree states: track cut trees
    db.run(`CREATE TABLE IF NOT EXISTS tree_states (
        tree_key TEXT PRIMARY KEY,
        health INTEGER,
        max_health INTEGER,
        is_cut BOOLEAN,
        cut_timestamp INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS rock_states (
        rock_key TEXT PRIMARY KEY,
        health INTEGER,
        max_health INTEGER,
        is_broken BOOLEAN,
        broken_timestamp INTEGER
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS placed_blocks (
        id TEXT PRIMARY KEY,
        owner_id INTEGER,
        type TEXT,
        x REAL,
        y REAL,
        z REAL,
        rotation_y REAL DEFAULT 0
    )`);
});

const Database = {
    createUser: (username, password) => {
        return new Promise(async (resolve, reject) => {
            try {
                const hash = await bcrypt.hash(password, 10);
                // Spawn well above terrain (Y=40) then fall to ground naturally
                // Empty inventory for new players
                const defaultInventory = JSON.stringify([]);

                db.run(`INSERT INTO users (username, password, inventory, y) VALUES (?, ?, ?, 40.0)`, [username, hash, defaultInventory], function (err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID, username, health: 200, inventory: JSON.parse(defaultInventory) });
                });
            } catch (e) {
                reject(e);
            }
        });
    },

    authenticateUser: (username, password) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null); // User not found

                const match = await bcrypt.compare(password, row.password);
                if (match) {
                    // Parse JSON fields
                    try {
                        row.inventory = JSON.parse(row.inventory);

                        // Fix corrupt format: {"inventory": [...]} -> [...]
                        if (row.inventory && typeof row.inventory === 'object' && row.inventory.inventory && Array.isArray(row.inventory.inventory)) {
                            console.log(`[DB] Detected corrupt inventory format for ${row.username}, unwrapping...`);
                            row.inventory = row.inventory.inventory;
                        }
                    } catch (e) {
                        row.inventory = [];
                    }
                    resolve(row);
                } else {
                    resolve(null); // Wrong password
                }
            });
        });
    },

    savePlayerState: (username, data) => {
        // data: PlayerState.toDBObject() result
        // Saves full player state on disconnect
        const invStr = typeof data.inventory === 'string' ? data.inventory : JSON.stringify(data.inventory || []);

        db.run(`UPDATE users SET 
            health = ?, inventory = ?, x = ?, y = ?, z = ?, 
            rotation = ?, kills = ?, deaths = ?, model = ? 
            WHERE username = ?`,
            [
                data.health, invStr, data.x, data.y, data.z,
                data.rotation, data.kills, data.deaths, data.model, username
            ], (err) => {
                if (err) console.error("Save Error:", err);
                else console.log(`[DB] Saved state for ${username}`);
            });
    },

    updateUserInventory: (id, inventory) => {
        return new Promise((resolve, reject) => {
            const invStr = typeof inventory === 'string' ? inventory : JSON.stringify(inventory || []);
            db.run(`UPDATE users SET inventory = ? WHERE id = ?`, [invStr, id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // --- PLACED BLOCKS ---
    savePlacedBlock: (block) => {
        return new Promise((resolve, reject) => {
            db.run(
                `INSERT OR REPLACE INTO placed_blocks (id, owner_id, type, x, y, z, rotation_y) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [block.id, block.owner_id, block.type, block.x, block.y, block.z, block.rotation_y || 0],
                (err) => { if (err) reject(err); else resolve(); }
            );
        });
    },

    removePlacedBlock: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM placed_blocks WHERE id = ?`, [id], (err) => {
                if (err) reject(err); else resolve();
            });
        });
    },

    loadAllPlacedBlocks: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM placed_blocks`, [], (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    },

    saveCalibration: (type, dataObj) => {
        return new Promise((resolve, reject) => {
            const str = JSON.stringify(dataObj);
            db.run(`INSERT OR REPLACE INTO calibration (type, data) VALUES (?, ?)`, [type, str], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    getCalibration: (type) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT data FROM calibration WHERE type = ?`, [type], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                try {
                    resolve(JSON.parse(row.data));
                } catch (e) {
                    resolve(null);
                }
            });
        });
    },

    // --- TERRAIN CHUNKS ---
    getChunk: (cx, cz) => {
        return new Promise((resolve, reject) => {
            db.get(`SELECT data FROM terrain_chunks WHERE cx = ? AND cz = ?`, [cx, cz], (err, row) => {
                if (err) return reject(err);
                if (!row) return resolve(null);
                try {
                    resolve(JSON.parse(row.data));
                } catch (e) {
                    resolve(null);
                }
            });
        });
    },

    saveChunk: (cx, cz, data) => {
        return new Promise((resolve, reject) => {
            const str = JSON.stringify(data);
            db.run(`INSERT OR REPLACE INTO terrain_chunks (cx, cz, data) VALUES (?, ?, ?)`, [cx, cz, str], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // --- WORLD ITEMS ---
    getAllWorldItems: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM world_items`, [], (err, rows) => {
                if (err) return reject(err);
                resolve(rows || []);
            });
        });
    },

    getItemsInRange: (x, z, radius) => {
        return new Promise((resolve, reject) => {
            // SQLite doesn't have sqrt, so we use square distance
            const r2 = radius * radius;
            db.all(`SELECT * FROM world_items WHERE ((x - ?) * (x - ?) + (z - ?) * (z - ?)) <= ?`,
                [x, x, z, z, r2], (err, rows) => {
                    if (err) return reject(err);
                    resolve(rows || []);
                });
        });
    },

    saveWorldItem: (id, type, x, y, z) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO world_items (id, type, x, y, z) VALUES (?, ?, ?, ?, ?)`,
                [id, type, x, y, z], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },

    removeWorldItem: (id) => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM world_items WHERE id = ?`, [id], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    clearAllWorldItems: () => {
        return new Promise((resolve, reject) => {
            db.run(`DELETE FROM world_items`, [], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // --- TREE STATES ---
    saveTreeState: (treeKey, state) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO tree_states (tree_key, health, max_health, is_cut, cut_timestamp) VALUES (?, ?, ?, ?, ?)`,
                [treeKey, state.health || 0, state.maxHealth || 5, state.isCut ? 1 : 0, state.isCut ? Date.now() : null],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },

    loadAllTreeStates: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM tree_states`, [], (err, rows) => {
                if (err) return reject(err);

                // Convert rows to object format { "x_z": { health, maxHealth, isCut } }
                const treeStates = {};
                rows.forEach(row => {
                    treeStates[row.tree_key] = {
                        health: row.health,
                        maxHealth: row.max_health,
                        isCut: row.is_cut === 1
                    };
                });

                resolve(treeStates);
            });
        });
    },

    clearOldTreeStates: (daysOld) => {
        return new Promise((resolve, reject) => {
            const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
            db.run(`DELETE FROM tree_states WHERE cut_timestamp < ?`, [cutoffTime], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },

    // Rock state functions
    saveRockState: (rockKey, state) => {
        return new Promise((resolve, reject) => {
            db.run(`INSERT OR REPLACE INTO rock_states (rock_key, health, max_health, is_broken, broken_timestamp) VALUES (?, ?, ?, ?, ?)`,
                [rockKey, state.health || 0, state.maxHealth || 15, state.isBroken ? 1 : 0, state.isBroken ? Date.now() : null],
                (err) => {
                    if (err) reject(err);
                    else resolve();
                });
        });
    },

    loadAllRockStates: () => {
        return new Promise((resolve, reject) => {
            db.all(`SELECT * FROM rock_states`, [], (err, rows) => {
                if (err) return reject(err);

                const rockStates = {};
                rows.forEach(row => {
                    rockStates[row.rock_key] = {
                        health: row.health,
                        maxHealth: row.max_health,
                        isBroken: row.is_broken === 1
                    };
                });

                resolve(rockStates);
            });
        });
    },

    clearOldRockStates: (daysOld) => {
        return new Promise((resolve, reject) => {
            const cutoffTime = Date.now() - (daysOld * 24 * 60 * 60 * 1000);
            db.run(`DELETE FROM rock_states WHERE broken_timestamp < ?`, [cutoffTime], (err) => {
                if (err) reject(err);
                else resolve();
            });
        });
    },
};

module.exports = Database;
