// Shared mocks for Jest tests

// WebRTC Mocks
export const createWebRTCMocks = () => ({
  RTCPeerConnection: jest.fn().mockImplementation(() => ({
    createOffer: jest.fn().mockResolvedValue({
      type: 'offer',
      sdp: 'mock-offer-sdp'
    }),
    createAnswer: jest.fn().mockResolvedValue({
      type: 'answer',
      sdp: 'mock-answer-sdp'
    }),
    setLocalDescription: jest.fn().mockResolvedValue(),
    setRemoteDescription: jest.fn().mockResolvedValue(),
    addIceCandidate: jest.fn().mockResolvedValue(),
    addTrack: jest.fn(),
    close: jest.fn(),
    removeTrack: jest.fn(),
    connectionState: 'connected',
    iceConnectionState: 'connected',
    onicecandidate: null,
    ontrack: null,
    oniceconnectionstatechange: null,
    onconnectionstatechange: null,
    onnegotiationneeded: null,
  })),

  RTCIceCandidate: jest.fn().mockImplementation((candidate) => candidate),

  RTCSessionDescription: jest.fn().mockImplementation((desc) => desc),

  navigator: {
    mediaDevices: {
      getUserMedia: jest.fn().mockResolvedValue({
        getTracks: jest.fn(() => [
          { stop: jest.fn(), enabled: true, muted: false },
          { stop: jest.fn(), enabled: true, muted: false }
        ]),
        getAudioTracks: jest.fn(() => [{ enabled: true, muted: false }]),
        getVideoTracks: jest.fn(() => []),
        addTrack: jest.fn(),
        removeTrack: jest.fn(),
      }),
      getDisplayMedia: jest.fn().mockResolvedValue({
        getTracks: jest.fn(() => [{ stop: jest.fn() }]),
        getVideoTracks: jest.fn(() => [{ enabled: true }]),
      }),
    }
  }
});

// Socket.IO Mocks
export const createSocketMocks = () => ({
  socket: {
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    connected: true,
    disconnected: false,
    id: 'mock-socket-id',
    auth: {},
    transport: { name: 'websocket' },
    once: jest.fn(),
    listeners: jest.fn().mockReturnValue([]),
    removeAllListeners: jest.fn(),
    close: jest.fn(),
  },

  io: jest.fn().mockReturnValue({
    on: jest.fn(),
    off: jest.fn(),
    emit: jest.fn(),
    connect: jest.fn(),
    disconnect: jest.fn(),
    connected: true,
    id: 'mock-socket-id',
    auth: {},
    once: jest.fn(),
    listeners: jest.fn().mockReturnValue([]),
  }),
});

// React Testing Library Mocks
export const createReactMocks = () => ({
  IntersectionObserver: jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  })),

  ResizeObserver: jest.fn(() => ({
    observe: jest.fn(),
    unobserve: jest.fn(),
    disconnect: jest.fn(),
  })),
});

// Mock Event Emitters
export class MockEventEmitter {
  constructor() {
    this.events = new Map();
  }

  on(event, callback) {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event).push(callback);
  }

  off(event, callback) {
    if (this.events.has(event)) {
      const callbacks = this.events.get(event);
      const index = callbacks.indexOf(callback);
      if (index !== -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  emit(event, ...args) {
    if (this.events.has(event)) {
      this.events.get(event).forEach(callback => {
        callback(...args);
      });
    }
  }

  removeAllListeners(event) {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }

  listenerCount(event) {
    return this.events.has(event) ? this.events.get(event).length : 0;
  }
}

// Console helper
export const mockConsole = {
  mockError: () => jest.spyOn(console, 'error').mockImplementation(() => {}),
  mockWarn: () => jest.spyOn(console, 'warn').mockImplementation(() => {}),
  mockLog: () => jest.spyOn(console, 'log').mockImplementation(() => {}),
  mockInfo: () => jest.spyOn(console, 'info').mockImplementation(() => {}),
  restoreAll: () => {
    ['error', 'warn', 'log', 'info'].forEach(level => {
      console[level].mockRestore?.();
    });
  }
};

// Global setup helper
export const setupGlobalMocks = () => {
  const webRTCMocks = createWebRTCMocks();

  // Set up global WebRTC mocks
  Object.assign(global, webRTCMocks);
  Object.assign(global.navigator, webRTCMocks.navigator);

  return webRTCMocks;
};

// Cleanup helper
export const cleanupMocks = () => {
  jest.clearAllMocks();

  // Restore console if mocked
  mockConsole.restoreAll();

  // Clear any window event listeners
  if (typeof window !== 'undefined') {
    window.localStorage?.clear?.();
    window.sessionStorage?.clear?.();
  }
};

// Time helpers for testing
export const createTimeHelpers = () => ({
  advanceTime: (ms) => jest.advanceTimersByTime(ms),
  runAllTimers: () => jest.runOnlyPendingTimers(),
  mockDate: (date) => jest.setSystemTime(date),
  restoreTime: () => jest.useRealTimers(),
});

// Axios mocks
export const createAxiosMock = () => ({
  axios: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    patch: jest.fn(),
    create: jest.fn(() => ({
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
    })),
    interceptors: {
      request: {
        use: jest.fn(),
        eject: jest.fn(),
      },
      response: {
        use: jest.fn(),
        eject: jest.fn(),
      },
    },
  },
});

// Basic test to satisfy Jest's requirement for test suites
describe('Mock Utilities', () => {
 test('should export mock creation functions', () => {
   expect(typeof createWebRTCMocks).toBe('function');
   expect(typeof createSocketMocks).toBe('function');
   expect(typeof createReactMocks).toBe('function');
   expect(typeof createAxiosMock).toBe('function');
 });

 test('should create WebRTC mocks correctly', () => {
   const mocks = createWebRTCMocks();
   expect(mocks).toHaveProperty('RTCPeerConnection');
   expect(mocks).toHaveProperty('RTCIceCandidate');
   expect(mocks).toHaveProperty('RTCSessionDescription');
   expect(mocks).toHaveProperty('navigator');
 });

 test('should create socket mocks correctly', () => {
   const mocks = createSocketMocks();
   expect(mocks).toHaveProperty('socket');
   expect(mocks).toHaveProperty('io');
   expect(mocks.socket).toHaveProperty('on');
   expect(mocks.socket).toHaveProperty('emit');
 });

 test('MockEventEmitter should work correctly', () => {
   const emitter = new MockEventEmitter();
   const mockCallback = jest.fn();

   emitter.on('test', mockCallback);
   emitter.emit('test', 'data');
   expect(mockCallback).toHaveBeenCalledWith('data');

   emitter.off('test', mockCallback);
   emitter.emit('test', 'more data');
   expect(mockCallback).toHaveBeenCalledTimes(1); // Should not be called again
 });
});

// Local storage mock
export const createLocalStorageMock = () => ({
  localStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    key: jest.fn(),
    length: 0,
  },
  sessionStorage: {
    getItem: jest.fn(),
    setItem: jest.fn(),
    removeItem: jest.fn(),
    clear: jest.fn(),
    key: jest.fn(),
    length: 0,
  },
});