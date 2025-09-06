const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const jwt = require('jsonwebtoken');
const cors = require('cors');

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

app.post('/login', (req, res) => {
  const { nickname } = req.body;
  if (nickname) {
    const role = nickname.toLowerCase() === 'admin' ? 'admin' : 'member';
    const token = jwt.sign({ nickname, role }, 'secret_key', { expiresIn: '1h' });
    res.json({ token, role });
  } else {
    res.status(400).json({ error: 'Nickname required' });
  }
});

app.get('/channels', (req, res) => {
  res.json(channels);
});

app.post('/channels', (req, res) => {
  const { name, type = 'text' } = req.body;
  if (!name) {
    return res.status(400).json({ error: 'Channel name required' });
  }
  const id = name.toLowerCase().replace(/\s+/g, '_');
  if (channels.find(c => c.id === id)) {
    return res.status(400).json({ error: 'Channel already exists' });
  }
  const channel = { id, name, parent: null, type };
  channels.push(channel);
  res.json(channel);
});

// In-memory message storage
let messagesStore = {};

// In-memory user storage {socketId: {nickname, room}}
let users = {};

// In-memory channels
let channels = [
  { id: 'general', name: 'General', parent: null, type: 'text' },
  { id: 'voice-chat', name: 'Voice Chat', parent: null, type: 'voice' }
];

io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  try {
    const decoded = jwt.verify(token, 'secret_key');
    socket.nickname = decoded.nickname;
    return next();
  } catch (err) {
    return next(new Error('Authentication error'));
  }
});

io.on('connection', (socket) => {
  console.log(`User ${socket.nickname} connected`);
  users[socket.id] = { nickname: socket.nickname, room: null };

  socket.on('join_room', (data) => {
    const { room } = data;
    if (!room) return;

    // Leave previous room
    if (socket.room) {
      socket.leave(socket.room);
      delete users[socket.id];
      io.to(socket.room).emit('online_users', Object.values(users).filter(u => u.room === socket.room));
    }

    socket.room = room;
    socket.join(socket.room);
    users[socket.id] = { nickname: socket.nickname, room: socket.room };

    console.log(`User ${socket.nickname} joined room ${socket.room}`);

    // Send join message
    if (!messagesStore[socket.room]) messagesStore[socket.room] = [];
    const joinMessage = {
      author: 'System',
      room: socket.room,
      text: `${socket.nickname} joined the room.`,
      type: 'system',
      timestamp: new Date()
    };
    messagesStore[socket.room].push(joinMessage);
    io.to(socket.room).emit('message', joinMessage);

    // Send online users
    io.to(socket.room).emit('online_users', Object.values(users).filter(u => u.room === socket.room));

    // Send history
    const history = messagesStore[socket.room].filter(msg => msg.type === 'public' || msg.author === socket.nickname || (msg.target && (msg.target === socket.nickname || msg.author === socket.nickname))).reverse().slice(0, 100);
    socket.emit('history', history);
  });

  // Load history (fallback, if needed)
  socket.on('get_history', () => {
    if (!socket.room || !messagesStore[socket.room]) {
      socket.emit('history', []);
      return;
    }
    const history = messagesStore[socket.room].filter(msg => msg.type === 'public' || msg.author === socket.nickname || (msg.target && (msg.target === socket.nickname || msg.author === socket.nickname))).reverse().slice(0, 100);
    socket.emit('history', history);
  });

  // Public message
  socket.on('message', (data) => {
    console.log('Backend received message:', data, 'from room:', socket.room);
    if (!messagesStore[socket.room]) messagesStore[socket.room] = [];
    const msg = {
      author: socket.nickname,
      room: socket.room,
      text: data.text,
      timestamp: new Date(),
      status: 'delivered',
      type: 'public'
    };
    messagesStore[socket.room].push(msg);
    io.to(socket.room).emit('message', msg);
  });

  // Private message
  socket.on('private_message', (data) => {
    const targetSocketId = Object.keys(users).find(id => users[id].nickname === data.to && users[id].room === socket.room);
    if (targetSocketId) {
      if (!messagesStore[socket.room]) messagesStore[socket.room] = [];
      const msg = {
        author: socket.nickname,
        room: socket.room,
        text: data.text,
        timestamp: new Date(),
        type: 'private',
        target: data.to,
        status: 'delivered'
      };
      messagesStore[socket.room].push(msg);
      io.to(targetSocketId).emit('private_message', msg);
      socket.emit('private_message', { ...msg, target: null }); // don't show target to sender
    } else {
      socket.emit('error', { message: 'User not online in this room.' });
    }
  });

  // Speaking
  socket.on('speaking', (data) => {
    socket.to(socket.room).emit('speaking', { nickname: socket.nickname, speaking: data.speaking });
  });

  // Disconnect
  socket.on('disconnect', () => {
    console.log(`User ${socket.nickname} disconnected`);
    if (socket.room) {
      socket.leave(socket.room);
      const leaveMessage = {
        author: 'System',
        room: socket.room,
        text: `${socket.nickname} left the room.`,
        type: 'system',
        timestamp: new Date()
      };
      messagesStore[socket.room].push(leaveMessage);
      io.to(socket.room).emit('message', leaveMessage);
      io.to(socket.room).emit('online_users', Object.values(users).filter(u => u.room === socket.room));
    }
    delete users[socket.id];
  });
});

const PORT = process.env.PORT || 3001;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));