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
  Radio,
  Trash2,
  AlertCircle,
  Download,
  Wrench
} from 'lucide-react';
import { MovieState, Participant, MovieActionPayload, VideoItem } from '../types';
import { MEDIA_PRESETS } from '../presets';
import { getApiUrl, getMediaUrl } from '../config';

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
  if (isNaN(seconds) || seconds < 0 || !isFinite(seconds)) return '00:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  const pad = (n: number) => (n < 10 ? '0' : '') + n;

  if (hrs > 0) {
    return `${hrs}:${pad(mins)}:${pad(secs)}`;
  }
  return `${pad(mins)}:${pad(secs)}`;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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
  const xhrRef = useRef<XMLHttpRequest | null>(null);
  const abortUploadRef = useRef<boolean>(false);
  const activeUploadIdRef = useRef<string | null>(null);

  // Anti-loop lock flag & sync refs
  const isRemoteAction = useRef<boolean>(false);
  const pendingSeekTimeRef = useRef<number | null>(null);
  const lastMediaUrlRef = useRef<string>(movieState.mediaUrl);
  const movieStateRef = useRef<MovieState>(movieState);
  movieStateRef.current = movieState;

  // Local playback & scrubbing states
  const [displayTime, setDisplayTime] = useState<number>(movieState.currentTime || 0);
  const [duration, setDuration] = useState<number>(movieState.duration || 100);
  const [isSeeking, setIsSeeking] = useState<boolean>(false);
  const [isMutedLocal, setIsMutedLocal] = useState<boolean>(false);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [autoplayBlocked, setAutoplayBlocked] = useState<boolean>(false);
  const [videoError, setVideoError] = useState<{ code?: number; message: string } | null>(null);
  const [isOptimizing, setIsOptimizing] = useState<boolean>(false);

  // Modals & upload states (supports large movies of 2GB+ / 2:30hr)
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadPercent, setUploadPercent] = useState<number>(0);
  const [uploadBytesMsg, setUploadBytesMsg] = useState<string>('');
  const [uploadProgressMsg, setUploadProgressMsg] = useState<string>('');
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showPresetsModal, setShowPresetsModal] = useState<boolean>(false);
  const [showUrlModal, setShowUrlModal] = useState<boolean>(false);
  const [urlInput, setUrlInput] = useState<string>('');
  const [isResyncing, setIsResyncing] = useState<boolean>(false);

  // Synchronize when mediaUrl or initial room state updates
  useEffect(() => {
    if (isRemoteAction.current) return;

    if (movieState.mediaUrl !== lastMediaUrlRef.current) {
      lastMediaUrlRef.current = movieState.mediaUrl;
      pendingSeekTimeRef.current = movieState.currentTime || 0;
      setDisplayTime(movieState.currentTime || 0);
      setVideoError(null);
      return;
    }

    const el = videoRef.current;
    if (!el || isSeeking) return;

    // Authoritative room-state synchronization for the active video
    const elapsed = movieState.isPlaying
      ? Math.min(2.0, Math.max(0, (Date.now() - (movieState.serverTimestamp || Date.now())) / 1000))
      : 0;
    const targetTime = (movieState.currentTime || 0) + elapsed;

    if (el.readyState >= 1) {
      const diff = Math.abs(el.currentTime - targetTime);
      if (diff > 1.2) {
        try {
          el.currentTime = targetTime;
          setDisplayTime(targetTime);
        } catch (_) {}
      }

      if (movieState.isPlaying && el.paused) {
        el.play().catch((err: any) => {
          if (err?.name === 'NotAllowedError') {
            el.muted = true;
            setIsMutedLocal(true);
            setAutoplayBlocked(true);
            el.play().catch(() => {});
          }
        });
      } else if (!movieState.isPlaying && !el.paused) {
        el.pause();
      }
    } else {
      pendingSeekTimeRef.current = targetTime;
    }
  }, [movieState.mediaUrl, movieState.currentTime, movieState.isPlaying, movieState.serverTimestamp, isSeeking]);

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
        duration: overrides?.duration ?? duration,
        mediaTitle: overrides?.mediaTitle || movieState.mediaTitle,
        uploadedBy: overrides?.uploadedBy || movieState.uploadedBy || currentUser,
        serverTimestamp: Date.now()
      };

      socket?.emit('movie_action', packet);
      onMovieStateChange({
        ...overrides,
        currentTime,
        isPlaying,
        duration: packet.duration,
        serverTimestamp: Date.now()
      });
    },
    [socket, roomId, movieState, currentUser, duration, onMovieStateChange]
  );

  // Socket listener for movie_action
  useEffect(() => {
    if (!socket) return;

    const handleMovieAction = (packet: MovieActionPayload) => {
      if (packet.senderId && packet.senderId === socket.id) return;
      isRemoteAction.current = true;

      if (packet.type === 'change_movie') {
        pendingSeekTimeRef.current = packet.currentTime || 0;
        lastMediaUrlRef.current = packet.mediaUrl;
        onMovieStateChange({
          mediaUrl: packet.mediaUrl,
          currentTime: packet.currentTime || 0,
          isPlaying: packet.isPlaying ?? true,
          mediaTitle: packet.mediaTitle,
          uploadedBy: packet.uploadedBy,
          duration: packet.duration,
          playlist: packet.playlist || movieState.playlist,
          serverTimestamp: packet.serverTimestamp
        });
        setDisplayTime(packet.currentTime || 0);
        setTimeout(() => {
          isRemoteAction.current = false;
        }, 300);
        return;
      } else if (packet.type === 'add_movie') {
        const currentPl = movieState.playlist || [];
        const item = packet.playlistItem || (packet.mediaUrl ? {
          id: `vid-${Date.now()}`,
          url: packet.mediaUrl,
          title: packet.mediaTitle || 'Video',
          uploadedBy: packet.uploadedBy || 'Someone'
        } : null);
        const updatedPl = packet.playlist || (item ? [item, ...currentPl.filter(v => v.url !== item.url)] : currentPl);

        pendingSeekTimeRef.current = 0;
        onMovieStateChange({
          mediaUrl: packet.mediaUrl || movieState.mediaUrl,
          mediaTitle: packet.mediaTitle || movieState.mediaTitle,
          uploadedBy: packet.uploadedBy || movieState.uploadedBy,
          currentTime: 0,
          isPlaying: packet.isPlaying ?? true,
          playlist: updatedPl,
          serverTimestamp: packet.serverTimestamp
        });
        setDisplayTime(0);
        setTimeout(() => {
          isRemoteAction.current = false;
        }, 300);
        return;
      } else if (packet.type === 'delete_movie') {
        const currentPl = movieState.playlist || [];
        const updatedPl = packet.playlist || currentPl.filter(v => v.url !== packet.deletedMediaUrl);
        const isCurrentDeleted = movieState.mediaUrl === packet.deletedMediaUrl;
        const nextUrl = isCurrentDeleted ? (packet.mediaUrl || updatedPl[0]?.url || 'https://media.w3.org/2010/05/bunny/trailer.mp4') : movieState.mediaUrl;
        const nextTitle = isCurrentDeleted ? (packet.mediaTitle || updatedPl[0]?.title || 'Big Buck Bunny (Trailer)') : movieState.mediaTitle;

        if (isCurrentDeleted) {
          pendingSeekTimeRef.current = 0;
          setDisplayTime(0);
        }

        onMovieStateChange({
          mediaUrl: nextUrl,
          mediaTitle: nextTitle,
          playlist: updatedPl,
          currentTime: isCurrentDeleted ? 0 : movieState.currentTime,
          isPlaying: isCurrentDeleted ? false : movieState.isPlaying
        });
        setTimeout(() => {
          isRemoteAction.current = false;
        }, 300);
        return;
      }

      // If the incoming packet refers to a different mediaUrl, switch to it immediately
      if (packet.mediaUrl && packet.mediaUrl !== lastMediaUrlRef.current) {
        lastMediaUrlRef.current = packet.mediaUrl;
        pendingSeekTimeRef.current = packet.currentTime || 0;
        setDisplayTime(packet.currentTime || 0);
        setVideoError(null);
        onMovieStateChange({
          mediaUrl: packet.mediaUrl,
          currentTime: packet.currentTime || 0,
          isPlaying: packet.isPlaying ?? false,
          mediaTitle: packet.mediaTitle || movieState.mediaTitle,
          uploadedBy: packet.uploadedBy || movieState.uploadedBy,
          duration: packet.duration,
          playlist: packet.playlist || movieState.playlist,
          serverTimestamp: packet.serverTimestamp
        });
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
        ? Math.min(0.5, Math.max(0, (Date.now() - (packet.serverTimestamp || Date.now())) / 1000))
        : 0;
      const targetTime =
        packet.isPlaying
          ? packet.currentTime + transitLatency
          : packet.currentTime;

      if (packet.type === 'play') {
        if (el.readyState >= 1) {
          const diff = Math.abs(el.currentTime - targetTime);
          if (diff > 1.2) {
            try {
              el.currentTime = targetTime;
              setDisplayTime(targetTime);
            } catch (_) {}
          }
          el.playbackRate = 1.0;
          el.play().catch((err: any) => {
            if (err?.name === 'NotAllowedError') {
              el.muted = true;
              setIsMutedLocal(true);
              setAutoplayBlocked(true);
              el.play().catch(() => {});
            }
          });
        } else {
          pendingSeekTimeRef.current = targetTime;
        }
        onMovieStateChange({ isPlaying: true, currentTime: targetTime });
      } else if (packet.type === 'pause') {
        el.pause();
        el.playbackRate = 1.0;
        try {
          el.currentTime = targetTime;
          setDisplayTime(targetTime);
        } catch (_) {}
        onMovieStateChange({ isPlaying: false, currentTime: targetTime });
      } else if (packet.type === 'seek') {
        // Immediate precise seek for explicit scrubber jumps
        try {
          el.currentTime = targetTime;
          setDisplayTime(targetTime);
        } catch (_) {}
        el.playbackRate = 1.0;
        if (packet.isPlaying && el.paused) {
          el.play().catch(() => {});
        } else if (!packet.isPlaying && !el.paused) {
          el.pause();
        }
        onMovieStateChange({ currentTime: targetTime, isPlaying: packet.isPlaying });
      } else if (packet.type === 'heartbeat') {
        if (!isSeeking) {
          const diff = targetTime - el.currentTime;
          const absDiff = Math.abs(diff);

          if (absDiff > 1.8) {
            // Significant drift -> snap seek smoothly
            try {
              el.currentTime = targetTime;
              setDisplayTime(targetTime);
            } catch (_) {}
            el.playbackRate = 1.0;
          } else if (absDiff > 0.35 && packet.isPlaying && !el.paused) {
            // Smooth micro-adjustment without audio/video stuttering
            el.playbackRate = diff > 0 ? 1.05 : 0.95;
          } else {
            el.playbackRate = 1.0;
          }

          if (packet.isPlaying && el.paused) {
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
      }

      setTimeout(() => {
        isRemoteAction.current = false;
      }, 300);
    };

    socket.on('movie_action', handleMovieAction);
    return () => {
      socket.off('movie_action', handleMovieAction);
    };
  }, [socket, onMovieStateChange, isSeeking, movieState.playlist]);

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

  // Delete a movie/video from room and disk storage
  const handleDeleteMovie = async (targetUrl: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!targetUrl) return;

    // Call REST endpoint for filesystem deletion
    try {
      await fetch(getApiUrl('/api/media/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, url: targetUrl, mediaType: 'video' })
      });
    } catch (err) {
      console.error('Delete video API failed', err);
    }

    const currentPl = movieState.playlist || [];
    const updatedPl = currentPl.filter((v) => v.url !== targetUrl);
    const isCurrent = movieState.mediaUrl === targetUrl;
    let nextUrl = movieState.mediaUrl;
    let nextTitle = movieState.mediaTitle;
    let nextUploadedBy = movieState.uploadedBy;

    if (isCurrent) {
      if (updatedPl.length > 0) {
        nextUrl = updatedPl[0].url;
        nextTitle = updatedPl[0].title;
        nextUploadedBy = updatedPl[0].uploadedBy;
      } else {
        nextUrl = 'https://media.w3.org/2010/05/bunny/trailer.mp4';
        nextTitle = 'Big Buck Bunny (Trailer)';
        nextUploadedBy = 'System';
      }
      setDisplayTime(0);
    }

    onMovieStateChange({
      mediaUrl: nextUrl,
      mediaTitle: nextTitle,
      uploadedBy: nextUploadedBy,
      playlist: updatedPl,
      currentTime: isCurrent ? 0 : movieState.currentTime,
      isPlaying: isCurrent ? false : movieState.isPlaying
    });

    socket?.emit('movie_action', {
      roomId,
      type: 'delete_movie',
      mediaUrl: nextUrl,
      mediaTitle: nextTitle,
      uploadedBy: nextUploadedBy,
      deletedMediaUrl: targetUrl,
      playlist: updatedPl,
      currentTime: 0,
      isPlaying: isCurrent ? false : movieState.isPlaying
    });
  };

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

  // Video duration loaded & seek reconciliation
  const handleLoadedMetadata = () => {
    const el = videoRef.current;
    if (!el) return;

    const dur = el.duration;
    if (!isNaN(dur) && isFinite(dur) && dur > 0) {
      setDuration(dur);
      if (dur !== movieStateRef.current.duration) {
        onMovieStateChange({ duration: dur });
      }
    }

    const targetTime =
      pendingSeekTimeRef.current !== null
        ? pendingSeekTimeRef.current
        : movieStateRef.current.currentTime;

    if (typeof targetTime === 'number' && targetTime > 0) {
      try {
        el.currentTime = targetTime;
        setDisplayTime(targetTime);
      } catch (_) {}
    }
    pendingSeekTimeRef.current = null;

    if (movieStateRef.current.isPlaying) {
      el.play().catch((err: any) => {
        if (err?.name === 'NotAllowedError') {
          el.muted = true;
          setIsMutedLocal(true);
          setAutoplayBlocked(true);
          el.play().catch(() => {});
        }
      });
    }
  };

  const handleCanPlay = () => {
    setIsBuffering(false);
    setVideoError(null);
    const el = videoRef.current;
    if (el) {
      if (pendingSeekTimeRef.current !== null) {
        try {
          el.currentTime = pendingSeekTimeRef.current;
          setDisplayTime(pendingSeekTimeRef.current);
        } catch (_) {}
        pendingSeekTimeRef.current = null;
      }
      if (movieStateRef.current.isPlaying && el.paused) {
        el.play().catch((err: any) => {
          if (err?.name === 'NotAllowedError') {
            el.muted = true;
            setIsMutedLocal(true);
            setAutoplayBlocked(true);
            el.play().catch(() => {});
          }
        });
      }
    }
  };

  const handleVideoError = () => {
    setIsBuffering(false);
    const err = videoRef.current?.error;
    let msg = 'Unable to stream this media file.';
    if (err) {
      switch (err.code) {
        case 1:
          msg = 'Video playback was aborted by client.';
          break;
        case 2:
          msg = 'Network connection dropped while streaming video chunks.';
          break;
        case 3:
          msg = 'Video decoding failed. The video format or codec might not be supported by your browser.';
          break;
        case 4:
          msg = 'This video format or codec is not supported by your browser (e.g. MKV or HEVC).';
          break;
        default:
          msg = err.message || 'Stream loading error.';
      }
    }
    setVideoError({ code: err?.code, message: msg });
  };

  const handleRetryVideo = () => {
    setVideoError(null);
    setIsBuffering(true);
    const el = videoRef.current;
    if (el) {
      const src = el.src;
      el.src = '';
      el.load();
      el.src = src;
      el.load();
      el.play().catch(() => {});
    }
  };

  const handleOptimizeVideo = async () => {
    if (!movieState.mediaUrl || isOptimizing) return;
    setIsOptimizing(true);
    try {
      const res = await fetch(getApiUrl('/api/media/optimize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: movieState.mediaUrl })
      });
      const data = await res.json();
      if (res.ok && data.optimizedUrl) {
        setVideoError(null);
        broadcastMovieAction('change_movie', {
          mediaUrl: data.optimizedUrl,
          mediaTitle: (movieState.mediaTitle || 'Video') + ' (Web Optimized)',
          currentTime: 0,
          isPlaying: true
        });
        onMovieStateChange({
          mediaUrl: data.optimizedUrl,
          mediaTitle: (movieState.mediaTitle || 'Video') + ' (Web Optimized)',
          currentTime: 0,
          isPlaying: true
        });
      } else {
        alert(data.error || 'Failed to optimize video for web.');
      }
    } catch (err: any) {
      alert('Error during video optimization: ' + (err.message || 'Network error'));
    } finally {
      setIsOptimizing(false);
    }
  };

  // Switch to compatible sample video
  const handleSwitchToSample = () => {
    setVideoError(null);
    const sampleUrl = 'https://media.w3.org/2010/05/bunny/trailer.mp4';
    const sampleTitle = 'Big Buck Bunny (Trailer)';
    onMovieStateChange({
      mediaUrl: sampleUrl,
      mediaTitle: sampleTitle,
      currentTime: 0,
      isPlaying: true
    });
    broadcastMovieAction('change_movie', {
      mediaUrl: sampleUrl,
      mediaTitle: sampleTitle,
      currentTime: 0,
      isPlaying: true
    });
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

  // Cancel ongoing upload
  const handleCancelUpload = () => {
    abortUploadRef.current = true;
    if (xhrRef.current) {
      xhrRef.current.abort();
      xhrRef.current = null;
    }
    if (activeUploadIdRef.current) {
      fetch(getApiUrl('/api/upload/abort'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadId: activeUploadIdRef.current })
      }).catch(() => {});
      activeUploadIdRef.current = null;
    }
    setIsUploading(false);
    setUploadProgressMsg('');
    setUploadPercent(0);
    setUploadBytesMsg('');
  };

  // Chunked file upload supporting 350MB to 4GB+ long movies with real-time percentage
  // By slicing large files into 8MB chunks, every request is well below Cloud Run's 32MB payload limit!
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/') && !/\.(mp4|webm|ogg|mov|mkv|avi)$/i.test(file.name)) {
      setUploadError('Please select a valid movie file (MP4, WEBM, MOV, MKV)');
      e.target.value = '';
      return;
    }

    const MAX_SIZE = 4 * 1024 * 1024 * 1024; // 4GB max
    if (file.size > MAX_SIZE) {
      setUploadError(`File is too large (${formatBytes(file.size)}). Maximum supported movie size is 4GB.`);
      e.target.value = '';
      return;
    }

    setIsUploading(true);
    setUploadPercent(0);
    setUploadBytesMsg(`0 B of ${formatBytes(file.size)}`);
    setUploadProgressMsg(`Preparing upload for ${file.name}...`);
    setUploadError(null);
    abortUploadRef.current = false;

    // Adaptive chunk sizing for 2.5GB+ movies:
    // Files > 1.5GB use 6MB chunks to reduce HTTP request count by 60% while staying well under proxy limits
    const CHUNK_SIZE =
      file.size > 1.5 * 1024 * 1024 * 1024
        ? 6 * 1024 * 1024
        : Math.round(2.5 * 1024 * 1024);
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
    const uploadId = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeUploadIdRef.current = uploadId;

    // Helper to verify if chunk was already received and written on server
    const checkChunkOnServer = async (upId: string, idx: number, expectedSize: number) => {
      try {
        const res = await fetch(
          getApiUrl(`/api/upload/chunk-status?uploadId=${encodeURIComponent(upId)}&chunkIndex=${idx}&expectedSize=${expectedSize}`),
          { cache: 'no-store' }
        );
        if (res.ok) {
          const data = await res.json();
          return !!data.exists;
        }
      } catch (_) {}
      return false;
    };

    let finalData: any = null;
    let useObjectUrlFallback = false;

    try {
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (abortUploadRef.current) {
          throw new Error('Upload cancelled');
        }

        const isLastChunk = chunkIndex === totalChunks - 1;
        const start = chunkIndex * CHUNK_SIZE;
        const end = Math.min(file.size, start + CHUNK_SIZE);
        const chunkBlob = file.slice(start, end);

        // If fallback mode active, skip server chunks and use object URL
        if (useObjectUrlFallback) {
          break;
        }

        // Upload single chunk with retry up to 5 times
        let attempt = 0;
        let chunkSuccess = false;
        let lastErr: any = null;

        // Check if chunk is already stored on server (e.g. from previous attempt)
        const alreadyOnServer = await checkChunkOnServer(uploadId, chunkIndex, chunkBlob.size);
        if (alreadyOnServer) {
          chunkSuccess = true;
          const totalLoaded = Math.min(file.size, end);
          const pct = Math.min(99, Math.round((totalLoaded / file.size) * 100));
          setUploadPercent(pct);
          setUploadBytesMsg(`${formatBytes(totalLoaded)} of ${formatBytes(file.size)}`);
        }

        while (attempt < 5 && !chunkSuccess) {
          if (abortUploadRef.current) throw new Error('Upload cancelled');
          attempt++;

          if (attempt > 1) {
            setUploadProgressMsg(
              `Reconnecting: Part ${chunkIndex + 1}/${totalChunks} (attempt ${attempt}/5)...`
            );
            const delay = Math.min(1000 * Math.pow(1.5, attempt - 1), 5000);
            await new Promise((r) => setTimeout(r, delay));

            const recheck = await checkChunkOnServer(uploadId, chunkIndex, chunkBlob.size);
            if (recheck) {
              chunkSuccess = true;
              break;
            }
          }

          try {
            finalData = await new Promise<any>((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhrRef.current = xhr;
              xhr.timeout = isLastChunk ? 180000 : 90000;

              xhr.upload.onprogress = (event) => {
                if (event.lengthComputable && !abortUploadRef.current) {
                  const currentChunkLoaded = event.loaded;
                  const totalLoaded = start + currentChunkLoaded;
                  const pct = Math.min(99, Math.round((totalLoaded / file.size) * 100));
                  setUploadPercent(pct);
                  setUploadBytesMsg(`${formatBytes(totalLoaded)} of ${formatBytes(file.size)}`);
                  if (isLastChunk && currentChunkLoaded >= event.total * 0.95) {
                    setUploadProgressMsg(`Finalizing & optimizing ${file.name} for instant streaming...`);
                  } else {
                    setUploadProgressMsg(
                      `Uploading ${file.name} • Part ${chunkIndex + 1}/${totalChunks} (${pct}%)`
                    );
                  }
                }
              };

              xhr.onload = () => {
                xhrRef.current = null;
                const contentType = xhr.getResponseHeader('content-type') || '';
                const isJson = contentType.includes('application/json');

                if (xhr.status >= 200 && xhr.status < 300) {
                  if (isJson) {
                    try {
                      const res = JSON.parse(xhr.responseText);
                      resolve(res);
                    } catch (e) {
                      reject(new Error('Invalid JSON from server on chunk ' + chunkIndex));
                    }
                  } else {
                    resolve({ success: true });
                  }
                } else if (xhr.status === 404 && chunkIndex === 0) {
                  // Static hosting / Netlify detected (no backend API) -> trigger client object URL fallback
                  resolve({ fallback: true });
                } else {
                  let errMsg = `Server error (${xhr.status})`;
                  if (isJson) {
                    try {
                      const res = JSON.parse(xhr.responseText);
                      if (res.error) errMsg = res.error;
                    } catch (_) {}
                  } else if (xhr.responseText) {
                    const clean = xhr.responseText.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                    if (clean.includes('413') || clean.includes('Too Large')) {
                      errMsg = 'Network payload limit exceeded. Retrying chunk...';
                    } else {
                      errMsg = clean.slice(0, 100) || errMsg;
                    }
                  }
                  reject(new Error(errMsg));
                }
              };

              xhr.onerror = () => {
                xhrRef.current = null;
                if (chunkIndex === 0) {
                  resolve({ fallback: true });
                } else {
                  reject(new Error(`Network glitch on part ${chunkIndex + 1}/${totalChunks}`));
                }
              };

              xhr.ontimeout = () => {
                xhrRef.current = null;
                reject(new Error(`Timeout on part ${chunkIndex + 1}/${totalChunks}`));
              };

              xhr.onabort = () => {
                xhrRef.current = null;
                reject(new Error('Upload cancelled'));
              };

              const queryParams = new URLSearchParams({
                uploadId,
                chunkIndex: String(chunkIndex),
                totalChunks: String(totalChunks),
                fileName: file.name,
                fileSize: String(file.size),
                fileType: file.type
              });
              xhr.open('POST', getApiUrl(`/api/upload/chunk?${queryParams.toString()}`), true);

              const formData = new FormData();
              formData.append('uploadId', uploadId);
              formData.append('chunkIndex', String(chunkIndex));
              formData.append('totalChunks', String(totalChunks));
              formData.append('fileName', file.name);
              formData.append('fileSize', String(file.size));
              formData.append('fileType', file.type);
              formData.append('chunk', chunkBlob, `part_${chunkIndex}.bin`);
              xhr.send(formData);
            });

            if (finalData && finalData.fallback) {
              useObjectUrlFallback = true;
              chunkSuccess = true;
              break;
            }

            chunkSuccess = true;
          } catch (err: any) {
            lastErr = err;
            if (abortUploadRef.current || err.message === 'Upload cancelled') {
              throw err;
            }
          }
        }

        if (useObjectUrlFallback) {
          break;
        }

        if (!chunkSuccess) {
          throw lastErr || new Error(`Failed to upload part ${chunkIndex + 1}/${totalChunks}`);
        }
      }

      if (abortUploadRef.current) return;

      let videoUrl = '';
      if (useObjectUrlFallback) {
        videoUrl = URL.createObjectURL(file);
      } else {
        if (!finalData || !finalData.url) {
          throw new Error('Upload completed, but server did not return the video URL.');
        }
        videoUrl = finalData.url;
      }

      setUploadPercent(100);
      setUploadProgressMsg('Upload complete! Preparing playback...');

      const newVideoItem: VideoItem = {
        id: `vid-${Date.now()}`,
        url: videoUrl,
        title: file.name,
        uploadedBy: currentUser,
        timestamp: Date.now()
      };
      const currentPl = movieState.playlist || [];
      const updatedPlaylist = [newVideoItem, ...currentPl.filter((v) => v.url !== videoUrl)];

      pendingSeekTimeRef.current = 0;
      broadcastMovieAction('change_movie', {
        mediaUrl: videoUrl,
        mediaTitle: file.name,
        uploadedBy: currentUser,
        currentTime: 0,
        isPlaying: true,
        playlist: updatedPlaylist
      });

      socket?.emit('movie_action', {
        roomId,
        type: 'add_movie',
        mediaUrl: videoUrl,
        mediaTitle: file.name,
        uploadedBy: currentUser,
        playlistItem: newVideoItem,
        playlist: updatedPlaylist,
        currentTime: 0,
        isPlaying: true
      });
    } catch (err: any) {
      if (err.message !== 'Upload cancelled') {
        setUploadError(err.message || 'Upload failed. Please try again.');
      }
    } finally {
      setIsUploading(false);
      setUploadProgressMsg('');
      activeUploadIdRef.current = null;
      e.target.value = '';
    }
  };

  // URL submission
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = urlInput.trim();
    if (!url) return;

    const title = 'Shared Web Video';
    const newVideoItem: VideoItem = {
      id: `vid-${Date.now()}`,
      url,
      title,
      uploadedBy: currentUser,
      timestamp: Date.now()
    };
    const currentPl = movieState.playlist || [];
    const updatedPlaylist = [newVideoItem, ...currentPl.filter(v => v.url !== url)];

    broadcastMovieAction('change_movie', {
      mediaUrl: url,
      mediaTitle: title,
      uploadedBy: currentUser,
      currentTime: 0,
      isPlaying: true,
      playlist: updatedPlaylist
    });

    socket?.emit('movie_action', {
      roomId,
      type: 'add_movie',
      mediaUrl: url,
      mediaTitle: title,
      uploadedBy: currentUser,
      playlistItem: newVideoItem,
      playlist: updatedPlaylist,
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
              accept="video/mp4, video/webm, video/ogg, video/quicktime, video/x-matroska, .mp4, .mkv, .mov, .webm"
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

          {/* Delete Current Movie Button */}
          {movieState.mediaUrl && (
            <button
              onClick={() => handleDeleteMovie(movieState.mediaUrl)}
              className="p-2 rounded-xl bg-slate-800/80 text-rose-400 hover:text-white hover:bg-rose-600/80 border border-slate-700/60 transition-colors shadow-sm"
              title="Delete current movie from room and storage"
            >
              <Trash2 className="w-3.5 h-3.5" />
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

      {/* Upload Progress Bar Banner (Shows exact percent and MB uploaded for large 2GB+ movies) */}
      {isUploading && (
        <div className="px-4 py-2.5 bg-indigo-950/95 border-b border-indigo-500/30 flex items-center justify-between gap-3 text-xs z-30 animate-in fade-in">
          <div className="flex items-center space-x-2.5 min-w-0 flex-1">
            <Loader2 className="w-4 h-4 text-indigo-400 animate-spin shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-white font-medium truncate">{uploadProgressMsg}</span>
                <span className="text-indigo-300 font-mono font-bold shrink-0 ml-2">
                  {uploadPercent}% {uploadBytesMsg && `(${uploadBytesMsg})`}
                </span>
              </div>
              <div className="w-full h-1.5 bg-slate-800 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-indigo-500 to-pink-500 transition-all duration-200"
                  style={{ width: `${uploadPercent}%` }}
                />
              </div>
            </div>
          </div>
          <button
            onClick={handleCancelUpload}
            className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white rounded-lg text-[11px] font-medium border border-slate-700 shrink-0"
          >
            Cancel
          </button>
        </div>
      )}

      {/* Main Video Viewport */}
      <div className="relative flex-1 min-h-0 bg-black flex items-center justify-center overflow-hidden">
        <video
          ref={videoRef}
          src={getMediaUrl(movieState.mediaUrl)}
          className="w-full h-full max-h-[65vh] lg:max-h-full object-contain"
          playsInline
          preload="metadata"
          onTimeUpdate={handleTimeUpdate}
          onLoadedMetadata={handleLoadedMetadata}
          onWaiting={() => setIsBuffering(true)}
          onPlaying={() => {
            setIsBuffering(false);
            setVideoError(null);
          }}
          onCanPlay={handleCanPlay}
          onClick={handleTogglePlay}
          onError={handleVideoError}
        />

        {/* Buffering Indicator */}
        {isBuffering && !videoError && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/40 backdrop-blur-xs z-10">
            <Loader2 className="w-10 h-10 text-indigo-400 animate-spin" />
          </div>
        )}

        {/* Video Playback / Format Error Overlay */}
        {videoError && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/90 backdrop-blur-md p-6 z-25 text-center animate-in fade-in">
            <div className="max-w-md w-full bg-slate-900 border border-slate-700/80 rounded-2xl p-5 shadow-2xl space-y-4">
              <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/20 flex items-center justify-center text-rose-400">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="space-y-1">
                <h3 className="text-white text-base font-bold">Video Playback Issue</h3>
                <p className="text-xs text-slate-300 leading-relaxed">{videoError.message}</p>
              </div>

              <div className="flex flex-col gap-2 pt-1">
                <button
                  onClick={handleSwitchToSample}
                  className="w-full py-2.5 px-4 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-bold transition-all shadow-md flex items-center justify-center gap-2"
                >
                  <Film className="w-4 h-4" />
                  <span>Switch to Compatible Sample Movie</span>
                </button>

                {movieState.mediaUrl?.startsWith('/uploads/') && (
                  <button
                    onClick={handleOptimizeVideo}
                    disabled={isOptimizing}
                    className="w-full flex items-center justify-center gap-2 py-2.5 px-4 bg-gradient-to-r from-indigo-600 to-pink-600 hover:from-indigo-500 hover:to-pink-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-indigo-600/30 disabled:opacity-50"
                  >
                    {isOptimizing ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Wrench className="w-4 h-4" />
                    )}
                    <span>{isOptimizing ? 'Optimizing Video Stream...' : 'Auto-Optimize for Web Playback'}</span>
                  </button>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={handleRetryVideo}
                    className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    <span>Retry</span>
                  </button>

                  {movieState.mediaUrl && (
                    <a
                      href={movieState.mediaUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-2 px-3 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl text-xs font-semibold border border-slate-700 transition-colors flex items-center justify-center gap-1.5"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                      <span>Direct URL</span>
                    </a>
                  )}

                  {movieState.mediaUrl && (
                    <a
                      href={movieState.mediaUrl}
                      download={movieState.mediaTitle || 'movie'}
                      className="p-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-xl border border-slate-700 transition-colors"
                      title="Download full video file"
                    >
                      <Download className="w-4 h-4" />
                    </a>
                  )}
                </div>
              </div>

              <p className="text-[11px] text-slate-400 border-t border-slate-800 pt-3">
                💡 High-resolution movies over 2GB stream smoothest when encoded in standard <span className="text-indigo-300 font-medium">MP4 (H.264 + AAC)</span>.
              </p>
            </div>
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
          <span className="text-[11px] font-mono text-slate-400 min-w-[62px]">
            {formatTime(displayTime)}
          </span>
          <div className="flex-1 relative flex items-center">
            <input
              type="range"
              min={0}
              max={duration || 100}
              step={duration > 3600 ? 1 : 0.25}
              value={displayTime}
              onMouseDown={() => setIsSeeking(true)}
              onTouchStart={() => setIsSeeking(true)}
              onChange={handleSeekChange}
              onMouseUp={handleSeekCommit}
              onTouchEnd={handleSeekCommit}
              className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500 focus:outline-none"
            />
          </div>
          <span className="text-[11px] font-mono text-slate-400 min-w-[62px] text-right">
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

          <div className="flex items-center space-x-2">
            <div className="flex items-center -space-x-1.5 overflow-hidden py-0.5">
              {participants.slice(0, 6).map((p) => {
                const status = p.status || 'online';
                return (
                  <div
                    key={p.socketId}
                    className="relative group shrink-0 cursor-default"
                    title={`${p.name} • ${status.toUpperCase()} (${p.statusReason || (status === 'online' ? 'Active in lounge' : 'Away')})`}
                  >
                    <div
                      className="w-6 h-6 rounded-full flex items-center justify-center font-bold text-white text-[9px] shadow-sm border border-slate-900"
                      style={{ backgroundColor: p.avatarColor || '#6366f1' }}
                    >
                      {p.name.slice(0, 2).toUpperCase()}
                    </div>
                    <span
                      className={`absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-slate-900 ${
                        status === 'online'
                          ? 'bg-emerald-400'
                          : status === 'away'
                          ? 'bg-amber-400'
                          : 'bg-rose-400'
                      }`}
                    />
                  </div>
                );
              })}
            </div>
            <span className="text-xs text-slate-400 font-medium">
              <span>{participants.length} watching movie together</span>
            </span>
          </div>
        </div>
      </div>

      {/* Room Movie Playlist & Media Library */}
      <div className="px-4 py-2.5 bg-slate-950/80 border-t border-slate-800/80 shrink-0">
        <div className="flex items-center justify-between mb-1.5">
          <div className="flex items-center space-x-2">
            <Film className="w-3.5 h-3.5 text-indigo-400" />
            <span className="text-xs font-semibold text-slate-300">Room Video Playlist</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {(movieState.playlist || []).length > 0 ? (movieState.playlist || []).length : 1} items
            </span>
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Click to switch synced movie • Delete with trash button
          </span>
        </div>

        {/* Playlist Horizontal Cards Row */}
        <div className="flex items-center space-x-2.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-700">
          {(!movieState.playlist || movieState.playlist.length === 0) && (
            <div className="relative group shrink-0">
              <button
                type="button"
                className="flex items-center space-x-2.5 px-3 py-1.5 rounded-xl bg-indigo-950/40 border border-indigo-500/50 text-left min-w-[200px]"
              >
                <div className="w-7 h-7 rounded-lg bg-indigo-600 flex items-center justify-center text-white shrink-0 shadow-sm">
                  <Film className="w-3.5 h-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-white truncate">{movieState.mediaTitle || 'Big Buck Bunny'}</p>
                  <span className="text-[10px] text-indigo-400 font-semibold flex items-center gap-1">
                    <Radio className="w-2.5 h-2.5 animate-pulse" /> Playing
                  </span>
                </div>
              </button>
            </div>
          )}

          {(movieState.playlist || []).map((video) => {
            const isActive = video.url === movieState.mediaUrl;
            return (
              <div key={video.id || video.url} className="relative group shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    broadcastMovieAction('change_movie', {
                      mediaUrl: video.url,
                      mediaTitle: video.title,
                      uploadedBy: video.uploadedBy,
                      currentTime: 0,
                      isPlaying: true
                    });
                  }}
                  className={`flex items-center space-x-2.5 px-3 py-1.5 rounded-xl border text-left transition-all min-w-[200px] max-w-[240px] ${
                    isActive
                      ? 'bg-indigo-950/50 border-indigo-500 ring-1 ring-indigo-500/50 shadow-md'
                      : 'bg-slate-800/70 border-slate-700/60 hover:border-slate-600 opacity-80 hover:opacity-100'
                  }`}
                >
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      isActive ? 'bg-indigo-600 text-white shadow-sm' : 'bg-slate-700/60 text-slate-300'
                    }`}
                  >
                    <Film className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-white truncate">{video.title}</p>
                    <div className="flex items-center space-x-1.5 text-[10px] text-slate-400">
                      {isActive ? (
                        <span className="text-indigo-400 font-semibold flex items-center gap-1">
                          <Radio className="w-2.5 h-2.5 animate-pulse" /> Playing
                        </span>
                      ) : (
                        <span className="truncate">{video.uploadedBy || 'Uploaded video'}</span>
                      )}
                    </div>
                  </div>
                </button>

                {/* Delete Video Button */}
                <button
                  type="button"
                  onClick={(e) => handleDeleteMovie(video.url, e)}
                  className="absolute -top-1.5 -right-1.5 p-1 bg-slate-900/95 hover:bg-rose-600 text-rose-300 hover:text-white rounded-full border border-slate-700 shadow-md opacity-0 group-hover:opacity-100 transition-all z-20"
                  title="Delete video from room and disk"
                >
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            );
          })}
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
