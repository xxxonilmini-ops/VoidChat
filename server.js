const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static("public"));

io.on("connection", (socket) => {
    console.log("Пользователь подключился");

    socket.on("chat message", (msg) => {
        io.emit("chat message", msg);
    });

    socket.on("disconnect", () => {
        console.log("Пользователь вышел");
    });
});

const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Сервер запущен");
});