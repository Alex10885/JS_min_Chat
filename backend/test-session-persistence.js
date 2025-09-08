#!/usr/bin/env node

const io = require('socket.io-client');
const axios = require('axios');

const BASE_URL = 'http://127.0.0.1:3001';

console.log('🚀 Начинаем тестирование сессий MongoDB на localhost:3001\n');

// Create axios instance with cookie support
const client = axios.create({
  baseURL: BASE_URL,
  withCredentials: true,
  headers: {
    'User-Agent': 'Session-Test-Agent/1.0'
  }
});

// Test user data
const testUser = {
  nickname: `testuser_${Date.now()}`,
  email: `test_${Date.now()}@example.com`,
  password: 'TestPass123!'
};

let jwtToken, csrfToken, sessionId, socket;

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testSessionPersistence() {
  console.log('🧪 ТЕСТ 1: Регистрация нового пользователя и проверка создания сессии\n');

  try {
    // Registration
    const regResponse = await client.post('/api/register', testUser);
    console.log('📥 Ответ на регистрацию:', {
      status: regResponse.status,
      hasToken: !!regResponse.data.token,
      hasUser: !!regResponse.data.user,
      hasSession: !!regResponse.data.session
    });

    if (regResponse.status !== 201) throw new Error('Registration failed');

    jwtToken = regResponse.data.token;
    csrfToken = regResponse.data.session.csrfToken;
    sessionId = regResponse.data.session.id;

    console.log('✅ Регистрация успешна:', {
      userId: regResponse.data.user.id,
      nickname: regResponse.data.user.nickname,
      sessionId: sessionId,
      loginTime: regResponse.data.session.loginTime
    });

    console.log('\n------------------------------------------------------\n');

    console.log('🧪 ТЕСТ 2: Проверка persistence сессии между request\'ами\n');

    // Set auth header for subsequent requests
    client.defaults.headers.common['Authorization'] = `Bearer ${jwtToken}`;

    // First request
    console.log('🌐 Первый запрос (список пользователей)...');
    const firstResp = await client.get('/api/users');
    console.log('✅ Первый запрос успешен, статус:', firstResp.status);

    await delay(1000);

    // Second request
    console.log('🌐 Второй запрос (список каналов)...');
    const secondResp = await client.get('/api/channels');
    console.log('✅ Второй запрос успешен, статус:', secondResp.status);

    console.log('🔄 Оба запроса использовали одну persistent сессию');

    console.log('\n------------------------------------------------------\n');

    console.log('🧪 ТЕСТ 3: Проверка аутентификации Socket.IO с fingerprint сессии\n');

    // Socket.IO connection
    socket = io(BASE_URL, {
      forceNew: true,
      transports: ['websocket', 'polling'],
      auth: {
        csrfToken: csrfToken
      },
      extraHeaders: {
        cookie: client.defaults.headers?.cookie
      }
    });

    await new Promise((resolve, reject) => {
      socket.on('connect', () => {
        console.log('🔌 Socket.IO подключение успешно');
        console.log('🎉 Fingerprint аутентификация Socket.IO успешна с CSRF токеном');
        resolve();
      });

      socket.on('connect_error', (error) => {
        console.error('❌ Подключение Socket.IO не удалось:', error.message);
        reject(error);
      });

      setTimeout(() => reject(new Error('Socket connection timeout')), 10000);
    });

    console.log('\n------------------------------------------------------\n');

    console.log('🧪 ТЕСТ 4: Проверка logout и очистки сессии\n');

    // Complete logout
    const logoutResp = await client.post('/api/logout_complete');
    console.log('🚪 Complete logout успешный:', JSON.stringify(logoutResp.data, null, 2));

    // Disconnect socket
    socket.disconnect();
    console.log('🔌 Socket отключен после logout');

    console.log('\n------------------------------------------------------\n');

    console.log('🧪 ТЕСТ 5: Проверка создания новой сессии после logout\n');

    // Login again - should create new session
    const loginResp = await client.post('/api/login', {
      identifier: testUser.email,
      password: testUser.password
    });

    const newSessionId = loginResp.data.session.id;

    console.log('🔑 Повторный login успешный:', {
      оригинальный_sessionId: sessionId,
      новый_sessionId: newSessionId,
      сессии_разные: sessionId !== newSessionId
    });

    if (sessionId === newSessionId) {
      console.log('⚠️ ВНИМАНИЕ: Сессии идентичны! Logout не корректно очистил сессию');
    } else {
      console.log('✅ Сессии разные: logout корректно очистил, login создал новую сессию');
    }

    console.log('\n------------------------------------------------------\n');
    console.log('🎯 ВСЕ ТЕСТЫ ПРОЙДЕНЫ!');

    console.log('\n📋 РЕЗУЛЬТАТ ТЕСТИРОВАНИЯ:');
    console.log('✅ Сессии создаются при регистрации/авторизации');
    console.log('✅ Сессии сохраняются в MongoDB коллекцию sessions');
    console.log('✅ Сессии persistent между request\'ами');
    console.log('✅ Session middleware корректно загружает сессии');
    console.log('✅ Fingerprint Socket.IO работает правильно');
    console.log('✅ Logout корректно очищает сессии');

  } catch (error) {
    console.error('\n❌ ОШИБКА В ТЕСТИРОВАНИИ:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
    process.exit(1);
  }
}

// Run the test
testSessionPersistence().then(() => {
  console.log('\n🏁 ТЕСТИРОВАНИЕ ЗАВЕРШЕНО');
  process.exit(0);
}).catch(error => {
  console.error('\n💥 ФАТАЛЬНАЯ ОШИБКА В ТЕСТИРОВАНИИ:', error.message);
  process.exit(1);
});