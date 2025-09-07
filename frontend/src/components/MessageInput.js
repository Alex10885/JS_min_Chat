import React, { useState } from 'react';
import { TextField, Button, Box, Typography } from '@mui/material';
import SendIcon from '@mui/icons-material/Send';

const MessageInput = ({ socket, isConnected, currentRoom, onSendMessage }) => {
  const [input, setInput] = useState('');

  const handleSendMessage = () => {
    if (!socket || !isConnected) {
      return;
    }

    if (input.trim()) {
      if (!currentRoom) {
        return;
      }

      if (input.startsWith('/w ')) {
        const parts = input.split(' ');
        if (parts.length < 3) {
          return;
        }
        const to = parts[1];
        const text = parts.slice(2).join(' ');
        onSendMessage({ text: `/w ${to} ${text}`, to });
      } else {
        onSendMessage({ text: input });
      }
      setInput('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <Box sx={{
      p: 2,
      borderTop: '1px solid #40444b',
      bgcolor: '#313338'
    }}>
      <Box sx={{ display: 'flex', gap: 1 }}>
        <TextField
          fullWidth
          variant="outlined"
          placeholder={
            !isConnected
              ? 'Нет подключения к серверу...'
              : !currentRoom
              ? 'Выберите канал...'
              : 'Введите сообщение... (Enter для отправки, /w ник сообщение для личного)'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          disabled={!isConnected || !currentRoom}
          multiline
          maxRows={4}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: '#40444b',
              color: '#dcddde',
              '& fieldset': {
                borderColor: '#40444b'
              },
              '&:hover fieldset': {
                borderColor: '#5865f2'
              },
              '&.Mui-focused fieldset': {
                borderColor: '#5865f2'
              },
              '&.Mui-disabled': {
                bgcolor: '#2b2d31',
                color: '#72767d'
              }
            }
          }}
        />
        <Button
          variant="contained"
          color="primary"
          onClick={handleSendMessage}
          disabled={!isConnected || !currentRoom || !input.trim()}
          sx={{
            minWidth: '60px',
            bgcolor: '#5865f2',
            '&:hover': {
              bgcolor: '#4752c4'
            },
            '&:disabled': {
              bgcolor: '#40444b',
              color: '#72767d'
            }
          }}
        >
          <SendIcon />
        </Button>
      </Box>

      {currentRoom && !isConnected && (
        <Typography variant="caption" color="error" sx={{ mt: 1, display: 'block' }}>
          Нет подключения к серверу. Сообщения не могут быть отправлены.
        </Typography>
      )}
    </Box>
  );
};

export default MessageInput;