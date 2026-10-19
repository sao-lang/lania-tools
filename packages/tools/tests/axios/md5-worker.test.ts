// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';

const md5 = (value: string) => createHash('md5').update(value).digest('hex');

let handler: ((event: MessageEvent) => void) | null = null;

beforeAll(async () => {
    // The worker module registers `self.onmessage` on import.
    await import('../../src/axios/md5-calculator.worker');
    handler = (globalThis as any).onmessage;
});

function run(file: any, chunkSize: number): Promise<any> {
    return new Promise((resolve) => {
        vi.stubGlobal('postMessage', (message: any) => resolve(message));
        handler!({ data: { file, chunkSize } } as MessageEvent);
    });
}

describe('md5-calculator.worker', () => {
    it('registers an onmessage handler', () => {
        expect(typeof handler).toBe('function');
    });

    it('computes the md5 of a small file across multiple chunks', async () => {
        const file = new File(['abcdefghij'], 'a.txt');
        const message = await run(file, 4);
        expect(message).toEqual({ result: md5('abcdefghij') });
    });

    it('computes the md5 with a single chunk', async () => {
        const file = new File(['hello world'], 'b.txt');
        const message = await run(file, 1024);
        expect(message).toEqual({ result: md5('hello world') });
    });

    it('posts an error when a chunk cannot be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {});
        const brokenFile = {
            size: 8,
            slice: () => {
                throw new Error('slice failure');
            },
        };
        const message = await run(brokenFile, 4);
        expect(message).toEqual({ error: 'slice failure' });
    });

    it('posts a generic error when the thrown value has no message', async () => {
        const brokenFile = {
            size: 8,
            slice: () => {
                // eslint-disable-next-line no-throw-literal
                throw {};
            },
        };
        const message = await run(brokenFile, 4);
        expect(message).toEqual({ error: 'Worker execution failed.' });
    });
});
