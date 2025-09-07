import React from 'react';
import { Box, Typography, Avatar, Badge, IconButton } from '@mui/material';
import MenuIcon from '@mui/icons-material/Menu';

const Header = ({ isConnected, connectionStatus, nickname, role, isMobile, onMenuClick }) => {
  return (
    <Box sx={{ height: 50, bgcolor: '#36393f', display: 'flex', alignItems: 'center', px: 2 }}>
      {isMobile && (
        <IconButton onClick={onMenuClick} sx={{ color: '#ffffff' }}>
          <MenuIcon />
        </IconButton>
      )}
      <Typography variant={isMobile ? 'body1' : 'h6'} sx={{ color: '#ffffff' }}>
        Chat Server
      </Typography>

      {/* Connection Status Indicator */}
      <Box sx={{ ml: 2, display: 'flex', alignItems: 'center' }}>
        <Box
          sx={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            bgcolor: isConnected ? '#4caf50' : connectionStatus === 'reconnecting' ? '#ff9800' : '#f44336',
            mr: 1
          }}
        />
        {!isMobile && (
          <Typography variant="body2" sx={{ color: '#b9bbbe' }}>
            {isConnected ? 'Подключено' : connectionStatus === 'reconnecting' ? 'Переподключение...' : 'Отключено'}
          </Typography>
        )}
      </Box>

      <Box sx={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>
        {!isMobile && (
          <>
            <Badge color="success" variant="dot" overlap="circular">
              <Avatar sx={{ bgcolor: `hsl(${Math.random() * 360}, 70%, 50%)` }}>
                {nickname[0].toUpperCase()}
              </Avatar>
            </Badge>
            <Typography variant="body1" sx={{ color: '#ffffff', ml: 1 }}>
              {nickname} • {role}
            </Typography>
          </>
        )}
      </Box>
    </Box>
  );
};

export default Header;