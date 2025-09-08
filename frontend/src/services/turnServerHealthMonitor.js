// TURN/STUN Server Health Monitoring Service
// Monitors server availability and performance for WebRTC connections

class TurnServerHealthMonitor {
  constructor() {
    this.servers = [
      {
        urls: 'stun:stun.l.google.com:19302',
        type: 'stun',
        name: 'Google STUN'
      },
      {
        urls: 'stun:stun1.l.google.com:19302',
        type: 'stun',
        name: 'Google STUN Alt'
      },
      {
        urls: `turn:${process.env.REACT_APP_TURN_HOST || 'turn.chat-js.app'}`,
        username: process.env.REACT_APP_TURN_USERNAME,
        credential: process.env.REACT_APP_TURN_CREDENTIAL,
        type: 'turn',
        name: 'Custom TURN'
      }
    ];

    this.serverStatuses = new Map();
    this.monitorInterval = null;
    this.isMonitoring = false;
  }

  // Start health monitoring
  startMonitoring(interval = 30000) { // Check every 30 seconds
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    console.log('[TURN-Health] Started server health monitoring');

    // Initial check
    this.checkAllServersHealth();

    // Schedule periodic checks
    this.monitorInterval = setInterval(() => {
      this.checkAllServersHealth();
    }, interval);
  }

  // Stop health monitoring
  stopMonitoring() {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
    this.isMonitoring = false;
    console.log('[TURN-Health] Stopped server health monitoring');
  }

  // Check health of all servers
  async checkAllServersHealth() {
    const promises = this.servers.map(server => this.checkServerHealth(server));
    const results = await Promise.allSettled(promises);

    results.forEach((result, index) => {
      const server = this.servers[index];
      const statusKey = `${server.type}-${server.urls}`;

      if (result.status === 'fulfilled') {
        this.serverStatuses.set(statusKey, {
          ...result.value,
          lastChecked: Date.now(),
          server
        });
        console.log(`[TURN-Health] ${server.name}: ${result.value.health} (${result.value.rtt}ms)`);
      } else {
        this.serverStatuses.set(statusKey, {
          health: 'unreachable',
          error: result.reason.message,
          rtt: null,
          lastChecked: Date.now(),
          server
        });
        console.warn(`[TURN-Health] ${server.name}: Failed - ${result.reason.message}`);
      }
    });

    this.emitHealthReport();
  }

  // Check health of a single server
  async checkServerHealth(server) {
    const startTime = Date.now();

    try {
      const peerConnection = new RTCPeerConnection({
        iceServers: [{
          urls: server.urls,
          username: server.username,
          credential: server.credential
        }]
      });

      // Create a data channel for testing
      const dataChannel = peerConnection.createDataChannel('health-check');

      return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          peerConnection.close();
          reject(new Error('Connection timeout'));
        }, 5000); // 5 second timeout

        // Listen for ICE connection state changes
        peerConnection.oniceconnectionstatechange = () => {
          const state = peerConnection.iceConnectionState;

          if (state === 'connected' || state === 'completed') {
            clearTimeout(timeout);
            const rtt = Date.now() - startTime;

            peerConnection.close();
            resolve({
              health: 'healthy',
              rtt,
              serverUrl: server.urls,
              serverType: server.type
            });
          } else if (state === 'failed' || state === 'disconnected') {
            clearTimeout(timeout);
            peerConnection.close();
            reject(new Error(`ICE connection ${state}`));
          }
        };

        // Listen for ICE gathering state changes
        peerConnection.onicegatheringstatechange = () => {
          const state = peerConnection.iceGatheringState;

          if (state === 'complete') {
            // If gathering is complete but connection didn't succeed, check candidates
            if (peerConnection.iceConnectionState === 'new') {
              setTimeout(() => {
                clearTimeout(timeout);
                peerConnection.close();
                resolve({
                  health: 'partial',
                  rtt: Date.now() - startTime,
                  serverUrl: server.urls,
                  serverType: server.type,
                  note: 'Gathered candidates but no connection'
                });
              }, 1000);
            }
          }
        };

