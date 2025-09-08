# Архитектура Redis интеграции для Chat-JS

## Исходная проблема

Текущая система имеет следующие проблемы производительности:
- Все запросы к списку пользователей (`GET /api/users`) идут напрямую в MongoDB
- История сообщений считывается из MongoDB без кеширования
- Списки каналов не кешируются
- Онлайн статусы поддерживаются только в memory SocketService
- Высокая нагрузка на MongoDB при активном использовании
- Нет оптимизации для часто запрашиваемых данных

## Детальная схема Redis хранилища

### 1. Сессии пользователей
**Ключ:** `session:{sid}` (string)
- **TTL:** 24 часа
- **Значение:** JSON объект session (userId, nickname, role, csrfToken, etc.)
- **Переход:** мигрировать из MongoDB через connect-mongo на Redis store

### 2. Кеш списка пользователей
**Ключ:** `cache:users:list` (sorted set)
- **TTL:** 5 минут
- **Структура:** ZSET с оценкой по lastActive timestamp
- **Использование:** для быстрого получения списка всех пользователей с сортировкой
- **Инвалидация:** при изменениях статуса, регистрации новых пользователей

### 3. Кеш онлайн статусов
**Ключ:** `cache:users:online` (set)
- **TTL:** 30 секунд
- **Структура:** SET содержащий userId онлайн пользователей
- **Использование:** для быстрого определения online пользователей
- **Синхронизация:** обновление через SocketService события

### 4. Кеш каналов
**Ключ:** `cache:channels:list` (hash)
- **TTL:** 5 минут
- **Структура:** HSET с channelId как ключом и JSON объекта как значением
- **Использование:** для быстрого получения списка всех каналов без MongoDB запросов

### 5. Кеш пользователей в канале
**Ключ:** `cache:channel:users:{channelId}` (set)
- **TTL:** 2 минуты
- **Структура:** SET содержащий userId пользователей в канале
- **Использование:** для определения списка пользователей в конкретном канале
- **Обновление:** при join/leave событиях через SocketService

### 6. Кеш последних сообщений канала
**Ключ:** `cache:messages:recent:{channelId}` (list)
- **TTL:** 1 минута
- **Структура:** LIST последних 20-50 сообщений (JSON objects)
- **Использование:** для быстрой загрузки недавней истории при входе в канал
- **Добавление:** новые сообщения сдвигают старые за пределы TTL

### 7. Кеш эмодзи и статики
**Ключ:** `cache:emoji:classics` (hash)
- **TTL:** 24 часа
- **Структура:** HSET с частотой использования
- **Использование:** для кеширования часто используемых эмодзи

### 8. Кеш Pub/Sub обновлений
**Каналы:** `updates:channels`, `updates:messages`, `updates:users`
- **Использование:** для мгновенного обновления кешей при изменениях данных

## Стратегии кеширования

### Cache-Aside Pattern (для пользовательских данных)
```
1. Проверка в Redis: cache:users:list
2. Если HIT: вернуть данные
3. Если MISS: запрос из MongoDB + сохранение в Redis
4. Обновление: напрямую в Redis при изменениях
```

### Write-Through Pattern (для обеспечивающих консистентность)
```
1. Запись в MongoDB
2. Синхронная запись в Redis
3. Все чтения из Redis
```

### Cache Invalidation Strategy
```
1. При изменении данных: DELETE cache keys
2. Lazy loading: следующего запроса восстановит кеш
3. Pub/Sub: уведомления о изменениях для меж-модульной синхронизации
```

## Политика TTL

| Тип данных | TTL | Обоснование | Impact |
|------------|-----|-------------|---------|
| Сессии | 24ч | Стандартная сессионная политика | Высокий impact на UX |
| Список пользователей | 5мин | Средняя частота изменений | Баланс производительности |
| Онлайн статусы | 30сек | Высокая частота изменений | Важно для реалтайма |
| Каналы | 5мин | Низкая частота изменений | Оптимизация UI |
| Пользователи в канале | 2мин | Средняя частота изменений | Оптимизация листингов |
| История сообщений | 1мин | Быстрые изменения контента | Быстрый доступ к истории |
| Эмодзи/статика | 24ч | Стабильные данные | Экономия на частых запросах |

## Обработка ошибок

### Graceful Degradation Flow
```
Redis недоступен:
1. Переход на fallback to MongoDB
2. Логирование предупреждения
3. Продолжение работы без кеша
4. Мониторинг health-check Redis
5. Автоматическое восстановление при рестарт Redis
```

### Health Check паттерн
```
1. Периодическая проверка: redis.ping()
2. При обнаружении проблем: переключение на MongoDB
3. Попытки переподключения с exponential backoff
4. Alerts на monitoring system
5. Service status endpoint: /health/redis
```

