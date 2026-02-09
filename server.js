const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const db = require('./database');
const { PlayerState, players, getPlayer, getAllPlayers, getPlayersObject, addPlayer, removePlayer, getPlayerByUsername, markPlayerOffline, getNearbyPlayers } = require('./playerState');

app.use(express.static('public'));
app.use(express.json()); // Enable JSON body parsing

// In-memory world items cache (synced with DB)
let worldItems = {};

// --- REALISTIC MINECRAFT-LIKE TERRAIN GENERATION (OPTIMIZED) ---
const FastNoise = require('./fast_noise');

// Initialize noise with world seed
const WORLD_SEED_NUM = 98765;
FastNoise.seed(WORLD_SEED_NUM);

const CHUNK_SIZE = 50;
const RESOLUTION = 50; // 51x51 vertices per chunk

// World Config
const OCEAN_DEPTH = -15;
const WATER_LEVEL = 4.0;
const BEACH_HEIGHT = 5.5;

// ============== SPLINE HELPERS ==============

// Simple linear interpolation
function remap(value, fromLow, fromHigh, toLow, toHigh) {
    const t = (value - fromLow) / (fromHigh - fromLow);
    // Clamp t between 0 and 1
    const clampedT = Math.max(0, Math.min(1, t));
    return toLow + clampedT * (toHigh - toLow);
}

// Spline point structure: [noiseValue, heightValue]
// Interpolates between points
function spline(noiseVal, points) {
    for (let i = 0; i < points.length - 1; i++) {
        const p1 = points[i];
        const p2 = points[i + 1];

        if (noiseVal >= p1[0] && noiseVal <= p2[0]) {
            return remap(noiseVal, p1[0], p2[0], p1[1], p2[1]);
        }
    }
    // Out of bounds - clamp to edges
    if (noiseVal < points[0][0]) return points[0][1];
    if (noiseVal > points[points.length - 1][0]) return points[points.length - 1][1];

    return 0;
}

// ============== NEW NOISE FUNCTIONS ==============

/**
 * Continentalness: Determines "Inland-ness"
 * -1.0 = Deep Ocean
 * -0.2 = Coast/Beach
 *  0.0 = Flat Lands
 *  0.5 = Inland / Highlands
 *  1.0 = Far Inland
 */
function getContinentalness(x, z) {
    // Very low frequency noise (large continents)
    return FastNoise.fractal(x * 0.001, z * 0.001, 2);
}

/**
 * Erosion: Determines Flatness vs Ruggedness
 * -1.0 = Very Mountainous / Canyon
 *  1.0 = Very Flat
 */
function getErosion(x, z) {
    // Medium frequency
    return FastNoise.fractal(x * 0.003, z * 0.003, 2);
}

/**
 * Peaks & Valleys: Local Terrain Shape
 * Adds hills, river beds, local variation
 */
function getPeaksValleys(x, z) {
    // Higher frequency for local details
    return FastNoise.fractal(x * 0.01, z * 0.01, 3);
}

// ============== TERRAIN SPLINES ==============

// Continentalness Height Spline
// Maps C-noise to base height (Ocean -> Beach -> Land -> MountainBase)
const C_SPLINE = [
    [-1.0, -25], // Deep Ocean
    [-0.6, -10], // Shallow Ocean
    [-0.2, -2],  // Coast
    [0.0, 5],  // Plains
    [0.4, 20], // Hills/Plateau
    [1.0, 60]  // High Interior
];

// Erosion Factor
// How much the mountains override the base height
// If erosion is LOW (-1), we allow big peaks. If HIGH (1), we flatten them.
function getErosionFactor(eVal) {
    // Map -1..1 to a multiplier 1.0..0.0
    // eVal -1 => factor 1.5 (Rugged)
    // eVal 1 => factor 0.1 (Flat)
    return remap(eVal, -1, 1, 1.5, 0.1);
}

// Peaks & Valleys Spline
// Maps PV-noise to local height add-on (Valley -> Mound -> Hill)
const PV_SPLINE = [
    [-1.0, -10], // Trench/Valley
    [-0.2, -2],  // Small dip
    [0.2, 2],  // Small mound
    [1.0, 15]  // Hill peak
];

/**
 * Compute final terrain height at (x, z)
 * Combining C, E, PV noises via splines
 */
