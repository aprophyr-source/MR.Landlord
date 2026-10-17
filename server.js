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
    last_rent_month: { type: String, default: "" }, // Format: "YYYY-MM"
    history: [HistoryItemSchema]
});
const Tenant = mongoose.model('Tenant', TenantSchema);

// Helper: Current Year-Month in IST (e.g. "2026-10")
const getCurrentYearMonth = () => {
    const now = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

// Helper: Add a charge/due and automatically cancel out any existing Advance first
const applyCharge = (tenant, chargeAmount) => {
    if (tenant.advance > 0) {
        if (tenant.advance >= chargeAmount) {
            tenant.advance -= chargeAmount;
        } else {
            const remainingDue = chargeAmount - tenant.advance;
            tenant.advance = 0;
            tenant.due += remainingDue;
        }
    } else {
        tenant.due += chargeAmount;
    }
};

// Helper: Add a payment/advance and automatically pay off any existing Due first
const applyPayment = (tenant, paymentAmount) => {
    if (tenant.due > 0) {
        if (tenant.due >= paymentAmount) {
            tenant.due -= paymentAmount;
        } else {
            const extraAdvance = paymentAmount - tenant.due;
            tenant.due = 0;
            tenant.advance += extraAdvance;
        }
    } else {
        tenant.advance += paymentAmount;
    }
};

// Helper: Reconcile any existing stuck balances where both due > 0 and advance > 0
const reconcileExistingBalance = (tenant) => {
    if (tenant.due > 0 && tenant.advance > 0) {
        if (tenant.advance >= tenant.due) {
            tenant.advance -= tenant.due;
            tenant.due = 0;
        } else {
            tenant.due -= tenant.advance;
            tenant.advance = 0;
        }
        return true;
    }
    return false;
};

// Automatic Monthly Rent Engine: Checks if a new month has started and adds monthly_rent
const syncMonthlyRent = async () => {
    const currentYM = getCurrentYearMonth();
    const [curYear, curMonth] = currentYM.split('-').map(Number);
    const tenants = await Tenant.find();

    for (const tenant of tenants) {
        let modified = reconcileExistingBalance(tenant);

        if (!tenant.last_rent_month) {
            // Initialize existing tenants to current month so they aren't double-charged mid-month
            tenant.last_rent_month = currentYM;
            modified = true;
        } else if (tenant.last_rent_month < currentYM && tenant.monthly_rent > 0) {
            let [lastYear, lastMonth] = tenant.last_rent_month.split('-').map(Number);

            while (lastYear < curYear || (lastYear === curYear && lastMonth < curMonth)) {
                lastMonth++;
                if (lastMonth > 12) {
                    lastMonth = 1;
                    lastYear++;
                }

                const monthDate = new Date(lastYear, lastMonth - 1, 1);
                const monthLabel = monthDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                const dateStr = monthDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

                applyCharge(tenant, tenant.monthly_rent);

                tenant.history.push({
                    date: dateStr,
                    note: `Auto Monthly Rent (${monthLabel})`,
                    amount: tenant.monthly_rent,
                    type: 'charge',
                    collector: 'System Auto'
                });
            }
            tenant.last_rent_month = currentYM;
            modified = true;
        }

        if (modified) {
            await tenant.save();
        }
    }
};

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
            await syncMonthlyRent();
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
    await syncMonthlyRent();
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
    await syncMonthlyRent();
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
        last_rent_month: getCurrentYearMonth(),
        history: []
    });
    res.redirect('/app');
});

app.post('/tenant/delete/:id', async (req, res) => {
    await Tenant.findByIdAndDelete(req.params.id);
    res.redirect('/app');
});

app.get('/tenant/:id', async (req, res) => {
    await syncMonthlyRent();
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

    reconcileExistingBalance(tenant);

    const numAmount = parseInt(req.body.amount) || 0;
    const txType = req.body.type;

    if (txType === 'payment') {
        applyPayment(tenant, numAmount);
    } else {
        applyCharge(tenant, numAmount);
    }

    // Capture Date, Month, and Year from the dropdowns
    const d = req.body.tx_date || new Date().getDate();
    const m = req.body.tx_month || 'Oct';
    const y = req.body.tx_year || '2026';
    const dateStr = `${d} ${m} ${y}`;

    const noteText = req.body.note ? req.body.note.trim() : `${m} ${y} Transaction`;

    tenant.history.push({
        date: dateStr,
        note: noteText,
        amount: numAmount,
        type: txType,
        collector: req.body.collector
    });

    await tenant.save();
    res.redirect(`/tenant/${tenant._id}?invoice=true&amt=${numAmount}&note=${encodeURIComponent(noteText)}&col=${encodeURIComponent(req.body.collector)}&due=${tenant.due}`);
});

app.listen(PORT, () => {
    console.log(`Cloud server running on port ${PORT}`);
});
