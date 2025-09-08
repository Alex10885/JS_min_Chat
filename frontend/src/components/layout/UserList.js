import React, { useState, useEffect } from 'react';
import { Typography, List, ListItem, ListItemText, Avatar, Badge, Box, Tabs, Tab } from '@mui/material';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import PersonIcon from '@mui/icons-material/Person';
import GroupIcon from '@mui/icons-material/Group';

const UserList = ({ users, allUsers = [], inVoice, voiceChannel, currentRoom, socket }) => {
  const [tabValue, setTabValue] = useState(0); // 0 - Онлайн, 1 - Все пользователи
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [speakingUsers, setSpeakingUsers] = useState(new Set());

  // Обновляем список онлайн пользователей на основе данных из базы
  useEffect(() => {
    const onlineFromDb = allUsers.filter(user => user.status === 'online');
    setOnlineUsers(onlineFromDb);
  }, [allUsers]);

  // Обработка событий Socket.IO для голосовых индикаторов
  useEffect(() => {
    if (!socket) return;

    const handleSpeakingStart = (data) => {
      setSpeakingUsers(prev => new Set(prev).add(data.nickname));
    };

    const handleSpeakingStop = (data) => {
      setSpeakingUsers(prev => {
        const newSet = new Set(prev);
        newSet.delete(data.nickname);
        return newSet;
      });
    };

    socket.on('speaking', handleSpeakingStart);
    socket.on('stopped_speaking', handleSpeakingStop);

    return () => {
      socket.off('speaking', handleSpeakingStart);
      socket.off('stopped_speaking', handleSpeakingStop);
    };
  }, [socket]);

  const handleTabChange = (event, newValue) => {
    setTabValue(newValue);
  };

  const renderUsers = () => {
    const displayUsers = tabValue === 0 ? onlineFromRoomUsers() : allUsers;

    return displayUsers.map((user, index) => {
      const isOnline = user.status === 'online';
      const isSpeaking = speakingUsers.has(user.nickname);
      const roleDisplay = getRoleDisplay(user.role);

      return (
        <ListItem key={`${user.nickname}-${index}`} sx={{ px: 0, py: 0.5 }}>
          <Box sx={{
            display: 'flex',
            alignItems: 'center',
            width: '100%',
            bgcolor: 'transparent',
            borderRadius: 1,
            opacity: isOnline ? 1 : 0.7,
            '&:hover': {
              bgcolor: '#35373c'
            }
          }}>
            <Badge
              color={isSpeaking ? 'error' : (isOnline ? 'success' : 'default')}
              variant="dot"
              overlap="circular"
              sx={{
                mr: 1,
                '& .MuiBadge-badge': {
                  width: 12,
                  height: 12,
                  borderRadius: '50%',
                  backgroundColor: isSpeaking ? '#ff4444' : (isOnline ? '#22c55e' : '#666')
                }
              }}
            >
              <Avatar
                sx={{
                  width: 40,
                  height: 40,
                  bgcolor: isOnline
                    ? `hsl(${index * 137.5 % 360}, 70%, 50%)`
                    : '#555',
                  color: 'white',
                  fontWeight: 'bold',
                  fontSize: '1rem',
                  border: isOnline ? '2px solid #22c55e' : 'none'
                }}
              >
                {user.nickname[0].toUpperCase()}
              </Avatar>
            </Badge>

            <Box sx={{ flexGrow: 1 }}>
              <ListItemText
                primary={
                  <Typography variant="body1" sx={{
                    color: isOnline ? '#ffffff' : '#888',
                    fontWeight: 'medium'
                  }}>
                    {user.nickname}
                  </Typography>
                }
                secondary={
                  <Typography variant="caption" sx={{ color: '#949ba4' }}>
                    {isSpeaking ? 'Говорит' : (isOnline ? 'Онлайн' : 'Оффлайн')} • {roleDisplay} • Регистрация: {formatDate(user.createdAt)}
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
                  opacity: isSpeaking ? 1 : (isOnline ? 0.7 : 0.3)
                }}
              />
            )}
          </Box>
        </ListItem>
      );
    });
  };

  const onlineFromRoomUsers = () => {
    // Если мы в комнате, получаем пользователей комнаты из Socket.IO
    if (currentRoom && users && users.length > 0) {
      return users.map(socketUser => {
        const dbUser = allUsers.find(u => u.nickname === socketUser.nickname);
        return dbUser || socketUser;
      });
    }
    // Иначе показываем все онлайн пользователи из базы
    return allUsers.filter(user => user.status === 'online');
  };

  const getRoleDisplay = (role) => {
    switch(role) {
      case 'admin': return 'Администратор';
      case 'moderator': return 'Модератор';
      case 'member': return 'Пользователь';
      default: return 'Пользователь';
    }
  };

  const formatDate = (dateString) => {
    if (!dateString) return 'Неизвестно';
    try {
      const date = new Date(dateString);
      return date.toLocaleDateString('ru-RU', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric'
      });
    } catch (error) {
      return 'Неизвестно';
    }
  };

  const getCounts = () => {
    const onlineCount = tabValue === 0 ? onlineFromRoomUsers().length : allUsers.filter(u => u.status === 'online').length;
    const totalCount = allUsers.length;

    return tabValue === 0 ? onlineCount : totalCount;
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom sx={{ color: '#ffffff', mt: 3 }}>
        Пользователи системы ({getCounts()})
      </Typography>

      <Box sx={{ borderBottom: 1, borderColor: 'divider' }}>
        <Tabs value={tabValue} onChange={handleTabChange} sx={{
          '& .MuiTab-root': { color: '#ffffff', minHeight: 40 },
          '& .MuiTabs-indicator': { backgroundColor: '#5865f2' },
        }}>
          <Tab
            label="Онлайн"
            icon={<PersonIcon />}
            iconPosition="start"
            sx={{ textTransform: 'none' }}
          />
          <Tab
            label="Все пользователи"
            icon={<GroupIcon />}
            iconPosition="start"
            sx={{ textTransform: 'none' }}
          />
        </Tabs>
      </Box>

      <List>
        {renderUsers()}
      </List>

      {getCounts() === 0 && (
        <Box sx={{
          textAlign: 'center',
          py: 4,
          color: '#72767d'
        }}>
          <Typography variant="body2">
            {tabValue === 0 ? 'Нет пользователей онлайн' : 'Нет зарегистрированных пользователей'}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default UserList;