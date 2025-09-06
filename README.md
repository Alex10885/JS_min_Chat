# Chat-JS

Реал-тайм чат приложение в стиле Discord, разработанное на React (frontend) и Node.js с Socket.IO (backend).

## Архитектура

Текущая архитектура приложения (актуальная на 2025 год):

```mermaid
graph TD
    A[React Frontend - Material-UI] --> B[Socket.IO Client]
    B --> C[Express Server + Socket.IO]
    C --> D[JWT Authentication]
    C --> E[Room/Channel Management]
    C --> F[MongoDB + Mongoose]
    C -.-> G[WebRTC Voice - Future]

    subgraph Frontend
        A --> H[Channel Sidebar with Accordion]
        A --> I[Chat Area with Message History]
        A --> J[User List + Private DMs]
        A --> K[Voice Channel UI (WebRTC pending)]
        A --> L[Mobile Responsive Drawer]
        A --> M[Dark Discord Theme]
    end

    subgraph Backend
        C --> N[Authentication & Registration]
        C --> O[Message Persistence]
        C --> P[Channel Management]
        C --> Q[Winston Logging]
        Q --> R[Error handling & Validation]
    end

    F --> S[User Model - Bcrypt hashing]
    F --> T[Message Model - Indexed]
    F --> U[Channel Model - Permissions]
```

### Обзор архитектуры
- **Frontend**: React приложение с Material-UI и темной темой Discord-style. Полностью адаптивное, включая мобильную версию с Drawer.
- **Backend**: Express + Socket.IO сервер с in-memory хранением. JWT аутентификация.
- **Коммуникация**: WebSocket для реал-тайма, HTTP для каналов и аутентификации.
- **Функции**: Каналы (текст/голос), приватные сообщения, индикаторы речи, история сообщений.
### Обзор архитектуры
- **Frontend**: React приложение с Material-UI и темной темой Discord-style. Полностью адаптивное, включая мобильную версию с Drawer.
- **Backend**: Express + Socket.IO сервер с персистентностью MongoDB. JWT аутентификация с хешированием БД.
- **Коммуникация**: WebSocket для реал-тайма, HTTP для каналов и аутентификации.
- **Функции**: Каналы (текст/голос), приватные сообщения, индикаторы речи, история сообщений.
- **Будущее**: WebRTC для голосового общения, Redis для масштабирования.

### Текущее состояние
- ✅ Полная персистентность данных (MongoDB)
- ✅ Полноценная аутентификация с аккаунтами
- ✅ Реал-тайм чат с Socket.IO
- ✅ Мобильная адаптация
- ✅ Базовые голосовые каналы (UI готовы)
- ❌ Voice функционал только UI, без WebRTC
- ❌ Недостаточное покрытие тестами

## Стек технологий

### Backend
- **Node.js** + **Express** - HTTP сервер
- **Socket.IO** - WebSocket коммуникация
- **JWT** - аутентификация
- **Mongoose** (готов для подключения MongoDB)
- **CORS** - cross-origin requests

### Frontend
- **React 19** + **Material-UI** - UI фреймворк
- **Socket.IO Client** - WebSocket клиент
- **Axios** - HTTP запросы
- Адаптивный дизайн (mobile-first)

## Структура проекта

```
chat-js/
├── backend/
│   ├── package.json
│   └── server.js          # Сервер Socket.IO
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.js        # Главный компонент
│   │   ├── App.css
│   │   └── ...
│   └── public/
└── README.md
```

## Быстрый запуск

1. **Клонируйте репозиторий:**
   ```bash
   git clone <repository-url>
   cd chat-js
   ```

2. **Установите зависимости:**
   - Backend: `cd backend && npm install`
   - Frontend: `cd frontend && npm install`

3. **Запустите приложение:**
   - Backend: `cd backend && node server.js` (порт 3001)
   - Frontend: `cd frontend && npm start` (порт 3000)

4. **Откройте браузер:**
   - Перейдите на http://localhost:3000
   - Введите nickname (например, User1)
   - Присоединитесь к каналу General

## Тестирование функций

- Откройте несколько вкладок для тестирования чата
- Создавайте новые каналы через UI
- Используйте `/w nickname сообщение` для приватных сообщений
- Тестируйте мобильную версию

## Переменные окружения

Создайте `.env` файл в директории `backend/` с необходимыми переменными:

```
NODE_ENV=development
PORT=3001
MONGODB_URI=mongodb://localhost:27017/chat_js
JWT_SECRET=your_super_secure_jwt_secret_key_here_replace_in_production
BCRYPT_ROUNDS=12
FRONTEND_URL=http://localhost:3000
```

**Важно:** Никогда не коммитите `.env` файл с реальными секретами в git!

## Голосовые каналы

UI для голосовых каналов реализована, но требует WebRTC интеграции:

- ✅ Создание голосовых каналов
- ✅ UI для входа/выхода из голосовых каналов
- ✅ Индикаторы речи в списке пользователей
- ❌ WebRTC Peer-to-peer соединения
- ❌ Аудио стрим и микрофон доступ

Для реализации WebRTC потребуется:
1. STUN/TURN серверы
2. WebRTC сигнальный сервер
3. Аудио кодеки и обработка
4. Peer-to-peer connection management

## Дальнейшее развитие

Подробный план развития см. в [TODO.md](TODO.md).
Основные направления:
- WebRTC для голосового общения
- Unit/Integration тесты
- TypeScript миграция
- Redis для масштабирования
- Docker контейнеризация

## Автор

Проект разработан в 2025 году.
