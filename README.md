# Chat-JS

Реал-тайм чат приложение в стиле Discord, разработанное на React (frontend) и Node.js с Socket.IO (backend).

## Архитектура

Текущая архитектура приложения (актуальная на 2025 год):

```mermaid
graph TD
    A[React 19 Frontend - Material-UI v7] --> B[Socket.IO Client]
    B --> C[Express Server + Socket.IO]
    C --> D[JWT Authentication]
    C --> E[Room/Channel Management]
    C --> F[MongoDB + Mongoose]
    C -.-> G[WebRTC Voice]
    
        subgraph Voice Channels
            G --> H[JOIN/LEAVE Voice Channels]
            H --> I[Peer-to-Peer WebRTC]
            I --> J[ICE Candidates Exchange]
            J --> K[Audio Stream Management]
            K --> L[Mic Mute/Unmute]
            L --> M[Echo Cancellation]
            M --> N[Noise Suppression]
        end

    subgraph Frontend
        A --> H[Channel Sidebar with Accordion]
        A --> I[Chat Area with Message History]
        A --> J[User List + Private DMs]
        A --> K[Voice Channel UI (WebRTC implemented)]
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

### Текущее состояние (актуализировано после анализа)
- ✅ Полная персистентность данных (MongoDB)
- ✅ Полноценная аутентификация с аккаунтами JWT + Bcrypt
- ✅ Реал-тайм чат с Socket.IO
- ✅ Мобильная адаптация с Material-UI Drawer
- ✅ Полные голосовые каналы с WebRTC (peer-to-peer с echo cancellation)
- ✅ Security headers (Helmet) и rate limiting
- ✅ API документация (Swagger/OpenAPI)
- ✅ Логирование (Winston) с error handling
- ❌ Тестирование: ~63% пройденных интеграционных тестов (требуется исправление 36 падающих тестов)
- ✅ Unit тесты для моделей данных
- ❌ TURN сервер: Конфигурация готова, но развертывание критично для продакшена
- ⚠️ Тестовое покрытие: ~26% lines вместо заявленных 80-90%

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
- **useSocket hook** - управление Socket.IO соединением
- **useWebRTC hook** - peer-to-peer голосовое общение
- **ErrorBoundary** - отлов ошибок React
- **ErrorBoundary** - обработка ошибок
- Адаптивный дизайн (mobile-first)
- Dark Discord-style тема

## Структура проекта

```
chat-js/
├── backend/
│   ├── package.json
│   ├── server.js          # Основной сервер Express + Socket.IO
│   ├── db/connection.js   # Подключение к MongoDB
│   ├── models/            # Mongoose модели (User, Message, Channel)
│   ├── services/          # Службы (emailService)
│   ├── tests/             # Suite тестирования (Jest + Supertest)
│   └── package-lock.json
├── frontend/
│   ├── package.json
│   ├── src/
│   │   ├── App.js        # Главный компонент (Material-UI)
│   │   ├── useSocket.js  # Hook для Socket.IO соединения
│   │   ├── useWebRTC.js  # Hook для голосового общения
│   │   ├── ErrorBoundary.js # Обработка ошибок
│   │   └── App.css
│   └── public/
├── README.md
├── TODO.md
├── docker-compose.yml     # Конфигурация TURN сервера
└── .gitignore
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

## Тестирование

### Ручное тестирование
- Откройте несколько вкладок для тестирования чата
- Создавайте новые каналы через UI
- Используйте `/w nickname сообщение` для приватных сообщений
- Тестируйте мобильную версию с drawer меню
- Проверяйте голосовые каналы (WebRTC peer-to-peer)

### Автоматизированное тестирование
- Backend тесты: `cd backend && npm test && npm run test:coverage`
- Модели: ✅ Unit тесты для User, Message, Channel (работоспособны)
- Роуты: ✅ API тесты для регистрации, логина, каналов (работоспособны)
- Socket.IO: ❌ Интеграционные тесты имеют проблемы (36 из 61 тестов падают)
- WebRTC: ❌ Недостаточное покрытие функциональных тестов реальных соединений
- Frontend: ⚠️ Базовые компонентные тесты (нуждаются в расширении)
- Coverage: ⚠️ Текущий ~26% lines вместо заявленных 80-90%

#### Исправление ситуаций тестирования:
1. **Приоритет 1:** Исправить Socket.IO интеграционные тесты с таймаутами
2. **Приоритет 2:** Расширить реальное покрытие до 80%+
3. **Приоритет 3:** Создать e2e тесты с Cypress для пользовательских сценариев

## Запуск в продакшене

### ⚠️ Важные замечания:
**Перед развертыванием в продакшен обязательно исправьте критические проблемы:**
1. Разверните TURN сервер (конфигурация готова в docker-compose.yml)
2. Исправьте Socket.IO интеграционные тесты
3. Повысьте тестовое покрытие до 80%+

### Продакшен требования:
- ✅ Docker контейнеризация (готово - настроено в docker-compose.yml)
- ✅ TURN сервер для WebRTC (Coturn configuration completed - требуется deploy)
- ✅ Rate limiting middleware (implemented)
- ✅ Session storage (Redis не реализован для 1000+ пользователей)
- ✅ Nginx proxy (не настроен, требуется для продакшена)
- ✅ HTTPS сертификаты (требуется для WebRTC)
- ✅ Mongoose indexes optimized для production

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
- **Rate limiting** полностью настроен
- **HTTPS** требуется в продакшене
- **API документация** через Swagger (авторизованная)

### Требования для продакшена:
- Установка TURN сервера для WebRTC
- HTTPS сертификаты (Let's Encrypt)
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
### Настройка TURN сервера для продакшена

1. **Создайте `.env` файл в `backend/`:**
   ```
   TURN_SECRET=ваш_секретный_ключ_для_turn_сервера
   TURN_EXTERNAL_IP=ваш_публичный_ip_или_домен
   ```

2. **Настройка Docker Compose:**
   - Переменные уже настроены в `docker-compose.yml`
   - Запустите `docker-compose up -d` для запуска Coturn

3. **Frontend переменные:**
   Создайте `.env` файл в `frontend/`:
   ```
   REACT_APP_TURN_HOST=ваш-публичный-ip:3478
   REACT_APP_TURN_USERNAME=ваш-turn-username
   REACT_APP_TURN_CREDENTIAL=ваш-turn-credential
   ```

4. **Дополнительные настройки для продакшена:**
   - Настройте TLS для TURN (порт 5349)
   - Добавьте множественные TURN серверы для failover
   - Используйте strong секреты и регулярное обновление credentials
   - Мониторьте использование и нагрузку сервера

## Дальнейшее развитие

Голосовые каналы WebRTC полностью реализованы. Подробный план развития см. в [TODO.md](TODO.md).
Основные направления:
- Увеличение код покрытия тестами (e2e, WebRTC интеграция)
- TypeScript миграция для типобезопасности
- Redis для кэширования и session management
- Docker контейнеризация и CI/CD pipeline
- Мониторинг производительности и APM

## Автор

Проект разработан в 2025 году.
