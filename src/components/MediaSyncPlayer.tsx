import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Socket } from 'socket.io-client';
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Upload,
  Link as LinkIcon,
  RotateCcw,
  RotateCw,
  Sparkles,
  Film,
  ZoomIn,
  ZoomOut,
  RefreshCw,
  X,
  Loader2,
  Image as ImageIcon,
  Radio
} from 'lucide-react';
import { Participant, MediaState, MediaActionPayload } from '../types';
import { MEDIA_PRESETS, MediaPreset } from '../presets';

export interface MediaSyncPlayerProps {
  socket: Socket | null;
  roomId: string;
  roomState: MediaState;
  onMediaStateChange: (state: Partial<MediaState>) => void;
  participants: Participant[];
  currentUser: string;
  onRequestSync?: () => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function MediaSyncPlayer({
  socket,
  roomId,
  roomState,
  onMediaStateChange,
  participants,
  currentUser,
  onRequestSync
}: MediaSyncPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Anti-loop lock flag: prevents incoming remote socket events from re-triggering outgoing socket packets
  const isRemoteAction = useRef<boolean>(false);

  // Local UI & playback states
  const [displayTime, setDisplayTime] = useState<number>(roomState.currentTime || 0);
  const [duration, setDuration] = useState<number>(roomState.duration || 100);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const [isMutedLocal, setIsMutedLocal] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

  // Image viewer zoom state
  const [imageZoom, setImageZoom] = useState<number>(1);

  // Upload & modal states
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPresetsModal, setShowPresetsModal] = useState<boolean>(false);
  const [showUrlModal, setShowUrlModal] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isResyncing, setIsResyncing] = useState<boolean>(false);

  // Determine if this user is the room host (first participant in room)
  const isHost = participants.length > 0 && participants[0].socketId === socket?.id;

  // Broadcast standardized media_action packet to Socket.io
  const broadcastMediaAction = useCallback(
    (
      type: 'play' | 'pause' | 'seek' | 'change_media' | 'heartbeat' | 'image_view',
      overrides?: Partial<MediaActionPayload>
    ) => {
      // Guard against echo-loops
      if (isRemoteAction.current) return;

      const el = videoRef.current;
      const isImage = (overrides?.mediaType || roomState.mediaType) === 'image';
      const currentTime = isImage
        ? 0
        : typeof overrides?.currentTime === 'number'
        ? overrides.currentTime
        : el ? el.currentTime : roomState.currentTime;

      const isPlaying = isImage
        ? false
        : type === 'play'
        ? true
        : type === 'pause'
        ? false
        : (overrides?.isPlaying ?? roomState.isPlaying);

      const resolvedZoom = typeof overrides?.imageZoom === 'number' ? overrides.imageZoom : imageZoom;

      const packet: MediaActionPayload = {
        roomId,
        mediaUrl: overrides?.mediaUrl || roomState.mediaUrl,
        mediaType: overrides?.mediaType || roomState.mediaType,
        type,
        currentTime,
        isPlaying,
        serverTimestamp: Date.now(),
        mediaTitle: overrides?.mediaTitle || roomState.mediaTitle,
        uploadedBy: overrides?.uploadedBy || roomState.uploadedBy || currentUser,
        imageZoom: resolvedZoom
      };

      socket?.emit('media_action', packet);

      onMediaStateChange({
        ...overrides,
        currentTime,
        isPlaying,
        imageZoom: resolvedZoom,
        lastUpdated: Date.now()
      });
    },
    [socket, roomId, roomState, currentUser, imageZoom, onMediaStateChange]
  );

  // Sync image zoom changes across all connected devices
  const handleImageZoomChange = (newZoom: number) => {
    const clamped = Math.max(0.5, Math.min(3, Math.round(newZoom * 100) / 100));
    setImageZoom(clamped);
    broadcastMediaAction('image_view', { imageZoom: clamped });
  };

  // Socket listener for standardized media_action and room-state broadcasts
  useEffect(() => {
    if (!socket) return;

    const handleRoomState = (payload: any) => {
      const state = payload.roomState || payload.mediaState;
      if (!state) return;
      isRemoteAction.current = true;

      onMediaStateChange(state);
      if (typeof state.imageZoom === 'number') {
        setImageZoom(state.imageZoom);
      }

      const el = videoRef.current;
      if (el && state.mediaType !== 'image') {
        const transitLatency = state.isPlaying
          ? Math.max(0, (Date.now() - (state.serverTimestamp || state.lastUpdated || Date.now())) / 1000)
          : 0;
        const targetTime = state.currentTime + (transitLatency < 10 ? transitLatency : 0);

        try {
          el.currentTime = targetTime;
          setDisplayTime(targetTime);
        } catch (_) {}

        if (state.isPlaying) {
          el.play().catch((err: any) => {
            if (err?.name === 'NotAllowedError') {
              el.muted = true;
              setIsMutedLocal(true);
              setAutoplayBlocked(true);
              el.play().catch(() => {});
            }
          });
        } else {
          el.pause();
        }
      }

      setTimeout(() => {
        isRemoteAction.current = false;
      }, 500);
    };

    const handleMediaAction = (packet: MediaActionPayload) => {
      // Ignore packets sent by ourselves if looped back
      if (packet.senderId && packet.senderId === socket.id) return;

      // Lock anti-loop flag before updating local player
      isRemoteAction.current = true;

      // Synchronized Image Zoom Action
      if (packet.type === 'image_view' || packet.mediaType === 'image') {
        if (typeof packet.imageZoom === 'number') {
          setImageZoom(packet.imageZoom);
        }
        if (packet.type === 'change_media') {
          onMediaStateChange({
            mediaUrl: packet.mediaUrl,
            mediaType: 'image',
            currentTime: 0,
            isPlaying: false,
            mediaTitle: packet.mediaTitle,
            uploadedBy: packet.uploadedBy,
            imageZoom: packet.imageZoom ?? 1,
            lastUpdated: packet.serverTimestamp
          });
          setImageZoom(packet.imageZoom ?? 1);
        }
        setTimeout(() => {
          isRemoteAction.current = false;
        }, 300);
        return;
      }

      // Media source change (movie, photo, or audio)
      if (packet.type === 'change_media') {
        onMediaStateChange({
          mediaUrl: packet.mediaUrl,
          mediaType: packet.mediaType,
          currentTime: packet.currentTime || 0,
          isPlaying: packet.isPlaying ?? true,
          mediaTitle: packet.mediaTitle,
          uploadedBy: packet.uploadedBy,
          imageZoom: 1,
          lastUpdated: packet.serverTimestamp
        });
        setImageZoom(1);
        setDisplayTime(0);

        setTimeout(() => {
          isRemoteAction.current = false;
        }, 500);
        return;
      }

      const el = videoRef.current;
      if (!el) {
        isRemoteAction.current = false;
        return;
      }

      // Latency compensation for video/audio playhead
      const transitLatency = Math.max(0, (Date.now() - (packet.serverTimestamp || Date.now())) / 1000);
      const targetTime = packet.isPlaying && transitLatency < 10
        ? packet.currentTime + transitLatency
        : packet.currentTime;

      if (packet.type === 'play') {
        if (Math.abs(el.currentTime - targetTime) > 0.4) {
          try {
            el.currentTime = targetTime;
            setDisplayTime(targetTime);
          } catch (_) {}
        }
        el.play().catch((err: any) => {
          if (err?.name === 'NotAllowedError') {
            el.muted = true;
            setIsMutedLocal(true);
            setAutoplayBlocked(true);
            el.play().catch(() => {});
          }
        });
        onMediaStateChange({ isPlaying: true, currentTime: targetTime });
      } else if (packet.type === 'pause') {
        el.pause();
        try {
          el.currentTime = targetTime;
          setDisplayTime(targetTime);
        } catch (_) {}
        onMediaStateChange({ isPlaying: false, currentTime: targetTime });
      } else if (packet.type === 'seek' || packet.type === 'heartbeat') {
        // Drift adjustment: update currentTime if drift exceeds 0.4s and user is not scrubbing
        if (Math.abs(el.currentTime - targetTime) > 0.4 && !isSeeking) {
          try {
            el.currentTime = targetTime;
            setDisplayTime(targetTime);
          } catch (_) {}
          onMediaStateChange({ currentTime: targetTime });
        }

        // Ensure playback state matches heartbeat packet
        if (packet.isPlaying && el.paused && !isSeeking) {
          el.play().catch((err: any) => {
            if (err?.name === 'NotAllowedError') {
              el.muted = true;
              setIsMutedLocal(true);
              setAutoplayBlocked(true);
              el.play().catch(() => {});
            }
          });
        } else if (!packet.isPlaying && !el.paused) {
          el.pause();
        }
      }

      setTimeout(() => {
        isRemoteAction.current = false;
      }, 400);
    };

    socket.on('media_action', handleMediaAction);
    socket.on('room_state', handleRoomState);
    socket.on('room-state', handleRoomState);

    return () => {
      socket.off('media_action', handleMediaAction);
      socket.off('room_state', handleRoomState);
      socket.off('room-state', handleRoomState);
    };
  }, [socket, onMediaStateChange, isSeeking]);

  // Periodic Sync Heartbeat: Host broadcasts sync heartbeat every 3 seconds during playback
  useEffect(() => {
    if (!socket || roomState.mediaType === 'image' || !roomState.isPlaying) {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
      return;
    }

    if (isHost) {
      heartbeatTimerRef.current = setInterval(() => {
        const el = videoRef.current;
        if (el && !el.paused && !isRemoteAction.current && !isSeeking) {
          broadcastMediaAction('heartbeat', {
            currentTime: el.currentTime,
            isPlaying: true
          });
        }
      }, 3000);
    }

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
        heartbeatTimerRef.current = null;
      }
    };
  }, [socket, isHost, roomState.isPlaying, roomState.mediaType, isSeeking, broadcastMediaAction]);

  // Handle Play/Pause button click
  const handlePlayPause = () => {
    if (roomState.mediaType === 'image') return;
    const el = videoRef.current;
    if (!el) return;

    if (el.paused) {
      el.play()
        .then(() => {
          setAutoplayBlocked(false);
          broadcastMediaAction('play', { currentTime: el.currentTime, isPlaying: true });
        })
        .catch((err) => {
          if (err?.name === 'NotAllowedError') {
            el.muted = true;
            setIsMutedLocal(true);
            setAutoplayBlocked(true);
            el.play().then(() => {
              broadcastMediaAction('play', { currentTime: el.currentTime, isPlaying: true });
            });
          }
        });
    } else {
      el.pause();
      broadcastMediaAction('pause', { currentTime: el.currentTime, isPlaying: false });
    }
  };

  // Jump forward or backward by seconds
  const handleTimeShift = (seconds: number) => {
    if (roomState.mediaType === 'image') return;
    const el = videoRef.current;
    if (!el) return;

    const newTime = Math.max(0, Math.min(duration, el.currentTime + seconds));
    el.currentTime = newTime;
    setDisplayTime(newTime);

    broadcastMediaAction('seek', {
      currentTime: newTime,
      isPlaying: !el.paused
    });
  };

  // Scrubbing range input
  const handleSeekInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    setIsSeeking(true);
    setDisplayTime(time);
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  // Commit seek on release
  const handleSeekCommit = () => {
    const el = videoRef.current;
    if (!el) {
      setIsSeeking(false);
      return;
    }

    broadcastMediaAction('seek', {
      currentTime: el.currentTime,
      isPlaying: !el.paused
    });

    setTimeout(() => {
      setIsSeeking(false);
    }, 150);
  };

  // Timeupdate handler for UI timeline
  const handleTimeUpdate = () => {
    const el = videoRef.current;
    if (!el) return;
    if (!isSeeking) {
      setDisplayTime(el.currentTime);
    }
  };

  // Metadata loaded (sets duration and aligns initial playhead)
  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (!el) return;

    if (el.duration && !isNaN(el.duration)) {
      setDuration(el.duration);
    }

    const latency = Math.max(0, (Date.now() - (roomState.lastUpdated || Date.now())) / 1000);
    const target = roomState.isPlaying && latency < 15
      ? roomState.currentTime + latency
      : roomState.currentTime;

    try {
      el.currentTime = target;
      setDisplayTime(target);
    } catch (_) {}

    if (roomState.isPlaying) {
      el.play().catch((err: any) => {
        if (err?.name === 'NotAllowedError') {
          el.muted = true;
          setIsMutedLocal(true);
          setAutoplayBlocked(true);
          el.play().catch(() => {});
        }
      });
    } else {
      el.pause();
    }
  };

  // Upload movie or photo (Client-side object URL for Netlify / static hosting compatibility)
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadError(null);
    setUploadProgressMsg(`Loading ${file.name}...`);

    try {
      const fileUrl = URL.createObjectURL(file);
      const isImg = file.type.startsWith('image/');
      const mediaType = isImg ? 'image' : 'video';

      broadcastMediaAction('change_media', {
        mediaUrl: fileUrl,
        mediaType: mediaType,
        mediaTitle: file.name,
        currentTime: 0,
        isPlaying: mediaType !== 'image',
        uploadedBy: currentUser
      });

      setImageZoom(1);
    } catch (err: any) {
      console.error('File load error:', err);
      setUploadError('Failed to load file. Please try a different media file or choose a preset.');
    } finally {
      setIsUploading(false);
      setUploadProgressMsg('');
      e.target.value = '';
    }
  };

  // URL Submission
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;

    const url = urlInput.trim();
    let type: 'video' | 'audio' | 'image' = 'video';
    if (url.match(/\.(mp3|wav|ogg|m4a|aac)$/i) || url.includes('audio')) {
      type = 'audio';
    } else if (url.match(/\.(jpeg|jpg|png|gif|webp|svg|bmp)$/i) || url.includes('image')) {
      type = 'image';
    }

    const title = url.split('/').pop()?.split('?')[0] || 'Web Media Stream';

    broadcastMediaAction('change_media', {
      mediaUrl: url,
      mediaType: type,
      mediaTitle: title,
      currentTime: 0,
      isPlaying: type !== 'image',
      uploadedBy: currentUser
    });

    setImageZoom(1);
    setUrlInput('');
    setShowUrlModal(false);
  };

  // Select Preset Media
  const handleSelectPreset = (preset: MediaPreset) => {
    broadcastMediaAction('change_media', {
      mediaUrl: preset.url,
      mediaType: preset.category === 'movie' ? 'video' : preset.category === 'image' ? 'image' : 'audio',
      mediaTitle: preset.title,
      currentTime: 0,
      isPlaying: preset.category !== 'image',
      uploadedBy: currentUser
    });

    setImageZoom(1);
    setShowPresetsModal(false);
  };

  // Manual Resync Trigger
  const handleTriggerResync = () => {
    setIsResyncing(true);
    if (onRequestSync) {
      onRequestSync();
    } else {
      socket?.emit('request-sync', { roomId });
    }
    setTimeout(() => setIsResyncing(false), 800);
  };

  const currentTitle = roomState.mediaTitle || (
    roomState.mediaUrl.includes('BigBuckBunny')
      ? 'Big Buck Bunny (Animated Classic)'
      : roomState.mediaUrl.split('/').pop()?.split('?')[0] || 'Synchronized Media'
  );

  return (
    <div
      ref={containerRef}
      className="flex flex-col h-full w-full bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-700/60 overflow-hidden shadow-2xl p-4"
    >
      {/* Top Action Bar */}
      <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
        <div className="flex items-center space-x-2">
          <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
            {roomState.mediaType === 'image' ? 'SHARED PHOTO LOUNGE' : 'WATCHING IN SYNC'}
          </span>

          {/* Sync Status Badge */}
          <button
            onClick={handleTriggerResync}
            className="flex items-center space-x-1 px-2.5 py-0.5 rounded-full bg-emerald-950/80 border border-emerald-600/50 text-[10px] font-medium text-emerald-400 hover:bg-emerald-900/80 transition-colors shadow-sm"
            title="Click to force resync with lounge"
          >
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
            <span>Synced</span>
            <RefreshCw className={`w-2.5 h-2.5 ml-0.5 ${isResyncing ? 'animate-spin' : ''}`} />
          </button>

          {/* Host indicator */}
          {isHost && (
            <span className="flex items-center space-x-1 px-2 py-0.5 rounded-full bg-indigo-950/80 border border-indigo-600/50 text-[10px] font-medium text-indigo-300">
              <Radio className="w-2.5 h-2.5 text-indigo-400" />
              <span>Room Host (Heartbeat Active)</span>
            </span>
          )}
        </div>

        {/* Media Selection Actions */}
        <div className="flex items-center space-x-2">
          {/* Quick Presets Library Button */}
          <button
            onClick={() => setShowPresetsModal(true)}
            className="flex items-center space-x-1.5 px-3 py-1.5 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-semibold rounded-xl shadow-md transition-transform hover:scale-105 active:scale-95"
          >
            <Sparkles className="w-3.5 h-3.5 text-yellow-300" />
            <span>Library</span>
          </button>

          {/* Upload Media / Photo */}
          <label className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl cursor-pointer transition-colors border border-slate-700 shadow-sm">
            <Upload className="w-3.5 h-3.5 text-indigo-400" />
            <span>Upload File</span>
            <input
              type="file"
              accept="video/*,image/*,audio/*"
              onChange={handleFileUpload}
              className="hidden"
              disabled={isUploading}
            />
          </label>

          {/* URL Input */}
          <button
            onClick={() => setShowUrlModal(true)}
            className="flex items-center space-x-1 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition-colors border border-slate-700"
            title="Load media via web link"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span>URL</span>
          </button>
        </div>
      </div>

      {/* Uploading Status Banner */}
      {isUploading && (
        <div className="mb-2 px-3 py-2 bg-indigo-950/80 border border-indigo-500/50 rounded-xl flex items-center space-x-3 text-indigo-200 text-xs animate-pulse">
          <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
          <span>{uploadProgressMsg}</span>
        </div>
      )}

      {/* Upload Error Banner */}
      {uploadError && (
        <div className="mb-2 px-3 py-2 bg-red-950/80 border border-red-500/50 rounded-xl flex items-center justify-between text-red-200 text-xs">
          <span>{uploadError}</span>
          <button onClick={() => setUploadError(null)} className="p-1 hover:text-white">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Autoplay blocked banner */}
      {autoplayBlocked && (
        <div
          onClick={() => {
            if (videoRef.current) {
              videoRef.current.muted = false;
              setIsMutedLocal(false);
            }
            setAutoplayBlocked(false);
          }}
          className="mb-2 px-3 py-2 bg-amber-950/80 border border-amber-500/50 rounded-xl flex items-center justify-between text-amber-200 text-xs cursor-pointer hover:bg-amber-900/80 transition-colors"
        >
          <div className="flex items-center space-x-2">
            <VolumeX className="w-4 h-4 text-amber-400" />
            <span>Audio muted by browser autoplay policy. <strong>Click here to unmute</strong>.</span>
          </div>
          <span className="px-2 py-0.5 bg-amber-500/30 rounded text-[10px] font-bold">UNMUTE</span>
        </div>
      )}

      {/* Media Viewport / Stage */}
      <div className="relative flex-1 bg-black rounded-xl flex items-center justify-center overflow-hidden group shadow-inner border border-slate-800 select-none">
        {roomState.mediaType === 'image' ? (
          // Photo Viewer Mode: Interactive image viewer frame synchronized across all connected users
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950 overflow-hidden">
            <img
              src={roomState.mediaUrl}
              alt={currentTitle}
              style={{ transform: `scale(${imageZoom})` }}
              className="max-w-full max-h-full object-contain transition-transform duration-200 ease-out"
            />

            {/* Photo Top Badge */}
            <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/70 shadow-lg pointer-events-none">
              <div className="flex items-center space-x-2">
                <ImageIcon className="w-4 h-4 text-indigo-400" />
                <h2 className="text-xs font-bold text-white tracking-wide truncate max-w-[280px]">
                  {currentTitle}
                </h2>
              </div>
            </div>

            {/* Photo Zoom Controls */}
            <div className="absolute bottom-4 right-4 flex items-center space-x-2 bg-slate-900/85 backdrop-blur-md p-1.5 rounded-xl border border-slate-700/70 shadow-xl">
              <button
                onClick={() => handleImageZoomChange(imageZoom - 0.25)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                title="Zoom Out (Synchronized)"
              >
                <ZoomOut className="w-4 h-4" />
              </button>
              <span className="text-[11px] font-mono font-medium text-slate-300 px-1">
                {Math.round(imageZoom * 100)}%
              </span>
              <button
                onClick={() => handleImageZoomChange(imageZoom + 0.25)}
                className="p-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 transition-colors"
                title="Zoom In (Synchronized)"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
              {imageZoom !== 1 && (
                <button
                  onClick={() => handleImageZoomChange(1)}
                  className="px-2 py-1 bg-slate-800 text-[10px] text-indigo-300 rounded font-medium hover:bg-slate-700"
                  title="Reset Zoom (Synchronized)"
                >
                  Reset
                </button>
              )}
            </div>

            {/* Switch to Movie Shortcut in Photo Mode */}
            <div className="absolute bottom-4 left-4">
              <button
                onClick={() => setShowPresetsModal(true)}
                className="flex items-center space-x-1.5 px-3 py-1.5 bg-slate-900/90 hover:bg-slate-800 text-slate-200 text-xs font-medium rounded-xl border border-slate-700/70 backdrop-blur-md transition-colors"
              >
                <Film className="w-3.5 h-3.5 text-purple-400" />
                <span>Switch to Movie</span>
              </button>
            </div>
          </div>
        ) : roomState.mediaType === 'audio' ? (
          // Audio Player Mode
          <div className="flex flex-col items-center justify-center p-8 space-y-6 w-full h-full bg-gradient-to-b from-slate-900 via-indigo-950 to-slate-950">
            <div className="relative">
              <div
                className={`w-32 h-32 rounded-full bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center shadow-2xl ${
                  roomState.isPlaying ? 'animate-pulse' : ''
                }`}
              >
                <Volume2 className="w-16 h-16 text-white" />
              </div>
              {!roomState.isPlaying && (
                <div
                  onClick={handlePlayPause}
                  className="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center cursor-pointer"
                >
                  <Play className="w-10 h-10 text-white fill-white ml-1" />
                </div>
              )}
            </div>

            <div className="text-center space-y-1">
              <h2 className="text-lg font-bold text-white truncate max-w-md">{currentTitle}</h2>
              <p className="text-xs text-indigo-300">Synchronized Audio Lounge</p>
            </div>

            <audio
              ref={videoRef as React.RefObject<HTMLAudioElement>}
              src={roomState.mediaUrl}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onEnded={() => broadcastMediaAction('pause', { currentTime: duration })}
              playsInline
              muted={isMutedLocal}
            />
          </div>
        ) : (
          // Video / Movie Player Mode
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
            <video
              ref={videoRef as React.RefObject<HTMLVideoElement>}
              src={roomState.mediaUrl}
              className="w-full h-full object-contain cursor-pointer"
              onClick={handlePlayPause}
              onTimeUpdate={handleTimeUpdate}
              onLoadedMetadata={handleLoadedMetadata}
              onWaiting={() => setIsBuffering(true)}
              onPlaying={() => setIsBuffering(false)}
              onEnded={() => broadcastMediaAction('pause', { currentTime: duration })}
              playsInline
              muted={isMutedLocal}
            />

            {/* Title Overlay in Video */}
            <div className="absolute top-4 left-4 bg-slate-900/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-700/70 shadow-lg pointer-events-none">
              <div className="flex items-center space-x-2">
                <Film className="w-4 h-4 text-indigo-400" />
                <h2 className="text-xs font-bold text-white tracking-wide truncate max-w-[280px]">
                  {currentTitle}
                </h2>
              </div>
            </div>

            {/* Buffering Indicator */}
            {isBuffering && (
              <div className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center pointer-events-none">
                <div className="flex items-center space-x-2 px-4 py-2 bg-slate-900/90 rounded-2xl border border-slate-700 text-white text-xs font-medium shadow-2xl">
                  <Loader2 className="w-4 h-4 animate-spin text-indigo-400" />
                  <span>Buffering movie in sync...</span>
                </div>
              </div>
            )}

            {/* Big Play Overlay on Pause */}
            {!roomState.isPlaying && !isBuffering && (
              <div
                onClick={handlePlayPause}
                className="absolute inset-0 bg-black/40 backdrop-blur-[1px] flex items-center justify-center cursor-pointer transition-opacity"
              >
                <div className="w-20 h-20 rounded-full bg-gradient-to-tr from-indigo-600 to-pink-600 text-white flex items-center justify-center shadow-2xl transform hover:scale-110 active:scale-95 transition-all">
                  <Play className="w-9 h-9 fill-white ml-1" />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Control Bar */}
      <div className="flex flex-col mt-3 bg-slate-950/90 rounded-xl p-3 border border-slate-800 space-y-2 shadow-lg">
        {/* Seek Timeline Range Slider (Video / Audio only) */}
        {roomState.mediaType !== 'image' ? (
          <div className="flex items-center space-x-3">
            <span className="text-[11px] font-mono text-slate-400 w-12 text-right select-none">
              {formatTime(displayTime)}
            </span>

            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={displayTime}
              onChange={handleSeekInput}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />

            <span className="text-[11px] font-mono text-slate-400 w-12 select-none">
              {formatTime(duration)}
            </span>
          </div>
        ) : (
          <div className="flex items-center justify-between py-0.5">
            <span className="text-xs text-slate-400">
              Viewing photo: <strong className="text-slate-200">{currentTitle}</strong>
            </span>
            <span className="text-[11px] text-indigo-400 font-mono">Synchronized with all devices</span>
          </div>
        )}

        {/* Playback Controls Row */}
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            {roomState.mediaType !== 'image' && (
              <>
                <button
                  onClick={handlePlayPause}
                  className="p-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 text-white transition-all shadow-md shadow-indigo-600/30"
                  title={roomState.isPlaying ? 'Pause for all' : 'Play for all'}
                >
                  {roomState.isPlaying ? <Pause className="w-4 h-4 fill-white" /> : <Play className="w-4 h-4 fill-white ml-0.5" />}
                </button>

                {/* Rewind 10s */}
                <button
                  onClick={() => handleTimeShift(-10)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Rewind 10 seconds (in sync)"
                >
                  <RotateCcw className="w-4 h-4" />
                </button>

                {/* Fast Forward 10s */}
                <button
                  onClick={() => handleTimeShift(10)}
                  className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
                  title="Fast Forward 10 seconds (in sync)"
                >
                  <RotateCw className="w-4 h-4" />
                </button>
              </>
            )}

            {/* Local Mute / Unmute */}
            <button
              onClick={() => {
                const nextMuted = !isMutedLocal;
                setIsMutedLocal(nextMuted);
                if (videoRef.current) {
                  videoRef.current.muted = nextMuted;
                }
              }}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title={isMutedLocal ? 'Unmute audio' : 'Mute audio'}
            >
              {isMutedLocal ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center space-x-2">
            {/* Fullscreen Button */}
            <button
              onClick={() => {
                if (containerRef.current) {
                  if (!document.fullscreenElement) {
                    containerRef.current.requestFullscreen?.().catch(() => {});
                  } else {
                    document.exitFullscreen?.().catch(() => {});
                  }
                }
              }}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Fullscreen"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Participants & Footer Information */}
      <div className="flex flex-col sm:flex-row items-center justify-between mt-3 pt-3 border-t border-slate-800/80 px-1 gap-2">
        <div className="flex items-center space-x-3 overflow-x-auto w-full sm:w-auto py-1">
          {participants.map((p, idx) => {
            const status = p.status || 'online';
            return (
              <div
                key={p.socketId}
                className="flex flex-col items-center space-y-1 shrink-0 group cursor-default"
                title={`${p.name} • ${status.toUpperCase()} (${p.statusReason || (status === 'online' ? 'Active in lounge' : 'Away')})`}
              >
                <div className="relative">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center font-bold text-white text-[11px] shadow-lg border-2"
                    style={{
                      backgroundColor: p.avatarColor || '#6366f1',
                      borderColor: idx === 0 ? '#10b981' : '#475569'
                    }}
                  >
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <span
                    className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                      status === 'online'
                        ? 'bg-emerald-400'
                        : status === 'away'
                        ? 'bg-amber-400'
                        : 'bg-rose-400'
                    }`}
                  />
                </div>
                <div className="flex items-center space-x-1 max-w-[80px]">
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      status === 'online' ? 'bg-emerald-400' : status === 'away' ? 'bg-amber-400' : 'bg-rose-400'
                    }`}
                  />
                  <span className="text-[10px] text-slate-300 font-medium truncate">{p.name}</span>
                </div>
              </div>
            );
          })}
        </div>

        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono text-center sm:text-right">
          SHARED MEDIA: {roomState.uploadedBy ? `BY ${roomState.uploadedBy.toUpperCase()}` : 'LOUNGE PLAYLIST'}
        </div>
      </div>

      {/* Presets Modal (Movies, Wallpapers, Soundtracks) */}
      {showPresetsModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-40">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center space-x-2">
                  <Sparkles className="w-4 h-4 text-yellow-400" />
                  <span>Curated Media Lounge Library</span>
                </h3>
                <p className="text-xs text-slate-400">
                  Select any movie or image to instantly synchronize with everyone in the room.
                </p>
              </div>
              <button
                onClick={() => setShowPresetsModal(false)}
                className="p-1.5 rounded-xl bg-slate-800 text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Movies Section */}
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-indigo-400">
                Movies & Short Films
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MEDIA_PRESETS.filter((p) => p.category === 'movie').map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className="flex items-start space-x-3 p-2.5 rounded-xl bg-slate-800/80 hover:bg-indigo-950/60 border border-slate-700/80 hover:border-indigo-500 cursor-pointer transition-all group"
                  >
                    <img
                      src={preset.thumbnail}
                      alt={preset.title}
                      className="w-16 h-16 rounded-lg object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-white group-hover:text-indigo-300 truncate">
                        {preset.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                        {preset.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Photos & Images Section */}
            <div className="space-y-2 pt-2 border-t border-slate-800">
              <span className="text-[11px] font-bold uppercase tracking-wider text-purple-400">
                High-Resolution Shared Photos & Wallpapers
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {MEDIA_PRESETS.filter((p) => p.category === 'image').map((preset) => (
                  <div
                    key={preset.id}
                    onClick={() => handleSelectPreset(preset)}
                    className="flex items-start space-x-3 p-2.5 rounded-xl bg-slate-800/80 hover:bg-purple-950/60 border border-slate-700/80 hover:border-purple-500 cursor-pointer transition-all group"
                  >
                    <img
                      src={preset.thumbnail}
                      alt={preset.title}
                      className="w-16 h-16 rounded-lg object-cover group-hover:scale-105 transition-transform"
                    />
                    <div className="flex-1 min-w-0">
                      <h4 className="text-xs font-bold text-white group-hover:text-purple-300 truncate">
                        {preset.title}
                      </h4>
                      <p className="text-[11px] text-slate-400 line-clamp-2 mt-0.5">
                        {preset.description}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2 border-t border-slate-800">
              <button
                type="button"
                onClick={() => setShowPresetsModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-xl transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* URL Input Modal */}
      {showUrlModal && (
        <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex items-center justify-center p-4 z-40">
          <form
            onSubmit={handleUrlSubmit}
            className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-md shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-slate-800 pb-2">
              <h3 className="text-base font-bold text-white">Load Web Movie, Photo, or Audio</h3>
              <button
                type="button"
                onClick={() => setShowUrlModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-1.5">
              <label className="text-xs text-slate-300">Direct Media URL</label>
              <input
                type="url"
                placeholder="https://example.com/movie.mp4 or photo.jpg"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                required
              />
              <p className="text-[10px] text-slate-400">
                Supports direct MP4/WebM videos, JPG/PNG/WebP images, and MP3/WAV audio streams.
              </p>
            </div>

            <div className="flex justify-end space-x-3 pt-2">
              <button
                type="button"
                onClick={() => setShowUrlModal(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium rounded-xl transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-500 hover:to-purple-500 text-white text-xs font-medium rounded-xl transition-colors shadow-md"
              >
                Sync with Room
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
