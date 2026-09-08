import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, Volume2, VolumeX, Maximize, Upload, Link as LinkIcon, Settings, RotateCcw } from 'lucide-react';

interface Participant {
  socketId: string;
  name: string;
  avatarColor: string;
  isMuted: boolean;
}

interface MediaState {
  isPlaying: boolean;
  currentTime: number;
  mediaUrl: string;
  mediaType: 'video' | 'audio';
  lastUpdated: number;
}

interface VideoPlayerProps {
  mediaState: MediaState;
  onMediaStateChange: (state: Partial<MediaState>) => void;
  participants: Participant[];
  currentUser: string;
}

export default function VideoPlayer({ mediaState, onMediaStateChange, participants, currentUser }: VideoPlayerProps) {
  const mediaRef = useRef<HTMLVideoElement | HTMLAudioElement>(null);
  const [isLocalChange, setIsLocalChange] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlModal, setShowUrlModal] = useState(false);
  const [isMutedLocal, setIsMutedLocal] = useState(false);

  // Sync state from props (remote updates)
  useEffect(() => {
    if (!mediaRef.current) return;
    const el = mediaRef.current;

    if (Math.abs(el.currentTime - mediaState.currentTime) > 0.7 && !isLocalChange) {
      el.currentTime = mediaState.currentTime;
    }

    if (el.paused !== !mediaState.isPlaying && !isLocalChange) {
      if (mediaState.isPlaying) {
        el.play().catch(() => {});
      } else {
        el.pause();
      }
    }
  }, [mediaState, isLocalChange]);

  const handlePlayPause = () => {
    if (!mediaRef.current) return;
    const el = mediaRef.current;
    const nextPlaying = el.paused;

    setIsLocalChange(true);
    if (nextPlaying) {
      el.play().catch(() => {});
    } else {
      el.pause();
    }

    onMediaStateChange({
      isPlaying: nextPlaying,
      currentTime: el.currentTime
    });

    setTimeout(() => setIsLocalChange(false), 300);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (!mediaRef.current) return;
    mediaRef.current.currentTime = time;

    setIsLocalChange(true);
    onMediaStateChange({
      currentTime: time,
      isPlaying: !mediaRef.current.paused
    });

    setTimeout(() => setIsLocalChange(false), 300);
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fileUrl = URL.createObjectURL(file);
    let type: 'video' | 'audio' | 'image' = 'video';
    if (file.type.startsWith('audio')) type = 'audio';
    else if (file.type.startsWith('image')) type = 'image';

    onMediaStateChange({
      mediaUrl: fileUrl,
      mediaType: type,
      currentTime: 0,
      isPlaying: type !== 'image'
    });
  };

  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!urlInput.trim()) return;
    const url = urlInput.trim();
    let type: 'video' | 'audio' | 'image' = 'video';
    if (url.endsWith('.mp3') || url.endsWith('.wav') || url.includes('audio')) {
      type = 'audio';
    } else if (url.match(/\.(jpeg|jpg|png|gif|webp|svg)$/i) || url.includes('image')) {
      type = 'image';
    }
    
    onMediaStateChange({
      mediaUrl: url,
      mediaType: type,
      currentTime: 0,
      isPlaying: type !== 'image'
    });
    setUrlInput('');
    setShowUrlModal(false);
  };

  const mediaTitle = mediaState.mediaUrl.includes('BigBuckBunny') ? 'THE LAST STARGAZER' : mediaState.mediaUrl.split('/').pop() || 'SYNCED MEDIA';

  return (
    <div className="flex flex-col h-full w-full bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-slate-700/60 overflow-hidden shadow-2xl p-4">
      {/* Header section */}
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold tracking-wider text-slate-400 uppercase">WATCHING & SHARING TOGETHER</span>
        <div className="flex items-center space-x-2">
          <label className="flex items-center space-x-1 px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium rounded-lg cursor-pointer transition-colors shadow-md">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload Media / Photo</span>
            <input type="file" accept="video/*,audio/*,image/*" onChange={handleFileUpload} className="hidden" />
          </label>
          <button
            onClick={() => setShowUrlModal(!showUrlModal)}
            className="flex items-center space-x-1 px-3 py-1 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium rounded-lg transition-colors border border-slate-700"
          >
            <LinkIcon className="w-3.5 h-3.5" />
            <span>URL</span>
          </button>
        </div>
      </div>

      {/* Media Viewport / Stage */}
      <div className="relative flex-1 bg-black rounded-xl flex items-center justify-center overflow-hidden group shadow-inner border border-slate-800">
        {mediaState.mediaType === 'audio' ? (
          <div className="flex flex-col items-center justify-center p-8 space-y-6 w-full h-full bg-gradient-to-b from-slate-900 to-indigo-950">
            <div className="w-32 h-32 rounded-full bg-gradient-to-tr from-indigo-600 to-pink-500 flex items-center justify-center shadow-2xl animate-pulse">
              <Volume2 className="w-16 h-16 text-white" />
            </div>
            <p className="text-slate-300 text-sm max-w-md text-center truncate px-4">
              Playing Audio: {mediaTitle}
            </p>
            <audio
              ref={mediaRef as React.RefObject<HTMLAudioElement>}
              src={mediaState.mediaUrl}
              onPlay={() => onMediaStateChange({ isPlaying: true })}
              onPause={() => onMediaStateChange({ isPlaying: false })}
              controls={false}
              autoPlay={mediaState.isPlaying}
              muted={isMutedLocal}
            />
          </div>
        ) : mediaState.mediaType === 'image' ? (
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950 p-2">
            <img
              src={mediaState.mediaUrl}
              alt={mediaTitle}
              className="w-full h-full object-contain rounded-lg"
            />
            {/* Title Overlay in Photo */}
            <div className="absolute top-6 left-6 pointer-events-none">
              <h2 className="text-2xl font-black tracking-widest text-white/90 drop-shadow-lg font-mono">
                PHOTO: {mediaTitle}
              </h2>
            </div>
          </div>
        ) : (
          <div className="relative w-full h-full flex items-center justify-center bg-slate-950">
            <video
              ref={mediaRef as React.RefObject<HTMLVideoElement>}
              src={mediaState.mediaUrl}
              className="w-full h-full object-contain cursor-pointer"
              onClick={handlePlayPause}
              onPlay={() => onMediaStateChange({ isPlaying: true })}
              onPause={() => onMediaStateChange({ isPlaying: false })}
              playsInline
              muted={isMutedLocal}
            />
            {/* Title Overlay in Video */}
            <div className="absolute top-6 left-6 pointer-events-none">
              <h2 className="text-2xl font-black tracking-widest text-white/90 drop-shadow-lg font-mono">
                {mediaTitle}
              </h2>
            </div>
          </div>
        )}

        {/* Center play overlay on pause */}
        {!mediaState.isPlaying && (
          <div 
            onClick={handlePlayPause}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px] flex items-center justify-center cursor-pointer transition-opacity"
          >
            <div className="w-20 h-20 rounded-full bg-indigo-600 text-white flex items-center justify-center shadow-2xl transform hover:scale-105 transition-transform">
              <Play className="w-10 h-10 ml-1" />
            </div>
          </div>
        )}

        {/* URL Modal */}
        {showUrlModal && (
          <div className="absolute inset-0 bg-black/70 backdrop-blur-md flex items-center justify-center p-4 z-30">
            <form onSubmit={handleUrlSubmit} className="bg-slate-900 border border-slate-700 p-6 rounded-2xl w-full max-w-md shadow-2xl space-y-4">
              <h3 className="text-lg font-semibold text-white">Load Media from URL</h3>
              <input
                type="url"
                placeholder="https://example.com/video.mp4"
                value={urlInput}
                onChange={(e) => setUrlInput(e.target.value)}
                className="w-full px-4 py-2.5 bg-slate-800 border border-slate-700 rounded-xl text-white text-sm focus:outline-none focus:border-indigo-500"
                required
              />
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => setShowUrlModal(false)}
                  className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 text-sm font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  Load Media
                </button>
              </div>
            </form>
          </div>
        )}
      </div>

      {/* Control Bar inside Player Card */}
      <div className="flex flex-col mt-3 bg-slate-950/80 rounded-xl p-3 border border-slate-800 space-y-2">
        <div className="flex items-center space-x-3">
          <input
            type="range"
            min={0}
            max={mediaRef.current?.duration || 100}
            value={mediaState.currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-indigo-500"
          />
        </div>

        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <button
              onClick={handlePlayPause}
              className="p-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
            >
              {mediaState.isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            </button>
            <button
              onClick={() => {
                if (mediaRef.current) mediaRef.current.currentTime -= 10;
              }}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Rewind 10s"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={() => setIsMutedLocal(!isMutedLocal)}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              {isMutedLocal ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
            </button>
          </div>

          <div className="flex items-center space-x-2">
            <button
              onClick={() => {
                if (mediaRef.current) mediaRef.current.requestFullscreen?.();
              }}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
            >
              <Maximize className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Participants Row & Media Uploaded By Footer */}
      <div className="flex flex-col sm:flex-row items-center justify-between mt-3 pt-3 border-t border-slate-800/80 px-1 gap-2">
        <div className="flex items-center space-x-3 overflow-x-auto w-full sm:w-auto py-1">
          {participants.map((p, idx) => (
            <div key={p.socketId} className="flex flex-col items-center space-y-1">
              <div 
                className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-xs shadow-lg border-2"
                style={{ backgroundColor: p.avatarColor, borderColor: idx === 0 ? '#10b981' : '#475569' }}
              >
                {p.name.slice(0, 2).toUpperCase()}
              </div>
              <span className="text-[11px] text-slate-300 font-medium">{p.name}</span>
            </div>
          ))}
        </div>
        <div className="text-[11px] uppercase tracking-wider text-slate-400 font-mono">
          MEDIA: UPLOADED BY {currentUser ? currentUser.toUpperCase() : 'LEO'}
        </div>
      </div>
    </div>
  );
}

