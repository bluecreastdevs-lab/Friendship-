import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  const PORT = 3000;

  // In-memory store for rooms
  // roomId -> {
  //   mediaState: { isPlaying: boolean, currentTime: number, mediaUrl: string, mediaType: 'video' | 'audio', lastUpdated: number },
  //   participants: Map<socketId, { socketId: string, name: string, avatarColor: string, isMuted: boolean }>,
  //   messages: Array<{ id: string, sender: string, text: string, time: string, avatarColor: string }>
  // }
  const rooms = new Map();

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    socket.on("join-room", ({ roomId, name, avatarColor }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        rooms.set(roomId, {
          mediaState: {
            isPlaying: false,
            currentTime: 0,
            mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            mediaType: "video",
            lastUpdated: Date.now()
          },
          participants: new Map(),
          messages: []
        });
      }

      const room = rooms.get(roomId);
      room.participants.set(socket.id, {
        socketId: socket.id,
        name: name || `User_${socket.id.slice(0, 4)}`,
        avatarColor: avatarColor || "#6366f1",
        isMuted: false
      });

      // Send current room state to joining user
      socket.emit("room-state", {
        mediaState: room.mediaState,
        participants: Array.from(room.participants.values()),
        messages: room.messages
      });

      // Broadcast updated participants list to room
      io.to(roomId).emit("participants-update", Array.from(room.participants.values()));

      // System chat message
      const joinMsg = {
        id: Math.random().toString(36).substring(2, 9),
        sender: "System",
        text: `${name || "A user"} joined the lounge.`,
        time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatarColor: "#9ca3af"
      };
      room.messages.push(joinMsg);
      io.to(roomId).emit("chat-message", joinMsg);
    });

    // Media sync events
    socket.on("media-sync", ({ roomId, state }) => {
      const room = rooms.get(roomId);
      if (room) {
        room.mediaState = {
          ...room.mediaState,
          ...state,
          lastUpdated: Date.now()
        };
        // Broadcast to other users in the room
        socket.to(roomId).emit("media-sync", room.mediaState);
      }
    });

    // Chat messages
    socket.on("chat-message", ({ roomId, message }) => {
      const room = rooms.get(roomId);
      if (room) {
        const fullMsg = {
          id: Math.random().toString(36).substring(2, 9),
          ...message,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        room.messages.push(fullMsg);
        if (room.messages.length > 100) room.messages.shift();
        io.to(roomId).emit("chat-message", fullMsg);
      }
    });

    // Mic status toggle
    socket.on("toggle-mic", ({ roomId, isMuted }) => {
      const room = rooms.get(roomId);
      if (room && room.participants.has(socket.id)) {
        room.participants.get(socket.id).isMuted = isMuted;
        io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
      }
    });

    // WebRTC Signaling
    socket.on("webrtc-offer", ({ roomId, offer, targetSocketId }) => {
      io.to(targetSocketId).emit("webrtc-offer", { offer, senderSocketId: socket.id });
    });

    socket.on("webrtc-answer", ({ roomId, answer, targetSocketId }) => {
      io.to(targetSocketId).emit("webrtc-answer", { answer, senderSocketId: socket.id });
    });

    socket.on("webrtc-ice", ({ roomId, candidate, targetSocketId }) => {
      io.to(targetSocketId).emit("webrtc-ice", { candidate, senderSocketId: socket.id });
    });

    socket.on("disconnect", () => {
      console.log(`User disconnected: ${socket.id}`);
      rooms.forEach((room, roomId) => {
        if (room.participants.has(socket.id)) {
          const participant = room.participants.get(socket.id);
          room.participants.delete(socket.id);

          if (room.participants.size === 0) {
            rooms.delete(roomId);
          } else {
            io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
            const leaveMsg = {
              id: Math.random().toString(36).substring(2, 9),
              sender: "System",
              text: `${participant.name} left the lounge.`,
              time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              avatarColor: "#9ca3af"
            };
            room.messages.push(leaveMsg);
            io.to(roomId).emit("chat-message", leaveMsg);
          }
        }
      });
    });
  });

  // API health check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRooms: rooms.size });
  });

  // Vite middleware for development or static serving for production
  const distPath = path.join(process.cwd(), 'dist');
  const hasDist = fs.existsSync(path.join(distPath, 'index.html'));

  if (process.env.NODE_ENV !== "production" || !hasDist) {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`SyncSpace server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
