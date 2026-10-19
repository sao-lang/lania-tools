// @vitest-environment node
import axios from 'axios';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { AxiosWrapper } from '../../src/axios';
import { TestServer } from '../server/test-server';

interface TokenStore {
    access: string;
    refresh: string;
}

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

/**
 * Builds a wrapper whose tokens live in a mutable store, mirroring a real app
 * that keeps tokens in memory / storage.
 */
function createTokenWrapper(
    server: TestServer,
    store: TokenStore,
    overrides: Record<string, any> = {},
) {
    const refreshAccessToken = vi.fn(async (refreshToken: string) => {
        const response = await axios.post(`${server.baseURL}/auth/refresh`, { refreshToken });
        if (response.data.code !== 0) {
            throw new Error(`refresh failed with code ${response.data.code}`);
        }
        store.access = response.data.data.accessToken;
        store.refresh = response.data.data.refreshToken;
        return store.access;
    });

    const wrapper = new AxiosWrapper(
        { baseURL: server.baseURL, adapter: 'http', timeout: 5000 },
        {
            enableDoubleToken: true,
            accessTokenExpiredCodes: [server.accessExpiredCode],
            refreshTokenExpiredCodes: [server.refreshExpiredCode],
            tokenProvider: () => store.access,
            getRefreshToken: () => store.refresh,
            refreshAccessToken,
            ...overrides,
        },
    );

    return { wrapper, refreshAccessToken };
}

