import React, { useState } from 'react';
import { Tabs, Tab, TextField, Button, Typography } from '@mui/material';
import axios from 'axios';

const AuthForm = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState(0); // 0 для login, 1 для register
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [email, setEmail] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    setErrorMessage('');
    const endpoint = mode === 0 ? '/login' : '/register';
    const data = mode === 0
      ? { identifier, password }
      : { nickname, email, password };

    axios.post(endpoint, data)
      .then(response => {
        setErrorMessage('');
        onAuthSuccess(response.data.token, response.data.user);
      })
      .catch(error => {
        setErrorMessage(error.response?.data?.message || 'An error occurred');
        console.error('Authentication error:', error);
      });
  };

  return (
    <>
      <Tabs value={mode} onChange={(event, newValue) => setMode(newValue)}>
        <Tab label="Login" />
        <Tab label="Register" />
      </Tabs>
      <form onSubmit={handleSubmit}>
        {mode === 0 ? (
          <TextField
            label="Identifier"
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            fullWidth
            margin="normal"
            required
          />
        ) : (
          <>
            <TextField
              label="Nickname"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              fullWidth
              margin="normal"
              required
            />
            <TextField
              label="Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              fullWidth
              margin="normal"
              required
            />
          </>
        )}
        <TextField
          label="Password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          fullWidth
          margin="normal"
          required
        />
        <Button type="submit" variant="contained" color="primary">
          {mode === 0 ? 'Login' : 'Register'}
        </Button>
      </form>
      {errorMessage && (
        <Typography color="error" variant="body2" style={{ marginTop: 16 }}>
          {errorMessage}
        </Typography>
      )}
    </>
  );
};

export default AuthForm;