function getTerrainHeight(x, z) {
    const C = getContinentalness(x, z);
    const E = getErosion(x, z);
    const PV = getPeaksValleys(x, z);

    // 1. Base Height from Continentalness
    const baseHeight = spline(C, C_SPLINE);

    // 2. Local Variation from PeaksValleys
    // Scaled by Erosion (High erosion = squashed features)
    const erosionFactor = getErosionFactor(E);
    const localHeight = spline(PV, PV_SPLINE) * erosionFactor;

    // 3. Mountain Ridge Injector
    // If Erosion is VERY low (< -0.5) AND Continentalness is High (> 0.3), spawn Mega Peaks
    let mountainBonus = 0;
    if (E < -0.4 && C > 0.2) {
        // Sharp ridged noise for peaks
        const ridge = FastNoise.rigid(x * 0.008, z * 0.008, 4);
        // ridge is 0..1
        mountainBonus = ridge * 60; // Up to 60 units high

        // Mask: fade out at edges of mountain zone
        const mask = Math.min(remap(E, -0.4, -0.6, 0, 1), remap(C, 0.2, 0.4, 0, 1));
        mountainBonus *= mask;
    }

    // 4. Rocky Micro-Detail
    // MASK IT OUT in flat areas (Erosion > 0) so beaches/plains are smooth
    let detailAmplitude = 1.5;
    if (E > 0.0) {
        // Fade out detail as terrain gets flatter
        // E=0 -> Amp=1.5
        // E=0.5 -> Amp=0.2
        detailAmplitude = remap(E, 0.0, 0.5, 1.5, 0.2);
    }

    // Squashing factor for extremely flat areas (Beaches/Plains)
    // If Erosion is high (> 0.3), force localHeight to be very small
    let flatnessMultiplier = 1.0;
    if (E > 0.3) {
        flatnessMultiplier = 0.2; // 20% of original height variation
    }

    const detail = FastNoise.noise(x * 0.15, z * 0.15) * detailAmplitude;

    return baseHeight + (localHeight * flatnessMultiplier) + mountainBonus + detail;
}

/**
 * Determine Biome from C, E, PV, Height
 */
function getBiome(height, C, E, PV) {
    if (height < WATER_LEVEL) return 'ocean';
    if (height < WATER_LEVEL + 3) return 'beach';

    // Inland biomes decided by Erosion & Temp (simulated by C or PV)

    if (E < -0.4 && height > 30) return 'mountain'; // Low erosion, high up

    if (PV > 0.6) return 'forest'; // Hilly areas often forests

    if (E > 0.4) return 'plain'; // High erosion = flat plains

    if (C > 0.6) return 'jungle'; // Deep inland

    return 'hill'; // Default
}

// Tree/Rock densities per biome
// Tree/Rock densities per biome
const BIOME_CONFIG = {
    ocean: { tree: 0, rock: 0, shrub: 0, types: [] },
    beach: { tree: 0, rock: 0.1, shrub: 0.1, types: [] },
    plain: { tree: 0.02, rock: 0.01, shrub: 1.0, types: ['Tree', 'Tree2'] },
    forest: { tree: 0.3, rock: 0.1, shrub: 1.5, types: ['Pine Tree', 'Tree', 'Big Tree'] },
    jungle: { tree: 0.5, rock: 0.05, shrub: 2.0, types: ['Big Tree', 'Tree'] },
    hill: { tree: 0.1, rock: 0.3, shrub: 0.5, types: ['Pine Tree'] },
    mountain: { tree: 0.02, rock: 1.0, shrub: 0.1, types: ['Pine Tree'] }
};

// ============== CHUNK GENERATION ==============

// ============== CHUNK GENERATION ==============

function seededRandom(seed) {
    // Simple fast random for placement logic (not terrain shape)
    const x = Math.sin(seed) * 10000;
    return x - Math.floor(x);
}

/**
 * Calculate terrain slope at a position
 */
function calculateSlope(x, z) {
    const sampleDist = 1.0; // Sample 1 meter away
    const h = getTerrainHeight(x, z);
    const hx = getTerrainHeight(x + sampleDist, z);
    const hz = getTerrainHeight(x, z + sampleDist);

    const slopeX = Math.abs(hx - h) / sampleDist;
    const slopeZ = Math.abs(hz - h) / sampleDist;

    return Math.max(slopeX, slopeZ);
}

/**
 * Determine terrain material based on height, slope, and continentalness
 */
function getTerrainMaterial(height, slope, continentalness) {
    // Stone on steep slopes or high altitudes
    if (slope > 0.6) return 'stone';
    if (height > 30) return 'stone';

    // Sand on beaches
    if (height < BEACH_HEIGHT && continentalness < 0) return 'sand';

    // Default to grass/dirt
    return 'grass';
}


