// @vitest-environment node
import { createHash } from 'node:crypto';
import axios from 'axios';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GlobalConcurrencyController } from '../../src/axios/GlobalConcurrencyController';
import { UploadManager } from '../../src/axios/UploadManager';

// Keep chunking cheap in unit tests; integration tests use the real 5MB size.
vi.mock('../../src/axios/const', async (importOriginal) => {
    const actual = await importOriginal<typeof import('../../src/axios/const')>();
    return { ...actual, CHUNK_SIZE: 4 };
});

const md5 = (buffer: Buffer | string) => createHash('md5').update(buffer).digest('hex');

function makeFile(content: string, name = 'file.txt', type = 'text/plain'): File {
    return new File([content], name, { type });
}

function makePost(
    handler?: (url: string, formData: FormData, config: any) => Promise<any> | any,
) {
    return vi.fn(async (url: string, formData: FormData, config: any) => {
        if (handler) return handler(url, formData, config);
        config?.onUploadProgress?.({ loaded: 4, total: 4 });
        return { data: { ok: true } };
    });
}

describe('UploadManager.calculateChunkMd5', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('computes the md5 of a Blob', async () => {
        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        const hash = await manager.calculateChunkMd5(new Blob(['hello world']));
        expect(hash).toBe(md5('hello world'));
    });

    it('falls back to FileReader when Blob.arrayBuffer is unavailable', async () => {
        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        const data = new TextEncoder().encode('legacy-reader');
        const fakeBlob = {
            size: data.byteLength,
            arrayBuffer: undefined,
            slice: () => fakeBlob,
            __data: data,
        };

        class FakeFileReader {
            public result: ArrayBuffer | null = null;
            public error: Error | null = null;
            public onload: ((event: any) => void) | null = null;
            public onerror: (() => void) | null = null;

            readAsArrayBuffer(blob: any) {
                this.result = blob.__data.buffer.slice(
                    blob.__data.byteOffset,
                    blob.__data.byteOffset + blob.__data.byteLength,
                );
                this.onload?.({ target: this });
            }
        }

        vi.stubGlobal('FileReader', FakeFileReader);
        const hash = await manager.calculateChunkMd5(fakeBlob as any);
        expect(hash).toBe(md5('legacy-reader'));
    });

    it('rejects when FileReader fails', async () => {
        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        const fakeBlob = { size: 1, arrayBuffer: undefined, slice: () => fakeBlob };

        class FailingReader {
            public error = new Error('read failed');
            public onload: any = null;
            public onerror: (() => void) | null = null;
            readAsArrayBuffer() {
                this.onerror?.();
            }
        }

        vi.stubGlobal('FileReader', FailingReader);
        await expect(manager.calculateChunkMd5(fakeBlob as any)).rejects.toThrow('read failed');
    });
});

