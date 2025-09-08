// WebRTC Context for global state management
// Provides centralized WebRTC state and quality monitoring

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import webrtcQualityService from '../services/webrtcQualityService';
import turnServerHealthMonitor from '../services/turnServerHealthMonitor';
import bandwidthAdapter from '../utils/bandwidthAdapter';

const WebRTCContext = createContext();

export const useWebRTCContext = () => {
  const context = useContext(WebRTCContext);
  if (!context) {
    throw new Error('useWebRTCContext must be used within WebRTCProvider');
  }
  return context;
};

export const WebRTCProvider = ({ children }) => {
  const [connectionState, setConnectionState] = useState('disconnected');
  const [participants, setParticipants] = useState([]);
  const [audioPermissions, setAudioPermissions] = useState(null);
  const [connectionQuality, setConnectionQuality] = useState('unknown');
  const [serverHealthReport, setServerHealthReport] = useState(null);
  const [bandwidthProfile, setBandwidthProfile] = useState('normal');
  const [adaptationEnabled, setAdaptationEnabled] = useState(true);

  // Initialize services
  useEffect(() => {
    // Start TURN server monitoring
    turnServerHealthMonitor.startMonitoring();

    // Setup event listeners
    const qualityHandler = (alert) => {
      setConnectionQuality(alert.quality);
      console.log(`[WebRTC-Context] Quality alert: ${alert.quality} for ${alert.nickname}`);
    };

    const healthHandler = (report) => {
      setServerHealthReport(report);
    };

    const adaptationHandler = ({ profile }) => {
      setBandwidthProfile(profile);
    };

    // Listen to service events (simplified, in real implementation use actual event system)
    if (webrtcQualityService.on) {
      webrtcQualityService.on('qualityAlert', qualityHandler);
    }
    if (turnServerHealthMonitor.on) {
      turnServerHealthMonitor.on('healthReport', healthHandler);
    }
    if (bandwidthAdapter.on) {
      bandwidthAdapter.on('bandwidthAdapted', adaptationHandler);
    }

    // Check initial audio permissions
    checkAudioPermissions();

    return () => {
      turnServerHealthMonitor.stopMonitoring();
    };
  }, []);

  // Check audio permissions and capabilities
  const checkAudioPermissions = useCallback(async () => {
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setAudioPermissions('unsupported');
        return;
      }

      const result = await navigator.permissions.query({ name: 'microphone' });
      setAudioPermissions(result.state);

      // Listen for permission changes
      result.addEventListener('change', () => {
        setAudioPermissions(result.state);
      });

    } catch (error) {
      console.warn('[WebRTC-Context] Could not query microphone permissions:', error);
      setAudioPermissions('unknown');
    }
  }, []);

  // Request audio permissions
  const requestAudioPermissions = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach(track => track.stop()); // Stop immediately after permission
      setAudioPermissions('granted');
      return true;
    } catch (error) {
      console.error('[WebRTC-Context] Audio permission denied:', error);
      setAudioPermissions('denied');
      return false;
    }
  }, []);

  // Get connection quality summary
  const getQualitySummary = useCallback(() => {
    if (!webrtcQualityService.getConnectionSummary) return null;
    return webrtcQualityService.getConnectionSummary();
  }, []);

  // Get browser compatibility info
  const getBrowserCompatibility = useCallback(() => {
    return turnServerHealthMonitor.checkBrowserCompatibility();
  }, []);

  // Force bandwidth profile
  const forceBandwidthProfile = useCallback((profile) => {
    bandwidthAdapter.forceBandwidthProfile('global', profile);
    setBandwidthProfile(profile);
  }, []);

  // Enable/disable automatic adaptation
  const toggleAdaptation = useCallback((enabled) => {
    bandwidthAdapter.setAdaptationEnabled(enabled);
    setAdaptationEnabled(enabled);
  }, []);

  // Get bandwidth adaptation status
  const getAdaptationStatus = useCallback(() => {
    return bandwidthAdapter.getAdaptationStatus();
  }, []);

  // Get server health status
  const getServerHealthStatus = useCallback(() => {
    return turnServerHealthMonitor.getHealthReport();
  }, []);

  const value = {
    // State
    connectionState,
    participants,
    audioPermissions,
    connectionQuality,
    serverHealthReport,
    bandwidthProfile,
    adaptationEnabled,

    // Actions
    setConnectionState,
    setParticipants,
    checkAudioPermissions,
    requestAudioPermissions,

    // Services access
    getQualitySummary,
    getBrowserCompatibility,
    getAdaptationStatus,
    getServerHealthStatus,

    // Adaptation controls
    forceBandwidthProfile,
    toggleAdaptation,

    // Service instances (for advanced usage)
    webrtcQualityService,
    turnServerHealthMonitor,
    bandwidthAdapter
  };

  return (
    <WebRTCContext.Provider value={value}>
      {children}
    </WebRTCContext.Provider>
  );
};