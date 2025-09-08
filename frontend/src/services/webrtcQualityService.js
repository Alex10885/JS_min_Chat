// WebRTC Quality Monitoring Service
// Provides comprehensive quality management for voice/video connections

class WebRTCQualityService {
  constructor() {
    this.connections = new Map();
    this.qualityThresholds = {
      excellent: { rtt: 50, packetLoss: 0.05, jitter: 10 },
      good: { rtt: 100, packetLoss: 0.10, jitter: 20 },
      fair: { rtt: 200, packetLoss: 0.20, jitter: 50 },
      poor: { rtt: Infinity, packetLoss: 1.0, jitter: Infinity }
    };
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
  }

  // Register a WebRTC connection for monitoring
  registerConnection(peerConnection, socketId, nickname) {
    const connectionData = {
      peerConnection,
      socketId,
      nickname,
      quality: 'unknown',
      lastStats: null,
      connectionState: 'connecting',
      statsMonitorId: null,
      reconnectTimeout: null
    };

    this.connections.set(socketId, connectionData);

    // Start quality monitoring
    this.startStatsMonitoring(socketId);

    // Listen to connection state changes
    peerConnection.onconnectionstatechange = () => {
      const state = peerConnection.connectionState;
      connectionData.connectionState = state;
      this.handleConnectionStateChange(socketId, state);
    };

    console.log(`[WebRTC-Quality] Registered connection for ${nickname} (${socketId})`);
  }

  // Unregister connection
  unregisterConnection(socketId) {
    const connectionData = this.connections.get(socketId);
    if (connectionData) {
      if (connectionData.statsMonitorId) {
        clearInterval(connectionData.statsMonitorId);
      }
      if (connectionData.reconnectTimeout) {
        clearTimeout(connectionData.reconnectTimeout);
      }
      this.connections.delete(socketId);
      console.log(`[WebRTC-Quality] Unregistered connection for ${connectionData.nickname}`);
    }
  }

  // Start RTP statistics monitoring
  startStatsMonitoring(socketId) {
    const connectionData = this.connections.get(socketId);
    if (!connectionData) return;

    connectionData.statsMonitorId = setInterval(async () => {
      try {
        const stats = await connectionData.peerConnection.getStats();
        const qualityMetrics = this.analyzeStatsReports(stats);

        connectionData.lastStats = stats;
        connectionData.quality = this.calculateQuality(qualityMetrics);

        // Log quality changes or issues
        this.handleQualityChange(socketId, connectionData.quality, qualityMetrics);

      } catch (error) {
        console.warn(`[WebRTC-Quality] Failed to get stats for ${socketId}:`, error);
      }
    }, 2000); // Monitor every 2 seconds
  }

  // Analyze WebRTC statistics
  analyzeStatsReports(stats) {
    const metrics = {
      audio: { packetsLost: 0, packetsSent: 0, bytesSent: 0, roundTripTime: 0 },
      video: { packetsLost: 0, packetsSent: 0, bytesSent: 0, roundTripTime: 0 },
      total: { packetsLost: 0, packetsSent: 0, roundTripTime: 0, jitter: 0 }
    };

    stats.forEach(report => {
      switch (report.type) {
        case 'inbound-rtp':
          if (report.mediaType === 'audio') {
            metrics.audio.packetsLost += report.packetsLost || 0;
            metrics.audio.packetsSent += report.packetsReceived || 0;
            metrics.audio.roundTripTime = report.roundTripTime || metrics.audio.roundTripTime;
          } else if (report.mediaType === 'video') {
            metrics.video.packetsLost += report.packetsLost || 0;
            metrics.video.packetsSent += report.packetsReceived || 0;
            metrics.video.roundTripTime = report.roundTripTime || metrics.video.roundTripTime;
          }
          break;

        case 'outbound-rtp':
          if (report.mediaType === 'audio') {
            metrics.audio.packetsSent += report.packetsSent || 0;
            metrics.audio.bytesSent += report.bytesSent || 0;
          } else if (report.mediaType === 'video') {
            metrics.video.packetsSent += report.packetsSent || 0;
            metrics.video.bytesSent += report.bytesSent || 0;
          }
          break;

        case 'candidate-pair':
          if (report.state === 'succeeded' && report.nominated) {
            metrics.total.roundTripTime = report.currentRoundTripTime || metrics.total.roundTripTime;
          }
          break;
      }
    });

    // Calculate totals and percentages
    metrics.total.packetsLost = metrics.audio.packetsLost + metrics.video.packetsLost;
    metrics.total.packetsSent = Math.max(metrics.audio.packetsSent, metrics.video.packetsSent);

    metrics.audio.packetLoss = metrics.audio.packetsSent > 0 ?
      metrics.audio.packetsLost / (metrics.audio.packetsLost + metrics.audio.packetsSent) : 0;
    metrics.video.packetLoss = metrics.video.packetsSent > 0 ?
      metrics.video.packetsLost / (metrics.video.packetsLost + metrics.video.packetsSent) : 0;

    return metrics;
  }

