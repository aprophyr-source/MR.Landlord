const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

const dbFile = path.join(__dirname, 'rental.db');
const db = new sqlite3.Database(dbFile);

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY AUTOINCREMENT, passcode TEXT, landlord_name TEXT)`);
    db.run(`CREATE TABLE IF NOT EXISTS tenants (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT, room TEXT, phone TEXT, monthly_rent INTEGER DEFAULT 0, due INTEGER DEFAULT 0, advance INTEGER DEFAULT 0)`);
    db.run(`CREATE TABLE IF NOT EXISTS history (id INTEGER PRIMARY KEY AUTOINCREMENT, tenant_id INTEGER, date TEXT, note TEXT, amount INTEGER, type TEXT, collector TEXT)`);
});

app.get('/', (req, res) => {
    db.get(`SELECT * FROM settings LIMIT 1`, (err, settings) => {
        if (!settings) {
            res.render('setup');
        } else {
            db.all(`SELECT * FROM tenants`, (err, tenants) => {
                res.render('login', { settings, tenants: tenants || [] });
            });
        }
    });
});

app.post('/setup', (req, res) => {
    const { passcode, landlord_name } = req.body;
    db.run(`INSERT INTO settings (passcode, landlord_name) VALUES (?, ?)`, [passcode, landlord_name], () => {
        res.redirect('/');
    });
});

app.post('/dashboard', (req, res) => {
    const { passcode } = req.body;
    db.get(`SELECT * FROM settings LIMIT 1`, (err, settings) => {
        if (settings && settings.passcode === passcode) {
            db.all(`SELECT * FROM tenants`, (err, tenants) => {
                res.render('dashboard', { settings, tenants, activeTenant: null });
            });
        } else {
            db.render('login', { error: 'Incorrect Passcode / गलत पासकोड', settings });
        }
    });
});

app.post('/tenant/add', (req, res) => {
    const { name, room, phone, monthly_rent, initial_due } = req.body;
    db.run(`INSERT INTO tenants (name, room, phone, monthly_rent, due, advance) VALUES (?, ?, ?, ?, ?, 0)`,
        [name, room, phone, monthly_rent || 0, initial_due || 0], () => {
            res.redirect('/app');
        });
});

app.post('/tenant/delete/:id', (req, res) => {
    const id = req.params.id;
    db.run(`DELETE FROM tenants WHERE id = ?`, [id], () => {
        db.run(`DELETE FROM history WHERE tenant_id = ?`, [id], () => {
            res.redirect('/app');
        });
    });
});

app.get('/app', (req, res) => {
    db.get(`SELECT * FROM settings LIMIT 1`, (err, settings) => {
        db.all(`SELECT * FROM tenants`, (err, tenants) => {
            res.render('dashboard', { settings, tenants, activeTenant: null });
        });
    });
});

app.get('/tenant/:id', (req, res) => {
    const tenantId = req.params.id;
    db.get(`SELECT * FROM settings LIMIT 1`, (err, settings) => {
        db.all(`SELECT * FROM tenants`, (err, tenants) => {
            db.get(`SELECT * FROM tenants WHERE id = ?`, [tenantId], (err, activeTenant) => {
                db.all(`SELECT * FROM history WHERE tenant_id = ? ORDER BY id DESC`, [tenantId], (err, history) => {
                    res.render('dashboard', { settings, tenants, activeTenant, history: history || [] });
                });
            });
        });
    });
});

app.post('/tenant/:id/transaction', (req, res) => {
    const tenantId = req.params.id;
    const { amount, type, collector, note } = req.body;
    const numAmount = parseInt(amount);

    db.get(`SELECT * FROM tenants WHERE id = ?`, [tenantId], (err, tenant) => {
        let newDue = tenant.due;
        let newAdvance = tenant.advance;

        if (type === 'payment') {
            if (newDue >= numAmount) {
                newDue -= numAmount;
            } else {
                let remainder = numAmount - newDue;
                newDue = 0;
                newAdvance += remainder;
            }
        } else {
            newDue += numAmount;
        }

        db.run(`UPDATE tenants SET due = ?, advance = ? WHERE id = ?`, [newDue, newAdvance, tenantId], () => {
            const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
            db.run(`INSERT INTO history (tenant_id, date, note, amount, type, collector) VALUES (?, ?, ?, ?, ?, ?)`,
                [tenantId, todayStr, note, numAmount, type, collector], () => {
                    res.redirect(`/tenant/${tenantId}?invoice=true&amt=${numAmount}&note=${encodeURIComponent(note)}&col=${encodeURIComponent(collector)}&due=${newDue}`);
                });
        });
    });
});

app.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});