import React, { useEffect, useRef } from 'react';
import { List, ListItem, Typography, Box } from '@mui/material';

const MessageList = ({ messages, currentRoom }) => {
  const messagesEndRef = useRef(null);

  // Auto-scroll to bottom when new messages arrive
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Filter messages for current room/channel
  const currentRoomMessages = messages.filter(msg =>
    !currentRoom || msg.room === currentRoom || msg.channel === currentRoom
  );

  return (
    <Box sx={{
      flexGrow: 1,
      overflowY: 'auto',
      p: 2,
      maxHeight: '70vh',
      '&::-webkit-scrollbar': {
        width: '8px',
      },
      '&::-webkit-scrollbar-track': {
        backgroundColor: '#2b2d31',
      },
      '&::-webkit-scrollbar-thumb': {
        backgroundColor: '#5865f2',
        borderRadius: '4px',
      }
    }}>
      <List>
        {currentRoomMessages.map((msg, index) => (
          <ListItem key={`${msg.timestamp}-${index}`} sx={{ px: 0, py: 0.5 }}>
            <Box sx={{ display: 'flex', alignItems: 'flex-start' }}>
              {/* Timestamp */}
              <Typography
                variant="caption"
                color="textSecondary"
                sx={{ mr: 1, minWidth: '60px', fontSize: '0.7rem' }}
              >
                {new Date(msg.timestamp).toLocaleTimeString([], {
                  hour: '2-digit',
                  minute: '2-digit'
                })}
              </Typography>

              {/* Author avatar placeholder */}
              <Box
                sx={{
                  width: 32,
                  height: 32,
                  borderRadius: '50%',
                  bgcolor: `hsl(${msg.author.length * 37 % 360}, 70%, 50%)`,
                  mr: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mt: 0.2
                }}
              >
                <Typography variant="caption" sx={{ color: 'white', fontWeight: 'bold' }}>
                  {msg.author[0]?.toUpperCase()}
                </Typography>
              </Box>

              {/* Message content */}
              <Box sx={{ flexGrow: 1 }}>
                <Typography variant="body2" sx={{ color: '#949ba4', mb: 0.2 }}>
                  <strong style={{ color: msg.type === 'system' ? '#5865f2' : '#ffffff' }}>
                    {msg.author}
                  </strong>
                  {msg.type === 'private' && msg.target && (
                    <span style={{ color: '#949ba4' }}> → {msg.target}</span>
                  )}
                  {msg.type === 'system' && (
                    <Box component="span" sx={{ color: '#5865f2', fontStyle: 'italic' }}>
                      (система)
                    </Box>
                  )}
                </Typography>
                <Typography variant="body1" sx={{ color: '#dcddde', wordWrap: 'break-word' }}>
                  {msg.text}
                </Typography>
              </Box>
            </Box>
          </ListItem>
        ))}
      </List>
      <div ref={messagesEndRef} />
    </Box>
  );
};

export default MessageList;