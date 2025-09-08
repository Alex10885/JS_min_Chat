import { useState, useEffect, useRef, useCallback } from 'react';
import { io } from 'socket.io-client';
import { useSnackbar } from 'notistack';
import { Button } from '@mui/material';

const RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY = 1000;
const MAX_RECONNECT_DELAY = 30000;

const useSocket = (token, user) => {
  const [socket, setSocket] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState('disconnected');
  const reconnectAttempts = useRef(0);
  const reconnectTimeoutRef = useRef(null);
  const { enqueueSnackbar } = useSnackbar();

  // Parse JWT and get CSRF token from it
  const parseJWT = useCallback((token) => {
    try {
      const base64Url = token.split('.')[1];
      const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
      const jsonPayload = decodeURIComponent(atob(base64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
      }).join(''));
      return JSON.parse(jsonPayload);
    } catch (e) {
      console.error('Failed to parse JWT:', e);
      return null;
    }
  }, []);

  // Get CSRF token and sessionId from JWT token
  const getSessionData = useCallback(() => {
    if (!token) {
      console.error('No token available for CSRF extraction');
      return { csrfToken: null, sessionId: null };
    }

    const parsedJWT = parseJWT(token);
    if (!parsedJWT) {
      console.error('Failed to parse JWT, possibly invalid or expired');
      enqueueSnackbar('Authentication error: Invalid session token', {
        variant: 'error',
        autoHideDuration: 5000
      });
      return { csrfToken: null, sessionId: null };
    }

    const csrfToken = parsedJWT.csrfToken;
    const sessionId = parsedJWT.sessionId;

    if (!csrfToken) {
      console.error('CSRF token not found in JWT, authentication will fail on server');
      enqueueSnackbar('Authentication error: Invalid session token', {
        variant: 'error',
        autoHideDuration: 5000
      });
    }

    return { csrfToken, sessionId };
  }, [token, parseJWT, enqueueSnackbar]);

  // Initialize socket connection
  const initializeSocket = useCallback(() => {
    if (!token || socket) return;

    // Get sessionId from getSessionData, or fallback to JWT if not decoded yet
    const sessionData = getSessionData();
    let sessionId = sessionData.sessionId;

    // If sessionId is not decoded from JWT, try to get it from cookies as fallback
    if (!sessionId) {
      const match = document.cookie.match(/chatSession=s%3A([^.]+\.[^.]+)\.[^;]*/);
      if (match) {
        sessionId = match[1];
        console.log('Recovered sessionId from cookie');
      }
    }

    const { csrfToken } = sessionData;

    // Check if CSRF token is available
    if (!csrfToken) {
      console.error('Cannot initialize socket: CSRF token not available from JWT');
      enqueueSnackbar('Authentication error: Invalid session token', { variant: 'error' });
      return;
    }
    const newSocket = io('http://localhost:3001', {
      auth: {
        csrfToken,
        sessionId  // Add sessionId from JWT for backend session recovery
      },
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: false, // We'll handle reconnection manually
      timeout: 10000,
      withCredentials: true
    });

    // Connection event handlers
    newSocket.on('connect', () => {
      console.log('Socket connected successfully');
      setIsConnected(true);
      setConnectionStatus('connected');
      reconnectAttempts.current = 0;

      enqueueSnackbar('Подключено к чату', {
        variant: 'success',
        autoHideDuration: 2000
      });
    });

    // Heartbeat handler - respond to server's heartbeat requests
    newSocket.on('heartbeat_request', () => {
      console.log('💓 Heartbeat request received from server');
      if (newSocket && newSocket.connected) {
        newSocket.emit('heartbeat_response');
        console.log('💓 Heartbeat response sent to server');
      }
    });

    newSocket.on('disconnect', (reason) => {
      console.log('Socket disconnected:', reason);
      setIsConnected(false);

      if (reason === 'io server disconnect') {
        setConnectionStatus('disconnected');
        enqueueSnackbar('Соединение прервано сервером', {
          variant: 'warning',
          autoHideDuration: 3000
        });
        // Server initiated disconnect, don't reconnect
      } else if (reason === 'io client disconnect') {
        setConnectionStatus('disconnected');
      } else {
        setConnectionStatus('reconnecting');
        handleReconnection();
      }
    });

    newSocket.on('connect_error', (error) => {
      console.error('🔌 Socket connect_error:', {
        message: error.message,
        type: error.type,
        description: error.description,
        context: error.context
      });
      setIsConnected(false);
      setConnectionStatus('error');

      if (reconnectAttempts.current >= RECONNECT_ATTEMPTS) {
        console.error('🔌 Max reconnect attempts reached, stopping reconnection');
        enqueueSnackbar('Не удалось подключиться к серверу: ' + (error.message || 'Connection error'), {
          variant: 'error',
          persist: true,
          action: (key) => (
            <Button onClick={() => {
              reconnectAttempts.current = 0;
              handleReconnection();
              enqueueSnackbar.closeSnackbar(key);
            }}>
              Повторить
            </Button>
          )
        });
      }
    });

    newSocket.on('reconnecting', (attempt) => {
      console.log(`Reconnection attempt ${attempt}`);
      setConnectionStatus('reconnecting');

      if (attempt === 1) {
        enqueueSnackbar('Подключение... Попытка переподключения', {
          variant: 'info',
          autoHideDuration: 2000
        });
      }
    });

    setSocket(newSocket);
  }, [token, enqueueSnackbar, socket, getSessionData]);

  // Clean up existing socket
  const cleanupSocket = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (socket) {
      socket.removeAllListeners();
      socket.disconnect();
      setSocket(null);
      setIsConnected(false);
      setConnectionStatus('disconnected');
    }
  }, [socket]);

  // Handle reconnection with exponential backoff
  const handleReconnection = useCallback(() => {
    if (reconnectAttempts.current >= RECONNECT_ATTEMPTS) {
      console.log('Max reconnection attempts reached');
      setConnectionStatus('disconnected');
      return;
    }

    reconnectAttempts.current++;
    const delay = Math.min(RECONNECT_DELAY * Math.pow(2, reconnectAttempts.current - 1), MAX_RECONNECT_DELAY);

    console.log(`Scheduling reconnection attempt ${reconnectAttempts.current} in ${delay}ms`);

    reconnectTimeoutRef.current = setTimeout(() => {
      if (socket && !socket.connected) {
        socket.connect();
      }
    }, delay);
  }, [socket]);

  // Manual reconnection
  const reconnect = useCallback(() => {
    reconnectAttempts.current = 0;
    if (socket && !socket.connected) {
      socket.connect();
    }
  }, [socket]);

  // Initialize socket when token is available
  useEffect(() => {
    if (token) {
      initializeSocket();
    }

    return () => {
      cleanupSocket();
    };
  }, [token, initializeSocket, cleanupSocket]);

  // Connect socket when initialized
  useEffect(() => {
    if (socket && !socket.connected && connectionStatus !== 'reconnecting') {
      console.log('🔌 Attempting to connect socket...');
      socket.connect();
    }
  }, [socket, connectionStatus]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      cleanupSocket();
    };
  }, [cleanupSocket]);

  return {
    socket,
    isConnected,
    connectionStatus,
    reconnect
  };
};

export default useSocket;