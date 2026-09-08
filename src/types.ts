export interface Participant {
  socketId: string;
  name: string;
  avatarColor: string;
  isMuted: boolean;
}

export interface Message {
  id: string;
  sender: string;
  text: string;
  time: string;
  avatarColor: string;
}

export interface MediaState {
  isPlaying: boolean;
  currentTime: number;
  mediaUrl: string;
  mediaType: 'video' | 'audio' | 'image';
  lastUpdated: number;
}
