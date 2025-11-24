declare module '*?worker' {
    // 定义 Worker 构造函数的类型
    class WebpackWorker extends Worker {
        constructor();
    }
    // 导出这个 Worker 类
    export default WebpackWorker;
}
