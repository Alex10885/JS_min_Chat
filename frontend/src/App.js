import React, { useState, useEffect, useMemo } from 'react';
import ErrorBoundary from './ErrorBoundary';
import useSocket from './useSocket';
import useWebRTC from './useWebRTC';
import axios from 'axios';
import { Container, Paper, TextField, Button, List, ListItem, Typography, Box, ListItemText, Avatar, ThemeProvider, createTheme, CssBaseline, Badge, Drawer, IconButton, useMediaQuery } from '@mui/material';
import { SnackbarProvider, useSnackbar } from 'notistack';
import Grid from '@mui/material/Grid';
import Accordion from '@mui/material/Accordion';
import AccordionSummary from '@mui/material/AccordionSummary';
import AccordionDetails from '@mui/material/AccordionDetails';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import FolderIcon from '@mui/icons-material/Folder';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import SpeakerIcon from '@mui/icons-material/Speaker';
import VolumeUpIcon from '@mui/icons-material/VolumeUp';
import MicIcon from '@mui/icons-material/Mic';
import MicOffIcon from '@mui/icons-material/MicOff';
import AddIcon from '@mui/icons-material/Add';
import RemoveIcon from '@mui/icons-material/Remove';
import HeadphonesIcon from '@mui/icons-material/Headphones';
import MenuIcon from '@mui/icons-material/Menu';

  // Old socket removed - using useSocket hook now

const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#5865f2', // Discord blue
    },
    background: {
      default: '#313338',
      paper: '#2b2d31',
    },
    text: {
      primary: '#dbdee1',
      secondary: '#949ba4',
    },
  },
  typography: {
    fontFamily: 'Whitney, sans-serif', // Discord font
  },
  components: {
    MuiPaper: {
      styleOverrides: {
        root: {
          backgroundImage: 'none',
        },
      },
    },
  },
});

