const STORAGE_KEY = "voidchat_token";

const state = {
    token: localStorage.getItem(STORAGE_KEY) || "",
    user: null,
    recoveryMode: "new",
    conversations: [],
    activeConversationId: "",
    activeConversation: null,
    logs: [],
    socket: null
};

const profileName = document.getElementById("profileName");
const profileId = document.getElementById("profileId");
const profileIp = document.getElementById("profileIp");
const sessionHint = document.getElementById("sessionHint");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchStatus = document.getElementById("searchStatus");
const conversationList = document.getElementById("conversationList");
const chatEmpty = document.getElementById("chatEmpty");
const chatSection = document.getElementById("chatSection");
const chatTitle = document.getElementById("chatTitle");
const chatSubtitle = document.getElementById("chatSubtitle");
const messageList = document.getElementById("messageList");
const messageForm = document.getElementById("messageForm");
const messageInput = document.getElementById("messageInput");
const settingsButton = document.getElementById("settingsButton");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const settingsModal = document.getElementById("settingsModal");
const settingsForm = document.getElementById("settingsForm");
const displayNameInput = document.getElementById("displayNameInput");
const themeSelect = document.getElementById("themeSelect");
const settingsStatus = document.getElementById("settingsStatus");
const activityLog = document.getElementById("activityLog");

async function apiRequest(url, options = {}) {
    const headers = new Headers(options.headers || {});

    if (!headers.has("Content-Type") && options.body) {
        headers.set("Content-Type", "application/json");
    }

    if (state.token) {
        headers.set("Authorization", `Bearer ${state.token}`);
    }

    const response = await fetch(url, {
        ...options,
        headers
    });

    const payload = await response.json().catch(() => ({}));

    if (!response.ok) {
        throw new Error(payload.error || "Ошибка запроса.");
    }

    return payload;
}

function setTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.body.classList.toggle("theme-light", normalized === "light");
    document.body.classList.toggle("theme-dark", normalized !== "light");
}

function formatTime(value) {
    return new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getRecoveryMessage(mode) {
    if (mode === "token") {
        return "Аккаунт восстановлен по сохраненной сессии.";
    }

    if (mode === "ip") {
        return "Аккаунт найден по IP и сессия восстановлена.";
    }

    return "Создан новый аккаунт. Сохрани свой ID для новых диалогов.";
}

function renderProfile() {
    if (!state.user) {
        return;
    }

    profileName.textContent = state.user.displayName;
    profileId.textContent = state.user.publicId;
    profileIp.textContent = state.user.lastIp || "unknown";
    sessionHint.textContent = getRecoveryMessage(state.recoveryMode);

    displayNameInput.value = state.user.displayName;
    themeSelect.value = state.user.theme;
    setTheme(state.user.theme);
}

function renderConversationList() {
    conversationList.innerHTML = "";

    if (!state.conversations.length) {
        const empty = document.createElement("p");
        empty.className = "helper-text";
        empty.textContent = "Пока нет диалогов. Введи ID пользователя выше.";
        conversationList.appendChild(empty);
        return;
    }

    state.conversations.forEach((conversation) => {
        const button = document.createElement("button");
        const isActive = conversation.id === state.activeConversationId;
        button.type = "button";
        button.className = `conversation-item${isActive ? " active" : ""}`;
        button.dataset.conversationId = conversation.id;
        button.innerHTML = `
            <strong>${escapeHtml(conversation.otherUser?.displayName || "Неизвестно")}</strong>
            <span>${escapeHtml(conversation.otherUser?.publicId || "-")}</span>
            <small>${escapeHtml(conversation.lastMessagePreview || "Диалог создан, сообщений пока нет.")}</small>
        `;

        button.addEventListener("click", () => openConversation(conversation.id));
        conversationList.appendChild(button);
    });
}

function renderMessages() {
    if (!state.activeConversation) {
        chatSection.hidden = true;
        chatEmpty.hidden = false;
        messageList.innerHTML = "";
        return;
    }

    const conversation = state.activeConversation;

    chatEmpty.hidden = true;
    chatSection.hidden = false;
    chatTitle.textContent = conversation.otherUser?.displayName || "Диалог";
    chatSubtitle.textContent = `${conversation.otherUser?.publicId || "-"} • История сохраняется`;
    messageList.innerHTML = "";

    if (!conversation.messages.length) {
        const emptyMessage = document.createElement("div");
        emptyMessage.className = "message-hint";
        emptyMessage.textContent = "Сообщений еще нет. Напиши первым.";
        messageList.appendChild(emptyMessage);
    } else {
        conversation.messages.forEach((message) => {
            const item = document.createElement("article");
            const isOwn = message.senderId === state.user.id;
            item.className = `message-bubble${isOwn ? " own" : ""}`;
            item.innerHTML = `
                <div class="message-meta">
                    <strong>${escapeHtml(isOwn ? "Ты" : message.senderName)}</strong>
                    <span>${formatTime(message.createdAt)}</span>
                </div>
                <p>${escapeHtml(message.text)}</p>
            `;
            messageList.appendChild(item);
        });
    }

    messageList.scrollTop = messageList.scrollHeight;
}

function renderLogs() {
    activityLog.innerHTML = "";

    if (!state.logs.length) {
        const empty = document.createElement("p");
        empty.className = "helper-text";
        empty.textContent = "Журнал пока пуст.";
        activityLog.appendChild(empty);
        return;
    }

    state.logs.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "log-item";
        row.innerHTML = `
            <strong>${describeLogEntry(entry)}</strong>
            <span>${formatTime(entry.createdAt)}</span>
        `;
        activityLog.appendChild(row);
    });
}