function generateChunk(cx, cz) {
    const resolution = RESOLUTION;
    const heightmap = [];
    const trees = [];
    const rocks = [];
    const shrubs = [];

    const worldX = cx * CHUNK_SIZE;
    const worldZ = cz * CHUNK_SIZE;

    let hasWater = false;
    let totalHeight = 0;

    // 1. Generate Heightmap
    for (let i = 0; i <= resolution; i++) {
        heightmap[i] = [];
        for (let j = 0; j <= resolution; j++) {
            const wx = worldX + (i / resolution) * CHUNK_SIZE;
            const wz = worldZ + (j / resolution) * CHUNK_SIZE;

            const height = getTerrainHeight(wx, wz);
            heightmap[i][j] = height;
            totalHeight += height;

            if (height < WATER_LEVEL) hasWater = true;
        }
    }

    // 2. Determine Primary Biome (Center of chunk)
    const centerX = worldX + CHUNK_SIZE / 2;
    const centerZ = worldZ + CHUNK_SIZE / 2;
    // Sample noise at center
    const centerC = getContinentalness(centerX, centerZ);
    const centerE = getErosion(centerX, centerZ);
    const centerPV = getPeaksValleys(centerX, centerZ);
    const avgHeight = totalHeight / ((resolution + 1) ** 2);

    const biome = getBiome(avgHeight, centerC, centerE, centerPV);
    const conf = BIOME_CONFIG[biome];

    // 3. Populate Objects (Trees/Rocks)
    if (conf) {
        // Tree Pass
        const countMult = 0.5; // Base Multiplier (Reduced again: 5 -> 2 -> 0.5)
        const treeCount = Math.floor(countMult * CHUNK_SIZE * conf.tree);

        for (let k = 0; k < treeCount; k++) {
            // Random pos in chunk
            const r1 = seededRandom(cx * 100 + cz + k);
            const r2 = seededRandom(cz * 100 + cx + k);

            const tx = worldX + r1 * CHUNK_SIZE;
            const tz = worldZ + r2 * CHUNK_SIZE;

            // Get height at this pos
            const ty = getTerrainHeight(tx, tz);

            // Conditions
            if (ty < WATER_LEVEL + 0.5) continue; // Not underwater

            // Type
            const typeIdx = Math.floor(seededRandom(k) * conf.types.length);
            const tType = conf.types[typeIdx];
            if (!tType) continue;

            const scale = 0.8 + seededRandom(k + 1) * 0.5;

            trees.push({
                type: tType,
                x: tx, y: ty, z: tz,
                scale: scale
            });
        }

        // Rock Pass
        if (conf.rock > 0) {
            // Reduced rock multiplier from 1.0 to 0.3
            const rockCount = Math.floor(0.3 * CHUNK_SIZE * conf.rock);
            for (let k = 0; k < rockCount; k++) {
                const r1 = seededRandom(cx * 500 + cz + k * 2);
                const r2 = seededRandom(cz * 500 + cx + k * 2);
                const rx = worldX + r1 * CHUNK_SIZE;
                const rz = worldZ + r2 * CHUNK_SIZE;
                const ry = getTerrainHeight(rx, rz);
                if (ry < WATER_LEVEL - 2) continue; // Allow some underwater rocks

                let rockType = Math.floor(seededRandom(k * 3) * 6); // 0-5
                if (rockType === 1) rockType = 0; // Skip Rock 2 (bad collider), replace with Rock 1

                rocks.push({
                    type: rockType,
                    x: rx, y: ry, z: rz,
                    scale: 0.2 + seededRandom(k) * 0.3,
                    rotation: seededRandom(k) * 360
                });
            }
        }

        // Shrub Pass (ADDED MISSING LOOP)
        if (conf.shrub > 0) {
            const shrubCount = Math.floor(5 * CHUNK_SIZE * conf.shrub);
            for (let k = 0; k < shrubCount; k++) {
                const r1 = seededRandom(cx * 900 + cz + k * 5);
                const r2 = seededRandom(cz * 900 + cx + k * 5);

                const sx = worldX + r1 * CHUNK_SIZE;
                const sz = worldZ + r2 * CHUNK_SIZE;
                const sy = getTerrainHeight(sx, sz);

                if (sy < WATER_LEVEL + 0.2) continue; // Not underwater

                shrubs.push({
                    type: Math.floor(seededRandom(k) * 5), // 0-4
                    x: sx, y: sy, z: sz,
                    scale: 1.2 + seededRandom(k + 3) * 1.0,
                    rotation: seededRandom(k) * 360
                });
            }
        }
    }

    // Placeholder roadmap (empty for now)
    const roadmap = Array(resolution + 1).fill(0).map(() => Array(resolution + 1).fill(0));

    return {
        cx, cz, biome, heightmap, trees, rocks, shrubs, roadmap,
        hasWater, waterLevel: WATER_LEVEL, isSteep: false
    };
}

