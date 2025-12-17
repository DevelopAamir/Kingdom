const sqlite3 = require('sqlite3').verbose();
const db = new sqlite3.Database('./game.db');

db.serialize(() => {
    db.all("SELECT * FROM calibration", (err, rows) => {
        if (err) {
            console.error(err);
            return;
        }
        rows.forEach(row => {
            console.log(`--- TYPE: ${row.type} ---`);
            console.log(row.data);
        });
    });
});
