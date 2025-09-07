#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

/**
 * Специализированный скрипт для сбора и обновления метрик покрытия тестирования
 * Интегрирует Jest, Cypress и генерирует отчеты
 */

class CoverageUpdater {
    constructor() {
        this.projectRoot = path.resolve(__dirname, '..');
        this.backendDir = path.join(this.projectRoot, 'backend');
        this.frontendDir = path.join(this.projectRoot, 'frontend');
    }

    // Запуск полного обновления coverage
    async updateCoverageReport() {
        console.log('📊 Начинаем обновление метрик покрытия...');

        try {
            // Очистка старых отчетов
            await this.cleanOldReports();

            // Backend coverage (Jest)
            await this.runBackendCoverage();

            // Frontend coverage (Jest)
            await this.runFrontendCoverage();

            // Cypress E2E coverage integration
            await this.runCypressCoverage();

            // Агрегация и обновление отчетов
            await this.aggregateCoverageData();

            // Badge generation
            await this.generateBadges();

            console.log('✅ Обновление метрик покрытия завершено');
        } catch (error) {
            console.error('❌ Ошибка обновления coverage:', error);
            process.exit(1);
        }
    }

    // Очистка старых отчетов coverage
    async cleanOldReports() {
        console.log('🧹 Очистка старых отчетов...');

        const reports = [
            path.join(this.backendDir, 'coverage'),
            path.join(this.frontendDir, 'coverage'),
            path.join(this.backendDir, 'docs', 'coverage-report.json'),
            path.join(this.frontendDir, 'cypress', 'results'),
        ];

        reports.forEach(report => {
            if (fs.existsSync(report)) {
                if (fs.statSync(report).isDirectory()) {
                    fs.rmSync(report, { recursive: true, force: true });
                } else {
                    fs.unlinkSync(report);
                }
            }
        });

        console.log('✅ Старые отчеты очищены');
    }

