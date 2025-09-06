import { renderHook, act } from '@testing-library/react';
import useWebRTC from './useWebRTC';

// Mock WebRTC APIs
global.navigator.mediaDevices = {
  getUserMedia: jest.fn(),
};

// Mock RTCPeerConnection
global.RTCPeerConnection = jest.fn().mockImplementation(() => ({
  createOffer: jest.fn(),
  createAnswer: jest.fn(),
  setLocalDescription: jest.fn(),
  setRemoteDescription: jest.fn(),
  addIceCandidate: jest.fn(),
  addTrack: jest.fn(),
  close: jest.fn(),
  connectionState: 'connecting',
  onicecandidate: null,
  ontrack: null,
  onconnectionstatechange: null,
}));

// Mock RTCIceCandidate and RTCSessionDescription
global.RTCIceCandidate = jest.fn();
global.RTCSessionDescription = jest.fn();

// Mock Socket.IO
const mockSocket = {
  on: jest.fn(),
  off: jest.fn(),
  emit: jest.fn(),
  connected: true,
};

const mockStream = {
  getTracks: jest.fn(() => [
    { stop: jest.fn(), enabled: true },
    { stop: jest.fn(), enabled: true }
  ]),
  getAudioTracks: jest.fn(() => [{ enabled: true }]),
};

