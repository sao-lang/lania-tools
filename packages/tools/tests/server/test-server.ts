import { createHash, randomUUID } from 'node:crypto';
import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { AddressInfo, Socket } from 'node:net';

export type AuthErrorMode = 'business' | 'http';

export interface TokenPair {
    accessToken: string;
    refreshToken: string;
    tokenSeq: number;
}

export interface ChunkRequestRecord {
    chunkIndex: number;
    totalChunks: number;
    fileMd5?: string;
    chunkMd5?: string;
    bytes: number;
    at: number;
}

export interface TestServerOptions {
    /** Access token lifetime in milliseconds. Defaults to 60_000. */
    accessTtlMs?: number;
    /** Refresh token lifetime in milliseconds. Defaults to 60_000. */
    refreshTtlMs?: number;
    /** How expired access tokens are reported. Defaults to a business code in HTTP 200. */
    authErrorMode?: AuthErrorMode;
    /** Artificial latency for POST /auth/refresh. */
    refreshDelayMs?: number;
    /** When true, POST /auth/refresh answers HTTP 500. */
    failRefresh?: boolean;
    /** Business code used for an expired access token. */
    accessExpiredCode?: number | string;
    /** Business code used for an expired refresh token. */
    refreshExpiredCode?: number | string;
    /** Artificial latency for every upload chunk. */
    uploadDelayMs?: number;
}

export interface MultipartPart {
    filename?: string;
    contentType?: string;
    data: Buffer;
}

export interface UploadState {
    chunks: Map<number, Buffer>;
    totalChunks: number;
    merged?: Buffer;
}

type JsonValue = Record<string, unknown> | unknown[] | string | number | boolean | null;

const DEFAULTS = {
    accessExpiredCode: 40101,
    refreshExpiredCode: 40102,
    accessTtlMs: 60_000,
    refreshTtlMs: 60_000,
};

/**
 * A dependency-free HTTP server used by the integration tests.
 *
 * It intentionally implements the difficult server-side behaviours that the
 * AxiosWrapper tests need: rotating refresh tokens, business-code based auth
 * failures, flaky endpoints, chunked/resumable uploads and downloads.
 */
export class TestServer {
    public readonly accessExpiredCode: number | string;
    public readonly refreshExpiredCode: number | string;
    public accessTtlMs: number;
    public refreshTtlMs: number;
    public authErrorMode: AuthErrorMode;
    public refreshDelayMs: number;
    public failRefresh: boolean;
    public uploadDelayMs: number;
    public alwaysExpireAccess = false;

    public requestCount = 0;
    public activeRequests = 0;
    public maxActiveRequests = 0;
    public abortedRequests = 0;
    public refreshCalls = 0;
    public refreshSuccessCalls = 0;
    public loginCalls = 0;
    public chunkRequests: ChunkRequestRecord[] = [];
    public maxConcurrentUploads = 0;
    public activeUploads = 0;

    /** key -> remaining number of failures for GET /flaky */
    public flakyFailures = new Map<string, number>();
    /** key -> attempt counter for GET /flaky */
    public flakyAttempts = new Map<string, number>();
    /** chunk index -> remaining number of failures */
    public chunkFailures = new Map<number, number>();
    /** key -> hit counter for GET /poll/:key */
    public pollCounts = new Map<string, number>();
    public uploads = new Map<string, UploadState>();
    public tokenSeq = 0;

    public readonly accessTokens = new Map<string, { seq: number; expiresAt: number }>();
    public readonly refreshTokens = new Map<
        string,
        { seq: number; expiresAt: number; used: boolean }
    >();

    private server: Server | null = null;
    private sockets = new Set<Socket>();
    private port = 0;

    constructor(options: TestServerOptions = {}) {
        this.accessTtlMs = options.accessTtlMs ?? DEFAULTS.accessTtlMs;
        this.refreshTtlMs = options.refreshTtlMs ?? DEFAULTS.refreshTtlMs;
        this.authErrorMode = options.authErrorMode ?? 'business';
        this.refreshDelayMs = options.refreshDelayMs ?? 0;
        this.failRefresh = options.failRefresh ?? false;
        this.uploadDelayMs = options.uploadDelayMs ?? 0;
        this.accessExpiredCode = options.accessExpiredCode ?? DEFAULTS.accessExpiredCode;
        this.refreshExpiredCode = options.refreshExpiredCode ?? DEFAULTS.refreshExpiredCode;
    }

