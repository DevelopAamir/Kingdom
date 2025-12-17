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

io.on('connection', (socket) => {
    console.log('New connection:', socket.id);

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
                    health: user.health > 0 ? user.health : 100, // Respawn if dead stored
                    inventory: user.inventory || []
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

    // --- GAMEPLAY ---

    socket.on('playerMovement', (movementData) => {
        if (players[socket.id]) {
            const p = players[socket.id];
            p.x = movementData.x;
            p.y = movementData.y;
            p.z = movementData.z;
            p.rotation = movementData.rotation;
            p.pitch = movementData.pitch;
            p.equippedSlot = movementData.equippedSlot;

            socket.broadcast.emit('playerMoved', { id: socket.id, ...p });
        }
    });

    socket.on('shoot', () => {
        // Visual only: tell others I shot
        socket.broadcast.emit('playerShoot', { id: socket.id });
    });

    socket.on('playerHit', (data) => {
        // data = { targetId: string, damage: number }
        // Trust Client for MVP Hit Detection
        const targetId = data.targetId;
        const target = players[targetId];

        if (target && target.health > 0) {
            target.health -= 10;

            // Notify Hit
            io.to(targetId).emit('updateHealth', target.health);
            // Include damage amount for visual feedback
            io.emit('playerDamaged', { id: targetId, health: target.health, damage: 10 });
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
                        t.health = 100;
                        t.x = (Math.random() - 0.5) * 50;
                        t.y = 0; // Fix: Spawn on ground, not in air
                        t.z = (Math.random() - 0.5) * 50;
                        t.inventory = []; // Lose items!

                        // Broadcast Respawn to ALL (Reset Animations + Position)
                        io.emit('playerRespawn', { id: targetId, x: t.x, y: t.y, z: t.z });

                        io.to(targetId).emit('updateHealth', 100); // Inform client they are alive
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

http.listen(3000, '0.0.0.0', () => {
    console.log('Battlefield server running on *:3000');
    console.log('Access via LAN: http://192.168.1.145:3000 (or your machine IP)');
});