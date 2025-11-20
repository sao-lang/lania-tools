const { series } = require('gulp');
const { spawn } = require('child_process');
const path = require('path');

const dirPath = path.resolve(__dirname, '../packages');

const run = async (command) => {
    return new Promise((resolve) => {
        const [cmd, ...args] = command.split(' ');
        const app = spawn(cmd, args, {
            cwd: path.resolve(__dirname, '.'),
            stdio: 'inherit',
            shell: true,
        });
        app.on('close', resolve); //
    });
};

const withTaskName = (name, fn) => {
    Object.assign(fn, { displayName: name });
    return fn;
};

const buildTools = () => {
    return withTaskName('build tools', async () => {
        const roolupCfgFilePath = path.resolve(__dirname, '../scripts/rollup.tools.config.js');
        const tsCfgFilePath = path.resolve(__dirname, '../packages/tools/tsconfig.json');
        await run(
            `rimraf ${dirPath}/tools/dist && tsc -p ${tsCfgFilePath} && rollup -c=${roolupCfgFilePath} && rimraf "${dirPath}/tools/dist/*.js" --glob && rimraf ${dirPath}/tools/dist/axios`,
        );
    });
};

module.exports = {
    buildTypes: series(buildTools()),
    build: series(buildTools()),
};