function describeLogEntry(entry) {
    if (entry.type === "user.created") {
        return "Создан аккаунт";
    }

    if (entry.type === "session.created") {
        return "Открыта новая сессия";
    }

    if (entry.type === "session.restored_by_ip") {
        return "Вход восстановлен по IP";
    }

    if (entry.type === "conversation.created") {
        return "Создан новый диалог";
    }

    if (entry.type === "message.saved") {
        return "Сообщение сохранено";
    }

    if (entry.type === "profile.updated") {
        return "Настройки профиля обновлены";
    }

    return entry.type;
}

function escapeHtml(value) {
    return value
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

async function bootstrap() {
    const payload = await apiRequest("/api/bootstrap");
    state.token = payload.token;
    state.user = payload.user;
    state.recoveryMode = payload.recoveryMode;
    state.conversations = payload.conversations;
    state.logs = payload.logs;

    localStorage.setItem(STORAGE_KEY, state.token);
    renderProfile();
    renderConversationList();
    renderLogs();

    if (state.conversations.length) {
        await openConversation(state.conversations[0].id, false);
    }

    connectSocket();
}

async function refreshConversations() {
    const payload = await apiRequest("/api/conversations");
    state.conversations = payload.conversations;
    renderConversationList();
}

async function refreshLogs() {
    const payload = await apiRequest("/api/logs");
    state.logs = payload.logs;
    renderLogs();
}

async function openConversation(conversationId, focusComposer = true) {
    const payload = await apiRequest(`/api/conversations/${conversationId}`);
    state.activeConversationId = conversationId;
    state.activeConversation = payload.conversation;
    renderConversationList();
    renderMessages();

    if (focusComposer) {
        messageInput.focus();
    }
}

function connectSocket() {
    if (state.socket) {
        state.socket.disconnect();
    }

    state.socket = io({
        auth: {
            token: state.token
        }
    });

    state.socket.on("data:changed", async (payload) => {
        try {
            await Promise.all([refreshConversations(), refreshLogs()]);

            if (payload.conversationId && payload.conversationId === state.activeConversationId) {
                await openConversation(payload.conversationId, false);
            }
        } catch (error) {
            console.error(error);
        }
    });
}

searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    searchStatus.textContent = "Ищу пользователя...";

    try {
        const payload = await apiRequest("/api/conversations/start", {
            method: "POST",
            body: JSON.stringify({
                publicId: searchInput.value
            })
        });

        state.conversations = payload.conversations;
        searchInput.value = "";
        searchStatus.textContent = payload.created ? "Диалог создан." : "Диалог открыт.";
        renderConversationList();
        await openConversation(payload.conversation.id);
        await refreshLogs();
    } catch (error) {
        searchStatus.textContent = error.message;
    }
});

messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!state.activeConversationId) {
        return;
    }

    const text = messageInput.value.trim();

    if (!text) {
        return;
    }

    try {
        await apiRequest(`/api/conversations/${state.activeConversationId}/messages`, {
            method: "POST",
            body: JSON.stringify({ text })
        });

        messageInput.value = "";
        await Promise.all([refreshConversations(), refreshLogs(), openConversation(state.activeConversationId, false)]);
    } catch (error) {
        alert(error.message);
    }
});

messageInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        messageForm.requestSubmit();
    }
});

settingsButton.addEventListener("click", () => {
    settingsModal.classList.remove("hidden");
});

closeSettingsButton.addEventListener("click", () => {
    settingsModal.classList.add("hidden");
});

settingsModal.addEventListener("click", (event) => {
    if (event.target === settingsModal) {
        settingsModal.classList.add("hidden");
    }
});

settingsForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    settingsStatus.textContent = "Сохраняю...";

    try {
        const payload = await apiRequest("/api/me", {
            method: "PUT",
            body: JSON.stringify({
                displayName: displayNameInput.value,
                theme: themeSelect.value
            })
        });

        state.user = payload.user;
        state.logs = payload.logs;
        settingsStatus.textContent = "Настройки сохранены.";
        renderProfile();
        renderLogs();
        await refreshConversations();

        if (state.activeConversationId) {
            await openConversation(state.activeConversationId, false);
        }
    } catch (error) {
        settingsStatus.textContent = error.message;
    }
});

bootstrap().catch((error) => {
    console.error(error);
    sessionHint.textContent = "Не удалось подключиться к серверу.";
});
