const STORAGE_KEY = "voidchat_token";

const state = {
    token: localStorage.getItem(STORAGE_KEY) || "",
    user: null,
    recoveryMode: "new",
    conversations: [],
    activeConversationId: "",
    activeConversation: null,
    searchResults: [],
    logs: [],
    socket: null
};

const profileName = document.getElementById("profileName");
const profileId = document.getElementById("profileId");
const profileIp = document.getElementById("profileIp");
const profileOnline = document.getElementById("profileOnline");
const copyIdButton = document.getElementById("copyIdButton");
const sessionHint = document.getElementById("sessionHint");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchStatus = document.getElementById("searchStatus");
const searchResults = document.getElementById("searchResults");
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

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;");
}

function setTheme(theme) {
    const normalized = theme === "light" ? "light" : "dark";
    document.body.classList.toggle("theme-light", normalized === "light");
    document.body.classList.toggle("theme-dark", normalized !== "light");
}

function formatTime(value) {
    if (!value) {
        return "-";
    }

    return new Date(value).toLocaleString("ru-RU", {
        day: "2-digit",
        month: "2-digit",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function formatPresence(user) {
    if (!user) {
        return "-";
    }

    if (user.isOnline) {
        return "в сети";
    }

    if (!user.lastSeenAt) {
        return "не в сети";
    }

    return `был(а) ${formatTime(user.lastSeenAt)}`;
}

function getRecoveryMessage(mode) {
    if (mode === "token") {
        return "Сессия восстановлена.";
    }

    if (mode === "ip") {
        return "Вход выполнен по IP.";
    }

    return "Новый аккаунт создан.";
}

function renderProfile() {
    if (!state.user) {
        return;
    }

    profileName.textContent = state.user.displayName;
    profileId.textContent = state.user.publicId;
    profileIp.textContent = state.user.lastIp || "unknown";
    profileOnline.textContent = formatPresence(state.user);
    sessionHint.textContent = getRecoveryMessage(state.recoveryMode);

    displayNameInput.value = state.user.displayName;
    themeSelect.value = state.user.theme;
    setTheme(state.user.theme);
}

function renderSearchResults() {
    searchResults.innerHTML = "";

    if (!state.searchResults.length) {
        return;
    }

    state.searchResults.forEach((user) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "search-result-item";
        button.dataset.publicId = user.publicId;
        button.innerHTML = `
            <div class="search-result-top">
                <strong>${escapeHtml(user.displayName)}</strong>
                <span>${escapeHtml(user.publicId)}</span>
            </div>
            <small>${escapeHtml(formatPresence(user))}</small>
        `;

        button.addEventListener("click", () => {
            startConversation(user.publicId).catch((error) => {
                searchStatus.textContent = error.message;
            });
        });

        searchResults.appendChild(button);
    });
}

function renderConversationList() {
    conversationList.innerHTML = "";

    if (!state.conversations.length) {
        const empty = document.createElement("p");
        empty.className = "helper-text";
        empty.textContent = "Пока нет чатов.";
        conversationList.appendChild(empty);
        return;
    }

    state.conversations.forEach((conversation) => {
        const button = document.createElement("button");
        const isActive = conversation.id === state.activeConversationId;
        const unreadBadge = conversation.unreadCount > 0 ? `<span class="unread-badge">${conversation.unreadCount}</span>` : "";

        button.type = "button";
        button.className = `conversation-item${isActive ? " active" : ""}`;
        button.dataset.conversationId = conversation.id;
        button.innerHTML = `
            <div class="conversation-head">
                <strong>${escapeHtml(conversation.otherUser?.displayName || "Неизвестно")}</strong>
                ${unreadBadge}
            </div>
            <span>${escapeHtml(conversation.otherUser?.publicId || "-")}</span>
            <span class="conversation-status">${escapeHtml(formatPresence(conversation.otherUser))}</span>
            <small>${escapeHtml(conversation.lastMessagePreview || "Сообщений пока нет.")}</small>
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
    chatTitle.textContent = conversation.otherUser?.displayName || "Чат";
    chatSubtitle.textContent = `${conversation.otherUser?.publicId || "-"} • ${formatPresence(conversation.otherUser)}`;
    messageList.innerHTML = "";

    if (!conversation.messages.length) {
        const emptyMessage = document.createElement("div");
        emptyMessage.className = "message-hint";
        emptyMessage.textContent = "Сообщений пока нет.";
        messageList.appendChild(emptyMessage);
    } else {
        conversation.messages.forEach((message) => {
            const item = document.createElement("article");
            const isOwn = message.senderId === state.user.id;
            const edited = message.editedAt && !message.isDeleted ? '<span class="edited-mark">изменено</span>' : "";
            const actions = isOwn && !message.isDeleted
                ? `
                    <div class="message-actions">
                        <button type="button" data-action="edit" data-message-id="${message.id}">Изменить</button>
                        <button type="button" data-action="delete" data-message-id="${message.id}">Удалить</button>
                    </div>
                `
                : "";
            const text = message.isDeleted
                ? '<p class="deleted-text">Сообщение удалено</p>'
                : `<p>${escapeHtml(message.text)}</p>`;

            item.className = `message-bubble${isOwn ? " own" : ""}${message.isDeleted ? " deleted" : ""}`;
            item.innerHTML = `
                <div class="message-meta">
                    <strong>${escapeHtml(isOwn ? "Ты" : message.senderName)}</strong>
                    <span>${formatTime(message.createdAt)}</span>
                </div>
                ${text}
                <div class="message-bottom">
                    ${edited}
                    ${actions}
                </div>
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
        empty.textContent = "Записей пока нет.";
        activityLog.appendChild(empty);
        return;
    }

    state.logs.forEach((entry) => {
        const row = document.createElement("div");
        row.className = "log-item";
        row.innerHTML = `
            <strong>${escapeHtml(describeLogEntry(entry))}</strong>
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
        return "Новый вход";
    }

    if (entry.type === "session.restored_by_ip") {
        return "Вход по IP";
    }

    if (entry.type === "conversation.created") {
        return "Создан чат";
    }

    if (entry.type === "message.saved") {
        return "Отправлено сообщение";
    }

    if (entry.type === "message.edited") {
        return "Сообщение изменено";
    }

    if (entry.type === "message.deleted") {
        return "Сообщение удалено";
    }

    if (entry.type === "profile.updated") {
        return "Обновлен профиль";
    }

    return entry.type;
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

    connectSocket();

    if (state.conversations.length) {
        await openConversation(state.conversations[0].id, false);
    }
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

    if (payload.conversations) {
        state.conversations = payload.conversations;
    }

    renderConversationList();
    renderMessages();

    if (focusComposer) {
        messageInput.focus();
    }
}

async function startConversation(publicId) {
    const payload = await apiRequest("/api/conversations/start", {
        method: "POST",
        body: JSON.stringify({
            publicId
        })
    });

    state.conversations = payload.conversations;
    state.searchResults = [];
    searchResults.innerHTML = "";
    searchInput.value = "";
    searchStatus.textContent = payload.created ? "Чат создан." : "Чат открыт.";
    renderConversationList();
    await openConversation(payload.conversation.id);
    await refreshLogs();
}

async function runSearch() {
    const query = searchInput.value.trim();

    if (!query) {
        state.searchResults = [];
        renderSearchResults();
        searchStatus.textContent = "Введи ID или имя.";
        return;
    }

    searchStatus.textContent = "Поиск...";

    const payload = await apiRequest(`/api/users/search?q=${encodeURIComponent(query)}`);
    state.searchResults = payload.users;
    renderSearchResults();

    const exactById = payload.users.find((user) => user.publicId.toUpperCase() === query.toUpperCase());

    if (exactById) {
        await startConversation(exactById.publicId);
        return;
    }

    if (!payload.users.length) {
        searchStatus.textContent = "Ничего не найдено.";
        return;
    }

    searchStatus.textContent = "Выбери пользователя из списка.";
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

    state.socket.on("connect", () => {
        if (state.user) {
            state.user.isOnline = true;
            renderProfile();
        }
    });

    state.socket.on("disconnect", () => {
        if (state.user) {
            state.user.isOnline = false;
            renderProfile();
        }
    });

    state.socket.on("data:changed", async () => {
        try {
            await Promise.all([refreshConversations(), refreshLogs()]);

            if (state.activeConversationId) {
                await openConversation(state.activeConversationId, false);
            }
        } catch (error) {
            console.error(error);
        }
    });
}

searchForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    try {
        await runSearch();
    } catch (error) {
        searchStatus.textContent = error.message;
    }
});

copyIdButton.addEventListener("click", async () => {
    if (!state.user) {
        return;
    }

    const originalText = copyIdButton.textContent;

    try {
        await navigator.clipboard.writeText(state.user.publicId);
        copyIdButton.textContent = "Скопировано";
    } catch (error) {
        copyIdButton.textContent = "Ошибка";
    }

    setTimeout(() => {
        copyIdButton.textContent = originalText;
    }, 1500);
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

messageList.addEventListener("click", async (event) => {
    const button = event.target.closest("[data-action]");

    if (!button) {
        return;
    }

    const action = button.dataset.action;
    const messageId = button.dataset.messageId;

    if (!messageId) {
        return;
    }

    try {
        if (action === "edit") {
            const currentMessage = state.activeConversation?.messages.find((message) => message.id === messageId);
            const nextText = window.prompt("Измени сообщение:", currentMessage?.text || "");

            if (nextText === null) {
                return;
            }

            await apiRequest(`/api/messages/${messageId}`, {
                method: "PUT",
                body: JSON.stringify({ text: nextText })
            });
        }

        if (action === "delete") {
            const confirmed = window.confirm("Удалить сообщение?");

            if (!confirmed) {
                return;
            }

            await apiRequest(`/api/messages/${messageId}`, {
                method: "DELETE"
            });
        }

        await Promise.all([refreshConversations(), refreshLogs(), openConversation(state.activeConversationId, false)]);
    } catch (error) {
        alert(error.message);
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
    settingsStatus.textContent = "Сохранение...";

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
        settingsStatus.textContent = "Сохранено.";
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
    sessionHint.textContent = "Ошибка подключения.";
});
