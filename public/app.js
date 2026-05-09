const socket = io();

const input = document.getElementById("input");
const messages = document.getElementById("messages");

function sendMessage() {

    if(input.value.trim() === "") return;

    socket.emit("chat message", input.value);

    input.value = "";
}

socket.on("chat message", (msg) => {

    const div = document.createElement("div");

    div.classList.add("message");

    div.textContent = msg;

    messages.appendChild(div);

    messages.scrollTop = messages.scrollHeight;
});