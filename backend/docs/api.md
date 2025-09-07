# Chat-JS API Documentation

## Обзор

Это документация REST API и Socket.IO событий для Chat-JS приложения. Документация автоматически генерируется на основе кода и Swagger спецификаций.

## Base URL

```
http://localhost:3001
```

## Аутентификация

API использует JWT токены для аутентификации. Получить токен можно через endpoint `POST /api/login`.

### Заголовки

```javascript
headers: {
  'Content-Type': 'application/json',
  'Authorization': 'Bearer YOUR_JWT_TOKEN'
}
```

## REST API Endpoints

### Authentication

#### POST /api/register

Регистрация нового пользователя

**Body:**
```json
{
  "identifier": "username",
  "password": "password123"
}
```

**Response (200):**
```json
{
  "user": {
    "id": "user_id",
    "identifier": "username",
    "_id": "user_id"
  },
  "token": "jwt_token"
}
```

**Response (400):**
```json
{
  "errors": [
    {
      "field": "identifier|password",
      "message": "Error message"
    }
  ]
}
```

#### POST /api/login

Вход в систему

**Body:**
```json
{
  "identifier": "username",
  "password": "password123"
}
```

**Response (200):** Same as register
**Response (401):** `{"error": "Invalid credentials"}`
**Response (429):** `{"error": "Too many requests, please try again later"}`

### Chat Management

#### GET /api/channels

Получить список каналов

**Auth:** Required
**Response (200):**
```json
[
  {
    "id": "channel_id",
    "name": "General",
    "type": "text|voice",
    "participants": ["user1", "user2"]
  }
]
```

#### POST /api/channels

Создать новый канал

**Auth:** Required
**Body:**
```json
{
  "name": "New Channel",
  "type": "text"
}
```

**Response (201):** Channel object

#### GET /api/messages/:channelId

Получить сообщения канала

**Auth:** Required
**Query params:**
- `limit`: number (default: 50)
- `before`: message_id (for pagination)

**Response (200):**
```json
[
  {
    "id": "message_id",
    "content": "Hello world!",
    "author": "username",
    "channelId": "channel_id",
    "timestamp": "2024-01-01T00:00:00.000Z"
  }
]
```

### User Management

#### GET /api/users

Получить список пользователей (с статусами онлайн)

**Auth:** Required
**Response (200):**
```json
[
  {
    "id": "user_id",
    "identifier": "username",
    "status": "online|offline",
    "avatar": "hsl_color"
  }
]
```

#### GET /api/users/:userId

Получить информацию о пользователе

**Auth:** Required
**Response (200):**
```json
{
  "id": "user_id",
  "identifier": "username",
  "status": "online|offline",
  "avatar": "hsl_color",
  "channels": ["channel1", "channel2"]
}
```

## Socket.IO Events

### Client to Server Events

#### `join channel`

Присоединиться к каналу

```javascript
socket.emit('join channel', {
  channelId: 'channel_id',
  userId: 'user_id'
});
```

#### `leave channel`

Покинуть канал

```javascript
socket.emit('leave channel', {
  channelId: 'channel_id',
  userId: 'user_id'
});
```

#### `message`

Отправить сообщение

```javascript
socket.emit('message', {
  channelId: 'channel_id',
  content: 'Hello world!',
  timestamp: new Date()
});
```

#### `private message`

Отправить приватное сообщение

```javascript
socket.emit('private message', {
  targetUserId: 'recipient_id',
  content: 'Private message',
  timestamp: new Date()
});
```

#### `voice offer`

Отправить WebRTC offer для голосового звонка

```javascript
socket.emit('voice offer', {
  targetUserId: 'recipient_id',
  offer: sdp_offer_object
});
```

#### `voice answer`

Отправить WebRTC answer

```javascript
socket.emit('voice answer', {
  targetUserId: 'caller_id',
  answer: sdp_answer_object
});
```

#### `ice candidate`

Отправить ICE кандидата

```javascript
socket.emit('ice candidate', {
  targetUserId: 'recipient_id',
  candidate: ice_candidate_object
});
```

### Server to Client Events

#### `message received`

Получение нового сообщения

```javascript
socket.on('message received', (data) => {
  console.log('New message:', data);
  // data: { id, content, author, channelId, timestamp }
});
```

#### `user joined`

Пользователь присоединился к каналу

```javascript
socket.on('user joined', (data) => {
  console.log('User joined:', data);
  // data: { channelId, userId, username }
});
```

#### `user left`

Пользователь покинул канал

```javascript
socket.on('user left', (data) => {
  console.log('User left:', data);
  // data: { channelId, userId, username }
});
```

#### `channel created`

Создан новый канал

```javascript
socket.on('channel created', (data) => {
  console.log('Channel created:', data);
  // data: { id, name, type, participants }
});
```

#### `user status changed`

Статус пользователя изменился

```javascript
socket.on('user status changed', (data) => {
  console.log('Status changed:', data);
  // data: { userId, status, connections }
});
```

#### `voice offer received`

Получен голосовой звонок

```javascript
socket.on('voice offer received', (data) => {
  console.log('Incoming call:', data);
  // data: { fromUserId, offer }
});
```

#### `voice answer received`

Получен ответ на звонок

```javascript
socket.on('voice answer received', (data) => {
  console.log('Call answered:', data);
  // data: { fromUserId, answer }
});
```

#### `ice candidate received`

Получен ICE кандидат

```javascript
socket.on('ice candidate received', (data) => {
  console.log('ICE candidate:', data);
  // data: { fromUserId, candidate }
});
```

## Error Handling

API возвращает ошибки в следующем формате:

```json
{
  "error": "Error message",
  "code": 401,
  "details": "Additional error information"
}
```

### HTTP Status Codes

- `200` - OK
- `201` - Created
- `400` - Bad Request
- `401` - Unauthorized
- `403` - Forbidden
- `404` - Not Found
- `429` - Too Many Requests
- `500` - Internal Server Error

## Rate Limiting

API имеет следующие ограничения по частоте запросов:

- **Authentication endpoints**: 5 requests per 15 minutes
- **API endpoints**: 100 requests per 15 minutes
- **General endpoints**: 1000 requests per hour
- **Password reset**: 3 requests per 15 minutes

## Swagger Documentation

Полная интерактивная документация API доступна по адресу:
```
http://localhost:3001/api-docs
```

## Examples

### Полная flow аутентификации

```javascript
// 1. Регистрация
const register = await fetch('/api/register', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    identifier: 'testuser',
    password: 'password123'
  })
});

const { token } = await register.json();

// 2. Подключение к Socket.IO с JWT
const socket = io('http://localhost:3001', {
  auth: { token }
});

// 3. Присоединение к каналу
socket.emit('join channel', { channelId: 'general' });

// 4. Отправка сообщения
socket.emit('message', {
  channelId: 'general',
  content: 'Hello world!',
  timestamp: new Date()
});

// 5. Прослушивание сообщений
socket.on('message received', (message) => {
  console.log('New message:', message);
});
```

---

## Auto-generated Documentation

Эта документация автоматически генерируется скриптами из исходного кода проекта.

Last updated: {{ new Date().toISOString() }}