  // Calculate connection quality based on metrics
  calculateQuality(metrics) {
    const rtt = metrics.total.roundTripTime * 1000; // Convert to ms
    const packetLoss = Math.max(metrics.audio.packetLoss, metrics.video.packetLoss);

    if (rtt < this.qualityThresholds.excellent.rtt && packetLoss < this.qualityThresholds.excellent.packetLoss) {
      return 'excellent';
    } else if (rtt < this.qualityThresholds.good.rtt && packetLoss < this.qualityThresholds.good.packetLoss) {
      return 'good';
    } else if (rtt < this.qualityThresholds.fair.rtt && packetLoss < this.qualityThresholds.fair.packetLoss) {
      return 'fair';
    } else {
      return 'poor';
    }
  }

  // Handle quality changes
  handleQualityChange(socketId, quality, metrics) {
    const connectionData = this.connections.get(socketId);
    if (!connectionData) return;

    const previousQuality = connectionData.quality;

    if (previousQuality !== quality) {
      console.log(`[WebRTC-Quality] Quality change for ${connectionData.nickname}: ${previousQuality} → ${quality}`);

      // Trigger quality alerts for degraded connections
      if (quality === 'poor' || quality === 'fair') {
        this.emitQualityAlert(socketId, quality, metrics);
      }
    }

    connectionData.quality = quality;
  }

  // Handle connection state changes
  handleConnectionStateChange(socketId, state) {
    const connectionData = this.connections.get(socketId);
    if (!connectionData) return;

    console.log(`[WebRTC-Quality] Connection state for ${connectionData.nickname}: ${state}`);

    switch (state) {
      case 'connected':
        this.reconnectAttempts = 0;
        break;

      case 'disconnected':
      case 'failed':
        this.scheduleReconnection(socketId);
        break;

      case 'closed':
        this.unregisterConnection(socketId);
        break;
    }
  }

  // Schedule automatic reconnection
  scheduleReconnection(socketId) {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error(`[WebRTC-Quality] Max reconnection attempts reached for ${socketId}`);
      return;
    }

    this.reconnectAttempts++;

    // Exponential backoff: 1s, 2s, 4s, 8s, 16s
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 16000);

    console.log(`[WebRTC-Quality] Scheduling reconnection attempt ${this.reconnectAttempts} in ${delay}ms`);

    const connectionData = this.connections.get(socketId);
    if (connectionData) {
      connectionData.reconnectTimeout = setTimeout(() => {
        this.emit('reconnect', { socketId, nickname: connectionData.nickname });
      }, delay);
    }
  }

  // Emit quality alerts
  emitQualityAlert(socketId, quality, metrics) {
    const connectionData = this.connections.get(socketId);
    if (!connectionData) return;

    console.warn(`[WebRTC-Quality] Quality alert for ${connectionData.nickname}:`, {
      quality,
      rtt: metrics.total.roundTripTime,
      packetLoss: {
        audio: metrics.audio.packetLoss,
        video: metrics.video.packetLoss
      }
    });

    // In a full implementation, this would emit events to the UI
    this.emit('qualityAlert', {
      socketId,
      nickname: connectionData.nickname,
      quality,
      metrics
    });
  }

  // Get connection quality summary
  getConnectionSummary() {
    const summary = {
      totalConnections: this.connections.size,
      qualityDistribution: {
        excellent: 0,
        good: 0,
        fair: 0,
        poor: 0,
        unknown: 0
      },
      activeConnections: []
    };

    this.connections.forEach((data, socketId) => {
      summary.qualityDistribution[data.quality]++;

      if (data.connectionState === 'connected') {
        summary.activeConnections.push({
          socketId,
          nickname: data.nickname,
          quality: data.quality,
          rtt: data.lastStats ? this.extractRttFromStats(data.lastStats) : null
        });
      }
    });

    return summary;
  }

  // Extract RTT from stats (simplified)
  extractRttFromStats(stats) {
    for (let report of stats.values()) {
      if (report.type === 'candidate-pair' && report.currentRoundTripTime) {
        return report.currentRoundTripTime * 1000; // Convert to ms
      }
    }
    return null;
  }

  // Event emission helper (simplified)
  emit(eventType, data) {
    // In a real implementation, this would use an event emitter
    console.log(`[WebRTC-Quality] Event: ${eventType}`, data);
  }

  // Cleanup all connections
  cleanup() {
    this.connections.forEach((data, socketId) => {
      this.unregisterConnection(socketId);
    });
    this.connections.clear();
  }
}

// Export singleton instance
export default new WebRTCQualityService();