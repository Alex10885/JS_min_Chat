// Enhanced WebRTC Hook with Security & Reliability Features
// Integrates connection monitoring, quality tracking, and secure peer communication

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import webrtcQualityService from './services/webrtcQualityService';
import turnServerHealthMonitor from './services/turnServerHealthMonitor';
import bandwidthAdapter from './utils/bandwidthAdapter';
import { useWebRTCContext } from './contexts/WebRTCContext';

const CONNECTION_STATES = {
  DISCONNECTED: 'disconnected',
  CONNECTING: 'connecting',
  CONNECTED: 'connected',
  RECONNECTING: 'reconnecting',
  FAILED: 'failed'
};

// Token validation function (integrates with backend JWT)
const validateTokenWithServer = async (peerId, token) => {
  if (!token) return false;

  try {
    // In production, validate JWT against server endpoint
    // For now, implement basic validation
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
const RECONNECT_BACKOFF = [1000, 2000, 4000, 8000, 16000, 30000]; // Exponential backoff delays

export function useWebRTC(socket, userId, channelId) {
  const context = useWebRTCContext();

  // Core state
  const [connectionState, setConnectionState] = useState(CONNECTION_STATES.DISCONNECTED);
  const [peers, setPeers] = useState(new Map());
  const [iceCandidates, setIceCandidates] = useState({});
  const [audioContext, setAudioContext] = useState(null);
  const [peerConnections, setPeerConnections] = useState(new Map());

  // Monitoring and quality state
  const [connectionQuality, setConnectionQuality] = useState('unknown');
  const [connectionMetrics, setConnectionMetrics] = useState({
    latency: null,
    packetLoss: 0,
    bitrate: 0,
    bytesSent: 0,
    bytesReceived: 0
  });
  const [bandwidthProfile, setBandwidthProfile] = useState('normal');

  // Security and validation state
  const [peerAuthTokens, setPeerAuthTokens] = useState(new Map());
  const [connectionAttempts, setConnectionAttempts] = useState(new Map());

  // Performance optimization state
  const [renegotiationTimeouts, setRenegotiationTimeouts] = useState(new Map());
  const [sdpCache, setSdpCache] = useState(new Map());
  const [iceCache, setIceCache] = useState(new Map());

  // Error handling state
  const [errors, setErrors] = useState([]);
  const [rebuildAttempts, setRebuildAttempts] = useState(new Map());

  // Refs for cleanup and async operations
  const localStreamRef = useRef(null);
  const mainPeerConnectionRef = useRef(null);
  const reconnectTimeoutRef = useRef(null);
  const qualityMonitorRef = useRef(null);

  // Security: Validate peer connection origins
  const validatePeerOrigin = useCallback((peerId, peerOrigin) => {
    if (!peerOrigin) return false;

    // Check against allowed origins (extend as needed)
    const allowedOrigins = [
      window.location.origin,
      process.env.REACT_APP_ALLOWED_ORIGIN
    ].filter(Boolean);

    const isValidOrigin = allowedOrigins.some(allowed => peerOrigin.startsWith(allowed));
    if (!isValidOrigin) {
      console.warn(`[WebRTC-Security] Invalid peer origin: ${peerOrigin} for peer ${peerId}`);
      emitError(new Error(`Unauthorized peer origin: ${peerOrigin}`));
    }

    return isValidOrigin;
  }, []);

  // Security: Validate peer authentication tokens
  const validatePeerToken = useCallback(async (peerId, peerToken) => {
    if (!peerToken) return false;

    try {
      // In a real implementation, validate JWT against server
      const isValid = await validateTokenWithServer(peerId, peerToken);

      if (!isValid) {
        console.warn(`[WebRTC-Security] Invalid peer token for ${peerId}`);
        emitError(new Error(`Peer authentication failed for ${peerId}`));
      }

      return isValid;
    } catch (error) {
      console.error(`[WebRTC-Security] Token validation error:`, error);
      return false;
    }
  }, []);

  // Create secure RTCPeerConnection with enhanced configuration
  const createSecurePeerConnection = useCallback(async (peerId, isInitiator = false) => {
    try {
      // Get best ICE servers based on health monitoring
      const bestTurnServer = turnServerHealthMonitor.getBestServer('turn');
      const bestStunServer = turnServerHealthMonitor.getBestServer('stun');

      const iceServers = [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
      ];

      if (bestStunServer) {
        iceServers.unshift(bestStunServer);
      }

      if (bestTurnServer) {
        iceServers.unshift({
          urls: bestTurnServer.server.urls,
          username: bestTurnServer.server.username,
          credential: bestTurnServer.server.credential
        });
      }

      const pc = new RTCPeerConnection({
        iceServers,
        iceCandidatePoolSize: 10,
        iceTransportPolicy: 'all',
        bundlePolicy: 'max-bundle',
        rtcpMuxPolicy: 'require'
      });

      // Register with quality monitoring service
      webrtcQualityService.registerConnection(pc, peerId, `${peerId}-user`);

      // Enhanced event handlers
      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        handleConnectionStateChange(peerId, state);
      };

      pc.oniceconnectionstatechange = () => {
        const state = pc.iceConnectionState;
        handleICEConnectionStateChange(peerId, state);
      };

      pc.onicecandidate = (event) => {
        handleICECandidate(peerId, event.candidate, isInitiator);
      };

      pc.onicegatheringstatechange = () => {
        handleICEGatheringStateChange(peerId, pc.iceGatheringState);
      };

      pc.ontrack = (event) => {
        handleRemoteTrack(peerId, event.streams[0]);
      };

      // Listen for connection state changes
      handleConnectionStateChange(peerId, pc.connectionState);

      // Add to peer connections map
      setPeerConnections(prev => new Map(prev).set(peerId, pc));

      return pc;
    } catch (error) {
      console.error(`[WebRTC] Failed to create peer connection for ${peerId}:`, error);
      emitError(error);
      return null;
    }
  }, []);

  // Handle connection state changes with enhanced monitoring
  const handleConnectionStateChange = useCallback((peerId, state) => {
    console.log(`[WebRTC] Peer ${peerId} connection state: ${state}`);

    const states = CONNECTION_STATES;

    switch (state) {
      case 'connected':
        setConnectionState(states.CONNECTED);
        updateConnectionAttempts(peerId, 0); // Reset attempt counter
        emitConnected(peerId);

        // Update connection quality monitoring
        if (qualityMonitorRef.current) {
          clearInterval(qualityMonitorRef.current);
        }
        qualityMonitorRef.current = setInterval(() => {
          updateConnectionMetrics(peerId);
        }, 2000);
        break;

      case 'disconnected':
        setConnectionState(states.DISCONNECTED);
        scheduleReconnection(peerId);
        break;

      case 'failed':
        setConnectionState(states.FAILED);
        handleReconnection(peerId);
        break;

      case 'connecting':
        setConnectionState(states.CONNECTING);
        break;

      case 'closed':
        cleanupPeerConnection(peerId);
        break;
    }

    // Notify quality service
    webrtcQualityService.handleConnectionStateChange(peerId, state);
  }, []);

  // Enhanced ICE candidate handling with caching
  const handleICECandidate = useCallback((peerId, candidate, isInitiator) => {
    if (!candidate) {
      console.log(`[WebRTC] ICE gathering completed for peer ${peerId}`);
      return;
    }

    // Cache ICE candidates for performance
    if (!iceCache.has(peerId)) {
      iceCache.set(peerId, []);
    }

    const peerCache = iceCache.get(peerId);
    peerCache.push({
      candidate: candidate.candidate,
      sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex,
      timestamp: Date.now()
    });

    // Keep only recent ICE candidates (within 30 seconds)
    const now = Date.now();
    const recentCandidates = peerCache.filter(c => now - c.timestamp < 30000);
    iceCache.set(peerId, recentCandidates);

    setIceCache(new Map(iceCache));

    // Emit ICE candidate to remote peer
    if (socket && socket.connected) {
      socket.emit('webrtc-ice-candidate', {
        targetPeerId: peerId,
        candidate: candidate,
        fromPeerId: userId
      });
    }
  }, [socket, userId]);

  // Handle ICE gathering state for monitoring
  const handleICEGatheringStateChange = useCallback((peerId, state) => {
    console.log(`[WebRTC] ICE gathering state for ${peerId}: ${state}`);

    if (state === 'complete') {
      emitICEGatheringComplete(peerId);
    }
  }, []);

  // Schedule reconnection with exponential backoff
  const scheduleReconnection = useCallback((peerId) => {
    const attemptCount = getReconnectionAttempts(peerId);
    const maxAttempts = RECONNECT_BACKOFF.length;

    if (attemptCount >= maxAttempts) {
      console.error(`[WebRTC] Max reconnection attempts reached for peer ${peerId}`);
      setConnectionState(CONNECTION_STATES.FAILED);
      return;
    }

    const delay = RECONNECT_BACKOFF[attemptCount] || RECONNECT_BACKOFF[maxAttempts - 1];
    console.log(`[WebRTC] Scheduling reconnection for ${peerId} in ${delay}ms (attempt ${attemptCount + 1})`);

    const timeout = setTimeout(() => {
      handleReconnection(peerId);
    }, delay);

    reconnectTimeoutRef.current = timeout;
    updateReconnectionAttempts(peerId, attemptCount + 1);
  }, []);

  // Handle ICE connection state for monitoring
  const handleICEConnectionStateChange = useCallback((peerId, state) => {
    console.log(`[WebRTC] ICE connection state for ${peerId}: ${state}`);

    if (state === 'failed') {
      handleReconnection(peerId);
    } else if (state === 'connected' || state === 'completed') {
      emitICEConnected(peerId);
    }
  }, []);

  // Handle remote track reception
  const handleRemoteTrack = useCallback((peerId, stream) => {
    console.log(`[WebRTC] Received remote stream from ${peerId}`);

    setPeers(prevPeers => {
      const newPeers = new Map(prevPeers);
      const peerData = newPeers.get(peerId) || { id: peerId };
      peerData.stream = stream;
      newPeers.set(peerId, peerData);
      return newPeers;
    });

    // Auto-play remote video/audio (browsers usually block autoplay)
    const audio = new Audio();
    audio.muted = true; // Start muted to allow autoplay
    audio.volume = 0.5;

    if (stream.getAudioTracks().length > 0) {
      const track = stream.getAudioTracks()[0];
      track.enabled = true; // Ensure track is enabled
    }
  }, []);

  // Update connection metrics and quality
  const updateConnectionMetrics = useCallback((peerId) => {
    const pc = peerConnections.get(peerId);
    if (!pc) return;

    pc.getStats().then(stats => {
      let bytesSent = 0, bytesReceived = 0, packetsSent = 0, packetsReceived = 0;

      stats.forEach(report => {
        if (report.type === 'outbound-rtp') {
          bytesSent += report.bytesSent || 0;
          packetsSent += report.packetsSent || 0;
        } else if (report.type === 'inbound-rtp') {
          bytesReceived += report.bytesReceived || 0;
          packetsReceived += report.packetsReceived || 0;
        }
      });

      const metrics = {
        bytesSent,
        bytesReceived,
        packetsSent,
        packetsReceived,
        timestamp: Date.now()
      };

      setConnectionMetrics(metrics);
    }).catch(error => {
      console.warn(`[WebRTC] Failed to get metrics for ${peerId}:`, error);
    });
  }, [peerConnections]);

  // Get reconnection attempts count
  const getReconnectionAttempts = useCallback((peerId) => {
    return connectionAttempts.get(peerId) || 0;
  }, [connectionAttempts]);

  // Update reconnection attempts
  const updateReconnectionAttempts = useCallback((peerId, count) => {
    setConnectionAttempts(prev => new Map(prev).set(peerId, count));
  }, []);

  const updateConnectionAttempts = useCallback((peerId, count) => {
    setConnectionAttempts(prev => new Map(prev).set(peerId, count));
  }, []);

  // Handle reconnection attempt
  const handleReconnection = useCallback((peerId) => {
    console.log(`[WebRTC] Attempting reconnection for peer ${peerId}`);

    const oldConnection = peerConnections.get(peerId);

    if (oldConnection) {
      oldConnection.close();
      setPeerConnections(prev => {
        const newConnections = new Map(prev);
        newConnections.delete(peerId);
        return newConnections;
      });
    }

    // Create new connection
    createSecurePeerConnection(peerId, true).then(newConnection => {
      if (newConnection) {
        negotiateConnection(peerId, newConnection, true);
      }
    });
  }, [peerConnections]);

  // Negotiate connection with SDP optimization
  const negotiateConnection = useCallback(async (peerId, connection, isInitiator = false) => {
    try {
      if (isInitiator) {
        const offer = await connection.createOffer();

        // Optimize SDP size
        const optimizedOffer = optimizeSDP(offer);

        // Cache SDP for renegotiation prevention
        sdpCache.set(peerId, {
          offer: optimizedOffer,
          timestamp: Date.now()
        });
        setSdpCache(new Map(sdpCache));

        await connection.setLocalDescription(optimizedOffer);

        // Send optimized SDP to remote peer
        if (socket && socket.connected) {
          socket.emit('webrtc-offer', {
            targetPeerId: peerId,
            offer: optimizedOffer,
            fromPeerId: userId
          });
        }
      } else {
        // Answer offer
        connection.createAnswer().then(async answer => {
          const optimizedAnswer = optimizeSDP(answer);
          await connection.setLocalDescription(optimizedAnswer);

          if (socket && socket.connected) {
            socket.emit('webrtc-answer', {
              targetPeerId: peerId,
              answer: optimizedAnswer,
              fromPeerId: userId
            });
          }
        });
      }
    } catch (error) {
      console.error(`[WebRTC] Negotiation failed for ${peerId}:`, error);
      emitError(error);
    }
  }, [socket, userId]);

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

  // Event emission helpers
  const emitError = useCallback((error) => {
    setErrors(prev => [...prev, { ...error, timestamp: Date.now() }]);
    console.error('[WebRTC] Error:', error);
  }, []);

  const emitConnected = useCallback((peerId) => {
    console.log(`[WebRTC] Peer ${peerId} connected successfully`);
  }, []);

  const emitICEConnected = useCallback((peerId) => {
    console.log(`[WebRTC] ICE connection established for peer ${peerId}`);
  }, []);

  const emitICEGatheringComplete = useCallback((peerId) => {
    console.log(`[WebRTC] ICE gathering completed for peer ${peerId}`);
  }, []);

  // Initialize WebRTC context
  useEffect(() => {
    console.log('[WebRTC] Initializing enhanced WebRTC hook');

    // Initialize TURN server monitoring
    turnServerHealthMonitor.startMonitoring();

    // Setup socket event listeners for WebRTC signaling
    if (socket) {
      socket.on('webrtc-offer', handleOffer);
      socket.on('webrtc-answer', handleAnswer);
      socket.on('webrtc-ice-candidate', handleRemoteICECandidate);
      socket.on('webrtc-peer-joined', handlePeerJoined);
      socket.on('webrtc-peer-left', handlePeerLeft);
    }

    return () => {
      // Cleanup
      turnServerHealthMonitor.stopMonitoring();

      if (socket) {
        socket.off('webrtc-offer', handleOffer);
        socket.off('webrtc-answer', handleAnswer);
        socket.off('webrtc-ice-candidate', handleRemoteICECandidate);
        socket.off('webrtc-peer-joined', handlePeerJoined);
        socket.off('webrtc-peer-left', handlePeerLeft);
      }

      // Cleanup all peer connections
      peerConnections.forEach((pc, peerId) => {
        pc.close();
        webrtcQualityService.unregisterConnection(peerId);
      });

      if (qualityMonitorRef.current) {
        clearInterval(qualityMonitorRef.current);
      }

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, [socket, peerConnections]);

  // Socket event handlers
  const handleOffer = useCallback(async (data) => {
    const { offer, fromPeerId } = data;

    // Security: Validate peer origin and token
    const isValidOrigin = validatePeerOrigin(fromPeerId, data.origin);
    const isValidToken = await validatePeerToken(fromPeerId, data.token);

    if (!isValidOrigin || !isValidToken) {
      console.error(`[WebRTC] Peer ${fromPeerId} failed validation`);
      return;
    }

    const pc = await createSecurePeerConnection(fromPeerId, false);
    if (pc) {
      await pc.setRemoteDescription(offer);
      negotiateConnection(fromPeerId, pc, false);
    }
  }, [validatePeerOrigin, validatePeerToken, createSecurePeerConnection, negotiateConnection]);

  const handleAnswer = useCallback(async (data) => {
    const { answer, fromPeerId } = data;
    const pc = peerConnections.get(fromPeerId);

    if (pc && pc.remoteDescription === null) {
      await pc.setRemoteDescription(answer);
    }
  }, [peerConnections]);

  const handleRemoteICECandidate = useCallback((data) => {
    const { candidate, fromPeerId } = data;
    const pc = peerConnections.get(fromPeerId);

    if (pc && pc.remoteDescription) {
      pc.addIceCandidate(candidate).catch(error => {
        console.warn(`[WebRTC] Failed to add ICE candidate from ${fromPeerId}:`, error);
      });
    }
  }, [peerConnections]);

  const handlePeerJoined = useCallback((data) => {
    const { peerId, channelId: peerChannelId } = data;

    if (peerChannelId === channelId) {
      console.log(`[WebRTC] Peer ${peerId} joined channel ${channelId}`);
      createSecurePeerConnection(peerId, userId > peerId).then(pc => {
        if (pc) {
          negotiateConnection(peerId, pc, true);
        }
      });
    }
  }, [channelId, userId, createSecurePeerConnection, negotiateConnection]);

  const handlePeerLeft = useCallback((peerId) => {
    console.log(`[WebRTC] Peer ${peerId} left`);
    cleanupPeerConnection(peerId);
  }, []);

  // Cleanup peer connection
  const cleanupPeerConnection = useCallback((peerId) => {
    const pc = peerConnections.get(peerId);
    if (pc) {
      pc.close();

      webrtcQualityService.unregisterConnection(peerId);
      bandwidthAdapter.unregisterConnection(peerId);

      setPeerConnections(prev => {
        const newConnections = new Map(prev);
        newConnections.delete(peerId);
        return newConnections;
      });

      // Reset connection state if this was the last peer
      if (peerConnections.size === 1) {
        setConnectionState(CONNECTION_STATES.DISCONNECTED);
      }
    }

    // Cleanup cached data
    sdpCache.delete(peerId);
    iceCache.delete(peerId);
  }, [peerConnections]);

  // Public API methods
  const joinChannel = useCallback(async () => {
    if (!socket || !socket.connected) {
      throw new Error('Socket not connected');
    }

    console.log(`[WebRTC] Joining channel ${channelId}`);

    // Notify server about joining channel
    socket.emit('join-channel', { channelId, userId });

    setConnectionState(CONNECTION_STATES.CONNECTING);
  }, [socket, channelId, userId]);

  const leaveChannel = useCallback(() => {
    console.log(`[WebRTC] Leaving channel ${channelId}`);

    // Notify server about leaving
    if (socket && socket.connected) {
      socket.emit('leave-channel', { channelId, userId });
    }

    // Cleanup all connections
    peerConnections.forEach((pc, peerId) => {
      cleanupPeerConnection(peerId);
    });

    setConnectionState(CONNECTION_STATES.DISCONNECTED);
  }, [socket, channelId, userId, peerConnections, cleanupPeerConnection]);

  const mute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = false;
      });
    }
  }, []);

  const unmute = useCallback(() => {
    if (localStreamRef.current) {
      const audioTracks = localStreamRef.current.getAudioTracks();
      audioTracks.forEach(track => {
        track.enabled = true;
      });
    }
  }, []);

  // Get connection status for UI
  const getConnectionStatus = useCallback(() => {
    return {
      state: connectionState,
      quality: connectionQuality,
      metrics: connectionMetrics,
      bandwidthProfile,
      serverHealth: turnServerHealthMonitor.getHealthReport(),
      peerCount: peerConnections.size
    };
  }, [connectionState, connectionQuality, connectionMetrics, bandwidthProfile, peerConnections.size]);

  // Navigate to better TURN server if needed
  const optimizeConnection = useCallback(() => {
    const servesHealth = turnServerHealthMonitor.getHealthReport();

    if (servesHealth.overallStatus === 'critical') {
      console.warn('[WebRTC] TURN/STUN servers have poor health, connection quality may be affected');
    }

    // Force bandwidth adaptation based on quality
    webrtcQualityService.connections.forEach((_, socketId) => {
      const pc = peerConnections.get(socketId);
      if (pc) {
        bandwidthAdapter.handleQualityBasedAdaptation(socketId, connectionQuality);
      }
    });
  }, [connectionQuality, peerConnections]);

  // Memoized hooks API
  return useMemo(() => ({
    // State
    peers: Array.from(peers.values()),
    connectionState,
    connectionQuality,
    connectionMetrics,
    bandwidthProfile,
    errors,

    // Actions
    joinChannel,
    leaveChannel,
    mute,
    unmute,

    // Monitoring
    getConnectionStatus,
    optimizeConnection,

    // Performance
    cacheSize: sdpCache.size,

    // Security
    validatePeerOrigin,
    validatePeerToken,

    // Emergency
    forceReconnect: (peerId) => handleReconnection(peerId),
    clearErrors: () => setErrors([])

  }), [
    peers,
    connectionState,
    connectionQuality,
    connectionMetrics,
    bandwidthProfile,
    errors,
    joinChannel,
    leaveChannel,
    mute,
    unmute,
    getConnectionStatus,
    optimizeConnection,
    sdpCache.size,
    validatePeerOrigin,
    validatePeerToken
  ]);
}

export default useWebRTC;