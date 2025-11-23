// md5-calculator.worker.ts

// 假设 SparkMD5 已通过打包工具（如 Webpack/Vite）或 importScripts 在 Worker 环境中可用
import SparkMD5 from 'spark-md5';

self.onmessage = function(e: MessageEvent) {
    const { file, chunkSize } = e.data;
    
    try {
        const spark = new SparkMD5.ArrayBuffer();
        const reader = new FileReader();
        const chunks = Math.ceil(file.size / chunkSize);
        let currentChunk = 0;

        const loadNext = () => {
            const start = currentChunk * chunkSize;
            const end = Math.min(start + chunkSize, file.size);
            reader.readAsArrayBuffer(file.slice(start, end));
        };

        reader.onload = (event) => {
            spark.append(event.target!.result as ArrayBuffer);
            currentChunk++;
            if (currentChunk < chunks) {
                loadNext();
            } else {
                self.postMessage({ result: spark.end() });
            }
        };
        
        reader.onerror = () => {
            self.postMessage({ error: 'FileReader failed to read chunk.' });
        };
        
        loadNext();

    } catch (error: any) {
        self.postMessage({ error: error.message || 'Worker execution failed.' });
    }
};
