import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    clearLoggers,
    createLogger,
    formatLogRecord,
    getGlobalLevel,
    getLogger,
    Logger,
    LOG_LEVEL_ORDER,
    safeStringify,
    setGlobalLevel,
} from '../src/logger';
import type { LogRecord, LoggerOptions } from '../src/logger';

function capture(options: LoggerOptions = {}) {
    const records: LogRecord[] = [];
    const logger = createLogger({
        ...options,
        handler: (record) => records.push(record),
    });
    return { logger, records };
}

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    clearLoggers();
});

describe('LOG_LEVEL_ORDER', () => {
    it('orders levels from least to most severe', () => {
        expect(LOG_LEVEL_ORDER.debug).toBeLessThan(LOG_LEVEL_ORDER.info);
        expect(LOG_LEVEL_ORDER.info).toBeLessThan(LOG_LEVEL_ORDER.warn);
        expect(LOG_LEVEL_ORDER.warn).toBeLessThan(LOG_LEVEL_ORDER.error);
        expect(LOG_LEVEL_ORDER.error).toBeLessThan(LOG_LEVEL_ORDER.silent);
    });
});

describe('safeStringify', () => {
    it('returns strings unchanged', () => {
        expect(safeStringify('hello')).toBe('hello');
    });

    it('serializes primitive values', () => {
        expect(safeStringify(undefined)).toBe('undefined');
        expect(safeStringify(BigInt(10))).toBe('10n');
        expect(safeStringify(Symbol('tag'))).toBe('Symbol(tag)');
        expect(safeStringify(null)).toBe('null');
        expect(safeStringify(42)).toBe('42');
    });

    it('describes functions', () => {
        function named() {}
        expect(safeStringify(named)).toBe('[Function named]');
        expect(safeStringify(() => {})).toBe('[Function anonymous]');
    });

    it('uses the stack for Error values', () => {
        const error = new Error('boom');
        expect(safeStringify(error)).toContain('boom');
        expect(safeStringify(error)).toContain('Error');
    });

    it('falls back to name and message when there is no stack', () => {
        const error = new Error('no stack');
        error.stack = '';
        expect(safeStringify(error)).toBe('Error: no stack');
    });

    it('serializes nested objects, arrays, Map, Set and RegExp', () => {
        const value = {
            list: [1, 'two'],
            map: new Map([['a', 1]]),
            set: new Set([1, 2]),
            regexp: /ab+c/gi,
            nested: { ok: true },
        };
        const parsed = JSON.parse(safeStringify(value));
        expect(parsed.list).toEqual([1, 'two']);
        expect(parsed.map).toEqual([['a', 1]]);
        expect(parsed.set).toEqual([1, 2]);
        expect(parsed.regexp).toBe('/ab+c/gi');
        expect(parsed.nested).toEqual({ ok: true });
    });

    it('handles circular references', () => {
        const value: any = { name: 'root' };
        value.self = value;
        const parsed = JSON.parse(safeStringify(value));
        expect(parsed.name).toBe('root');
        expect(parsed.self).toBe('[Circular]');
    });

    it('serializes nested Error values', () => {
        const parsed = JSON.parse(safeStringify({ error: new Error('inner') }));
        expect(parsed.error.name).toBe('Error');
        expect(parsed.error.message).toBe('inner');
    });

    it('serializes nested bigint, symbol and function values', () => {
        const parsed = JSON.parse(
            safeStringify({
                big: BigInt(1),
                sym: Symbol('s'),
                fn: function named() {},
            }),
        );
        expect(parsed.big).toBe('1n');
        expect(parsed.sym).toBe('Symbol(s)');
        expect(parsed.fn).toBe('[Function named]');
    });

    it('falls back to String() when JSON.stringify throws', () => {
        const value = {
            toJSON() {
                throw new Error('cannot serialize');
            },
        };
        expect(safeStringify(value)).toBe('[object Object]');
    });

    it('falls back to String() when toJSON yields undefined', () => {
        const value = { toJSON: () => undefined };
        expect(safeStringify(value)).toBe('[object Object]');
    });

    it('describes nested anonymous functions', () => {
        // Array elements do not receive an inferred function name.
        expect(safeStringify([() => {}])).toBe('["[Function anonymous]"]');
    });
});

