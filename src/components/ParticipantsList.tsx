import React, { useState, useEffect } from 'react';
import { Users, Crown, Mic, MicOff, Check, ChevronDown, UserCheck, EyeOff, Radio, Palette } from 'lucide-react';
import { Participant, UserStatus } from '../types';

export const PRESET_AVATAR_COLORS = ['#6366f1', '#ec4899', '#8b5cf6', '#10b981', '#f59e0b', '#3b82f6'];

interface ParticipantsListProps {
  participants: Participant[];
  currentUser: string;
  currentUserSocketId?: string;
  onSetStatus?: (status: UserStatus | 'auto') => void;
  currentStatus?: UserStatus;
  manualOverride?: UserStatus | null;
  statusReason?: string;
  avatarColor?: string;
  onChangeAvatarColor?: (color: string) => void;
}

export function formatStatusTiming(participant: Participant, now: number): { label: string; detail: string; fullTime: string } {
  const status = participant.status || 'online';
  const refTime = participant.tabHiddenAt || participant.statusUpdatedAt || participant.joinedAt;
  const fullTime = refTime ? new Date(refTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 'Just now';
  const joinedTime = participant.joinedAt ? new Date(participant.joinedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';

  if (status === 'online') {
    return {
      label: 'Online',
      detail: joinedTime ? `Active • Joined ${joinedTime}` : 'Active in lounge',
      fullTime: joinedTime ? `Active in lounge (logged in at ${joinedTime})` : `Active now (since ${fullTime})`
    };
  }

  if (status === 'away') {
    const elapsedMs = refTime ? Math.max(0, now - refTime) : 0;
    const diffSec = Math.floor(elapsedMs / 1000);
    let timeStr = `${diffSec}s ago`;

    if (diffSec >= 60) {
      const diffMin = Math.floor(diffSec / 60);
      if (diffMin >= 60) {
        const diffHours = Math.floor(diffMin / 60);
        timeStr = `${diffHours}h ago`;
      } else {
        timeStr = `${diffMin}m ago`;
      }
    }

    const reason = participant.statusReason || (participant.tabHiddenAt ? 'Switched tab' : 'Away');
    return {
      label: 'Away',
      detail: `${reason} • ${timeStr}`,
      fullTime: joinedTime
        ? `${reason} at ${fullTime} (logged in at ${joinedTime})`
        : `${reason} at ${fullTime} (${diffSec}s elapsed)`
    };
  }

  if (status === 'busy') {
    const elapsedMs = refTime ? Math.max(0, now - refTime) : 0;
    const diffSec = Math.floor(elapsedMs / 1000);
    let timeStr = 'just now';
    if (diffSec >= 60) {
      const diffMin = Math.floor(diffSec / 60);
      timeStr = `${diffMin}m ago`;
    }

    const reason = participant.statusReason || 'Do Not Disturb';
    return {
      label: 'Busy',
      detail: `${reason} • ${timeStr}`,
      fullTime: joinedTime
        ? `${reason} since ${fullTime} (logged in at ${joinedTime})`
        : `${reason} (since ${fullTime})`
    };
  }

  return { label: 'Online', detail: joinedTime ? `Joined ${joinedTime}` : 'Active', fullTime: 'Active' };
}

export default function ParticipantsList({
  participants,
  currentUser,
  currentUserSocketId,
  onSetStatus,
  currentStatus = 'online',
  manualOverride = null,
  statusReason,
  avatarColor,
  onChangeAvatarColor
}: ParticipantsListProps) {
  const [now, setNow] = useState<number>(Date.now());
  const [showStatusMenu, setShowStatusMenu] = useState<boolean>(false);

  // Re-render every second so elapsed away/tab-switch timings update in real time with high precision
  useEffect(() => {
    const timer = setInterval(() => {
      setNow(Date.now());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  const onlineCount = participants.filter((p) => (p.status || 'online') === 'online').length;
  const awayCount = participants.filter((p) => p.status === 'away').length;
  const busyCount = participants.filter((p) => p.status === 'busy').length;

  return (
    <div className="flex flex-col h-full w-full bg-slate-900/90 text-slate-100 overflow-hidden">
      {/* Summary Chips */}
      <div className="p-3 border-b border-slate-800/80 bg-slate-950/40 shrink-0 space-y-2.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Users className="w-4 h-4 text-indigo-400" />
            <span className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Lounge Members ({participants.length})
            </span>
          </div>

          <div className="flex items-center space-x-1.5 text-[11px]">
            <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
              <span>{onlineCount} Online</span>
            </span>

            {awayCount > 0 && (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-300 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>{awayCount} Away</span>
              </span>
            )}

            {busyCount > 0 && (
              <span className="inline-flex items-center space-x-1 px-2 py-0.5 rounded-full bg-rose-500/10 border border-rose-500/20 text-rose-300 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                <span>{busyCount} Busy</span>
              </span>
            )}
          </div>
        </div>

        {/* Current User Status Controller */}
        {onSetStatus && (
          <div className="relative">
            <div className="flex items-center justify-between p-2 rounded-xl bg-slate-800/80 border border-slate-700/70 text-xs">
              <div className="flex items-center space-x-2 min-w-0">
                <div className="relative">
                  <div
                    className={`w-2.5 h-2.5 rounded-full ${
                      currentStatus === 'online'
                        ? 'bg-emerald-400 ring-2 ring-emerald-500/30'
                        : currentStatus === 'away'
                        ? 'bg-amber-400 ring-2 ring-amber-500/30'
                        : 'bg-rose-400 ring-2 ring-rose-500/30'
                    }`}
                  />
                </div>
                <div className="flex flex-col min-w-0">
                  <span className="font-semibold text-white truncate">
                    Your Status: <span className="capitalize text-indigo-300">{currentStatus}</span>
                  </span>
                  <span className="text-[10px] text-slate-400 truncate">
                    {manualOverride ? `Manually set (${statusReason || currentStatus})` : `Tab auto-detect (${statusReason || 'Active in lounge'})`}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setShowStatusMenu(!showStatusMenu)}
                className="flex items-center space-x-1 px-2.5 py-1 rounded-lg bg-slate-700/80 hover:bg-slate-700 text-slate-200 text-xs font-medium transition-colors shrink-0"
              >
                <span>Change</span>
                <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>

            {/* Status Dropdown Menu */}
            {showStatusMenu && (
              <div className="absolute top-full left-0 right-0 mt-1 z-30 bg-slate-900 border border-slate-700 rounded-xl p-1.5 shadow-2xl space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    onSetStatus('auto');
                    setShowStatusMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    manualOverride === null ? 'bg-indigo-600/20 text-indigo-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <Radio className="w-3.5 h-3.5 text-indigo-400" />
                    <div className="text-left">
                      <p>Automatic (Tab Visibility API)</p>
                      <p className="text-[10px] text-slate-400">Switches to Away after 3s when tab is hidden</p>
                    </div>
                  </div>
                  {manualOverride === null && <Check className="w-3.5 h-3.5 text-indigo-400" />}
                </button>

                <div className="border-t border-slate-800 my-1" />

                <button
                  type="button"
                  onClick={() => {
                    onSetStatus('online');
                    setShowStatusMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    manualOverride === 'online' ? 'bg-emerald-500/20 text-emerald-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                    <span>Always Online</span>
                  </div>
                  {manualOverride === 'online' && <Check className="w-3.5 h-3.5 text-emerald-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSetStatus('away');
                    setShowStatusMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    manualOverride === 'away' ? 'bg-amber-500/20 text-amber-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-amber-400" />
                    <span>Away (Be Right Back)</span>
                  </div>
                  {manualOverride === 'away' && <Check className="w-3.5 h-3.5 text-amber-400" />}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    onSetStatus('busy');
                    setShowStatusMenu(false);
                  }}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-colors ${
                    manualOverride === 'busy' ? 'bg-rose-500/20 text-rose-300 font-semibold' : 'text-slate-300 hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center space-x-2">
                    <span className="w-2.5 h-2.5 rounded-full bg-rose-400" />
                    <span>Busy (Do Not Disturb)</span>
                  </div>
                  {manualOverride === 'busy' && <Check className="w-3.5 h-3.5 text-rose-400" />}
                </button>
              </div>
            )}
          </div>
        )}

        {/* Preferred Avatar Color Selector (Saved in localStorage) */}
        {onChangeAvatarColor && (
          <div className="flex items-center justify-between px-2.5 py-2 rounded-xl bg-slate-800/60 border border-slate-700/60 text-xs">
            <div className="flex items-center space-x-1.5 text-slate-300 min-w-0">
              <Palette className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <span className="truncate">Avatar Color</span>
              <span className="hidden sm:inline text-[10px] text-slate-400">• Saved</span>
            </div>
            <div className="flex items-center space-x-1.5 shrink-0">
              {PRESET_AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onChangeAvatarColor(c)}
                  className={`w-4 h-4 rounded-full transition-transform cursor-pointer ${
                    avatarColor === c ? 'ring-2 ring-white scale-125' : 'opacity-65 hover:opacity-100'
                  }`}
                  style={{ backgroundColor: c }}
                  title={`Select avatar color: ${c} (Saved to localStorage)`}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Participants Scrollable List */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2 scrollbar-thin scrollbar-thumb-slate-700">
        {participants.map((p, idx) => {
          const isMe = p.name === currentUser || (currentUserSocketId && p.socketId === currentUserSocketId);
          const isHost = idx === 0;
          const status = p.status || 'online';
          const { label, detail, fullTime } = formatStatusTiming(p, now);

          return (
            <div
              key={p.socketId || `${p.name}-${idx}`}
              className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all ${
                isMe
                  ? 'bg-indigo-950/30 border-indigo-500/40 shadow-sm'
                  : 'bg-slate-850/60 hover:bg-slate-800/80 border-slate-800/90'
              }`}
              title={fullTime}
            >
              <div className="flex items-center space-x-3 min-w-0">
                {/* Avatar with Status Indicator Dot */}
                <div className="relative shrink-0">
                  <div
                    className="w-9 h-9 rounded-full flex items-center justify-center font-bold text-white text-xs shadow-md border-2 border-slate-800"
                    style={{ backgroundColor: p.avatarColor || '#6366f1' }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>

                  {/* Status Indicator Dot on Avatar */}
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-3.5 h-3.5 rounded-full border-2 border-slate-900 flex items-center justify-center ${
                      status === 'online'
                        ? 'bg-emerald-400'
                        : status === 'away'
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                    }`}
                    title={`Status: ${label} (${detail})`}
                  >
                    {status === 'online' && (
                      <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping opacity-75" />
                    )}
                  </span>
                </div>

                {/* Username, Host Badge & Status Info */}
                <div className="min-w-0 flex flex-col">
                  <div className="flex items-center space-x-1.5">
                    <span className="font-semibold text-xs text-white truncate max-w-[130px] sm:max-w-[170px]">
                      {p.name}
                    </span>

                    {isMe && (
                      <span className="text-[9px] px-1.5 py-0.2 rounded-md bg-indigo-500/20 border border-indigo-500/30 text-indigo-300 font-semibold uppercase tracking-wider">
                        You
                      </span>
                    )}

                    {isHost && (
                      <span
                        className="text-[9px] px-1.5 py-0.2 rounded-md bg-amber-500/20 border border-amber-500/30 text-amber-300 font-semibold flex items-center space-x-0.5"
                        title="Room Host"
                      >
                        <Crown className="w-2.5 h-2.5 text-amber-400" />
                        <span>Host</span>
                      </span>
                    )}
                  </div>

                  {/* Visual Status Text with Real-Time Timing */}
                  <div className="flex items-center space-x-1.5 text-[11px] mt-0.5">
                    {/* Status Pill Badge */}
                    <span
                      className={`inline-flex items-center space-x-1 px-1.5 py-0.2 rounded text-[10px] font-semibold tracking-tight ${
                        status === 'online'
                          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                          : status === 'away'
                          ? 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                          : 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full ${
                          status === 'online' ? 'bg-emerald-400' : status === 'away' ? 'bg-amber-400' : 'bg-rose-400'
                        }`}
                      />
                      <span>{label}</span>
                    </span>

                    {/* Precise Dynamic Timing */}
                    <span className="text-[10px] text-slate-400 truncate max-w-[140px] sm:max-w-[180px]">
                      {detail}
                    </span>
                  </div>
                </div>
              </div>

              {/* Right Side Mic and Indicators */}
              <div className="flex items-center space-x-1.5 shrink-0 pl-2">
                {p.tabHiddenAt && status === 'away' && (
                  <span
                    className="hidden sm:flex items-center space-x-1 text-[10px] text-amber-400 bg-amber-500/10 px-1.5 py-0.5 rounded border border-amber-500/20"
                    title="User switched browser tab or minimized window"
                  >
                    <EyeOff className="w-3 h-3" />
                    <span>Tab switched</span>
                  </span>
                )}

                <div
                  className={`p-1.5 rounded-lg ${
                    p.isMuted
                      ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                      : 'bg-slate-800 text-slate-400'
                  }`}
                  title={p.isMuted ? 'Microphone Muted' : 'Microphone Ready'}
                >
                  {p.isMuted ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5 text-emerald-400" />}
                </div>
              </div>
            </div>
          );
        })}

        {participants.length === 0 && (
          <div className="flex flex-col items-center justify-center p-8 text-center text-slate-400 space-y-2">
            <UserCheck className="w-8 h-8 text-slate-500 stroke-1" />
            <p className="text-xs font-medium">Connecting to lounge members...</p>
          </div>
        )}
      </div>

      {/* Footer Info on Visibility Detection */}
      <div className="p-2.5 bg-slate-950/80 border-t border-slate-800/80 text-[10px] text-slate-400 flex items-center justify-between shrink-0">
        <span className="flex items-center space-x-1">
          <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
          <span>Visibility Change API Active</span>
        </span>
        <span className="text-slate-500 font-mono">3s switch grace • 60s idle</span>
      </div>
    </div>
  );
}