## Архитектурные решения

### Single Instance vs Cluster
**Рекомендация: Single Instance + Sentinel для Production**

**Преимущества Single Instance:**
- Простота развертывания
- Соответствие текущему использованию (кеш, сессии)
- Ниже overhead по сравнению с кластером

**Sentinel для высокой доступности:**
- Автоматический failover
- Мониторинг master/slave
- Service discovery для приложений

### Scalability Considerations
**Горизонтальное масштабирование:**
- Redis Cluster для больших нагрузок (>10k concurrent)
- Sharding по namespace/channelId
- Connection pooling

**Вертикальное масштабирование:**
- Redis persistence для durability
- Memory monitoring и alerting
- Backup стратегии

## Диаграмма потоков данных

```mermaid
stateDiagram-v2
    [*] --> Client
    Client --> API_Gateway : REST/WS Request

    API_Gateway --> Redis : Check Cache

    state Redis as "Redis Cluster" as Redis

    state Redis_Cache as "Cache Layer"
    note right of Redis_Cache
        cache:users:list,
        cache:messages:recent:*
    end

    state Redis_Persist as "Session Layer"
    note right of Redis_Persist
        session:*,
        cache:channels:list
    end

    Redis --> API_Gateway : Cache Hit
    API_Gateway --> MongoDB : Cache Miss

    MongoDB --> Redis : Write Through
    API_Gateway --> Client : Response
```

## План миграции

### Фаза 1: Подготовка
1. Установка Redis сервер
2. Настройка соединения в application
3. Создание Redis service layer
4. Тестирование Redis connection

### Фаза 2: Сессии (Low Risk)
1. Шаговое переключение: 10% traffic → Redis, 90% → MongoDB
2. Наращивать до 100%
3. Обновление деплой соглашений
4. Мониторинг сессионных проблем

### Фаза 3: API Cache (Medium Risk)
1. Внедрение cache-aside pattern
2. Постепенное включение кешей по endpoint
3. Тестирование invalidation
4. Мониторинг performance

### Фаза 4: Real-time Optimizations
1. Синхронизация in-memory структур с Redis
2. Реализация Pub/Sub для обновлений
3. Тестирование voice channel caching
4. Performance benchmarking

## Риски и стратегии миграции

### Критические риски
1. **Data Loss:** Радяность - Redis данные временные
    * Стратегия: All critical data remains in MongoDB

2. **Performance Degradation:** При недоступности Redis
    * Стратегия: Graceful fallback to MongoDB

3. **Memory Usage:** Неправильные TTL политики
    * Стратегия: Monitoring и gradual adjustment

### Фаза отката
1. Kill-switch: environment variable DISABLE_REDIS=true
2. Все requests → MongoDB
3. Redis используется только для оффлайн работы
4. Monitoring alerts при откате

## Метрики производительности

### Redis Performance Metrics
- Hit Rate: target >80%
- Memory Usage: <70% Redis memory
- Connection Count: <1000 concurrent
- Latency: <5ms для GET, <20ms для SET

### Application Performance
- API Response Time: improvement в 2-5x для cached requests
- MongoDB Load: reduction в 60-80% для read operations
- User Experience: faster channel loading, list updates

### Monitoring Strategy
```
Grafana Dashboard:
- Redis Info: key count, used_memory, connected_clients
- Cache Hit/Stale rates
- API Response times comparison (with/without cache)
- MongoDB query count reduction

Alerts:
- Redis unreachable
- Cache miss rate >30%
- Memory usage >80%
- Connection pool exhausted
```

## Ожидаемые улучшения производительности

### Read Operations
- Список пользователей: 50ms → 5ms (10x speedup)
- История каналов: 200ms → 10ms (20x speedup)
- Онлайн статусы: in-memory speed maintained

### Write Operations
- Минимизация impact с write-through pattern
- Batch updates для статусов

### Scaling Benefits
- MongoDB read load reduction: 70%
- API throughput: 3x improvement
- Better performance under load

## Технические требования реализации

### Dependencies
```
redis@4.x, connect-redis@7.x,
ioredis@5.x для cluster support
```

### Configuration
```
REDIS_URL: redis://cluster-url:6379
REDIS_SENTINEL: master-name, sentinel-hosts...
TTL_SESSIONS: 86400
TTL_USERS: 300
TTL_CHANNELS: 300
```

### Best Practices
- Использовать Redis pipelines для multi-key operations
- Connection pooling для high throughput
- Error boundaries вокруг Redis calls
- Comprehensive error logging

## Заключение

Интеграция Redis предоставляет значительные преимущества производительности при managed рисках. Архитектура поддерживает graceful degradation и высокую availability. Реализация должна быть phased с thorough testing на каждом этапе.