        // Create offer to start ICE process
        peerConnection.createOffer()
          .then(offer => peerConnection.setLocalDescription(offer))
          .catch(error => {
            clearTimeout(timeout);
            peerConnection.close();
            reject(error);
          });

      });

    } catch (error) {
      throw new Error(`Failed to create RTCPeerConnection: ${error.message}`);
    }
  }

  // Get health report
  getHealthReport() {
    const report = {
      overallStatus: 'unknown',
      servers: [],
      recommendations: []
    };

    let healthyCount = 0;
    let totalRtt = 0;

    this.serverStatuses.forEach((status, key) => {
      report.servers.push({
        name: status.server.name,
        type: status.server.type,
        url: status.server.urls,
        health: status.health,
        rtt: status.rtt,
        lastChecked: status.lastChecked,
        error: status.error
      });

      if (status.health === 'healthy') {
        healthyCount++;
        totalRtt += status.rtt || 0;
      }
    });

    // Determine overall status
    if (healthyCount === 0) {
      report.overallStatus = 'critical';
      report.recommendations.push('All servers unreachable. Check network connectivity.');
    } else if (healthyCount < this.servers.length / 2) {
      report.overallStatus = 'degraded';
      report.recommendations.push('Some servers are unreachable. Call quality may be affected.');
    } else {
      report.overallStatus = 'healthy';
      if (totalRtt / healthyCount > 200) {
        report.recommendations.push('Average server response time is high. Voice quality may be affected.');
      }
    }

    // Check STUN/TURN distribution
    const stunServers = report.servers.filter(s => s.type === 'stun' && s.health === 'healthy');
    const turnServers = report.servers.filter(s => s.type === 'turn' && s.health === 'healthy');

    if (stunServers.length === 0) {
      report.recommendations.push('No healthy STUN servers. NAT traversal may fail.');
    }
    if (turnServers.length === 0) {
      report.recommendations.push('No healthy TURN servers. Direct connections may fail.');
    }

    return report;
  }

  // Get best server for use
  getBestServer(type = 'all') {
    const healthyServers = Array.from(this.serverStatuses.values())
      .filter(status => status.health === 'healthy')
      .filter(status => type === 'all' || status.server.type === type)
      .sort((a, b) => (a.rtt || Infinity) - (b.rtt || Infinity));

    return healthyServers.length > 0 ? healthyServers[0] : null;
  }

  // Emit health report event
  emitHealthReport() {
    const report = this.getHealthReport();
    console.log('[TURN-Health] Health Report:', report);

    // In a real implementation, this would emit events to the UI
    this.emit('healthReport', report);
  }

  // Check ICE server compatibility
  checkBrowserCompatibility() {
    const compatibility = {
      webRTC: !!window.RTCPeerConnection,
      getUserMedia: !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia),
      webAudio: !!window.AudioContext || !!window.webkitAudioContext,
      promises: typeof Promise !== 'undefined',
      fetch: typeof fetch !== 'undefined'
    };

    // Check specific WebRTC features
    try {
      const pc = new RTCPeerConnection();
      compatibility.dataChannels = !!pc.createDataChannel;
      compatibility.dtls = true; // Assumed modern
      pc.close();
    } catch (error) {
      compatibility.dataChannels = false;
      compatibility.dtls = false;
    }

    // Check for known browser quirks
    const userAgent = navigator.userAgent;
    compatibility.browser = {
      chrome: /Chrome/.test(userAgent),
      firefox: /Firefox/.test(userAgent),
      safari: /Safari/.test(userAgent) && !/Chrome/.test(userAgent),
      edge: /Edge/.test(userAgent),
      opera: /Opera/.test(userAgent)
    };

    // Known issues and recommendations
    compatibility.issues = [];
    compatibility.recommendations = [];

    if (!compatibility.webRTC) {
      compatibility.issues.push('WebRTC not supported');
      compatibility.recommendations.push('Browser not supported. Use Chrome, Firefox, or Safari.');
    }

    if (!compatibility.dataChannels) {
      compatibility.issues.push('Data channels not supported');
      compatibility.recommendations.push('Some WebRTC features may not work in this browser.');
    }

    return compatibility;
  }

  // Event emission helper
  emit(eventType, data) {
    // In a real implementation, this would use an event emitter or Redux
    console.log(`[TURN-Health] Event: ${eventType}`, data);
  }

  // Cleanup
  cleanup() {
    this.stopMonitoring();
    this.serverStatuses.clear();
  }
}

// Export singleton instance
export default new TurnServerHealthMonitor();