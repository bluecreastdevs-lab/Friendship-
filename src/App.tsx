import React, { useState, useRef, useEffect } from 'react';
import { io, Socket } from 'socket.io-client';
import ThreeBackground from './components/ThreeBackground';
import MoviePlayer from './components/MoviePlayer';
import ImageViewer from './components/ImageViewer';
import ChatDrawer from './components/ChatDrawer';
import VoiceCall from './components/VoiceCall';
import { Film, Image as ImageIcon, Copy, Check, Users, ExternalLink, Sparkles, Share2, X, MessageCircle } from 'lucide-react';
import { Participant, Message, MovieState, ImageState, MovieActionPayload, ImageActionPayload } from './types';

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

export default function App() {
  const [inLounge, setInLounge] = useState(false);
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      return params.get('room') || 'lounge-101';
    }
    return 'lounge-101';
  });
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);
  const [copiedRoom, setCopiedRoom] = useState(false);
  const [showShareModal, setShowShareModal] = useState(false);

  // Tab state: 'movie' vs 'image'
  const [mediaTab, setMediaTab] = useState<'movie' | 'image'>('movie');

  // Socket
  const [socket, setSocket] = useState<Socket | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Participants & Messages
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);

  // Movie State (Independent sync channel)
  const [movieState, setMovieState] = useState<MovieState>({
    mediaUrl: 'https://www.w3schools.com/html/mov_bbb.mp4',
    mediaType: 'video',
    isPlaying: false,
    currentTime: 0,
    serverTimestamp: Date.now(),
    mediaTitle: 'Big Buck Bunny (Animated Classic)',
    uploadedBy: 'System'
  });

  // Image State (Independent sync channel)
  const [imageState, setImageState] = useState<ImageState>({
    activeImageUrl: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80',
    activeImageTitle: 'Deep Cosmic Nebula (Space 4K)',
    uploadedBy: 'System',
    imageZoom: 1,
    gallery: [
      {
        id: 'img-nebula',
        url: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80',
        title: 'Deep Cosmic Nebula (Space 4K)',
        uploadedBy: 'System',
        thumbnail: 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=400&auto=format&fit=crop&q=80'
      },
      {
        id: 'img-cyberpunk',
        url: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=1600&auto=format&fit=crop&q=80',
        title: 'Cyberpunk Metropolis Night',
        uploadedBy: 'System',
        thumbnail: 'https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80'
      },
      {
        id: 'img-aurora',
        url: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=1600&auto=format&fit=crop&q=80',
        title: 'Aurora Borealis Glaciers',
        uploadedBy: 'System',
        thumbnail: 'https://images.unsplash.com/photo-1531366936337-7c912a4589a7?w=400&auto=format&fit=crop&q=80'
      },
      {
        id: 'img-lake',
        url: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=1600&auto=format&fit=crop&q=80',
        title: 'Alpine Emerald Lake Sunset',
        uploadedBy: 'System',
        thumbnail: 'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?w=400&auto=format&fit=crop&q=80'
      }
    ]
  });

  const [activeSideTab, setActiveSideTab] = useState<'chat' | 'voice'>('chat');

  // Check URL search parameters on load (supports opening movie or image in a dedicated new tab!)
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const roomParam = params.get('room');
      const tabParam = params.get('tab');
      const nameParam = params.get('name');

      if (roomParam) {
        setRoomId(roomParam);
      }
      if (tabParam === 'image' || tabParam === 'movie') {
        setMediaTab(tabParam);
      }

      if (nameParam) {
        setUserName(nameParam);
      } else if (roomParam) {
        // Generate random guest name if joined via room link
        setUserName(`User_${Math.floor(1000 + Math.random() * 9000)}`);
      }
    } catch (_) {}
  }, []);

  // Connect to room
  const connectToRoom = (targetRoomId: string, name: string, color: string) => {
    const newSocket = io();
    socketRef.current = newSocket;
    setSocket(newSocket);

    newSocket.emit('join-room', {
      roomId: targetRoomId.trim(),
      name: name.trim(),
      avatarColor: color
    });

    // Authoritative room-state synchronization
    newSocket.on('room-state', (state) => {
      if (state.movieState) {
        setMovieState((prev) => ({
          ...prev,
          ...state.movieState
        }));
      }
      if (state.imageState) {
        setImageState((prev) => ({
          ...prev,
          ...state.imageState
        }));
      }
      if (state.participants) {
        setParticipants(state.participants);
      }
      if (state.messages) {
        setMessages(state.messages);
      }
    });

    // Dedicated movie sync packet
    newSocket.on('movie_action', (packet: MovieActionPayload) => {
      setMovieState((prev) => ({
        ...prev,
        mediaUrl: packet.mediaUrl || prev.mediaUrl,
        currentTime: packet.currentTime ?? prev.currentTime,
        isPlaying: packet.isPlaying ?? prev.isPlaying,
        mediaTitle: packet.mediaTitle || prev.mediaTitle,
        uploadedBy: packet.uploadedBy || prev.uploadedBy,
        duration: packet.duration ?? prev.duration,
        playlist: packet.playlist || prev.playlist,
        serverTimestamp: packet.serverTimestamp || Date.now()
      }));
    });

    // Dedicated image sync packet
    newSocket.on('image_action', (packet: ImageActionPayload) => {
      setImageState((prev) => ({
        ...prev,
        activeImageUrl: packet.activeImageUrl || prev.activeImageUrl,
        activeImageTitle: packet.activeImageTitle || prev.activeImageTitle,
        uploadedBy: packet.uploadedBy || prev.uploadedBy,
        imageZoom: packet.imageZoom ?? prev.imageZoom,
        gallery: packet.gallery || prev.gallery
      }));
    });

    newSocket.on('participants-update', (updatedParticipants) => {
      setParticipants(updatedParticipants);
    });

    newSocket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    setInLounge(true);
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !roomId.trim()) return;
    connectToRoom(roomId, userName, avatarColor);
  };

  // State handlers
  const handleMovieStateChange = (updated: Partial<MovieState>) => {
    setMovieState((prev) => ({
      ...prev,
      ...updated,
      serverTimestamp: Date.now()
    }));
  };

  const handleImageStateChange = (updated: Partial<ImageState>) => {
    setImageState((prev) => ({
      ...prev,
      ...updated,
      serverTimestamp: Date.now()
    }));
  };

  const handleRequestSync = () => {
    socketRef.current?.emit('request-sync', { roomId });
  };

  const handleSendMessage = (text: string) => {
    socketRef.current?.emit('chat-message', {
      roomId,
      message: {
        sender: userName,
        text,
        avatarColor,
        timestamp: Date.now()
      }
    });
  };

  const handleToggleMic = (isMuted: boolean) => {
    socketRef.current?.emit('toggle-mic', { roomId, isMuted });
  };

  const getInviteLink = () => {
    let origin = '';
    if (typeof window !== 'undefined' && window.location) {
      origin = window.location.origin;
    }
    return `${origin}?room=${encodeURIComponent(roomId)}`;
  };

  const handleCopyRoom = () => {
    const inviteLink = getInviteLink();
    try {
      navigator.clipboard.writeText(inviteLink);
    } catch (_) {}
    setCopiedRoom(true);
    setShowShareModal(true);
    setTimeout(() => setCopiedRoom(false), 2500);
  };

  // Open the image tab in a brand new browser tab
  const handleOpenImageNewTab = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}&tab=image&name=${encodeURIComponent(userName || 'User')}`;
    window.open(url, '_blank');
  };

  // Open the movie tab in a brand new browser tab
  const handleOpenMovieNewTab = () => {
    const url = `${window.location.origin}${window.location.pathname}?room=${encodeURIComponent(roomId)}&tab=movie&name=${encodeURIComponent(userName || 'User')}`;
    window.open(url, '_blank');
  };

  if (!inLounge) {
    return (
      <div className="relative min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 font-sans">
        <ThreeBackground />

        <div className="w-full max-w-md bg-slate-900/85 backdrop-blur-2xl border border-slate-700/60 p-8 rounded-3xl shadow-2xl space-y-6 z-10">
          <div className="flex flex-col items-center space-y-2 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Film className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">SyncSpace</h1>
            <p className="text-xs text-slate-400">
              Real-time synchronized room with media playback, photo gallery, chat and voice
            </p>
          </div>

          <form onSubmit={handleJoinRoom} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Your Name</label>
              <input
                type="text"
                placeholder="Enter your display name"
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                className="w-full px-4 py-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Lounge Room ID</label>
              <input
                type="text"
                placeholder="e.g. movie-night-101"
                value={roomId}
                onChange={(e) => setRoomId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-800/80 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
                required
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-slate-300">Choose Avatar Color</label>
              <div className="flex items-center space-x-3 py-1">
                {AVATAR_COLORS.map((color) => (
                  <button
                    key={color}
                    type="button"
                    onClick={() => setAvatarColor(color)}
                    className={`w-8 h-8 rounded-full transition-transform ${
                      avatarColor === color ? 'ring-2 ring-white scale-110' : 'opacity-70 hover:opacity-100'
                    }`}
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
            </div>

            <button
              type="submit"
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-semibold text-sm rounded-xl shadow-lg shadow-indigo-600/30 transition-all transform hover:-translate-y-0.5"
            >
              Enter Synced Lounge
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col bg-slate-950 font-sans p-2 lg:p-4 gap-3.5">
      <ThreeBackground />

      {/* Top Navigation & Controls Bar */}
      <header className="flex items-center justify-between px-2.5 sm:px-5 py-2 sm:py-2.5 bg-slate-900/95 backdrop-blur-xl border border-slate-800/80 rounded-2xl shadow-xl shrink-0 z-20 gap-2 overflow-hidden">
        <div className="flex items-center space-x-2 sm:space-x-4 min-w-0 shrink-0">
          <div className="flex items-center space-x-2">
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-xl bg-gradient-to-tr from-indigo-600 via-purple-600 to-pink-500 flex items-center justify-center shadow-md shrink-0">
              <Film className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-white" />
            </div>
            <span className="text-sm sm:text-base font-bold tracking-wider text-white font-mono hidden md:inline">
              SYNCSPACE
            </span>
          </div>

          {/* Primary Media Switcher Tabs: Movie Page vs Image Page */}
          <div className="flex items-center p-0.5 sm:p-1 bg-slate-950/80 rounded-xl border border-slate-800 shadow-inner shrink-0">
            <button
              onClick={() => setMediaTab('movie')}
              className={`flex items-center space-x-1 sm:space-x-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mediaTab === 'movie'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Switch to Synced Movie Lounge"
            >
              <Film className="w-3.5 h-3.5 shrink-0" />
              <span>Movie</span>
              <span className="hidden sm:inline">Page</span>
            </button>

            <button
              onClick={() => setMediaTab('image')}
              className={`flex items-center space-x-1 sm:space-x-1.5 px-2.5 sm:px-3 py-1 sm:py-1.5 rounded-lg text-xs font-semibold transition-all ${
                mediaTab === 'image'
                  ? 'bg-pink-600 text-white shadow-md shadow-pink-600/30'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Switch to Synced Image Gallery"
            >
              <ImageIcon className="w-3.5 h-3.5 shrink-0" />
              <span>Image</span>
              <span className="hidden sm:inline">Page</span>
            </button>
          </div>
        </div>

        {/* Center Room Indicator & Share Button */}
        <div className="flex items-center space-x-1.5 shrink-0">
          <button
            onClick={handleCopyRoom}
            className="flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-slate-800/90 hover:bg-slate-700/90 rounded-xl border border-slate-700 text-xs text-slate-200 transition-colors shadow-sm"
            title="Click to copy Room Link to invite peers"
          >
            <span className="text-slate-400 font-normal hidden sm:inline">Room:</span>
            <span className="font-mono font-bold text-indigo-300 truncate max-w-[85px] sm:max-w-none">{roomId}</span>
            {copiedRoom ? (
              <Check className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 shrink-0" />
            ) : (
              <Copy className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-slate-400 shrink-0" />
            )}
          </button>

          <button
            onClick={() => setShowShareModal(true)}
            className="flex items-center space-x-1.5 px-2 sm:px-3 py-1 sm:py-1.5 bg-indigo-600/90 hover:bg-indigo-500 rounded-xl text-xs font-semibold text-white transition-all shadow-sm shadow-indigo-600/20"
            title="Invite friends with shareable link"
          >
            <Share2 className="w-3.5 h-3.5 text-indigo-100 shrink-0" />
            <span className="hidden sm:inline">Invite</span>
          </button>
        </div>

        {/* Right User & Open-in-New-Tab shortcuts */}
        <div className="flex items-center space-x-1.5 sm:space-x-2.5 shrink-0">
          {/* Open current page in new tab shortcut */}
          <button
            onClick={mediaTab === 'image' ? handleOpenImageNewTab : handleOpenMovieNewTab}
            className="hidden md:flex items-center space-x-1.5 px-2.5 py-1.5 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 text-xs font-medium transition-colors shadow-sm"
            title={mediaTab === 'image' ? 'Open Image Page in New Browser Tab' : 'Open Movie Page in New Browser Tab'}
          >
            <ExternalLink className="w-3.5 h-3.5 text-indigo-400" />
            <span>Open {mediaTab === 'image' ? 'Image' : 'Movie'} in New Tab</span>
          </button>

          <div className="flex items-center space-x-1 sm:space-x-1.5 px-2 sm:px-2.5 py-1 bg-slate-800/80 rounded-xl border border-slate-700 text-xs text-slate-300">
            <Users className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-emerald-400 shrink-0" />
            <span className="font-semibold text-white text-[11px] sm:text-xs">{participants.length}</span>
          </div>

          <div className="flex items-center space-x-1.5 px-1.5 sm:px-2.5 py-1 bg-slate-800/80 rounded-full border border-slate-700">
            <div
              className="w-5 h-5 rounded-full flex items-center justify-center font-bold text-white text-[9px] shrink-0"
              style={{ backgroundColor: avatarColor }}
            >
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-xs font-medium text-slate-200 hidden sm:inline">{userName}</span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 gap-3.5">
        {/* Left / Main Section: Active Media Tab (Movie or Image) */}
        <div className="flex-1 flex flex-col h-[60vh] lg:h-full min-h-0 relative">
          {mediaTab === 'movie' ? (
            <MoviePlayer
              socket={socket}
              roomId={roomId}
              movieState={movieState}
              onMovieStateChange={handleMovieStateChange}
              participants={participants}
              currentUser={userName}
              onRequestSync={handleRequestSync}
              onOpenInNewTab={handleOpenMovieNewTab}
            />
          ) : (
            <ImageViewer
              socket={socket}
              roomId={roomId}
              imageState={imageState}
              onImageStateChange={handleImageStateChange}
              currentUser={userName}
              participants={participants}
              onRequestSync={handleRequestSync}
              onOpenInNewTab={handleOpenImageNewTab}
            />
          )}
        </div>

        {/* Right / Side Area: Real-Time Chat & Voice Calls */}
        <div className="w-full lg:w-96 flex flex-col h-[38vh] lg:h-full min-h-0 gap-3 shrink-0">
          {/* Mobile Tab Switcher */}
          <div className="flex lg:hidden bg-slate-900/80 backdrop-blur-md rounded-xl p-1 border border-slate-700/50">
            <button
              onClick={() => setActiveSideTab('chat')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeSideTab === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveSideTab('voice')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeSideTab === 'voice' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Voice Lounge
            </button>
          </div>

          {/* Desktop Side-by-side or Mobile Active Tab */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`h-full flex-col min-h-0 ${activeSideTab === 'chat' ? 'flex' : 'hidden lg:flex'}`}>
              <ChatDrawer
                messages={messages}
                onSendMessage={handleSendMessage}
                currentUser={userName}
                roomId={roomId}
                socket={socket}
              />
            </div>
          </div>

          <div className={`shrink-0 ${activeSideTab === 'voice' ? 'flex' : 'hidden lg:flex'} flex-col`}>
            <VoiceCall
              socket={socket}
              roomId={roomId}
              participants={participants}
              currentUserSocketId={socket?.id || ''}
              onToggleMic={handleToggleMic}
            />
          </div>
        </div>
      </div>

      {/* Share / Invite Friends Modal */}
      {showShareModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm animate-fadeIn">
          <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-3xl p-6 sm:p-7 shadow-2xl space-y-5 text-left">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2.5">
                <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
                  <Share2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">Invite Friends to SyncSpace</h3>
                  <p className="text-xs text-slate-400">Lounge ID: <span className="font-mono font-semibold text-indigo-400">{roomId}</span></p>
                </div>
              </div>
              <button
                onClick={() => setShowShareModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-2">
              <label className="text-xs font-semibold text-slate-300">Direct Shareable Link</label>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  readOnly
                  value={getInviteLink()}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 px-3.5 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono select-all focus:outline-none focus:border-indigo-500"
                />
                <button
                  onClick={() => {
                    try { navigator.clipboard.writeText(getInviteLink()); } catch (_) {}
                    setCopiedRoom(true);
                    setTimeout(() => setCopiedRoom(false), 2000);
                  }}
                  className="px-4 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors shrink-0 shadow-md shadow-indigo-600/25"
                >
                  {copiedRoom ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
                  <span>{copiedRoom ? 'Copied!' : 'Copy'}</span>
                </button>
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-2.5 pt-1">
              <a
                href={`https://api.whatsapp.com/send?text=${encodeURIComponent(`Hey! Join my SyncSpace lounge to watch movies, view photos, and talk in sync: ${getInviteLink()}`)}`}
                target="_blank"
                rel="noreferrer"
                className="flex-1 py-2.5 px-4 rounded-xl bg-emerald-600/90 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center justify-center space-x-2 transition-colors shadow-md"
              >
                <MessageCircle className="w-4 h-4" />
                <span>Share via WhatsApp</span>
              </a>

              <button
                onClick={() => {
                  if (typeof navigator !== 'undefined' && navigator.share) {
                    navigator.share({
                      title: 'Join my SyncSpace Lounge',
                      text: `Join my SyncSpace lounge: ${roomId}`,
                      url: getInviteLink()
                    }).catch(() => {});
                  } else {
                    navigator.clipboard.writeText(getInviteLink());
                    setCopiedRoom(true);
                    setTimeout(() => setCopiedRoom(false), 2000);
                  }
                }}
                className="py-2.5 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 hover:text-white text-xs font-semibold flex items-center justify-center space-x-2 border border-slate-700 transition-colors"
              >
                <Share2 className="w-4 h-4 text-indigo-400" />
                <span>System Share</span>
              </button>
            </div>

            <div className="bg-slate-950/60 border border-slate-800/80 rounded-2xl p-3 text-[11px] text-slate-400 space-y-1">
              <p className="flex items-center gap-1.5 text-slate-300 font-medium">
                <Sparkles className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                <span>Instant Multiplayer Access:</span>
              </p>
              <p>Friends on mobile or desktop opening this link will immediately enter this synchronized lounge with shared movie playback, photo zooming, live voice chat, and real-time messaging.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
