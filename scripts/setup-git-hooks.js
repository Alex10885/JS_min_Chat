#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Настройка Git hooks для проекта Chat-JS
 * Автоматически настраивает pre-commit и pre-push hooks с качеством кода и документацией
 */

class GitHooksSetup {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '..');
    }

    // Основная настройка Git hooks
    async setupHooks() {
        console.log('🔧 Настройка Git hooks для Chat-JS...');

        try {
            // Проверка что мы в Git репозитории
            this.checkGitRepository();

            // Настройка Git hook path
            this.setupHooksPath();

            // Копирование hooks в .git/hooks
            this.copyHooks();

            // Валидация конфигураций
            this.validateConfigurations();

            // Создание вспомогательных скриптов
            this.createHelperScripts();

            console.log('✅ Git hooks успешно настроены!');
            console.log('');
            console.log('📋 Что теперь работает:');
            console.log('• pre-commit: Быстрая проверка качества кода');
            console.log('• pre-push: Полная валидация перед push');
            console.log('• Автоматическое обновление документации');
            console.log('• Проверка покрытия и тестов');

        } catch (error) {
            console.error('❌ Ошибка настройки Git hooks:', error.message);
            process.exit(1);
        }
    }

    // Проверка Git репозитория
    checkGitRepository() {
        try {
            execSync('git rev-parse --git-dir', { stdio: 'pipe' });
        } catch (error) {
            throw new Error('Это не Git репозиторий. Инициализируйте Git сначала: git init');
        }

        console.log('✅ Git репозиторий найден');
    }

    // Настройка Git hooks path
    setupHooksPath() {
        try {
            execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
            console.log('✅ Git hooks path настроен на .githooks');
        } catch (error) {
            // Если core.hooksPath не поддерживается, используем копирование
            console.log('⚠️ core.hooksPath не поддерживается, используем копирование');
        }
    }

    // Копирование hooks в .git/hooks (fallback)
    copyHooks() {
        const gitHooksDir = path.join(this.projectRoot, '.git', 'hooks');
        const customHooksDir = path.join(this.projectRoot, '.githooks');
        const hooks = ['pre-commit', 'pre-push'];

        // Создание директории если не существует
        if (!fs.existsSync(gitHooksDir)) {
            fs.mkdirSync(gitHooksDir, { recursive: true });
        }

        hooks.forEach(hook => {
            const sourcePath = path.join(customHooksDir, hook);
            const targetPath = path.join(gitHooksDir, hook);

            if (fs.existsSync(sourcePath)) {
                fs.copyFileSync(sourcePath, targetPath);
                console.log(`✅ Hook ${hook} скопирован в .git/hooks/`);
            } else {
                console.warn(`⚠️ Hook ${hook} не найден в .githooks/`);
            }
        });
    }

    // Валидация конфигураций
    validateConfigurations() {
        console.log('🔍 Валидация конфигураций...');

        const validations = [
            {
                name: 'Node.js version',
                check: () => {
                    const version = parseInt(process.version.split('.')[0].substring(1));
                    return version >= 16;
                },
                message: 'Node.js 16+ required'
            },
            {
                name: 'Scripts executable',
                check: () => {
                    return ['generate-docs.js', 'update-coverage.js'].every(script =>
                        fs.existsSync(path.join(this.projectRoot, 'scripts', script))
                    );
                },
                message: 'Missing documentation scripts'
            },
            {
                name: 'Backend dependencies',
                check: () => {
                    const pkgPath = path.join(this.projectRoot, 'backend', 'package.json');
                    return fs.existsSync(pkgPath);
                },
                message: 'Backend package.json not found'
            },
            {
                name: 'Frontend dependencies',
                check: () => {
                    const pkgPath = path.join(this.projectRoot, 'frontend', 'package.json');
                    return fs.existsSync(pkgPath);
                },
                message: 'Frontend package.json not found'
            }
        ];

        let allValid = true;

        validations.forEach(validation => {
            if (validation.check()) {
                console.log(`✅ ${validation.name}: OK`);
            } else {
                console.log(`❌ ${validation.name}: ${validation.message}`);
                allValid = false;
            }
        });

        if (!allValid) {
            throw new Error('Не все конфигурации валидны');
        }
    }

    // Создание вспомогательных скриптов
    createHelperScripts() {
        const helperScripts = {
            // Скрипт для пропуска hooks
            'no-hooks-commit.bat': `@echo off
echo Committing without hooks...
git commit --no-verify %*`,

            'no-hooks-push.bat': `@echo off
echo Pushing without hooks...
git push --no-verify %*`,

            'bypass-hooks.sh': `#!/bin/bash
echo "Committing without hooks..."
git commit --no-verify "$@"`,

            'bypass-push.sh': `#!/bin/bash
echo "Pushing without hooks..."
git push --no-verify "$@"`
        };

        const scriptsDir = path.join(this.projectRoot, 'scripts');
        if (!fs.existsSync(scriptsDir)) {
            fs.mkdirSync(scriptsDir, { recursive: true });
        }

        Object.entries(helperScripts).forEach(([filename, content]) => {
            const filepath = path.join(scriptsDir, filename);
            fs.writeFileSync(filepath, content, 'utf8');

            // Скрипты для Unix систем
            if (filename.endsWith('.sh')) {
                fs.chmodSync(filepath, '755');
            }
        });

        console.log('✅ Вспомогательные скрипты созданы');
    }

    // Автоматическая установка зависимостей (опционально)
    installDependencies() {
        console.log('📦 Проверка зависимостей...');

        const dirs = ['backend', 'frontend'];

        dirs.forEach(dir => {
            const pkgPath = path.join(this.projectRoot, dir, 'package.json');
            const nodeModules = path.join(this.projectRoot, dir, 'node_modules');

            if (fs.existsSync(pkgPath) && !fs.existsSync(nodeModules)) {
                console.log(`📦 Установка зависимостей в ${dir}...`);
                try {
                    execSync(`cd ${dir} && npm install --silent`, { stdio: 'inherit' });
                    console.log(`✅ ${dir} dependencies installed`);
                } catch (error) {
                    console.warn(`⚠️ Не удалось установить dependencies в ${dir}`);
                }
            }
        });
    }

    // Отображение помощи по использованию
    showHelp() {
        console.log(`
🎯 Git Hooks setup complete!

📋 Available commands:
• npm run hooks:setup       - Setup Git hooks (this command)
• npm run hooks:install     - Install dependencies + setup hooks
• npm run commit:no-hooks   - Commit without hooks validation
• npm run push:no-hooks     - Push without hooks validation

🔧 Manual alternatives:
• ./scripts/bypass-hooks.sh  - Commit bypass script
• ./scripts/bypass-push.sh   - Push bypass script

⚙️ Configuration files:
• .githooks/                - Custom hooks directory
• scripts/                   - Documentation and helper scripts

✅ Quality gates:
• ESLint code quality checks
• Jest unit test execution
• Cypress E2E test validation
• Coverage metrics check
• Documentation auto-update
• Commit message format validation`);
    }
}

