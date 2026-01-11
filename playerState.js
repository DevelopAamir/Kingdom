/**
 * PlayerState - Server-side player state management
 * This is the source of truth for all player data
 */

class PlayerState {
    constructor(socketId, username, dbData = {}) {
        this.socketId = socketId;
        this.username = username;

        // Position
        this.x = dbData.x || 0;
        this.y = dbData.y || 5;
        this.z = dbData.z || 0;
        this.rotation = dbData.rotation || 0;
        this.pitch = dbData.pitch || 0;

        // Combat
        this.health = dbData.health || 200;
        this.maxHealth = 200;
        this.kills = dbData.kills || 0;
        this.deaths = dbData.deaths || 0;

        // Inventory (misc items)
        this.inventory = this.parseJSON(dbData.inventory, []);

        // Animation state (not persisted to DB)
        this.moveSpeed = 0;
        this.moveDirX = 0;
        this.moveDirY = 0;
        this.animationState = 'idle'; // idle, run, jump, die

        // Meta
        this.model = dbData.model || 'Ninja';
        this.lastUpdate = Date.now();
        this.isAlive = true;
    }

    // Helper to parse JSON safely
    parseJSON(value, defaultVal) {
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
            try {
                return JSON.parse(value);
            } catch (e) {
                return defaultVal;
            }
        }
        return defaultVal;
    }

    // Update position from client movement
    updatePosition(data) {
        this.x = data.x ?? this.x;
        this.y = data.y ?? this.y;
        this.z = data.z ?? this.z;
        this.rotation = data.rotation ?? this.rotation;
        this.pitch = data.pitch ?? this.pitch;
        this.moveSpeed = data.moveSpeed ?? this.moveSpeed;
        this.moveDirX = data.moveDirX ?? this.moveDirX;
        this.moveDirY = data.moveDirY ?? this.moveDirY;

        this.animationState = data.animationState ?? this.animationState;
        this.lastUpdate = Date.now();
    }

    // Take damage, returns true if died
    takeDamage(amount) {
        if (!this.isAlive) return false;

        this.health = Math.max(0, this.health - amount);
        if (this.health <= 0) {
            this.isAlive = false;
            this.deaths++;
            this.animationState = 'die';
            return true; // Died
        }
        return false;
    }

    // Add a kill
    addKill() {
        this.kills++;
    }

    // Respawn player
    respawn(x, y, z) {
        this.health = this.maxHealth;
        this.x = x;
        this.y = y;
        this.z = z;
        this.isAlive = true;
        this.animationState = 'idle';
        // Keep weapons and inventory on respawn (can be changed if desired)
    }



    // Convert to DB-safe object for persistence
    toDBObject() {
        return {
            health: this.health,
            x: this.x,
            y: this.y,
            z: this.z,
            rotation: this.rotation,
            kills: this.kills,
            deaths: this.deaths,
            inventory: JSON.stringify(this.inventory),
            model: this.model
        };
    }

    // Convert to network packet for other players
    toNetworkPacket() {
        return {
            id: this.socketId,
            username: this.username,
            x: this.x,
            y: this.y,
            z: this.z,
            rotation: this.rotation,
            pitch: this.pitch,
            health: this.health,
            moveSpeed: this.moveSpeed,
            moveDirX: this.moveDirX,
            moveDirY: this.moveDirY,
            model: this.model,
            animationState: this.animationState,
            inventory: []
        };
    }

    // Convert to full state for the owning player
    toFullState() {
        return {
            ...this.toNetworkPacket(),
            inventory: this.inventory,
            kills: this.kills,
            deaths: this.deaths,
            maxHealth: this.maxHealth,
            isAlive: this.isAlive
        };
    }
}

// Global players Map - stores all connected players
const players = new Map();

// Helper functions
function getPlayer(socketId) {
    return players.get(socketId);
}

function getAllPlayers() {
    return Array.from(players.values());
}

function getPlayersObject() {
    // Convert Map to object for backward compatibility
    const obj = {};
    players.forEach((state, id) => {
        obj[id] = state.toNetworkPacket();
    });
    return obj;
}

function addPlayer(socketId, username, dbData) {
    const state = new PlayerState(socketId, username, dbData);
    players.set(socketId, state);
    return state;
}

function removePlayer(socketId) {
    const state = players.get(socketId);
    players.delete(socketId);
    return state; // Return for saving to DB
}

function getNearbyPlayers(x, z, radius) {
    const nearby = [];
    const radiusSq = radius * radius;

    players.forEach((state, id) => {
        const dx = state.x - x;
        const dz = state.z - z;
        if (dx * dx + dz * dz <= radiusSq) {
            nearby.push(state);
        }
    });

    return nearby;
}

module.exports = {
    PlayerState,
    players,
    getPlayer,
    getAllPlayers,
    getPlayersObject,
    addPlayer,
    removePlayer,
    getNearbyPlayers
};