describe('Logger levels', () => {
    it('defaults to info and filters debug', () => {
        const { logger, records } = capture();
        logger.debug('hidden');
        logger.info('shown');
        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ level: 'info', message: 'shown' });
    });

    it('writes each level with its own level value', () => {
        const { logger, records } = capture({ level: 'debug' });
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        expect(records.map((record) => record.level)).toEqual(['debug', 'info', 'warn', 'error']);
    });

    it('supports dynamic levels via log()', () => {
        const { logger, records } = capture({ level: 'debug' });
        logger.log('warn', 'dynamic');
        expect(records[0]).toMatchObject({ level: 'warn', message: 'dynamic' });
    });

    it('respects setLevel for the logger and its children', () => {
        const { logger, records } = capture();
        const child = logger.child('child');
        child.setLevel('debug');
        logger.debug('parent now visible');
        child.debug('child visible');
        expect(records.map((record) => record.message)).toEqual([
            'parent now visible',
            'child visible',
        ]);
        expect(logger.getLevel()).toBe('debug');
    });

    it('silences every level with silent', () => {
        const { logger, records } = capture({ level: 'silent' });
        logger.debug('d');
        logger.info('i');
        logger.warn('w');
        logger.error('e');
        expect(records).toHaveLength(0);
        expect(logger.isLevelEnabled('error')).toBe(false);
    });

    it('reports isLevelEnabled for each level', () => {
        const { logger } = capture({ level: 'warn' });
        expect(logger.isLevelEnabled('debug')).toBe(false);
        expect(logger.isLevelEnabled('info')).toBe(false);
        expect(logger.isLevelEnabled('warn')).toBe(true);
        expect(logger.isLevelEnabled('error')).toBe(true);
    });

    it('throws on an invalid level', () => {
        const { logger } = capture();
        expect(() => logger.setLevel('verbose' as any)).toThrow('Invalid log level: verbose');
    });

    it('throws when constructed with an invalid level', () => {
        expect(() => createLogger({ level: 'verbose' as any })).toThrow(
            'Invalid log level: verbose',
        );
    });
});

describe('Logger context and namespaces', () => {
    it('records the message, args, name and timestamp', () => {
        const { logger, records } = capture({ name: 'api', context: { tenant: 'acme' } });
        const error = new Error('failed');
        logger.error('request failed', error, { status: 500 });

        const record = records[0];
        expect(record.message).toBe('request failed');
        expect(record.args).toEqual([error, { status: 500 }]);
        expect(record.name).toBe('api');
        expect(record.context).toEqual({ tenant: 'acme' });
        expect(typeof record.timestamp).toBe('number');
    });

    it('joins child names with a colon', () => {
        const { logger } = capture({ name: 'api' });
        expect(logger.child('user').name).toBe('api:user');
        expect(logger.child('user').child('profile').name).toBe('api:user:profile');
    });

    it('uses the child name as-is when the parent has no name', () => {
        const { logger } = capture();
        expect(logger.child('db').name).toBe('db');
    });

    it('keeps the parent name for an empty child name', () => {
        const { logger } = capture({ name: 'api' });
        expect(logger.child('').name).toBe('api');
    });

    it('merges contexts with the child taking precedence', () => {
        const { logger, records } = capture({ context: { a: 1, b: 2 } });
        const child = logger.child('child', { b: 3, c: 4 });
        child.info('hello');
        expect(records[0].context).toEqual({ a: 1, b: 3, c: 4 });
    });

    it('adds context without renaming via withContext', () => {
        const { logger, records } = capture({ name: 'api' });
        logger.withContext({ requestId: 'r-1' }).info('hi');
        expect(records[0].name).toBe('api');
        expect(records[0].context).toEqual({ requestId: 'r-1' });
    });

    it('copies context so later mutations do not leak into records', () => {
        const context: Record<string, unknown> = { a: 1 };
        const { logger, records } = capture({ context });
        context.a = 2;
        logger.info('hi');
        expect(records[0].context).toEqual({ a: 1 });
    });
});

