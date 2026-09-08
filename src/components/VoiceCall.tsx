import React, { useState, useEffect, useRef } from 'react';
import { Mic, MicOff, PhoneCall, PhoneOff, Users } from 'lucide-react';
import { Socket } from 'socket.io-client';

interface Participant {
  socketId: string;
  name: string;
  avatarColor: string;
  isMuted: boolean;
}

interface VoiceCallProps {
  socket: Socket | null;
  roomId: string;
  participants: Participant[];
  currentUserSocketId: string;
  onToggleMic: (isMuted: boolean) => void;
}

export default function VoiceCall({ socket, roomId, participants, currentUserSocketId, onToggleMic }: VoiceCallProps) {
  const [isInCall, setIsInCall] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const localStreamRef = useRef<MediaStream | null>(null);
  const peerConnectionsRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const audioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());

  const iceServers = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  const startVoiceCall = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      setIsInCall(true);

      participants.forEach((p) => {
        if (p.socketId !== currentUserSocketId) {
          createPeerConnection(p.socketId, true, stream);
        }
      });
    } catch (err) {
      console.error('Failed to get microphone permissions:', err);
      alert('Could not access microphone for voice call. Please check permissions.');
    }
  };

  const stopVoiceCall = () => {
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;

    peerConnectionsRef.current.forEach((pc) => pc.close());
    peerConnectionsRef.current.clear();

    audioElementsRef.current.forEach((el) => el.remove());
    audioElementsRef.current.clear();

    setIsInCall(false);
    setIsMuted(false);
    onToggleMic(false);
  };

  const toggleMute = () => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      const nextMuted = !audioTrack.enabled;
      setIsMuted(nextMuted);
      onToggleMic(nextMuted);
    }
  };

  const createPeerConnection = (targetSocketId: string, isInitiator: boolean, stream: MediaStream) => {
    if (peerConnectionsRef.current.has(targetSocketId)) return peerConnectionsRef.current.get(targetSocketId);

    const pc = new RTCPeerConnection(iceServers);
    peerConnectionsRef.current.set(targetSocketId, pc);

    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('webrtc-ice', { roomId, candidate: event.candidate, targetSocketId });
      }
    };

    pc.ontrack = (event) => {
      let audioEl = audioElementsRef.current.get(targetSocketId);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.autoplay = true;
        audioEl.srcObject = event.streams[0];
        document.body.appendChild(audioEl);
        audioElementsRef.current.set(targetSocketId, audioEl);
      }
    };

    if (isInitiator && socket) {
      pc.createOffer().then((offer) => {
        pc.setLocalDescription(offer);
        socket.emit('webrtc-offer', { roomId, offer, targetSocketId });
      });
    }

    return pc;
  };

  // Socket signaling listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('webrtc-offer', async ({ offer, senderSocketId }) => {
      if (!localStreamRef.current) return;
      const pc = createPeerConnection(senderSocketId, false, localStreamRef.current);
      if (!pc) return;

      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socket.emit('webrtc-answer', { roomId, answer, targetSocketId: senderSocketId });
    });

    socket.on('webrtc-answer', async ({ answer, senderSocketId }) => {
      const pc = peerConnectionsRef.current.get(senderSocketId);
      if (pc) {
        await pc.setRemoteDescription(new RTCSessionDescription(answer));
      }
    });

    socket.on('webrtc-ice', async ({ candidate, senderSocketId }) => {
      const pc = peerConnectionsRef.current.get(senderSocketId);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    });

    return () => {
      socket.off('webrtc-offer');
      socket.off('webrtc-answer');
      socket.off('webrtc-ice');
    };
  }, [socket, roomId]);

  useEffect(() => {
    return () => {
      stopVoiceCall();
    };
  }, []);

  return (
    <div className="flex flex-col bg-slate-900/80 backdrop-blur-md rounded-2xl border border-slate-700/50 p-4 shadow-2xl">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <Users className="w-4 h-4 text-indigo-400" />
          <h3 className="text-sm font-medium text-slate-200">Voice Lounge</h3>
        </div>
        <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
          isInCall ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-slate-800 text-slate-400'
        }`}>
          {isInCall ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {isInCall ? (
            <>
              <button
                onClick={toggleMute}
                className={`p-2.5 rounded-xl transition-colors ${
                  isMuted ? 'bg-red-600/30 text-red-400 border border-red-500/40' : 'bg-slate-800 hover:bg-slate-700 text-slate-200'
                }`}
                title={isMuted ? "Unmute microphone" : "Mute microphone"}
              >
                {isMuted ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
              </button>
              <button
                onClick={stopVoiceCall}
                className="flex items-center space-x-1.5 px-4 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-medium transition-colors shadow-lg"
              >
                <PhoneOff className="w-4 h-4" />
                <span>Leave Voice</span>
              </button>
            </>
          ) : (
            <button
              onClick={startVoiceCall}
              className="flex items-center space-x-1.5 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-medium transition-colors shadow-lg"
            >
              <PhoneCall className="w-4 h-4" />
              <span>Join Voice Call</span>
            </button>
          )}
        </div>

        <div className="text-xs text-slate-400">
          {participants.filter(p => !p.isMuted).length} speaking
        </div>
      </div>
    </div>
  );
}
