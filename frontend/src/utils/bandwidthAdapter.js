// Bandwidth Adaptation Utility for WebRTC
// Dynamically adjusts media quality based on network conditions

import webrtcQualityService from '../services/webrtcQualityService';

class BandwidthAdapter {
  constructor() {
    this.connections = new Map();
    this.adaptationSettings = {
      reduced: {
        video: { maxBitrate: 200000, frameRate: 15, resolution: { width: 640, height: 480 } },
        audio: { maxBitrate: 32000 }
      },
      normal: {
        video: { maxBitrate: 500000, frameRate: 30, resolution: { width: 1280, height: 720 } },
        audio: { maxBitrate: 64000 }
      },
      high: {
        video: { maxBitrate: 1000000, frameRate: 30, resolution: { width: 1920, height: 1080 } },
        audio: { maxBitrate: 128000 }
      }
    };

    this.currentBandwidthProfile = 'normal';
    this.adaptationEnabled = true;
  }

  // Register a connection for bandwidth adaptation
  registerConnection(socketId, peerConnection, streams) {
    const connectionData = {
      socketId,
      peerConnection,
      streams: new Set(streams),
      currentProfile: this.currentBandwidthProfile,
      lastAdaptation: Date.now(),
      adaptationReason: 'initial'
    };

    this.connections.set(socketId, connectionData);
    this.applyBandwidthProfile(socketId, this.currentBandwidthProfile);

    // Listen for quality changes and adapt accordingly
    webrtcQualityService.on('qualityAlert', ({ socketId: alertSocketId, quality }) => {
      if (alertSocketId === socketId) {
        this.handleQualityBasedAdaptation(socketId, quality);
      }
    });

    console.log(`[Bandwidth-Adapter] Registered connection for ${socketId}`);
  }

  // Unregister connection
  unregisterConnection(socketId) {
    this.connections.delete(socketId);
    console.log(`[Bandwidth-Adapter] Unregistered connection for ${socketId}`);
  }

  // Handle quality-based adaptation
  handleQualityBasedAdaptation(socketId, quality) {
    if (!this.adaptationEnabled) return;

    const connectionData = this.connections.get(socketId);
    if (!connectionData) return;

    let newProfile = this.currentBandwidthProfile;

    switch (quality) {
      case 'excellent':
        newProfile = 'high';
        break;
      case 'good':
        newProfile = 'normal';
        break;
      case 'fair':
        newProfile = 'reduced';
        break;
      case 'poor':
        newProfile = 'reduced';
        break;
      default:
        newProfile = 'normal';
    }

    if (newProfile !== connectionData.currentProfile) {
      this.applyBandwidthProfile(socketId, newProfile);
      connectionData.adaptationReason = `quality_change_${quality}`;
      console.log(`[Bandwidth-Adapter] Adapted ${socketId} to ${newProfile} due to ${quality} quality`);
    }
  }

  // Apply bandwidth profile to connection
  async applyBandwidthProfile(socketId, profile) {
    const connectionData = this.connections.get(socketId);
    if (!connectionData) return;

    const settings = this.adaptationSettings[profile];
    if (!settings) {
      console.warn(`[Bandwidth-Adapter] Unknown profile: ${profile}`);
      return;
    }

    try {
      // Get current senders
      const senders = connectionData.peerConnection.getSenders();

      for (const sender of senders) {
        const track = sender.track;

        if (track && track.kind === 'video' && settings.video) {
          // Apply video constraints
          const videoConstraints = {
            frameRate: { max: settings.video.frameRate },
            width: { max: settings.video.resolution.width },
            height: { max: settings.video.resolution.height }
          };

          await track.applyConstraints(videoConstraints);

          // Set bitrate limits
          const parameters = sender.getParameters();
          if (parameters.encodings) {
            parameters.encodings.forEach(encoding => {
              if (encoding.maxBitrate) {
                encoding.maxBitrate = settings.video.maxBitrate;
              }
            });
            await sender.setParameters(parameters);
          }

        } else if (track && track.kind === 'audio' && settings.audio) {
          // Apply audio constraints
          const audioConstraints = {
            sampleRate: 16000,
            channelCount: 1
          };

          await track.applyConstraints(audioConstraints);

          // Set audio bitrate (limited by WebRTC API)
          const parameters = sender.getParameters();
          if (parameters.encodings) {
            parameters.encodings.forEach(encoding => {
              // Note: WebRTC audio bitrate control is limited
              // Quality is controlled through sample rate and constraints
            });
          }
        }
      }

      connectionData.currentProfile = profile;
      connectionData.lastAdaptation = Date.now();

      console.log(`[Bandwidth-Adapter] Applied ${profile} profile to ${socketId}`);

      // Emit adaptation event
      this.emit('bandwidthAdapted', {
        socketId,
        profile,
        settings,
        timestamp: Date.now()
      });

    } catch (error) {
      console.error(`[Bandwidth-Adapter] Failed to apply ${profile} profile to ${socketId}:`, error);
    }
  }

