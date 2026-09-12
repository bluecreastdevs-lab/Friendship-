import React, { useState, useRef, useEffect } from 'react';
import { Socket } from 'socket.io-client';
import {
  ZoomIn,
  ZoomOut,
  Maximize2,
  Upload,
  Link as LinkIcon,
  Image as ImageIcon,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  RefreshCw,
  Sparkles,
  Loader2,
  X,
  User,
  Trash2
} from 'lucide-react';
import { ImageState, ImageItem, Participant, ImageActionPayload } from '../types';
import { MEDIA_PRESETS } from '../presets';
import { getApiUrl, getMediaUrl } from '../config';

export interface ImageViewerProps {
  socket: Socket | null;
  roomId: string;
  imageState: ImageState;
  onImageStateChange: (state: Partial<ImageState>) => void;
  currentUser: string;
  participants: Participant[];
  onRequestSync?: () => void;
  onOpenInNewTab?: () => void;
}

export default function ImageViewer({
  socket,
  roomId,
  imageState,
  onImageStateChange,
  currentUser,
  participants,
  onRequestSync,
  onOpenInNewTab
}: ImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [localZoom, setLocalZoom] = useState<number>(imageState.imageZoom || 1);
  const [isUploading, setIsUploading] = useState<boolean>(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [showUrlModal, setShowUrlModal] = useState<boolean>(false);
  const [showPresetsModal, setShowPresetsModal] = useState<boolean>(false);
  const [imageUrlInput, setImageUrlInput] = useState<string>('');
  const [imageTitleInput, setImageTitleInput] = useState<string>('');
  const [isResyncing, setIsResyncing] = useState<boolean>(false);
  const [imageLoadError, setImageLoadError] = useState<boolean>(false);
  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);

  // Sync incoming remote image state changes
  useEffect(() => {
    if (typeof imageState.imageZoom === 'number') {
      setLocalZoom(imageState.imageZoom);
    }
    setImageLoadError(false);
  }, [imageState.activeImageUrl, imageState.imageZoom]);

  // Socket listener for real-time image actions
  useEffect(() => {
    if (!socket) return;

    const handleImageAction = (packet: ImageActionPayload) => {
      if (packet.senderId && packet.senderId === socket.id) return;

      if (packet.type === 'zoom' && typeof packet.imageZoom === 'number') {
        setLocalZoom(packet.imageZoom);
        onImageStateChange({ imageZoom: packet.imageZoom });
      } else if (packet.type === 'select_image' || packet.type === 'add_image') {
        onImageStateChange({
          activeImageUrl: packet.activeImageUrl,
          activeImageTitle: packet.activeImageTitle,
          uploadedBy: packet.uploadedBy,
          imageZoom: packet.imageZoom ?? 1,
          gallery: packet.gallery || imageState.gallery
        });
        setLocalZoom(packet.imageZoom ?? 1);
        setImageLoadError(false);
      } else if (packet.type === 'delete_image') {
        const updatedGallery = packet.gallery || (imageState.gallery || []).filter((i) => i.url !== packet.deletedImageUrl);
        onImageStateChange({
          activeImageUrl: packet.activeImageUrl,
          activeImageTitle: packet.activeImageTitle,
          gallery: updatedGallery
        });
        setImageLoadError(false);
      }
    };

    socket.on('image_action', handleImageAction);
    return () => {
      socket.off('image_action', handleImageAction);
    };
  }, [socket, onImageStateChange, imageState.gallery]);

  // Delete image from gallery and storage
  const handleDeleteImage = async (targetUrl: string, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
      e.preventDefault();
    }
    if (!targetUrl) return;

    // Call deletion API endpoint for filesystem cleanup
    try {
      await fetch(getApiUrl('/api/media/delete'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId, url: targetUrl, mediaType: 'image' })
      });
    } catch (err) {
      console.error('Delete request failed', err);
    }

    // Prepare updated gallery locally
    const currentGal = imageState.gallery || [];
    const updatedGallery = currentGal.filter((img) => img.url !== targetUrl);
    let nextActive = imageState.activeImageUrl;
    let nextTitle = imageState.activeImageTitle;
    let nextUploadedBy = imageState.uploadedBy;

    if (imageState.activeImageUrl === targetUrl) {
      if (updatedGallery.length > 0) {
        nextActive = updatedGallery[0].url;
        nextTitle = updatedGallery[0].title;
        nextUploadedBy = updatedGallery[0].uploadedBy;
      } else {
        nextActive = 'https://images.unsplash.com/photo-1451187580459-43490279c0fa?w=1600&auto=format&fit=crop&q=80';
        nextTitle = 'Deep Cosmic Nebula (Space 4K)';
        nextUploadedBy = 'System';
      }
    }

    onImageStateChange({
      activeImageUrl: nextActive,
      activeImageTitle: nextTitle,
      uploadedBy: nextUploadedBy,
      gallery: updatedGallery
    });

    socket?.emit('image_action', {
      roomId,
      type: 'delete_image',
      activeImageUrl: nextActive,
      activeImageTitle: nextTitle,
      uploadedBy: nextUploadedBy,
      deletedImageUrl: targetUrl,
      gallery: updatedGallery
    });
  };

  // Broadcast zoom changes across peers
  const handleZoomChange = (newZoom: number) => {
    const clamped = Math.max(0.5, Math.min(3, Math.round(newZoom * 100) / 100));
    setLocalZoom(clamped);
    onImageStateChange({ imageZoom: clamped });

    socket?.emit('image_action', {
      roomId,
      type: 'zoom',
      imageZoom: clamped,
      activeImageUrl: imageState.activeImageUrl,
      activeImageTitle: imageState.activeImageTitle,
      uploadedBy: currentUser
    });
  };

  // Select an image from the gallery
  const handleSelectImage = (item: ImageItem) => {
    setImageLoadError(false);
    setLocalZoom(1);
    onImageStateChange({
      activeImageUrl: item.url,
      activeImageTitle: item.title,
      uploadedBy: item.uploadedBy || currentUser,
      imageZoom: 1
    });

    socket?.emit('image_action', {
      roomId,
      type: 'select_image',
      activeImageUrl: item.url,
      activeImageTitle: item.title,
      uploadedBy: item.uploadedBy || currentUser,
      imageZoom: 1
    });
  };

  // Next & Previous image handlers
  const gallery = imageState.gallery && imageState.gallery.length > 0 ? imageState.gallery : [];
  const currentIndex = gallery.findIndex((img) => img.url === imageState.activeImageUrl);

  const handlePrevImage = () => {
    if (gallery.length <= 1) return;
    const prevIdx = (currentIndex - 1 + gallery.length) % gallery.length;
    handleSelectImage(gallery[prevIdx]);
  };

  const handleNextImage = () => {
    if (gallery.length <= 1) return;
    const nextIdx = (currentIndex + 1) % gallery.length;
    handleSelectImage(gallery[nextIdx]);
  };

  // Convert file to optimized Data URL so all participants across devices can sync and render
  const processImageToDataUrl = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = e.target?.result as string;
        if (!result) return reject(new Error('Failed to read image data'));

        // If image is small (< 1MB), use as-is
        if (file.size <= 1024 * 1024) {
          return resolve(result);
        }

        // If image is large (> 1MB), scale it on an off-screen canvas to keep WebSocket fast
        const img = new Image();
        img.onload = () => {
          const maxDim = 1920;
          let width = img.width;
          let height = img.height;

          if (width > maxDim || height > maxDim) {
            if (width > height) {
              height = Math.round((height * maxDim) / width);
              width = maxDim;
            } else {
              width = Math.round((width * maxDim) / height);
              height = maxDim;
            }
          }

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (!ctx) return resolve(result);

          ctx.drawImage(img, 0, 0, width, height);
          resolve(canvas.toDataURL('image/jpeg', 0.88));
        };
        img.onerror = () => resolve(result);
        img.src = result;
      };
      reader.onerror = (err) => reject(err);
      reader.readAsDataURL(file);
    });
  };

  // Handle image file upload with dual backend-upload + universal synced Data URL support
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setUploadError('Please select a valid image file (PNG, JPG, WEBP, GIF)');
      return;
    }

    setIsUploading(true);
    setUploadError(null);

    try {
      let finalImageUrl = '';

      // 1. Try uploading to backend server first if available
      try {
        const formData = new FormData();
        formData.append('file', file);
        const res = await fetch(getApiUrl('/api/upload'), {
          method: 'POST',
          body: formData
        });
        if (res.ok) {
          const data = await res.json();
          if (data && data.url) {
            finalImageUrl = data.url;
          }
        }
      } catch (uploadErr) {
        console.warn('Backend server upload not reachable, using universal synced Data URL fallback:', uploadErr);
      }

      // 2. Fallback: Process into universal high-resolution Data URL for instant peer sync
      if (!finalImageUrl) {
        finalImageUrl = await processImageToDataUrl(file);
      }

      const newImageItem: ImageItem = {
        id: `img-${Date.now()}`,
        url: finalImageUrl,
        title: file.name,
        uploadedBy: currentUser,
        thumbnail: finalImageUrl,
        timestamp: Date.now()
      };

      // Add to gallery and broadcast
      const updatedGallery = [newImageItem, ...gallery.filter((i) => i.url !== newImageItem.url)];
      onImageStateChange({
        activeImageUrl: newImageItem.url,
        activeImageTitle: newImageItem.title,
        uploadedBy: currentUser,
        imageZoom: 1,
        gallery: updatedGallery
      });
      setLocalZoom(1);

      socket?.emit('image_action', {
        roomId,
        type: 'add_image',
        galleryItem: newImageItem,
        activeImageUrl: newImageItem.url,
        activeImageTitle: newImageItem.title,
        uploadedBy: currentUser
      });
    } catch (err: any) {
      setUploadError(err.message || 'Image upload failed. Please try again.');
    } finally {
      setIsUploading(false);
      e.target.value = '';
    }
  };

  // Handle custom image URL submission
  const handleUrlSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const url = imageUrlInput.trim();
    if (!url) return;

    const title = imageTitleInput.trim() || 'Shared Web Image';
    const newImageItem: ImageItem = {
      id: `img-${Date.now()}`,
      url,
      title,
      uploadedBy: currentUser,
      thumbnail: url,
      timestamp: Date.now()
    };

    const updatedGallery = [newImageItem, ...gallery.filter((i) => i.url !== url)];
    onImageStateChange({
      activeImageUrl: url,
      activeImageTitle: title,
      uploadedBy: currentUser,
      imageZoom: 1,
      gallery: updatedGallery
    });
    setLocalZoom(1);

    socket?.emit('image_action', {
      roomId,
      type: 'add_image',
      galleryItem: newImageItem,
      activeImageUrl: url,
      activeImageTitle: title,
      uploadedBy: currentUser
    });

    setShowUrlModal(false);
    setImageUrlInput('');
    setImageTitleInput('');
  };

  // Select a preset wallpaper
  const handleSelectPreset = (preset: typeof MEDIA_PRESETS[0]) => {
    const newImageItem: ImageItem = {
      id: `preset-${preset.id}`,
      url: preset.url,
      title: preset.title,
      uploadedBy: 'Curated Preset',
      thumbnail: preset.thumbnail,
      timestamp: Date.now()
    };

    const updatedGallery = [newImageItem, ...gallery.filter((i) => i.url !== preset.url)];
    onImageStateChange({
      activeImageUrl: preset.url,
      activeImageTitle: preset.title,
      uploadedBy: 'Curated Preset',
      imageZoom: 1,
      gallery: updatedGallery
    });
    setLocalZoom(1);

    socket?.emit('image_action', {
      roomId,
      type: 'add_image',
      galleryItem: newImageItem,
      activeImageUrl: preset.url,
      activeImageTitle: preset.title,
      uploadedBy: 'Curated Preset'
    });

    setShowPresetsModal(false);
  };

  // Resync with server
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
      setIsFullscreen(true);
    } else {
      document.exitFullscreen?.().catch(() => {});
      setIsFullscreen(false);
    }
  };

  return (
    <div
      ref={containerRef}
      className="relative flex flex-col h-full w-full bg-slate-900/90 backdrop-blur-xl border border-slate-800/80 rounded-3xl overflow-hidden shadow-2xl"
    >
      {/* Top Header Bar */}
      <div className="flex items-center justify-between px-4 py-3 bg-slate-900/95 border-b border-slate-800/80 z-20">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-pink-500/20 border border-pink-500/30 flex items-center justify-center text-pink-400 shrink-0">
            <ImageIcon className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-white truncate flex items-center gap-2">
              <span>{imageState.activeImageTitle || 'Shared Photo Viewer'}</span>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 font-normal border border-pink-500/30">
                Synced Image
              </span>
            </h2>
            <p className="text-[11px] text-slate-400 truncate flex items-center gap-1.5">
              <User className="w-3 h-3 text-slate-500" />
              <span>Shared by {imageState.uploadedBy || 'Someone in lounge'}</span>
            </p>
          </div>
        </div>

        {/* Action Controls */}
        <div className="flex items-center space-x-1.5 sm:space-x-2 shrink-0">
          {/* Resync Button */}
          <button
            onClick={handleResync}
            className="p-2 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 transition-colors shadow-sm"
            title="Resync with Lounge"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isResyncing ? 'animate-spin text-pink-400' : ''}`} />
          </button>

          {/* Preset Wallpapers Modal Trigger */}
          <button
            onClick={() => setShowPresetsModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 text-xs font-medium transition-colors shadow-sm"
            title="Browse 4K Wallpapers"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span className="hidden sm:inline">Presets</span>
          </button>

          {/* Add Image URL Modal Trigger */}
          <button
            onClick={() => setShowUrlModal(true)}
            className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-slate-800/80 text-slate-300 hover:text-white hover:bg-slate-700/80 border border-slate-700/60 text-xs font-medium transition-colors shadow-sm"
            title="Add Image via URL"
          >
            <LinkIcon className="w-3.5 h-3.5 text-indigo-400" />
            <span className="hidden sm:inline">URL</span>
          </button>

          {/* Upload Image Button */}
          <label className="flex items-center space-x-1 px-3 py-1.5 rounded-xl bg-gradient-to-r from-pink-600 to-rose-600 hover:from-pink-500 hover:to-rose-500 text-white text-xs font-semibold cursor-pointer transition-all shadow-md shadow-pink-600/30">
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span className="hidden sm:inline">{isUploading ? 'Uploading...' : 'Upload Image'}</span>
            <input
              type="file"
              accept="image/png, image/jpeg, image/webp, image/gif"
              className="hidden"
              onChange={handleFileUpload}
              disabled={isUploading}
            />
          </label>

          {/* Open Image in New Tab Button */}
          {onOpenInNewTab && (
            <button
              onClick={onOpenInNewTab}
              className="flex items-center space-x-1 px-2.5 py-1.5 rounded-xl bg-indigo-600/20 hover:bg-indigo-600/30 text-indigo-300 hover:text-white border border-indigo-500/30 text-xs font-medium transition-colors shadow-sm"
              title="Open Image Page in New Browser Tab"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span className="hidden md:inline">New Tab</span>
            </button>
          )}

          {/* Delete Active Image Button */}
          {imageState.activeImageUrl && (
            <button
              onClick={() => handleDeleteImage(imageState.activeImageUrl)}
              className="p-2 rounded-xl bg-slate-800/80 text-rose-400 hover:text-white hover:bg-rose-600/80 border border-slate-700/60 transition-colors shadow-sm"
              title="Delete current image from room and storage"
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
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Main Image Stage */}
      <div className="relative flex-1 min-h-0 bg-slate-950 flex items-center justify-center overflow-hidden select-none">
        {/* Ambient Blurred Background for visual depth */}
        {imageState.activeImageUrl && (
          <div
            className="absolute inset-0 bg-cover bg-center blur-3xl opacity-20 transform scale-110 pointer-events-none"
            style={{ backgroundImage: `url(${getMediaUrl(imageState.activeImageUrl)})` }}
          />
        )}

        {/* The Displayed Synchronized Image */}
        {imageState.activeImageUrl && !imageLoadError ? (
          <div className="relative max-h-full max-w-full flex items-center justify-center p-4 overflow-auto">
            <img
              src={getMediaUrl(imageState.activeImageUrl)}
              alt={imageState.activeImageTitle || 'Shared Image'}
              referrerPolicy="no-referrer"
              onError={() => setImageLoadError(true)}
              style={{
                transform: `scale(${localZoom})`,
                transition: 'transform 0.2s cubic-bezier(0.2, 0, 0, 1)'
              }}
              className="max-h-[52vh] lg:max-h-[62vh] max-w-full object-contain rounded-xl shadow-2xl border border-slate-800/80 pointer-events-auto"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center text-center p-6 space-y-3">
            <div className="w-16 h-16 rounded-2xl bg-slate-800/80 border border-slate-700/70 flex items-center justify-center text-slate-500">
              <ImageIcon className="w-8 h-8" />
            </div>
            <p className="text-sm font-medium text-slate-300">
              {imageLoadError ? 'Could not load image file' : 'No image loaded yet'}
            </p>
            <p className="text-xs text-slate-500 max-w-sm">
              Upload a photo, paste an image URL, or choose from our 4K wallpapers above. All participants will view and zoom together in real time!
            </p>
            {imageLoadError && (
              <button
                onClick={() => {
                  setImageLoadError(false);
                  const samplePreset = MEDIA_PRESETS.find(p => p.category === 'image') || MEDIA_PRESETS[0];
                  handleSelectPreset(samplePreset);
                }}
                className="mt-2 px-3.5 py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-xl text-xs font-semibold transition-all shadow-md flex items-center space-x-2"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Switch to 4K Wallpaper Sample</span>
              </button>
            )}
          </div>
        )}

        {/* Carousel Navigation Arrows */}
        {gallery.length > 1 && (
          <>
            <button
              onClick={handlePrevImage}
              className="absolute left-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700/70 shadow-xl transition-all hover:scale-105 z-10"
              title="Previous Image (Synced)"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              onClick={handleNextImage}
              className="absolute right-3 top-1/2 -translate-y-1/2 p-2.5 rounded-full bg-slate-900/80 hover:bg-slate-800 text-white border border-slate-700/70 shadow-xl transition-all hover:scale-105 z-10"
              title="Next Image (Synced)"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Synced Zoom Controls Overlay (Bottom-Right) */}
        <div className="absolute bottom-4 right-4 flex items-center space-x-1.5 bg-slate-900/90 backdrop-blur-md p-1.5 rounded-2xl border border-slate-700/70 shadow-2xl z-10">
          <button
            onClick={() => handleZoomChange(localZoom - 0.25)}
            disabled={localZoom <= 0.5}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
            title="Zoom Out (Synchronized)"
          >
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-xs font-mono font-semibold text-pink-300 px-1 min-w-[42px] text-center">
            {Math.round(localZoom * 100)}%
          </span>
          <button
            onClick={() => handleZoomChange(localZoom + 0.25)}
            disabled={localZoom >= 3}
            className="p-1.5 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 disabled:opacity-40 transition-colors"
            title="Zoom In (Synchronized)"
          >
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            onClick={() => handleZoomChange(1)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] text-pink-300 font-medium rounded-lg transition-colors"
            title="Reset to 100% (Synchronized)"
          >
            100%
          </button>
          <button
            onClick={() => handleZoomChange(2)}
            className="px-2 py-1 bg-slate-800 hover:bg-slate-700 text-[10px] text-pink-300 font-medium rounded-lg transition-colors hidden sm:inline-block"
            title="Zoom 200% (Synchronized)"
          >
            200%
          </button>
        </div>

        {/* Upload Error Banner */}
        {uploadError && (
          <div className="absolute top-4 left-4 right-4 bg-rose-500/90 text-white text-xs px-3 py-2 rounded-xl shadow-xl flex items-center justify-between z-30">
            <span>{uploadError}</span>
            <button onClick={() => setUploadError(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* Shared Room Gallery Carousel (Bottom Bar) */}
      <div className="px-4 py-3 bg-slate-900/95 border-t border-slate-800/80 shrink-0">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center space-x-2">
            <span className="text-xs font-medium text-slate-300">Room Photo Gallery</span>
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
              {gallery.length} items
            </span>
          </div>
          <span className="text-[11px] text-slate-400 hidden sm:inline">
            Click any thumbnail to switch the synchronized photo for everyone
          </span>
        </div>

        {/* Thumbnails Row */}
        <div className="flex items-center space-x-2.5 overflow-x-auto pb-1 scrollbar-thin scrollbar-thumb-slate-700">
          {gallery.map((item) => {
            const isActive = item.url === imageState.activeImageUrl;
            return (
              <div
                key={item.id || item.url}
                className="relative group shrink-0"
              >
                <button
                  onClick={() => handleSelectImage(item)}
                  className={`relative block rounded-xl overflow-hidden border-2 transition-all duration-200 ${
                    isActive
                      ? 'border-pink-500 ring-2 ring-pink-500/40 scale-105'
                      : 'border-slate-800 hover:border-slate-600 opacity-70 hover:opacity-100'
                  }`}
                >
                  <img
                    src={item.thumbnail || item.url}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="w-16 h-12 object-cover"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-1">
                    <span className="text-[9px] text-white truncate max-w-full font-medium">
                      {item.title}
                    </span>
                  </div>
                </button>

                {/* Delete Thumbnail Button */}
                <button
                  type="button"
                  onClick={(e) => handleDeleteImage(item.url, e)}
                  className="absolute -top-1.5 -right-1.5 p-1 bg-slate-900/90 hover:bg-rose-600 text-rose-300 hover:text-white rounded-full border border-slate-700 shadow-md opacity-0 group-hover:opacity-100 transition-all z-20"
                  title="Delete image from lounge"
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
                Add Image from URL
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
                <label className="text-xs text-slate-400">Image URL</label>
                <input
                  type="url"
                  placeholder="https://example.com/photo.jpg"
                  value={imageUrlInput}
                  onChange={(e) => setImageUrlInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-pink-500"
                  required
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-slate-400">Title / Caption (optional)</label>
                <input
                  type="text"
                  placeholder="e.g. Vacation Sunset"
                  value={imageTitleInput}
                  onChange={(e) => setImageTitleInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-xl text-white text-xs focus:outline-none focus:border-pink-500"
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
                  className="px-4 py-2 bg-gradient-to-r from-pink-600 to-rose-600 text-white text-xs font-semibold rounded-xl shadow-md"
                >
                  Add to Room Gallery
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preset Wallpapers Modal */}
      {showPresetsModal && (
        <div className="absolute inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-slate-900 border border-slate-700 p-6 rounded-3xl w-full max-w-lg max-h-[85vh] overflow-y-auto shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Select Curated 4K Wallpaper
              </h3>
              <button
                onClick={() => setShowPresetsModal(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {MEDIA_PRESETS.filter((p) => p.category === 'image').map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handleSelectPreset(preset)}
                  className="flex flex-col text-left bg-slate-800/80 hover:bg-slate-800 rounded-2xl overflow-hidden border border-slate-700/60 transition-all hover:border-pink-500/60 group"
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
