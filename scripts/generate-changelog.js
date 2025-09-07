#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Системная генерация changelog из Git коммитов
 * Автоматически анализирует conventional commits и структурирует релизноты
 */

class ChangelogGenerator {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '..');
    }

    // Основной метод генерации changelog
    async generateChangelog() {
        console.log('📋 Генерируем changelog...');

        try {
            // Получение текущего состояния репозитория
            const latestTag = this.getLatestTag();
            const previousTag = latestTag ? this.getPreviousTag(latestTag) : null;
            const range = previousTag ? `${previousTag}..HEAD` : '';

            // Получение коммитов
            const commits = this.getCommits(range);
            const conventionalCommits = this.parseConventionalCommits(commits);

            // Сортировка и группировка изменений
            const organizedChanges = this.organizeChanges(conventionalCommits);

            // Формирование содержимого changelog
            const changelogContent = this.formatChangelog(organizedChanges, latestTag);

            // Обновление файла changelog
            this.updateChangelogFile(changelogContent);

            // Обновление секции Unreleased
            this.updateUnreleasedSection();

            console.log('✅ Changelog сгенерирован успешно');
        } catch (error) {
            console.error('❌ Ошибка генерации changelog:', error);
            process.exit(1);
        }
    }

    // Получение последнего тега
    getLatestTag() {
        try {
            return execSync('git describe --tags --abbrev=0 2>/dev/null', {
                encoding: 'utf8'
            }).trim();
        } catch (error) {
            console.log('ℹ️ Нет существующих тегов');
            return null;
        }
    }

    // Получение предыдущего тега
    getPreviousTag(latestTag) {
        try {
            const tags = execSync('git tag --sort=-version:refname', {
                encoding: 'utf8'
            }).trim().split('\n');

            const currentIndex = tags.indexOf(latestTag);
            return currentIndex > 0 ? tags[currentIndex - 1] : null;
        } catch (error) {
            return null;
        }
    }

    // Получение коммитов из указанного диапазона
    getCommits(range) {
        try {
            const rangeArg = range ? range : '--all';
            const command = `git log ${rangeArg} --pretty=format:'%H|%s|%an|%ad|%D' --date=format:'%Y-%m-%d %H:%M:%S'`;
            const output = execSync(command, { encoding: 'utf8' });

            return output.split('\n')
                .filter(line => line.trim())
                .map(line => {
                    const [hash, subject, author, date, refs] = line.split('|');

                    return {
                        hash,
                        subject,
                        author,
                        date,
                        refs: refs || '',
                        isMerge: subject.startsWith('Merge'),
                        isBreaking: subject.includes('BREAKING CHANGE')
                    };
                });
        } catch (error) {
            console.error('❌ Ошибка получения коммитов:', error);
            return [];
        }
    }

    // Парсинг conventional commits
    parseConventionalCommits(commits) {
        const conventionalPattern = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;

        return commits.map(commit => {
            const match = commit.subject.match(conventionalPattern);

            if (match) {
                const [, type, scope, description] = match;

                return {
                    ...commit,
                    type,
                    scope: scope || null,
                    description,
                    conventional: true
                };
            }

            return {
                ...commit,
                conventional: false,
                description: commit.subject
            };
        });
    }

    // Организация изменений по типам
    organizeChanges(commits) {
        const breakingChanges = [];
        const typeGroups = {
            'feat': { title: '✨ Новые возможности', items: [] },
            'fix': { title: '🐛 Исправления', items: [] },
            'docs': { title: '📚 Документация', items: [] },
            'style': { title: '💎 Стиль кода', items: [] },
            'refactor': { title: '♻️  Рефакторинг', items: [] },
            'perf': { title: '⚡ Производительность', items: [] },
            'test': { title: '🧪 Тесты', items: [] },
            'chore': { title: '🔧 Сопровождение', items: [] },
            'ci': { title: '🤖 CI/CD', items: [] },
            'build': { title: '📦 Сборка', items: [] }
        };

        const otherChanges = [];

        commits
            .filter(commit => !commit.isMerge)
            .forEach(commit => {
                if (commit.isBreaking) {
                    breakingChanges.push(commit);
                }

                if (commit.conventional && typeGroups[commit.type]) {
                    typeGroups[commit.type].items.push(commit);
                } else {
                    otherChanges.push(commit);
                }
            });

        return { breakingChanges, typeGroups, otherChanges };
    }

    // Форматирование changelog
    formatChangelog(organizedChanges, latestTag) {
        const { breakingChanges, typeGroups, otherChanges } = organizedChanges;

        let content = `# Изменения\n\n`;

        if (latestTag) {
            content += `## [${latestTag}] - ${new Date().toISOString().split('T')[0]}\n\n`;
        } else {
            content += `## [Unreleased]\n\n`;
        }

        // Breaking Changes
        if (breakingChanges.length > 0) {
            content += `### 🚨 Критические изменения\n\n`;
            breakingChanges.forEach(commit => {
                content += `- **BREAKING:** ${commit.description} (${commit.hash.substring(0, 7)})\n`;
            });
            content += '\n';
        }

        // Группированные изменения
        Object.entries(typeGroups).forEach(([type, group]) => {
            if (group.items.length > 0) {
                content += `### ${group.title}\n\n`;
                group.items.forEach(commit => {
                    const scopeInfo = commit.scope ? `**${commit.scope}:** ` : '';
                    content += `- ${scopeInfo}${commit.description} (${commit.hash.substring(0, 7)})\n`;
                });
                content += '\n';
            }
        });

        // Другие изменения
        if (otherChanges.length > 0) {
            content += `### 🔄 Прочие изменения\n\n`;
            otherChanges.forEach(commit => {
                content += `- ${commit.description} (${commit.hash.substring(0, 7)})\n`;
            });
            content += '\n';
        }

        // Контрибьюторы
        const contributors = this.getContributors();
        if (contributors.length > 0) {
            content += `### 👥 Контрибьюторы\n\n`;
            contributors.forEach(contributor => {
                content += `- ${contributor}\n`;
            });
            content += '\n';
        }

        // Метрики изменений
        const metrics = this.generateChangeMetrics(typeGroups, breakingChanges);
        content += this.formatMetrics(metrics);

        return content;
    }

    // Получение списка контрибьюторов
    getContributors() {
        try {
            const output = execSync('git log --format="%an" | sort | uniq', {
                encoding: 'utf8'
            });
            return output.trim().split('\n');
        } catch (error) {
            return [];
        }
    }

    // Генерация метрик изменений
    generateChangeMetrics(typeGroups, breakingChanges) {
        const totalCommits = Object.values(typeGroups).reduce((sum, group) =>
            sum + group.items.length, 0);

        return {
            totalCommits,
            breakingChanges: breakingChanges.length,
            featureCount: typeGroups.feat.items.length,
            bugFixCount: typeGroups.fix.items.length,
            refactorCount: typeGroups.refactor.items.length,
            testCount: typeGroups.test.items.length,
            docsCount: typeGroups.docs.items.length
        };
    }

    // Форматирование метрик в Markdown
    formatMetrics(metrics) {
        let metricsSection = `### 📊 Метрики релиза\n\n`;
        metricsSection += `| Метрика | Значение |\n`;
        metricsSection += `|---------|---------|\n`;
        metricsSection += `| Всего коммитов | ${metrics.totalCommits} |\n`;
        metricsSection += `| Критические изменения | ${metrics.breakingChanges} |\n`;
        metricsSection += `| Новые возможности | ${metrics.featureCount} |\n`;
        metricsSection += `| Исправления | ${metrics.bugFixCount} |\n`;
        metricsSection += `| Рефакторинг | ${metrics.refactorCount} |\n`;
        metricsSection += `| Тесты | ${metrics.testCount} |\n`;
        metricsSection += `| Документация | ${metrics.docsCount} |\n`;
        metricsSection += '\n';

        return metricsSection;
    }

    // Обновление файла CHANGELOG.md
    updateChangelogFile(newContent) {
        const changelogPath = path.join(this.projectRoot, 'CHANGELOG.md');

        // Считывание существующего содержимого
        let existingContent = '';
        if (fs.existsSync(changelogPath)) {
            existingContent = fs.readFileSync(changelogPath, 'utf8');

            // Удаление старой секции Unreleased если она существует
            const unreleasedPattern = /(## \[Unreleased\][^#]*)(## \[[^\]]+\])/s;
            if (unreleasedPattern.test(existingContent)) {
                existingContent = existingContent.replace(unreleasedPattern, '$2');
            }
        }

        // Префикс "Избранного"
        const header = `# Изменения\n\nВсе существенные изменения в проекте Chat-JS.\n\n`;

        // Комбинирование содержимого
        const fullContent = header + newContent + (existingContent ? existingContent : '');

        fs.writeFileSync(changelogPath, fullContent, 'utf8');
    }

    // Обновление секции Unreleased (для регулярных обновлений)
    async updateUnreleasedSection() {
        const changelogPath = path.join(this.projectRoot, 'CHANGELOG.md');

        if (!fs.existsSync(changelogPath)) {
            return;
        }

        const content = fs.readFileSync(changelogPath, 'utf8');

        // Проверка если Unreleased уже есть
        if (content.includes('## [Unreleased]')) {
            return;
        }

        // Добавление секции Unreleased в начало
        const unreleasedSection = `## [Unreleased]\n\n### 🚧 Работа в процессе\n\n- Без новых изменений\n\n`;
        const updatedContent = content.replace('# Изменения\n\n', `# Изменения\n\n${unreleasedSection}`);

        fs.writeFileSync(changelogPath, updatedContent, 'utf8');
    }

    // Утилита для создания нового релиза
    createNewRelease(version) {
        try {
            // Создание Git тега
            execSync(`git tag -a ${version} -m "Release ${version}"`, { stdio: 'inherit' });

            // Генерация changelog для нового релиза
            this.generateChangelog();

            console.log(`🎉 Релиз ${version} создан успешно!`);
        } catch (error) {
            console.error('❌ Ошибка создания релиза:', error);
        }
    }

    // Проверка формата коммитов
    checkCommitConvention(commitMessage) {
        const conventionalPattern = /^(\w+)(?:\(([^)]+)\))?!?:\s*(.+)$/;
        return conventionalPattern.test(commitMessage.trim());
    }
}

// Запуск генерации changelog если скрипт вызван напрямую
if (require.main === module) {
    const generator = new ChangelogGenerator();

    // Проверка аргументов командной строки
    const args = process.argv.slice(2);

    if (args.includes('--release') && args.length > 1) {
        const versionIndex = args.indexOf('--release') + 1;
        if (args[versionIndex]) {
            generator.createNewRelease(args[versionIndex]);
            return;
        }
    }

    generator.generateChangelog();
}

module.exports = ChangelogGenerator;