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
        health INTEGER DEFAULT 100,
        x REAL DEFAULT 0,
        y REAL DEFAULT 1,
        z REAL DEFAULT 0
    )`);
    db.run(`CREATE TABLE IF NOT EXISTS calibration (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT UNIQUE,
        data TEXT
    )`);
});

const Database = {
    createUser: (username, password) => {
        return new Promise(async (resolve, reject) => {
            try {
                const hash = await bcrypt.hash(password, 10);
                db.run(`INSERT INTO users (username, password) VALUES (?, ?)`, [username, hash], function (err) {
                    if (err) return reject(err);
                    resolve({ id: this.lastID, username, health: 100, inventory: [] });
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
                    // Parse inventory from JSON string
                    try { row.inventory = JSON.parse(row.inventory); } catch (e) { row.inventory = []; }
                    resolve(row);
                } else {
                    resolve(null); // Wrong password
                }
            });
        });
    },

    savePlayerState: (username, data) => {
        // data: { health, inventory, x, y, z }
        // We only save major state changes or on disconnect to avoid spamming DB
        const invStr = JSON.stringify(data.inventory || []);
        db.run(`UPDATE users SET health = ?, inventory = ?, x = ?, y = ?, z = ? WHERE username = ?`,
            [data.health, invStr, data.x, data.y, data.z, username], (err) => {
                if (err) console.error("Save Error:", err);
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
    }
};

module.exports = Database;