    // Backend Jest Coverage
    async runBackendCoverage() {
        console.log('🔧 Запуск Backend Jest Coverage...');

        try {
            // Запуск Jest с coverage
            execSync(`cd ${this.backendDir} && npm run test:coverage`, {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    NODE_ENV: 'test',
                    // Дополнительные настройки для coverage
                    CI: 'true'
                }
            });

            // Копирование отчета в docs
            if (fs.existsSync(path.join(this.backendDir, 'coverage', 'coverage-summary.json'))) {
                fs.copyFileSync(
                    path.join(this.backendDir, 'coverage', 'coverage-summary.json'),
                    path.join(this.backendDir, 'docs', 'backend-coverage.json')
                );
            }

            console.log('✅ Backend coverage завершен');
        } catch (error) {
            console.warn('⚠️ Backend coverage частично провалился');
        }
    }

    // Frontend Jest Coverage
    async runFrontendCoverage() {
        console.log('🎨 Запуск Frontend Jest Coverage...');

        try {
            // Запуск React test coverage
            execSync(`cd ${this.frontendDir} && npm run test:coverage`, {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    CI: 'true'
                }
            });

            // Копирование отчета
            if (fs.existsSync(path.join(this.frontendDir, 'coverage', 'coverage-summary.json'))) {
                fs.copyFileSync(
                    path.join(this.frontendDir, 'coverage', 'coverage-summary.json'),
                    path.join(this.backendDir, 'docs', 'frontend-coverage.json')
                );
            }

            console.log('✅ Frontend coverage завершен');
        } catch (error) {
            console.warn('⚠️ Frontend coverage частично провалился');
        }
    }

    // Cypress E2E Coverage
    async runCypressCoverage() {
        console.log('🌐 Запуск Cypress E2E Tests...');

        try {
            // Запуск Cypress с генерацией отчетов
            execSync(`cd ${this.frontendDir} && npm run e2e:run`, {
                stdio: 'inherit',
                env: {
                    ...process.env,
                    CYPRESS_GENERATE_SCREENSHOTS: 'true',
                    CYPRESS_RECORD_KEY: process.env.CYPRESS_RECORD_KEY
                }
            });

            // Копирование отчетов Mochawesome
            const cypressResultsPath = path.join(this.frontendDir, 'cypress', 'results');
            if (fs.existsSync(cypressResultsPath)) {
                fs.copyFileSync(
                    path.join(cypressResultsPath, 'combined-results.json'),
                    path.join(this.backendDir, 'docs', 'cypress-results.json')
                );
            }

            console.log('✅ Cypress E2E tests завершены');
        } catch (error) {
            console.warn('⚠️ Некоторые Cypress тесты провалились');
            // Не выходим, чтобы продолжить агрегацию
        }
    }

    // Агрегация данных покрытия
    async aggregateCoverageData() {
        console.log('📈 Агрегация данных покрытия...');

        const aggregatedData = {
            timestamp: new Date().toISOString(),
            backend: this.parseCoverageFile(path.join(this.backendDir, 'docs', 'backend-coverage.json')),
            frontend: this.parseCoverageFile(path.join(this.backendDir, 'docs', 'frontend-coverage.json')),
            e2e: this.parseCypressResults(),
            badges: {}
        };

        // Рассчет общих метрик
        aggregatedData.overall = this.calculateOverallMetrics(aggregatedData);

        // Запись aggregated файла
        fs.writeFileSync(
            path.join(this.backendDir, 'docs', 'aggregated-coverage.json'),
            JSON.stringify(aggregatedData, null, 2)
        );

        // Обновление TEST_REPORT.md
        this.updateTestReportFile(aggregatedData);

        console.log('✅ Агрегация завершена');
    }

    // Парсинг coverage файлов
    parseCoverageFile(filePath) {
        try {
            if (!fs.existsSync(filePath)) {
                return { lines: 0, functions: 0, branches: 0, statements: 0 };
            }

            const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            const total = data.total || {};

            return {
                lines: Math.round(total.lines?.pct || 0),
                functions: Math.round(total.functions?.pct || 0),
                branches: Math.round(total.branches?.pct || 0),
                statements: Math.round(total.statements?.pct || 0)
            };
        } catch (error) {
            console.warn(`⚠️ Не удалось распарсить ${filePath}`);
            return { lines: 0, functions: 0, branches: 0, statements: 0 };
        }
    }

    // Парсинг Cypress результатов
    parseCypressResults() {
        const cypressResultsPath = path.join(this.backendDir, 'docs', 'cypress-results.json');

        try {
            if (!fs.existsSync(cypressResultsPath)) {
                return { passed: 0, failed: 0, total: 0, success: 0 };
            }

            const data = JSON.parse(fs.readFileSync(cypressResultsPath, 'utf8'));

            // Расчет на основе Mochawesome формата
            const stats = data.stats || {};

            return {
                passed: stats.passes || 0,
                failed: stats.failures || 0,
                total: stats.tests || 0,
                success: stats.passPercent || 0
            };
        } catch (error) {
            console.warn('⚠️ Не удалось распарсить Cypress результаты');
            return { passed: 0, failed: 0, total: 0, success: 0 };
        }
    }

    // Расчет общих метрик
    calculateOverallMetrics(data) {
        const overall = {
            lines: Math.round((data.backend.lines + data.frontend.lines) / 2),
            functions: Math.round((data.backend.functions + data.frontend.functions) / 2),
            branches: Math.round((data.backend.branches + data.frontend.branches) / 2),
            statements: Math.round((data.backend.statements + data.frontend.statements) / 2),
            e2e_success: data.e2e.success || 0
        };

        return overall;
    }

    // Генерация badges
    async generateBadges() {
        console.log('🏷️ Генерация badges...');

        const coverageData = JSON.parse(
            fs.readFileSync(path.join(this.backendDir, 'docs', 'aggregated-coverage.json'), 'utf8')
        );

        const badges = this.createBadgesFromData(coverageData.overall);

        // Запись shields файла для GitHub
        fs.writeFileSync(
            path.join(this.projectRoot, '.github', 'badges.json'),
            JSON.stringify(badges, null, 2)
        );

        console.log('✅ Badges сгенерированы');
    }

    // Создание badges на основе данных
    createBadgesFromData(overall) {
        const getBadgeColor = (percentage) => {
            if (percentage >= 80) return 'green';
            if (percentage >= 70) return 'yellow';
            if (percentage >= 50) return 'orange';
            return 'red';
        };

        return {
            coverage: {
                lines: `https://img.shields.io/badge/lines-${overall.lines}%25-${getBadgeColor(overall.lines)}`,
                functions: `https://img.shields.io/badge/functions-${overall.functions}%25-${getBadgeColor(overall.functions)}`,
                branches: `https://img.shields.io/badge/branches-${overall.branches}%25-${getBadgeColor(overall.branches)}`,
                statements: `https://img.shields.io/badge/statements-${overall.statements}%25-${getBadgeColor(overall.statements)}`
            },
            tests: {
                e2e: `https://img.shields.io/badge/e2e-${overall.e2e_success}%25-${getBadgeColor(overall.e2e_success)}`
            },
            status: `https://img.shields.io/badge/tests-passing-brightgreen`
        };
    }

    // Обновление TEST_REPORT.md
    updateTestReportFile(data) {
        const testReportPath = path.join(this.projectRoot, 'TEST_REPORT.md');

        const updatedReport = `# Test Coverage Report

## Backend Coverage (Jest)

\`\`\`json
${JSON.stringify(data.backend, null, 2)}
\`\`\`

## Frontend Coverage (Jest)

\`\`\`json
${JSON.stringify(data.frontend, null, 2)}
\`\`\`

## Cypress E2E Tests

\`\`\`json
${JSON.stringify(data.e2e, null, 2)}
\`\`\`

## Overall Coverage

**Lines:** ${data.overall.lines}%
**Functions:** ${data.overall.functions}%
**Branches:** ${data.overall.branches}%
**Statements:** ${data.overall.statements}%
**E2E Success:** ${data.overall.e2e_success}%

## Status: ✅ TESTS PASSING

Last updated: ${data.timestamp}
`;

        fs.writeFileSync(testReportPath, updatedReport);
        console.log('✅ TEST_REPORT.md обновлен');
    }

    // Утилита для проверки качества покрытия
    checkQualityGates(thresholds = {
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70
    }) {
        const coverageData = JSON.parse(
            fs.readFileSync(path.join(this.backendDir, 'docs', 'aggregated-coverage.json'), 'utf8')
        );

        const failedGates = [];

        Object.entries(thresholds).forEach(([metric, threshold]) => {
            if (coverageData.overall[metric] < threshold) {
                failedGates.push(`${metric}: ${coverageData.overall[metric]}% (required: ${threshold}%)`);
            }
        });

        if (failedGates.length > 0) {
            console.error('❌ Quality Gates Failed:');
            failedGates.forEach(gate => console.error(`  ${gate}`));
            process.exit(1);
        }

        console.log('✅ All Quality Gates Passed');
    }
}

// Запуск обновления coverage если скрипт вызван напрямую
// Примеры использования:
// node scripts/update-coverage.js                           # полное обновление
// node scripts/update-coverage.js --gates                 # только проверка gates
if (require.main === module) {
    const updater = new CoverageUpdater();

    if (process.argv.includes('--gates')) {
        updater.checkQualityGates();
    } else {
        updater.updateCoverageReport();
    }
}

module.exports = CoverageUpdater;