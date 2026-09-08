import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare, Bell, BellOff } from 'lucide-react';

interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  avatarColor: string;
}

interface ChatDrawerProps {
  messages: Message[];
  onSendMessage: (text: string) => void;
  currentUser: string;
  roomId?: string;
}

export default function ChatDrawer({ messages, onSendMessage, currentUser, roomId }: ChatDrawerProps) {
  const [input, setInput] = useState('');
  const [soundEnabled, setSoundEnabled] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
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

          if (isSystem) {
            return (
              <div key={msg.id} className="flex justify-center my-1">
                <span className="text-[11px] px-3 py-1 bg-slate-800/60 text-slate-400 rounded-full border border-slate-700/40">
                  {msg.text} • {msg.time}
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
                <span className="text-xs font-medium text-slate-300">{msg.sender}</span>
                <span className="text-[10px] text-slate-500">{msg.time}</span>
              </div>

              <div
                className={`max-w-[85%] px-3.5 py-2 rounded-2xl text-sm leading-relaxed ${
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

      {/* Input Box */}
      <form onSubmit={handleSubmit} className="p-3 bg-slate-950/80 border-t border-slate-800 flex items-center space-x-2">
        <input
          type="text"
          placeholder="Type a message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="flex-1 px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
        />
        <button
          type="submit"
          className="p-2.5 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl transition-colors shadow-lg"
        >
          <Send className="w-4 h-4" />
        </button>
      </form>
    </div>
  );
}