describe('Logger timestamps', () => {
    it('omits the formatted time by default', () => {
        const { logger, records } = capture();
        logger.info('hi');
        expect(records[0].time).toBe('');
    });

    it('formats HH:mm:ss.SSS when timestamps are enabled', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 8, 5, 3, 42));
        const { logger, records } = capture({ timestamp: true });
        logger.info('hi');
        expect(records[0].time).toBe('08:05:03.042');
    });

    it('uses a custom time formatter', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 8, 5, 3));
        const { logger, records } = capture({
            timestamp: true,
            timeFormatter: (date) => date.toISOString(),
        });
        logger.info('hi');
        expect(records[0].time).toBe(new Date(2026, 9, 19, 8, 5, 3).toISOString());
    });
});

describe('Logger history', () => {
    it('keeps the most recent records up to historySize', () => {
        const { logger } = capture({ historySize: 2 });
        logger.info('one');
        logger.info('two');
        logger.info('three');

        const history = logger.getHistory();
        expect(history.map((record) => record.message)).toEqual(['two', 'three']);
    });

    it('returns a copy of the history', () => {
        const { logger } = capture({ historySize: 5 });
        logger.info('one');
        const history = logger.getHistory();
        history.push({} as LogRecord);
        expect(logger.getHistory()).toHaveLength(1);
    });

    it('does not record history by default', () => {
        const { logger } = capture();
        logger.info('one');
        expect(logger.getHistory()).toEqual([]);
    });

    it('ignores filtered records in history', () => {
        const { logger } = capture({ historySize: 5 });
        logger.debug('hidden');
        logger.info('shown');
        expect(logger.getHistory().map((record) => record.message)).toEqual(['shown']);
    });

    it('clears the history', () => {
        const { logger } = capture({ historySize: 5 });
        logger.info('one');
        logger.clearHistory();
        expect(logger.getHistory()).toEqual([]);
    });

    it('normalizes negative historySize to zero', () => {
        const { logger } = capture({ historySize: -5 });
        logger.info('one');
        expect(logger.getHistory()).toEqual([]);
    });
});

describe('Logger handlers', () => {
    it('allows replacing the handler for the whole tree', () => {
        const first: LogRecord[] = [];
        const second: LogRecord[] = [];
        const logger = createLogger({ handler: (record) => first.push(record) });
        const child = logger.child('child');

        logger.setHandler((record) => second.push(record));
        child.info('hi');

        expect(first).toHaveLength(0);
        expect(second).toHaveLength(1);
    });

    it('swallows handler errors and reports them', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        const logger = createLogger({
            handler: () => {
                throw new Error('handler boom');
            },
        });

        expect(() => logger.info('hi')).not.toThrow();
        expect(consoleError).toHaveBeenCalledWith(
            '[logger] log handler threw an error:',
            expect.any(Error),
        );
    });

    it('ignores a re-entrant handler error while already reporting', () => {
        const logger = createLogger({
            handler: () => {
                throw new Error('handler boom');
            },
        });
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
            // Re-enter the logger from inside console.error.
            logger.info('re-entered');
        });

        expect(() => logger.info('hi')).not.toThrow();
        expect(consoleError).toHaveBeenCalledTimes(1);
    });

    it('does not recurse when reporting a handler error fails', () => {
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {
            throw new Error('console boom');
        });
        const logger = createLogger({
            handler: () => {
                throw new Error('handler boom');
            },
        });

        expect(() => logger.info('hi')).toThrow('console boom');
        expect(consoleError).toHaveBeenCalledTimes(1);
    });
});

describe('default console handler', () => {
    it('writes to the console method matching the level', () => {
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const error = vi.spyOn(console, 'error').mockImplementation(() => {});
        const logger = createLogger();

        logger.info('hello');
        logger.warn('careful');
        logger.error('boom');

        expect(info).toHaveBeenCalledWith('[INFO]', 'hello');
        expect(warn).toHaveBeenCalledWith('[WARN]', 'careful');
        expect(error).toHaveBeenCalledWith('[ERROR]', 'boom');
    });

    it('includes name, time, context and extra args', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date(2026, 9, 19, 8, 5, 3, 7));
        const info = vi.spyOn(console, 'info').mockImplementation(() => {});
        const logger = createLogger({
            name: 'api',
            timestamp: true,
            context: { tenant: 'acme' },
        });

        logger.info('hello', 1, 'two');

        expect(info).toHaveBeenCalledWith(
            '08:05:03.007',
            '[api]',
            '[INFO]',
            'hello',
            { tenant: 'acme' },
            1,
            'two',
        );
    });

    it('passes Error arguments through unchanged', () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const logger = createLogger();
        const error = new Error('kaboom');

        logger.error('failed', error);

        expect(errorSpy.mock.calls[0]).toContain(error);
    });

    it('falls back to console.log when the level method is missing', () => {
        const log = vi.fn();
        vi.stubGlobal('console', { log });
        const logger = createLogger();

        logger.info('hello');

        expect(log).toHaveBeenCalledWith('[INFO]', 'hello');
    });

    it('ignores a matching console property that is not a function', () => {
        const log = vi.fn();
        vi.stubGlobal('console', { info: 'not-a-function', log });
        const logger = createLogger();

        expect(() => logger.info('hello')).not.toThrow();
        expect(log).not.toHaveBeenCalled();
    });

    it('does nothing when console is unavailable', () => {
        const logger = createLogger();
        vi.stubGlobal('console', undefined);

        expect(() => logger.info('hello')).not.toThrow();
    });
});

