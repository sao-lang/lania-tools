// UploadManager.ts

import axios, { AxiosInstance, CancelTokenSource } from 'axios';
import SparkMD5 from 'spark-md5'; // 用于 calculateChunkMd5
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CHUNK_SIZE } from './const';

export interface UploadFileOptions {
    maxConcurrent?: number; // 字段保留，但实际使用 GlobalConcurrencyController 的限制
    enableResume?: boolean;
    calculateChunkMd5?: boolean;
    getUploadedChunksUrl?: string;
    /** 由 AxiosWrapper 注入的取消令牌，可中断整个上传流程 */
    cancelToken?: CancelTokenSource;
    /** 取消标识；由 AxiosWrapper 通过 CancelTokenManager 管理 */
    cancelTokenId?: string;
    onChunkProgress?: (
        chunkIndex: number,
        totalChunks: number,
        loaded: number,
        total: number,
    ) => void;
    onProgress?: (finishedChunks: number, totalChunks: number) => void;
}

export class UploadManager {
    constructor(
        private instance: AxiosInstance,
        private concurrencyController: GlobalConcurrencyController,
    ) {}

    /**
     * 在 Web Worker 中计算文件的 MD5，避免阻塞主线程。
     *
     * 在没有 Worker 的环境（Node.js / 部分测试环境）中自动退化为
     * 主线程分片计算，保证同一份代码可以在浏览器与服务端运行。
     */
    async calculateFileMd5(file: File, chunkSize: number): Promise<string> {
        if (typeof Worker === 'undefined') {
            return this.calculateFileMd5InMainThread(file, chunkSize);
        }

        return new Promise((resolve, reject) => {
            const worker = new Worker(
                new URL('./md5-calculator.worker.ts', import.meta.url),
                { type: 'module' }, // 通常推荐添加 type: 'module'
            );
            const cleanup = () => worker.terminate();
            worker.onmessage = (e: any) => {
                cleanup();
                if (e.data.error) {
                    reject(new Error(`MD5 Worker Error: ${e.data.error}`));
                } else {
                    resolve(e.data.result);
                }
            };

            worker.onerror = (e: any) => {
                cleanup();
                reject(new Error(`MD5 Worker failed: ${e.message}`));
            };

            worker.postMessage({ file, chunkSize });
        });
    }

    /**
     * 无 Worker 环境下的 MD5 计算：逐片读取，避免一次性把大文件读入内存。
     */
    private async calculateFileMd5InMainThread(file: File, chunkSize: number): Promise<string> {
        const spark = new SparkMD5.ArrayBuffer();
        for (let start = 0; start < file.size; start += chunkSize) {
            const end = Math.min(start + chunkSize, file.size);
            const buffer = await this.readBlobAsArrayBuffer(file.slice(start, end));
            spark.append(buffer);
        }
        return spark.end();
    }

