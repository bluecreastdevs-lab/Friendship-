import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Bell, BellOff } from 'lucide-react';
import { Socket } from 'socket.io-client';
import { Message } from '../types';

/**
 * Formats a timestamp into relative time (e.g., 'just now', '45s ago', '2m ago', '1h ago', 'yesterday', etc.)
 */
function getRelativeTime(timestamp?: number | string): string {
  if (!timestamp) return '';
  const timeMs = typeof timestamp === 'number' ? timestamp : Date.parse(timestamp);
  if (isNaN(timeMs)) return '';

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
 * Returns localized time formatted in the user's browser local timezone (e.g., '10:02 PM')
 */
function getLocalTime(timestamp?: number | string, fallbackTime?: string): string {
  if (typeof timestamp === 'number' && !isNaN(timestamp)) {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }
  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp);
    if (!isNaN(parsed)) {
      return new Date(parsed).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
  }
  if (fallbackTime) {
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
  const timeMs = typeof timestamp === 'number' ? timestamp : (timestamp ? Date.parse(timestamp) : NaN);
  if (!isNaN(timeMs)) {
    return new Date(timeMs).toLocaleString();
  }
  return fallbackTime || '';
}

interface ChatDrawerProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  currentUser: string;
  roomId?: string;
  socket?: Socket | null;
}

export default function ChatDrawer({ messages, onSendMessage, currentUser, roomId, socket }: ChatDrawerProps) {
  const [input, setInput] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [typingUsers, setTypingUsers] = useState<Record<string, { userName: string; timestamp: number }>>({});
  const [, setRelativeTick] = useState(0);

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
    }, 15000);
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
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-950/50 border-b border-slate-800">
        <div className="flex items-center space-x-2">
          <MessageSquare className="w-4 h-4 text-indigo-400" />
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            SYNCSPACE LOUNGE #{roomId ? roomId.replace(/[^0-9]/g, '') || '7' : '7'}
          </h3>
        </div>
        <button
          onClick={() => setSoundEnabled(!soundEnabled)}
          className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
          title={soundEnabled ? "Mute notification chime" : "Enable notification chime"}
        >
          {soundEnabled ? <Bell className="w-4 h-4 text-indigo-400" /> : <BellOff className="w-4 h-4 text-slate-400" />}
        </button>
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {messages.map((msg) => {
          const isSystem = msg.sender === 'System';
          const isMe = msg.sender === currentUser;
          const relTime = getRelativeTime(msg.timestamp || msg.time);
          const locTime = getLocalTime(msg.timestamp, msg.time);
          const fullDate = getFullDateTime(msg.timestamp, msg.time);

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-1.5">
                <span
                  className="inline-flex items-center gap-1.5 text-[11px] px-3 py-1 bg-slate-800/80 hover:bg-slate-800 text-slate-300 rounded-full border border-slate-700/50 shadow-sm transition-colors cursor-default select-none"
                  title={fullDate}
                >
                  <span className="text-slate-300 font-medium">{msg.text}</span>
                  <span className="text-slate-500">•</span>
                  {relTime ? (
                    <>
                      <span className="text-indigo-400 font-medium">{relTime}</span>
                      {locTime && <span className="text-slate-400 text-[10px]">({locTime})</span>}
                    </>
                  ) : (
                    <span className="text-slate-400 font-medium">{locTime}</span>
                  )}
                </span>
              </div>
            );
          }

          return (
            <div
              key={msg.id}
              className={`flex flex-col ${isMe ? 'items-end' : 'items-start'}`}
            >
              <div className="flex items-center space-x-1.5 mb-1 px-1">
                <div
                  className="w-2 h-2 rounded-full"
                  style={{ backgroundColor: msg.avatarColor || '#6366f1' }}
                />
                <span className="text-xs font-semibold text-slate-300">{msg.sender}</span>
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
    </div>
  );
}
