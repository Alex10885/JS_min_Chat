import { useState, useEffect, useRef, useCallback } from 'react';

const useWebRTC = (socket, voiceChannelId) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState([]);
  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const localAudioRef = useRef(null);

  // Configuration for RTCPeerConnection
  const rtcConfiguration = {
    iceServers: [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ]
  };

  // Get local audio stream
  const getLocalStream = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      localStreamRef.current = stream;

      if (localAudioRef.current) {
        localAudioRef.current.srcObject = stream;
        localAudioRef.current.muted = true; // Prevent feedback
      }

      return stream;
    } catch (error) {
      console.error('Failed to get local audio stream:', error);
      throw error;
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback((socketId, nickname) => {
    const peerConnection = new RTCPeerConnection(rtcConfiguration);

    peerConnection.onicecandidate = (event) => {
      if (event.candidate && socket) {
        socket.emit('ice_candidate', {
          candidate: event.candidate,
          targetSocketId: socketId
        });
      }
    };

    peerConnection.ontrack = (event) => {
      setParticipants(prev => {
        const existing = prev.find(p => p.socketId === socketId);
        if (existing) {
          if (existing.audioRef) {
            existing.audioRef.srcObject = event.streams[0];
          }
          return prev;
        }
        return [...prev, {
          socketId,
          nickname,
          audioRef: null,
          stream: event.streams[0]
        }];
      });
    };

    peerConnection.onconnectionstatechange = () => {
      console.log(`Connection state with ${nickname}:`, peerConnection.connectionState);
    };

    return peerConnection;
  }, [socket]);

  // Handle incoming offer
  useEffect(() => {
    if (!socket) return;

    const handleVoiceOffer = async (data) => {
      const { offer, from, fromNickname } = data;

      try {
        let peerConnection = peerConnectionsRef.current.get(from);
        if (!peerConnection) {
          peerConnection = createPeerConnection(from, fromNickname);
          peerConnectionsRef.current.set(from, peerConnection);
        }

        await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));

        // Add local stream tracks
        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStreamRef.current);
          });
        }

        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);

        socket.emit('voice_answer', {
          answer,
          targetSocketId: from
        });
      } catch (error) {
        console.error('Error handling voice offer:', error);
      }
    };

    const handleVoiceAnswer = async (data) => {
      const { answer, from } = data;

      try {
        const peerConnection = peerConnectionsRef.current.get(from);
        if (peerConnection) {
          await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
        }
      } catch (error) {
        console.error('Error handling voice answer:', error);
      }
    };

    const handleIceCandidate = async (data) => {
      const { candidate, from } = data;

      try {
        const peerConnection = peerConnectionsRef.current.get(from);
        if (peerConnection) {
          await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
        }
      } catch (error) {
        console.error('Error adding ICE candidate:', error);
      }
    };

    const handleUserJoinedVoice = async (data) => {
      const { nickname, socketId } = data;

      // Create connection and send offer
      try {
        const peerConnection = createPeerConnection(socketId, nickname);
        peerConnectionsRef.current.set(socketId, peerConnection);

        if (localStreamRef.current) {
          localStreamRef.current.getTracks().forEach(track => {
            peerConnection.addTrack(track, localStreamRef.current);
          });
        }

        const offer = await peerConnection.createOffer();
        await peerConnection.setLocalDescription(offer);

        socket.emit('voice_offer', {
          offer,
          targetSocketId: socketId
        });
      } catch (error) {
        console.error('Error creating offer for new participant:', error);
      }
    };

    const handleUserLeftVoice = (data) => {
      const { socketId } = data;

      const peerConnection = peerConnectionsRef.current.get(socketId);
      if (peerConnection) {
        peerConnection.close();
        peerConnectionsRef.current.delete(socketId);
      }

      setParticipants(prev => prev.filter(p => p.socketId !== socketId));
    };

    socket.on('voice_offer', handleVoiceOffer);
    socket.on('voice_answer', handleVoiceAnswer);
    socket.on('ice_candidate', handleIceCandidate);
    socket.on('user_joined_voice', handleUserJoinedVoice);
    socket.on('user_left_voice', handleUserLeftVoice);

    return () => {
      socket.off('voice_offer', handleVoiceOffer);
      socket.off('voice_answer', handleVoiceAnswer);
      socket.off('ice_candidate', handleIceCandidate);
      socket.off('user_joined_voice', handleUserJoinedVoice);
      socket.off('user_left_voice', handleUserLeftVoice);
    };
  }, [socket, createPeerConnection]);

  // Join voice channel
  const joinVoiceChannel = useCallback(async () => {
    if (!socket || !voiceChannelId) return;

    try {
      const stream = await getLocalStream();
      setIsConnected(true);

      socket.emit('join_voice_channel', { channelId: voiceChannelId });
    } catch (error) {
      console.error('Failed to join voice channel:', error);
    }
  }, [socket, voiceChannelId, getLocalStream]);

  // Leave voice channel
  const leaveVoiceChannel = useCallback(() => {
    if (!socket) return;

    // Close all peer connections
    peerConnectionsRef.current.forEach(peerConnection => peerConnection.close());
    peerConnectionsRef.current.clear();

    // Stop local stream
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => track.stop());
      localStreamRef.current = null;
    }

    socket.emit('leave_voice_channel');
    setIsConnected(false);
    setParticipants([]);
  }, [socket]);

  // Toggle mute
  const toggleMute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = !track.enabled;
      });
      setIsMuted(!audioTracks[0]?.enabled ?? isMuted);
    }
  }, [isMuted]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      leaveVoiceChannel();
    };
  }, [leaveVoiceChannel]);

  // Join when voiceChannelId changes and is not empty
  useEffect(() => {
    if (voiceChannelId && socket) {
      joinVoiceChannel();
    } else if (!voiceChannelId) {
      leaveVoiceChannel();
    }
  }, [voiceChannelId, socket, joinVoiceChannel, leaveVoiceChannel]);

  return {
    isConnected,
    isMuted,
    participants,
    localAudioRef,
    joinVoiceChannel,
    leaveVoiceChannel,
    toggleMute
  };
};

export default useWebRTC;