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
          map.set(roomId, {
            ...roomData,
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

  // Dedicated byte-range streaming handler for fast seeking in 2GB+ video files
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
    res.header("Access-Control-Allow-Headers", "Range, Content-Type");
    res.header("Access-Control-Expose-Headers", "Content-Range, Content-Length, Accept-Ranges");
    res.header("Accept-Ranges", "bytes");

    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      ".mp4": "video/mp4",
      ".webm": "video/webm",
      ".ogg": "video/ogg",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
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

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (isNaN(start) || start >= fileSize || (parts[1] && end >= fileSize) || start > end) {
        res.status(416).header("Content-Range", `bytes */${fileSize}`).end();
        return;
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(filePath, { start, end });
      res.writeHead(206, {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
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
      fs.createReadStream(filePath).pipe(res);
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
          uploadedBy: "System",
          playlist: [
            {
              id: 'vid-bunny',
              url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
              title: 'Big Buck Bunny (Animated Movie)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'vid-tears',
              url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/TearsOfSteel.mp4',
              title: 'Tears of Steel (Sci-Fi Short)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1478760329108-5c3ed9d495a0?w=400&auto=format&fit=crop&q=80',
              timestamp: initialTimestamp
            },
            {
              id: 'vid-elephants',
              url: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ElephantsDream.mp4',
              title: 'Elephants Dream (Open Movie)',
              uploadedBy: 'System',
              thumbnail: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=400&auto=format&fit=crop&q=80',
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
            url: room.movieState.mediaUrl || "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4",
            title: room.movieState.mediaTitle || 'Big Buck Bunny (Animated Movie)',
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
              room.movieState.mediaUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
              room.movieState.mediaTitle = "Big Buck Bunny (Animated Movie)";
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

    // Chat messages (durable persistence per roomId)
    socket.on("chat-message", ({ roomId, message }) => {
      const room = rooms.get(roomId);
      if (room) {
        const fullMsg = {
          id: Math.random().toString(36).substring(2, 9),
          ...message,
          time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
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
        if (room.participants && room.participants.has(socket.id)) {
          const participant = room.participants.get(socket.id);
          room.participants.delete(socket.id);

          // Broadcast updated participant list (do NOT delete room or messages - keep all data stored)
          io.to(roomId).emit("participants-update", Array.from(room.participants.values()));
          const leaveMsg = {
            id: Math.random().toString(36).substring(2, 9),
            sender: "System",
            text: `${participant.name} left the lounge.`,
            time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
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
              room.movieState.mediaUrl = "https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4";
              room.movieState.mediaTitle = "Big Buck Bunny (Animated Movie)";
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
    upload.single("file")(req, res, (err) => {
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

  // Chunked upload endpoint to handle arbitrarily large files (350MB - 4GB)
  // bypassing reverse proxy / Cloud Run 32MB payload limits completely!
  app.post("/api/upload/chunk", (req, res) => {
    uploadChunk.single("chunk")(req, res, async (err) => {
      if (err) {
        console.error("[Chunk Upload] Multer error:", err);
        return res.status(400).json({ error: `Chunk upload failed: ${err.message}` });
      }

      const uploadId = (req.body.uploadId || "").replace(/[^a-zA-Z0-9_-]/g, "");
      const chunkIndex = parseInt(req.body.chunkIndex, 10);
      const totalChunks = parseInt(req.body.totalChunks, 10);
      const fileName = req.body.fileName || "video.mp4";
      const fileSize = parseInt(req.body.fileSize, 10) || 0;
      const fileType = req.body.fileType || "";

      if (!uploadId || isNaN(chunkIndex) || isNaN(totalChunks)) {
        return res.status(400).json({ error: "Missing chunk metadata (uploadId, chunkIndex, totalChunks)" });
      }

      // If this is the final chunk, assemble the parts
      if (chunkIndex === totalChunks - 1) {
        // Verify all parts exist from 0 to totalChunks - 1
        for (let i = 0; i < totalChunks; i++) {
          const partPath = path.join(chunksDir, `${uploadId}_part_${i}`);
          if (!fs.existsSync(partPath)) {
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
          const writeStream = fs.createWriteStream(finalFilePath);

          for (let i = 0; i < totalChunks; i++) {
            const partPath = path.join(chunksDir, `${uploadId}_part_${i}`);
            const data = fs.readFileSync(partPath);
            writeStream.write(data);
            try { fs.unlinkSync(partPath); } catch (_) {}
          }

          writeStream.end();

          let mediaType: "video" | "audio" | "image" = "video";
          if (fileType.startsWith("image/")) {
            mediaType = "image";
          } else if (fileType.startsWith("audio/")) {
            mediaType = "audio";
          }

          console.log(`[Chunk Upload] Assembled file: ${finalFilename} (${totalChunks} chunks, size: ${fileSize || fs.statSync(finalFilePath).size})`);

          return res.json({
            url: `/uploads/${finalFilename}`,
            mediaType,
            mediaTitle: fileName,
            size: fileSize || fs.statSync(finalFilePath).size
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
