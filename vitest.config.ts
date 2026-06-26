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
            exclude: [
                'packages/**/src/axios/**',
                'packages/**/src/index.ts',
                'packages/**/src/**/*.worker.ts',
            ],
        },
    },
    resolve: {
        alias: {
            '@lania-tools/tools': path.resolve(__dirname, 'packages/tools/src'),
        },
    },
});