    private readBlobAsArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
        // 现代浏览器与 Node.js 都支持 Blob.arrayBuffer()
        if (typeof blob.arrayBuffer === 'function') {
            return blob.arrayBuffer();
        }
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target!.result as ArrayBuffer);
            reader.onerror = () => reject(reader.error || new Error('Failed to read blob.'));
            reader.readAsArrayBuffer(blob);
        });
    }

    /**
     * 计算单个分块的 MD5（在主线程）。
     */
    async calculateChunkMd5(chunk: Blob): Promise<string> {
        const buffer = await this.readBlobAsArrayBuffer(chunk);
        return SparkMD5.ArrayBuffer.hash(buffer);
    }

    /**
     * 上传单个分块，内置重试逻辑，并受全局并发控制器限制。
     */
    async uploadChunk(
        url: string,
        chunk: Blob,
        chunkIndex: number,
        totalChunks: number,
        cancelToken: CancelTokenSource,
        fileMd5?: string,
        chunkMd5?: string,
        onChunkProgress?: (loaded: number, total: number) => void,
        retryTimes = 3,
        retryDelay = 1000,
    ): Promise<void> {
        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('totalChunks', totalChunks.toString());
        if (fileMd5) formData.append('fileMd5', fileMd5);
        if (chunkMd5) formData.append('chunkMd5', chunkMd5);

        // 重试必须发生在并发控制器的“槽位”之外：
        // 如果重试递归仍在 run() 内部等待下一个 run()，当 maxConcurrent 为 1 时
        // 会形成自己等待自己的死锁。
        let lastError: any;
        for (let attempt = 0; attempt <= retryTimes; attempt += 1) {
            try {
                await this.concurrencyController.run(() =>
                    this.instance.post(url, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        cancelToken: cancelToken.token,
                        onUploadProgress: onChunkProgress
                            ? (e: any) => onChunkProgress(e.loaded, e.total ?? 0)
                            : undefined,
                    }),
                );
                return;
            } catch (error: any) {
                if (axios.isCancel(error)) {
                    throw new Error('Upload canceled by user signal.');
                }
                lastError = error;
                if (attempt < retryTimes) {
                    console.warn(
                        `Chunk ${chunkIndex} failed (Attempt ${attempt + 1}/${retryTimes}). Retrying in ${retryDelay}ms...`,
                    );
                    await new Promise((r) => setTimeout(r, retryDelay));
                }
            }
        }
        // 超过最大重试次数，抛出最后一次的原始错误
        throw lastError;
    }

    /**
     * 调度整个文件的上传任务。
     * 依赖 GlobalConcurrencyController 统一控制所有分块的并发。
     */
    async uploadFile(url: string, file: File, options: UploadFileOptions = {}) {
        const {
            enableResume = false,
            calculateChunkMd5 = false,
            getUploadedChunksUrl,
            onChunkProgress,
            onProgress,
        } = options;

        const chunkSize = CHUNK_SIZE;
        const totalChunks = Math.ceil(file.size / chunkSize);
        // 1. 使用 Web Worker 计算文件 MD5
        const fileMd5 = await this.calculateFileMd5(file, chunkSize);
        const cancelToken = options.cancelToken || axios.CancelToken.source();
        let uploadedChunks = new Set<number>();
        // 2. 断点续传检查
        if (enableResume && getUploadedChunksUrl) {
            const res = await this.instance.get<{ uploaded: number[] }>(
                `${getUploadedChunksUrl}?fileMd5=${fileMd5}`,
                { cancelToken: cancelToken.token },
            );
            uploadedChunks = new Set(res.data.uploaded || []);
        }
        let finishedChunks = uploadedChunks.size;
        // 3. 创建所有分块上传任务 (Promise 数组)
        const uploadPromises = Array.from({ length: totalChunks })
            .map((_, index) => index)
            .filter((i) => !uploadedChunks.has(i))
            .map(async (chunkIndex) => {
                const start = chunkIndex * chunkSize;
                const end = Math.min(file.size, start + chunkSize);
                const chunk = file.slice(start, end);
                const chunkMd5 = calculateChunkMd5
                    ? await this.calculateChunkMd5(chunk)
                    : undefined;
                // 提交任务，它会在 uploadChunk 内部被 GlobalConcurrencyController 调度
                await this.uploadChunk(
                    url,
                    chunk,
                    chunkIndex,
                    totalChunks,
                    cancelToken,
                    fileMd5,
                    chunkMd5,
                    (loaded, total) => onChunkProgress?.(chunkIndex, totalChunks, loaded, total),
                );

                // 任务成功完成
                finishedChunks++;
                onProgress?.(finishedChunks, totalChunks);
            });
        // 4. 统一调度和等待所有任务
        // GlobalConcurrencyController 已经限制了并发数，这里只需等待所有任务完成。
        await Promise.all(uploadPromises);
        // await this.instance.post(`${url}/merge`, { fileMd5, totalChunks });
        return { fileMd5, totalChunks };
    }
}
