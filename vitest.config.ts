import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['packages/**/tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['packages/**/src/**/*.ts'],
            exclude: ['packages/**/src/index.ts'],
            thresholds: {
                statements: 95,
                branches: 90,
                functions: 90,
                lines: 95,
            },
        },
    },
    resolve: {
        alias: {
            '@lania-tools/tools': path.resolve(__dirname, 'packages/tools/src'),
        },
    },
});