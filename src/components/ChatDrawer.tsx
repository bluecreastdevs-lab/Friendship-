import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Bell, BellOff, Users } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { Message, Participant, UserStatus } from '../types';
import ParticipantsList from './ParticipantsList';

/**
 * Formats a timestamp into relative time (e.g., 'just now', '45s ago', '2m ago', '1h ago', 'yesterday', etc.)
 */
function getRelativeTime(timestamp?: number | string): string {
  if (!timestamp) return '';
  let timeMs: number = NaN;
  if (typeof timestamp === 'number' && !isNaN(timestamp) && timestamp > 0) {
    timeMs = timestamp;
  } else if (typeof timestamp === 'string') {
    const num = Number(timestamp);
    if (!isNaN(num) && num > 0) {
      timeMs = num;
    } else {
      timeMs = Date.parse(timestamp);
    }
  }
  if (isNaN(timeMs) || timeMs <= 0) return '';

  const diffMs = Date.now() - timeMs;
  if (diffMs < 0) return 'just now';

  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 15) return 'just now';
  if (diffSec < 60) return `${diffSec}s ago`;

  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;

  const diffHours = Math.floor(diffMin / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;

  return new Date(timeMs).toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/**
 * Returns localized time formatted in the user's browser local timezone (e.g., '07:17 AM' or '10:02 PM')
 */
function getLocalTime(timestamp?: number | string, fallbackTime?: string): string {
  if (typeof timestamp === 'number' && !isNaN(timestamp) && timestamp > 0) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof timestamp === 'string') {
    const num = Number(timestamp);
    if (!isNaN(num) && num > 0) {
      return new Date(num).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const parsed = Date.parse(timestamp);
    if (!isNaN(parsed)) {
      return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  if (fallbackTime) {
    const numFallback = Number(fallbackTime);
    if (!isNaN(numFallback) && numFallback > 0) {
      return new Date(numFallback).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    const parsedFallback = Date.parse(fallbackTime);
    if (!isNaN(parsedFallback)) {
      return new Date(parsedFallback).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return fallbackTime;
  }
  return '';
}

/**
 * Returns full date and time string for hover tooltips
 */
function getFullDateTime(timestamp?: number | string, fallbackTime?: string): string {
  let timeMs: number = NaN;
  if (typeof timestamp === 'number' && !isNaN(timestamp) && timestamp > 0) {
    timeMs = timestamp;
  } else if (typeof timestamp === 'string') {
    const num = Number(timestamp);
    if (!isNaN(num) && num > 0) {
      timeMs = num;
    } else {
      timeMs = Date.parse(timestamp);
    }
  }

  if (isNaN(timeMs) && fallbackTime) {
    const num = Number(fallbackTime);
    if (!isNaN(num) && num > 0) {
      timeMs = num;
    } else {
      timeMs = Date.parse(fallbackTime);
    }
  }

  if (!isNaN(timeMs)) {
    return new Date(timeMs).toLocaleString([], {
      dateStyle: 'medium',
      timeStyle: 'medium'
    });
  }
  return fallbackTime || '';
}

interface ChatDrawerProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  currentUser: string;
  roomId?: string;
  socket?: Socket | null;
  participants?: Participant[];
  onSetStatus?: (status: UserStatus | 'auto') => void;
  currentStatus?: UserStatus;
  manualOverride?: UserStatus | null;
  statusReason?: string;
  activeDrawerTab?: 'chat' | 'members';
  onTabChange?: (tab: 'chat' | 'members') => void;
  avatarColor?: string;
  onChangeAvatarColor?: (color: string) => void;
}

export default function ChatDrawer({
  messages,
  onSendMessage,
  currentUser,
  roomId,
  socket,
  participants = [],
  onSetStatus,
  currentStatus = 'online',
  manualOverride = null,
  statusReason,
  activeDrawerTab,
  onTabChange,
  avatarColor,
  onChangeAvatarColor
}: ChatDrawerProps) {
  const [input, setInput] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Record<string, { userName: string; timestamp: number }>>({});
  const [, setRelativeTick] = useState(0);
  const [localTab, setLocalTab] = useState<'chat' | 'members'>('chat');

  const activeTab = activeDrawerTab !== undefined ? activeDrawerTab : localTab;
  const setActiveTab = (tab: 'chat' | 'members') => {
    setLocalTab(tab);
    if (onTabChange) onTabChange(tab);
  };

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const typingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const isTypingActiveRef = useRef<boolean>(false);

  // Helper to emit typing state to server
  const emitTypingStatus = (isTyping: boolean) => {
    if (!socket || !roomId) return;
    if (isTypingActiveRef.current !== isTyping) {
      isTypingActiveRef.current = isTyping;
      socket.emit('typing', {
        roomId,
        userName: currentUser,
        isTyping
      });
    }
  };

  // Socket listener for real-time typing events from other users
  useEffect(() => {
    if (!socket) return;

    const handleUserTyping = (data: { socketId: string; userName: string; isTyping: boolean }) => {
      // Ignore typing notifications from ourselves
      if (data.socketId === socket.id || data.userName === currentUser) return;

      setTypingUsers((prev) => {
        const next = { ...prev };
        if (data.isTyping) {
          next[data.socketId] = {
            userName: data.userName,
            timestamp: Date.now()
          };
        } else {
          delete next[data.socketId];
        }
        return next;
      });
    };

    socket.on('user-typing', handleUserTyping);

    return () => {
      socket.off('user-typing', handleUserTyping);
    };
  }, [socket, currentUser]);

  // Clean up stale typing indicators (e.g. if a disconnect packet was missed)
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now();
      setTypingUsers((prev) => {
        let hasExpired = false;
        const next = { ...prev };
        for (const [id, user] of Object.entries(next)) {
          if (now - user.timestamp > 3500) {
            delete next[id];
            hasExpired = true;
          }
        }
        return hasExpired ? next : prev;
      });
    }, 1500);

    return () => clearInterval(interval);
  }, []);

  // Live timer to refresh relative timestamps (e.g., 'just now' -> '1m ago')
  useEffect(() => {
    const interval = setInterval(() => {
      setRelativeTick((prev) => prev + 1);
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Cleanup typing status when component unmounts or room changes
  useEffect(() => {
    return () => {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      emitTypingStatus(false);
    };
  }, [roomId]);

  // Initialize Web Audio API synth chime
  const playChime = () => {
    if (!soundEnabled) return;
    try {
      if (!audioCtxRef.current) {
        audioCtxRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === 'suspended') {
        ctx.resume();
      }

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5 note
      osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15); // A5 note

      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } catch {
      // Audio context might be restricted before user gesture
    }
  };

  // Play chime on new message if from someone else
  useEffect(() => {
    if (messages.length > 0) {
      const last = messages[messages.length - 1];
      if (last.sender !== currentUser && last.sender !== 'System') {
        playChime();
      }
    }
  }, [messages.length]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Derive list of distinct active typers
  const activeTypingNames = Object.values(typingUsers)
    .map((u) => u.userName)
    .filter(Boolean);

  useEffect(() => {
    if (activeTypingNames.length > 0) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [activeTypingNames.length]);

  let typingText = '';
  if (activeTypingNames.length === 1) {
    typingText = `${activeTypingNames[0]} is typing...`;
  } else if (activeTypingNames.length === 2) {
    typingText = `${activeTypingNames[0]} and ${activeTypingNames[1]} are typing...`;
  } else if (activeTypingNames.length > 2) {
    typingText = `${activeTypingNames[0]} and ${activeTypingNames.length - 1} others are typing...`;
  }

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInput(val);

    if (val.trim().length > 0) {
      emitTypingStatus(true);
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      typingTimeoutRef.current = setTimeout(() => {
        emitTypingStatus(false);
      }, 2500);
    } else {
      if (typingTimeoutRef.current) {
        clearTimeout(typingTimeoutRef.current);
      }
      emitTypingStatus(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    emitTypingStatus(false);
    onSendMessage(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full w-full bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-700/50 overflow-hidden shadow-2xl">
      {/* Header with Chat / Members Tab Navigation */}
      <div className="flex items-center justify-between px-3 py-2 bg-slate-950/60 border-b border-slate-800">
        <div className="flex items-center space-x-1 bg-slate-900/90 p-1 rounded-xl border border-slate-800">
          <button
            type="button"
            onClick={() => setActiveTab('chat')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'chat'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Chat</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('members')}
            className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === 'members'
                ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Users className="w-3.5 h-3.5" />
            <span>Members</span>
            <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono">
              {participants.length}
            </span>
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse ml-0.5" />
          </button>
        </div>

        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            title={soundEnabled ? "Mute notification chime" : "Enable notification chime"}
          >
            {soundEnabled ? <Bell className="w-4 h-4 text-indigo-400" /> : <BellOff className="w-4 h-4 text-slate-400" />}
          </button>
        </div>
      </div>

      {/* Main Drawer Body: Members Tab OR Chat Messages Feed */}
      {activeTab === 'members' ? (
        <div className="flex-1 min-h-0 flex flex-col">
          <ParticipantsList
            participants={participants}
            currentUser={currentUser}
            currentUserSocketId={socket?.id}
            onSetStatus={onSetStatus}
            currentStatus={currentStatus}
            manualOverride={manualOverride}
            statusReason={statusReason}
            avatarColor={avatarColor}
            onChangeAvatarColor={onChangeAvatarColor}
          />
        </div>
      ) : (
        <>
          {/* Messages Feed */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((msg) => {
              const isSystem = msg.sender === 'System';
              const isMe = msg.sender === currentUser;
              const relTime = getRelativeTime(msg.timestamp || msg.time);
              const locTime = getLocalTime(msg.timestamp, msg.time);
              const fullDate = getFullDateTime(msg.timestamp, msg.time);

              if (isSystem) {
                const lowerText = (msg.text || '').toLowerCase();
                const isJoin = lowerText.includes('joined');
                const isLeave = lowerText.includes('left');

                return (
                  <div key={msg.id} className="flex justify-center my-1.5 px-2">
                    <span
                      className={`inline-flex items-center gap-1.5 text-[11px] px-3 py-1 rounded-full border shadow-sm transition-colors cursor-default select-none ${
                        isJoin
                          ? 'bg-emerald-950/50 text-emerald-300 border-emerald-500/30'
                          : isLeave
                          ? 'bg-rose-950/50 text-rose-300 border-rose-500/30'
                          : 'bg-slate-800/80 text-slate-300 border-slate-700/50'
                      }`}
                      title={fullDate ? `Exact time: ${fullDate}` : undefined}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          isJoin
                            ? 'bg-emerald-400 animate-pulse'
                            : isLeave
                            ? 'bg-rose-400'
                            : 'bg-slate-400'
                        }`}
                      />
                      <span className="font-medium">{msg.text}</span>
                      <span className="opacity-40">•</span>
                      {locTime && (
                        <span className="font-mono font-semibold text-slate-200">
                          {locTime}
                        </span>
                      )}
                      {relTime && relTime !== 'just now' && (
                        <span className="text-slate-400 text-[10px]">
                          ({relTime})
                        </span>
                      )}
                      {relTime === 'just now' && (
                        <span className="text-emerald-400 font-medium text-[10px]">
                          (just now)
                        </span>
                      )}
                    </span>
                  </div>
                );
              }

              const senderParticipant = participants.find((p) => p.name === msg.sender);
              const senderStatus = senderParticipant?.status || 'online';

              return (
                <div
                  key={msg.id}
                  className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
                >
                  <div className="flex items-center space-x-1.5 mb-1 px-1">
                    <div className="relative">
                      <div
                        className="w-2.5 h-2.5 rounded-full"
                        style={{ backgroundColor: msg.avatarColor || '#6366f1' }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-300">{msg.sender}</span>

                    {/* Status Dot next to username in chat */}
                    <span
                      className={`w-2 h-2 rounded-full shrink-0 ${
                        senderStatus === 'online'
                          ? 'bg-emerald-400 ring-1 ring-emerald-400/40'
                          : senderStatus === 'away'
                          ? 'bg-amber-400 ring-1 ring-amber-400/40'
                          : 'bg-rose-400 ring-1 ring-rose-400/40'
                      }`}
                      title={
                        senderParticipant
                          ? `${senderParticipant.name} is ${senderStatus.toUpperCase()} (${
                              senderParticipant.statusReason || (senderStatus === 'online' ? 'Active' : 'Away')
                            })`
                          : `${msg.sender} (${senderStatus})`
                      }
                    />

                    <span
                      className="text-[10px] text-slate-400 cursor-default flex items-center gap-1 font-mono tracking-tight"
                      title={fullDate}
                    >
                      {relTime ? (
                        <>
                          <span className="text-indigo-300 font-medium">{relTime}</span>
                          {locTime && (
                            <span className="text-slate-500 font-normal font-sans">({locTime})</span>
                          )}
                        </>
                      ) : (
                        <span className="text-slate-400 font-sans">{locTime}</span>
                      )}
                    </span>
                  </div>

                  <div
                    className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed shadow-sm ${
                      isMe
                        ? 'bg-indigo-600 text-white rounded-br-sm'
                        : 'bg-slate-800 text-slate-200 rounded-bl-sm border border-slate-700/60'
                    }`}
                  >
                    {msg.text}
                  </div>
                </div>
              );
            })}
            <div ref={messagesEndRef} />
          </div>

          {/* Real-Time 'Is Typing...' Indicator */}
          {activeTypingNames.length > 0 && (
            <div
              id="chat-typing-indicator"
              className="px-4 py-2 bg-slate-950/70 border-t border-slate-800/80 flex items-center space-x-2 text-xs text-indigo-300 select-none animate-fadeIn transition-all duration-200"
            >
              <div className="flex items-center space-x-1">
                <span
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                  style={{ animationDuration: '800ms', animationDelay: '0ms' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                  style={{ animationDuration: '800ms', animationDelay: '150ms' }}
                />
                <span
                  className="w-1.5 h-1.5 rounded-full bg-indigo-400 animate-bounce"
                  style={{ animationDuration: '800ms', animationDelay: '300ms' }}
                />
              </div>
              <span className="font-medium italic tracking-wide">{typingText}</span>
            </div>
          )}

          {/* Input Box */}
          <form onSubmit={handleSubmit} className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center space-x-2">
            <input
              type="text"
              placeholder="Type a message..."
              value={input}
              onChange={handleInputChange}
              className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              type="submit"
              className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors shadow-lg active:scale-95"
            >
              <Send className="w-4 h-4" />
            </button>
          </form>
        </>
      )}
    </div>
  );
}
