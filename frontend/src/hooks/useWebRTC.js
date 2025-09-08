import { useState, useEffect, useRef, useCallback } from 'react';
import { useSnackbar } from 'notistack';
import webrtcQualityService from '../services/webrtcQualityService';
import turnServerHealthMonitor from '../services/turnServerHealthMonitor';
import bandwidthAdapter from '../utils/bandwidthAdapter';

// Mock JWT token validation (integrate with your JWT service)
const validateTokenWithServer = async (peerId, token) => {
  if (!token) return false;

  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    const now = Date.now() / 1000;

    return payload.exp && payload.exp > now &&
           payload.sub === peerId &&
           payload.iss === window.location.origin;
  } catch (error) {
    console.error('[WebRTC-Security] Token validation error:', error);
    return false;
  }
};

const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed'
};

const RECONNECT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000];

const useWebRTC = (socket, voiceChannelId) => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [participants, setParticipants] = useState([]);
  const [connectionQuality, setConnectionQuality] = useState('unknown');
  const [serverHealth, setServerHealth] = useState(null);
  const [connectionState, setConnectionState] = useState(CONNECTION_STATES.DISCONNECTED);
  const [peerAuthTokens, setPeerAuthTokens] = useState(new Map());

  const localStreamRef = useRef(null);
  const peerConnectionsRef = useRef(new Map());
  const localAudioRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const qualityMonitorRef = useRef(null);
  const connectionAttemptsRef = useRef(new Map());
  const renegotiationTimeoutsRef = useRef(new Map());
  const sdpCacheRef = useRef(new Map());
  const iceCacheRef = useRef(new Map());

  const { enqueueSnackbar } = useSnackbar();

  // Enhanced ICE server configuration with health monitoring
  const getIceServers = useCallback(() => {
    const baseServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' }
    ];

    // Add TURN server if available
    const turnHost = process.env.REACT_APP_TURN_HOST;
    if (turnHost) {
      baseServers.push({
        urls: `turn:${turnHost}`,
        username: process.env.REACT_APP_TURN_USERNAME,
        credential: process.env.REACT_APP_TURN_CREDENTIAL
      });
    }

    // If health monitoring is available, prioritize healthy servers
    if (turnServerHealthMonitor) {
      const bestStun = turnServerHealthMonitor.getBestServer('stun');
      const bestTurn = turnServerHealthMonitor.getBestServer('turn');

      const optimizedServers = [];

      if (bestStun) {
        optimizedServers.push({ urls: bestStun.server.urls });
      }

      if (bestTurn) {
        optimizedServers.push({
          urls: bestTurn.server.urls,
          username: bestTurn.server.username,
          credential: bestTurn.server.credential
        });
      }

      // Fallback to base servers if no healthy servers found
      return optimizedServers.length > 0 ? optimizedServers : baseServers;
    }

    return baseServers;
  }, []);

  const rtcConfiguration = useCallback(() => ({
    iceServers: getIceServers(),
    iceTransportPolicy: 'all',
    bundlePolicy: 'balanced',
    rtcpMuxPolicy: 'require',
    // Enable DTLS for secure connections
    iceCandidatePoolSize: 10
  }), [getIceServers]);

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
      enqueueSnackbar('Не удалось получить доступ к микрофону. Проверьте разрешения.', {
        variant: 'error',
        autoHideDuration: 5000
      });
      throw error;
    }
  }, []);

  // Create peer connection
  const createPeerConnection = useCallback((socketId, nickname) => {
    try {
      const peerConnection = new RTCPeerConnection(rtcConfiguration);

      peerConnection.onicecandidate = (event) => {
        try {
          if (event.candidate && socket) {
            socket.emit('ice_candidate', {
              candidate: event.candidate,
              targetSocketId: socketId
            });
          }
        } catch (error) {
          console.error('Error sending ICE candidate:', error);
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
    } catch (error) {
      console.error('Error creating peer connection:', error);
      enqueueSnackbar('Не удалось создать соединение для голосового чата', {
        variant: 'error',
        autoHideDuration: 5000
      });
      return null;
    }
  }, [socket, enqueueSnackbar]);

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
      enqueueSnackbar('Не удалось присоединиться к голосовому каналу', {
        variant: 'error',
        autoHideDuration: 5000
      });
    }
  }, [socket, voiceChannelId, getLocalStream]);

 // Security: Validate peer connection origins
 const validatePeerOrigin = useCallback((peerId, peerOrigin) => {
  if (!peerOrigin) return false;

  const allowedOrigins = [
    window.location.origin,
    process.env.REACT_APP_ALLOWED_ORIGIN
  ].filter(Boolean);

  const isValidOrigin = allowedOrigins.some(allowed => peerOrigin.startsWith(allowed));
  if (!isValidOrigin) {
    console.warn(`[WebRTC-Security] Invalid peer origin: ${peerOrigin} for peer ${peerId}`);
    enqueueSnackbar(`Небезопасное соединение от ${peerOrigin}`, { variant: 'warning' });
  }

  return isValidOrigin;
}, [enqueueSnackbar]);

 // Security: Validate peer authentication tokens
 const validatePeerToken = useCallback(async (peerId, peerToken) => {
  if (!peerToken) return false;

  try {
    const isValid = await validateTokenWithServer(peerId, peerToken);

    if (!isValid) {
      console.warn(`[WebRTC-Security] Invalid peer token for ${peerId}`);
      enqueueSnackbar(`Проблема аутентификации для ${peerId}`, { variant: 'warning' });
    }

    return isValid;
  } catch (error) {
    console.error(`[WebRTC-Security] Token validation error:`, error);
    return false;
  }
}, []);

 // Add enhanced handlers before useEffect that uses them
 const handleUserJoinedVoiceV2 = useCallback(async (data) => {
  const { nickname, socketId } = data;

  console.log(`[WebRTC] Enhanced: User ${nickname} (${socketId}) joined voice`);

  const peerConnection = await createEnhancedPeerConnection(socketId, nickname);
  if (peerConnection && localStreamRef.current) {
    // Add tracks and create offer
    localStreamRef.current.getTracks().forEach(track => {
      if (track.kind === 'audio') {
        peerConnection.addTrack(track, localStreamRef.current);
      }
    });

    const offer = await peerConnection.createOffer();
    const optimizedOffer = optimizeSDP(offer);
    await peerConnection.setLocalDescription(optimizedOffer);

    socket.emit('voice_offer', {
      offer: optimizedOffer,
      targetSocketId: socketId,
      token: localStorage.getItem('chatToken'), // Include auth token
      origin: window.location.origin
    });
  }
}, [socket]);

 const handleUserLeftVoiceV2 = useCallback((data) => {
  const { socketId } = data;
  cleanupPeerConnection(socketId);

  setParticipants(prev => prev.filter(p => p.socketId !== socketId));
}, []);

 // Cleanup function
 const cleanupPeerConnection = useCallback((socketId) => {
   const peerConnection = peerConnectionsRef.current.get(socketId);
   if (peerConnection) {
     peerConnection.close();
     webrtcQualityService.unregisterConnection(socketId);
     bandwidthAdapter.unregisterConnection(socketId);

     peerConnectionsRef.current.delete(socketId);
   }

   // Clear related timeouts and caches
   const timeoutId = renegotiationTimeoutsRef.current.get(socketId);
   if (timeoutId) {
     clearTimeout(timeoutId);
     renegotiationTimeoutsRef.current.delete(socketId);
   }

   sdpCacheRef.current.delete(socketId);
   iceCacheRef.current.delete(socketId);
   connectionAttemptsRef.current.delete(socketId);
 }, []);

 // Handle connection state changes with enhanced monitoring
 const handleConnectionStateChange = useCallback((socketId, nickname, state) => {
   console.log(`[WebRTC] Peer ${nickname} (${socketId}) connection state: ${state}`);

   switch (state) {
     case 'connected':
       setConnectionState(CONNECTION_STATES.CONNECTED);
       setIsConnected(true);
       webrtcQualityService.handleConnectionStateChange(socketId, state);
       emitConnected(socketId);

       // Start quality monitoring
       if (qualityMonitorRef.current) clearInterval(qualityMonitorRef.current);
       qualityMonitorRef.current = setInterval(() => {
         updateConnectionMetrics(socketId);
       }, 2000);

       enqueueSnackbar(`Соединение с ${nickname} установлено`, {
         variant: 'success',
         autoHideDuration: 3000
       });
       break;

     case 'disconnected':
       setConnectionState(CONNECTION_STATES.DISCONNECTED);
       scheduleReconnection(socketId, nickname);
       break;

     case 'failed':
       setConnectionState(CONNECTION_STATES.FAILED);
       handleReconnection(socketId, nickname);
       enqueueSnackbar(`Соединение с ${nickname} не удалось`, {
         variant: 'error',
         autoHideDuration: 5000
       });
       break;

     case 'connecting':
       setConnectionState(CONNECTION_STATES.CONNECTING);
       break;

     case 'closed':
       cleanupPeerConnection(socketId);
       break;
   }
 }, [enqueueSnackbar]);

 // Handle ICE connection state for monitoring
 const handleICEConnectionStateChange = useCallback((socketId, nickname, state) => {
   console.log(`[WebRTC] ICE connection state for ${nickname}: ${state}`);

   if (state === 'failed') {
     handleReconnection(socketId, nickname);
   } else if (state === 'connected' || state === 'completed') {
     emitICEConnected(socketId, nickname);
   }
 }, []);

 // Handle ICE gathering state with caching
 const handleICEGatheringStateChange = useCallback((socketId, state) => {
   console.log(`[WebRTC] ICE gathering state for ${socketId}: ${state}`);

   if (state === 'complete') {
     // Cache ICE candidates for future use
     if (!iceCacheRef.current.has(socketId)) {
       iceCacheRef.current.set(socketId, []);
     }
     emitICEGatheringComplete(socketId);
   }
 }, []);

 // Handle remote track reception
 const handleRemoteTrack = useCallback((socketId, nickname, stream) => {
   console.log(`[WebRTC] Received remote stream from ${nickname}`);

   setParticipants(prev => {
     const existing = prev.find(p => p.socketId === socketId);
     if (existing) {
       if (existing.audioRef) {
         existing.audioRef.srcObject = stream;
       }
       return prev;
     }
     return [...prev, {
       socketId,
       nickname,
       audioRef: null,
       stream
     }];
   });

   enqueueSnackbar(`${nickname} присоединился к голосовому каналу`, {
     variant: 'info',
     autoHideDuration: 2000
   });
 }, [enqueueSnackbar]);

 // Enhanced peer connection creation with security and monitoring
 const createEnhancedPeerConnection = useCallback(async (socketId, nickname) => {
   try {
     // Enhanced RTC configuration
     const rtcConfig = rtcConfiguration();
     const peerConnection = new RTCPeerConnection(rtcConfig);

     // Register with quality monitoring service
     webrtcQualityService.registerConnection(peerConnection, socketId, nickname);

     // Enhanced event handlers
     peerConnection.onconnectionstatechange = () => {
       const state = peerConnection.connectionState;
       handleConnectionStateChange(socketId, nickname, state);
     };

     peerConnection.oniceconnectionstatechange = () => {
       const state = peerConnection.iceConnectionState;
       handleICEConnectionStateChange(socketId, nickname, state);
     };

     peerConnection.onicestatechange = () => {
       handleICEGatheringStateChange(socketId, peerConnection.iceGatheringState);
     };

     peerConnection.ontrack = (event) => {
       handleRemoteTrack(socketId, nickname, event.streams[0]);
     };

     // Add to connections map
     peerConnectionsRef.current.set(socketId, peerConnection);

     return peerConnection;
   } catch (error) {
     console.error('Error creating enhanced peer connection:', error);
     enqueueSnackbar('Не удалось создать защищенное соединение для голосового чата', {
       variant: 'error',
       autoHideDuration: 5000
     });
     return null;
   }
 }, [rtcConfiguration, enqueueSnackbar, handleConnectionStateChange, handleICEConnectionStateChange, handleICEGatheringStateChange, handleRemoteTrack]);

 // Enhanced ICE candidate handling
 const handleIceCandidateV2 = useCallback((data) => {
   const { candidate, from } = data;

   const peerConnection = peerConnectionsRef.current.get(from);
   if (peerConnection) {
     const iceCandidate = new RTCIceCandidate(candidate);
     peerConnection.addIceCandidate(iceCandidate).catch(error => {
       console.warn(`[WebRTC] Failed to add ICE candidate from ${from}:`, error);
     });

     // Cache for potential renegotiation
     if (!iceCacheRef.current.has(from)) {
       iceCacheRef.current.set(from, []);
     }

     iceCacheRef.current.get(from).push({
       candidate: candidate.candidate,
       sdpMid: candidate.sdpMid,
       sdpMLineIndex: candidate.sdpMLineIndex,
       timestamp: Date.now()
     });

     // Keep only recent ICE candidates (within 30 seconds)
     const now = Date.now();
     const recentCandidates = iceCacheRef.current.get(from).filter(c => now - c.timestamp < 30000);
     iceCacheRef.current.set(from, recentCandidates);
   }
 }, []);

 // Update connection metrics
 const updateConnectionMetrics = useCallback(async (socketId) => {
   const pc = peerConnectionsRef.current.get(socketId);
   if (!pc) return;

   try {
     const stats = await pc.getStats();
     // Basic stats collection (enhanced version would analyze more metrics)
     let outboundBytes = 0;

     stats.forEach(report => {
       if (report.type === 'outbound-rtp') {
         outboundBytes = report.bytesSent || 0;
       }
     });

     // Trigger bandwidth adaptation if needed
     if (bandwidthAdapter && outboundBytes > 0) {
       bandwidthAdapter.handleQualityBasedAdaptation(socketId, connectionQuality);
     }
   } catch (error) {
     console.warn(`[WebRTC] Failed to get metrics for ${socketId}:`, error);
   }
 }, [connectionQuality]);

 // Schedule reconnection with exponential backoff
 const scheduleReconnection = useCallback((socketId, nickname) => {
   const attemptCount = connectionAttemptsRef.current.get(socketId) || 0;

   if (attemptCount >= RECONNECT_BACKOFF.length) {
     console.error(`[WebRTC] Max reconnection attempts reached for ${nickname}`);
     enqueueSnackbar(`Не удалось восстановить соединение с ${nickname}`, {
       variant: 'error',
       autoHideDuration: 5000
     });
     return;
   }

   const delay = RECONNECT_BACKOFF[attemptCount];
   console.log(`[WebRTC] Scheduling reconnection for ${nickname} in ${delay}ms`);

   const timeoutId = setTimeout(() => {
     handleReconnection(socketId, nickname);
   }, delay);

   renegotiationTimeoutsRef.current.set(socketId, timeoutId);
   connectionAttemptsRef.current.set(socketId, attemptCount + 1);
 }, [enqueueSnackbar]);

 // Handle reconnection attempt
 const handleReconnection = useCallback((socketId, nickname) => {
   console.log(`[WebRTC] Attempting reconnection for ${nickname}`);

   const oldConnection = peerConnectionsRef.current.get(socketId);
   if (oldConnection) {
     oldConnection.close();
     peerConnectionsRef.current.delete(socketId);
   }

   // Use cached ICE candidates if available
   const cachedIce = iceCacheRef.current.get(socketId);
   if (cachedIce && cachedIce.length > 0) {
     console.log(`[WebRTC] Using ${cachedIce.length} cached ICE candidates for reconnection`);
   }

   // Use cached SDP if available
   const cachedSdp = sdpCacheRef.current.get(socketId);
   if (cachedSdp) {
     console.log(`[WebRTC] Using cached SDP for reconnection`);
   }

   createEnhancedPeerConnection(socketId, nickname).then(newConnection => {
     if (newConnection) {
       // Implement renegotiation logic here
       negotiateConnection(socketId, nickname, newConnection, true);
     }
   });
 }, [createEnhancedPeerConnection]);

 // Negotiate connection with SDP optimization
 const negotiateConnection = useCallback(async (socketId, nickname, connection, isInitiator) => {
   if (!connection) return;

   try {
     // Get local stream before creating offer
     if (!localStreamRef.current) {
       await getLocalStream();
     }

     // Add local tracks if available
     if (localStreamRef.current) {
       const tracks = localStreamRef.current.getTracks();
       tracks.forEach(track => {
         if (!connection.getSenders().some(sender => sender.track === track)) {
           connection.addTrack(track, localStreamRef.current);
         }
       });
     }

     if (isInitiator) {
       const offer = await connection.createOffer();

       // Optimize SDP size
       const optimizedOffer = optimizeSDP(offer);

       // Cache SDP
       sdpCacheRef.current.set(socketId, {
         offer: optimizedOffer,
         timestamp: Date.now()
       });

       await connection.setLocalDescription(optimizedOffer);

       if (socket) {
         socket.emit('voice_offer', {
           offer: optimizedOffer,
           targetSocketId: socketId
         });
       }
     } else {
       const answer = await connection.createAnswer();
       const optimizedAnswer = optimizeSDP(answer);
       await connection.setLocalDescription(optimizedAnswer);

       if (socket) {
         socket.emit('voice_answer', {
           answer: optimizedAnswer,
           targetSocketId: socketId
         });
       }
     }
   } catch (error) {
     console.error(`[WebRTC] Negotiation failed for ${nickname}:`, error);
     enqueueSnackbar(`Не удалось установить соединение с ${nickname}`, {
       variant: 'error',
       autoHideDuration: 5000
     });
   }
 }, [getLocalStream, socket, enqueueSnackbar]);

 // Optimize SDP message size
 const optimizeSDP = useCallback((sdp) => {
   let optimized = sdp;

   // Remove unnecessary codec options to reduce size
   optimized = optimized.replace(/a=fmtp:\d+.*/g, '');

   // Remove unnecessary bandwidth limits if not needed
   optimized = optimized.replace(/a=bwinfo.*$/gm, '');

   // Ensure we maintain compatibility
   if (optimized.length > sdp.length) {
     optimized = sdp; // Fallback if optimization makes it larger
   }

   return optimized;
 }, []);

 // Enhanced event handlers for WebRTC signaling
 const handleVoiceOfferV2 = useCallback(async (data) => {
   const { offer, from, fromNickname, origin, token } = data;

   // Security validation
   const isValidOrigin = validatePeerOrigin(from, origin);
   const isValidToken = await validatePeerToken(from, token);

   if (!isValidOrigin || !isValidToken) {
     console.error(`[WebRTC] Peer ${fromNickname} failed validation`);
     return;
   }

   const peerConnection = await createEnhancedPeerConnection(from, fromNickname);
   if (peerConnection) {
     await peerConnection.setRemoteDescription(new RTCSessionDescription(offer));
     negotiateConnection(from, fromNickname, peerConnection, false);
   }
 }, [validatePeerOrigin, validatePeerToken, createEnhancedPeerConnection, negotiateConnection]);

 // Event emission helpers
 const emitConnected = useCallback((socketId) => {
   console.log(`[WebRTC] Peer ${socketId} connected successfully with security`);
 }, []);

 const emitICEConnected = useCallback((socketId, nickname) => {
   console.log(`[WebRTC] ICE connection established for ${nickname}`);
 }, []);

 const emitICEGatheringComplete = useCallback((socketId) => {
   console.log(`[WebRTC] ICE gathering completed for ${socketId}`);
 }, []);

 // Leave voice channel with enhanced cleanup
 const leaveVoiceChannel = useCallback(() => {
   if (!socket) return;

   // Stop quality monitoring
   if (qualityMonitorRef.current) {
     clearInterval(qualityMonitorRef.current);
     qualityMonitorRef.current = null;
   }

   // Clear reconnection timeouts
   renegotiationTimeoutsRef.current.forEach(timeoutId => clearTimeout(timeoutId));
   renegotiationTimeoutsRef.current.clear();

   // Clear all connections
   peerConnectionsRef.current.forEach(peerConnection => {
     peerConnection.close();
     webrtcQualityService.unregisterConnection(peerConnection);
   });
   peerConnectionsRef.current.clear();

   // Clear caches
   sdpCacheRef.current.clear();
   iceCacheRef.current.clear();
   connectionAttemptsRef.current.clear();

   // Stop local stream
   if (localStreamRef.current) {
     localStreamRef.current.getTracks().forEach(track => track.stop());
     localStreamRef.current = null;
   }

   socket.emit('leave_voice_channel');
   setIsConnected(false);
   setParticipants([]);
   setConnectionState(CONNECTION_STATES.DISCONNECTED);
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

 // Enhanced effect for joining voice channel
 useEffect(() => {
   if (voiceChannelId && socket) {
     if (socket.emit) { // Ensure socket is ready
       joinVoiceChannel();
     }
   } else if (!voiceChannelId) {
     leaveVoiceChannel();
   }
 }, [voiceChannelId, socket, joinVoiceChannel, leaveVoiceChannel]);

 // Legacy handlers for compatibility
 const handleVoiceAnswer = useCallback(async (data) => {
   const { answer, from } = data;

   const peerConnection = peerConnectionsRef.current.get(from);
   if (peerConnection && peerConnection.remoteDescription === null) {
     try {
       await peerConnection.setRemoteDescription(new RTCSessionDescription(answer));
       console.log(`[WebRTC] Answer processed from ${from}`);
     } catch (error) {
       console.error(`[WebRTC] Error processing answer from ${from}:`, error);
     }
   }
 }, []);

 const handleIceCandidate = useCallback(async (data) => {
   const { candidate, from } = data;

   try {
     const peerConnection = peerConnectionsRef.current.get(from);
     if (peerConnection) {
       await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
       console.log(`[WebRTC] ICE candidate added from ${from}`);
     }
   } catch (error) {
     console.warn(`[WebRTC] Error adding ICE candidate from ${from}:`, error);
   }
 }, []);

 // Enhanced socket listeners
 useEffect(() => {
   if (!socket) return;

   socket.on('voice_offer', handleVoiceOfferV2);
   socket.on('voice_answer', handleVoiceAnswer);
   socket.on('ice_candidate', handleIceCandidate);
   socket.on('user_joined_voice', handleUserJoinedVoiceV2);
   socket.on('user_left_voice', handleUserLeftVoiceV2);

   return () => {
     socket.off('voice_offer', handleVoiceOfferV2);
     socket.off('voice_answer', handleVoiceAnswer);
     socket.off('ice_candidate', handleIceCandidate);
     socket.off('user_joined_voice', handleUserJoinedVoiceV2);
     socket.off('user_left_voice', handleUserLeftVoiceV2);
   };
 }, [socket, handleVoiceOfferV2, handleVoiceAnswer, handleIceCandidate, handleUserJoinedVoiceV2, handleUserLeftVoiceV2]);


 return {
   isConnected,
   isMuted,
   participants: participants, // Renamed from participants to voiceParticipants for backward compatibility
   localAudioRef,
   joinVoiceChannel,
   leaveVoiceChannel,
   toggleMute,
   // Enhanced features
   connectionState,
   connectionQuality,
   serverHealth,
   validatePeerOrigin,
   validatePeerToken
 };
};

export default useWebRTC;