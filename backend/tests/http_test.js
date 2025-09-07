const http = require('http');

const loginData = JSON.stringify({
  identifier: 'testuser',
  password: 'password123'
});

const options = {
  hostname: '127.0.0.1',
  port: 3001,
  path: '/api/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(loginData)
  }
};

const req = http.request(options, (res) => {
  console.log(`Status: ${res.statusCode}`);
  console.log('Headers:', res.headers);

  let body = '';
  res.on('data', (chunk) => {
    body += chunk;
  });

  res.on('end', () => {
    console.log('Response:', body);
    if (res.statusCode === 200) {
      try {
        const response = JSON.parse(body);
        console.log('Login successful, token:', response.token?.substring(0, 20) + '...');
        console.log('User:', response.user?.nickname);
      } catch (e) {
        console.error('Failed to parse response');
      }
    }
  });
});

req.on('error', (e) => {
  console.error(`Problem with request: ${e.message}`);
});

req.write(loginData);
req.end();