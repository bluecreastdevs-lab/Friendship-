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
  RefreshCw,
  X,
  Loader2,
  ExternalLink,
  Radio
} from 'lucide-react';
import { MovieState, Participant, MovieActionPayload } from '../types';
import { MEDIA_PRESETS } from '../presets';

export interface MoviePlayerProps {
  socket: Socket | null;
  roomId: string;
  movieState: MovieState;
  onMovieStateChange: (state: Partial<MovieState>) => void;
  participants: Participant[];
  currentUser: string;
  onRequestSync?: () => void;
  onOpenInNewTab?: () => void;
}

function formatTime(seconds: number): string {
  if (isNaN(seconds) || seconds < 0) return '00:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export default function MoviePlayer({
  socket,
  roomId,
  movieState,
  onMovieStateChange,
  participants,
  currentUser,
  onRequestSync,
  onOpenInNewTab
}: MoviePlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const heartbeatTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Anti-loop lock flag
  const isRemoteAction = useRef<boolean>(false);

  // Local playback & scrubbing states
  const [displayTime, setDisplayTime] = useState<number>(movieState.currentTime || 0);
  const [duration, setDuration] = useState<number>(movieState.duration || 100);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const [isMutedLocal, setIsMutedLocal] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);

  // Modals & upload states
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadProgressMsg, setUploadProgressMsg] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPresetsModal, setShowPresetsModal] = useState<boolean>(false);
  const [showUrlModal, setShowUrlModal] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isResyncing, setIsResyncing] = useState<boolean>(false);

  // Host detection
  const isHost = participants.length > 0 && participants[0].socketId === socket?.id;

  // Broadcast movie_action
  const broadcastMovieAction = useCallback(
    (
      type: 'play' | 'pause' | 'seek' | 'change_movie' | 'heartbeat',
      overrides?: Partial<MovieActionPayload>
    ) => {
      if (isRemoteAction.current) return;

      const el = videoRef.current;
      const currentTime =
        typeof overrides?.currentTime === 'number'
          ? overrides.currentTime
          : el
          ? el.currentTime
          : movieState.currentTime;

      const isPlaying =
        type === 'play'
          ? true
          : type === 'pause'
          ? false
          : (overrides?.isPlaying ?? movieState.isPlaying);

      const packet: MovieActionPayload = {
        roomId,
        mediaUrl: overrides?.mediaUrl || movieState.mediaUrl,
        type,
        currentTime,
        isPlaying,
        mediaTitle: overrides?.mediaTitle || movieState.mediaTitle,
        uploadedBy: overrides?.uploadedBy || movieState.uploadedBy || currentUser,
        serverTimestamp: Date.now()
      };

      socket?.emit('movie_action', packet);
      onMovieStateChange({
        ...overrides,
        currentTime,
        isPlaying,
        serverTimestamp: Date.now()
      });
    },
    [socket, roomId, movieState, currentUser, onMovieStateChange]
  );

  // Socket listener for movie_action
  useEffect(() => {
    if (!socket) return;

    const handleMovieAction = (packet: MovieActionPayload) => {
      if (packet.senderId && packet.senderId === socket.id) return;
      isRemoteAction.current = true;

      if (packet.type === 'change_movie') {
        onMovieStateChange({
          mediaUrl: packet.mediaUrl,
          currentTime: packet.currentTime || 0,
          isPlaying: packet.isPlaying ?? true,
          mediaTitle: packet.mediaTitle,
          uploadedBy: packet.uploadedBy,
          serverTimestamp: packet.serverTimestamp
        });
        setDisplayTime(0);
        setTimeout(() => {
          isRemoteAction.current = false;
        }, 300);
        return;
      }

      const el = videoRef.current;
      if (!el) {
        isRemoteAction.current = false;
        return;
      }

      const transitLatency = packet.isPlaying
        ? Math.max(0, (Date.now() - (packet.serverTimestamp || Date.now())) / 1000)
        : 0;
      const targetTime =
        packet.isPlaying && transitLatency < 8
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
        onMovieStateChange({ isPlaying: true, currentTime: targetTime });
      } else if (packet.type === 'pause') {
        el.pause();
        try {
          el.currentTime = targetTime;
          setDisplayTime(targetTime);
        } catch (_) {}
        onMovieStateChange({ isPlaying: false, currentTime: targetTime });
      } else if (packet.type === 'seek' || packet.type === 'heartbeat') {
        if (Math.abs(el.currentTime - targetTime) > 0.4 && !isSeeking) {
          try {
            el.currentTime = targetTime;
            setDisplayTime(targetTime);
          } catch (_) {}
          onMovieStateChange({ currentTime: targetTime });
        }

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
      }, 300);
    };

    socket.on('movie_action', handleMovieAction);
    return () => {
      socket.off('movie_action', handleMovieAction);
    };
  }, [socket, onMovieStateChange, isSeeking]);

  // Host heartbeat
  useEffect(() => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }

    if (isHost && movieState.isPlaying) {
      heartbeatTimerRef.current = setInterval(() => {
        const el = videoRef.current;
        if (el && !el.paused && !isSeeking) {
          broadcastMovieAction('heartbeat', {
            currentTime: el.currentTime,
            isPlaying: true
          });
        }
      }, 3000);
    }

    return () => {
      if (heartbeatTimerRef.current) {
        clearInterval(heartbeatTimerRef.current);
      }
    };
  }, [isHost, movieState.isPlaying, isSeeking, broadcastMovieAction]);

  // User Play/Pause click
  const handleTogglePlay = () => {
    const el = videoRef.current;
    if (!el) return;

    if (autoplayBlocked) {
      setAutoplayBlocked(false);
      el.muted = false;
      setIsMutedLocal(false);
    }

    if (movieState.isPlaying) {
      el.pause();
      broadcastMovieAction('pause', { currentTime: el.currentTime, isPlaying: false });
    } else {
      el.play()
        .then(() => {
          broadcastMovieAction('play', { currentTime: el.currentTime, isPlaying: true });
        })
        .catch((err) => {
          if (err?.name === 'NotAllowedError') {
            el.muted = true;
            setIsMutedLocal(true);
            setAutoplayBlocked(true);
            el.play().then(() => {
              broadcastMovieAction('play', { currentTime: el.currentTime, isPlaying: true });
            });
          }
        });
    }
  };

  // Skip 10s
  const handleSkip = (delta: number) => {
    const el = videoRef.current;
    if (!el) return;
    const newTime = Math.max(0, Math.min(duration, el.currentTime + delta));
    el.currentTime = newTime;
    setDisplayTime(newTime);
    broadcastMovieAction('seek', { currentTime: newTime });
  };

  // Seeking slider
  const handleSeekChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setDisplayTime(val);
  };

  const handleSeekCommit = () => {
    setIsSeeking(false);
    const el = videoRef.current;
    if (el) {
      el.currentTime = displayTime;
      broadcastMovieAction('seek', { currentTime: displayTime });
    }
  };

  // Video time update event
  const handleTimeUpdate = () => {
    if (!isSeeking && videoRef.current) {
      setDisplayTime(videoRef.current.currentTime);
    }
  };

  // Video duration loaded
  const handleLoadedMetadata = () => {
    if (videoRef.current) {
      const dur = videoRef.current.duration;
      if (!isNaN(dur) && dur > 0) {
        setDuration(dur);
      }
      if (movieState.currentTime > 0) {
        videoRef.current.currentTime = movieState.currentTime;
      }
      if (movieState.isPlaying) {
        videoRef.current.play().catch(() => {});
      }
    }
  };

  // Resync action
  const handleResync = () => {
    setIsResyncing(true);
    onRequestSync?.();
    socket?.emit('request-sync', { roomId });
    setTimeout(() => setIsResyncing(false), 800);
  };

  // Fullscreen toggle
  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  // File upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      setUploadError('Please select a valid movie/video file (MP4, WEBM, MOV)');
      return;
    }

    setIsUploading(true);
    setUploadProgressMsg('Uploading movie file...');
    setUploadError(null);

    try {
      const formData = new FormData();
      formData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: formData
      });

      if (!res.ok) {
        throw new Error(`Upload failed (${res.status})`);
      }

      const data = await res.json();
      broadcastMovieAction('change_movie', {
        mediaUrl: data.url,
        mediaTitle: file.name,
        uploadedBy: currentUser,
        currentTime: 0,
        isPlaying: true
      });
    } catch (err: any) {
      setUploadError(err.message || 'Movie upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      setUploadProgressMsg('');
      e.target.value = '';
    }
  };

  // URL submission
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;

    broadcastMovieAction('change_movie', {
      mediaUrl: url,
      mediaTitle: 'Shared Web Video',
      uploadedBy: currentUser,
      currentTime: 0,
      isPlaying: true
    });

    setShowUrlModal(false);
    setUrlInput('');
  };

  // Select movie preset
  const handleSelectPreset = (preset: typeof MEDIA_PRESETS[0]) => {
    broadcastMovieAction('change_movie', {
      mediaUrl: preset.url,
      mediaTitle: preset.title,
      uploadedBy: 'Curated Preset',
      currentTime: 0,
      isPlaying: true
    });
    setShowPresetsModal(false);
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full w-full bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/95 border-b border-slate-800/80 z-20">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-indigo-500/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400 shrink-0">
            <Film className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate flex items-center gap-2">
              <span>{movieState.mediaTitle || 'Synchronized Movie Lounge'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-500/20 text-indigo-300 font-normal border border-indigo-500/30">
                Synced Movie
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 truncate">
              {movieState.uploadedBy ? `Selected by ${movieState.uploadedBy}` : 'Synced across all room participants'}
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          {/* Host indicator */}
          {isHost && (
            <div className="hidden lg:flex items-center space-x-1 px-2.5 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/30 text-[11px] text-indigo-300">
              <Radio className="w-3 h-3 text-indigo-400 animate-pulse" />
              <span>Host Clock</span>
            </div>
          )}

          {/* Resync Button */}
          <button
            onClick={handleResync}
            className="p-2 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 transition-colors shadow-sm"
            title="Resync with Lounge"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResyncing ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          {/* Preset Movies Modal Trigger */}
          <button
            onClick={() => setShowPresetsModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 text-xs font-medium transition-colors shadow-sm"
            title="Browse Movie Presets"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Movies</span>
          </button>

          {/* Add Video URL Modal Trigger */}
          <button
            onClick={() => setShowUrlModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 text-xs font-medium transition-colors shadow-sm"
            title="Play Video via URL"
          >
            <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">URL</span>
          </button>

          {/* Upload Video Button */}
          <label className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white text-xs font-semibold cursor-pointer transition-all shadow-md shadow-indigo-600/30">
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{isUploading ? 'Uploading...' : 'Upload Video'}</span>
            <input
              type="file"
              accept="video/mp4, video/webm, video/ogg, video/quicktime"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>

          {/* Open Movie in New Tab Button */}
          {onOpenInNewTab && (
            <button
              onClick={onOpenInNewTab}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-pink-600/20 hover:bg-pink-600/30 text-pink-300 hover:text-white border border-pink-500/30 text-xs font-medium transition-colors shadow-sm"
              title="Open Movie Page in New Browser Tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">New Tab</span>
            </button>
          )}

          {/* Fullscreen Button */}
          <button
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 transition-colors shadow-sm"
            title="Toggle Fullscreen"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Video Viewport */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={movieState.mediaUrl}
          className="w-full h-full max-h-[65vh] lg:max-h-full object-contain"
          playsInline
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => setIsBuffering(false)}
          onCanPlay={() => setIsBuffering(false)}
          onClick={handleTogglePlay}
        />

        {/* Buffering Indicator */}
        {isBuffering && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs z-10">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
          </div>
        )}

        {/* Autoplay Blocked Banner */}
        {autoplayBlocked && (
          <div className="absolute top-4 inset-x-4 bg-amber-500/90 backdrop-blur-md text-slate-950 p-2.5 rounded-2xl flex items-center justify-between shadow-2xl z-30">
            <div className="flex items-center space-x-2 text-xs font-semibold">
              <VolumeX className="w-4 h-4" />
              <span>Autoplay unmuted audio was blocked by browser.</span>
            </div>
            <button
              onClick={() => {
                setAutoplayBlocked(false);
                if (videoRef.current) {
                  videoRef.current.muted = false;
                  setIsMutedLocal(false);
                  videoRef.current.play().catch(() => {});
                }
              }}
              className="px-3 py-1 bg-slate-950 text-amber-300 hover:bg-slate-900 text-xs font-bold rounded-xl"
            >
              Click to Unmute & Listen
            </button>
          </div>
        )}

        {/* Upload Error Banner */}
        {uploadError && (
          <div className="absolute top-4 inset-x-4 bg-rose-500/90 text-white text-xs px-3 py-2 rounded-xl shadow-xl flex items-center justify-between z-30">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {/* Big Center Play/Pause button on hover */}
        <button
          onClick={handleTogglePlay}
          className="absolute inset-0 flex items-center justify-center bg-transparent group focus:outline-none"
        >
          <div className="w-16 h-16 rounded-full bg-slate-900/70 border border-slate-700/60 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition-opacity shadow-2xl transform group-hover:scale-105">
            {movieState.isPlaying ? <Pause className="w-8 h-8" /> : <Play className="w-8 h-8 translate-x-0.5" />}
          </div>
        </button>
      </div>

      {/* Synchronized Playback Control Deck */}
      <div className="px-4 py-3 bg-slate-900/95 border-t border-slate-800/80 z-20 space-y-2 shrink-0">
        {/* Timeline scrubber */}
        <div className="flex items-center space-x-3">
          <span className="text-[11px] font-mono text-slate-400 min-w-[40px]">
            {formatTime(displayTime)}
          </span>
          <div className="flex-1 relative flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={0.1}
              value={displayTime}
              onMouseDown={() => setIsSeeking(true)}
              onTouchStart={() => setIsSeeking(true)}
              onChange={handleSeekChange}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>
          <span className="text-[11px] font-mono text-slate-400 min-w-[40px] text-right">
            {formatTime(duration)}
          </span>
        </div>

        {/* Buttons Row */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center space-x-2">
            {/* Play/Pause */}
            <button
              onClick={handleTogglePlay}
              className="p-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white shadow-md shadow-indigo-600/30 transition-all hover:scale-105"
              title={movieState.isPlaying ? 'Pause (Synced)' : 'Play (Synced)'}
            >
              {movieState.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 translate-x-0.5" />}
            </button>

            {/* Skip 10s Backward */}
            <button
              onClick={() => handleSkip(-10)}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60 transition-colors"
              title="Skip -10s"
            >
              <RotateCcw className="w-4 h-4" />
            </button>

            {/* Skip 10s Forward */}
            <button
              onClick={() => handleSkip(10)}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60 transition-colors"
              title="Skip +10s"
            >
              <RotateCw className="w-4 h-4" />
            </button>

            {/* Volume / Mute */}
            <button
              onClick={() => {
                if (videoRef.current) {
                  videoRef.current.muted = !isMutedLocal;
                  setIsMutedLocal(!isMutedLocal);
                }
              }}
              className="p-2 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 border border-slate-700/60 transition-colors ml-2"
              title={isMutedLocal ? 'Unmute' : 'Mute'}
            >
              {isMutedLocal ? <VolumeX className="w-4 h-4 text-rose-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="text-xs text-slate-400 font-medium">
            <span>{participants.length} watching movie together</span>
          </div>
        </div>
      </div>

      {/* URL Input Modal */}
      {showUrlModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl w-full max-w-md shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <LinkIcon className="w-4 h-4 text-indigo-400" />
                Play Video from Web URL
              </h3>
              <button
                onClick={() => setShowUrlModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleUrlSubmit} className="space-y-3">
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Direct Video Stream URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/video.mp4"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-indigo-500"
                  required
                />
              </div>
              <div className="flex items-center justify-end space-x-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowUrlModal(false)}
                  className="px-4 py-2 bg-slate-800 text-slate-300 hover:text-white text-xs font-medium rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-gradient-to-r from-indigo-600 to-pink-600 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  Stream to Lounge
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preset Movies Modal */}
      {showPresetsModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Select Curated Movie
              </h3>
              <button
                onClick={() => setShowPresetsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MEDIA_PRESETS.filter((p) => p.category === 'movie').map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className="flex flex-col text-left bg-slate-800/80 hover:bg-slate-800 rounded-2xl overflow-hidden border border-slate-700/60 transition-all hover:border-indigo-500/60 group"
                >
                  <img
                    src={preset.thumbnail}
                    alt={preset.title}
                    referrerPolicy="no-referrer"
                    className="w-full h-28 object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div className="p-3">
                    <h4 className="text-xs font-semibold text-white truncate">{preset.title}</h4>
                    <p className="text-[10px] text-slate-400 line-clamp-2 mt-1">{preset.description}</p>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