describe('UploadManager.calculateFileMd5', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('computes the md5 on the main thread when Worker is unavailable', async () => {
        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        const file = makeFile('abcdefghij');
        await expect(manager.calculateFileMd5(file, 4)).resolves.toBe(md5('abcdefghij'));
    });

    it('delegates to a Web Worker when available', async () => {
        const posted: any[] = [];
        const terminate = vi.fn();
        class FakeWorker {
            public onmessage: ((event: any) => void) | null = null;
            public onerror: ((event: any) => void) | null = null;
            constructor(
                public url: URL,
                public options: any,
            ) {}
            postMessage(message: any) {
                posted.push(message);
                queueMicrotask(() => this.onmessage?.({ data: { result: 'worker-hash' } }));
            }
            terminate = terminate;
        }
        vi.stubGlobal('Worker', FakeWorker);

        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        const file = makeFile('content');
        await expect(manager.calculateFileMd5(file, 4)).resolves.toBe('worker-hash');
        expect(posted).toEqual([{ file, chunkSize: 4 }]);
        expect(terminate).toHaveBeenCalledTimes(1);
    });

    it('rejects when the worker posts an error payload', async () => {
        class FakeWorker {
            public onmessage: ((event: any) => void) | null = null;
            public onerror: ((event: any) => void) | null = null;
            postMessage() {
                queueMicrotask(() => this.onmessage?.({ data: { error: 'bad file' } }));
            }
            terminate = vi.fn();
        }
        vi.stubGlobal('Worker', FakeWorker);

        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        await expect(manager.calculateFileMd5(makeFile('x'), 4)).rejects.toThrow(
            'MD5 Worker Error: bad file',
        );
    });

    it('rejects when the worker itself fails', async () => {
        class FakeWorker {
            public onmessage: ((event: any) => void) | null = null;
            public onerror: ((event: any) => void) | null = null;
            postMessage() {
                queueMicrotask(() => this.onerror?.({ message: 'crash' }));
            }
            terminate = vi.fn();
        }
        vi.stubGlobal('Worker', FakeWorker);

        const manager = new UploadManager({} as any, new GlobalConcurrencyController(1));
        await expect(manager.calculateFileMd5(makeFile('x'), 4)).rejects.toThrow(
            'MD5 Worker failed: crash',
        );
    });
});