// Функция для добавления команд в package.json
function updatePackageJson() {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    let pkg = {};

    if (fs.existsSync(pkgPath)) {
        pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    }

    if (!pkg.scripts) {
        pkg.scripts = {};
    }

    // Добавление hook команд
    pkg.scripts['hooks:setup'] = 'node scripts/setup-git-hooks.js';
    pkg.scripts['hooks:install'] = 'node scripts/setup-git-hooks.js && npm run install:all';
    pkg.scripts['install:all'] = 'cd backend && npm install && cd ../frontend && npm install';
    pkg.scripts['commit:no-hooks'] = 'git commit --no-verify';
    pkg.scripts['push:no-hooks'] = 'git push --no-verify';

    // Документационные команды
    pkg.scripts['docs:generate'] = 'node scripts/generate-docs.js';
    pkg.scripts['docs:coverage'] = 'node scripts/update-coverage.js';
    pkg.scripts['docs:changelog'] = 'node scripts/generate-changelog.js';

    // Полный командный набор
    pkg.scripts['prepare'] = 'npm run hooks:setup';
    pkg.scripts['postinstall'] = 'npm run hooks:setup';

    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2));
    console.log('✅ package.json обновлен с командами hooks');
}

// Запуск настройки если скрипт вызван напрямую
if (require.main === module) {
    const setup = new GitHooksSetup();

    if (process.argv.includes('--help')) {
        setup.showHelp();
        process.exit(0);
    }

    if (process.argv.includes('--install-deps')) {
        setup.installDependencies();
    }

    setup.setupHooks();
    updatePackageJson();
    setup.showHelp();
}

module.exports = GitHooksSetup;