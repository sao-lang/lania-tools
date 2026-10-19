// @vitest-environment node
import { createHash } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AxiosWrapper } from '../../src/axios';
import { CHUNK_SIZE } from '../../src/axios/const';
import { TestServer } from '../server/test-server';

const MB = 1024 * 1024;

const servers: TestServer[] = [];

async function startServer(options: Record<string, any> = {}) {
    const server = new TestServer(options);
    await server.start();
    servers.push(server);
    return server;
}

afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
});

/** Deterministic pseudo-random binary content so md5 comparisons are meaningful. */
function createBuffer(size: number, seed = 1): Buffer {
    const buffer = Buffer.alloc(size);
    let value = seed;
    for (let i = 0; i < size; i += 1) {
        value = (value * 1103515245 + 12345) & 0x7fffffff;
        buffer[i] = value & 0xff;
    }
    return buffer;
}

function makeFile(size: number, seed = 1, name = 'big-file.bin'): File {
    return new File([new Uint8Array(createBuffer(size, seed))], name, {
        type: 'application/octet-stream',
    });
}

const md5Of = (buffer: Buffer) => createHash('md5').update(buffer).digest('hex');

function createWrapper(server: TestServer, options: Record<string, any> = {}) {
    return new AxiosWrapper(
        { baseURL: server.baseURL, adapter: 'http', timeout: 60_000, maxBodyLength: Infinity },
        options,
    );
}

async function mergeOnServer(server: TestServer, wrapper: AxiosWrapper, fileMd5: string, totalChunks: number) {
    return wrapper.post('/upload/merge', { fileMd5, totalChunks });
}

