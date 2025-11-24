import { getFiles, resolveSubPath, createCommonInjectVars } from './utils.js';
import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import { terser } from 'rollup-plugin-terser';
import dts from 'rollup-plugin-dts';
import url from '@rollup/plugin-url';
import { globalReplacePlugin } from './inject-vars-plugin.js';
const inputFiles = getFiles(resolveSubPath('packages', 'tools', 'dist'), {
    maxDepth: 0,
    ext: '.js',
});
const axiosInputFiles = getFiles(resolveSubPath('packages', 'tools', 'dist'), {
    maxDepth: 2,
    filterDir: (dir) => dir.includes('axios'),
});
export default [
    {
        input: inputFiles,
        output: [
            {
                dir: resolveSubPath('packages', 'tools', 'dist', 'cjs'),
                format: 'cjs',
                entryFileNames: '[name].cjs.cjs',
                exports: 'named', // 添加这一行
            },
            {
                dir: resolveSubPath('packages', 'tools', 'dist', 'esm'),
                format: 'esm',
                entryFileNames: '[name].esm.js',
                exports: 'named', // 添加这一行
            },
        ],
        plugins: [
            url({
                // 确保匹配你的 Worker 文件。通常 Worker 文件以 .js 或 .ts 结尾
                include: ['**/*.worker.ts', '**/*.worker.js'],
                // 设置 limit 为 0，强制将 Worker 文件作为独立文件输出，而不是 Data URI
                limit: 0,
                // 设置输出文件名格式 (可选，通常用于缓存 busting)
                fileName: '[name].[hash][extname]',
            }),
            resolve(),
            commonjs(),
            terser(),
            globalReplacePlugin(createCommonInjectVars()),
        ],
        context: 'this',
        external: ['axios', 'spark-md5'],
    },
    {
        input: resolveSubPath('packages', 'tools', 'dist/types/index.d.ts'),
        output: {
            file: 'dist/index.d.ts',
            format: 'esm',
        },
        plugins: [dts()],
    },
    {
        input: axiosInputFiles,
        output: [
            {
                dir: resolveSubPath('packages', 'tools', 'dist', 'cjs', 'axios'),
                format: 'cjs',
                entryFileNames: '[name].cjs.cjs',
                exports: 'named', // 添加这一行
            },
            {
                dir: resolveSubPath('packages', 'tools', 'dist', 'esm', 'axios'),
                format: 'esm',
                entryFileNames: '[name].esm.js',
                exports: 'named', // 添加这一行
            },
        ],
        plugins: [
            url({
                // 确保匹配你的 Worker 文件。通常 Worker 文件以 .js 或 .ts 结尾
                include: ['**/*.worker.ts', '**/*.worker.js'],
                // 设置 limit 为 0，强制将 Worker 文件作为独立文件输出，而不是 Data URI
                limit: 0,
                // 设置输出文件名格式 (可选，通常用于缓存 busting)
                fileName: '[name].[hash][extname]',
            }),
            resolve(),
            commonjs(),
            terser(),
            globalReplacePlugin(createCommonInjectVars()),
        ],
        context: 'this',
        external: ['axios', 'spark-md5'],
    },
];
