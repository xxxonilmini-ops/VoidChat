const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const path = require("path");
const express = require("express");
const { Server } = require("socket.io");

const DATA_DIR = path.join(__dirname, "data");
const DATA_FILE = path.join(DATA_DIR, "store.json");
const DEFAULT_THEME = "dark";
const MAX_NAME_LENGTH = 32;
const MAX_MESSAGE_LENGTH = 1000;
const MAX_RECENT_EVENTS = 12;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.set("trust proxy", true);
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

ensureDataFile();
let store = readStore();

function ensureDataFile() {
    fs.mkdirSync(DATA_DIR, { recursive: true });

    if (!fs.existsSync(DATA_FILE)) {
        fs.writeFileSync(
            DATA_FILE,
            JSON.stringify(
                {
                    users: [],
                    sessions: [],
                    conversations: [],
                    messages: [],
                    events: []
                },
                null,
                2
            ),
            "utf8"
        );
    }
}

function readStore() {
    try {
        const raw = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));

        return {
            users: Array.isArray(raw.users) ? raw.users : [],
            sessions: Array.isArray(raw.sessions) ? raw.sessions : [],
            conversations: Array.isArray(raw.conversations) ? raw.conversations : [],
            messages: Array.isArray(raw.messages) ? raw.messages : [],
            events: Array.isArray(raw.events) ? raw.events : []
        };
    } catch (error) {
        console.error("Failed to read data store, recreating it.", error);
        ensureDataFile();
        return {
            users: [],
            sessions: [],
            conversations: [],
            messages: [],
            events: []
        };
    }
}

function saveStore() {
    fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), "utf8");
}

function now() {
    return new Date().toISOString();
}

function createShortId(prefix, length = 6) {
    return `${prefix}-${crypto.randomBytes(Math.ceil(length / 2)).toString("hex").slice(0, length).toUpperCase()}`;
}

function createSessionToken() {
    return crypto.randomBytes(32).toString("hex");
}

function getClientIp(source) {
    const forwarded = source.headers?.["x-forwarded-for"];
    const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded;
    const rawIp = candidate ? candidate.split(",")[0].trim() : source.ip || source.socket?.remoteAddress || source.address || "unknown";

    return rawIp.startsWith("::ffff:") ? rawIp.slice(7) : rawIp;
}

function getBearerToken(req) {
    const header = req.headers.authorization || "";

    if (!header.startsWith("Bearer ")) {
        return "";
    }

    return header.slice("Bearer ".length).trim();
}

function normalizeTheme(value) {
    return value === "light" ? "light" : "dark";
}

function normalizePublicId(value) {
    return String(value || "").trim().toUpperCase();
}

