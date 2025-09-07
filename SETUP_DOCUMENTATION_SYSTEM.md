# 🚀 Настройка системы автоматического ведения документации Chat-JS

Этот файл содержит полную инструкцию по настройке и использованию автоматической системы документации для проекта Chat-JS.

## 📋 Что настроено

✅ **Скрипты генерации документации:**
- `scripts/generate-docs.js` - основной генератор документации
- `scripts/update-coverage.js` - сборщик метрик покрытия
- `scripts/generate-changelog.js` - сборщик changelog из Git коммитов
- `scripts/setup-git-hooks.js` - настройка Git hooks

✅ **Git Hooks:**
- `.githooks/pre-commit` - проверка качества перед коммитом
- `.githooks/pre-push` - полная валидация перед push

✅ **CI/CD Pipeline:**
- `.github/workflows/docs.yml` - GitHub Actions для автоматизации

✅ **Документация:**
- `README.md` - обновлен с badges
- `TEST_REPORT.md` - автоматические отчеты покрытия
- `CHANGELOG.md` - автоматическая генерация changelog
- `backend/docs/api.md` - API документация
- `docs/` - папка для дополнительных документов

## 🔧 Быстрая настройка

### 1. Установка системы

```bash
# Из корня проекта выполните:
npm install
npm run setup
```

Это установит все зависимости и настроит Git hooks.

### 2. Первый запуск генерации документации

```bash
# Сгенерировать всю документацию
npm run docs:generate

# Обновить метрики покрытия
npm run docs:coverage

# Сгенерировать changelog
npm run docs:changelog
```

## 📊 Команды системы документации

### Основные команды
```bash
# Полная генерация документации
npm run docs:generate

# Обновление метрик тестирования
npm run docs:coverage

# Генерация changelog
npm run docs:changelog

# Проверка качества кода и coverage gates
npm run quality:check
```

### Команды для разработки
```bash
# Установка системы (hooks + зависимости)
npm run setup

# Полная установка проекта с hooks
npm run install:all

# Байпас hooks при проблемах (только если нужно)
npm run commit:no-hooks
npm run push:no-hooks
```

### Git workflow команды
```bash
# Стандартный workflow
git add .
git commit -m "feat: добавлена новая функция"
# Автоматически: pre-commit проверки
git push
# Автоматически: pre-push валидация + обновление docs
```

## 🏗️ Архитектура системы

### Скрипты генерации

#### `scripts/generate-docs.js`
- 🎯 **Назначение**: Основной генератор документации
- 🔄 **Функции**:
  - Обновление README из исходного кода
  - Генерация API документации из Swagger
  - Сбор метрик coverage из Jest и Cypress
  - Генерация диаграмм архитектуры (Mermaid)
  - Извлечение JSDoc комментариев

#### `scripts/update-coverage.js`
- 🎯 **Назначение**: Специализированный сборщик coverage
- 🔄 **Функции**:
  - Запуск Jest coverage для backend и frontend
  - Запуск Cypress E2E покрытия
  - Агрегация данных из различных форматов
  - Генерация badges для GitHub
  - Проверка quality gates

#### `scripts/generate-changelog.js`
- 🎯 **Назначение**: Автоматическая генерация changelog
- 🔄 **Функции**:
  - Анализ Git коммитов по conventional commits
  - Группировка изменений по типам
  - Создание релизов из тегов
  - Генерация метрик контрибьюторов

#### `scripts/setup-git-hooks.js`
- 🎯 **Назначение**: Настройка Git hooks
- 🔄 **Функции**:
  - Копирование hooks в соответствие
  - Валидация конфигураций
  - Создание вспомогательных скриптов
  - Поддержка fallback режима

### Git Hooks

#### `.githooks/pre-commit`
- 📝 **Запускается**: При каждом коммите
- 🔍 **Проверки**:
  - Синтаксис JavaScript файлов
  - ESLint качество кода
  - Node.js версии
  - Маркеры конфликтов
  - Conventional commits формат
  - Базовая security проверка

#### `.githooks/pre-push`
- 🚀 **Запускается**: При каждом push
- ✅ **Проверки**:
  - Все pre-commit проверки
  - Полное ESLint сканирование
  - Jest unit тесты
  - Cypress E2E тесты (critical)
  - Coverage quality gates
  - Актуализация документации
  - Comment в PR с результатами

## 🎯 GitHub Actions CI/CD

### Workflow `docs.yml`

#### Jobs:

##### `quality-checks`
- 🔍 Быстрая проверка качества
- 🏃 ESLint и syntax validation
- ⏱️ Timeout: 10 минут

##### `test-backend`
- 🧪 Jest тесты backend
- 📊 Codecov интеграция
- 💾 Сохранение coverage отчетов

##### `test-frontend`
- 🎨 Jest тесты frontend
- 📊 Codecov интеграция
- 💾 Сохранение coverage отчетов

##### `e2e-tests`
- 🌐 Cypress E2E тесты
- 📱 Critical сценарии
- 🔧 Continue on error для CI

##### `documentation`
- 📚 Генерация документации
- 📊 Агрегация coverage данных
- 🏷️ Генерация badges
- 💾 Сохранение artics

