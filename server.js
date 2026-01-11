const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const db = require('./database');
const { PlayerState, players, getPlayer, getAllPlayers, getPlayersObject, addPlayer, removePlayer, getNearbyPlayers } = require('./playerState');

app.use(express.static('public'));
app.use(express.json()); // Enable JSON body parsing

// In-memory world items cache (synced with DB)
let worldItems = {};

// --- TERRAIN GENERATION ---
const CHUNK_SIZE = 50;
const WORLD_SEED = 98765; // Changed seed to force new generation logic

// Biome configuration
const BIOMES = {
    plain: {
        heightMultiplier: 6,       // Flat terrain with some variation
        baseHeight: 0.5,           // Lowered to allow water lakes (WATER_LEVEL is 4.0)
        treeDensity: 0.4,
        treeTypes: ['Tree', 'Tree2'],
        rockDensity: 0,
        color: 'light_green'
    },
    forest: {
        heightMultiplier: 8,       // Gentle rolling hills
        baseHeight: 2.0,           // Lowered to allow some lakes in forest
        treeDensity: 1.5,          // Dense trees
        treeTypes: ['Pine Tree', 'Tree', 'Tree2', 'Big Tree'],
        rockDensity: 0.1,
        color: 'dark_green'
    },
    hill: {
        heightMultiplier: 18,      // Moderate hills
        baseHeight: 10,
        treeDensity: 0.6,
        treeTypes: ['Pine Tree', 'Tree'],
        rockDensity: 0.3,
        color: 'yellow_green'
    },
    mountain: {
        heightMultiplier: 35,      // Mountains with gradual slopes
        baseHeight: 20,
        treeDensity: 0.15,
        treeTypes: ['Pine Tree'],
        rockDensity: 1.2,
        color: 'gray'
    },
    beach: {
        heightMultiplier: 5,       // Flat near water
        baseHeight: 0,             // Can go underwater
        treeDensity: 0,            // No trees on beach
        treeTypes: [],
        rockDensity: 0.1,
        color: 'sand'
    }
};

