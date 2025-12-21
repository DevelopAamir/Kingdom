const express = require('express');
const app = express();
const http = require('http').createServer(app);
const io = require('socket.io')(http);
const db = require('./database');

app.use(express.static('public'));
app.use(express.json()); // Enable JSON body parsing

// In-Memory Game State
// players[socket.id] = { username, health, x, y, z, rotation, inventory, ... }
let players = {};

// In-memory world items cache (synced with DB)
let worldItems = {};

// --- TERRAIN GENERATION ---
const CHUNK_SIZE = 50;
const WORLD_SEED = 12345;

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

// Generate chunk data
function generateChunk(cx, cz) {
    const resolution = 10; // 10x10 height samples per chunk
    const heightmap = [];
    const trees = [];

    const worldX = cx * CHUNK_SIZE;
    const worldZ = cz * CHUNK_SIZE;

    // Generate heightmap
    for (let i = 0; i <= resolution; i++) {
        heightmap[i] = [];
        for (let j = 0; j <= resolution; j++) {
            const wx = worldX + (i / resolution) * CHUNK_SIZE;
            const wz = worldZ + (j / resolution) * CHUNK_SIZE;

            // Multi-octave noise for mountains
            const height = perlinNoise(wx, wz, WORLD_SEED) * 40; // Max 40 units height (tall mountains)
            heightmap[i][j] = height;
        }
    }

    // Generate trees (random positions within chunk)
    const treeCount = Math.floor(seededRandom(cx * 1000 + cz + WORLD_SEED) * 5) + 2; // 2-7 trees per chunk
    const treeTypes = ['Pine Tree', 'Pine Tree', 'Pine Tree', 'Pine Tree', 'Pine Tree',
        'Pine Tree', 'Pine Tree', 'Tree', 'Tree', 'Tree2'];

    for (let i = 0; i < treeCount; i++) {
        const tx = worldX + seededRandom(cx * 100 + cz * 10 + i + WORLD_SEED) * CHUNK_SIZE;
        const tz = worldZ + seededRandom(cz * 100 + cx * 10 + i + WORLD_SEED * 2) * CHUNK_SIZE;

        // Get height at tree position
        const hi = Math.floor(((tx - worldX) / CHUNK_SIZE) * resolution);
        const hj = Math.floor(((tz - worldZ) / CHUNK_SIZE) * resolution);
        const ty = heightmap[Math.min(hi, resolution)][Math.min(hj, resolution)] || 0;

        const typeIndex = Math.floor(seededRandom(tx + tz + WORLD_SEED) * treeTypes.length);

        trees.push({
            type: treeTypes[typeIndex],
            x: tx,
            y: ty,
            z: tz,
            scale: 3 + seededRandom(tx * tz + WORLD_SEED) * 2 // 3-5 scale (larger trees)
        });
    }

    return { cx, cz, heightmap, trees };
}
// Notify players within range of an event
function notifyNearby(eventX, eventZ, eventName, data, range = 50) {
    Object.keys(players).forEach(id => {
        const p = players[id];
        const dx = p.x - eventX;
        const dz = p.z - eventZ;
        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist <= range) {
            io.to(id).emit(eventName, data);
        }
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

async function spawnInitialWeapons() {
    // Clear all existing weapons first
    await db.clearAllWorldItems();
    worldItems = {};
    console.log('Cleared all existing weapons from DB');

    const types = ['MPSD', 'Sniper'];
    const SPAWN_COUNT = 100; // Reduced density - spread across whole map
    const WORLD_RANGE = 1000; // -500 to +500 (larger map coverage)

    for (let i = 0; i < SPAWN_COUNT; i++) {
        const type = types[i % 2];
        const x = (Math.random() - 0.5) * WORLD_RANGE;
        const z = (Math.random() - 0.5) * WORLD_RANGE;
        // Use terrain height formula for proper placement
        const y = perlinNoise(x, z, WORLD_SEED) * 40 + 1.5; // Match terrain height (40) + lift
        const id = `weapon_${Date.now()}_${i}`;

        await db.saveWorldItem(id, type, x, y, z);
        worldItems[id] = { id, type, x, y, z };
    }
    console.log(`Spawned ${SPAWN_COUNT} weapons across ${WORLD_RANGE}x${WORLD_RANGE} world`);
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
                // Initialize Player in Game Memory
                players[socket.id] = {
                    username: user.username,
                    model: data.model || 'Soldier', // Store selected model
                    x: user.x || 0,
                    y: user.y || 1,
                    z: user.z || 0,
                    rotation: 0,
                    health: user.health > 0 ? user.health : 200, // Respawn if dead stored (200 HP max)
                    inventory: (user.inventory && user.inventory.length > 0) ? user.inventory : ['MPSD', 'Sniper']
                };

                socket.emit('loginSuccess', {
                    id: socket.id,
                    player: players[socket.id],
                    inventory: players[socket.id].inventory
                });

                // Send existing players to new player
                socket.emit('currentPlayers', players);

                // Notify others
                socket.broadcast.emit('newPlayer', { id: socket.id, player: players[socket.id] });

                console.log(`${user.username} logged in.`);
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
        if (players[socket.id]) {
            const p = players[socket.id];
            p.x = movementData.x;
            p.y = movementData.y;
            p.z = movementData.z;
            p.rotation = movementData.rotation;
            p.pitch = movementData.pitch;
            p.equippedSlot = movementData.equippedSlot;

            const packet = { id: socket.id, ...p };

            // Broadcast only to nearby players
            for (const targetId in players) {
                if (targetId === socket.id) continue;

                const target = players[targetId];
                if (!target) continue;

                const dx = p.x - target.x;
                const dy = p.y - target.y;
                const dz = p.z - target.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq < UPDATE_RADIUS * UPDATE_RADIUS) {
                    io.to(targetId).emit('playerMoved', packet);
                }
            }
        }
    });

    socket.on('shoot', () => {
        // Visual only: tell others I shot
        if (players[socket.id]) {
            const p = players[socket.id];

            // Broadcast only to nearby players
            for (const targetId in players) {
                if (targetId === socket.id) continue;

                const target = players[targetId];
                if (!target) continue;

                const dx = p.x - target.x;
                const dy = p.y - target.y;
                const dz = p.z - target.z;
                const distSq = dx * dx + dy * dy + dz * dz;

                if (distSq < UPDATE_RADIUS * UPDATE_RADIUS) {
                    io.to(targetId).emit('playerShoot', { id: socket.id });
                }
            }
        }
    });

    socket.on('playerHit', (data) => {
        // data = { targetId: string, damage: number }
        // Trust Client for MVP Hit Detection
        const targetId = data.targetId;
        const damage = data.damage || 10; // Use client damage, fallback to 10
        const target = players[targetId];

        if (target && target.health > 0) {
            target.health -= damage;

            // Notify Hit
            io.to(targetId).emit('updateHealth', target.health);
            // Include damage amount for visual feedback
            io.emit('playerDamaged', { id: targetId, health: target.health, damage: damage });
            if (target.health <= 0) {
                // PLAYER DIED
                io.emit('playerDied', { id: targetId, killerId: socket.id });
                io.to(targetId).emit('youDied', { message: "You Died! Inventory lost." });

                // Reward Killer
                const killer = players[socket.id];
                if (killer) {
                    const lootTable = ["Legendary AK47", "Golden Vest", "Sniper Scope", "Medkit"];
                    const randomLoot = lootTable[Math.floor(Math.random() * lootTable.length)];
                    killer.inventory.push(randomLoot);
                    socket.emit('updateInventory', killer.inventory);
                    socket.emit('notification', { message: `You killed ${target.username} and found ${randomLoot}!` });
                }

                // Reset/Respawn Logic with Delay (for Death Animation)
                setTimeout(() => {
                    if (players[targetId]) {
                        const t = players[targetId];
                        t.health = 200;
                        t.x = (Math.random() - 0.5) * 50;
                        t.y = 0; // Fix: Spawn on ground, not in air
                        t.z = (Math.random() - 0.5) * 50;
                        t.inventory = []; // Lose items!

                        // Broadcast Respawn to ALL (Reset Animations + Position)
                        io.emit('playerRespawn', { id: targetId, x: t.x, y: t.y, z: t.z });

                        io.to(targetId).emit('updateHealth', 200); // Inform client they are alive
                    }
                }, 3000); // 3 Seconds Delay
            }
        }
    });

    socket.on('updateInventory', (inventory) => {
        if (players[socket.id]) {
            players[socket.id].inventory = inventory;
            socket.broadcast.emit('playerInventoryUpdated', {
                id: socket.id,
                inventory: inventory
            });
        }
    });

    socket.on('disconnect', () => {
        if (players[socket.id]) {
            const p = players[socket.id];
            console.log(`${p.username} disconnected.`);

            // Save State
            db.savePlayerState(p.username, p);

            delete players[socket.id];
            io.emit('playerDisconnected', socket.id);
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
    // Spawn fresh weapons on server start
    await spawnInitialWeapons();

    http.listen(3000, '0.0.0.0', () => {
        console.log('Battlefield server running on *:3000');
        console.log('Access via LAN: http://192.168.1.145:3000 (or your machine IP)');
    });
});