function normalizeDisplayName(value) {
    const cleaned = String(value || "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_NAME_LENGTH);

    return cleaned || null;
}

function normalizeMessageText(value) {
    const cleaned = String(value || "")
        .replace(/\r/g, "")
        .trim()
        .slice(0, MAX_MESSAGE_LENGTH);

    return cleaned || null;
}

function createGuestName() {
    return `Гость ${Math.floor(1000 + Math.random() * 9000)}`;
}

function addEvent(type, payload = {}) {
    store.events.unshift({
        id: createShortId("EV", 10),
        type,
        createdAt: now(),
        ...payload
    });

    if (store.events.length > 300) {
        store.events = store.events.slice(0, 300);
    }
}

function getRecentEventsForUser(userId) {
    return store.events
        .filter((event) => {
            if (event.userId === userId || event.targetUserId === userId) {
                return true;
            }

            if (Array.isArray(event.memberIds) && event.memberIds.includes(userId)) {
                return true;
            }

            return false;
        })
        .slice(0, MAX_RECENT_EVENTS);
}

function findUserById(userId) {
    return store.users.find((user) => user.id === userId) || null;
}

function findUserByPublicId(publicId) {
    return store.users.find((user) => user.publicId === publicId) || null;
}

function findSessionByToken(token) {
    return store.sessions.find((session) => session.token === token) || null;
}

function sanitizeUser(user) {
    return {
        id: user.id,
        publicId: user.publicId,
        displayName: user.displayName,
        theme: user.theme,
        createdAt: user.createdAt,
        lastSeenAt: user.lastSeenAt,
        lastIp: user.lastIp
    };
}

function createUser(ipAddress) {
    const timestamp = now();
    const user = {
        id: createShortId("USR", 12),
        publicId: createShortId("VC", 6),
        displayName: createGuestName(),
        theme: DEFAULT_THEME,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        lastIp: ipAddress
    };

    store.users.push(user);
    addEvent("user.created", { userId: user.id, ipAddress });

    return user;
}

function createSession(userId, ipAddress) {
    const timestamp = now();
    const session = {
        token: createSessionToken(),
        userId,
        createdAt: timestamp,
        lastSeenAt: timestamp,
        lastIp: ipAddress
    };

    store.sessions = store.sessions.filter((item) => item.userId !== userId || item.lastIp !== ipAddress).slice(0, 500);
    store.sessions.push(session);

    return session;
}

function touchAuth(user, session, ipAddress) {
    const timestamp = now();

    user.lastSeenAt = timestamp;
    user.lastIp = ipAddress;
    session.lastSeenAt = timestamp;
    session.lastIp = ipAddress;
}

function getConversationUserIds(conversation) {
    return Array.isArray(conversation.memberIds) ? conversation.memberIds : [];
}

function findConversationById(conversationId) {
    return store.conversations.find((conversation) => conversation.id === conversationId) || null;
}

function findConversationBetween(userId, otherUserId) {
    return (
        store.conversations.find((conversation) => {
            const members = getConversationUserIds(conversation);

            return members.length === 2 && members.includes(userId) && members.includes(otherUserId);
        }) || null
    );
}

function createConversation(userId, otherUserId) {
    const timestamp = now();
    const conversation = {
        id: createShortId("DM", 12),
        memberIds: [userId, otherUserId],
        createdAt: timestamp,
        updatedAt: timestamp,
        lastMessagePreview: "",
        lastMessageAt: ""
    };

    store.conversations.push(conversation);
    addEvent("conversation.created", {
        userId,
        targetUserId: otherUserId,
        memberIds: [userId, otherUserId],
        conversationId: conversation.id
    });

    return conversation;
}

function getConversationPartner(conversation, viewerId) {
    const otherUserId = getConversationUserIds(conversation).find((userId) => userId !== viewerId);
    return otherUserId ? findUserById(otherUserId) : null;
}

function buildConversationSummary(conversation, viewerId) {
    const partner = getConversationPartner(conversation, viewerId);

    return {
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        lastMessagePreview: conversation.lastMessagePreview,
        lastMessageAt: conversation.lastMessageAt || conversation.createdAt,
        otherUser: partner ? sanitizeUser(partner) : null
    };
}

function getConversationSummaries(userId) {
    return store.conversations
        .filter((conversation) => getConversationUserIds(conversation).includes(userId))
        .sort((left, right) => new Date(right.updatedAt) - new Date(left.updatedAt))
        .map((conversation) => buildConversationSummary(conversation, userId));
}

function buildMessagePayload(message) {
    const sender = findUserById(message.senderId);

    return {
        id: message.id,
        conversationId: message.conversationId,
        senderId: message.senderId,
        senderName: sender ? sender.displayName : "Неизвестно",
        senderPublicId: sender ? sender.publicId : "UNKNOWN",
        text: message.text,
        createdAt: message.createdAt
    };
}

function getConversationMessages(conversationId) {
    return store.messages
        .filter((message) => message.conversationId === conversationId)
        .sort((left, right) => new Date(left.createdAt) - new Date(right.createdAt))
        .map(buildMessagePayload);
}

function buildConversationPayload(conversation, viewerId) {
    const partner = getConversationPartner(conversation, viewerId);

    return {
        id: conversation.id,
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
        otherUser: partner ? sanitizeUser(partner) : null,
        messages: getConversationMessages(conversation.id)
    };
}

function requireConversationMember(conversation, userId) {
    return getConversationUserIds(conversation).includes(userId);
}

function createMessage(conversation, senderId, text) {
    const timestamp = now();
    const message = {
        id: createShortId("MSG", 12),
        conversationId: conversation.id,
        senderId,
        text,
        createdAt: timestamp
    };

    store.messages.push(message);
    conversation.updatedAt = timestamp;
    conversation.lastMessageAt = timestamp;
    conversation.lastMessagePreview = text.slice(0, 80);

    addEvent("message.saved", {
        userId: senderId,
        memberIds: [...conversation.memberIds],
        conversationId: conversation.id,
        messageId: message.id
    });

    return message;
}

function getUserRoom(userId) {
    return `user:${userId}`;
}

function emitDataChanged(conversationId, memberIds) {
    memberIds.forEach((memberId) => {
        io.to(getUserRoom(memberId)).emit("data:changed", { conversationId });
    });
}

function emitProfileChanged(userId) {
    const affectedConversations = store.conversations.filter((conversation) => getConversationUserIds(conversation).includes(userId));

    io.to(getUserRoom(userId)).emit("data:changed", { reason: "profile" });

    affectedConversations.forEach((conversation) => {
        emitDataChanged(conversation.id, conversation.memberIds);
    });
}

function bootstrapUser(req) {
    const token = getBearerToken(req);
    const ipAddress = getClientIp(req);
    let session = token ? findSessionByToken(token) : null;
    let user = session ? findUserById(session.userId) : null;
    let recoveryMode = "new";

    if (user && session) {
        touchAuth(user, session, ipAddress);
        recoveryMode = "token";
        return { user, session, recoveryMode, ipAddress };
    }

    const ipMatches = store.users
        .filter((entry) => entry.lastIp === ipAddress)
        .sort((left, right) => new Date(right.lastSeenAt) - new Date(left.lastSeenAt));

    if (ipMatches.length === 1) {
        user = ipMatches[0];
        session = createSession(user.id, ipAddress);
        touchAuth(user, session, ipAddress);
        recoveryMode = "ip";
        addEvent("session.restored_by_ip", { userId: user.id, ipAddress });

        return { user, session, recoveryMode, ipAddress };
    }

    user = createUser(ipAddress);
    session = createSession(user.id, ipAddress);
    touchAuth(user, session, ipAddress);
    addEvent("session.created", { userId: user.id, ipAddress });

    return { user, session, recoveryMode, ipAddress };
}

function requireAuth(req, res, next) {
    const token = getBearerToken(req);

    if (!token) {
        res.status(401).json({ error: "Требуется авторизация." });
        return;
    }

    const session = findSessionByToken(token);

    if (!session) {
        res.status(401).json({ error: "Сессия не найдена." });
        return;
    }

    const user = findUserById(session.userId);

    if (!user) {
        res.status(401).json({ error: "Аккаунт не найден." });
        return;
    }

    touchAuth(user, session, getClientIp(req));
    saveStore();

    req.user = user;
    req.session = session;
    next();
}

app.get("/api/bootstrap", (req, res) => {
    const boot = bootstrapUser(req);

    saveStore();

    res.json({
        token: boot.session.token,
        recoveryMode: boot.recoveryMode,
        user: sanitizeUser(boot.user),
        conversations: getConversationSummaries(boot.user.id),
        logs: getRecentEventsForUser(boot.user.id)
    });
});

app.get("/api/conversations", requireAuth, (req, res) => {
    res.json({
        conversations: getConversationSummaries(req.user.id)
    });
});

app.get("/api/conversations/:conversationId", requireAuth, (req, res) => {
    const conversation = findConversationById(req.params.conversationId);

    if (!conversation || !requireConversationMember(conversation, req.user.id)) {
        res.status(404).json({ error: "Диалог не найден." });
        return;
    }

    res.json({
        conversation: buildConversationPayload(conversation, req.user.id)
    });
});

app.post("/api/conversations/start", requireAuth, (req, res) => {
    const targetPublicId = normalizePublicId(req.body?.publicId);

    if (!targetPublicId) {
        res.status(400).json({ error: "Введите ID пользователя." });
        return;
    }

    const targetUser = findUserByPublicId(targetPublicId);

    if (!targetUser) {
        res.status(404).json({ error: "Пользователь с таким ID не найден." });
        return;
    }

    if (targetUser.id === req.user.id) {
        res.status(400).json({ error: "Нельзя начать переписку с самим собой." });
        return;
    }

    let conversation = findConversationBetween(req.user.id, targetUser.id);
    let created = false;

    if (!conversation) {
        conversation = createConversation(req.user.id, targetUser.id);
        created = true;
    }

    saveStore();
    emitDataChanged(conversation.id, conversation.memberIds);

    res.json({
        created,
        conversation: buildConversationPayload(conversation, req.user.id),
        conversations: getConversationSummaries(req.user.id)
    });
});

app.post("/api/conversations/:conversationId/messages", requireAuth, (req, res) => {
    const conversation = findConversationById(req.params.conversationId);

    if (!conversation || !requireConversationMember(conversation, req.user.id)) {
        res.status(404).json({ error: "Диалог не найден." });
        return;
    }

    const text = normalizeMessageText(req.body?.text);

    if (!text) {
        res.status(400).json({ error: "Сообщение пустое." });
        return;
    }

    const message = createMessage(conversation, req.user.id, text);

    saveStore();
    emitDataChanged(conversation.id, conversation.memberIds);

    res.status(201).json({
        message: buildMessagePayload(message)
    });
});

app.put("/api/me", requireAuth, (req, res) => {
    const displayName = normalizeDisplayName(req.body?.displayName);

    if (!displayName) {
        res.status(400).json({ error: "Имя не может быть пустым." });
        return;
    }

    req.user.displayName = displayName;
    req.user.theme = normalizeTheme(req.body?.theme);
    req.user.lastSeenAt = now();

    addEvent("profile.updated", {
        userId: req.user.id,
        theme: req.user.theme
    });

    saveStore();
    emitProfileChanged(req.user.id);

    res.json({
        user: sanitizeUser(req.user),
        logs: getRecentEventsForUser(req.user.id)
    });
});

app.get("/api/logs", requireAuth, (req, res) => {
    res.json({
        logs: getRecentEventsForUser(req.user.id)
    });
});

io.use((socket, next) => {
    const token = socket.handshake.auth?.token;

    if (!token) {
        next(new Error("unauthorized"));
        return;
    }

    const session = findSessionByToken(token);
    const user = session ? findUserById(session.userId) : null;

    if (!session || !user) {
        next(new Error("unauthorized"));
        return;
    }

    touchAuth(user, session, getClientIp(socket.handshake));
    saveStore();

    socket.user = user;
    next();
});

io.on("connection", (socket) => {
    socket.join(getUserRoom(socket.user.id));
    console.log(`socket connected for ${socket.user.publicId}`);

    socket.on("disconnect", () => {
        console.log(`socket disconnected for ${socket.user.publicId}`);
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log(`VoidChat server started on port ${PORT}`);
});