// Simple noise function for terrain generation
function seededRandom(seed) {
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

function noise2D(x, z, seed) {
    const n = Math.sin(x * 12.9898 + z * 78.233 + seed) * 43758.5453;
    return n - Math.floor(n);
}

function smoothNoise(x, z, seed) {
    const corners = (noise2D(x - 1, z - 1, seed) + noise2D(x + 1, z - 1, seed) +
        noise2D(x - 1, z + 1, seed) + noise2D(x + 1, z + 1, seed)) / 16;
    const sides = (noise2D(x - 1, z, seed) + noise2D(x + 1, z, seed) +
        noise2D(x, z - 1, seed) + noise2D(x, z + 1, seed)) / 8;
    const center = noise2D(x, z, seed) / 4;
    return corners + sides + center;
}

function interpolatedNoise(x, z, seed) {
    const intX = Math.floor(x);
    const fracX = x - intX;
    const intZ = Math.floor(z);
    const fracZ = z - intZ;

    const v1 = smoothNoise(intX, intZ, seed);
    const v2 = smoothNoise(intX + 1, intZ, seed);
    const v3 = smoothNoise(intX, intZ + 1, seed);
    const v4 = smoothNoise(intX + 1, intZ + 1, seed);

    const i1 = v1 * (1 - fracX) + v2 * fracX;
    const i2 = v3 * (1 - fracX) + v4 * fracX;

    return i1 * (1 - fracZ) + i2 * fracZ;
}

function perlinNoise(x, z, seed, octaves = 4) {
    let total = 0;
    let frequency = 0.05;
    let amplitude = 1;
    let maxValue = 0;

    for (let i = 0; i < octaves; i++) {
        total += interpolatedNoise(x * frequency, z * frequency, seed) * amplitude;
        maxValue += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }

    return total / maxValue;
}

/**
 * Determine biome type based on position using dual noise (elevation + moisture)
 * Uses low-frequency noise for large biome regions
 */
function getBiome(x, z) {
    // Elevation noise - determines mountain vs lowland (very low frequency for large regions)
    const elevationNoise = perlinNoise(x * 0.2, z * 0.2, WORLD_SEED, 2);

    // Moisture noise - determines forest vs plain (different seed, low frequency)
    const moistureNoise = perlinNoise(x * 0.15, z * 0.15, WORLD_SEED + 5000, 2);

    // Determine biome based on combined values
    // Lowered thresholds for more variety
    if (elevationNoise > 0.7) {
        return 'mountain';  // High elevation = mountains (less common)
    } else if (elevationNoise > 0.55) {
        return 'hill';      // Medium-high elevation = hills
    } else if (elevationNoise < 0.25 && moistureNoise < 0.35) {
        return 'beach';     // Low elevation + low moisture = beach/sand
    } else if (moistureNoise > 0.4) {
        return 'forest';    // Low elevation + high moisture = forest (more common)
    } else {
        return 'plain';     // Default = plains
    }
}

/**
 * Get biome-aware height at a specific world position
 * Uses multiple noise octaves for natural variation
 */
function getBiomeHeight(wx, wz, biome) {
    const biomeConfig = BIOMES[biome];

    // Multi-octave noise for more natural terrain
    const noise1 = perlinNoise(wx * 1.0, wz * 1.0, WORLD_SEED, 4);     // Main terrain
    const noise2 = perlinNoise(wx * 0.5, wz * 0.5, WORLD_SEED + 100, 2); // Large hills
    const noise3 = perlinNoise(wx * 2.0, wz * 2.0, WORLD_SEED + 200, 2); // Small detail

    // Blend noise for natural feel
    const blendedNoise = noise1 * 0.6 + noise2 * 0.3 + noise3 * 0.1;

    return biomeConfig.baseHeight + blendedNoise * biomeConfig.heightMultiplier;
}

// ============== LAKE & OCEAN SYSTEM ==============
// Water fills low areas - simple and seamless

const WATER_LEVEL = 4.0; // Global water level - areas below this are underwater
const BEACH_HEIGHT = 6.0; // Sand appears between water level and this height

/**
 * Check if a position should have water (lake/ocean)
 */
function isUnderwater(height) {
    return height < WATER_LEVEL;
}

/**
 * Get terrain type for texturing based on biome and height
 */
function getTerrainType(biome, height) {
    // Underwater - no terrain visible
    if (height < WATER_LEVEL) {
        return 'underwater';
    }

    // Near water - sand/beach
    if (height < BEACH_HEIGHT) {
        return 'sand';
    }

    // Based on biome
    switch (biome) {
        case 'mountain':
            return height > 15 ? 'rock' : 'grass';
        case 'hill':
            return height > 12 ? 'rock' : 'grass';
        case 'forest':
            return 'grass_dark';
        default: // plain
            return 'grass';
    }
}

// Generate chunk data with biome awareness
function generateChunk(cx, cz) {
    const resolution = 10; // 10x10 height samples per chunk
    const heightmap = [];
    const trees = [];
    const rocks = [];

    const worldX = cx * CHUNK_SIZE;
    const worldZ = cz * CHUNK_SIZE;

    // Determine chunk's primary biome (center of chunk)
    const chunkCenterX = worldX + CHUNK_SIZE / 2;
    const chunkCenterZ = worldZ + CHUNK_SIZE / 2;
    const biome = getBiome(chunkCenterX, chunkCenterZ);
    const biomeConfig = BIOMES[biome];

    // Track if this chunk has any water (low areas)
    let hasWater = false;

    // Generate heightmap with biome-specific heights
    for (let i = 0; i <= resolution; i++) {
        heightmap[i] = [];
        for (let j = 0; j <= resolution; j++) {
            const wx = worldX + (i / resolution) * CHUNK_SIZE;
            const wz = worldZ + (j / resolution) * CHUNK_SIZE;

            // Get height based on biome at this specific point
            const localBiome = getBiome(wx, wz);
            const height = getBiomeHeight(wx, wz, localBiome);

            heightmap[i][j] = height;

            // Track water areas
            if (height < WATER_LEVEL) {
                hasWater = true;
            }
        }
    }

    // Generate trees based on biome density (skip underwater areas)
    const baseTreeCount = Math.floor(seededRandom(cx * 1000 + cz + WORLD_SEED) * 5) + 2;
    const treeCount = Math.floor(baseTreeCount * biomeConfig.treeDensity);

    for (let i = 0; i < treeCount; i++) {
        const tx = worldX + seededRandom(cx * 100 + cz * 10 + i + WORLD_SEED) * CHUNK_SIZE;
        const tz = worldZ + seededRandom(cz * 100 + cx * 10 + i + WORLD_SEED * 2) * CHUNK_SIZE;

        // Get height at tree position
        const nearestI = Math.floor(((tx - worldX) / CHUNK_SIZE) * resolution);
        const nearestJ = Math.floor(((tz - worldZ) / CHUNK_SIZE) * resolution);
        const treeHeight = heightmap[Math.min(nearestI, resolution)][Math.min(nearestJ, resolution)];

        // Skip trees underwater or on sand
        if (treeHeight < BEACH_HEIGHT) continue;

        // Tree type based on biome
        let treeType = 'Tree';
        if (biome === 'forest') {
            const treeRand = seededRandom(tx + tz + WORLD_SEED * 3);
            if (treeRand < 0.3) treeType = 'Pine Tree';
            else if (treeRand < 0.5) treeType = 'Tree2';
            else if (treeRand < 0.7) treeType = 'Big Tree';
        } else if (biome === 'plain') {
            treeType = seededRandom(tx * tz + WORLD_SEED * 4) < 0.5 ? 'Tree' : 'Tree2';
        } else if (biome === 'mountain' || biome === 'hill') {
            treeType = 'Pine Tree';
        }

        const scale = 0.8 + seededRandom(tx + tz * 2 + WORLD_SEED) * 0.4;

        trees.push({
            type: treeType,
            x: tx,
            y: treeHeight,
            z: tz,
            scale: scale
        });
    }

    // Generate rocks for mountain/hill biomes (skip underwater)
    const rockCount = (biome === 'mountain' || biome === 'hill')
        ? Math.floor(seededRandom(cx * 500 + cz * 2 + WORLD_SEED) * 8) + 3
        : Math.floor(seededRandom(cx * 500 + cz * 2 + WORLD_SEED) * 2);

    for (let i = 0; i < rockCount; i++) {
        const rx = worldX + seededRandom(cx * 200 + cz * 20 + i + WORLD_SEED * 3) * CHUNK_SIZE;
        const rz = worldZ + seededRandom(cz * 200 + cx * 20 + i + WORLD_SEED * 4) * CHUNK_SIZE;

        const nearestI = Math.floor(((rx - worldX) / CHUNK_SIZE) * resolution);
        const nearestJ = Math.floor(((rz - worldZ) / CHUNK_SIZE) * resolution);
        const ry = heightmap[Math.min(nearestI, resolution)][Math.min(nearestJ, resolution)];

        // Skip rocks underwater
        if (ry < WATER_LEVEL) continue;

        const rockTypes = ['SmallRock', 'MediumRock', 'LargeRock', 'Boulder'];
        const rockTypeIndex = Math.floor(seededRandom(rx + rz + WORLD_SEED * 5) * rockTypes.length);
        const rotation = seededRandom(rx * rz + WORLD_SEED * 6) * 360;
        let scale = 0.5 + seededRandom(rx + rz + WORLD_SEED * 7) * 1.5;
        if (rockTypes[rockTypeIndex] === 'Boulder') scale *= 2;
        if (rockTypes[rockTypeIndex] === 'LargeRock') scale *= 1.5;

        rocks.push({
            type: rockTypes[rockTypeIndex],
            x: rx,
            y: ry,
            z: rz,
            scale: scale,
            rotation: rotation
        });
    }

    // Calculate average slope of the chunk
    let totalSlope = 0;
    let slopeCount = 0;
    for (let i = 0; i < resolution; i++) {
        for (let j = 0; j < resolution; j++) {
            const h = heightmap[i][j];
            const hRight = heightmap[i + 1] ? heightmap[i + 1][j] : h;
            const hDown = heightmap[i][j + 1] || h;

            // Calculate slope as height difference per unit
            const slopeX = Math.abs(h - hRight);
            const slopeZ = Math.abs(h - hDown);
            const slope = Math.max(slopeX, slopeZ);

            totalSlope += slope;
            slopeCount++;
        }
    }
    const avgSlope = slopeCount > 0 ? totalSlope / slopeCount : 0;
    const isSteep = avgSlope > 0.8; // Steep if average slope > 0.8

    return {
        cx, cz, biome, heightmap, trees, rocks,
        hasWater: hasWater,
        waterLevel: WATER_LEVEL,
        isSteep: isSteep  // True if chunk has steep slopes (use rock texture)
    };
}

/**
 * Get terrain height at any world position (x, z)
 * This uses the same perlinNoise function as chunk generation
 * Returns Y coordinate for spawning players above terrain
 */
async function getTerrainHeightAt(x, z) {
    // Calculate which chunk this position belongs to
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);

    // Try to get chunk from database
    let chunkData = await db.getChunk(cx, cz);

    // If chunk doesn't exist, generate it (or use procedural calculation)
    if (!chunkData) {
        // Option 1: Generate and save chunk
        // chunkData = generateChunk(cx, cz);
        // await db.saveChunk(cx, cz, chunkData);

        // Option 2: Calculate height directly without loading full chunk (more efficient)
        // Use the same noise function as generateChunk
        const height = perlinNoise(x, z, WORLD_SEED) * 40;
        return height + 0.5; // Add 0.5 units above terrain for safe spawn
    }

    // Interpolate height from heightmap
    const worldX = cx * CHUNK_SIZE;
    const worldZ = cz * CHUNK_SIZE;
    const resolution = 10;

    // Position within chunk (0-1)
    const localX = (x - worldX) / CHUNK_SIZE;
    const localZ = (z - worldZ) / CHUNK_SIZE;

    // Heightmap indices (0-10)
    const i = localX * resolution;
    const j = localZ * resolution;

    // Get surrounding heightmap values
    const i0 = Math.floor(i);
    const i1 = Math.min(i0 + 1, resolution);
    const j0 = Math.floor(j);
    const j1 = Math.min(j0 + 1, resolution);

    // Bilinear interpolation
    const fracX = i - i0;
    const fracZ = j - j0;

    const h00 = chunkData.heightmap[i0][j0];
    const h10 = chunkData.heightmap[i1][j0];
    const h01 = chunkData.heightmap[i0][j1];
    const h11 = chunkData.heightmap[i1][j1];

    const h0 = h00 * (1 - fracX) + h10 * fracX;
    const h1 = h01 * (1 - fracX) + h11 * fracX;
    const height = h0 * (1 - fracZ) + h1 * fracZ;

    return height + 0.5; // Add 0.5 units above terrain for safe spawn
}

