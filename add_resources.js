const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const dbPath = path.join(__dirname, 'game.db');
const db = new sqlite3.Database(dbPath);

// Usage: node add_resources.js <username> <resource> <amount>
// Example: node add_resources.js Survivor wood 100

const args = process.argv.slice(2);
if (args.length < 3) {
    console.log("Usage: node add_resources.js <username> <resource> <amount>");
    console.log("Example: node add_resources.js Survivor wood 100");
    console.log("Note: The player MUST be offline, otherwise the server will overwrite the save when they disconnect.");
    process.exit(1);
}

const username = args[0];
const resourceId = args[1];
const amountStr = args[2];

const amount = parseInt(amountStr);
if (isNaN(amount) || amount <= 0) {
    console.error("Error: Amount must be a positive number.");
    process.exit(1);
}

db.get(`SELECT id, inventory FROM users WHERE username = ?`, [username], (err, row) => {
    if (err) {
        console.error("Database error:", err);
        process.exit(1);
    }

    if (!row) {
        console.error(`User '${username}' not found in database.`);
        process.exit(1);
    }

    let inventory = [];
    try {
        if (row.inventory) {
            let parsed = JSON.parse(row.inventory);

            // Fix corrupt format: {"inventory": [...]} -> [...]
            if (parsed && typeof parsed === 'object' && parsed.inventory && Array.isArray(parsed.inventory)) {
                inventory = parsed.inventory;
            } else if (Array.isArray(parsed)) {
                inventory = parsed;
            }
        }
    } catch (e) {
        console.error("Error parsing inventory. Resetting to empty.");
    }

    // Find item
    let found = false;
    for (let i = 0; i < inventory.length; i++) {
        if (inventory[i].toolId === resourceId) {
            inventory[i].quantity += amount;
            found = true;
            break;
        }
    }

    // Not found, add new
    if (!found) {
        inventory.push({ toolId: resourceId, quantity: amount });
    }

    const newInventoryJson = JSON.stringify(inventory);

    db.run(`UPDATE users SET inventory = ? WHERE id = ?`, [newInventoryJson, row.id], function (err) {
        if (err) {
            console.error("Failed to update inventory:", err);
        } else {
            console.log(`✅ Successfully added ${amount} ${resourceId} to ${username}'s inventory!`);
            console.log(`New inventory: ${newInventoryJson}`);
        }
        db.close();
    });
});
