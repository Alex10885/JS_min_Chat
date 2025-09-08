// Component PropTypes definitions for runtime validation
// Provides type checking and validation for React components

import PropTypes from 'prop-types';

// Common prop types
export const MessageTypes = {
  message: PropTypes.shape({
    id: PropTypes.string,
    text: PropTypes.string.isRequired,
    author: PropTypes.string.isRequired,
    timestamp: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]).isRequired,
    type: PropTypes.oneOf(['message', 'system', 'private']),
    room: PropTypes.string,
    channel: PropTypes.string,
    target: PropTypes.string // For private messages
  })
};

export const ChannelTypes = {
  channel: PropTypes.shape({
    id: PropTypes.string.isRequired,
    name: PropTypes.string.isRequired,
    type: PropTypes.oneOf(['text', 'voice']).isRequired,
    createdAt: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    creator: PropTypes.string,
    participants: PropTypes.arrayOf(PropTypes.string)
  })
};

export const UserTypes = {
  user: PropTypes.shape({
    nickname: PropTypes.string.isRequired,
    role: PropTypes.oneOf(['member', 'moderator', 'admin']).isRequired,
    status: PropTypes.oneOf(['online', 'offline', 'away', 'busy']),
    lastSeen: PropTypes.oneOfType([PropTypes.string, PropTypes.instanceOf(Date)]),
    speaking: PropTypes.bool,
    avatar: PropTypes.string,
    id: PropTypes.string
  }),

  // For arrays of users
  userList: PropTypes.arrayOf(UserTypes.user)
};

export const VoiceTypes = {
  voiceParticipant: PropTypes.shape({
    socketId: PropTypes.string.isRequired,
    nickname: PropTypes.string.isRequired,
    stream: PropTypes.object, // MediaStream
    audioRef: PropTypes.object, // HTMLAudioElement ref
    muted: PropTypes.bool,
    deafened: PropTypes.bool,
    speaking: PropTypes.bool,
    quality: PropTypes.oneOf(['excellent', 'good', 'fair', 'poor', 'unknown'])
  }),

  // For arrays of voice participants
  voiceParticipantList: PropTypes.arrayOf(VoiceTypes.voiceParticipant)
};

// Component specific prop validations
export const ComponentProps = {
  // Header component
  Header: {
    isConnected: PropTypes.bool.isRequired,
    connectionStatus: PropTypes.oneOf(['connected', 'connecting', 'disconnected', 'error', 'reconnecting']),
    nickname: PropTypes.string.isRequired,
    role: UserTypes.user.isRequired.role,
    isMobile: PropTypes.bool.isRequired,
    onMenuClick: PropTypes.func,
    onLogout: PropTypes.func.isRequired
  },

  // ChannelList component
  ChannelList: {
    channels: PropTypes.arrayOf(ChannelTypes.channel).isRequired,
    onChannelSelect: PropTypes.func.isRequired,
    onVoiceJoin: PropTypes.func,
    onVoiceLeave: PropTypes.func,
    inVoice: PropTypes.bool,
    voiceChannel: PropTypes.string,
    selectedChannel: PropTypes.string
  },

  // MessageList component
  MessageList: {
    messages: PropTypes.arrayOf(MessageTypes.message).isRequired,
    currentRoom: PropTypes.string
  },

  // MessageInput component
  MessageInput: {
    onSendMessage: PropTypes.func.isRequired,
    disabled: PropTypes.bool,
    placeholder: PropTypes.string
  },

  // VoiceControls component
  VoiceControls: {
    isMuted: PropTypes.bool.isRequired,
    isDeafened: PropTypes.bool,
    volumeLevel: PropTypes.number,
    participants: VoiceTypes.voiceParticipantList,
    onToggleMute: PropTypes.func.isRequired,
    onToggleDeafen: PropTypes.func,
    connectionQuality: PropTypes.oneOf(['excellent', 'good', 'fair', 'poor', 'unknown'])
  },

  // UserList component
  UserList: {
    users: UserTypes.userList.isRequired,
    currentUserId: PropTypes.string,
    showRoles: PropTypes.bool,
    onUserClick: PropTypes.func
  },

  // MobileDrawer component
  MobileDrawer: {
    open: PropTypes.bool.isRequired,
    onClose: PropTypes.func.isRequired,
    channels: PropTypes.arrayOf(ChannelTypes.channel),
    onChannelSelect: PropTypes.func,
    onVoiceJoin: PropTypes.func,
    inVoice: PropTypes.bool,
    voiceChannel: PropTypes.string,
    onCreateChannel: PropTypes.func
  }
};

