import { defineConfig } from 'vitepress';

export default defineConfig({
    lang: 'zh-CN',
    title: '@lania-tools/tools',
    description: '前端工具函数库与 AxiosWrapper 增强请求库：完整原理、API 参考与实战示例',
    cleanUrls: true,
    lastUpdated: true,

    head: [['link', { rel: 'icon', type: 'image/svg+xml', href: '/logo.svg' }]],

    themeConfig: {
        logo: '/logo.svg',

        nav: [
            { text: '指南', link: '/guide/getting-started' },
            { text: '工具模块', link: '/tools/event-bus' },
            { text: 'AxiosWrapper', link: '/axios/' },
            { text: '测试', link: '/guide/testing' },
        ],

        sidebar: {
            '/guide/': [
                {
                    text: '入门',
                    items: [
                        { text: '快速上手', link: '/guide/getting-started' },
                        { text: '从零搭建一个完整模块', link: '/guide/tutorial' },
                        { text: '整体架构', link: '/guide/architecture' },
                        { text: 'TypeScript 类型指南', link: '/guide/typescript' },
                    ],
                },
                {
                    text: '实践',
                    items: [
                        { text: '常见场景 Recipes', link: '/guide/recipes' },
                        { text: '速查表', link: '/guide/cheatsheet' },
                        { text: '测试与质量保障', link: '/guide/testing' },
                        { text: '常见问题 FAQ', link: '/guide/faq' },
                    ],
                },
            ],
            '/tools/': [
                {
                    text: '通用工具',
                    items: [
                        { text: '事件总线 EventBus', link: '/tools/event-bus' },
                        { text: '状态管理 Store', link: '/tools/store' },
                        { text: '函数与对象工具', link: '/tools/utils' },
                        { text: '类型判断', link: '/tools/type' },
                        { text: '表单校验 Validator', link: '/tools/validator' },
                        { text: '时间格式化', link: '/tools/format-time' },
                        { text: '日志 Logger', link: '/tools/logger' },
                    ],
                },
                {
                    text: '浏览器能力',
                    items: [
                        { text: '本地存储', link: '/tools/web-storage-helper' },
                        { text: 'SSE 客户端', link: '/tools/sse-client' },
                        { text: 'WebSocket 客户端', link: '/tools/websocket-client' },
                        { text: '中文批量转换', link: '/tools/convert-chinese-text' },
                    ],
                },
                {
                    text: 'UI 能力',
                    items: [
                        { text: '轮播 Carousel', link: '/tools/carousel' },
                        { text: '拖拽 Draggable', link: '/tools/draggable' },
                        { text: '虚拟滚动', link: '/tools/virtual-scroller' },
                    ],
                },
            ],
            '/axios/': [
                {
                    text: 'AxiosWrapper',
                    items: [
                        { text: '架构与请求生命周期', link: '/axios/' },
                        { text: '完整 API 参考', link: '/axios/api' },
                    ],
                },
                {
                    text: '能力详解',
                    items: [
                        { text: '拦截器管道', link: '/axios/interceptors' },
                        { text: '并发控制', link: '/axios/concurrency' },
                        { text: '缓存', link: '/axios/cache' },
                        { text: '防抖与节流', link: '/axios/debounce-throttle' },
                        { text: '重试与取消', link: '/axios/retry-and-cancel' },
                        { text: '双 Token 刷新', link: '/axios/double-token' },
                        { text: '轮询', link: '/axios/polling' },
                        { text: '大文件分片上传', link: '/axios/upload' },
                        { text: '文件下载', link: '/axios/download' },
                    ],
                },
                {
                    text: '运行与排错',
                    items: [{ text: '错误处理与排错', link: '/axios/errors' }],
                },
            ],
        },

        search: {
            provider: 'local',
        },

        outline: {
            level: [2, 3],
            label: '本页目录',
        },

        docFooter: {
            prev: '上一页',
            next: '下一页',
        },

        lastUpdated: {
            text: '最后更新',
            formatOptions: { dateStyle: 'short', timeStyle: 'short' },
        },

        socialLinks: [{ icon: 'github', link: 'https://github.com/sao-lang/lania-tools' }],

        footer: {
            message: '基于 MIT 许可发布',
            copyright: 'Copyright © lania-tools',
        },
    },

    markdown: {
        lineNumbers: true,
    },
});