/**
 * Get terrain height at any world position
 * Uses the new layered noise system
 */
async function getTerrainHeightAt(x, z) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);

    let chunkData = await db.getChunk(cx, cz);

    if (!chunkData) {
        // Calculate height directly using new terrain system
        const height = getTerrainHeight(x, z);
        return height + 0.5;
    }

    // Interpolate height from heightmap
    const worldX = cx * CHUNK_SIZE;
    const worldZ = cz * CHUNK_SIZE;
    const resolution = chunkData.heightmap.length - 1;

    const localX = (x - worldX) / CHUNK_SIZE;
    const localZ = (z - worldZ) / CHUNK_SIZE;

    const i = localX * resolution;
    const j = localZ * resolution;

    const i0 = Math.floor(i);
    const i1 = Math.min(i0 + 1, resolution);
    const j0 = Math.floor(j);
    const j1 = Math.min(j0 + 1, resolution);

    const fracX = i - i0;
    const fracZ = j - j0;

    const h00 = chunkData.heightmap[i0][j0];
    const h10 = chunkData.heightmap[i1][j0];
    const h01 = chunkData.heightmap[i0][j1];
    const h11 = chunkData.heightmap[i1][j1];

    const h0 = h00 * (1 - fracX) + h10 * fracX;
    const h1 = h01 * (1 - fracX) + h11 * fracX;
    const height = h0 * (1 - fracZ) + h1 * fracZ;

    return height + 0.5;
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
                // Check if this player already exists in world (offline)
                const existingPlayer = getPlayerByUsername(user.username);
                let playerState;

                if (existingPlayer && !existingPlayer.isOnline) {
                    // Player is reconnecting - restore their offline character
                    console.log(`[Server] ${user.username} reconnecting - restoring offline character`);

                    // Remove the offline entry
                    players.delete(existingPlayer.socketId);

                    // Update socket ID and bring online
                    existingPlayer.setOnline(socket.id);
                    players.set(socket.id, existingPlayer);
                    playerState = existingPlayer;

                    // Update model if they changed it
                    if (data.model) {
                        playerState.model = data.model;
                    }
                } else {
                    // New login or player was fully removed - create fresh

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
                    playerState = addPlayer(socket.id, user.username, {
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
                }

                // Send full state to the logging-in player
                socket.emit('loginSuccess', {
                    id: socket.id,
                    player: playerState.toFullState()
                });

                // Send existing players to new player (network packets for other players)
                socket.emit('currentPlayers', getPlayersObject());

                // Notify others about player coming online (or being new)
                socket.broadcast.emit('playerCameOnline', {
                    id: socket.id,
                    player: playerState.toNetworkPacket()
                });

                console.log(`[Server] ${user.username} logged in. Total players in world: ${players.size}`);
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
        const startTime = Date.now();
        console.log(`[${socket.id}] Requesting ${chunks.length} chunks`);

        // THROTTLE: Process max 4 chunks per request to prevent event loop blocking
        const MAX_CHUNKS_PER_REQUEST = 4;
        const chunksToProcess = chunks.slice(0, MAX_CHUNKS_PER_REQUEST);

        if (chunks.length > MAX_CHUNKS_PER_REQUEST) {
            console.warn(`[${socket.id}] Request limited: ${chunks.length} -> ${MAX_CHUNKS_PER_REQUEST} chunks (client should request fewer at a time)`);
        }

        let generatedCount = 0;
        let cachedCount = 0;

        for (const { cx, cz } of chunksToProcess) {
            const chunkStartTime = Date.now();

            let chunkData = await db.getChunk(cx, cz);
            if (!chunkData) {
                // Generate and save new chunk
                chunkData = generateChunk(cx, cz);
                await db.saveChunk(cx, cz, chunkData);
                generatedCount++;

                const genTime = Date.now() - chunkStartTime;
                if (genTime > 50) {
                    console.warn(`[SLOW] Chunk (${cx}, ${cz}) generation took ${genTime}ms`);
                }
            } else {
                cachedCount++;
            }
            socket.emit('chunkData', chunkData);
        }

        const totalTime = Date.now() - startTime;
        console.log(`[${socket.id}] Sent ${chunksToProcess.length} chunks (${generatedCount} generated, ${cachedCount} cached) in ${totalTime}ms`);
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

    // --- TERRAIN MODIFICATION (DIGGING) ---
    socket.on('digTerrain', async (data) => {
        const { x, y, z, shape } = data;
        const playerState = getPlayer(socket.id);

        if (!playerState) {
            console.warn(`[digTerrain] Player not found: ${socket.id}`);
            return;
        }

        console.log(`[digTerrain] ${playerState.username} digging at (${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}) shape: ${shape}`);

        // Get terrain height at dig position
        const terrainHeight = getTerrainHeight(x, z);

        // Validate dig position (must be on ground, not midair)
        if (Math.abs(y - terrainHeight) > 1.0) {
            console.warn(`[digTerrain] Invalid dig position: y=${y}, terrainHeight=${terrainHeight}`);
            return;
        }

        // Determine material based on terrain properties
        const c = getContinentalness(x, z);
        const slope = calculateSlope(x, z);
        const material = getTerrainMaterial(terrainHeight, slope, c);

        console.log(`[digTerrain] Material: ${material}, height: ${terrainHeight.toFixed(2)}, slope: ${slope.toFixed(2)}`);

        // Find chunk coordinates
        const cx = Math.floor(x / CHUNK_SIZE);
        const cz = Math.floor(z / CHUNK_SIZE);

        // Load chunk
        let chunkData = await db.getChunk(cx, cz);
        if (!chunkData) {
            chunkData = generateChunk(cx, cz);
            await db.saveChunk(cx, cz, chunkData);
        }

        // Modify heightmap to create hole
        const digSize = 2.0; // 2x2 meter square (larger for cleaner edges)
        const digDepth = 1.0; // 1 meter deep (more visible)
        const modifiedHeightmap = JSON.parse(JSON.stringify(chunkData.heightmap)); // Deep copy

        // Calculate affected vertices in heightmap
        const localX = x - (cx * CHUNK_SIZE);
        const localZ = z - (cz * CHUNK_SIZE);
        const resolution = RESOLUTION;

        // Calculate vertex indices that fall within dig area
        const halfSize = digSize / 2;
        const minX = localX - halfSize;
        const maxX = localX + halfSize;
        const minZ = localZ - halfSize;
        const maxZ = localZ + halfSize;

        for (let i = 0; i <= resolution; i++) {
            for (let j = 0; j <= resolution; j++) {
                const vx = (i / resolution) * CHUNK_SIZE;
                const vz = (j / resolution) * CHUNK_SIZE;

                // Check if vertex is within square bounds
                if (vx >= minX && vx <= maxX && vz >= minZ && vz <= maxZ) {
                    // Lower this vertex uniformly
                    modifiedHeightmap[i][j] -= digDepth;
                }
            }
        }


        // Update chunk data
        chunkData.heightmap = modifiedHeightmap;
        await db.saveChunk(cx, cz, chunkData);

        // Spawn material cube
        const cubeId = `cube_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const cube = {
            id: cubeId,
            material: material,
            x: x,
            y: terrainHeight + 0.5, // Pop up from ground
            z: z,
            velocityY: 2.0 // Initial upward velocity
        };

        // Broadcast terrain modification to nearby players
        const nearby = getNearbyPlayers(x, z, UPDATE_RADIUS);
        nearby.forEach(target => {
            io.to(target.socketId).emit('terrainModified', {
                chunk: chunkData,
                cube: cube
            });
        });

        console.log(`[digTerrain] Chunk (${cx}, ${cz}) modified, material cube spawned: ${material}`);
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
        const playerState = markPlayerOffline(socket.id);
        if (playerState) {
            console.log(`[Server] ${playerState.username} went offline. They remain in world as idle.`);

            // Save full state to DB
            db.savePlayerState(playerState.username, playerState.toDBObject());

            // Notify clients that player went offline (but NOT removed - they stay visible)
            io.emit('playerWentOffline', {
                id: playerState.socketId,
                username: playerState.username
            });
            console.log(`[Server] Total players in world: ${players.size} (including offline)`);
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

// Loading screen configuration - can be updated via dashboard later
app.get('/api/loading-screen', (req, res) => {
    res.json({
        imageUrl: '/loading_screen.png',
        title: 'XANDOR',
        subtitle: 'Loading world...',
        version: '1.0.0'
    });
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