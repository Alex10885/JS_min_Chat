import React from 'react';
import { Box, Button, Typography, Tooltip, Chip, LinearProgress, CircularProgress } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import NetworkCheckIcon from '@mui/icons-material/NetworkCheck';
import SecurityIcon from '@mui/icons-material/Security';
import CloudIcon from '@mui/icons-material/Cloud';
import AvTimerIcon from '@mui/icons-material/AvTimer';

const VoiceControls = ({
  isConnected,
  isMuted,
  channels,
  voiceChannel,
  inVoice,
  onToggleMute,
  onLeaveVoice,
  // Enhanced props from new WebRTC hook
  connectionState = 'disconnected',
  connectionQuality = 'unknown',
  bandwidthProfile = 'normal',
  serverHealth = null,
  errors = [],
  peerCount = 0,
  connectionMetrics = {}
}) => {
  const currentVoiceChannel = channels.find(c => c.id === voiceChannel);

  if (!inVoice || !voiceChannel || !currentVoiceChannel) {
    return null;
  }

  const getStatusColor = (state) => {
    switch (state) {
      case 'connected': return '#4caf50';
      case 'connecting': return '#ff9800';
      case 'reconnecting': return '#ff5722';
      case 'failed': return '#f44336';
      default: return '#757575';
    }
  };

  const getStatusText = (state) => {
    switch (state) {
      case 'connected': return 'Подключено';
      case 'connecting': return 'Подключение...';
      case 'reconnecting': return 'Восстановление...';
      case 'failed': return 'Ошибка';
      default: return 'Отключено';
    }
  };

  const getQualityIndicator = (quality) => {
    const indicators = {
      excellent: { color: '#4caf50', text: 'Отлично' },
      good: { color: '#8bc34a', text: 'Хорошо' },
      fair: { color: '#ffc107', text: 'Средне' },
      poor: { color: '#ff5722', text: 'Плохо' },
      unknown: { color: '#757575', text: 'Неизвестно' }
    };
    return indicators[quality] || indicators.unknown;
  };

  const qualityInfo = getQualityIndicator(connectionQuality);

  return (
    <Box
      sx={{
        p: 2,
        bgcolor: '#5865f2',
        borderRadius: 1,
        mt: 2,
        color: 'white',
        position: 'relative'
      }}
    >
      <Typography variant="body2" sx={{ mb: 1, fontWeight: 'bold' }}>
        🎤 Голосовой канал: {currentVoiceChannel.name}
      </Typography>

      {/* Real-time metrics display */}
      <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        <Chip
          icon={<NetworkCheckIcon />}
          label={`Качество: ${qualityInfo.text}`}
          size="small"
          sx={{
            bgcolor: qualityInfo.color,
            color: 'white',
            fontSize: '0.75rem'
          }}
        />
        <Chip
          icon={<CloudIcon />}
          label={`Профиль: ${bandwidthProfile}`}
          size="small"
          sx={{
            bgcolor: '#3f51b5',
            color: 'white',
            fontSize: '0.75rem'
          }}
        />
        {peerCount > 0 && (
          <Chip
            label={`${peerCount} участник${peerCount > 1 ? 'ов' : ''}`}
            size="small"
            sx={{
              bgcolor: '#2196f3',
              color: 'white',
              fontSize: '0.75rem'
            }}
          />
        )}
        {connectionMetrics.latency && (
          <Tooltip title={`Задержка: ${connectionMetrics.latency}ms`}>
            <Chip
              icon={<AvTimerIcon />}
              label={`${connectionMetrics.latency}ms`}
              size="small"
              sx={{
                bgcolor: connectionMetrics.latency < 200 ? '#4caf50' : '#ff9800',
                color: 'white',
                fontSize: '0.75rem'
              }}
            />
          </Tooltip>
        )}
      </Box>

      {/* Connection quality progress if available */}
      {connectionQuality && connectionQuality !== 'unknown' && (
        <Box sx={{ mb: 2 }}>
          <LinearProgress
            variant="determinate"
            value={connectionQuality === 'excellent' ? 100 :
                  connectionQuality === 'good' ? 75 :
                  connectionQuality === 'fair' ? 50 :
                  connectionQuality === 'poor' ? 25 : 0}
            sx={{
              height: 6,
              borderRadius: 3,
              bgcolor: '#9e9e9e',
              '& .MuiLinearProgress-bar': {
                bgcolor: qualityInfo.color,
                borderRadius: 3
              }
            }}
          />
        </Box>
      )}

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1 }}>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }}>
          <Tooltip title="Покинуть голосовой канал">
            <Button
              size="small"
              variant="contained"
              color="secondary"
              onClick={onLeaveVoice}
              sx={{
                bgcolor: '#ffffff',
                color: '#000000',
                '&:hover': {
                  bgcolor: '#f0f0f0'
                },
                minWidth: 'auto'
              }}
            >
              <HeadphonesIcon fontSize="small" sx={{ mr: 0.5 }} />
              Выйти
            </Button>
          </Tooltip>

          <Tooltip title={connectionState === 'connecting' ? 'Подключение...' : isMuted ? 'Включить микрофон' : 'Отключить микрофон'}>
            <Button
              size="small"
              variant="contained"
              color={isMuted ? 'error' : 'success'}
              onClick={onToggleMute}
              disabled={connectionState === 'connecting' || connectionState === 'disconnected'}
              sx={{
                minWidth: 'auto',
                px: 1.5,
                opacity: connectionState === 'connecting' ? 0.7 : 1
              }}
            >
              {connectionState === 'connecting' ? (
                <CircularProgress size={16} color="inherit" />
              ) : isMuted ? (
                <MicOffIcon fontSize="small" />
              ) : (
                <MicIcon fontSize="small" />
              )}
            </Button>
          </Tooltip>

          {connectionState === 'connected' && (
            <Tooltip title="Успешно подключено">
              <VolumeUpIcon sx={{ color: '#4caf50', ml: 1 }} />
            </Tooltip>
          )}

          {serverHealth && serverHealth.overallStatus === 'healthy' && (
            <Tooltip title={`Серверы STUN/TURN: ${serverHealth.overallStatus}`}>
              <SecurityIcon sx={{ color: '#4caf50' }} />
            </Tooltip>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {(connectionState === 'connecting' || connectionState === 'reconnecting') && (
            <CircularProgress size={16} color="inherit" />
          )}

          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: getStatusColor(connectionState),
              animation: (connectionState === 'connecting' || connectionState === 'reconnecting')
                ? 'pulse 1s infinite'
                : 'none',
              '@keyframes pulse': {
                '0%': { opacity: 1 },
                '50%': { opacity: 0.5 },
                '100%': { opacity: 1 }
              }
            }}
          />

          <Typography variant="caption" sx={{ color: '#e8eaf6' }}>
            {getStatusText(connectionState)}
          </Typography>
        </Box>
      </Box>

      {/* Error notifications */}
      {errors.length > 0 && (
        <Box sx={{ mt: 2, p: 1, bgcolor: '#f44336', borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: 'white' }}>
            ⚠️ Последняя ошибка: {errors[errors.length - 1].message}
          </Typography>
        </Box>
      )}

      {/* Server health warnings */}
      {serverHealth && serverHealth.overallStatus !== 'healthy' && (
        <Box sx={{ mt: 2, p: 1, bgcolor: '#ff9800', borderRadius: 1 }}>
          <Typography variant="caption" sx={{ color: '#333' }}>
            ⚠️ Проблемы с серверами: {serverHealth.recommendations[0]}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default VoiceControls;