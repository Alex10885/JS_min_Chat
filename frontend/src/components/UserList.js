import React from 'react';
import { Typography, List, ListItem, ListItemText, Avatar, Badge, Box } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';

const UserList = ({ users, inVoice, voiceChannel, currentRoom }) => {
  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ color: '#ffffff', mt: 3 }}>
        Пользователи онлайн ({users.length})
      </Typography>
      <List>
        {users.map((user, index) => (
          <ListItem key={`${user.nickname}-${index}`} sx={{ px: 0, py: 0.5 }}>
            <Box sx={{
              display: 'flex',
              alignItems: 'center',
              width: '100%',
              bgcolor: 'transparent',
              borderRadius: 1,
              '&:hover': {
                bgcolor: '#35373c'
              }
            }}>
              <Badge
                color={user.speaking ? 'error' : 'success'}
                variant="dot"
                overlap="circular"
                sx={{
                  mr: 1,
                  '& .MuiBadge-badge': {
                    width: 12,
                    height: 12,
                    borderRadius: '50%'
                  }
                }}
              >
                <Avatar
                  sx={{
                    width: 40,
                    height: 40,
                    bgcolor: `hsl(${index * 137.5 % 360}, 70%, 50%)`,
                    color: 'white',
                    fontWeight: 'bold',
                    fontSize: '1rem'
                  }}
                >
                  {user.nickname[0].toUpperCase()}
                </Avatar>
              </Badge>

              <Box sx={{ flexGrow: 1 }}>
                <ListItemText
                  primary={
                    <Typography variant="body1" sx={{ color: '#ffffff', fontWeight: 'medium' }}>
                      {user.nickname}
                    </Typography>
                  }
                  secondary={
                    <Typography variant="caption" sx={{ color: '#949ba4' }}>
                      {user.speaking ? 'Говорит' : 'Онлайн'} • {user.role || 'member'}
                    </Typography>
                  }
                />
              </Box>

              {/* Voice channel indicator */}
              {inVoice && voiceChannel === currentRoom && (
                <VolumeUpIcon
                  fontSize="small"
                  sx={{
                    color: '#5865f2',
                    ml: 1,
                    opacity: user.speaking ? 1 : 0.5
                  }}
                />
              )}
            </Box>
          </ListItem>
        ))}
      </List>

      {users.length === 0 && (
        <Box sx={{
          textAlign: 'center',
          py: 4,
          color: '#72767d'
        }}>
          <Typography variant="body2">
            Нет пользователей онлайн
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default UserList;