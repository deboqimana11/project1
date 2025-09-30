使用说明

执行顺序：优先做「状态：Ready」且依赖已满足的任务。

并行建议：标注 ⇔ 的任务可与同层其他任务并行。

接口稳定性：带 🔒 的任务是接口契约，完成后尽量不要改。

0. 仓库与脚手架

T00（Ready）仓库初始化与 workspace

目的：建立 Rust/Tauri/前端 workspace 基础。

步骤：

cargo new --vcs git 建立 workspace：/core（Rust lib）、/app（Tauri shell + front-end）、/ui（前端）

配置 Tauri（Rust stable），pnpm 初始化前端

添加 justfile/Makefile：dev, build, lint

产出：仓库结构、基础依赖文件

验收：pnpm tauri dev 可启动空白窗口

依赖：无

T01（Ready）CI 本地脚本（可选）⇔

目的：本地质量一致性

步骤：pre-commit（rustfmt/clippy/eslint）

产出：配置文件

验收：just lint 通过

依赖：T00

1. UI 基座（Design Tokens + Tailwind + shadcn）

T10（Ready，🔒）接入 Design Tokens 与 Tailwind 扩展

目的：引入 OKLCH 主题变量、半径、阴影、模糊、动效时序

步骤：

将文档中的 :root / .dark CSS 变量写入 globals.css

根据文档添加 tailwind.config 扩展（colors、radius、shadow、easing、duration、backdropBlur）

产出：globals.css、tailwind.config.ts

验收：Demo 页显示 token 色板；暗/亮主题切换正常

依赖：T00

T11（Ready）接入 shadcn/ui 与 Radix

目的：统一组件风格

步骤：安装、初始化、导入 Button/Input/Sheet/Command/Toast 基础组件

