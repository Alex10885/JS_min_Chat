// Socket.IO Test Client for debugging connections
require('dotenv').config();
const io = require('socket.io-client');

console.log('Testing Socket.IO connection to localhost:3003');

const socket = io('http://localhost:3003', {
  auth: { token: 'some-test-token' }, // Will fail auth but we can see error handling
  transports: ['websocket'], // Force WebSocket
  autoConnect: false,
  timeout: 10000
});

socket.on('connect', () => {
  console.log('✅ Socket connected successfully');
});

socket.on('disconnect', (reason) => {
  console.log('🔌 Socket disconnected:', reason);
});

socket.on('connect_error', (err) => {
  console.error('❌ Connection error:', err.message);
});

socket.on('error', (err) => {
  console.error('❌ Socket error:', err);
});

console.log('Attempting to connect...');
socket.connect();

setTimeout(() => {
 console.log('Test completed');
 socket.disconnect();
}, 5000);