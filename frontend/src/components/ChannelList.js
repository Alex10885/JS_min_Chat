import React, { useState } from 'react';
import { Box, Typography, List, ListItem, Accordion, AccordionSummary, AccordionDetails, TextField, Button, useMediaQuery } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import chewingRightIcon from '@mui/icons-material/ChevronRight';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import axios from 'axios';

const ChannelList = ({ channels, onChannelSelect, onVoiceJoin, onVoiceLeave, inVoice, voiceChannel, selectedChannel }) => {
  const isMobile = useMediaQuery('(max-width:600px)');
  const [newChannelName, setNewChannelName] = useState('');

  const handleChannelClick = (channel) => {
    if (channel.type === 'voice') {
      onVoiceJoin(channel.id);
    } else {
      onChannelSelect(channel.id);
    }
  };

  const handleCreateChannel = (type) => {
    if (newChannelName.trim()) {
      axios.post('http://localhost:3001/channels', {
        name: newChannelName.trim(),
        type: type
      })
        .then(res => {
          // Channel will be updated via parent component
          setNewChannelName('');
        })
        .catch(err => console.error('Failed to create channel:', err));
    }
  };

  return (
    <Box>
      <Typography variant="h5" sx={{ color: '#5865f2', fontWeight: 'bold', mb: 2 }}>
        Chat Server
      </Typography>
      <Typography variant="h6" gutterBottom>Каналы</Typography>

      <Accordion defaultExpanded>
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <FolderOpenIcon sx={{ mr: 1 }} />
          <Typography>Chat Server</Typography>
        </AccordionSummary>
        <AccordionDetails>
          <List>
            {channels.map(channel => (
              <ListItem key={channel.id} sx={{ py: 0.5 }}>
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    cursor: 'pointer',
                    width: '100%',
                    p: 1,
                    borderRadius: 1,
                    bgcolor: selectedChannel === channel.id ? '#40444b' : 'transparent',
                    '&:hover': {
                      bgcolor: '#35373c'
                    }
                  }}
                  onClick={() => handleChannelClick(channel)}
                >
                  {channel.type === 'voice' ? (
                    <VolumeUpIcon fontSize="small" sx={{ mr: 1, color: '#72767d' }} />
                  ) : (
                    <Typography sx={{ mr: 1, color: '#72767d' }}>#</Typography>
                  )}
                  <Typography sx={{ color: selectedChannel === channel.id ? '#ffffff' : '#dcddde' }}>
                    {channel.name}
                  </Typography>
                </Box>
              </ListItem>
            ))}
          </List>
        </AccordionDetails>
      </Accordion>

      {inVoice && voiceChannel && (
        <Box sx={{ mt: 2, p: 2, bgcolor: '#5865f2', borderRadius: 1 }}>
          <Typography variant="body2" sx={{ color: 'white', mb: 1 }}>
            Голосовой канал: {channels.find(c => c.id === voiceChannel)?.name}
          </Typography>
          <Button
            size="small"
            color="secondary"
            onClick={onVoiceLeave}
            variant="contained"
          >
            Выйти
          </Button>
        </Box>
      )}

      <Box sx={{ mt: 3 }}>
        <Typography variant="h6" gutterBottom>Создать канал</Typography>
        <TextField
          fullWidth
          size="small"
          placeholder="Название канала"
          value={newChannelName}
          onChange={(e) => setNewChannelName(e.target.value)}
          sx={{
            mb: 1,
            input: { color: '#ffffff' },
            '& .MuiOutlinedInput-root': {
              '& fieldset': { borderColor: '#40444b' },
              '&:hover fieldset': { borderColor: '#5865f2' },
            }
          }}
        />
        <Box display="flex" gap={1}>
          <Button
            variant="contained"
            color="primary"
            fullWidth
            size="small"
            onClick={() => handleCreateChannel('text')}
            disabled={!newChannelName.trim()}
          >
            # Текст
          </Button>
          <Button
            variant="contained"
            color="secondary"
            fullWidth
            size="small"
            onClick={() => handleCreateChannel('voice')}
            disabled={!newChannelName.trim()}
          >
            🎤 Голос
          </Button>
        </Box>
      </Box>
    </Box>
  );
};

export default ChannelList;