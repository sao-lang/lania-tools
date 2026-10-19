// @vitest-environment jsdom
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AxiosWrapper } from '../../src/axios';
import { TestServer } from '../server/test-server';

const servers: TestServer[] = [];

async function startServer() {
    const server = new TestServer();
    await server.start();
    servers.push(server);
    return server;
}

afterAll(async () => {
    await Promise.all(servers.map((server) => server.stop()));
});

interface DownloadRecord {
    filename: string;
    href: string;
}

describe('AxiosWrapper.downloadFile against a real server', () => {
    let server: TestServer;
    let wrapper: AxiosWrapper;
    let downloads: DownloadRecord[];
    let createObjectURL: any;
    let revokeObjectURL: any;
    let clickSpy: any;

    beforeAll(async () => {
        server = await startServer();
    });

    beforeEach(() => {
        downloads = [];
        wrapper = new AxiosWrapper(
            { baseURL: server.baseURL, timeout: 5000 },
            { maxConcurrent: 2 },
        );

        createObjectURL = vi.fn(() => 'blob:mock-url');
        revokeObjectURL = vi.fn();
        Object.defineProperty(URL, 'createObjectURL', { value: createObjectURL, writable: true });
        Object.defineProperty(URL, 'revokeObjectURL', { value: revokeObjectURL, writable: true });

        clickSpy = vi
            .spyOn(HTMLAnchorElement.prototype, 'click')
            .mockImplementation(function (this: HTMLAnchorElement) {
                downloads.push({ filename: this.download, href: this.href });
            });
    });

    afterEach(() => {
        vi.restoreAllMocks();
        clickSpy?.mockRestore();
        server.reset();
        document.body.innerHTML = '';
    });

    it('downloads a blob and uses the explicit filename', async () => {
        const response = await wrapper.downloadFile('/download/report', 'get', 'custom.txt');

        expect(response.data).toBeInstanceOf(Blob);
        expect(downloads).toHaveLength(1);
        expect(downloads[0].filename).toBe('custom.txt');
        expect(downloads[0].href).toBe('blob:mock-url');
        expect(createObjectURL).toHaveBeenCalledWith(response.data);
        expect(clickSpy).toHaveBeenCalledTimes(1);
    });

    it('parses an ASCII filename from Content-Disposition', async () => {
        await wrapper.downloadFile('/download/report?filename=report.txt');
        expect(downloads[0].filename).toBe('report.txt');
    });

    it('prefers the RFC 5987 filename* value', async () => {
        await wrapper.downloadFile('/download/report?mode=utf8&filename=测试报告.txt');
        expect(downloads[0].filename).toBe('测试报告.txt');
    });

    it('prefers filename* even when a plain filename comes first', async () => {
        await wrapper.downloadFile('/download/report?mode=quoted-utf8&filename=测试报告.txt');
        expect(downloads[0].filename).toBe('测试报告.txt');
    });

    it('falls back to the last url segment when no header is present', async () => {
        await wrapper.downloadFile('/download/report?mode=none');
        expect(downloads[0].filename).toBe('report');
    });

    it('falls back to download_file when the url has no useful segment', async () => {
        await wrapper.downloadFile('/download/report/?mode=none');
        expect(downloads[0].filename).toBe('download_file');
    });

    it('supports POST downloads', async () => {
        const response = await wrapper.downloadFile('/download/bytes?size=64', 'post', 'p.bin');
        expect(response.status).toBe(200);
        expect(downloads[0].filename).toBe('p.bin');
    });

    it('removes the anchor and revokes the object url after a short delay', async () => {
        await wrapper.downloadFile('/download/report');
        expect(document.querySelectorAll('a')).toHaveLength(1);
        await new Promise((resolve) => setTimeout(resolve, 150));
        expect(document.querySelectorAll('a')).toHaveLength(0);
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
    });

    it('cleans up the cancel token registration after success', async () => {
        const manager = (wrapper as any).cancelTokenManager;
        await wrapper.downloadFile('/download/report', 'get', undefined, {
            cancelTokenId: 'download-1',
        });
        expect(manager.has('download-1')).toBe(false);
    });

    it('cleans up the cancel token registration after failure', async () => {
        const manager = (wrapper as any).cancelTokenManager;
        await expect(
            wrapper.downloadFile('/status?code=500', 'get', undefined, {
                cancelTokenId: 'download-2',
            }),
        ).rejects.toBeTruthy();
        expect(manager.has('download-2')).toBe(false);
    });

    it('does not trigger a download when the request fails', async () => {
        await expect(wrapper.downloadFile('/status?code=500')).rejects.toBeTruthy();
        expect(clickSpy).not.toHaveBeenCalled();
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    it('can be cancelled through cancelTokenId', async () => {
        const pending = wrapper.downloadFile('/delay/500', 'get', undefined, {
            cancelTokenId: 'download-cancel',
        });
        await new Promise((resolve) => setTimeout(resolve, 30));
        wrapper.cancelRequest('download-cancel');

        const error = await pending.catch((err) => err);
        expect(error).toBeTruthy();
        expect(clickSpy).not.toHaveBeenCalled();
        expect((wrapper as any).cancelTokenManager.has('download-cancel')).toBe(false);
    });
});