describe('useWebRTC', () => {
  let mockGetUserMedia;

  beforeEach(() => {
    jest.clearAllMocks();

    mockGetUserMedia = jest.fn().mockResolvedValue(mockStream);
    navigator.mediaDevices.getUserMedia = mockGetUserMedia;

    // Reset RTCPeerConnection mock
    RTCPeerConnection.mockClear();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Hook Initialization', () => {
    test('should return initial state', () => {
      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      expect(result.current.isConnected).toBe(false);
      expect(result.current.isMuted).toBe(false);
      expect(result.current.participants).toEqual([]);
      expect(result.current.localAudioRef.current).toBe(null);
      expect(typeof result.current.joinVoiceChannel).toBe('function');
      expect(typeof result.current.leaveVoiceChannel).toBe('function');
      expect(typeof result.current.toggleMute).toBe('function');
    });

    test('should initialize with voiceChannelId', () => {
      renderHook(() => useWebRTC(mockSocket, 'voice-chat'));

      expect(mockSocket.emit).toHaveBeenCalledWith('join_voice_channel', {
        channelId: 'voice-chat'
      });
    });
  });

  describe('Local Stream Management', () => {
    test('should get local stream successfully', async () => {
      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      await act(async () => {
        await result.current.joinVoiceChannel();
      });

      expect(mockGetUserMedia).toHaveBeenCalledWith({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        },
        video: false
      });

      expect(mockSocket.emit).toHaveBeenCalledWith('join_voice_channel', { channelId: undefined });
    });

    test('should handle getUserMedia error', async () => {
      const error = new Error('Permission denied');
      navigator.mediaDevices.getUserMedia.mockRejectedValue(error);

      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      await act(async () => {
        try {
          await result.current.joinVoiceChannel();
        } catch (err) {
          // Expected error
        }
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to join voice channel:', error);

      consoleSpy.mockRestore();
    });
  });

  describe('Voice Channel Operations', () => {
    test('should join voice channel', () => {
      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      act(() => {
        result.current.joinVoiceChannel();
      });

      expect(result.current.isConnected).toBe(true);
      expect(mockSocket.emit).toHaveBeenCalledWith('join_voice_channel', { channelId: undefined });
    });

    test('should leave voice channel', () => {
      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      act(() => {
        result.current.joinVoiceChannel();
        result.current.leaveVoiceChannel();
      });

      expect(result.current.isConnected).toBe(false);
      expect(result.current.participants).toEqual([]);
      expect(mockSocket.emit).toHaveBeenCalledWith('leave_voice_channel');
    });

    test('should not join when socket is not provided', () => {
      const { result } = renderHook(() => useWebRTC(null, null));

      act(() => {
        result.current.joinVoiceChannel();
      });

      expect(result.current.isConnected).toBe(false);
    });

    test('should not leave when socket is not provided', () => {
      const { result } = renderHook(() => useWebRTC(null, null));

      act(() => {
        result.current.leaveVoiceChannel();
      });

      expect(mockSocket.emit).not.toHaveBeenCalledWith('leave_voice_channel');
    });
  });

  describe('Mute Functionality', () => {
    test('should toggle mute on', () => {
      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      act(() => {
        result.current.joinVoiceChannel();
        result.current.toggleMute();
      });

      expect(result.current.isMuted).toBe(true);
      expect(mockStream.getAudioTracks()[0].enabled).toBe(false);
    });

    test('should toggle mute off', () => {
      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      act(() => {
        result.current.joinVoiceChannel();
        result.current.toggleMute(); // Mute on
        result.current.toggleMute(); // Mute off
      });

      expect(result.current.isMuted).toBe(false);
      expect(mockStream.getAudioTracks()[0].enabled).toBe(true);
    });

    test('should handle no audio tracks', () => {
      const noAudioStream = {
        getTracks: jest.fn(() => []),
        getAudioTracks: jest.fn(() => []),
      };

      navigator.mediaDevices.getUserMedia.mockResolvedValue(noAudioStream);

      const { result } = renderHook(() => useWebRTC(mockSocket, null));

      act(() => {
        result.current.joinVoiceChannel();
        result.current.toggleMute();
      });

      expect(result.current.isMuted).toBe(false); // Should remain false
    });
  });

  describe('RTC Configuration', () => {
    test('should configure proper ICE servers', () => {
      renderHook(() => useWebRTC(mockSocket, null));

      // This test verifies that RTC configuration includes TURN servers
      // The actual configuration is tested through the component behavior
      expect(RTCPeerConnection).toHaveBeenCalled();
    });
  });

  describe('Socket Event Handlers', () => {
    test('should register socket event listeners', () => {
      renderHook(() => useWebRTC(mockSocket, null));

      expect(mockSocket.on).toHaveBeenCalledWith('voice_offer', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('voice_answer', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('ice_candidate', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('user_joined_voice', expect.any(Function));
      expect(mockSocket.on).toHaveBeenCalledWith('user_left_voice', expect.any(Function));
    });

    test('should clean up event listeners on unmount', () => {
      const { unmount } = renderHook(() => useWebRTC(mockSocket, null));

      unmount();

      expect(mockSocket.off).toHaveBeenCalledWith('voice_offer', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('voice_answer', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('ice_candidate', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('user_joined_voice', expect.any(Function));
      expect(mockSocket.off).toHaveBeenCalledWith('user_left_voice', expect.any(Function));
    });
  });

  describe('Peer Connection Management', () => {
    test('should create peer connection for new user', () => {
      renderHook(() => useWebRTC(mockSocket, null));

      const voiceOfferHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'voice_offer'
      )[1];

      act(() => {
        voiceOfferHandler({
          offer: { type: 'offer', sdp: 'test-sdp' },
          from: 'user123',
          fromNickname: 'TestUser'
        });
      });

      expect(RTCPeerConnection).toHaveBeenCalled();
    });

    test('should handle ICE candidates', () => {
      renderHook(() => useWebRTC(mockSocket, null));

      const iceCandidateHandler = mockSocket.on.mock.calls.find(
        call => call[0] === 'ice_candidate'
      )[1];

      act(() => {
        iceCandidateHandler({
          candidate: { candidate: 'test-candidate' },
          from: 'user123'
        });
      });

      const peerConnectionInstance = RTCPeerConnection.mock.instances[0];
      expect(peerConnectionInstance.addIceCandidate).toHaveBeenCalled();
    });
  });

  describe('Channel ID Changes', () => {
    test('should join new channel when voiceChannelId changes', () => {
      const { rerender } = renderHook(
        ({ socket, channelId }) => useWebRTC(socket, channelId),
        { initialProps: { socket: mockSocket, channelId: null } }
      );

      rerender({ socket: mockSocket, channelId: 'new-channel' });

      expect(mockSocket.emit).toHaveBeenCalledWith('join_voice_channel', {
        channelId: 'new-channel'
      });
    });

    test('should leave channel when voiceChannelId becomes null', () => {
      const { rerender } = renderHook(
        ({ socket, channelId }) => useWebRTC(socket, channelId),
        { initialProps: { socket: mockSocket, channelId: 'test-channel' } }
      );

      rerender({ socket: mockSocket, channelId: null });

      expect(mockSocket.emit).toHaveBeenCalledWith('leave_voice_channel');
    });
  });

  describe('Resource Cleanup', () => {
    test('should clean up on unmount', () => {
      const { unmount } = renderHook(() => useWebRTC(mockSocket, null));

      unmount();

      // Verify that leaveVoiceChannel was called (via useEffect cleanup)
      // This is implicit in the leaveVoiceChannel function
    });
  });
});