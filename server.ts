import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import multer from "multer";
import { createServer as createViteServer } from "vite";

async function startServer() {
  const app = express();
  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    },
    maxHttpBufferSize: 1e8 // 100MB buffer limit
  });

  const PORT = 3000;

  // Setup uploads directory for synchronized movies, audio, and images
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => {
      const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
      const safeName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
      cb(null, `${uniqueSuffix}-${safeName}`);
    }
  });

  const upload = multer({
    storage,
    limits: { fileSize: 300 * 1024 * 1024 } // 300MB
  });

  // Serve uploaded media files with full byte-range streaming support and CORS
  app.use("/uploads", (req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Range, Content-Type");
    res.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    next();
  }, express.static(uploadsDir, {
    acceptRanges: true,
    cacheControl: true,
    maxAge: '1d'
  }));

  // In-memory store for rooms
  // roomId -> {
  //   movieState: { mediaUrl, mediaType: 'video', isPlaying, currentTime, serverTimestamp, mediaTitle, uploadedBy },
  //   imageState: { activeImageUrl, activeImageTitle, uploadedBy, imageZoom, gallery: [], serverTimestamp },
  //   roomState: (mirrored),
  //   mediaState: (mirrored),
  //   participants: Map<socketId, { socketId, name, avatarColor, isMuted }>,
  //   messages: Array<{ id, sender, text, time, avatarColor }>
  // }
  const rooms = new Map();

  function getSyncedMovieState(room: any) {
    const movie = { ...room.movieState };
    if (movie.isPlaying) {
      const elapsed = Math.max(0, (Date.now() - movie.serverTimestamp) / 1000);
      movie.currentTime = movie.currentTime + elapsed;
    }
    movie.serverTimestamp = Date.now();
    return movie;
  }

  function getSyncedRoomState(room: any) {
    const state = { ...room.roomState };
    if (state.isPlaying && state.mediaType !== "image") {
      const elapsed = Math.max(0, (Date.now() - state.serverTimestamp) / 1000);
      state.currentTime = state.currentTime + elapsed;
    } else if (state.mediaType === "image") {
      state.isPlaying = false;
      state.currentTime = 0;
    }
    state.serverTimestamp = Date.now();
    return state;
  }

  io.on("connection", (socket) => {
    console.log(`User connected: ${socket.id}`);

    // Join room handler (supports both 'join_room' and 'join-room')
    const handleJoin = ({ roomId, name, avatarColor }: { roomId: string; name?: string; avatarColor?: string }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        const initialTimestamp = Date.now();
        const initialMovieState = {
          mediaUrl: "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
          mediaType: "video" as const,
          isPlaying: false,
          currentTime: 0,
          serverTimestamp: initialTimestamp,
          mediaTitle: "Big Buck Bunny (Animated Movie)",
          uploadedBy: "System"
        };

        const initialImageState = {
          activeImageUrl: "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80",
          activeImageTitle: "Deep Cosmic Nebula (Space 4K)",
          uploadedBy: "System",
          imageZoom: 1,
          gallery: [
            {
              id: 'img-nebula',
              url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80',
              title: 'Deep Cosmic Nebula (Space 4K)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'img-cyberpunk',
              url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1600&auto=format&fit=crop&q=80',
              title: 'Cyberpunk Metropolis Night',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'img-aurora',
              url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&auto=format&fit=crop&q=80',
              title: 'Aurora Borealis Glaciers',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'img-lake',
              url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&auto=format&fit=crop&q=80',
              title: 'Alpine Emerald Lake Sunset',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            }
          ],
          serverTimestamp: initialTimestamp
        };

        rooms.set(roomId, {
          movieState: initialMovieState,
          imageState: initialImageState,
          roomState: initialMovieState,
          mediaState: {
            ...initialMovieState,
            lastUpdated: initialTimestamp
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

      const syncedMovie = getSyncedMovieState(room);
      const syncedRoomState = getSyncedRoomState(room);

      // Send full synchronized room state immediately upon join
      const statePayload = {
        roomId,
        movieState: syncedMovie,
        imageState: room.imageState,
        roomState: syncedRoomState,
        mediaState: {
          ...syncedMovie,
          lastUpdated: syncedMovie.serverTimestamp
        },
        participants: Array.from(room.participants.values()),
        messages: room.messages
      };

      socket.emit("room_state", statePayload);
      socket.emit("room-state", statePayload);

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
    };

    socket.on("join_room", handleJoin);
    socket.on("join-room", handleJoin);

    // Dedicated movie_action handler (play, pause, seek, change_movie, heartbeat)
    socket.on("movie_action", (action: {
      roomId: string;
      type: 'play' | 'pause' | 'seek' | 'change_movie' | 'heartbeat';
      currentTime: number;
      isPlaying?: boolean;
      mediaUrl?: string;
      mediaTitle?: string;
      duration?: number;
      uploadedBy?: string;
    }) => {
      const { roomId, type, currentTime, mediaUrl, mediaTitle, uploadedBy } = action;
      const room = rooms.get(roomId);
      if (!room) return;

      const serverTimestamp = Date.now();
      const isPlaying = type === "play" ? true : type === "pause" ? false : (action.isPlaying ?? room.movieState.isPlaying);

      room.movieState = {
        ...room.movieState,
        mediaUrl: mediaUrl || room.movieState.mediaUrl,
        isPlaying,
        currentTime: typeof currentTime === "number" ? currentTime : room.movieState.currentTime,
        serverTimestamp,
        mediaTitle: mediaTitle || room.movieState.mediaTitle,
        uploadedBy: uploadedBy || room.movieState.uploadedBy
      };

      // Mirror to legacy roomState / mediaState
      room.roomState = { ...room.movieState };
      room.mediaState = { ...room.movieState, lastUpdated: serverTimestamp };

      const broadcastPayload = {
        ...action,
        mediaUrl: room.movieState.mediaUrl,
        mediaType: 'video' as const,
        isPlaying,
        currentTime: room.movieState.currentTime,
        serverTimestamp,
        mediaTitle: room.movieState.mediaTitle,
        uploadedBy: room.movieState.uploadedBy,
        senderId: socket.id
      };

      socket.to(roomId).emit("movie_action", broadcastPayload);
      socket.to(roomId).emit("media_action", broadcastPayload);
    });

    // Dedicated image_action handler (select_image, zoom, add_image)
    socket.on("image_action", (action: {
      roomId: string;
      type: 'select_image' | 'zoom' | 'add_image';
      activeImageUrl?: string;
      activeImageTitle?: string;
      imageZoom?: number;
      galleryItem?: {
        id: string;
        url: string;
        title: string;
        uploadedBy?: string;
        thumbnail?: string;
      };
      uploadedBy?: string;
    }) => {
      const { roomId, type, activeImageUrl, activeImageTitle, imageZoom, galleryItem, uploadedBy } = action;
      const room = rooms.get(roomId);
      if (!room) return;

      const serverTimestamp = Date.now();

      if (type === 'add_image' && galleryItem) {
        // Prevent duplicate images in gallery
        const existingIdx = room.imageState.gallery.findIndex((img: any) => img.url === galleryItem.url);
        const newItem = {
          id: galleryItem.id || `img-${Date.now()}`,
          url: galleryItem.url,
          title: galleryItem.title || 'Shared Image',
          uploadedBy: galleryItem.uploadedBy || uploadedBy || 'Guest',
          thumbnail: galleryItem.thumbnail || galleryItem.url,
          timestamp: serverTimestamp
        };
        if (existingIdx >= 0) {
          room.imageState.gallery[existingIdx] = newItem;
        } else {
          room.imageState.gallery.unshift(newItem);
        }
        room.imageState.activeImageUrl = newItem.url;
        room.imageState.activeImageTitle = newItem.title;
        room.imageState.uploadedBy = newItem.uploadedBy;
        room.imageState.imageZoom = 1;
      } else if (type === 'select_image') {
        if (activeImageUrl) {
          room.imageState.activeImageUrl = activeImageUrl;
          room.imageState.activeImageTitle = activeImageTitle || room.imageState.activeImageTitle;
          room.imageState.uploadedBy = uploadedBy || room.imageState.uploadedBy;
          room.imageState.imageZoom = 1;
        }
      } else if (type === 'zoom') {
        if (typeof imageZoom === 'number') {
          room.imageState.imageZoom = imageZoom;
        }
      }

      room.imageState.serverTimestamp = serverTimestamp;

      const broadcastPayload = {
        roomId,
        type,
        activeImageUrl: room.imageState.activeImageUrl,
        activeImageTitle: room.imageState.activeImageTitle,
        uploadedBy: room.imageState.uploadedBy,
        imageZoom: room.imageState.imageZoom,
        gallery: room.imageState.gallery,
        serverTimestamp,
        senderId: socket.id
      };

      socket.to(roomId).emit("image_action", broadcastPayload);
    });

    // Standardized media_action handler (play, pause, seek, change_media, heartbeat, image_view)
    socket.on("media_action", (action: {
      roomId: string;
      mediaUrl: string;
      mediaType: 'video' | 'image' | 'audio';
      type: 'play' | 'pause' | 'seek' | 'change_media' | 'heartbeat' | 'image_view';
      currentTime: number;
      isPlaying?: boolean;
      serverTimestamp?: number;
      mediaTitle?: string;
      uploadedBy?: string;
      imageZoom?: number;
    }) => {
      const { roomId, type, mediaUrl, mediaType, currentTime, mediaTitle, uploadedBy, imageZoom } = action;
      const room = rooms.get(roomId);
      if (!room) return;

      const serverTimestamp = Date.now();
      const resolvedMediaType = mediaType || room.roomState.mediaType;
      const isImage = resolvedMediaType === "image" || type === 'image_view';

      if (isImage) {
        if (typeof imageZoom === 'number') {
          room.imageState.imageZoom = imageZoom;
        }
        if (mediaUrl) {
          room.imageState.activeImageUrl = mediaUrl;
          room.imageState.activeImageTitle = mediaTitle || room.imageState.activeImageTitle;
          room.imageState.uploadedBy = uploadedBy || room.imageState.uploadedBy;
        }
        room.imageState.serverTimestamp = serverTimestamp;

        const broadcastPayload = {
          roomId,
          type: type === 'image_view' ? 'zoom' as const : 'select_image' as const,
          activeImageUrl: room.imageState.activeImageUrl,
          activeImageTitle: room.imageState.activeImageTitle,
          imageZoom: room.imageState.imageZoom,
          gallery: room.imageState.gallery,
          serverTimestamp,
          senderId: socket.id
        };
        socket.to(roomId).emit("image_action", broadcastPayload);
        socket.to(roomId).emit("media_action", {
          ...action,
          ...broadcastPayload,
          mediaType: 'image',
          currentTime: 0,
          isPlaying: false
        });
        return;
      }

      // Video handling
      const isPlaying = type === "play"
        ? true
        : type === "pause"
        ? false
        : (action.isPlaying ?? room.movieState.isPlaying);

      room.movieState = {
        mediaUrl: mediaUrl || room.movieState.mediaUrl,
        mediaType: 'video',
        isPlaying,
        currentTime: typeof currentTime === "number" ? currentTime : room.movieState.currentTime,
        serverTimestamp,
        mediaTitle: mediaTitle || room.movieState.mediaTitle,
        uploadedBy: uploadedBy || room.movieState.uploadedBy
      };

      room.roomState = { ...room.movieState };
      room.mediaState = { ...room.movieState, lastUpdated: serverTimestamp };

      const broadcastPayload = {
        ...action,
        mediaUrl: room.movieState.mediaUrl,
        mediaType: 'video' as const,
        isPlaying,
        currentTime: room.movieState.currentTime,
        serverTimestamp,
        mediaTitle: room.movieState.mediaTitle,
        uploadedBy: room.movieState.uploadedBy,
        senderId: socket.id
      };

      socket.to(roomId).emit("movie_action", broadcastPayload);
      socket.to(roomId).emit("media_action", broadcastPayload);
      socket.to(roomId).emit("media-sync", room.mediaState);
    });

    // Legacy media-sync event support
    socket.on("media-sync", ({ roomId, state }: { roomId: string; state: any }) => {
      const room = rooms.get(roomId);
      if (room) {
        const serverTimestamp = Date.now();
        const isImage = (state.mediaType || room.roomState.mediaType) === "image";
        const isPlaying = isImage ? false : !!state.isPlaying;

        room.movieState = {
          ...room.movieState,
          ...state,
          isPlaying,
          serverTimestamp
        };
        room.roomState = { ...room.movieState };
        room.mediaState = { ...room.movieState, lastUpdated: serverTimestamp };

        socket.to(roomId).emit("movie_action", {
          roomId,
          type: isPlaying ? 'play' : 'pause',
          currentTime: room.movieState.currentTime,
          isPlaying,
          mediaUrl: room.movieState.mediaUrl,
          mediaTitle: room.movieState.mediaTitle,
          serverTimestamp,
          senderId: socket.id
        });
        socket.to(roomId).emit("media-sync", room.mediaState);
      }
    });

    // Explicit request to resynchronize with room playback
    socket.on("request-sync", ({ roomId }: { roomId: string }) => {
      const room = rooms.get(roomId);
      if (room) {
        const syncedMovie = getSyncedMovieState(room);
        const syncedState = getSyncedRoomState(room);

        socket.emit("movie_action", {
          roomId,
          type: syncedMovie.isPlaying ? 'play' : 'seek',
          currentTime: syncedMovie.currentTime,
          isPlaying: syncedMovie.isPlaying,
          mediaUrl: syncedMovie.mediaUrl,
          mediaTitle: syncedMovie.mediaTitle,
          uploadedBy: syncedMovie.uploadedBy,
          serverTimestamp: syncedMovie.serverTimestamp
        });

        socket.emit("image_action", {
          roomId,
          type: 'select_image',
          activeImageUrl: room.imageState.activeImageUrl,
          activeImageTitle: room.imageState.activeImageTitle,
          imageZoom: room.imageState.imageZoom,
          gallery: room.imageState.gallery,
          uploadedBy: room.imageState.uploadedBy,
          serverTimestamp: room.imageState.serverTimestamp
        });

        socket.emit("room-state", {
          roomId,
          movieState: syncedMovie,
          imageState: room.imageState,
          roomState: syncedState,
          mediaState: {
            ...syncedMovie,
            lastUpdated: syncedMovie.serverTimestamp
          },
          participants: Array.from(room.participants.values()),
          messages: room.messages
        });
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

  // Media upload endpoint (movies, audio, photos)
  app.post("/api/upload", upload.single("file"), (req: any, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided" });
    }

    const mime = req.file.mimetype || "";
    let mediaType: "video" | "audio" | "image" = "video";
    if (mime.startsWith("image/")) {
      mediaType = "image";
    } else if (mime.startsWith("audio/")) {
      mediaType = "audio";
    }

    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({
      url: fileUrl,
      mediaType,
      mediaTitle: req.file.originalname,
      size: req.file.size
    });
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