    get baseURL(): string {
        return `http://127.0.0.1:${this.port}`;
    }

    get url(): string {
        return this.baseURL;
    }

    async start(): Promise<void> {
        if (this.server) return;
        this.server = createServer((req, res) => {
            void this.handle(req, res);
        });
        this.server.on('connection', (socket) => {
            this.sockets.add(socket);
            socket.on('close', () => this.sockets.delete(socket));
        });
        await new Promise<void>((resolve, reject) => {
            this.server!.once('error', reject);
            this.server!.listen(0, '127.0.0.1', () => resolve());
        });
        this.port = (this.server.address() as AddressInfo).port;
    }

    async stop(): Promise<void> {
        if (!this.server) return;
        const server = this.server;
        this.server = null;
        await new Promise<void>((resolve) => {
            server.close(() => resolve());
            // Keep-alive sockets otherwise delay server.close() indefinitely.
            this.sockets.forEach((socket) => socket.destroy());
            this.sockets.clear();
        });
    }

    reset(): void {
        this.requestCount = 0;
        this.activeRequests = 0;
        this.maxActiveRequests = 0;
        this.abortedRequests = 0;
        this.refreshCalls = 0;
        this.refreshSuccessCalls = 0;
        this.loginCalls = 0;
        this.chunkRequests = [];
        this.maxConcurrentUploads = 0;
        this.activeUploads = 0;
        this.flakyFailures.clear();
        this.flakyAttempts.clear();
        this.chunkFailures.clear();
        this.pollCounts.clear();
        this.uploads.clear();
        this.tokenSeq = 0;
        this.accessTokens.clear();
        this.refreshTokens.clear();
        this.alwaysExpireAccess = false;
    }

    // ---------------------------------------------------------------- tokens

    login(): TokenPair {
        this.loginCalls += 1;
        return this.issueTokenPair();
    }

    private issueTokenPair(): TokenPair {
        this.tokenSeq += 1;
        const accessToken = `access-token-${this.tokenSeq}-${randomUUID()}`;
        const refreshToken = `refresh-token-${this.tokenSeq}-${randomUUID()}`;
        const now = Date.now();
        this.accessTokens.set(accessToken, {
            seq: this.tokenSeq,
            expiresAt: now + this.accessTtlMs,
        });
        this.refreshTokens.set(refreshToken, {
            seq: this.tokenSeq,
            expiresAt: now + this.refreshTtlMs,
            used: false,
        });
        return { accessToken, refreshToken, tokenSeq: this.tokenSeq };
    }

    /** Invalidate every access token currently issued. */
    expireAccessTokens(): void {
        this.accessTokens.forEach((record) => {
            record.expiresAt = 0;
        });
    }

    /** Invalidate every refresh token currently issued. */
    expireRefreshTokens(): void {
        this.refreshTokens.forEach((record) => {
            record.expiresAt = 0;
        });
    }

    /** Make GET /protected/resource always answer with the access-expired code. */
    forceAccessTokenExpiry(): void {
        this.alwaysExpireAccess = true;
    }

    private readBearer(req: IncomingMessage): string | null {
        const header = req.headers.authorization;
        if (!header) return null;
        const match = /^Bearer\s+(.+)$/i.exec(header);
        return match ? match[1] : null;
    }

    private isAccessTokenValid(token: string | null): boolean {
        if (!token) return false;
        const record = this.accessTokens.get(token);
        return !!record && record.expiresAt > Date.now();
    }

    // ----------------------------------------------------------------- HTTP

    private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const url = new URL(req.url || '/', this.baseURL);
        const path = url.pathname;

        // CORS keeps the same server usable from jsdom (XHR) as well as Node.
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Headers', '*');
        res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
        res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition');
        if (req.method === 'OPTIONS') {
            res.statusCode = 204;
            res.end();
            return;
        }

        const isStats = path === '/stats';
        if (!isStats) {
            this.requestCount += 1;
            this.activeRequests += 1;
            this.maxActiveRequests = Math.max(this.maxActiveRequests, this.activeRequests);
        }

