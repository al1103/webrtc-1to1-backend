import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";

const app = express();
app.use(cors());

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
  pingInterval: 25000,
  pingTimeout: 60000,
});

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || "";

async function sendTelegramNotification(message) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`;
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: TELEGRAM_CHAT_ID,
        text: message,
      }),
    });
  } catch (error) {
    console.error("Lỗi gửi thông báo Telegram:", error);
  }
}

const rooms = new Map();

io.on("connection", (socket) => {
  socket.on("join-room", ({ roomId, role }) => {
    if (!roomId || !role) {
      socket.emit("error-message", "Thiếu roomId hoặc role.");
      return;
    }

    let room = rooms.get(roomId);
    if (!room) {
      room = { broadcaster: null, viewer: null, deleteTimeout: null };
    } else if (room.deleteTimeout) {
      clearTimeout(room.deleteTimeout);
      room.deleteTimeout = null;
    }

    if (role === "broadcaster") {
      room.broadcaster = socket.id;
    }

    if (role === "viewer") {
      room.viewer = socket.id;
    }

    rooms.set(roomId, room);
    socket.join(roomId);
    socket.data.roomId = roomId;
    socket.data.role = role;

    console.log(`[${roomId}] ${role}: ${socket.id}`);
    sendTelegramNotification(`🔔 Có người dùng tham gia!\n- Vai trò: ${role}\n- Phòng: ${roomId}\n- ID: ${socket.id}`);

    if (role === "viewer" && room.broadcaster) {
      io.to(room.broadcaster).emit("viewer-joined");
    }

    if (role === "broadcaster" && room.viewer) {
      io.to(room.viewer).emit("broadcaster-joined");
      socket.emit("viewer-joined");
    }
  });

  socket.on("offer", ({ roomId, offer }) => {
    socket.to(roomId).emit("offer", offer);
  });

  socket.on("answer", ({ roomId, answer }) => {
    socket.to(roomId).emit("answer", answer);
  });

  socket.on("ice-candidate", ({ roomId, candidate }) => {
    socket.to(roomId).emit("ice-candidate", candidate);
  });

  socket.on("disconnect", () => {
    const { roomId, role } = socket.data;
    if (!roomId) {
      return;
    }

    const room = rooms.get(roomId);
    if (!room) {
      return;
    }

    if (role === "broadcaster" && room.broadcaster === socket.id) {
      room.broadcaster = null;
      io.to(roomId).emit("broadcaster-left");
    }

    if (role === "viewer" && room.viewer === socket.id) {
      room.viewer = null;
      io.to(roomId).emit("viewer-left");
    }

    if (!room.broadcaster && !room.viewer) {
      room.deleteTimeout = setTimeout(() => {
        const currentRoom = rooms.get(roomId);
        if (currentRoom && !currentRoom.broadcaster && !currentRoom.viewer) {
          rooms.delete(roomId);
        }
      }, 30000);
    }

    console.log(`Disconnected: ${socket.id}`);
  });
});

app.get("/", (_, res) => {
  res.json({
    status: "ok",
    service: "WebRTC 1-to-1 signaling server",
  });
});

const PORT = process.env.PORT || 3000;
httpServer.listen(PORT, () => {
  console.log(`Signaling server running: http://localhost:${PORT}`);
});