// Notify players within range of an event
function notifyNearby(eventX, eventZ, eventName, data, range = 50) {
    const nearby = getNearbyPlayers(eventX, eventZ, range);
    nearby.forEach(state => {
        io.to(state.socketId).emit(eventName, data);
    });
}

// Initialize world items from DB
async function initWorldItems() {
    try {
        const items = await db.getAllWorldItems();
        items.forEach(item => {
            worldItems[item.id] = item;
        });
        console.log(`Loaded ${items.length} world items from DB`);
    } catch (e) {
        console.error('Failed to load world items:', e);
    }
}



io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

    // --- PING HANDLER (for latency measurement) ---
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') callback();
    });

    // --- AUTHENTICATION ---

    socket.on('signup', async (data) => {
        try {
            const newUser = await db.createUser(data.username, data.password);
            socket.emit('authSuccess', { message: "Created! Now Login." });
        } catch (err) {
            socket.emit('authError', { message: "Username taken or invalid." });
        }
    });

    socket.on('login', async (data) => {
        try {
            const user = await db.authenticateUser(data.username, data.password);
            if (user) {
                // Calculate correct spawn Y based on terrain at player's (x, z) position
                let terrainY = 20; // Default safe spawn height
                try {
                    terrainY = await getTerrainHeightAt(user.x, user.z);
                    console.log(`[Server] ${user.username} terrain Y at (${user.x}, ${user.z}): ${terrainY}`);

                    // Validate terrain Y is a number
                    if (isNaN(terrainY) || terrainY === null || terrainY === undefined) {
                        console.error(`[Server] Invalid terrain Y for ${user.username}, using fallback`);
                        terrainY = 20;
                    }
                } catch (err) {
                    console.error(`[Server] Error calculating terrain for ${user.username}:`, err);
                    terrainY = 20; // Use safe fallback
                }

                // Create PlayerState from DB data
                const playerState = addPlayer(socket.id, user.username, {
                    x: user.x,
                    y: terrainY, // Use terrain-aware Y instead of database Y
                    z: user.z,
                    rotation: user.rotation,
                    health: user.health > 0 ? user.health : 200,
                    kills: user.kills || 0,
                    deaths: user.deaths || 0,
                    weapons: user.weapons,
                    inventory: user.inventory,
                    equippedSlot: user.equippedSlot ?? -1,
                    model: data.model || user.model || 'Ninja'
                });

                // Send full state to the logging-in player
                socket.emit('loginSuccess', {
                    id: socket.id,
                    player: playerState.toFullState()
                });

                // Send existing players to new player (network packets for other players)
                socket.emit('currentPlayers', getPlayersObject());

                // Notify others about new player
                socket.broadcast.emit('newPlayer', {
                    id: socket.id,
                    player: playerState.toNetworkPacket()
                });

                console.log(`[Server] ${user.username} logged in. Total players: ${players.size}`);
            } else {
                socket.emit('authError', { message: "Invalid credentials." });
            }
        } catch (err) {
            console.error(err);
            socket.emit('authError', { message: "Server error." });
        }
    });

    // --- TERRAIN CHUNKS ---
    socket.on('requestChunks', async (chunks) => {
        for (const { cx, cz } of chunks) {
            let chunkData = await db.getChunk(cx, cz);
            if (!chunkData) {
                // Generate and save new chunk
                chunkData = generateChunk(cx, cz);
                await db.saveChunk(cx, cz, chunkData);
            }
            socket.emit('chunkData', chunkData);
        }
    });

    // --- WORLD ITEMS ---
    socket.on('getWorldItems', async (data) => {
        // Return items within range of player position
        const { x, z, radius } = data;
        const items = await db.getItemsInRange(x, z, radius || 100);
        socket.emit('worldItems', items);
    });

    socket.on('pickupItem', async (data) => {
        const { itemId } = data;
        const item = worldItems[itemId];

        if (item) {
            // Remove from DB and memory
            await db.removeWorldItem(itemId);
            delete worldItems[itemId];

            // Notify nearby players only (50m range)
            notifyNearby(item.x, item.z, 'itemRemoved', { id: itemId }, 50);

            console.log(`Item ${itemId} picked up by ${socket.id}`);
        }
    });

    // --- GAMEPLAY ---
    const UPDATE_RADIUS = 200; // Only send updates to players within this range

    socket.on('playerMovement', (movementData) => {
        const playerState = getPlayer(socket.id);
        if (playerState) {
            // Update player state
            playerState.updatePosition(movementData);

            // Create network packet
            const packet = playerState.toNetworkPacket();

            // Broadcast to nearby players
            const nearby = getNearbyPlayers(playerState.x, playerState.z, UPDATE_RADIUS);
            nearby.forEach(target => {
                if (target.socketId !== socket.id) {
                    io.to(target.socketId).emit('playerMoved', packet);
                }
            });
        }
    });

    socket.on('attack', () => {
        // Visual only: tell others I attacked
        const playerState = getPlayer(socket.id);
        if (playerState) {
            playerState.isFiring = true; // Still use isFiring state for attack animation?? Or better use animationState

            // Broadcast to nearby players
            const nearby = getNearbyPlayers(playerState.x, playerState.z, UPDATE_RADIUS);
            nearby.forEach(target => {
                if (target.socketId !== socket.id) {
                    io.to(target.socketId).emit('playerAttack', { id: socket.id });
                }
            });
        }
    });

    socket.on('playerHit', (data) => {
        // data = { targetId: string, damage: number }
        const targetId = data.targetId;
        const damage = data.damage || 10;
        const targetState = getPlayer(targetId);
        const attackerState = getPlayer(socket.id);

        if (targetState && targetState.isAlive) {
            const died = targetState.takeDamage(damage);

            // Notify target of health update
            io.to(targetId).emit('updateHealth', targetState.health);

            // Broadcast damage to all nearby
            io.emit('playerDamaged', {
                id: targetId,
                health: targetState.health,
                damage: damage
            });

            if (died) {
                // PLAYER DIED
                io.emit('playerDied', {
                    id: targetId,
                    killerId: socket.id,
                    killerName: attackerState ? attackerState.username : 'Unknown'
                });
                io.to(targetId).emit('youDied', {
                    message: "You Died!",
                    killedBy: attackerState ? attackerState.username : 'Unknown'
                });

                // Reward Killer
                if (attackerState) {
                    attackerState.addKill();
                    socket.emit('killConfirm', {
                        kills: attackerState.kills,
                        victimName: targetState.username
                    });
                    socket.emit('notification', {
                        message: `You killed ${targetState.username}! Total kills: ${attackerState.kills}`
                    });
                }

                // Respawn after delay
                setTimeout(() => {
                    const t = getPlayer(targetId);
                    if (t) {
                        const respawnX = (Math.random() - 0.5) * 100;
                        const respawnZ = (Math.random() - 0.5) * 100;
                        t.respawn(respawnX, 5, respawnZ);

                        // Broadcast Respawn
                        io.emit('playerRespawn', {
                            id: targetId,
                            x: t.x,
                            y: t.y,
                            z: t.z,
                            health: t.health
                        });
                        io.to(targetId).emit('updateHealth', t.health);
                    }
                }, 3000);
            }
        }
    });

    socket.on('updateInventory', (inventory) => {
        const playerState = getPlayer(socket.id);
        if (playerState) {
            playerState.inventory = inventory;
            socket.broadcast.emit('playerInventoryUpdated', {
                id: socket.id,
                inventory: inventory
            });
        }
    });



    socket.on('disconnect', () => {
        const playerState = removePlayer(socket.id);
        if (playerState) {
            console.log(`[Server] ${playerState.username} disconnected. Saving state...`);

            // Save full state to DB
            db.savePlayerState(playerState.username, playerState.toDBObject());

            io.emit('playerDisconnected', socket.id);
            console.log(`[Server] Total players: ${players.size}`);
        }
    });
});

// --- API ROUTES ---
app.post('/api/calibration', async (req, res) => {
    try {
        await db.saveCalibration(req.body.type, req.body.data);
        res.json({ success: true });
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

app.get('/api/calibration/:type', async (req, res) => {
    try {
        const data = await db.getCalibration(req.params.type);
        res.json(data || {});
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Chunk API (HTTP fallback)
app.get('/api/chunk/:cx/:cz', async (req, res) => {
    try {
        const cx = parseInt(req.params.cx);
        const cz = parseInt(req.params.cz);
        let chunkData = await db.getChunk(cx, cz);
        if (!chunkData) {
            chunkData = generateChunk(cx, cz);
            await db.saveChunk(cx, cz, chunkData);
        }
        res.json(chunkData);
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: e.message });
    }
});

// Initialize and start server
initWorldItems().then(async () => {


    http.listen(3000, '0.0.0.0', () => {
        console.log('Battlefield server running on *:3000');
        console.log('Access via LAN: http://192.168.1.145:3000 (or your machine IP)');
    });
});