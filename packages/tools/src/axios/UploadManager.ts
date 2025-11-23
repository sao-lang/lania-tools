// UploadManager.ts

import axios, { AxiosInstance, CancelTokenSource } from 'axios';
import SparkMD5 from 'spark-md5'; // 用于 calculateChunkMd5
import { GlobalConcurrencyController } from './GlobalConcurrencyController';
import { CHUNK_SIZE } from './const';

// ⚠️ Webpack/Vite 导入 Web Worker 的推荐方式
// 必须确保您的构建工具正确配置了 worker loader
import Md5CalculatorWorker from './md5-calculator.worker?worker'; 

export interface UploadFileOptions {
    maxConcurrent?: number; // 字段保留，但实际使用 GlobalConcurrencyController 的限制
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

    /**
     * 在 Web Worker 中计算文件的 MD5，避免阻塞主线程。
     */
    async calculateFileMd5(file: File, chunkSize: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const worker = new Md5CalculatorWorker();

            const cleanup = () => worker.terminate();

            worker.onmessage = (e) => {
                cleanup();
                if (e.data.error) {
                    reject(new Error(`MD5 Worker Error: ${e.data.error}`));
                } else {
                    resolve(e.data.result);
                }
            };

            worker.onerror = (e) => {
                cleanup();
                reject(new Error(`MD5 Worker failed: ${e.message}`));
            };

            worker.postMessage({ file, chunkSize });
        });
    }

    /**
     * 计算单个分块的 MD5（在主线程）。
     */
    async calculateChunkMd5(chunk: Blob): Promise<string> {
        return new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = (e) =>
                resolve(SparkMD5.ArrayBuffer.hash(e.target!.result as ArrayBuffer));
            reader.readAsArrayBuffer(chunk);
        });
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

        // 使用递归函数实现重试
        const uploadWithRetry = async (attempt: number): Promise<void> => {
            // 将实际的 HTTP 请求提交给全局并发控制器
            return this.concurrencyController.run(async () => {
                try {
                    await this.instance.post(url, formData, {
                        headers: { 'Content-Type': 'multipart/form-data' },
                        cancelToken: cancelToken.token,
                        onUploadProgress: onChunkProgress
                            ? (e: any) => onChunkProgress(e.loaded, e.total ?? 0)
                            : undefined,
                    });
                } catch (error: any) {
                    if (axios.isCancel(error)) {
                        throw new Error('Upload canceled by user signal.');
                    }
                    
                    if (attempt < retryTimes) {
                        console.warn(`Chunk ${chunkIndex} failed (Attempt ${attempt + 1}/${retryTimes}). Retrying in ${retryDelay}ms...`);
                        
                        await new Promise((r) => setTimeout(r, retryDelay));
                        
                        // 递归调用下一轮上传
                        return uploadWithRetry(attempt + 1); 
                    }
                    // 超过最大重试次数，抛出原始错误
                    throw error;
                }
            });
        };
        
        await uploadWithRetry(0);
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
        
        const cancelToken = axios.CancelToken.source();
        let uploadedChunks = new Set<number>();

        // 2. 断点续传检查
        if (enableResume && getUploadedChunksUrl) {
            const res = await this.instance.get<{ uploaded: number[] }>(
                `${getUploadedChunksUrl}?fileMd5=${fileMd5}`,
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
                resolve(SparkMD5.ArrayBuffer.hash(e.target!.result as ArrayBuffer));
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
                            ? (e: any) => onChunkProgress(e.loaded, e.total ?? 0)
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
                    (loaded, total) => onChunkProgress?.(chunkIndex, totalChunks, loaded, total),
                );

                finishedChunks++;
                onProgress?.(finishedChunks, totalChunks);
            });
        const queue: Promise<void>[] = [];
        for (const task of uploadTasks) {
            const p = this.concurrencyController
                .run(() => task)
                .finally(() => queue.splice(queue.indexOf(p), 1));
            queue.push(p);
            if (queue.length >= maxConcurrent) await Promise.race(queue);
        }
        await Promise.all(queue);
        // await this.instance.post(`${url}/merge`, { fileMd5, totalChunks });
        return { fileMd5, totalChunks };
    }
}