function App() {
  const isMobile = useMediaQuery('(max-width:600px)');
  const { enqueueSnackbar } = useSnackbar();

  const [token, setToken] = useState(localStorage.getItem('chatToken') || '');
  const [nickname, setNickname] = useState('User1');
  const [role, setRole] = useState('member');
  const [room, setRoom] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [onlineUsers, setOnlineUsers] = useState([]);
  const [channels, setChannels] = useState([]);
  const [expanded, setExpanded] = useState([]);
  const [selected, setSelected] = useState('general');
  const [newChannelName, setNewChannelName] = useState('');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [voiceChannel, setVoiceChannel] = useState(null);
  const [inVoice, setInVoice] = useState(false);

  // Socket connection hook
  const { socket, isConnected, connectionStatus } = useSocket(token, { nickname, role });

  // WebRTC voice hook
  const {
    isConnected: voiceConnected,
    isMuted,
    participants: voiceParticipants,
    localAudioRef,
    toggleMute
  } = useWebRTC(socket, voiceChannel);

  const validSelectedItems = useMemo(() => {
    const validChannels = channels.filter(c => c.id);
    if (!room || !validChannels.find(c => c.id === room)) return [];
    return [room];
  }, [channels, room]);

  useEffect(() => {
    if (!token) {
      // Register new user if not already logged in
      // For demo purposes, we'll use a simple auto-registration
      const defaultEmail = `${nickname.toLowerCase()}@example.com`;
      axios.post('http://localhost:3001/register', {
        nickname: nickname,
        email: defaultEmail,
        password: 'password123' // In production, this would be user input
      })
        .then(res => {
          setToken(res.data.token);
          localStorage.setItem('chatToken', res.data.token);
          setRole(res.data.user.role);
          enqueueSnackbar(`Добро пожаловать, ${res.data.user.nickname}!`, { variant: 'success' });
        })
        .catch(err => {
          // Try login if registration failed (user might already exist)
          axios.post('http://localhost:3001/login', {
            identifier: nickname,
            password: 'password123'
          })
            .then(res => {
              setToken(res.data.token);
              localStorage.setItem('chatToken', res.data.token);
              setRole(res.data.user.role);
            })
            .catch(loginErr => {
              console.error('Auth failed:', loginErr);
              enqueueSnackbar('Ошибка аутентификации', { variant: 'error' });
            });
        });
    }
  }, [token, nickname, enqueueSnackbar]);

  useEffect(() => {
    if (!token) return;

    // Fetch channels and set initial room
    axios.get('http://localhost:3001/channels')
      .then(res => {
        const uniqueChannels = res.data.filter((channel, index, self) =>
          index === self.findIndex(c => c.id === channel.id)
        );
        setChannels(uniqueChannels);
        setExpanded(['server']);
      })
      .catch(err => console.error('Failed to fetch channels:', err));
  }, [token]);

  useEffect(() => {
    if (!token || !room || !socket) return;

    // Emit join_room when room changes
    socket.emit('join_room', { room, nickname });
  }, [token, room, socket, nickname]);

  // Setup socket listeners once with new hook
  useEffect(() => {
    if (!socket || !token) return;

    socket.on('message', (msg) => {
      console.log('Received message:', msg);
      setMessages(prev => [...prev, msg]);
    });

    socket.on('private_message', (msg) => setMessages(prev => [...prev, msg]));
    socket.on('history', (history) => setMessages(history));
    socket.on('online_users', (users) => setOnlineUsers(users));
    socket.on('speaking', (data) => {
      setOnlineUsers(prev => prev.map(u => u.nickname === data.nickname ? { ...u, speaking: data.speaking } : u));
    });
    socket.on('error', (err) => {
      console.error('Socket error:', err.message);
      enqueueSnackbar(`Ошибка соединения: ${err.message}`, { variant: 'error' });
    });

    // Cleanup function moved to useSocket hook
  }, [socket, token, enqueueSnackbar]);

  // Initial room set after token and channels are loaded
  useEffect(() => {
    if (channels.length > 0 && !room) {
      setRoom('general');
    }
  }, [channels, room]);

  const sendMessage = () => {
    if (!socket || !isConnected) {
      enqueueSnackbar('Нет соединения с сервером', { variant: 'error' });
      return;
    }

    if (input.trim()) {
      if (!room) {
        enqueueSnackbar('Не выбран канал', { variant: 'warning' });
        return;
      }

      if (input.startsWith('/w ')) {
        const parts = input.split(' ');
        if (parts.length < 3) {
          enqueueSnackbar('Используйте: /w [никнейм] [сообщение]', { variant: 'warning' });
          return;
        }
        const to = parts[1];
        const text = parts.slice(2).join(' ');
        socket.emit('private_message', { to, text });
      } else {
        socket.emit('message', { text: input });
      }
      setInput('');
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') sendMessage();
  };

  const joinVoice = (channelId) => {
    const channel = channels.find(c => c.id === channelId);
    if (channel && channel.type === 'voice') {
      setVoiceChannel(channelId);
      setInVoice(true);
      console.log(`Joined voice channel: ${channel.name}`);
    }
  };

  const leaveVoice = () => {
    setInVoice(false);
    setVoiceChannel(null);
  };


  return (
    <ThemeProvider theme={darkTheme}>
      <CssBaseline />
      <Container maxWidth={false} style={{ height: '100vh', width: '100vw', background: 'linear-gradient(180deg, #5865f2 0%, #313338 100%)', padding: 0, margin: 0 }}>
        <Box sx={{ height: 50, bgcolor: '#36393f', display: 'flex', alignItems: 'center', px: 2 }}>
          {isMobile && (
            <IconButton onClick={() => setDrawerOpen(true)} sx={{ color: '#ffffff' }}>
              <MenuIcon />
            </IconButton>
          )}
          <Typography variant={isMobile ? 'body1' : 'h6'} sx={{ color: '#ffffff', ml: isMobile ? 0 : 0 }}>
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
        {isMobile && (
          <Drawer anchor="left" open={drawerOpen} onClose={() => setDrawerOpen(false)}>
            <Box sx={{ width: 250, height: '100%', bgcolor: '#2b2d31', color: '#ffffff', p: 2 }}>
              <Typography variant="h5" sx={{ color: '#ffffff', fontWeight: 'bold' }}>Chat Server</Typography>
              <Typography variant="h6" gutterBottom>Каналы</Typography>
              <ErrorBoundary>
              {console.log('Mobile TreeView - Channels:', channels, 'Number of channels:', channels.length)}
              {console.log('Mobile TreeView - ValidSelectedItems:', validSelectedItems)}
              {console.log('Mobile TreeView - Expanded:', expanded)}
              {console.log('Mobile TreeView - Tree structure check - Server nodeId exists: true (manual), has children:', channels.length > 0)}
              {channels.forEach((ch, idx) => console.log(`Channel ${idx}: id=${ch.id}, name=${ch.name}, type=${ch.type}`))}
              <Accordion defaultExpanded>
                <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                  <FolderOpenIcon />
                  <Typography sx={{ ml: 1 }}>Chat Server</Typography>
                </AccordionSummary>
                <AccordionDetails>
                  <List>
                    {channels.map(channel => (
                      <ListItem key={channel.id}>
                        <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', width: '100%' }} onClick={() => {
                          if (channel.type === 'voice') {
                            joinVoice(channel.id);
                          } else {
                            setRoom(channel.id);
                            setSelected(channel.id);
                          }
                        }}>
                          {channel.type === 'voice' ? <VolumeUpIcon fontSize="small" /> : <Typography sx={{ mr: 0.5 }}>#</Typography>}
                          <Typography>{channel.name}</Typography>
                        </Box>
                      </ListItem>
                    ))}
                  </List>
                </AccordionDetails>
              </Accordion>
              </ErrorBoundary>
              {inVoice && voiceChannel && (
                <Box sx={{ mt: 2, p: 2, bgcolor: '#5865f2', borderRadius: 1 }}>
                  <Typography variant="body2">Голосовой канал: {channels.find(c => c.id === voiceChannel)?.name}</Typography>
                  <Button size="small" color="secondary" onClick={leaveVoice} sx={{ mt: 1 }}>
                    <HeadphonesIcon /> Выйти
                  </Button>
                </Box>
              )}
              <Box sx={{ mt: 2 }}>
                <TextField
                  fullWidth
                  size="small"
                  placeholder="New Channel Name"
                  value={newChannelName}
                  onChange={(e) => setNewChannelName(e.target.value)}
                  sx={{ input: { color: '#ffffff' } }}
                />
                <Box display="flex" gap={1} sx={{ mt: 1 }}>
                  <Button
                    variant="contained"
                    color="primary"
                    fullWidth
                    onClick={() => {
                      if (newChannelName.trim()) {
                        axios.post('http://localhost:3001/channels', { name: newChannelName.trim(), type: 'text' })
                          .then(res => {
                            setChannels(prev => [...prev, res.data]);
                            setNewChannelName('');
                          })
                          .catch(err => console.error('Failed to create channel:', err));
                      }
                    }}
                  >
                    # Текст
                  </Button>
                  <Button
                    variant="contained"
                    color="secondary"
                    fullWidth
                    onClick={() => {
                      if (newChannelName.trim()) {
                        axios.post('http://localhost:3001/channels', { name: newChannelName.trim(), type: 'voice' })
                          .then(res => {
                            setChannels(prev => [...prev, res.data]);
                            setNewChannelName('');
                          })
                          .catch(err => console.error('Failed to create channel:', err));
                      }
                    }}
                  >
                    🎤 Голос
                  </Button>
                </Box>
              </Box>
            </Box>
          </Drawer>
        )}
      <Grid container spacing={2} style={{ height: 'calc(100% - 50px)' }}>
        <Grid size={{ xs: 12, sm: 3 }} sx={{ display: { xs: 'none', sm: 'block' } }}>
          <Paper elevation={3} style={{ height: '100%', padding: 10 }}>
            <Typography variant="h5" style={{ color: '#5865f2', fontWeight: 'bold' }}>Chat Server</Typography>
            <Typography variant="h6" gutterBottom>Каналы</Typography>
            <ErrorBoundary>
            {console.log('Desktop TreeView - Channels:', channels, 'Number of channels:', channels.length)}
            {console.log('Desktop TreeView - ValidSelectedItems:', validSelectedItems)}
            {console.log('Desktop TreeView - Expanded:', expanded)}
            {console.log('Desktop TreeView - Tree structure check - Server nodeId exists: true (manual), has children:', channels.length > 0)}
            {channels.forEach((ch, idx) => console.log(`Channel ${idx}: id=${ch.id}, name=${ch.name}, type=${ch.type}`))}
            <Accordion defaultExpanded>
              <AccordionSummary expandIcon={<ExpandMoreIcon />}>
                <FolderOpenIcon />
                <Typography sx={{ ml: 1 }}>Chat Server</Typography>
              </AccordionSummary>
              <AccordionDetails>
                <List>
                  {channels.map(channel => (
                    <ListItem key={channel.id}>
                      <Box sx={{ display: 'flex', alignItems: 'center', cursor: 'pointer', width: '100%' }} onClick={() => {
                        if (channel.type === 'voice') {
                          joinVoice(channel.id);
                        } else {
                          setRoom(channel.id);
                          setSelected(channel.id);
                        }
                      }}>
                        {channel.type === 'voice' ? <VolumeUpIcon fontSize="small" /> : <Typography sx={{ mr: 0.5 }}>#</Typography>}
                        <Typography>{channel.name}</Typography>
                      </Box>
                    </ListItem>
                  ))}
                </List>
              </AccordionDetails>
            </Accordion>
            </ErrorBoundary>
            {inVoice && voiceChannel && (
              <Box style={{ marginTop: 10, padding: 10, backgroundColor: '#5865f2', borderRadius: 5, color: 'white' }}>
                <Typography variant="body2">Голосовой канал: {channels.find(c => c.id === voiceChannel)?.name}</Typography>
                <Button size="small" color="secondary" onClick={leaveVoice} style={{ marginTop: 5 }}>
                  <HeadphonesIcon /> Выйти
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={toggleMute}
                  style={{ marginTop: 5, marginLeft: 5 }}
                >
                  {isMuted ? <MicOffIcon /> : <MicIcon />}
                </Button>
              </Box>
            )}
            <Box style={{ marginTop: 20 }}>
              <TextField
                fullWidth
                size="small"
                placeholder="New Channel Name"
                value={newChannelName}
                onChange={(e) => setNewChannelName(e.target.value)}
              />
              <Box display="flex" gap={1}>
                <Button
                  variant="contained"
                  color="primary"
                  fullWidth
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    if (newChannelName.trim()) {
                      axios.post('http://localhost:3001/channels', { name: newChannelName.trim(), type: 'text' })
                        .then(res => {
                          setChannels(prev => [...prev, res.data]);
                          setNewChannelName('');
                        })
                        .catch(err => console.error('Failed to create channel:', err));
                    }
                  }}
                >
                  # Текст
                </Button>
                <Button
                  variant="contained"
                  color="secondary"
                  fullWidth
                  style={{ marginTop: 10 }}
                  onClick={() => {
                    if (newChannelName.trim()) {
                      axios.post('http://localhost:3001/channels', { name: newChannelName.trim(), type: 'voice' })
                        .then(res => {
                          setChannels(prev => [...prev, res.data]);
                          setNewChannelName('');
                        })
                        .catch(err => console.error('Failed to create channel:', err));
                    }
                  }}
                >
                  🎤 Голос
                </Button>
              </Box>
            </Box>
            <Typography variant="h6" gutterBottom style={{ marginTop: 20 }}>Пользователи онлайн</Typography>
            <List>
              {onlineUsers.map((user, index) => (
                <ListItem key={index}>
                  <Badge color={user.speaking ? 'error' : 'success'} variant="dot" overlap="circular">
                    <Avatar style={{
                      marginRight: 10,
                      backgroundColor: `hsl(${index * 137.5 % 360}, 70%, 50%)`,
                      color: 'white'
                    }}>{user.nickname[0].toUpperCase()}</Avatar>
                  </Badge>
                  <ListItemText
                    primary={user.nickname}
                    secondary={`${user.speaking ? 'Говорит' : 'Онлайн'} • ${user.role || 'member'}`}
                  />
                  {inVoice && voiceChannel === room && (
                    <VolumeUpIcon fontSize="small" color="primary" style={{ marginLeft: 10 }} />
                  )}
                </ListItem>
              ))}
            </List>
          </Paper>
        </Grid>
        <Grid size={{ xs: 12, sm: 6 }}>
          <Paper elevation={3} style={{ height: '90vh', display: 'flex', flexDirection: 'column' }}>
            <Box flexGrow={1} style={{ overflowY: 'auto', padding: 10 }}>
              <List>
                {messages.map((msg, index) => (
                  <ListItem key={index}>
                    <Typography variant="body2" color="textSecondary" style={{ marginRight: 10 }}>
                      {new Date(msg.timestamp).toLocaleTimeString()}
                    </Typography>
                    <Typography variant="body1">
                      <strong>{msg.author}:</strong> {msg.text}
                    </Typography>
                  </ListItem>
                ))}
              </List>
            </Box>
            <Box style={{ padding: 10 }}>
              <TextField
                fullWidth
                label="Введите сообщение"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyPress}
              />
              <Button type="button" variant="contained" color="primary" onClick={() => { console.log('Button clicked'); sendMessage(); }} style={{ marginTop: 10 }}>
                Отправить
              </Button>
            </Box>
          </Paper>
        </Grid>
        <Grid size={{ sm: 3 }} sx={{ display: { xs: 'none', md: 'block' } }}>
          <Paper elevation={3} style={{ height: '100%', padding: 10 }}>
            <Typography variant="h6">Приватные чаты</Typography>
            <List>
              {/* Future: List private conversations */}
            </List>
          </Paper>
        </Grid>
      </Grid>

      {/* Hidden audio elements for WebRTC */}
      <audio ref={localAudioRef} style={{ display: 'none' }} />
      {voiceParticipants.map(participant => (
        <audio
          key={participant.socketId}
          ref={el => {
            if (el && participant.stream) {
              el.srcObject = participant.stream;
            }
          }}
          autoPlay
          style={{ display: 'none' }}
        />
      ))}
    </Container>
    </ThemeProvider>
  );
}

export default App;