产出：components/ui/*

验收：示例页面能展示基础组件

依赖：T10

2. Tauri 壳与自定义协议

T20（Ready，🔒）自定义协议 app://img/{key}

目的：用 流式 URL 替代跨 IPC 像素传输

步骤：

在 Tauri 注册 app 协议处理器

将 key 映射到磁盘缓存文件或内存 Reader

产出：协议注册代码、处理函数

验收：前端 fetch('app://img/demo') 能拿到数据（先返回占位 PNG）

依赖：T00

T21（Ready，🔒）Tauri 命令骨架

目的：建立 IPC 契约

步骤：实现空壳命令：open_path, list_pages, get_page_url, get_thumb_url, prefetch, cancel, save_progress, query_progress, stats

产出：Rust tauri::command 签名与前端 TS 包装

验收：前端能调用并获得模拟数据

依赖：T20

3. Rust Core：类型与模块框架

T30（Ready，🔒）核心类型与模块目录

目的：固定核心数据模型

步骤：添加 types.rs（PageId/Source/PageMeta/FitMode/RenderParams 等）、建 fs/ codec/ pipeline/ cache/ meta/ store/ keymap/ 目录

产出：编译通过的空实现

验收：cargo check 通过

依赖：T21

4. 文件系统与归档（MVP：文件夹 + ZIP/CBZ）

T40（Ready）目录读取与自然排序

目的：支持打开文件夹为漫画源

步骤：扫描图像文件，数字感知排序，过滤非图

产出：fs::folder 模块

验收：list_pages 返回正确页序与简单元数据

依赖：T30

T41（Ready）ZIP/CBZ 读取

目的：常见漫画压缩包

步骤：zip crate 打开、条目枚举、延迟读取

产出：fs::zip 模块

验收：CBZ 可列页

依赖：T40

T42（可选）外部 7z/RAR 后备

目的：覆盖 7z/CB7/CBR

步骤：命令行 7z/unrar 调用与错误提示

产出：fs::external

验收：工具缺失时有友好降级提示

依赖：T41

5. 解码与色彩

T50（Ready）JPG/PNG/WebP/GIF 解码

目的：MVP 图像支持

步骤：image + image-webp；GIF 取首帧

产出：codec::*

验收：返回 RGBA + 尺寸

依赖：T41

T51（Ready）EXIF 方向归一化 + ICC→sRGB

目的：显示一致性

步骤：解析 EXIF，统一旋转；读 ICC 无则默认 sRGB

产出：转换工具函数

验收：带旋转/ICC 的样本显示正确

依赖：T50

T52（可选）AVIF 解码（libavif）

目的：高压缩比格式

步骤：libavif-sys 绑定，缺库自动禁用并提示一次

产出：AVIF 分支

验收：能打开 AVIF，禁用路径稳定

依赖：T51

6. 缩放、mip 金字塔与磁盘缓存

T60（Ready）高质量缩放（fast_image_resize）

目的：Lanczos/Catmull-Rom 缩放

步骤：封装缩放 API，SIMD 开启

产出：pipeline::resize

验收：对比像素尺寸与质量

依赖：T51

T61（Ready）mip 金字塔生成

目的：减少重复缩放开销

步骤：生成 1/2、1/4、1/8… 到最小

产出：金字塔缓存策略与键

验收：重复缩放时命中率提升

依赖：T60

T62（Ready）磁盘缓存（位图/缩略图）

目的：跨会话加速

步骤：key = 文件哈希 + 渲染参数哈希；分片目录

产出：cache::disk

验收：重复打开命中缓存

依赖：T61

T63（Ready）超长纵图切片（tile）

目的：webtoon 性能

步骤：对高宽比>4:1 的图垂直切片并缓存

产出：tile 读取 API

验收：长图滚动内存占用明显降低

依赖：T62

7. 预读与调度（可取消）

T70（Ready，🔒）预读策略与优先级

目的：基于视口与速度预测

步骤：Δ页距离 + 滚动速度加权，任务队列

产出：pipeline::scheduler

验收：快速翻页卡顿显著减小

依赖：T63

T71（Ready）取消机制（token）

目的：避免浪费计算

步骤：为每个任务分配 token，视口变化取消过时项

产出：cancel(RequestToken)

验收：连续跳页 CPU 占用平稳

依赖：T70

8. IPC 实装与协议出图

T80（Ready，🔒）get_page_url / get_thumb_url

目的：用 URL 提供流式图像

步骤：将渲染结果写入缓存并返回 app://img/{key}

产出：命令实现

验收：前端 <img src>/createImageBitmap(fetch(url)) 正常

依赖：T62

T81（Ready）进度与状态

目的：阅读进度与设置

步骤：SQLite 或 JSON；save_progress/query_progress/stats

产出：store::*

验收：重启恢复到上次页

依赖：T80

9. 前端渲染引擎

T90（Ready）Canvas + ImageBitmap 基线

目的：MVP 渲染

步骤：URL → fetch → ImageBitmap → drawImage；滚轮缩放/拖拽

产出：<ReaderCanvas>

验收：1080p/4K 单页流畅

依赖：T80

T91（Ready）OffscreenCanvas + Worker

目的：主线程 UI 60fps

步骤：检测支持则将绘制迁入 Worker；主线程仅事件

产出：/workers/renderer.ts

验收：高速滚动仍流畅

依赖：T90

T92（可选）PixiJS/WebGL 增强

目的：巨图/动效优化

步骤：纹理 LRU（VRAM 预算 256–512MB）、惯性、边界回弹

产出：useWebGLRenderer()

验收：8K 大图缩放不卡顿

依赖：T91

10. Sleek & Elegant UI 组件

T100（Ready）Toolbar（E1）

目的：核心控制条（返回/模式/缩放/单双页/适配）

步骤：按规范类名与交互（hover/focus/active）

产出：<Toolbar>

验收：键鼠体验顺滑、对齐规范

依赖：T10, T90

T101（Ready）ThumbSidebar（E1，虚拟化）

目的：缩略图与快速跳转

步骤：虚拟列表 + 当前页高亮 + 右键菜单

产出：<ThumbSidebar>

验收：2000+ 页列表操作顺畅

依赖：T80, T90

T102（Ready）ReaderOverlay（E2，自动显隐）

目的：沉浸式浮层控制条

步骤：Framer Motion，3 秒无操作淡出；边缘感应显隐

产出：<ReaderOverlay>

验收：无抖动、动画 ≤180ms

依赖：T90

T103（Ready）CommandPalette（E3）

目的：Cmd/Ctrl+K 快速跳页/切换模式

步骤：shadcn Command 组件 + 模糊检索

产出：<CommandPalette>

验收：模糊匹配准确、键盘可达

依赖：T11, T81

T104（Ready）SettingsSheet（E2）

目的：预读 K、缓存上限、主题密度、阅读方向

步骤：Sheet + 表单验证（zod）

产出：<SettingsSheet>

验收：修改即时生效并持久化

依赖：T81

T105（Ready）Toast/提示

目的：统一提示与错误呈现

步骤：shadcn Toast，E2 风格

产出：useToast、<Toaster>

验收：信息层级清晰

依赖：T11

11. 阅读模式与交互

T110（Ready）适配/缩放模式

目的：适宽/适高/填满/原始 + 旋转

步骤：状态机 + 缩放算法选择

产出：viewModel.fitMode

验收：切换零闪烁

依赖：T90

T111（Ready）单双页/连续模式 + R→L

目的：漫画常用模式

步骤：分页/跨页拼合、滚动容器布局、方向反转

产出：模式切换逻辑

验收：模式间切换流畅

依赖：T110

T112（Ready）键鼠映射与自定义

目的：高效操作

步骤：默认快捷键 + 可配置映射（持久化）

产出：keymap

验收：冲突检测、导入/导出

依赖：T104

12. 元数据与书架（MVP 可延后）

T120（可选）ComicInfo.xml 解析

目的：标题/卷/作者等

步骤：XML 解析与展示

产出：meta::comicinfo

验收：面板可见

依赖：T41

T121（可选）书签/书架/标签

目的：管理与检索

步骤：SQLite 表结构 + UI

产出：store::bookshelf

验收：筛选/最近打开

依赖：T81

13. 文件监听与刷新

T130（Ready）文件夹监听（notify）

目的：增删改自动刷新

步骤：去抖合并事件、错误处理

产出：fs::watch

验收：实时更新且无频繁重扫

依赖：T40

14. 诊断与性能

T140（Ready）日志与错误分级

目的：本地调试

步骤：tracing + 滚动日志文件

产出：log::*

验收：错误可追踪、无噪声

依赖：T30

T141（Ready）性能指标（stats）

目的：可观测

步骤：FPS、命中率、解码/缩放 P50/P95、内存/VRAM

产出：stats() + 前端状态条

验收：值随操作变化合理

依赖：T81

15. 测试与验收

T150（Ready）单元测试

目的：关键逻辑正确性

步骤：自然排序、EXIF、ICC、缩放、LRU、mip、tile

产出：core/*_test.rs

验收：cargo test 通过

依赖：T63

T151（Ready）集成/E2E 测试

目的：端到端稳定性

步骤：注入 1k+ 页样本；Playwright UI 测试；axe 可达性

产出：/e2e

验收：关键路径用例通过

依赖：T101, T102, T110, T111

最小可用路径（MVP 执行顺序）

T00 → T10 → T11 → T20 → T21 → T30 → T40 → T41 → T50 → T51 → T60 → T61 → T62 → T80 → T90 → T100 → T101 → T102 → T110 → T111 → T81 → T140 → T141 → T150 → T151

可并行块

UI 基座（T10/T11） ⇔ FS/Codec 管线（T40–T51） ⇔ 协议/IPC（T20/T21）

渲染引擎（T90–T92） ⇔ 缓存层（T60–T63）

UI 组件（T100–T105） ⇔ 阅读模式（T110–T112）