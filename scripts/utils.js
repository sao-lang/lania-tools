import { fileURLToPath } from 'url';
import path, { dirname, resolve } from 'path';
import { readFileSync } from 'fs';
import fs from 'fs';
// 获取当前模块的文件路径
export const __filename = fileURLToPath(import.meta.url);

// 获取当前模块的目录路径
export const __dirname = dirname(__filename);

export const BUILD_CONFIG_MAP = {
    tools: {
        label: '工具库',
        value: 'tools',
    },
    json: {
        label: 'json',
        value: 'json',
    },
};

export function getFiles(dirPath, options = {}) {
    const { ext, maxDepth = Infinity, targetLevel, filterDir } = options;
    const results = [];
    const extArr = ext ? (Array.isArray(ext) ? ext : [ext]) : null;

    function walk(currentPath, depth, insideFilteredDir) {
        const list = fs.readdirSync(currentPath, { withFileTypes: true });

        for (const item of list) {
            const fullPath = path.join(currentPath, item.name);

            if (item.isDirectory()) {
                let enterDir = false;

                if (!filterDir) {
                    // 未设置 filterDir → 遍历所有目录
                    enterDir = true;
                } else if (typeof filterDir === 'string') {
                    enterDir = item.name === filterDir;
                } else if (typeof filterDir === 'function') {
                    enterDir = filterDir(fullPath);
                }

                // 如果目录满足条件且未超过 maxDepth，则递归
                if (enterDir && depth < maxDepth) {
                    // 如果设置了 filterDir 且当前目录匹配，则 insideFilteredDir 设置为 true
                    const newInsideFilteredDir = filterDir ? true : insideFilteredDir;
                    walk(fullPath, depth + 1, newInsideFilteredDir);
                }
            } else if (item.isFile()) {
                const matchExt = !extArr || extArr.some((suffix) => item.name.endsWith(suffix));
                const matchLevel = targetLevel === undefined || targetLevel === depth;

                // 文件是否收集：
                // 1. 未设置 filterDir → 收集所有匹配文件
                // 2. 设置了 filterDir → 只收集在匹配目录及其子目录下的文件
                const collectFile = !filterDir || insideFilteredDir;

                if (matchExt && matchLevel && collectFile) {
                    results.push(fullPath);
                }
            }
        }
    }

    walk(dirPath, 0, false);
    return results;
}

export const resolveSubPath = (...subPaths) => {
    const [firstSubPaths] = subPaths;
    if (Array.isArray(firstSubPaths)) {
        return firstSubPaths.reduce(
            (acc, cur) => (cur && typeof cur === 'string' ? `${acc}/${cur}` : acc),
            resolve(__dirname, `../`),
        );
    }
    if (subPaths.length > 0) {
        return subPaths.reduce(
            (acc, cur) => (cur && typeof cur === 'string' ? `${acc}/${cur}` : acc),
            resolve(__dirname, `../`),
        );
    }
    return resolve(__dirname, `../${firstSubPaths}`);
};

export const getPackageJson = (packageName = BUILD_CONFIG_MAP.tools.value) => {
    const json = JSON.parse(
        readFileSync(resolve(__dirname, `../packages/${packageName}/package.json`), 'utf-8'),
    );
    return json;
};

const { version } = getPackageJson();

export const createCommonInjectVars = () => {
    return {
        __dirname: {
            raw: "(() => { const { pathname } = new URL(import.meta.url);const isWin = process.platform === 'win32';const filePath = isWin && pathname.startsWith('/') ? pathname.slice(1) : pathname;return filePath.slice(0, filePath.lastIndexOf('/'));})()\n",
        },
        __filename: {
            raw: "(() => {const { pathname } = new URL(import.meta.url);return process.platform === 'win32' && pathname.startsWith('/') ? pathname.slice(1) : pathname; })()\n",
        },
        __version: JSON.stringify(version),
        __cwd: {
            raw: 'process.cwd()',
        },
    };
};

export const resolvedExterns = (() => {
    return [
        ...new Set([
            ...Object.values(BUILD_CONFIG_MAP)
                .map((item) => {
                    const { dependencies, devDependencies } = getPackageJson(item.value);
                    const resolveDependencies = [
                        ...Object.keys(dependencies || {}),
                        ...Object.keys(devDependencies || {}),
                    ];
                    return resolveDependencies;
                })
                .flat(),
        ]),
    ];
})();