// WebRTC specific types
export const WebRTCTypes = {
  connectionState: PropTypes.oneOf([
    'new', 'connecting', 'connected', 'disconnected', 'failed', 'closed'
  ]),

  iceConnectionState: PropTypes.oneOf([
    'new', 'checking', 'connected', 'completed', 'failed', 'disconnected', 'closed'
  ]),

  qualityMetrics: PropTypes.shape({
    audio: PropTypes.shape({
      packetsLost: PropTypes.number,
      packetsSent: PropTypes.number,
      packetLoss: PropTypes.number,
      roundTripTime: PropTypes.number
    }),
    video: PropTypes.shape({
      packetsLost: PropTypes.number,
      packetsSent: PropTypes.number,
      packetLoss: PropTypes.number,
      roundTripTime: PropTypes.number
    }),
    total: PropTypes.shape({
      packetsLost: PropTypes.number,
      packetsSent: PropTypes.number,
      roundTripTime: PropTypes.number,
      jitter: PropTypes.number
    })
  }),

  serverHealth: PropTypes.shape({
    name: PropTypes.string,
    type: PropTypes.oneOf(['stun', 'turn']),
    health: PropTypes.oneOf(['healthy', 'partial', 'unreachable']),
    rtt: PropTypes.number,
    lastChecked: PropTypes.number,
    error: PropTypes.string
  }),

  bandwidthProfile: PropTypes.oneOf(['reduced', 'normal', 'high'])
};

// Context provider types (for advanced validation)
export const ContextTypes = {
  WebRTCContext: {
    connectionState: WebRTCTypes.connectionState,
    participants: VoiceTypes.voiceParticipantList,
    audioPermissions: PropTypes.oneOf(['granted', 'denied', 'prompt', 'unsupported', 'unknown']),
    connectionQuality: PropTypes.oneOf(['excellent', 'good', 'fair', 'poor', 'unknown']),
    serverHealthReport: PropTypes.arrayOf(WebRTCTypes.serverHealth),
    bandwidthProfile: WebRTCTypes.bandwidthProfile,
    adaptationEnabled: PropTypes.bool
  }
};

// Event handler types
export const EventTypes = {
  onMessage: PropTypes.func,
  onUserJoin: PropTypes.func,
  onUserLeave: PropTypes.func,
  onVoiceChannelJoin: PropTypes.func,
  onVoiceChannelLeave: PropTypes.func,
  onQualityChange: PropTypes.func,
  onConnectionError: PropTypes.func
};

// Utility functions for validation
export const Validators = {
  // Validate message content
  validateMessage: (message) => {
    if (!message || typeof message !== 'object') return false;
    return message.text && message.author && message.timestamp;
  },

  // Validate channel data
  validateChannel: (channel) => {
    if (!channel || typeof channel !== 'object') return false;
    return channel.id && channel.name && ['text', 'voice'].includes(channel.type);
  },

  // Validate user data
  validateUser: (user) => {
    if (!user || typeof user !== 'object') return false;
    return user.nickname && ['member', 'moderator', 'admin'].includes(user.role);
  },

  // Validate WebRTC statistics
  validateStats: (stats) => {
    if (!stats || typeof stats !== 'object') return false;
    return stats.forEach && typeof stats.forEach === 'function';
  },

  // Validate ICE server configuration
  validateIceServers: (servers) => {
    if (!Array.isArray(servers)) return false;
    return servers.every(server => server && server.urls);
  }
};

// Export all types as default
export default {
  MessageTypes,
  ChannelTypes,
  UserTypes,
  VoiceTypes,
  ComponentProps,
  WebRTCTypes,
  ContextTypes,
  EventTypes,
  Validators
};