  // Force bandwidth profile
  forceBandwidthProfile(socketId, profile) {
    if (!this.adaptationSettings[profile]) {
      console.warn(`[Bandwidth-Adapter] Attempted to force unknown profile: ${profile}`);
      return;
    }

    this.adaptationEnabled = false; // Temporarily disable auto-adaptation
    this.applyBandwidthProfile(socketId, profile);

    // Re-enable auto-adaptation after 30 seconds
    setTimeout(() => {
      this.adaptationEnabled = true;
      console.log(`[Bandwidth-Adapter] Re-enabled automatic bandwidth adaptation`);
    }, 30000);
  }

  // Get current adaptation status
  getAdaptationStatus(socketId = null) {
    if (socketId) {
      const connectionData = this.connections.get(socketId);
      return connectionData ? {
        currentProfile: connectionData.currentProfile,
        lastAdaptation: connectionData.lastAdaptation,
        adaptationReason: connectionData.adaptationReason
      } : null;
    }

    const status = {
      enabled: this.adaptationEnabled,
      connections: [],
      globalProfile: this.currentBandwidthProfile
    };

    this.connections.forEach((data, id) => {
      status.connections.push({
        socketId: id,
        currentProfile: data.currentProfile,
        lastAdaptation: data.lastAdaptation,
        adaptationReason: data.adaptationReason
      });
    });

    return status;
  }

  // Set global bandwidth profile
  setGlobalBandwidthProfile(profile) {
    if (!this.adaptationSettings[profile]) {
      console.warn(`[Bandwidth-Adapter] Attempted to set unknown global profile: ${profile}`);
      return;
    }

    this.currentBandwidthProfile = profile;

    // Apply to all existing connections
    this.connections.forEach((_, socketId) => {
      this.applyBandwidthProfile(socketId, profile);
    });

    console.log(`[Bandwidth-Adapter] Set global bandwidth profile to ${profile}`);
  }

  // Enable/disable automatic adaptation
  setAdaptationEnabled(enabled) {
    this.adaptationEnabled = enabled;
    console.log(`[Bandwidth-Adapter] Automatic adaptation ${enabled ? 'enabled' : 'disabled'}`);
  }

  // Check if current browser supports bandwidth control
  checkBrowserSupport() {
    try {
      const pc = new RTCPeerConnection();

      // Check for setParameters support
      const senders = pc.getSenders();
      const supportsParameters = senders.length > 0 && typeof senders[0].setParameters === 'function';

      // Check for applyConstraints support
      const supportsConstraints = navigator.mediaDevices &&
        navigator.mediaDevices.getUserMedia &&
        typeof navigator.mediaDevices.getUserMedia().then === 'function';

      pc.close();

      return {
        supported: supportsParameters && supportsConstraints,
        setParameters: supportsParameters,
        applyConstraints: supportsConstraints
      };

    } catch (error) {
      console.warn('[Bandwidth-Adapter] Browser support check failed:', error);
      return {
        supported: false,
        setParameters: false,
        applyConstraints: false
      };
    }
  }

  // Add custom bandwidth profile
  addBandwidthProfile(name, settings) {
    if (this.adaptationSettings[name]) {
      console.warn(`[Bandwidth-Adapter] Profile ${name} already exists, overwriting`);
    }

    this.adaptationSettings[name] = settings;
    console.log(`[Bandwidth-Adapter] Added custom profile: ${name}`);
  }

  // Get available bandwidth profiles
  getAvailableProfiles() {
    return Object.keys(this.adaptationSettings);
  }

  // Emit event helper
  emit(eventType, data) {
    console.log(`[Bandwidth-Adapter] Event: ${eventType}`, data);
    // In a real implementation, this would use an event emitter
  }

  // Cleanup all connections
  cleanup() {
    this.connections.clear();
    console.log('[Bandwidth-Adapter] Cleaned up all connections');
  }
}

// Export singleton instance
export default new BandwidthAdapter();