##### `deploy-docs`
- 🚀 Deploy на GitHub Pages
- 📰 Статический сайт документации
- 📖 Обновление API docs pages

##### `create-pr`
- 🔄 Auto создание PR с обновлениями
- 📝 Списание изменений
- 🏷️ Tagging с labels
- 👥 Назначение автору

##### `update-badges`
- 🏷️ Обновление badges в README
- 📊 Динамическое обновление coverage
- 🎯 Автоматический коммит

##### `comment-pr`
- 💬 Комментарий с результатами CI
- 📋 Статус проверок
- 🔗 Ссылки на отчеты

## 🎨 Кастомизация

### Badges конфигурация

Бейджи автоматически генерируются в `.github/badges/coverage.json`:

```json
{
  "coverage": {
    "backend": 85,
    "frontend": 90,
    "lines": 87,
    "functions": 82
  },
  "tests": {
    "jest": "passing",
    "cypress": "passing"
  },
  "build": "passing"
}
```

### Quality Gates

Настройка порогов в `scripts/update-coverage.js`:

```javascript
const thresholds = {
  lines: 70,
  functions: 70,
  branches: 70,
  statements: 70
};
```

### Git Hooks кастомизация

Измените проверки в `.githooks/pre-commit` и `.githooks/pre-push`.

```bash
# Пример добавления кастомной проверки
if [ -f "custom-check.js" ]; then
    node custom-check.js
    if [ $? -ne 0 ]; then
        echo "Custom check failed"
        exit 1
    fi
fi
```

## 🔄 Ежедневная работа

### Для разработчиков

1. **Пишей код** как обычно
2. **Делай коммиты** с conventional commits
3. **Push ветку** - система автоматически:
   - Запустит все тесты
   - Проверит качество
   - Обновит документацию
   - Сгенерирует badges
   - Соединит coverage

4. **Создай PR** - автоматически:
   - Добавятся проверки CI/CD
   - Обновится документация
   - Добавятся badges

### Для мейнтейнера

```bash
# Еженедельное обновление
npm run docs:coverage
npm run docs:changelog
npm run docs:generate

# Проверка gates
npm run quality:check

# Релиз версия
node scripts/generate-changelog.js --release v1.0.1
```

## 🐛 Troubleshooting

### Проблемы с Git hooks

```bash
# Проверка установки
git config core.hooksPath  # должно быть '.githooks'
ls .git/hooks/pre-commit   # должен существовать

# Принудительная установка
npm run setup
```

### Проблемы с документацией

```bash
# Проверка swagger
curl http://localhost:3001/api-docs

# Ручная генерация
node scripts/generate-docs.js

# Очистка и повторная генерация
rm -rf docs/
node scripts/generate-docs.js
```

### Проблемы с coverage

```bash
# Backend coverage
cd backend && npm run test:coverage

# Frontend coverage
cd frontend && npm run test:coverage

# Cypress coverage
cd frontend && npm run e2e:run
```

### Debug режим

```bash
# Verbose logging для Git hooks
export HOOKS_DEBUG=true
git commit

# Debug генерация docs
node scripts/generate-docs.js --verbose
```

## 📈 Метрики и отчеты

### Автоматические метрики

Система генерирует:

#### `TEST_REPORT.md`
- Backend coverage: lines, functions, branches
- Frontend coverage: lines, functions, branches
- Cypress результаты
- Quality gates статус

#### `CHANGELOG.md`
- Conventional commits разбор
- Новые функции по релизам
- Метрики контрибьюторов
- Breaking changes выделение

#### Coverage badges
- Real-time обновление
- Color-coding по процентам
- Multiple metrics tracking

### Ручные отчеты

```bash
# Детальный coverage отчет
node scripts/update-coverage.js --detailed

# Git статистика
git log --stat --since='1 month ago'

# Coverage тренды
# Look at .github/badges/ directory
```

## 🚀 Расширение системы

### Добавление новых проверок

1. Создайте новый файл: `scripts/custom-check.js`
2. Добавьте в pre-commit hook
3. Обновите documentation

```javascript
#!/usr/bin/env node
// scripts/custom-check.js

const fs = require('fs');

function customCheck() {
    // Custom validation logic
    const files = fs.readdirSync('.');
    const hasRequiredFiles = files.some(file => file.match(/\.required$/));

    if (!hasRequiredFiles) {
        console.error('❌ Missing required files');
        process.exit(1);
    }

    console.log('✅ Custom check passed');
}

if (require.main === module) {
    customCheck();
}
```

### Интеграция с другими инструментами

```yaml
# Add to .github/workflows/docs.yml
- name: Custom tool
  run: |
    npx custom-linter
    node scripts/custom-check.js
```

---

## 📞 Поддержка

Если возникают проблемы:

1. Проверьте логи Git hooks: `.git/hooks/logs/`
2. Запустите debug: `HOOKS_DEBUG=true git commit`
3. Проверьте issues в GitHub
4. Свяжитесь с мейнтейнерами проекта

---

**Система готова! 🎉** Все проверки и генерация документации будут выполняться автоматически.