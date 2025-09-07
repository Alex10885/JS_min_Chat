import React from 'react';
import { Box, Button, Typography } from '@mui/material';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import HeadphonesIcon from '@mui/icons-material/Headphones';

const VoiceControls = ({
  isConnected,
  isMuted,
  channels,
  voiceChannel,
  inVoice,
  onToggleMute,
  onLeaveVoice
}) => {
  const currentVoiceChannel = channels.find(c => c.id === voiceChannel);

  if (!inVoice || !voiceChannel || !currentVoiceChannel) {
    return null;
  }

  return (
    <Box
      sx={{
        p: 2,
        bgcolor: '#5865f2',
        borderRadius: 1,
        mt: 2,
        color: 'white'
      }}
    >
      <Typography variant="body2" sx={{ mb: 1 }}>
        Голосовой канал: {currentVoiceChannel.name}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <Box sx={{ display: 'flex', gap: 1 }}>
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
              }
            }}
          >
            <HeadphonesIcon fontSize="small" sx={{ mr: 0.5 }} />
            Выйти
          </Button>

          {isConnected && (
            <Button
              size="small"
              variant="contained"
              color={isMuted ? 'error' : 'success'}
              onClick={onToggleMute}
              sx={{
                minWidth: 'auto',
                px: 1.5
              }}
            >
              {isMuted ? <MicOffIcon fontSize="small" /> : <MicIcon fontSize="small" />}
            </Button>
          )}
        </Box>

        <Box sx={{ display: 'flex', alignItems: 'center' }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: isConnected ? '#4caf50' : '#f44336',
              mr: 1
            }}
          />
          <Typography variant="caption">
            {isConnected ? 'Подключено' : 'Отключено'}
          </Typography>
        </Box>
      </Box>
    </Box>
  );
};

export default VoiceControls;