describe('AxiosWrapper large file upload against a real server', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer();
    });

    afterEach(() => {
        server.reset();
        server.uploadDelayMs = 0;
        vi.restoreAllMocks();
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    it('uploads every chunk and merges into a byte-identical file', async () => {
        const wrapper = createWrapper(server);
        const size = 12 * MB; // 5MB + 5MB + 2MB
        const expected = createBuffer(size);
        const file = makeFile(size);

        const chunkProgress = vi.fn();
        const progress = vi.fn();

        const result = await wrapper.uploadFile('/upload/chunk', file, {
            calculateChunkMd5: true,
            onChunkProgress: chunkProgress,
            onProgress: progress,
        });

        expect(result.totalChunks).toBe(3);
        expect(result.fileMd5).toBe(md5Of(expected));
        expect(CHUNK_SIZE).toBe(5 * MB);

        const chunkIndexes = server.chunkRequests
            .map((record) => record.chunkIndex)
            .sort((a, b) => a - b);
        expect(chunkIndexes).toEqual([0, 1, 2]);
        expect(server.chunkRequests.every((record) => record.fileMd5 === result.fileMd5)).toBe(true);
        expect(server.chunkRequests.every((record) => !!record.chunkMd5)).toBe(true);

        const merged = await mergeOnServer(server, wrapper, result.fileMd5, result.totalChunks);
        expect(merged.data.code).toBe(0);
        expect(merged.data.data.size).toBe(size);
        expect(merged.data.data.md5).toBe(md5Of(expected));

        const downloaded = await wrapper.get(`/upload/file/${result.fileMd5}`, undefined, {
            responseType: 'arraybuffer',
        });
        expect(Buffer.from(downloaded.data).equals(expected)).toBe(true);

        expect(progress.mock.calls.map((call) => call[0])).toEqual([1, 2, 3]);
        // axios emits several progress events per chunk, so only the reported
        // chunk indexes are asserted, not the raw call count.
        expect(chunkProgress).toHaveBeenCalled();
        expect(new Set(chunkProgress.mock.calls.map((call) => call[0]))).toEqual(
            new Set([0, 1, 2]),
        );
        expect(chunkProgress.mock.calls.every((call) => call[1] === 3)).toBe(true);
    }, 30_000);

    it('resumes an interrupted upload by skipping chunks the server already has', async () => {
        // UploadManager expects the "uploaded chunks" endpoint to return
        // `{ uploaded: number[] }`. Unwrap the standard `{ code, data }`
        // envelope with responseHandler, which is the documented integration.
        const wrapper = createWrapper(server, {
            responseHandler: (response: any) => ({
                ...response,
                data: response.data?.data ?? response.data,
            }),
        });
        const size = 12 * MB;
        const expected = createBuffer(size);
        const file = makeFile(size);

        // First pass: upload only the first chunk, simulating an interruption.
        const firstResult = await wrapper.uploadFile('/upload/chunk', file, {
            calculateChunkMd5: true,
        });
        expect(firstResult.totalChunks).toBe(3);

        // Wipe all but chunk 0 to simulate a partial server-side state.
        const state = server.uploads.get(firstResult.fileMd5)!;
        state.chunks.delete(1);
        state.chunks.delete(2);
        server.chunkRequests = [];

        const progress = vi.fn();
        const result = await wrapper.uploadFile('/upload/chunk', file, {
            enableResume: true,
            getUploadedChunksUrl: `${server.baseURL}/upload/uploaded`,
            onProgress: progress,
        });

        expect(result.fileMd5).toBe(firstResult.fileMd5);
        expect(server.chunkRequests.map((record) => record.chunkIndex).sort((a, b) => a - b)).toEqual(
            [1, 2],
        );
        // Progress starts from the already-uploaded chunk count.
        expect(progress.mock.calls.map((call) => call[0])).toEqual([2, 3]);

        const merged = await mergeOnServer(server, wrapper, result.fileMd5, result.totalChunks);
        expect(merged.data.md5).toBe(md5Of(expected));
    }, 30_000);

    it('retries failed chunks over real HTTP before giving up', async () => {
        const wrapper = createWrapper(server);
        const size = 12 * MB;
        const expected = createBuffer(size);
        const file = makeFile(size);

        server.failNextChunks(1, 2);

        const result = await wrapper.uploadFile('/upload/chunk', file, {
            calculateChunkMd5: true,
        });

        const chunkOneAttempts = server.chunkRequests.filter((record) => record.chunkIndex === 1);
        expect(chunkOneAttempts.length).toBe(1);

        const merged = await mergeOnServer(server, wrapper, result.fileMd5, result.totalChunks);
        expect(merged.data.data.md5).toBe(md5Of(expected));
    }, 40_000);

    it('respects the global concurrency limit while uploading', async () => {
        const wrapper = createWrapper(server, { maxConcurrent: 2 });
        const size = 20 * MB; // 4 chunks
        const expected = createBuffer(size, 7);
        const file = makeFile(size, 7);
        server.uploadDelayMs = 80;

        const result = await wrapper.uploadFile('/upload/chunk', file, {
            calculateChunkMd5: true,
        });

        expect(result.totalChunks).toBe(4);
        expect(server.maxConcurrentUploads).toBeLessThanOrEqual(2);
        expect(server.maxConcurrentUploads).toBeGreaterThan(1);

        const merged = await mergeOnServer(server, wrapper, result.fileMd5, result.totalChunks);
        expect(merged.data.data.md5).toBe(md5Of(expected));
    }, 40_000);

    it('cancels an in-flight upload through cancelTokenId', async () => {
        const wrapper = createWrapper(server, { maxConcurrent: 1 });
        const file = makeFile(20 * MB, 3);
        server.uploadDelayMs = 60;

        const upload = wrapper.uploadFile('/upload/chunk', file, {
            cancelTokenId: 'upload-cancel',
        });

        await new Promise((resolve) => setTimeout(resolve, 80));
        wrapper.cancelRequest('upload-cancel');

        const error = await upload.catch((err) => err);
        expect((error as Error).message).toMatch(/Upload canceled by user signal|canceled/i);

        // Cancelling again must be safe (the token was cleaned up).
        expect(() => wrapper.cancelRequest('upload-cancel')).not.toThrow();
    }, 30_000);

    it('propagates a permanently failing chunk and never merges', async () => {
        const wrapper = createWrapper(server);
        const file = makeFile(12 * MB, 5);
        server.failNextChunks(2, 99);

        const merge = vi.spyOn(wrapper, 'post');
        const error = await wrapper
            .uploadFile('/upload/chunk', file, { calculateChunkMd5: true })
            .catch((err) => err);

        expect(error).toBeInstanceOf(Error);
        expect((error as any).response?.status).toBe(500);
        // 1 initial attempt + 3 retries.
        expect(server.chunkRequests.filter((r) => r.chunkIndex === 2)).toHaveLength(0);
        expect(merge).not.toHaveBeenCalled();
    }, 40_000);

    it('handles a file that is an exact multiple of the chunk size', async () => {
        const wrapper = createWrapper(server);
        const size = 10 * MB;
        const expected = createBuffer(size, 9);
        const file = makeFile(size, 9);

        const result = await wrapper.uploadFile('/upload/chunk', file, { calculateChunkMd5: true });
        expect(result.totalChunks).toBe(2);

        const merged = await mergeOnServer(server, wrapper, result.fileMd5, result.totalChunks);
        expect(merged.data.data.md5).toBe(md5Of(expected));
    }, 30_000);

    it('reports an empty file without uploading anything', async () => {
        const wrapper = createWrapper(server);
        const result = await wrapper.uploadFile('/upload/chunk', new File([], 'empty.bin'));
        expect(result).toEqual({ fileMd5: md5Of(Buffer.alloc(0)), totalChunks: 0 });
        expect(server.chunkRequests).toHaveLength(0);
    });
});
