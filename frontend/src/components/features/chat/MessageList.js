import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { List, ListItem, Typography, Box, Fab, Badge, useTheme, useMediaQuery } from '@mui/material';
import { KeyboardArrowDown as ArrowDownIcon } from '@mui/icons-material';
import { throttle, smoothScrollTo, createScrollListener, isNearBottom, debounce } from '../../../utils/performanceUtils';

const MessageList = ({ messages, currentRoom }) => {
  const messagesEndRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // State for scroll tracking
  const [isAtBottom, setIsAtBottom] = useState(true);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [lastMessageCount, setLastMessageCount] = useState(0);

  // Enhanced scroll to bottom function
  const scrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      const scrollHeight = container.scrollHeight;
      const height = container.clientHeight;
      container.scrollTop = scrollHeight - height;
    }
  }, []);

  // Check if user is at bottom
  const checkIfAtBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return true;

    const { scrollTop, scrollHeight, clientHeight } = container;
    const isNearBottom = scrollHeight - scrollTop - clientHeight <= 10; // 10px threshold
    return isNearBottom;
  }, []);

  // Handle scroll events
  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    const newIsAtBottom = checkIfAtBottom();
    const { scrollTop, scrollHeight, clientHeight } = container;
    const shouldShowButton = scrollTop < (scrollHeight - clientHeight - 50);

    setIsAtBottom(newIsAtBottom);
    setShowScrollButton(shouldShowButton);
    setScrollPosition(scrollTop);

    // Reset unread count when user scrolls to bottom
    if (newIsAtBottom) {
      setUnreadCount(0);
    }
  }, [checkIfAtBottom]);

  // Scroll to bottom with smooth animation
  const handleScrollToBottom = useCallback(() => {
    scrollToBottom();
    setUnreadCount(0);
  }, [scrollToBottom]);

  // Optimized message filtering with memoization to prevent recalculations
  const currentRoomMessages = useMemo(() =>
    messages.filter(msg =>
      !currentRoom || msg.room === currentRoom || msg.channel === currentRoom
    ),
    [messages, currentRoom]
  );

  // Optimized scroll event listener with performance utilities
  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;

    // Use our optimized scroll listener with throttling
    const scrollListener = createScrollListener(container, throttle(handleScroll, 16), {
      throttleTime: 16,
      useDebounce: false
    });

    return () => {
      scrollListener?.destroy();
    };
  }, [handleScroll]);

  // Optimized message handling with better debounce
  useEffect(() => {
    const currentMessageCount = currentRoomMessages.length;
    const hasNewMessages = currentMessageCount > lastMessageCount && lastMessageCount > 0;

    if (hasNewMessages) {
      if (isAtBottom) {
        // Use requestAnimationFrame for smooth performance
        requestAnimationFrame(() => {
          scrollToBottom();
        });
      } else {
        // User is scrolling up, increment unread count
        const newMessagesCount = currentMessageCount - lastMessageCount;
        setUnreadCount(prev => Math.min(prev + newMessagesCount, 99)); // Cap at 99
      }
    }

    setLastMessageCount(currentMessageCount);
  }, [currentRoomMessages.length, isAtBottom, scrollToBottom, lastMessageCount]); // More specific deps

  // Initial scroll to bottom and setup tracking
  useEffect(() => {
    setTimeout(() => {
      scrollToBottom();
      setIsAtBottom(true);
      setLastMessageCount(currentRoomMessages.length);
    }, 100);
  }, [currentRoom, currentRoomMessages.length, scrollToBottom]); // Reset when room changes

  return (
    <Box sx={{
      flexGrow: 1,
      overflowY: 'auto',
      p: 2,
      maxHeight: '70vh',
      position: 'relative',
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
    }} ref={messagesContainerRef}>
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

      {/* Floating scroll to bottom button with unread count */}
      {showScrollButton && unreadCount > 0 && (
        <Box
          sx={{
            position: 'absolute',
            bottom: theme => theme.spacing(2),
            right: theme => theme.spacing(2),
            zIndex: 1000,
          }}
        >
          <Badge
            badgeContent={unreadCount}
            color="error"
            max={99}
            sx={{
              '& .MuiBadge-badge': {
                fontSize: '0.75rem',
                fontWeight: 'bold',
              }
            }}
          >
            <Fab
              color="primary"
              size={isMobile ? 'medium' : 'large'}
              onClick={handleScrollToBottom}
              aria-label="Прокрутить к последним сообщениям"
              sx={{
                backgroundColor: '#5865f2',
                '&:hover': {
                  backgroundColor: '#4752c4',
                },
                boxShadow: theme => theme.shadows[4],
              }}
            >
              <ArrowDownIcon />
            </Fab>
          </Badge>
        </Box>
      )}
    </Box>
  );
};

export default React.memo(MessageList);