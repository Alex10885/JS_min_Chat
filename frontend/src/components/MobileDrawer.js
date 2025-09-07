import React, { useState } from 'react';
import { Drawer, Box, Typography, TextField, Button } from '@mui/material';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import axios from 'axios';

const MobileDrawer = ({
  open,
  onClose,
  channels,
  onlineUsers,
  onChannelSelect,
  onVoiceJoin,
  inVoice,
  voiceChannel,
  onVoiceLeave,
  selectedChannel
}) => {
  const [newChannelName, setNewChannelName] = useState('');

  const handleChannelClick = (channel) => {
    if (channel.type === 'voice') {
      onVoiceJoin(channel.id);
    } else {
      onChannelSelect(channel.id);
      onClose(); // Close drawer on text channel selection
    }
  };

  const handleCreateChannel = (type) => {
    if (newChannelName.trim()) {
      axios.post('http://localhost:3001/channels', {
        name: newChannelName.trim(),
        type: type
      })
        .then(() => {
          setNewChannelName('');
        })
        .catch(err => console.error('Failed to create channel:', err));
    }
  };

  return (
    <Drawer anchor="left" open={open} onClose={onClose}>
      <Box sx={{
        width: 280,
        height: '100%',
        bgcolor: '#2b2d31',
        color: '#ffffff',
        p: 2
      }}>
        <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 'bold', mb: 2 }}>
          Chat Server
        </Typography>

        <Typography variant="h6" gutterBottom>Каналы</Typography>
        <Accordion defaultExpanded sx={{
          bgcolor: '#36393f',
          color: '#ffffff',
          '& .MuiAccordionSummary-root': {
            bgcolor: '#36393f',
            color: '#ffffff'
          }
        }}>
          <AccordionSummary expandIcon={<ExpandMoreIcon sx={{ color: '#ffffff' }} />}>
            <FolderOpenIcon sx={{ mr: 1 }} />
            <Typography>Chat Server</Typography>
          </AccordionSummary>
          <AccordionDetails sx={{ p: 0 }}>
            <List>
              {channels.map(channel => (
                <ListItem
                  key={channel.id}
                  button
                  onClick={() => handleChannelClick(channel)}
                  sx={{
                    px: 2,
                    py: 1,
                    bgcolor: selectedChannel === channel.id ? '#40444b' : 'transparent',
                    '&:hover': {
                      bgcolor: '#35373c'
                    }
                  }}
                >
                  {channel.type === 'voice' ? (
                    <VolumeUpIcon fontSize="small" sx={{ mr: 1, color: '#72767d' }} />
                  ) : (
                    <Typography sx={{ mr: 1, color: '#72767d' }}>#</Typography>
                  )}
                  <Typography sx={{ color: selectedChannel === channel.id ? '#ffffff' : '#dcddde' }}>
                    {channel.name}
                  </Typography>
                </ListItem>
              ))}
            </List>
          </AccordionDetails>
        </Accordion>

        {inVoice && voiceChannel && (
          <Box sx={{
            mt: 2,
            p: 2,
            bgcolor: '#5865f2',
            borderRadius: 1
          }}>
            <Typography variant="body2" sx={{ color: 'white', mb: 1 }}>
              Голосовой канал: {channels.find(c => c.id === voiceChannel)?.name}
            </Typography>
            <Button
              size="small"
              color="secondary"
              onClick={onVoiceLeave}
              variant="contained"
            >
              <HeadphonesIcon fontSize="small" sx={{ mr: 0.5 }} />
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

        <Box sx={{ mt: 3 }}>
          <Typography variant="h6" gutterBottom>
            Пользователи онлайн ({onlineUsers.length})
          </Typography>
          <List>
            {onlineUsers.map((user, index) => (
              <ListItem key={index} sx={{ px: 0 }}>
                <Box sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: `hsl(${index * 137.5 % 360}, 70%, 50%)`,
                  mr: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}>
                  <Typography sx={{ color: 'white', fontWeight: 'bold', fontSize: '0.8rem' }}>
                    {user.nickname[0].toUpperCase()}
                  </Typography>
                </Box>
                <Box>
                  <Typography variant="body2" sx={{ color: '#ffffff' }}>
                    {user.nickname}
                  </Typography>
                  <Typography variant="caption" sx={{ color: '#949ba4' }}>
                    {user.role || 'member'}
                  </Typography>
                </Box>
              </ListItem>
            ))}
          </List>
        </Box>
      </Box>
    </Drawer>
  );
};

export default MobileDrawer;