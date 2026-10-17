const express = require('express');
const mongoose = require('mongoose');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Connect to Permanent MongoDB Atlas Cloud Database
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI)
    .then(() => console.log("Connected to Permanent Cloud Database!"))
    .catch(err => console.error("Database connection error:", err));

// Cloud Schemas
const SettingsSchema = new mongoose.Schema({
    passcode: String,
    landlord_name: String
});
const Settings = mongoose.model('Settings', SettingsSchema);

const HistoryItemSchema = new mongoose.Schema({
    date: String,
    note: String,
    amount: Number,
    type: { type: String },
    collector: String
}, { _id: false });

const TenantSchema = new mongoose.Schema({
    name: String,
    room: String,
    phone: String,
    monthly_rent: { type: Number, default: 0 },
    due: { type: Number, default: 0 },
    advance: { type: Number, default: 0 },
    history: [HistoryItemSchema]
});
const Tenant = mongoose.model('Tenant', TenantSchema);

// Helper to normalize `_id` to `id` for EJS templates
const formatDoc = (doc) => {
    if (!doc) return null;
    const obj = doc.toObject();
    obj.id = obj._id.toString();
    return obj;
};

// Routes
app.get('/', async (req, res) => {
    try {
        const settings = await Settings.findOne();
        if (!settings) {
            res.render('setup');
        } else {
            const rawTenants = await Tenant.find();
            const tenants = rawTenants.map(formatDoc);
            res.render('login', { settings, tenants, error: null });
        }
    } catch (err) {
        res.status(500).send("Database starting up... please refresh in 5 seconds.");
    }
});

app.post('/setup', async (req, res) => {
    await Settings.create({
        passcode: req.body.passcode,
        landlord_name: req.body.landlord_name
    });
    res.redirect('/');
});

app.post('/dashboard', async (req, res) => {
    const settings = await Settings.findOne();
    const rawTenants = await Tenant.find();
    const tenants = rawTenants.map(formatDoc);
    if (settings && settings.passcode === req.body.passcode) {
        res.render('dashboard', { settings, tenants, activeTenant: null, history: [] });
    } else {
        res.render('login', { error: 'Incorrect Passcode / गलत पासकोड', settings, tenants });
    }
});

app.get('/app', async (req, res) => {
    const settings = await Settings.findOne();
    const rawTenants = await Tenant.find();
    const tenants = rawTenants.map(formatDoc);
    res.render('dashboard', { settings, tenants, activeTenant: null, history: [] });
});

app.post('/tenant/add', async (req, res) => {
    await Tenant.create({
        name: req.body.name,
        room: req.body.room,
        phone: req.body.phone,
        monthly_rent: parseInt(req.body.monthly_rent) || 0,
        due: parseInt(req.body.initial_due) || 0,
        advance: 0,
        history: []
    });
    res.redirect('/app');
});

app.post('/tenant/delete/:id', async (req, res) => {
    await Tenant.findByIdAndDelete(req.params.id);
    res.redirect('/app');
});

app.get('/tenant/:id', async (req, res) => {
    const settings = await Settings.findOne();
    const rawTenants = await Tenant.find();
    const tenants = rawTenants.map(formatDoc);
    const rawActive = await Tenant.findById(req.params.id);
    const activeTenant = formatDoc(rawActive);
    const history = activeTenant ? [...activeTenant.history].reverse() : [];
    res.render('dashboard', { settings, tenants, activeTenant, history });
});

app.post('/tenant/:id/transaction', async (req, res) => {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) return res.redirect('/app');

    const numAmount = parseInt(req.body.amount) || 0;
    const txType = req.body.type;

    if (txType === 'payment') {
        if (tenant.due >= numAmount) {
            tenant.due -= numAmount;
        } else {
            let remainder = numAmount - tenant.due;
            tenant.due = 0;
            tenant.advance += remainder;
        }
    } else {
        tenant.due += numAmount;
    }

    const todayStr = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
    tenant.history.push({
        date: todayStr,
        note: req.body.note,
        amount: numAmount,
        type: txType,
        collector: req.body.collector
    });

    await tenant.save();
    res.redirect(`/tenant/${tenant._id}?invoice=true&amt=${numAmount}&note=${encodeURIComponent(req.body.note)}&col=${encodeURIComponent(req.body.collector)}&due=${tenant.due}`);
});

app.listen(PORT, () => {
    console.log(`Cloud server running on port ${PORT}`);
});
