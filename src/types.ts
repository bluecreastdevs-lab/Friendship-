export type UserStatus = 'online' | 'away' | 'busy';

export interface Participant {
  socketId: string;
  name: string;
  avatarColor: string;
  isMuted: boolean;
  status?: UserStatus;
  statusUpdatedAt?: number;
  joinedAt?: number;
  tabHiddenAt?: number;
  statusReason?: string;
}

export interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  avatarColor: string;
  timestamp?: number;
}

export interface TypingPayload {
  roomId: string;
  userName: string;
  isTyping: boolean;
  socketId?: string;
}

export interface MediaState {
  isPlaying: boolean;
  currentTime: number;
  mediaUrl: string;
  mediaType: 'video' | 'audio' | 'image';
  lastUpdated: number;
  mediaTitle?: string;
  uploadedBy?: string;
  duration?: number;
  imageZoom?: number;
}

export interface VideoItem {
  id: string;
  url: string;
  title: string;
  uploadedBy?: string;
  thumbnail?: string;
  timestamp?: number;
  duration?: number;
}

export interface MovieState {
  mediaUrl: string;
  mediaType: 'video';
  isPlaying: boolean;
  currentTime: number;
  duration?: number;
  mediaTitle: string;
  uploadedBy?: string;
  serverTimestamp: number;
  playlist?: VideoItem[];
}

export interface ImageItem {
  id: string;
  url: string;
  title: string;
  uploadedBy?: string;
  thumbnail?: string;
  timestamp?: number;
}

export interface ImageState {
  activeImageUrl: string;
  activeImageTitle: string;
  uploadedBy?: string;
  imageZoom: number;
  gallery: ImageItem[];
  serverTimestamp?: number;
}

export interface MovieActionPayload {
  roomId: string;
  type: 'play' | 'pause' | 'seek' | 'change_movie' | 'heartbeat' | 'add_movie' | 'delete_movie';
  currentTime: number;
  isPlaying: boolean;
  mediaUrl: string;
  mediaTitle: string;
  duration?: number;
  uploadedBy?: string;
  serverTimestamp: number;
  senderId?: string;
  playlist?: VideoItem[];
  playlistItem?: VideoItem;
  deletedMediaUrl?: string;
}

export interface ImageActionPayload {
  roomId: string;
  type: 'select_image' | 'zoom' | 'add_image' | 'delete_image';
  activeImageUrl: string;
  activeImageTitle: string;
  imageZoom?: number;
  gallery?: ImageItem[];
  uploadedBy?: string;
  serverTimestamp: number;
  senderId?: string;
  deletedImageUrl?: string;
}

export interface MediaActionPayload {
  roomId: string;
  mediaUrl: string;
  mediaType: 'video' | 'image' | 'audio';
  type: 'play' | 'pause' | 'seek' | 'change_media' | 'heartbeat' | 'image_view';
  currentTime: number;
  isPlaying?: boolean;
  serverTimestamp: number;
  mediaTitle?: string;
  uploadedBy?: string;
  senderId?: string;
  imageZoom?: number;
}

export interface TabActionPayload {
  roomId: string;
  tab: 'movie' | 'image';
  senderId?: string;
  senderName?: string;
}

