import React, { useState } from 'react';
import { io, Socket } from 'socket.io-client';
import ThreeBackground from './components/ThreeBackground';
import VideoPlayer from './components/VideoPlayer';
import ChatDrawer from './components/ChatDrawer';
import VoiceCall from './components/VoiceCall';
import { Film, Settings, Bell } from 'lucide-react';
import { Participant, Message, MediaState } from './types';

const AVATAR_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

export default function App() {
  const [inLounge, setInLounge] = useState(false);
  const [userName, setUserName] = useState('');
  const [roomId, setRoomId] = useState('lounge-101');
  const [avatarColor, setAvatarColor] = useState(AVATAR_COLORS[0]);

  const [socket, setSocket] = useState<Socket | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [mediaState, setMediaState] = useState<MediaState>({
    isPlaying: false,
    currentTime: 0,
    mediaUrl: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4',
    mediaType: 'video',
    lastUpdated: Date.now()
  });

  const [activeTab, setActiveTab] = useState<'chat' | 'voice'>('chat');

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (!userName.trim() || !roomId.trim()) return;

    const newSocket = io();
    setSocket(newSocket);

    newSocket.emit('join-room', {
      roomId: roomId.trim(),
      name: userName.trim(),
      avatarColor
    });

    newSocket.on('room-state', (state) => {
      setMediaState(state.mediaState);
      setParticipants(state.participants);
      setMessages(state.messages);
    });

    newSocket.on('participants-update', (updatedParticipants) => {
      setParticipants(updatedParticipants);
    });

    newSocket.on('media-sync', (remoteState) => {
      setMediaState(remoteState);
    });

    newSocket.on('chat-message', (msg) => {
      setMessages((prev) => [...prev, msg]);
    });

    setInLounge(true);
  };

  const handleMediaStateChange = (updatedState: Partial<MediaState>) => {
    const nextState = { ...mediaState, ...updatedState, lastUpdated: Date.now() };
    setMediaState(nextState);
    socket?.emit('media-sync', { roomId, state: nextState });
  };

  const handleSendMessage = (text: string) => {
    socket?.emit('chat-message', {
      roomId,
      message: {
        sender: userName,
        text,
        avatarColor
      }
    });
  };

  const handleToggleMic = (isMuted: boolean) => {
    socket?.emit('toggle-mic', { roomId, isMuted });
  };

  if (!inLounge) {
    return (
      <div className="relative min-h-screen w-full flex items-center justify-center p-4 bg-slate-950 font-sans">
        <ThreeBackground />

        <div className="w-full max-w-md bg-slate-900/80 backdrop-blur-xl border border-slate-700/60 p-8 rounded-3xl shadow-2xl space-y-6">
          <div className="flex flex-col items-center space-y-2 text-center">
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center shadow-lg shadow-indigo-500/30">
              <Film className="w-7 h-7 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight">SyncSpace</h1>
            <p className="text-sm text-slate-400">Real-time synchronized media lounge & voice chat</p>
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
              <label className="text-xs font-medium text-slate-300">Room ID</label>
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
              className="w-full py-3.5 bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white font-medium rounded-xl shadow-lg shadow-indigo-600/30 transition-all transform hover:-translate-y-0.5"
            >
              Enter Lounge
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden flex flex-col bg-slate-950 font-sans p-2 lg:p-4 gap-4">
      <ThreeBackground />

      {/* Top Header Bar */}
      <header className="flex items-center justify-between px-6 py-3 bg-slate-900/90 backdrop-blur-xl border border-slate-700/60 rounded-2xl shadow-xl shrink-0">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center shadow-md">
            <Film className="w-5 h-5 text-white" />
          </div>
          <span className="text-lg font-bold tracking-wider text-white font-mono">SYNCSPACE</span>
        </div>

        <div className="flex items-center space-x-4">
          <div className="hidden sm:flex items-center space-x-2 px-3 py-1.5 bg-slate-800/80 rounded-full border border-slate-700">
            <div 
              className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-[10px]"
              style={{ backgroundColor: avatarColor }}
            >
              {userName.slice(0, 2).toUpperCase()}
            </div>
            <span className="text-xs font-medium text-slate-200">{userName}</span>
          </div>

          <div className="flex items-center space-x-2 px-3 py-1.5 bg-slate-800/80 hover:bg-slate-700/80 rounded-xl border border-slate-700 text-xs text-slate-200 cursor-pointer transition-colors">
            <Settings className="w-3.5 h-3.5 text-indigo-400" />
            <span className="font-medium">Room settings</span>
          </div>

          <div className="relative p-2 bg-slate-800/80 hover:bg-slate-700/80 rounded-xl border border-slate-750 text-slate-300 cursor-pointer transition-colors">
            <Bell className="w-4 h-4" />
            <span className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center shadow">
              1
            </span>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col lg:flex-row min-h-0 gap-4">
        {/* Left / Main Area: Video Player */}
        <div className="flex-1 flex flex-col h-[60vh] lg:h-full min-h-0">
          <VideoPlayer
            mediaState={mediaState}
            onMediaStateChange={handleMediaStateChange}
            participants={participants}
            currentUser={userName}
          />
        </div>

        {/* Right / Side Area: Chat & Voice Controls */}
        <div className="w-full lg:w-96 flex flex-col h-[38vh] lg:h-full min-h-0 gap-3">
          {/* Mobile Tab Switcher */}
          <div className="flex lg:hidden bg-slate-900/80 backdrop-blur-md rounded-xl p-1 border border-slate-700/50">
            <button
              onClick={() => setActiveTab('chat')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'chat' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Chat
            </button>
            <button
              onClick={() => setActiveTab('voice')}
              className={`flex-1 py-2 text-xs font-medium rounded-lg transition-colors ${
                activeTab === 'voice' ? 'bg-indigo-600 text-white' : 'text-slate-400 hover:text-white'
              }`}
            >
              Voice Lounge
            </button>
          </div>

          {/* Desktop Side-by-side or Mobile Active Tab */}
          <div className="flex-1 flex flex-col min-h-0">
            <div className={`h-full flex-col min-h-0 ${activeTab === 'chat' ? 'flex' : 'hidden lg:flex'}`}>
              <ChatDrawer
                messages={messages}
                onSendMessage={handleSendMessage}
                currentUser={userName}
                roomId={roomId}
              />
            </div>
          </div>

          <div className={`flex-shrink-0 ${activeTab === 'voice' ? 'flex' : 'hidden lg:flex'} flex-col`}>
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
    </div>
  );
}
