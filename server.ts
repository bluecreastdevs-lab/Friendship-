import express from "express";
import http from "http";
import { Server } from "socket.io";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
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

  // Global CORS and preflight handling for web, mobile, and iframe cross-origin requests
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Range, x-upload-id, x-chunk-index, x-total-chunks");
    res.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    if (req.method === "OPTIONS") {
      return res.sendStatus(204);
    }
    next();
  });

  // Enable JSON request body parsing
  app.use(express.json());

  // Setup uploads directory for synchronized movies, audio, and images
  const uploadsDir = path.join(process.cwd(), "uploads");
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }

  // Setup data directory for durable persistence of all room messages and media states
  const dataDir = path.join(process.cwd(), "data");
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  const DB_FILE = path.join(dataDir, "rooms_db.json");

  // Load persisted rooms from disk on startup
  function loadRoomsDb(): Map<string, any> {
    const map = new Map();
    if (fs.existsSync(DB_FILE)) {
      try {
        const raw = fs.readFileSync(DB_FILE, "utf-8");
        const parsed = JSON.parse(raw);
        for (const [roomId, roomData] of Object.entries(parsed as Record<string, any>)) {
          // Normalize messages to ensure accurate timestamps
          const normalizedMessages = Array.isArray(roomData.messages)
            ? roomData.messages.map((m: any) => ({
                ...m,
                timestamp: typeof m.timestamp === 'number' && m.timestamp > 0
                  ? m.timestamp
                  : (m.time && !isNaN(Date.parse(m.time)) ? Date.parse(m.time) : Date.now())
              }))
            : [];

          map.set(roomId, {
            ...roomData,
            messages: normalizedMessages,
            participants: new Map() // Ephemeral connected sockets
          });
        }
        console.log(`[Storage] Loaded ${map.size} persistent room(s) from ${DB_FILE}`);
      } catch (err) {
        console.error("[Storage] Error loading rooms_db.json:", err);
      }
    }
    return map;
  }

  const rooms: Map<string, any> = loadRoomsDb();

  // Helper to persist all rooms, messages, and states to disk
  function saveRoomsDb() {
    try {
      const serializable: Record<string, any> = {};
      rooms.forEach((room, roomId) => {
        serializable[roomId] = {
          movieState: room.movieState,
          imageState: room.imageState,
          roomState: room.roomState,
          mediaState: room.mediaState,
          messages: room.messages
        };
      });
      fs.writeFileSync(DB_FILE, JSON.stringify(serializable, null, 2), "utf-8");
    } catch (err) {
      console.error("[Storage] Error saving rooms_db.json:", err);
    }
  }

  const chunksDir = path.join(dataDir, "chunks");
  if (!fs.existsSync(chunksDir)) {
    fs.mkdirSync(chunksDir, { recursive: true });
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
    limits: { fileSize: 4 * 1024 * 1024 * 1024 } // 4GB for long movies (2:30+ hours)
  });

  const chunkStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, chunksDir),
    filename: (req, _file, cb) => {
      const rawId =
        (req.query.uploadId as string) ||
        (req.headers["x-upload-id"] as string) ||
        (req.body && req.body.uploadId) ||
        "upload";
      const rawIndex =
        (req.query.chunkIndex as string) ||
        (req.headers["x-chunk-index"] as string) ||
        (req.body && req.body.chunkIndex) ||
        "0";
      const uploadId = String(rawId).replace(/[^a-zA-Z0-9_-]/g, "");
      const chunkIndex = parseInt(String(rawIndex), 10) || 0;
      cb(null, `${uploadId}_part_${chunkIndex}`);
    }
  });

  const uploadChunk = multer({
    storage: chunkStorage,
    limits: { fileSize: 25 * 1024 * 1024 } // 25MB max per chunk
  });

  // Dedicated byte-range streaming handler for fast seeking and responsive playback in 2.5GB+ video files
  app.get("/uploads/:filename", (req, res, next) => {
    const filename = path.basename(req.params.filename);
    const filePath = path.join(uploadsDir, filename);

    if (!fs.existsSync(filePath)) {
      return next();
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    // Enable cross-origin and streaming headers
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Range, Content-Type, Accept-Ranges");
    res.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    res.header("Accept-Ranges", "bytes");

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".ogg": "video/ogg",
      ".mov": "video/quicktime",
      ".mkv": "video/mp4",
      ".avi": "video/x-msvideo",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav"
    };
    const contentType = mimeTypes[ext] || "application/octet-stream";

    // Handle HEAD request for metadata probing
    if (req.method === "HEAD") {
      res.writeHead(200, {
        "Content-Length": fileSize,
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400"
      });
      return res.end();
    }

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      
      // For open-ended ranges (e.g. "bytes=0-"), cap chunk size to 8MB so Cloud Run
      // reverse proxies and mobile browsers never buffer overflow or stall on 2.5GB+ movies!
      const MAX_RANGE_CHUNK = 8 * 1024 * 1024; // 8MB per range chunk
      const requestedEnd = parts[1] && parts[1].trim() !== "" ? parseInt(parts[1], 10) : NaN;
      const end = !isNaN(requestedEnd)
        ? Math.min(requestedEnd, fileSize - 1)
        : Math.min(start + MAX_RANGE_CHUNK - 1, fileSize - 1);

      if (isNaN(start) || start >= fileSize || start > end) {
        res.status(416).header("Content-Range", `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });

      // Free file handles and abort stream immediately when scrubbing or navigating
      req.on("close", () => fileStream.destroy());
      res.on("close", () => fileStream.destroy());
      fileStream.on("error", () => {
        if (!res.headersSent) res.status(500).end();
      });

      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunkSize,
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=86400"
      });
      fileStream.pipe(res);
    } else {
      // If no Range header was provided and file is large (>16MB), serve initial 8MB window
      // with 206 Partial Content so browser switches to byte-range mode immediately
      if (fileSize > 16 * 1024 * 1024) {
        const chunkSize = Math.min(8 * 1024 * 1024, fileSize);
        const end = chunkSize - 1;
        const fileStream = fs.createReadStream(filePath, { start: 0, end });
        req.on("close", () => fileStream.destroy());
        res.on("close", () => fileStream.destroy());
        fileStream.on("error", () => {
          if (!res.headersSent) res.status(500).end();
        });
        res.writeHead(206, {
          "Content-Range": `bytes 0-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize,
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=86400"
        });
        fileStream.pipe(res);
      } else {
        res.writeHead(200, {
          "Content-Length": fileSize,
          "Content-Type": contentType,
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400"
        });
        const fileStream = fs.createReadStream(filePath);
        req.on("close", () => fileStream.destroy());
        res.on("close", () => fileStream.destroy());
        fileStream.on("error", () => {
          if (!res.headersSent) res.status(500).end();
        });
        fileStream.pipe(res);
      }
    }
  });

  // Serve uploaded media files fallback with static
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
    const handleJoin = ({
      roomId,
      name,
      avatarColor,
      timestamp
    }: {
      roomId: string;
      name?: string;
      avatarColor?: string;
      timestamp?: number;
    }) => {
      socket.join(roomId);
      
      if (!rooms.has(roomId)) {
        const initialTimestamp = Date.now();
        const initialMovieState = {
          mediaUrl: "https://media.w3.org/2010/05/bunny/trailer.mp4",
          mediaType: "video" as const,
          isPlaying: false,
          currentTime: 0,
          serverTimestamp: initialTimestamp,
          mediaTitle: "Big Buck Bunny (Trailer)",
          uploadedBy: "System",
          playlist: [
            {
              id: 'vid-bunny',
              url: 'https://media.w3.org/2010/05/bunny/trailer.mp4',
              title: 'Big Buck Bunny (Trailer)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'vid-sintel',
              url: 'https://media.w3.org/2010/05/sintel/trailer_hd.mp4',
              title: 'Sintel (Fantasy Trailer HD)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1514533450685-4493e01d1fdc?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'vid-bluemoon',
              url: 'https://cdn.plyr.io/static/demo/View_From_A_Blue_Moon_Trailer-576p.mp4',
              title: 'View From A Blue Moon (Action HD)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1509198397868-475647b2a1e5?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'vid-local-demo',
              url: '/uploads/1788967697862-318783671-test_video.mp4',
              title: 'Lounge Demo Video (Local Storage)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            }
          ]
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

        saveRoomsDb();
      }

      const room = rooms.get(roomId);
      // Ensure playlist exists on older persisted records
      if (!room.movieState.playlist) {
        room.movieState.playlist = [
          {
            id: 'vid-bunny',
            url: room.movieState.mediaUrl || "https://media.w3.org/2010/05/bunny/trailer.mp4",
            title: room.movieState.mediaTitle || 'Big Buck Bunny (Trailer)',
            uploadedBy: room.movieState.uploadedBy || 'System',
            timestamp: Date.now()
          }
        ];
      }
      if (!room.participants) {
        room.participants = new Map();
      }
      if (!room.messages) {
        room.messages = [];
      }

      const joinTimestamp = (typeof timestamp === 'number' && timestamp > 0)
        ? timestamp
        : Date.now();

      room.participants.set(socket.id, {
        socketId: socket.id,
        name: name || `User_${socket.id.slice(0, 4)}`,
        avatarColor: avatarColor || "#6366f1",
        isMuted: false,
        status: 'online',
        statusUpdatedAt: joinTimestamp,
        joinedAt: joinTimestamp,
        statusReason: 'Active in lounge'
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

      // System chat message for user login / join
      const joinMsg = {
        id: Math.random().toString(36).substring(2, 9),
        sender: "System",
        text: `${name || "A user"} joined the lounge.`,
        timestamp: joinTimestamp,
        time: new Date(joinTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
        avatarColor: "#9ca3af"
      };
      room.messages.push(joinMsg);
      saveRoomsDb();
      io.to(roomId).emit("chat-message", joinMsg);
    };

    socket.on("join_room", handleJoin);
    socket.on("join-room", handleJoin);

    // Dedicated movie_action handler (play, pause, seek, change_movie, heartbeat, add_movie, delete_movie)
    socket.on("movie_action", (action: {
      roomId: string;
      type: 'play' | 'pause' | 'seek' | 'change_movie' | 'heartbeat' | 'add_movie' | 'delete_movie';
      currentTime: number;
      isPlaying?: boolean;
      mediaUrl?: string;
      mediaTitle?: string;
      duration?: number;
      uploadedBy?: string;
      playlistItem?: {
        id: string;
        url: string;
        title: string;
        uploadedBy?: string;
        thumbnail?: string;
        duration?: number;
      };
      deletedMediaUrl?: string;
    }) => {
      const { roomId, type, currentTime, mediaUrl, mediaTitle, uploadedBy, playlistItem, deletedMediaUrl } = action;
      const room = rooms.get(roomId);
      if (!room) return;

      const serverTimestamp = Date.now();
      if (!room.movieState.playlist) {
        room.movieState.playlist = [];
      }

      if (type === 'add_movie' && playlistItem) {
        // Prevent duplicate video URLs in playlist
        const existingIdx = room.movieState.playlist.findIndex((v: any) => v.url === playlistItem.url);
        const newItem = {
          id: playlistItem.id || `vid-${Date.now()}`,
          url: playlistItem.url,
          title: playlistItem.title || 'Shared Video',
          uploadedBy: playlistItem.uploadedBy || uploadedBy || 'Guest',
          thumbnail: playlistItem.thumbnail || '',
          timestamp: serverTimestamp,
          duration: playlistItem.duration
        };
        if (existingIdx >= 0) {
          room.movieState.playlist[existingIdx] = newItem;
        } else {
          room.movieState.playlist.unshift(newItem);
        }
        room.movieState.mediaUrl = newItem.url;
        room.movieState.mediaTitle = newItem.title;
        room.movieState.uploadedBy = newItem.uploadedBy;
        room.movieState.currentTime = 0;
        room.movieState.isPlaying = false;
        room.movieState.serverTimestamp = serverTimestamp;
      } else if (type === 'delete_movie') {
        const targetUrl = deletedMediaUrl || mediaUrl;
        if (targetUrl) {
          // Remove from playlist
          room.movieState.playlist = room.movieState.playlist.filter((v: any) => v.url !== targetUrl);

          // If deleted video was active, switch to first remaining video in playlist or fallback
          if (room.movieState.mediaUrl === targetUrl) {
            if (room.movieState.playlist.length > 0) {
              const fallback = room.movieState.playlist[0];
              room.movieState.mediaUrl = fallback.url;
              room.movieState.mediaTitle = fallback.title;
              room.movieState.uploadedBy = fallback.uploadedBy;
            } else {
              room.movieState.mediaUrl = "https://media.w3.org/2010/05/bunny/trailer.mp4";
              room.movieState.mediaTitle = "Big Buck Bunny (Trailer)";
              room.movieState.uploadedBy = "System";
            }
            room.movieState.currentTime = 0;
            room.movieState.isPlaying = false;
          }

          // Clean up file if it was uploaded locally
          if (targetUrl.startsWith("/uploads/")) {
            const filename = path.basename(targetUrl);
            const filePath = path.join(uploadsDir, filename);
            if (fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch (e) { console.error("Error unlinking video:", e); }
            }
          }
        }
        room.movieState.serverTimestamp = serverTimestamp;
      } else {
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
      }

      // Mirror to legacy roomState / mediaState
      room.roomState = { ...room.movieState };
      room.mediaState = { ...room.movieState, lastUpdated: serverTimestamp };

      saveRoomsDb();

      const broadcastPayload = {
        ...action,
        mediaUrl: room.movieState.mediaUrl,
        mediaType: 'video' as const,
        isPlaying: room.movieState.isPlaying,
        currentTime: room.movieState.currentTime,
        serverTimestamp,
        mediaTitle: room.movieState.mediaTitle,
        uploadedBy: room.movieState.uploadedBy,
        playlist: room.movieState.playlist,
        deletedMediaUrl,
        senderId: socket.id
      };

      socket.to(roomId).emit("movie_action", broadcastPayload);
      socket.to(roomId).emit("media_action", broadcastPayload);
      if (type === 'delete_movie' || type === 'add_movie') {
        socket.emit("movie_action", broadcastPayload);
      }
    });

    // Dedicated image_action handler (select_image, zoom, add_image, delete_image)
    socket.on("image_action", (action: {
      roomId: string;
      type: 'select_image' | 'zoom' | 'add_image' | 'delete_image';
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
      deletedImageUrl?: string;
      uploadedBy?: string;
    }) => {
      const { roomId, type, activeImageUrl, activeImageTitle, imageZoom, galleryItem, deletedImageUrl, uploadedBy } = action;
      const room = rooms.get(roomId);
      if (!room) return;

      const serverTimestamp = Date.now();
      if (!room.imageState.gallery) {
        room.imageState.gallery = [];
      }

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
      } else if (type === 'delete_image') {
        const targetUrl = deletedImageUrl || activeImageUrl;
        if (targetUrl) {
          // Remove from gallery
          room.imageState.gallery = room.imageState.gallery.filter((img: any) => img.url !== targetUrl);

          // If active image was deleted, switch to first remaining or fallback
          if (room.imageState.activeImageUrl === targetUrl) {
            if (room.imageState.gallery.length > 0) {
              const fallback = room.imageState.gallery[0];
              room.imageState.activeImageUrl = fallback.url;
              room.imageState.activeImageTitle = fallback.title;
              room.imageState.uploadedBy = fallback.uploadedBy;
            } else {
              room.imageState.activeImageUrl = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80";
              room.imageState.activeImageTitle = "Deep Cosmic Nebula (Space 4K)";
              room.imageState.uploadedBy = "System";
            }
            room.imageState.imageZoom = 1;
          }

          // Clean up file if it was uploaded locally
          if (targetUrl.startsWith("/uploads/")) {
            const filename = path.basename(targetUrl);
            const filePath = path.join(uploadsDir, filename);
            if (fs.existsSync(filePath)) {
              try { fs.unlinkSync(filePath); } catch (e) { console.error("Error unlinking image:", e); }
            }
          }
        }
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
      saveRoomsDb();

      const broadcastPayload = {
        roomId,
        type,
        activeImageUrl: room.imageState.activeImageUrl,
        activeImageTitle: room.imageState.activeImageTitle,
        uploadedBy: room.imageState.uploadedBy,
        imageZoom: room.imageState.imageZoom,
        gallery: room.imageState.gallery,
        deletedImageUrl,
        serverTimestamp,
        senderId: socket.id
      };

      socket.to(roomId).emit("image_action", broadcastPayload);
      if (type === 'delete_image' || type === 'add_image') {
        socket.emit("image_action", broadcastPayload);
      }
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
          playlist: syncedMovie.playlist || room.movieState.playlist,
          duration: syncedMovie.duration || room.movieState.duration,
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

        const fullRoomState = {
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
        };

        socket.emit("room-state", fullRoomState);
        socket.emit("room_state", fullRoomState);
      }
    });

    // Chat messages (durable persistence per roomId)
    socket.on("chat-message", ({ roomId, message }) => {
      const room = rooms.get(roomId);
      if (room) {
        const msgTimestamp = (typeof message?.timestamp === 'number' && message.timestamp > 0)
          ? message.timestamp
          : Date.now();

        const fullMsg = {
          id: message?.id || Math.random().toString(36).substring(2, 9),
          ...message,
          timestamp: msgTimestamp,
          time: new Date(msgTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        };
        if (!room.messages) room.messages = [];
        room.messages.push(fullMsg);
        if (room.messages.length > 500) room.messages.shift(); // Retain up to 500 messages per room
        saveRoomsDb();
        io.to(roomId).emit("chat-message", fullMsg);
      }
    });

    // Mic status toggle
    socket.on("toggle-mic", ({ roomId, isMuted }) => {
      const room = rooms.get(roomId);
      if (room && room.participants && room.participants.has(socket.id)) {
        room.participants.get(socket.id).isMuted = isMuted;
        io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
      }
    });

    // User presence & status updates (Online / Away / Busy via Visibility Change API or user toggle)
    const handleStatusChange = ({
      roomId,
      status,
      statusReason,
      tabHiddenAt
    }: {
      roomId: string;
      status: 'online' | 'away' | 'busy';
      statusReason?: string;
      tabHiddenAt?: number;
    }) => {
      const room = rooms.get(roomId);
      if (room && room.participants && room.participants.has(socket.id)) {
        const p = room.participants.get(socket.id);
        const validStatuses: Array<'online' | 'away' | 'busy'> = ['online', 'away', 'busy'];
        if (validStatuses.includes(status)) {
          p.status = status;
          p.statusUpdatedAt = Date.now();
          p.statusReason = statusReason || (status === 'online' ? 'Active in lounge' : status === 'away' ? 'Switched tab' : 'Busy');
          if (status === 'away') {
            p.tabHiddenAt = tabHiddenAt || Date.now();
          } else {
            p.tabHiddenAt = undefined;
          }
          io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
        }
      }
    };

    socket.on("user-status-change", handleStatusChange);
    socket.on("user_status_change", handleStatusChange);

    // Update user profile (such as avatarColor or display name)
    const handleUpdateProfile = ({
      roomId,
      name,
      avatarColor
    }: {
      roomId: string;
      name?: string;
      avatarColor?: string;
    }) => {
      const room = rooms.get(roomId);
      if (room && room.participants && room.participants.has(socket.id)) {
        const p = room.participants.get(socket.id);
        if (name && name.trim()) p.name = name.trim();
        if (avatarColor) p.avatarColor = avatarColor;
        io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
      }
    };

    socket.on("update-user-profile", handleUpdateProfile);
    socket.on("update_user_profile", handleUpdateProfile);

    // Explicit user logout / leave lounge handler
    const handleUserLeave = ({
      roomId,
      name,
      timestamp
    }: {
      roomId: string;
      name?: string;
      timestamp?: number;
    }) => {
      const room = rooms.get(roomId);
      if (room && room.participants && room.participants.has(socket.id)) {
        const participant = room.participants.get(socket.id);
        room.participants.delete(socket.id);

        io.to(roomId).emit("participants-update", Array.from(room.participants.values()));

        const leaveTimestamp = (typeof timestamp === 'number' && timestamp > 0) ? timestamp : Date.now();
        const leaveMsg = {
          id: Math.random().toString(36).substring(2, 9),
          sender: "System",
          text: `${participant?.name || name || "A user"} left the lounge.`,
          timestamp: leaveTimestamp,
          time: new Date(leaveTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          avatarColor: "#9ca3af"
        };
        room.messages.push(leaveMsg);
        saveRoomsDb();
        io.to(roomId).emit("chat-message", leaveMsg);
      }
    };

    socket.on("leave-room", handleUserLeave);
    socket.on("leave_room", handleUserLeave);

    // Typing status broadcasting
    socket.on("typing", ({ roomId, userName, isTyping }: { roomId: string; userName: string; isTyping: boolean }) => {
      socket.to(roomId).emit("typing", { roomId, userName, isTyping, socketId: socket.id });
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
      const now = Date.now();
      rooms.forEach((room, roomId) => {
        if (room.participants && room.participants.has(socket.id)) {
          const participant = room.participants.get(socket.id);
          room.participants.delete(socket.id);

          // Broadcast updated participant list (do NOT delete room or messages - keep all data stored)
          io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
          const leaveMsg = {
            id: Math.random().toString(36).substring(2, 9),
            sender: "System",
            text: `${participant.name} left the lounge.`,
            timestamp: now,
            time: new Date(now).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            avatarColor: "#9ca3af"
          };
          room.messages.push(leaveMsg);
          saveRoomsDb();
          io.to(roomId).emit("chat-message", leaveMsg);
        }
      });
    });
  });

  // API health check & stored rooms info
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", activeRooms: rooms.size });
  });

  // Retrieve all stored messages for a specific room ID
  app.get("/api/rooms/:roomId/messages", (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) {
      return res.json({ roomId, messages: [] });
    }
    res.json({ roomId, messages: room.messages || [] });
  });

  // Retrieve full stored state for a room
  app.get("/api/rooms/:roomId", (req, res) => {
    const { roomId } = req.params;
    const room = rooms.get(roomId);
    if (!room) {
      return res.status(404).json({ error: "Room not found" });
    }
    res.json({
      roomId,
      movieState: getSyncedMovieState(room),
      imageState: room.imageState,
      messages: room.messages || []
    });
  });

  // Delete media file (image or video) and update room storage
  app.post("/api/media/delete", (req, res) => {
    const { roomId, url, mediaType } = req.body;
    if (!url) {
      return res.status(400).json({ error: "Media URL is required" });
    }

    const room = roomId ? rooms.get(roomId) : null;
    const serverTimestamp = Date.now();

    // If local uploaded file, delete from disk
    if (url.startsWith("/uploads/")) {
      const filename = path.basename(url);
      const filePath = path.join(uploadsDir, filename);
      if (fs.existsSync(filePath)) {
        try {
          fs.unlinkSync(filePath);
          console.log(`[Storage] Deleted file from disk: ${filePath}`);
        } catch (err) {
          console.error(`[Storage] Error deleting file: ${filePath}`, err);
        }
      }
    }

    if (room) {
      if (mediaType === "image") {
        if (room.imageState?.gallery) {
          room.imageState.gallery = room.imageState.gallery.filter((img: any) => img.url !== url);
          if (room.imageState.activeImageUrl === url) {
            if (room.imageState.gallery.length > 0) {
              const fallback = room.imageState.gallery[0];
              room.imageState.activeImageUrl = fallback.url;
              room.imageState.activeImageTitle = fallback.title;
              room.imageState.uploadedBy = fallback.uploadedBy;
            } else {
              room.imageState.activeImageUrl = "https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80";
              room.imageState.activeImageTitle = "Deep Cosmic Nebula (Space 4K)";
            }
          }
        }
        room.imageState.serverTimestamp = serverTimestamp;
        saveRoomsDb();

        io.to(roomId).emit("image_action", {
          roomId,
          type: "delete_image",
          activeImageUrl: room.imageState.activeImageUrl,
          activeImageTitle: room.imageState.activeImageTitle,
          gallery: room.imageState.gallery,
          deletedImageUrl: url,
          serverTimestamp
        });
      } else {
        // Video deletion
        if (room.movieState?.playlist) {
          room.movieState.playlist = room.movieState.playlist.filter((vid: any) => vid.url !== url);
          if (room.movieState.mediaUrl === url) {
            if (room.movieState.playlist.length > 0) {
              const fallback = room.movieState.playlist[0];
              room.movieState.mediaUrl = fallback.url;
              room.movieState.mediaTitle = fallback.title;
              room.movieState.uploadedBy = fallback.uploadedBy;
            } else {
              room.movieState.mediaUrl = "https://media.w3.org/2010/05/bunny/trailer.mp4";
              room.movieState.mediaTitle = "Big Buck Bunny (Trailer)";
              room.movieState.uploadedBy = "System";
            }
            room.movieState.currentTime = 0;
            room.movieState.isPlaying = false;
          }
        }
        room.movieState.serverTimestamp = serverTimestamp;
        saveRoomsDb();

        io.to(roomId).emit("movie_action", {
          roomId,
          type: "delete_movie",
          mediaUrl: room.movieState.mediaUrl,
          mediaTitle: room.movieState.mediaTitle,
          playlist: room.movieState.playlist,
          isPlaying: room.movieState.isPlaying,
          currentTime: room.movieState.currentTime,
          deletedMediaUrl: url,
          serverTimestamp
        });
      }
    }

    res.json({ success: true, deletedUrl: url });
  });

  // Media upload endpoint (movies, audio, photos) with robust error trapping
  app.post("/api/upload", (req, res) => {
    (upload.single("file") as any)(req, res, (err: any) => {
      if (err) {
        console.error("[Upload] Multer error during upload:", err);
        if (err instanceof multer.MulterError) {
          if (err.code === "LIMIT_FILE_SIZE") {
            return res.status(413).json({
              error: "File is too large. Maximum supported movie size is 4GB."
            });
          }
          return res.status(400).json({ error: `Upload error: ${err.message}` });
        }
        return res.status(500).json({ error: err.message || "File upload failed on server." });
      }

      if (!req.file) {
        return res.status(400).json({ error: "No file was provided for upload." });
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
  });

  // Endpoint to check if a chunk is already saved on server (resumable / idempotent verification)
  app.get("/api/upload/chunk-status", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    const rawId = (req.query.uploadId as string) || "";
    const uploadId = rawId.replace(/[^a-zA-Z0-9_-]/g, "");
    const chunkIndex = parseInt((req.query.chunkIndex as string) || "-1", 10);
    const expectedSize = parseInt((req.query.expectedSize as string) || "0", 10);

    if (!uploadId || chunkIndex < 0) {
      return res.status(400).json({ error: "Invalid uploadId or chunkIndex" });
    }

    const partPath = path.join(chunksDir, `${uploadId}_part_${chunkIndex}`);
    if (fs.existsSync(partPath)) {
      const size = fs.statSync(partPath).size;
      if (expectedSize > 0 && Math.abs(size - expectedSize) > 0) {
        // Size mismatch
        return res.json({ exists: false, size });
      }
      return res.json({ exists: true, size });
    }

    return res.json({ exists: false });
  });

  // Chunked upload endpoint to handle arbitrarily large files (350MB - 4GB)
  // bypassing reverse proxy / Cloud Run 32MB payload limits completely!
  app.post("/api/upload/chunk", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    (uploadChunk.single("chunk") as any)(req, res, async (err: any) => {
      if (err) {
        console.error("[Chunk Upload] Multer error:", err);
        return res.status(400).json({ error: `Chunk upload failed: ${err.message}` });
      }

      const uploadId = (
        (req.query.uploadId as string) ||
        (req.headers["x-upload-id"] as string) ||
        (req.body && req.body.uploadId) ||
        ""
      ).replace(/[^a-zA-Z0-9_-]/g, "");

      const chunkIndex = parseInt(
        (req.query.chunkIndex as string) ||
        (req.headers["x-chunk-index"] as string) ||
        (req.body && req.body.chunkIndex),
        10
      );

      const totalChunks = parseInt(
        (req.query.totalChunks as string) ||
        (req.headers["x-total-chunks"] as string) ||
        (req.body && req.body.totalChunks),
        10
      );

      const fileName =
        (req.query.fileName as string) ||
        (req.body && req.body.fileName) ||
        "video.mp4";

      const fileSize =
        parseInt((req.query.fileSize as string) || (req.body && req.body.fileSize), 10) || 0;

      const fileType =
        (req.query.fileType as string) ||
        (req.body && req.body.fileType) ||
        "";

      if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks)) {
        return res.status(400).json({ error: "Missing chunk metadata (uploadId, chunkIndex, totalChunks)" });
      }

      // If this is the final chunk, assemble the parts
      if (chunkIndex === totalChunks - 1) {
        // Verify all parts exist from 0 to totalChunks - 1 (with brief retry for disk flush)
        for (let i = 0; i < totalChunks; i++) {
          const partPath = path.join(chunksDir, `${uploadId}_part_${i}`);
          let exists = fs.existsSync(partPath);
          if (!exists) {
            for (let retry = 0; retry < 5 && !exists; retry++) {
              await new Promise((r) => setTimeout(r, 100));
              exists = fs.existsSync(partPath);
            }
          }
          if (!exists) {
            console.error(`[Chunk Upload] Missing part ${i} for upload ${uploadId} in ${chunksDir}`);
            return res.status(400).json({
              error: `Missing part ${i} of ${totalChunks}. Please resume or retry.`
            });
          }
        }

        const safeName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const finalFilename = `${uniqueSuffix}-${safeName}`;
        const finalFilePath = path.join(uploadsDir, finalFilename);

        try {
          if (fs.existsSync(finalFilePath)) {
            fs.unlinkSync(finalFilePath);
          }

          // Merge each part into final file using stream pipeline to avoid event-loop blocking
          const writeStream = fs.createWriteStream(finalFilePath);
          for (let i = 0; i < totalChunks; i++) {
            const partPath = path.join(chunksDir, `${uploadId}_part_${i}`);
            await new Promise<void>((resolve, reject) => {
              const readStream = fs.createReadStream(partPath);
              readStream.on("error", reject);
              readStream.pipe(writeStream, { end: false });
              readStream.on("end", () => {
                try { fs.unlinkSync(partPath); } catch (_) {}
                resolve();
              });
            });
          }
          await new Promise<void>((resolve, reject) => {
            writeStream.on("finish", () => resolve());
            writeStream.on("error", reject);
            writeStream.end();
          });

          let finalServedFilename = finalFilename;
          const lowerExt = path.extname(finalFilename).toLowerCase();

          // Optimization for 2.5GB+ video playback:
          // 1. If MKV, remux to MP4 so standard browser <video> tags can decode it
          // 2. If MP4, apply +faststart to move moov atom to beginning of file for instant playback
          if (lowerExt === ".mkv") {
            const mp4Filename = finalFilename.replace(/\.mkv$/i, ".mp4");
            const mp4Path = path.join(uploadsDir, mp4Filename);
            try {
              console.log(`[Chunk Upload] Auto-remuxing MKV to faststart MP4 for ${finalFilename}...`);
              await new Promise<void>((resolve) => {
                const ffmpeg = spawn("ffmpeg", [
                  "-y",
                  "-i", finalFilePath,
                  "-c:v", "copy",
                  "-c:a", "aac",
                  "-movflags", "+faststart",
                  mp4Path
                ]);
                ffmpeg.on("close", (code) => {
                  if (code === 0 && fs.existsSync(mp4Path) && fs.statSync(mp4Path).size > 0) {
                    try { fs.unlinkSync(finalFilePath); } catch (_) {}
                    finalServedFilename = mp4Filename;
                    console.log(`[Chunk Upload] Successfully remuxed MKV to MP4: ${mp4Filename}`);
                  }
                  resolve();
                });
                ffmpeg.on("error", () => resolve());
              });
            } catch (remuxErr) {
              console.warn("[Chunk Upload] Remux skipped:", remuxErr);
            }
          } else if (lowerExt === ".mp4" || lowerExt === ".mov") {
            const fastFilename = `fast_${finalFilename}`;
            const fastPath = path.join(uploadsDir, fastFilename);
            try {
              console.log(`[Chunk Upload] Applying +faststart to ${finalFilename}...`);
              await new Promise<void>((resolve) => {
                const ffmpeg = spawn("ffmpeg", [
                  "-y",
                  "-i", finalFilePath,
                  "-c", "copy",
                  "-movflags", "+faststart",
                  fastPath
                ]);
                ffmpeg.on("close", (code) => {
                  if (code === 0 && fs.existsSync(fastPath) && fs.statSync(fastPath).size > 0) {
                    try {
                      fs.unlinkSync(finalFilePath);
                      fs.renameSync(fastPath, finalFilePath);
                      console.log(`[Chunk Upload] Applied +faststart to ${finalFilename}`);
                    } catch (_) {}
                  } else {
                    try { if (fs.existsSync(fastPath)) fs.unlinkSync(fastPath); } catch (_) {}
                  }
                  resolve();
                });
                ffmpeg.on("error", () => resolve());
              });
            } catch (fastErr) {
              console.warn("[Chunk Upload] Faststart skipped:", fastErr);
            }
          }

          let mediaType: "video" | "audio" | "image" = "video";
          if (fileType.startsWith("image/")) {
            mediaType = "image";
          } else if (fileType.startsWith("audio/")) {
            mediaType = "audio";
          }

          const currentFinalPath = path.join(uploadsDir, finalServedFilename);
          const assembledSize = fs.existsSync(currentFinalPath) ? fs.statSync(currentFinalPath).size : 0;
          console.log(`[Chunk Upload] Successfully assembled file: ${finalServedFilename} (${totalChunks} chunks, size: ${assembledSize})`);

          return res.json({
            url: `/uploads/${finalServedFilename}`,
            mediaType,
            mediaTitle: fileName.replace(/\.mkv$/i, ".mp4"),
            size: assembledSize
          });
        } catch (mergeErr: any) {
          console.error("[Chunk Upload] Error merging chunks:", mergeErr);
          return res.status(500).json({ error: "Failed to assemble file: " + mergeErr.message });
        }
      }

      // Non-final chunk uploaded successfully
      return res.json({
        success: true,
        chunkIndex,
        totalChunks
      });
    });
  });

  // Optimize uploaded media file on-demand for web browser playback (+faststart, AAC audio)
  app.post("/api/media/optimize", express.json(), async (req, res) => {
    try {
      const mediaUrl = req.body?.url || "";
      if (!mediaUrl.startsWith("/uploads/")) {
        return res.status(400).json({ error: "Invalid media URL" });
      }
      const rawName = path.basename(mediaUrl);
      const inputPath = path.join(uploadsDir, rawName);
      if (!fs.existsSync(inputPath)) {
        return res.status(404).json({ error: "Media file not found on server" });
      }

      const outName = rawName.replace(/\.[^/.]+$/, "") + "_web.mp4";
      const outputPath = path.join(uploadsDir, outName);

      console.log(`[Media Optimize] Optimizing ${rawName} -> ${outName}...`);

      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawn("ffmpeg", [
          "-y",
          "-i", inputPath,
          "-c:v", "copy",
          "-c:a", "aac",
          "-movflags", "+faststart",
          outputPath
        ]);
        ffmpeg.on("close", (code) => {
          if (code === 0 && fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
            resolve();
          } else {
            reject(new Error(`ffmpeg exited with code ${code}`));
          }
        });
        ffmpeg.on("error", reject);
      });

      const newSize = fs.statSync(outputPath).size;
      return res.json({
        success: true,
        optimizedUrl: `/uploads/${outName}`,
        size: newSize
      });
    } catch (err: any) {
      console.error("[Media Optimize] Error:", err);
      return res.status(500).json({ error: err.message || "Failed to optimize media file" });
    }
  });

  // Abort chunked upload and clean up temporary parts
  app.post("/api/upload/abort", (req, res) => {
    const uploadId = (req.body.uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (uploadId) {
      try {
        const files = fs.readdirSync(chunksDir);
        for (const file of files) {
          if (file.startsWith(`${uploadId}_part_`)) {
            try { fs.unlinkSync(path.join(chunksDir, file)); } catch (_) {}
          }
        }
      } catch (_) {}
    }
    res.json({ success: true });
  });

  // Stale chunk garbage collection (runs every 30 mins)
  setInterval(() => {
    try {
      const now = Date.now();
      const files = fs.readdirSync(chunksDir);
      for (const file of files) {
        const filePath = path.join(chunksDir, file);
        const stat = fs.statSync(filePath);
        if (now - stat.mtimeMs > 2 * 60 * 60 * 1000) {
          try { fs.unlinkSync(filePath); } catch (_) {}
        }
      }
    } catch (_) {}
  }, 30 * 60 * 1000);

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

  // Configure 30-minute timeouts on the HTTP server to support 2GB+ file uploads over various networks
  server.timeout = 1800000; // 30 minutes
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  server.requestTimeout = 1800000;

  server.listen(PORT, "0.0.0.0", () => {
    console.log(`SyncSpace server running on http://0.0.0.0:${PORT}`);
  });
}

startServer();
