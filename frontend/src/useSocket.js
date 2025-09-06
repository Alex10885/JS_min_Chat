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

  // Initialize socket connection
  const initializeSocket = useCallback(() => {
    if (!token || socket) return;

    const newSocket = io('http://localhost:3001', {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: false,
      reconnection: false, // We'll handle reconnection manually
      timeout: 10000
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
      console.error('Connection error:', error);
      setIsConnected(false);
      setConnectionStatus('error');

      if (reconnectAttempts.current >= RECONNECT_ATTEMPTS) {
        enqueueSnackbar('Не удалось подключиться к серверу', {
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
  }, [token, enqueueSnackbar]);

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
  }, []);

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