        let finished = false;
        const release = () => {
            if (finished) return;
            finished = true;
            if (!isStats) this.activeRequests = Math.max(0, this.activeRequests - 1);
        };
        res.on('finish', release);
        res.on('close', () => {
            if (!finished) this.abortedRequests += 1;
            release();
        });

        try {
            await this.route(req, res, url);
        } catch (error) {
            if (!res.headersSent) {
                this.sendJson(res, 500, {
                    code: 'SERVER_ERROR',
                    message: error instanceof Error ? error.message : String(error),
                });
            } else {
                res.end();
            }
        }
    }

    private async route(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
        const path = url.pathname;
        const method = req.method || 'GET';

        if (method === 'GET' && path === '/health') {
            return this.sendJson(res, 200, { ok: true });
        }

        if (method === 'GET' && path === '/stats') {
            return this.sendJson(res, 200, this.stats());
        }

        if (
            ['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].includes(method) &&
            path === '/echo'
        ) {
            const body = await this.readBody(req);
            return this.sendJson(res, 200, {
                code: 0,
                data: {
                    method,
                    path,
                    query: Object.fromEntries(url.searchParams.entries()),
                    body: this.decodeBody(body, req),
                    headers: req.headers,
                },
            });
        }

        if (method === 'GET' && path === '/delay') {
            const ms = this.clampNumber(url.searchParams.get('ms'), 0, 10_000, 100);
            await this.sleep(ms);
            return this.sendJson(res, 200, {
                code: 0,
                data: { delayed: ms, at: Date.now() },
            });
        }

        if (method === 'GET' && path.startsWith('/delay/')) {
            const ms = this.clampNumber(path.slice('/delay/'.length), 0, 10_000, 100);
            await this.sleep(ms);
            return this.sendJson(res, 200, {
                code: 0,
                data: { delayed: ms, at: Date.now() },
            });
        }

        if (method === 'GET' && path === '/status') {
            const status = this.clampNumber(url.searchParams.get('code'), 100, 599, 200);
            return this.sendJson(res, status, {
                code: status === 200 ? 0 : 'HTTP_ERROR',
                status,
            });
        }

        if (method === 'GET' && path.startsWith('/business/')) {
            const code = path.slice('/business/'.length);
            const payload: Record<string, unknown> = {
                code: /^\d+$/.test(code) ? Number(code) : code,
                message: `business code ${code}`,
                data: { echo: code },
            };
            if (url.searchParams.get('async') === '1') {
                await this.sleep(this.clampNumber(url.searchParams.get('delay'), 0, 1000, 0));
            }
            return this.sendJson(res, 200, payload);
        }

        if (method === 'GET' && path === '/flaky') {
            const key = url.searchParams.get('key') || 'default';
            const failures = this.clampNumber(url.searchParams.get('failures'), 0, 100, 0);
            const attempts = (this.flakyAttempts.get(key) || 0) + 1;
            this.flakyAttempts.set(key, attempts);
            if (attempts <= failures) {
                return this.sendJson(res, 503, {
                    code: 'FLAKY',
                    key,
                    attempt: attempts,
                    failures,
                });
            }
            return this.sendJson(res, 200, {
                code: 0,
                data: { key, attempt: attempts, failures },
            });
        }

        if (method === 'GET' && path === '/headers') {
            return this.sendJson(res, 200, { code: 0, data: { headers: req.headers } });
        }

        // ------------------------------------------------------------ auth
        if (method === 'POST' && path === '/auth/login') {
            const pair = this.login();
            return this.sendJson(res, 200, {
                code: 0,
                data: { ...pair, accessExpiresIn: this.accessTtlMs },
            });
        }

        if (method === 'POST' && path === '/auth/refresh') {
            this.refreshCalls += 1;
            const body = await this.readJson(req);
            if (this.refreshDelayMs > 0) await this.sleep(this.refreshDelayMs);
            if (this.failRefresh) {
                return this.sendJson(res, 500, { code: 'REFRESH_FAILED' });
            }

            const refreshToken = typeof body.refreshToken === 'string' ? body.refreshToken : '';
            const record = this.refreshTokens.get(refreshToken);
            if (!record || record.used || record.expiresAt <= Date.now()) {
                return this.sendJson(res, 200, {
                    code: this.refreshExpiredCode,
                    message: 'Refresh token expired',
                });
            }
            // Rotate: a refresh token can only be used once.
            record.used = true;
            const pair = this.issueTokenPair();
            this.refreshSuccessCalls += 1;
            return this.sendJson(res, 200, {
                code: 0,
                data: { ...pair, accessExpiresIn: this.accessTtlMs },
            });
        }

        if (method === 'GET' && path === '/protected/resource') {
            if (req.headers['x-force-refresh-expired']) {
                return this.sendJson(res, 200, {
                    code: this.refreshExpiredCode,
                    message: 'Refresh token expired',
                });
            }
            const token = this.readBearer(req);
            if (!this.alwaysExpireAccess && this.isAccessTokenValid(token)) {
                const record = this.accessTokens.get(token!)!;
                return this.sendJson(res, 200, {
                    code: 0,
                    data: {
                        tokenSeq: record.seq,
                        token,
                        message: 'ok',
                    },
                });
            }
            return this.sendAuthError(res, this.accessExpiredCode);
        }

        // ---------------------------------------------------------- uploads
        if (method === 'POST' && path === '/upload/chunk') {
            return this.handleChunkUpload(req, res);
        }

        if (method === 'GET' && path === '/upload/uploaded') {
            const fileMd5 = url.searchParams.get('fileMd5') || '';
            const state = this.uploads.get(fileMd5);
            return this.sendJson(res, 200, {
                code: 0,
                data: {
                    uploaded: state ? Array.from(state.chunks.keys()).sort((a, b) => a - b) : [],
                },
            });
        }

        if (method === 'POST' && path === '/upload/merge') {
            const body = await this.readJson(req);
            const fileMd5 = typeof body.fileMd5 === 'string' ? body.fileMd5 : '';
            const state = this.uploads.get(fileMd5);
            if (!state) {
                return this.sendJson(res, 404, { code: 'UPLOAD_NOT_FOUND' });
            }
            const missing: number[] = [];
            for (let i = 0; i < state.totalChunks; i += 1) {
                if (!state.chunks.has(i)) missing.push(i);
            }
            if (missing.length) {
                return this.sendJson(res, 409, { code: 'MISSING_CHUNKS', missing });
            }
            const merged = Buffer.concat(
                Array.from({ length: state.totalChunks }, (_, i) => state.chunks.get(i)!),
            );
            state.merged = merged;
            const md5 = createHash('md5').update(merged).digest('hex');
            return this.sendJson(res, 200, {
                code: 0,
                data: {
                    fileMd5,
                    md5,
                    size: merged.length,
                    totalChunks: state.totalChunks,
                },
            });
        }

        if (method === 'GET' && path.startsWith('/upload/file/')) {
            const fileMd5 = path.slice('/upload/file/'.length);
            const state = this.uploads.get(fileMd5);
            if (!state || !state.merged) {
                return this.sendJson(res, 404, { code: 'UPLOAD_NOT_FOUND' });
            }
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', state.merged.length);
            res.end(state.merged);
            return;
        }

        // -------------------------------------------------------- downloads
        if (
            (method === 'GET' || method === 'POST') &&
            (path === '/download/report' || path === '/download/report/')
        ) {
            const mode = url.searchParams.get('mode') || 'plain';
            const body = Buffer.from(url.searchParams.get('content') || 'report-content');
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/plain; charset=utf-8');
            res.setHeader('Content-Length', body.length);
            if (mode === 'plain') {
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="${url.searchParams.get('filename') || 'report.txt'}"`,
                );
            } else if (mode === 'utf8') {
                const name = url.searchParams.get('filename') || '测试报告.txt';
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
                );
            } else if (mode === 'quoted-utf8') {
                const name = url.searchParams.get('filename') || '测试报告.txt';
                res.setHeader(
                    'Content-Disposition',
                    `attachment; filename="fallback.txt"; filename*=UTF-8''${encodeURIComponent(name)}`,
                );
            }
            // mode === 'none' leaves the header out on purpose.
            res.end(body);
            return;
        }

        if ((method === 'GET' || method === 'POST') && path === '/download/bytes') {
            const size = this.clampNumber(url.searchParams.get('size'), 0, 32 * 1024 * 1024, 1024);
            const body = Buffer.alloc(size, 7);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Length', body.length);
            res.setHeader(
                'Content-Disposition',
                `attachment; filename="${url.searchParams.get('filename') || 'payload.bin'}"`,
            );
            res.end(body);
            return;
        }

        // ---------------------------------------------------------- polling
        if (method === 'GET' && path.startsWith('/poll/')) {
            const key = path.slice('/poll/'.length);
            const count = (this.pollCounts.get(key) || 0) + 1;
            this.pollCounts.set(key, count);
            const failUntil = this.clampNumber(url.searchParams.get('failUntil'), 0, 1000, 0);
            if (count <= failUntil) {
                return this.sendJson(res, 500, { code: 'POLL_FAILED', count });
            }
            return this.sendJson(res, 200, {
                code: 0,
                data: { key, count, at: Date.now() },
            });
        }

        // -------------------------------------------------------------- SSE
        if (method === 'GET' && path === '/sse') {
            const events = this.clampNumber(url.searchParams.get('events'), 1, 50, 3);
            const interval = this.clampNumber(url.searchParams.get('interval'), 1, 1000, 10);
            res.statusCode = 200;
            res.setHeader('Content-Type', 'text/event-stream');
            res.setHeader('Cache-Control', 'no-cache');
            res.setHeader('Connection', 'keep-alive');
            res.flushHeaders?.();
            for (let i = 1; i <= events; i += 1) {
                res.write(`data: ${JSON.stringify({ seq: i, total: events })}\n\n`);
                await this.sleep(interval);
            }
            res.write('event: done\ndata: {}\n\n');
            res.end();
            return;
        }

        return this.sendJson(res, 404, { code: 'NOT_FOUND', path, method });
    }

    private sendAuthError(res: ServerResponse, code: number | string): void {
        if (this.authErrorMode === 'http') {
            return this.sendJson(res, 401, { code, message: 'Access token expired' });
        }
        return this.sendJson(res, 200, { code, message: 'Access token expired' });
    }

    // --------------------------------------------------------------- upload

    private async handleChunkUpload(req: IncomingMessage, res: ServerResponse): Promise<void> {
        const body = await this.readBody(req);
        const contentType = req.headers['content-type'] || '';
        const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType);
        if (!boundaryMatch) {
            return this.sendJson(res, 400, { code: 'MISSING_BOUNDARY' });
        }
        const boundary = boundaryMatch[1] || boundaryMatch[2];
        const parts = parseMultipart(body, boundary);

        const filePart = parts.get('file');
        const chunkIndex = Number(parts.get('chunkIndex')?.data.toString() ?? NaN);
        const totalChunks = Number(parts.get('totalChunks')?.data.toString() ?? NaN);
        const fileMd5 = parts.get('fileMd5')?.data.toString();
        const chunkMd5 = parts.get('chunkMd5')?.data.toString();

        if (!filePart || !Number.isFinite(chunkIndex) || !Number.isFinite(totalChunks)) {
            return this.sendJson(res, 400, { code: 'INVALID_CHUNK_FORM' });
        }

        this.activeUploads += 1;
        this.maxConcurrentUploads = Math.max(this.maxConcurrentUploads, this.activeUploads);
        if (this.uploadDelayMs > 0) await this.sleep(this.uploadDelayMs);

        try {
            const remainingFailures = this.chunkFailures.get(chunkIndex) || 0;
            if (remainingFailures > 0) {
                this.chunkFailures.set(chunkIndex, remainingFailures - 1);
                return this.sendJson(res, 500, {
                    code: 'CHUNK_FAILED',
                    chunkIndex,
                    remainingFailures: remainingFailures - 1,
                });
            }

            if (chunkMd5) {
                const actual = createHash('md5').update(filePart.data).digest('hex');
                if (actual !== chunkMd5) {
                    return this.sendJson(res, 400, {
                        code: 'CHUNK_MD5_MISMATCH',
                        expected: chunkMd5,
                        actual,
                    });
                }
            }

            const key = fileMd5 || 'no-file-md5';
            let state = this.uploads.get(key);
            if (!state) {
                state = { chunks: new Map(), totalChunks };
                this.uploads.set(key, state);
            }
            state.totalChunks = totalChunks;
            state.chunks.set(chunkIndex, Buffer.from(filePart.data));

            this.chunkRequests.push({
                chunkIndex,
                totalChunks,
                fileMd5,
                chunkMd5,
                bytes: filePart.data.length,
                at: Date.now(),
            });

            return this.sendJson(res, 200, {
                code: 0,
                data: { chunkIndex, totalChunks, bytes: filePart.data.length },
            });
        } finally {
            this.activeUploads = Math.max(0, this.activeUploads - 1);
        }
    }

    // --------------------------------------------------------------- helpers

    private sendJson(res: ServerResponse, status: number, payload: JsonValue): void {
        if (res.headersSent) {
            res.end();
            return;
        }
        const body = Buffer.from(JSON.stringify(payload));
        res.statusCode = status;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Content-Length', body.length);
        res.end(body);
    }

    private readBody(req: IncomingMessage, limit = 64 * 1024 * 1024): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const chunks: Buffer[] = [];
            let size = 0;
            req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > limit) {
                    reject(new Error(`Request body exceeds ${limit} bytes`));
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });
            req.on('end', () => resolve(Buffer.concat(chunks)));
            req.on('error', reject);
            req.on('aborted', () => reject(new Error('Request aborted')));
        });
    }

    private async readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
        const body = await this.readBody(req);
        if (!body.length) return {};
        try {
            return JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        } catch {
            return {};
        }
    }

    private decodeBody(body: Buffer, req: IncomingMessage): unknown {
        if (!body.length) return null;
        const contentType = req.headers['content-type'] || '';
        if (contentType.includes('application/json')) {
            try {
                return JSON.parse(body.toString('utf8'));
            } catch {
                return body.toString('utf8');
            }
        }
        return body.toString('utf8');
    }

    private clampNumber(
        value: string | null,
        min: number,
        max: number,
        fallback: number,
    ): number {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) return fallback;
        return Math.min(max, Math.max(min, parsed));
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    public stats() {
        return {
            requestCount: this.requestCount,
            activeRequests: this.activeRequests,
            maxActiveRequests: this.maxActiveRequests,
            abortedRequests: this.abortedRequests,
            refreshCalls: this.refreshCalls,
            refreshSuccessCalls: this.refreshSuccessCalls,
            loginCalls: this.loginCalls,
            maxConcurrentUploads: this.maxConcurrentUploads,
            chunkRequests: this.chunkRequests,
            tokenSeq: this.tokenSeq,
        };
    }

    public failNextChunks(chunkIndex: number, times: number): void {
        this.chunkFailures.set(chunkIndex, times);
    }
}

/**
 * Minimal multipart/form-data parser. It is deliberately dependency free so the
 * test harness can run in any Node version.
 */
export function parseMultipart(body: Buffer, boundary: string): Map<string, MultipartPart> {
    const result = new Map<string, MultipartPart>();
    const delimiter = Buffer.from(`--${boundary}`);
    let position = body.indexOf(delimiter);

    while (position !== -1) {
        const next = body.indexOf(delimiter, position + delimiter.length);
        if (next === -1) break;

        let part = body.subarray(position + delimiter.length, next);
        // Strip the CRLF that belongs to the delimiter, not to the content.
        if (part.length >= 2 && part[0] === 13 && part[1] === 10) {
            part = part.subarray(2);
        }
        if (part.length >= 2 && part[part.length - 2] === 13 && part[part.length - 1] === 10) {
            part = part.subarray(0, part.length - 2);
        }

        if (part.length === 0 || part.length === 2) {
            position = next;
            continue;
        }

        const headerEnd = part.indexOf('\r\n\r\n');
        if (headerEnd !== -1) {
            const headerText = part.subarray(0, headerEnd).toString('utf8');
            const data = part.subarray(headerEnd + 4);
            const nameMatch = /name="([^"]*)"/i.exec(headerText);
            const filenameMatch = /filename="([^"]*)"/i.exec(headerText);
            const contentTypeMatch = /content-type:\s*([^\r\n]+)/i.exec(headerText);
            if (nameMatch) {
                result.set(nameMatch[1], {
                    filename: filenameMatch?.[1],
                    contentType: contentTypeMatch?.[1]?.trim(),
                    data,
                });
            }
        }

        position = next;
    }

    return result;
}
