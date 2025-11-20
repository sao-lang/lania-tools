import axios, { AxiosInstance, CancelTokenSource } from 'axios';
import SparkMD5 from 'spark-md5';
import { GlobalConcurrencyController } from './GlobalConcurrencyController';

const CHUNK_SIZE = 5 * 1024 * 1024;

export interface UploadFileOptions {
    maxConcurrent?: number;
    enableResume?: boolean;
    calculateChunkMd5?: boolean;
    getUploadedChunksUrl?: string;
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

    async calculateFileMd5(
        file: File,
        chunkSize = CHUNK_SIZE,
    ): Promise<string> {
        return new Promise((resolve) => {
            const chunks = Math.ceil(file.size / chunkSize);
            const spark = new SparkMD5.ArrayBuffer();
            let currentChunk = 0;
            const reader = new FileReader();

            const loadNext = () => {
                const start = currentChunk * chunkSize;
                const end = Math.min(start + chunkSize, file.size);
                reader.readAsArrayBuffer(file.slice(start, end));
            };

            reader.onload = (e) => {
                spark.append(e.target!.result as ArrayBuffer);
                currentChunk++;
                if (currentChunk < chunks) loadNext();
                else resolve(spark.end());
            };

            loadNext();
        });
    }

    async calculateChunkMd5(chunk: Blob): Promise<string> {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) =>
                resolve(
                    SparkMD5.ArrayBuffer.hash(e.target!.result as ArrayBuffer),
                );
            reader.readAsArrayBuffer(chunk);
        });
    }

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
    ) {
        const formData = new FormData();
        formData.append('file', chunk);
        formData.append('chunkIndex', chunkIndex.toString());
        formData.append('totalChunks', totalChunks.toString());
        if (fileMd5) formData.append('fileMd5', fileMd5);
        if (chunkMd5) formData.append('chunkMd5', chunkMd5);

        const upload = async (attempt: number): Promise<void> => {
            try {
                await this.concurrencyController.run(() =>
                    this.instance.post(url, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        cancelToken: cancelToken.token,
                        onUploadProgress: onChunkProgress
                            ? (e: any) =>
                                  onChunkProgress(e.loaded, e.total ?? 0)
                            : undefined,
                    }),
                );
            } catch (error: any) {
                if (axios.isCancel(error)) throw new Error('Request canceled');
                if (attempt < retryTimes) {
                    await new Promise((r) => setTimeout(r, retryDelay));
                    return upload(attempt + 1);
                }
                throw error;
            }
        };
        await upload(0);
    }

    async uploadFile(url: string, file: File, options: UploadFileOptions = {}) {
        const {
            maxConcurrent = 3,
            enableResume = false,
            calculateChunkMd5 = false,
            getUploadedChunksUrl,
            onChunkProgress,
            onProgress,
        } = options;
        const chunkSize = CHUNK_SIZE;
        const totalChunks = Math.ceil(file.size / chunkSize);
        const fileMd5 = await this.calculateFileMd5(file, chunkSize);
        const cancelToken = axios.CancelToken.source();

        // 获取已上传分片（断点续传）
        let uploadedChunks = new Set<number>();
        if (enableResume && getUploadedChunksUrl) {
            const res = await this.instance.get<{ uploaded: number[] }>(
                `${getUploadedChunksUrl}?fileMd5=${fileMd5}`,
            );
            uploadedChunks = new Set(res.data.uploaded || []);
        }

        let finishedChunks = uploadedChunks.size;

        const uploadTasks = Array.from({ length: totalChunks })
            .map((_, index) => index)
            .filter((i) => !uploadedChunks.has(i))
            .map(async (chunkIndex) => {
                const start = chunkIndex * chunkSize;
                const end = Math.min(file.size, start + chunkSize);
                const chunk = file.slice(start, end);

                const chunkMd5 = calculateChunkMd5
                    ? await this.calculateChunkMd5(chunk)
                    : undefined;

                await this.uploadChunk(
                    url,
                    chunk,
                    chunkIndex,
                    totalChunks,
                    cancelToken,
                    fileMd5,
                    chunkMd5,
                    (loaded, total) =>
                        onChunkProgress?.(
                            chunkIndex,
                            totalChunks,
                            loaded,
                            total,
                        ),
                );

                finishedChunks++;
                onProgress?.(finishedChunks, totalChunks);
            });

        // 控制并发上传
        const queue: Promise<void>[] = [];
        for (const task of uploadTasks) {
            const p = this.concurrencyController
                .run(() => task)
                .finally(() => queue.splice(queue.indexOf(p), 1));
            queue.push(p);
            if (queue.length >= maxConcurrent) await Promise.race(queue);
        }
        await Promise.all(queue);

        // 上传完毕，通知服务器合并
        await this.instance.post(`${url}/merge`, { fileMd5, totalChunks });

        return { fileMd5, totalChunks };
    }
}