describe('formatLogRecord', () => {
    it('formats a full record', () => {
        const record: LogRecord = {
            level: 'warn',
            message: 'slow request',
            args: [{ ms: 1200 }, 'retry'],
            context: { path: '/users' },
            name: 'api',
            timestamp: 0,
            time: '08:05:03.007',
        };

        expect(formatLogRecord(record)).toBe(
            '08:05:03.007 [api] [WARN] slow request {"path":"/users"} {"ms":1200} retry',
        );
    });

    it('omits empty time, name and context', () => {
        const record: LogRecord = {
            level: 'info',
            message: 'hello',
            args: [],
            context: {},
            name: '',
            timestamp: 0,
            time: '',
        };

        expect(formatLogRecord(record)).toBe('[INFO] hello');
    });
});

describe('Logger helpers', () => {
    it('time() logs the duration and returns it', () => {
        vi.useFakeTimers();
        vi.setSystemTime(1_000);
        const { logger, records } = capture({ level: 'debug' });

        const end = logger.time('fetch users');
        vi.setSystemTime(1_042);
        const duration = end();

        expect(duration).toBe(42);
        expect(records[0]).toMatchObject({
            level: 'debug',
            message: 'fetch users: 42ms',
        });
    });

    it('time() still returns the duration when debug is disabled', () => {
        vi.useFakeTimers();
        vi.setSystemTime(5_000);
        const { logger, records } = capture();
        const end = logger.time();

        vi.setSystemTime(5_010);
        expect(end()).toBe(10);
        expect(records).toHaveLength(0);
    });

    it('assert() logs only when the condition is falsy', () => {
        const { logger, records } = capture();
        logger.assert(true, 'should not log');
        logger.assert(false, 'should log');

        expect(records).toHaveLength(1);
        expect(records[0]).toMatchObject({ level: 'error', message: 'should log' });
    });
});

describe('logger registry', () => {
    it('returns the same instance for the same name', () => {
        const first = getLogger('api');
        const second = getLogger('api');
        expect(first).toBe(second);
    });

    it('returns different instances for different names', () => {
        expect(getLogger('api')).not.toBe(getLogger('db'));
    });

    it('uses "app" as the default name', () => {
        expect(getLogger().name).toBe('app');
    });

    it('createLogger always creates a new instance', () => {
        const first = createLogger({ name: 'api' });
        const second = createLogger({ name: 'api' });
        expect(first).not.toBe(second);
        expect(first).toBeInstanceOf(Logger);
    });

    it('defaults the global level to info', () => {
        expect(getGlobalLevel()).toBe('info');
    });

    it('applies the global level to existing and new loggers', () => {
        const existing = capture().logger;
        setGlobalLevel('warn');
        const created = capture().logger;

        expect(existing.getLevel()).toBe('warn');
        expect(created.getLevel()).toBe('warn');
        expect(getGlobalLevel()).toBe('warn');
    });

    it('rejects an invalid global level', () => {
        expect(() => setGlobalLevel('verbose' as any)).toThrow('Invalid log level: verbose');
    });

    it('clearLoggers resets the registry and the global level', () => {
        const first = getLogger('api');
        setGlobalLevel('error');
        clearLoggers();

        expect(getGlobalLevel()).toBe('info');
        expect(getLogger('api')).not.toBe(first);
        expect(getLogger('api').getLevel()).toBe('info');
    });
});
