// Socket.IO Test Client for debugging connections with session auth
require('dotenv').config();
const io = require('socket.io-client');

// Mock session data (simulate what frontend would send)
const sessionId = 'test-session-id-123'; // Replace with actual session ID
const csrfToken = process.env.JWT_SECRET || 'your-very-long-secure-secret-key-change-in-production';

console.log('Testing Socket.IO connection to localhost:3001 with session auth');
console.log('Session ID:', sessionId);
console.log('CSRF Token:', csrfToken);

const socket = io('http://localhost:3001', {
  auth: { sessionId, csrfToken }, // Updated auth method
  transports: ['websocket', 'polling'],
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

// Listen for authentication-related events
socket.on('banned', (data) => {
  console.log('❌ User is banned:', data);
});

console.log('Attempting to connect...');
socket.connect();

setTimeout(() => {
  console.log('Test completed');
  socket.disconnect();
  process.exit(0);
}, 5000);