describe('UploadManager.uploadChunk', () => {
    let controller: GlobalConcurrencyController;

    beforeEach(() => {
        controller = new GlobalConcurrencyController(2);
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('posts multipart fields, headers, cancel token and progress', async () => {
        const post = makePost(async (_url, formData, config) => {
            config.onUploadProgress({ loaded: 2, total: 4 });
            return { data: { ok: true } };
        });
        const manager = new UploadManager({ post } as any, controller);
        const progress = vi.fn();
        const source = axios.CancelToken.source();

        await manager.uploadChunk(
            '/upload',
            new Blob(['abcd']),
            1,
            3,
            source,
            'file-md5',
            'chunk-md5',
            progress,
        );

        expect(post).toHaveBeenCalledTimes(1);
        const [url, formData, config] = post.mock.calls[0];
        expect(url).toBe('/upload');
        expect(config.headers).toEqual({ 'Content-Type': 'multipart/form-data' });
        expect(config.cancelToken).toBe(source.token);
        expect(formData.get('chunkIndex')).toBe('1');
        expect(formData.get('totalChunks')).toBe('3');
        expect(formData.get('fileMd5')).toBe('file-md5');
        expect(formData.get('chunkMd5')).toBe('chunk-md5');
        expect(progress).toHaveBeenCalledWith(2, 4);
    });

    it('omits optional md5 fields and progress callback', async () => {
        const post = makePost();
        const manager = new UploadManager({ post } as any, controller);
        await manager.uploadChunk('/upload', new Blob(['x']), 0, 1, axios.CancelToken.source());
        const formData: FormData = post.mock.calls[0][1];
        expect(formData.has('fileMd5')).toBe(false);
        expect(formData.has('chunkMd5')).toBe(false);
        expect(post.mock.calls[0][2].onUploadProgress).toBeUndefined();
    });

    it('retries a failing chunk and succeeds', async () => {
        vi.useFakeTimers();
        let attempts = 0;
        const post = makePost(() => {
            attempts += 1;
            if (attempts < 3) return Promise.reject(new Error('network'));
            return Promise.resolve({ data: { ok: true } });
        });
        const manager = new UploadManager({ post } as any, controller);
        const promise = manager.uploadChunk(
            '/upload',
            new Blob(['x']),
            0,
            1,
            axios.CancelToken.source(),
            undefined,
            undefined,
            undefined,
            2,
            25,
        );
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toBeUndefined();
        expect(post).toHaveBeenCalledTimes(3);
    });

    it('throws the last error after exhausting retries', async () => {
        vi.useFakeTimers();
        const post = makePost(() => Promise.reject(new Error('still broken')));
        const manager = new UploadManager({ post } as any, controller);
        const promise = manager.uploadChunk(
            '/upload',
            new Blob(['x']),
            0,
            1,
            axios.CancelToken.source(),
            undefined,
            undefined,
            undefined,
            2,
            1,
        );
        const assertion = expect(promise).rejects.toThrow('still broken');
        await vi.runAllTimersAsync();
        await assertion;
        expect(post).toHaveBeenCalledTimes(3);
    });

    it('does not retry user cancellations', async () => {
        const post = makePost(() => Promise.reject(new axios.CanceledError('cancelled')));
        const manager = new UploadManager({ post } as any, controller);
        await expect(
            manager.uploadChunk('/upload', new Blob(['x']), 0, 1, axios.CancelToken.source()),
        ).rejects.toThrow('Upload canceled by user signal.');
        expect(post).toHaveBeenCalledTimes(1);
    });

    it('releases the concurrency slot while waiting to retry (no deadlock with limit 1)', async () => {
        vi.useFakeTimers();
        const singleController = new GlobalConcurrencyController(1);
        let attempts = 0;
        const post = makePost(() => {
            attempts += 1;
            return attempts === 1
                ? Promise.reject(new Error('first fails'))
                : Promise.resolve({ data: { ok: true } });
        });
        const manager = new UploadManager({ post } as any, singleController);
        const promise = manager.uploadChunk(
            '/upload',
            new Blob(['x']),
            0,
            1,
            axios.CancelToken.source(),
            undefined,
            undefined,
            undefined,
            1,
            10,
        );
        await vi.advanceTimersByTimeAsync(10);
        await expect(promise).resolves.toBeUndefined();
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('never exceeds the global concurrency limit', async () => {
        let active = 0;
        let maxActive = 0;
        const post = makePost(async () => {
            active += 1;
            maxActive = Math.max(maxActive, active);
            await new Promise((resolve) => setTimeout(resolve, 5));
            active -= 1;
            return { data: { ok: true } };
        });
        const manager = new UploadManager({ post } as any, new GlobalConcurrencyController(2));
        await Promise.all(
            Array.from({ length: 6 }, (_, i) =>
                manager.uploadChunk(
                    '/upload',
                    new Blob([String(i)]),
                    i,
                    6,
                    axios.CancelToken.source(),
                ),
            ),
        );
        expect(post).toHaveBeenCalledTimes(6);
        expect(maxActive).toBe(2);
    });
});

describe('UploadManager.uploadFile', () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('splits the file, uploads every chunk and reports progress', async () => {
        const post = makePost();
        const get = vi.fn();
        const manager = new UploadManager({ post, get } as any, new GlobalConcurrencyController(2));
        const file = makeFile('abcdefghij'); // 10 bytes -> 4 + 4 + 2
        const md5Spy = vi.spyOn(manager, 'calculateFileMd5');
        const chunkMd5Spy = vi.spyOn(manager, 'calculateChunkMd5');
        const onProgress = vi.fn();
        const onChunkProgress = vi.fn();

        const result = await manager.uploadFile('/upload', file, {
            calculateChunkMd5: true,
            onProgress,
            onChunkProgress,
        });

        const fileMd5 = md5('abcdefghij');
        expect(result).toEqual({ fileMd5, totalChunks: 3 });
        expect(md5Spy).toHaveBeenCalledWith(file, 4);
        expect(chunkMd5Spy).toHaveBeenCalledTimes(3);
        expect(post).toHaveBeenCalledTimes(3);
        expect(get).not.toHaveBeenCalled();

        const requestedIndexes = post.mock.calls
            .map((call: any[]) => Number(call[1].get('chunkIndex')))
            .sort((a: number, b: number) => a - b);
        expect(requestedIndexes).toEqual([0, 1, 2]);
        post.mock.calls.forEach((call: any[]) => {
            const formData: FormData = call[1];
            const chunk = formData.get('file') as Blob;
            expect(formData.get('fileMd5')).toBe(fileMd5);
            expect(formData.get('chunkMd5')).toMatch(/^[a-f0-9]{32}$/);
            expect(chunk.size).toBeGreaterThan(0);
        });
        expect(onProgress.mock.calls).toEqual([
            [1, 3],
            [2, 3],
            [3, 3],
        ]);
        expect(onChunkProgress).toHaveBeenCalledTimes(3);
        expect(onChunkProgress.mock.calls[0][0]).toBe(0);
        expect(onChunkProgress.mock.calls[0][1]).toBe(3);
    });

    it('skips chunks already uploaded when resume is enabled', async () => {
        const post = makePost();
        const file = makeFile('abcdefghij');
        const fileMd5 = md5('abcdefghij');
        const get = vi.fn().mockResolvedValue({ data: { uploaded: [0, 2] } });
        const manager = new UploadManager({ post, get } as any, new GlobalConcurrencyController(2));
        const onProgress = vi.fn();

        const result = await manager.uploadFile('/upload', file, {
            enableResume: true,
            getUploadedChunksUrl: '/upload/uploaded',
            onProgress,
        });

        expect(result.totalChunks).toBe(3);
        expect(get).toHaveBeenCalledWith(
            '/upload/uploaded?fileMd5=' + fileMd5,
            expect.objectContaining({ cancelToken: expect.anything() }),
        );
        expect(post).toHaveBeenCalledTimes(1);
        expect(post.mock.calls[0][1].get('chunkIndex')).toBe('1');
        expect(onProgress.mock.calls).toEqual([
            [3, 3],
        ]);
    });

    it('ignores resume state when enableResume is false', async () => {
        const post = makePost();
        const get = vi.fn();
        const manager = new UploadManager({ post, get } as any, new GlobalConcurrencyController(1));
        await manager.uploadFile('/upload', makeFile('abcdefghij'), {
            getUploadedChunksUrl: '/upload/uploaded',
        });
        expect(get).not.toHaveBeenCalled();
        expect(post).toHaveBeenCalledTimes(3);
    });

    it('handles an empty file without uploading chunks', async () => {
        const post = makePost();
        const manager = new UploadManager({ post } as any, new GlobalConcurrencyController(1));
        const result = await manager.uploadFile('/upload', makeFile(''), {});
        expect(result).toEqual({ fileMd5: md5(''), totalChunks: 0 });
        expect(post).not.toHaveBeenCalled();
    });

    it('handles a file whose size is an exact multiple of the chunk size', async () => {
        const post = makePost();
        const manager = new UploadManager({ post } as any, new GlobalConcurrencyController(2));
        const result = await manager.uploadFile('/upload', makeFile('abcdefgh'), {});
        expect(result.totalChunks).toBe(2);
        expect(post).toHaveBeenCalledTimes(2);
    });

    it('propagates chunk failures', async () => {
        const post = makePost((_url, formData) => {
            if (formData.get('chunkIndex') === '1') {
                return Promise.reject(new Error('chunk rejected'));
            }
            return Promise.resolve({ data: { ok: true } });
        });
        const manager = new UploadManager({ post } as any, new GlobalConcurrencyController(2));
        await expect(manager.uploadFile('/upload', makeFile('abcdefghij'), {})).rejects.toThrow(
            'chunk rejected',
        );
    });

    it('uses default options when none are supplied', async () => {
        const post = makePost();
        const manager = new UploadManager({ post } as any, new GlobalConcurrencyController(1));
        const result = await manager.uploadFile('/upload', makeFile('abcd'));
        expect(result.totalChunks).toBe(1);
        expect(post).toHaveBeenCalledTimes(1);
        const formData: FormData = post.mock.calls[0][1];
        expect(formData.get('fileMd5')).toBe(md5('abcd'));
        expect(formData.has('chunkMd5')).toBe(false);
    });
});
