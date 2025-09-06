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
- **Frontend**: React 19 приложение с Material-UI v7 и темной темой Discord-style. Полностью адаптивное, включая мобильную версию с Drawer.
- **Backend**: Express + Socket.IO сервер с персистентностью MongoDB. JWT аутентификация с хешированием паролей.
- **Коммуникация**: WebSocket для реал-тайма, HTTP для каналов и аутентификации.
- **Функции**: Каналы (текст/голос), приватные сообщения, индикаторы речи, история сообщений, мьют.
- **Будущее**: Redis для масштабирования, TURN серверы для продакшена.

### Текущее состояние
- ✅ Полная персистентность данных (MongoDB)
- ✅ Полноценная аутентификация с аккаунтами
- ✅ Реал-тайм чат с Socket.IO
- ✅ Мобильная адаптация
- ✅ Полные голосовые каналы (WebRTC реализован)
- ✅ Security headers (Helmet)
- ✅ API документация (Swagger)
- ✅ Логирование (Winston)
- ❌ Недостаточное покрытие тестами
- ❌ Отсутствует TURN сервер для продакшена

## Стек технологий

### Backend
- **Node.js** + **Express 5.1** - HTTP сервер
- **Socket.IO 4.8** - WebSocket коммуникация
- **JWT** + **bcryptjs** - аутентификация и хеширование
- **Mongoose 8.18** - MongoDB ORM
- **Winston** - логирование
- **Helmet** - security headers
- **express-validator** - валидация данных
- **Swagger** - API документация
- **CORS** - cross-origin requests

### Frontend
- **React 19** + **@mui/material v7** - UI фреймворк
- **Socket.IO Client** - WebSocket клиент
- **Axios** - HTTP запросы
- **useWebRTC hook** - голосовое общение
- **ErrorBoundary** - обработка ошибок
- Адаптивный дизайн (mobile-first)
- Dark Discord-style тема

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

## Запуск в продакшене

Для продакшена потребуется:
- Docker контейнеризация (готов к настройке)
- TURN сервер для WebRTC (Coturn или аналог)
- Rate limiting middleware
- Session storage (Redis)
- Nginx или Apache для проксирования

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

## Безопасность и защита

### Меры безопасности реализованы:
- **JWT аутентификация** с валидацией токенов для каждого сокета
- **Helmet** middleware для обязательных security headers
- **XSS защита** через express-validator и escape функций
- **CORS** ограничение origin источников
- **Password хеширование** с bcrypt (12 раундов)
- **Валидация данных** для всех входных параметров
- **Rate limiting** готов для установки
- **HTTPS** требуется в продакшене
- **API документация** через Swagger (авторизованная)

### Требования для продакшена:
- Установка TURN сервера для WebRTC
- HTTPS сертификаты (Let's Encrypt)
- Rate limiting middleware (express-rate-limit)
- Redis для session storage
- Audit logging для безопасности

## Голосовые каналы (WebRTC)

Голосовые каналы полностью реализованы с WebRTC:

- ✅ Создание голосовых каналов
- ✅ UI для входа/выхода из голосовых каналов
- ✅ Индикаторы речи в списке пользователей
- ✅ WebRTC Peer-to-peer соединения
- ✅ Аудио стрим и микрофон доступ
- ✅ Мьют/анмьют во время разговора
- ✅ Echo cancellation и noise suppression

Текущая реализация использует Google STUN серверы, но для продакшена рекомендуется:
1. Установка TURN сервера (Coturn)
2. Кастомные STUN серверы для надежности
3. Поддержка multiple codecs
4. Quality of Service управления

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