describe('AxiosWrapper double token refresh', () => {
    let server: TestServer;
    let store: TokenStore;

    beforeAll(async () => {
        server = await startServer();
    });

    afterEach(() => {
        server.reset();
        server.refreshDelayMs = 0;
        server.failRefresh = false;
        vi.restoreAllMocks();
    });

    function loginIntoStore() {
        const pair = server.login();
        store = { access: pair.accessToken, refresh: pair.refreshToken };
        return pair;
    }

    it('refreshes the access token and replays the original request', async () => {
        const pair = loginIntoStore();
        const { wrapper, refreshAccessToken } = createTokenWrapper(server, store);

        const first = await wrapper.get('/protected/resource');
        expect(first.data.code).toBe(0);
        expect(first.data.data.tokenSeq).toBe(pair.tokenSeq);

        server.expireAccessTokens();

        const refreshed = await wrapper.get('/protected/resource');
        expect(refreshed.data.code).toBe(0);
        expect(refreshed.data.data.tokenSeq).toBe(pair.tokenSeq + 1);
        expect(refreshed.data.data.token).toBe(store.access);
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        expect(refreshAccessToken).toHaveBeenCalledWith(pair.refreshToken);
        expect(server.refreshCalls).toBe(1);
        expect(server.refreshSuccessCalls).toBe(1);
        expect(store.refresh).not.toBe(pair.refreshToken);
    });

    it('refreshes only once for concurrent expired requests', async () => {
        loginIntoStore();
        const { wrapper } = createTokenWrapper(server, store);
        server.expireAccessTokens();
        server.refreshDelayMs = 80;

        const responses = await Promise.all(
            Array.from({ length: 5 }, () => wrapper.get('/protected/resource')),
        );

        expect(responses).toHaveLength(5);
        responses.forEach((response) => {
            expect(response.data.code).toBe(0);
            expect(response.data.data.tokenSeq).toBe(2);
        });
        // The single-flight promise must collapse five concurrent refreshes into one.
        expect(server.refreshCalls).toBe(1);
        expect(server.refreshSuccessCalls).toBe(1);
        expect(new Set(responses.map((r) => r.data.data.token)).size).toBe(1);
    });

    it('rotates the refresh token so the old one cannot be reused', async () => {
        const pair = loginIntoStore();
        const { wrapper } = createTokenWrapper(server, store);
        server.expireAccessTokens();
        await wrapper.get('/protected/resource');

        expect(server.refreshTokens.get(pair.refreshToken)?.used).toBe(true);

        const reuse = await axios.post(`${server.baseURL}/auth/refresh`, {
            refreshToken: pair.refreshToken,
        });
        expect(reuse.data.code).toBe(server.refreshExpiredCode);
        expect(server.refreshSuccessCalls).toBe(1);
    });

    it('a second refresh cycle works after the first one completes', async () => {
        loginIntoStore();
        const { wrapper } = createTokenWrapper(server, store);

        server.expireAccessTokens();
        const second = await wrapper.get('/protected/resource');
        expect(second.data.data.tokenSeq).toBe(2);

        server.expireAccessTokens();
        const third = await wrapper.get('/protected/resource');
        expect(third.data.data.tokenSeq).toBe(3);
        expect(server.refreshCalls).toBe(2);
    });

    it('logs out when the refresh token itself is expired', async () => {
        loginIntoStore();
        const onRefreshTokenExpired = vi.fn();
        const { wrapper } = createTokenWrapper(server, store, { onRefreshTokenExpired });

        // The server answers with the refresh-expired business code.
        await expect(
            wrapper.get('/protected/resource', undefined, {
                headers: { 'x-force-refresh-expired': '1' },
            }),
        ).rejects.toThrow('Refresh token expired');

        expect(onRefreshTokenExpired).toHaveBeenCalledTimes(1);
        expect(server.refreshCalls).toBe(0);
    });

    it('logs out when the refresh endpoint rejects the refresh token', async () => {
        loginIntoStore();
        const onRefreshTokenExpired = vi.fn();
        const onError = vi.fn();
        const { wrapper } = createTokenWrapper(server, store, {
            onRefreshTokenExpired,
            onError,
        });

        server.expireAccessTokens();
        server.expireRefreshTokens();
        server.failRefresh = true;

        await expect(wrapper.get('/protected/resource')).rejects.toThrow(
            'Request failed with status code 500',
        );
        expect(server.refreshCalls).toBe(1);
        expect(onRefreshTokenExpired).toHaveBeenCalledTimes(1);
        expect(onError).toHaveBeenCalledTimes(1);
    });

    it('notifies onRefreshTokenExpired only once for concurrent refresh failures', async () => {
        loginIntoStore();
        const onRefreshTokenExpired = vi.fn();
        const { wrapper } = createTokenWrapper(server, store, { onRefreshTokenExpired });

        server.expireAccessTokens();
        server.failRefresh = true;
        server.refreshDelayMs = 60;

        const results = await Promise.allSettled(
            Array.from({ length: 4 }, () => wrapper.get('/protected/resource')),
        );

        expect(results.every((result) => result.status === 'rejected')).toBe(true);
        expect(server.refreshCalls).toBe(1);
        expect(onRefreshTokenExpired).toHaveBeenCalledTimes(1);
    });

    it('rejects when getRefreshToken returns nothing', async () => {
        loginIntoStore();
        const onRefreshTokenExpired = vi.fn();
        const { wrapper, refreshAccessToken } = createTokenWrapper(server, store, {
            getRefreshToken: () => '',
            onRefreshTokenExpired,
        });

        server.expireAccessTokens();
        await expect(wrapper.get('/protected/resource')).rejects.toThrow('Missing refresh token.');
        expect(refreshAccessToken).not.toHaveBeenCalled();
        expect(server.refreshCalls).toBe(0);
        expect(onRefreshTokenExpired).toHaveBeenCalledTimes(1);
    });

    it('rejects when no refreshAccessToken is configured', async () => {
        loginIntoStore();
        const { wrapper } = createTokenWrapper(server, store, { refreshAccessToken: undefined });
        server.expireAccessTokens();
        await expect(wrapper.get('/protected/resource')).rejects.toThrow(
            'No refreshAccessToken provided',
        );
        expect(server.refreshCalls).toBe(0);
    });

    it('rejects when refreshAccessToken returns an invalid token', async () => {
        loginIntoStore();
        const onRefreshTokenExpired = vi.fn();
        const { wrapper } = createTokenWrapper(server, store, {
            refreshAccessToken: () => '',
            onRefreshTokenExpired,
        });
        server.expireAccessTokens();
        await expect(wrapper.get('/protected/resource')).rejects.toThrow(
            'Invalid new access token.',
        );
        expect(onRefreshTokenExpired).toHaveBeenCalledTimes(1);
    });

    it('does not loop forever when the retried request is still expired', async () => {
        loginIntoStore();
        const { wrapper } = createTokenWrapper(server, store);
        server.forceAccessTokenExpiry();

        await expect(wrapper.get('/protected/resource')).rejects.toThrow(
            'Request already retried after refresh',
        );
        expect(server.refreshCalls).toBe(1);
    });

    it('keeps using the refreshed token even if tokenProvider still returns the stale one', async () => {
        const pair = loginIntoStore();
        const staleToken = pair.accessToken;
        const { wrapper } = createTokenWrapper(server, store, {
            // A common real-world bug: the provider closes over an outdated value.
            tokenProvider: () => staleToken,
        });
        server.expireAccessTokens();

        const response = await wrapper.get('/protected/resource');
        expect(response.data.code).toBe(0);
        expect(response.data.data.tokenSeq).toBe(pair.tokenSeq + 1);
    });

    it('does nothing when enableDoubleToken is false', async () => {
        loginIntoStore();
        const onRefreshTokenExpired = vi.fn();
        const { wrapper } = createTokenWrapper(server, store, {
            enableDoubleToken: false,
            onRefreshTokenExpired,
        });
        server.expireAccessTokens();

        const response = await wrapper.get('/protected/resource');
        expect(response.data.code).toBe(server.accessExpiredCode);
        expect(server.refreshCalls).toBe(0);
        expect(onRefreshTokenExpired).not.toHaveBeenCalled();
    });

    it('does not react to unrelated business codes', async () => {
        loginIntoStore();
        const { wrapper } = createTokenWrapper(server, store);
        const response = await wrapper.get('/business/50001');
        expect(response.data.code).toBe(50001);
        expect(server.refreshCalls).toBe(0);
    });
});

describe('AxiosWrapper double token with HTTP 401 auth errors', () => {
    let server: TestServer;

    beforeAll(async () => {
        server = await startServer({ authErrorMode: 'http' });
    });

    afterEach(() => {
        server.reset();
    });

    it('surfaces HTTP 401 without triggering a refresh (business-code only feature)', async () => {
        const pair = server.login();
        const store = { access: pair.accessToken, refresh: pair.refreshToken };
        const { wrapper } = createTokenWrapper(server, store);

        server.expireAccessTokens();
        await expect(wrapper.get('/protected/resource')).rejects.toMatchObject({
            response: { status: 401 },
        });
        expect(server.refreshCalls).toBe(0);
    });
});
