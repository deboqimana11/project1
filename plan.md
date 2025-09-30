# 本地漫画阅读器：落地实施计划（Rust优先）

> 目标：做一款**桌面端、本地离线、流畅且现代美观**的漫画阅读器。以 **Rust** 为主，结合能做出漂亮 UI 的技术栈；**不对外发布**、自用，但代码结构清晰，方便后续扩展与重构。本文面向“可执行的 AI 实施者”，给出从技术选型、架构、数据结构到任务拆解、验收标准、性能指标、测试方案的完整计划。

---

## 1. 需求与边界

### 1.1 核心功能（MVP）
- 从「单张图片」「文件夹」或「压缩包（CBZ/CBR/CB7/ZIP/7z/TAR）」载入漫画。
- 支持图片格式：JPG、PNG、WebP、AVIF、GIF（逐帧/首帧）、BMP。
- 阅读模式：单页 / 双页（跨页拼接）、长条连续、左右/上下翻页；L→R 与 R→L 阅读顺序切换。
- 适配：适宽 / 适高 / 原始尺寸 / 填满；自由缩放、平移（平滑、带惯性）。
- 预读与缓存：前后各 N 页解码与缩放缓存，滚动/翻页无卡顿。
- 目录与缩略图：侧边缩略图栏（虚拟化渲染），当前页高亮。
- 进度管理：自动记录每本/每文件夹阅读进度；启动时可“继续上次”。
- 手势/快捷键：鼠标、触控板、键盘自定义映射。
- 文件监听：当前文件夹内容变化（新增/删除/重命名）自动刷新。
- 完全离线运行；无遥测；可开关日志。

### 1.2 进阶功能（Plus）
- 元数据解析：支持 ComicInfo.xml（CBZ 常见），提取标题、卷号、作者等。
- 标签与书架：按文件夹/标签管理；快速过滤、自然排序（1,2,10）。
- 图像增强：抗锯齿、高质量缩放（Lanczos/Catmull-Rom）、边缘裁切、去边、背景填充。
- 跨页智能拼接（检测跨页图像并自动合并为双页显示）。
- 自定义主题 / 暗色模式；紧凑/宽松密度切换；无边框沉浸式。
- 多窗口：并排对比（例如原版/汉化对照）。

### 1.3 非目标
- 不做在线抓取/订阅源；不做社区/分享；不做移动端。

---

## 2. 技术选型与对比

> 原则：Rust 负责**性能关键**（I/O、解码、预读、缓存、排序、文件系统、归档解包等），UI 层采用**能快速做出现代视觉**的方案。

### 2.1 推荐方案 A（首选）：**Rust + Tauri + React/TypeScript + Tailwind + shadcn/ui + Radix**
- **UI 表现力**：Web 技术生态丰富、组件成熟，易于做现代设计（毛玻璃、动效、栅格、阴影）。
- **桌面集成**：Tauri 体积小、启动快、原生菜单/快捷键/多窗口、系统权限受控。
- **性能**：渲染端使用 Canvas/WebGL（如 PixiJS）绘制；核心解码/缓存由 Rust 实现，通过 `tauri::command` 提供 API。
- **跨平台**：Windows/macOS/Linux 一套代码。
- **开发效率**：前后端边界清晰；UI 迭代快；可直接丢给“另一个 AI”实现。

**潜在代价**：需要在前端与 Rust 之间设计清晰的 IPC；若使用 WebGL，需要处理纹理上传与内存预算。

### 2.2 方案 B：**纯 Rust UI（egui/eframe 或 Iced）**
- **优点**：单语言栈；部署最简单；性能稳定（基于 wgpu）。
- **缺点**：UI 美学与可定制程度略受限，想做非常“现代”的细节（复杂动效、玻璃态）成本更高。

### 2.3 方案 C：**Rust + Flutter（flutter_rust_bridge）**
- **优点**：Flutter UI 精致、组件/动效强；跨平台；Debug 体验好。
- **缺点**：打包体积较大；工具链相对重；桥接复杂度略高于 Tauri。

> **结论**：本计划以 **方案 A（Tauri）** 为主线，附带 B 的实现要点作为保底路径。

---

## 3. 顶层架构设计

```
┌──────────────────────────────────────────────────────────────┐
│                           UI 层（React）                    │
│  视图/交互：页面视图、缩略图、工具栏、设置、快捷键、主题     │
│  渲染：Canvas/WebGL（可选 PixiJS），虚拟列表，状态管理（Zustand）│
│  调用：通过 Tauri IPC 调用 Rust Commands                      │
└──────────────▲───────────────────────────────────────────────┘
               │ 请求/事件
               │
┌──────────────┴───────────────────────────────────────────────┐
│                      Rust Core（crate: core）                │
│  模块：                                                     │
│  • fs：文件系统与归档适配（目录、ZIP、RAR、7z、TAR）          │
│  • codec：多格式解码（JPG/PNG/WebP/AVIF/GIF...）              │
│  • pipeline：预读/解码/缩放流水线（多线程 + LRU 缓存）         │
│  • renderprep：为前端准备纹理/位图（目标分辨率缩放）          │
│  • meta：ComicInfo.xml 解析、排序策略                         │
│  • store：设置/进度/书架（SQLite + sqlx 或 JSON）            │
│  • keymap：快捷键映射、命令分发                               │
│  • log：tracing + 文件滚动                                   │
└──────────────▲───────────────────────────────────────────────┘
               │ FFI/IPC（tauri::command）
               │
┌──────────────┴───────────────────────────────────────────────┐
│                         Tauri Shell                          │
│  窗口/菜单/托盘/权限；多窗口管理；平台集成                     │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 并发与数据流
- UI 请求页面 `page(n)` → Core 若命中内存缓存直接返回；否则触发**预读流水线**：
  1) I/O 拉取源字节（目录/归档），优先内存映射（mmap）；
  2) 解码原图（rayon 线程池）；
  3) 依据当前窗口 DPI 与适配模式进行高质量缩放（`fast_image_resize`），并生成所需 mip 级别；
  4) 写入 **内存 LRU** 与 **磁盘缩略/位图缓存**（键=文件哈希+渲染参数哈希）；
  5) 不回传像素数据，**仅回传一个一次性 URL（自定义协议，例如 `app://img/{key}`）**，前端以流式读取获得图像；
  6) 前端将数据解包为 `ImageBitmap`/纹理并渲染。
- 前端渲染线程解耦：优先使用 **OffscreenCanvas + Worker**（可用时），保持主线程 UI 60fps；否则使用 PixiJS/WebGL 的 Ticker。
- 后台持续预读：根据**视口位置与滚动速度**动态调整窗口大小与优先级，遇到跳页/快速滚动立即取消过时任务。

### 3.2 缓存策略
- **内存 LRU**：按像素占用估算大小（W×H×4），设置全局上限（默认 512MB，可配置）。
- **GPU 纹理缓存**（前端）：维护纹理 LRU（预算默认 256–512MB），超限回收最旧/最远纹理，避免 VRAM 撑爆。
- **磁盘缓存**：`~/.local/share/your_app/cache`（Windows 放 `%AppData%`）；存缩略图与已缩放位图（键=文件哈希+渲染参数哈希）。
- **多级金字塔**：每页生成 1/2、1/4、1/8… 级别，缩放时优先选择最近级别再插值。
- **超长纵图切片**：对高宽比 > 4:1 的图按垂直切片生成缓存块（tile），滚动时按视口装载。
- **解码结果复用**：同一页面在不同适配模式复用中间层（原图→mip）。

### 3.3 文件与归档支持
- 目录：自然排序（数字感知）；递归可选；自动过滤非图。
- CBZ/ZIP：`zip` crate；CBR/RAR：`unrar`（需本地库，许可注意，仅自用可接受）；7z：通过命令行 7z（可选软依赖）或 `sevenz-rs`。
- ComicInfo.xml：解析基础元数据；文件名规则兜底（Vol/Ch/Index 解析）。

### 3.4 数据持久化
- **SQLite（sqlx）**：书架、进度、标签、最近打开、键位映射、设置。
- 轻量模式可选 **JSON/TOML**（适合便携版），通过 feature flag 切换。

---

## 4. UI/UX 2.0（Sleek & Elegant 规范）

> 目标：在不牺牲性能的前提下，呈现**极简、通透、细腻**的现代审美。强调留白、视觉层级、轻动效与可读性。以下规范**可直接落地**到 Tailwind/shadcn/ui，并配有主题令牌与类名约定。

### 4.1 视觉语言（Visual Language）
- **性格**：冷静、克制、细节感（微圆角、浅阴影、细边框、低饱和点缀）。
- **几何**：8pt 栅格（间距步进：4/8/12/16/24/32/48）；容器圆角 `rounded-2xl`（20px）为主，按钮 `rounded-xl`（12px）。
- **层次**：四层电梯（Elevation 0–3）。
  - E0：画布/页面背景（无阴影）；
  - E1：卡片/工具条（1px 边框 + 极浅阴影）；
  - E2：浮层/面板（模糊背景 + 中性阴影）；
  - E3：模态/命令面板（更强模糊 + 边框发光 1px）。
- **质感**：可选**玻璃态**（blur 12–16px + 3–6% 白噪点纹理）仅用于 E2/E3；避免大面积过度模糊。

### 4.2 设计令牌（Design Tokens）
> 通过 CSS 变量驱动主题，Tailwind 读取变量生成实用类。

```css
:root {
  /* 色彩以 OKLCH 定义，兼具感知一致与对比稳定 */
  --bg: oklch(0.98 0.01 255);
  --surface: oklch(0.97 0.006 255);
  --surface-2: oklch(0.96 0.006 255 / 0.8);
  --border: oklch(0.88 0.02 255);
  --text: oklch(0.21 0.02 255);
  --muted: oklch(0.55 0.01 255);
  --accent: oklch(0.67 0.12 250);   /* 冷青蓝 */
  --accent-2: oklch(0.72 0.10 220); /* 辅助蓝紫 */
  --success: oklch(0.72 0.12 145);
  --warning: oklch(0.78 0.13 85);
  --danger:  oklch(0.62 0.18 25);
  --shadow: 0 6px 30px rgba(0,0,0,.06);
  --radius-lg: 20px; --radius-md: 12px; --radius-sm: 8px;
  --blur-md: 12px; --blur-lg: 16px;
  --ease: cubic-bezier(.2,.8,.2,1);
  --dur-fast: 120ms; --dur-mid: 180ms; --dur-slow: 260ms;
}

:root.dark {
  --bg: oklch(0.14 0.01 255);
  --surface: oklch(0.16 0.01 255);
  --surface-2: oklch(0.18 0.02 255 / 0.7);
  --border: oklch(0.32 0.03 255);
  --text: oklch(0.92 0.02 255);
  --muted: oklch(0.70 0.01 255);
  --accent: oklch(0.70 0.14 240);
  --accent-2: oklch(0.75 0.12 220);
  --shadow: 0 10px 40px rgba(0,0,0,.35);
}
```

**Tailwind 适配（片段）**
```ts
// tailwind.config.ts
export default {
  theme: {
    extend: {
      colors: {
        bg: 'var(--bg)', surface: 'var(--surface)',
        surface2: 'var(--surface-2)', border: 'var(--border)',
        text: 'var(--text)', muted: 'var(--muted)',
        accent: 'var(--accent)', accent2: 'var(--accent-2)'
      },
      borderRadius: { xl: 'var(--radius-lg)', lg: 'var(--radius-md)', md: 'var(--radius-sm)' },
      boxShadow: { soft: 'var(--shadow)' },
      transitionTimingFunction: { elegant: 'var(--ease)' },
      transitionDuration: { fast: 'var(--dur-fast)', mid: 'var(--dur-mid)', slow: 'var(--dur-slow)' },
      backdropBlur: { md: 'var(--blur-md)', lg: 'var(--blur-lg)' },
    }
  }
}
```

**排版**
- 西文：Inter/SF Pro；中文：思源黑体/苹方/冬青黑；行高 1.4–1.6；字重偏轻（400/500）。
- 标题 vs 正文对比：字号比约 1.25×；避免超粗字重造成“厚重感”。

### 4.3 关键布局与组件（类名与行为）

#### A) 顶部工具栏（E1）
- 容器：`sticky top-0 z-40 bg-surface/90 backdrop-blur-md border-b border-border shadow-soft`
- 内部：左（返回/前进/书架）、中（页码/缩放/模式）、右（搜索/命令面板/设置）。
- 交互：悬停 `transition-all duration-fast ease-elegant`；点击凹陷 `active:scale-[.98]`。

#### B) 侧边缩略栏（E1，可折叠）
- 容器：`w-[280px] border-r border-border bg-surface/95 backdrop-blur-md`
- 列表：虚拟化；卡片 `rounded-lg overflow-hidden border hover:border-accent/40`；当前页 `ring-2 ring-accent`。
- 顶部搜索：`shadcn` Input，支持过滤与自然排序开关。

#### C) 主阅读区（E0 + 控件浮层 E2）
- 画布容器：`relative bg-bg`；在沉浸模式隐藏工具栏与侧边栏。
- 浮层控制条（自动显隐）：`absolute bottom-6 left-1/2 -translate-x-1/2 bg-surface-2 backdrop-blur-lg border border-border/70 rounded-2xl shadow-soft px-4 py-2`，内含缩放/适配/单双页切换；**3 秒无互动淡出**（Framer Motion：opacity/translateY）。
- 页码标记：右下角 `text-muted bg-surface/70 rounded-lg px-2 py-1`，滚动时轻微浮动。

#### D) 命令面板（E3）
- 触发：`Cmd/Ctrl + K`；
- 样式：`max-w-[720px] bg-surface-2 backdrop-blur-lg border rounded-2xl shadow-soft`；
- 行为：模糊搜索（页码/文件/命令），最近记录，高亮候选用 `accent` 细线条。

#### E) 设置面板（E2）
- 布局：左右两列；左侧导航，右侧内容卡组；
- 控件：切换（预读 K、缓存上限、阅读顺序、主题密度）。

#### F) Toast/提示（E2）
- 卡片：`bg-surface-2/95 backdrop-blur-lg border rounded-xl shadow-soft`；
- 动画：右上角进场，轻微缩放 + 位移 8px。

### 4.4 状态与微交互（Micro-interactions）
- **Hover**：透明度+轻阴影（`shadow-soft`）；
- **Focus**：1px 内边框 + 1px 外环（使用 `accent` 低饱和度）；
- **Active**：轻压 `scale-[.98]`；
- **切换**：`duration-fast` / `ease-elegant`；
- **滚动指示**：顶部/底部出现淡淡渐隐遮罩（渐变到 `bg`）；
- **骨架屏**：缩略图与阅读画布首帧都使用渐变闪烁骨架；
- **沉浸模式**：鼠标停留边缘时渐显工具条；移动离开 3s 渐隐。

### 4.5 暗/亮主题映射
- 亮色：边界用冷灰蓝；阴影极浅；玻璃态透明度更高；
- 暗色：边界亮度提升，避免灰糊；阴影加重但半径减小；点缀 `accent` 稍微更亮；
- 组件级规则：**边框对比 ≥ 1.3**、**文字对比 ≥ 4.5**。

### 4.6 可达性（A11y）
- 对比：主文字 ≥ 4.5:1；次文字 ≥ 3:1；
- 焦点：键盘可达，清晰可见；
- 动画：尊重 `prefers-reduced-motion`，降级为渐隐/无缩放；
- 字号：可在设置里统一缩放（90–120%）。

### 4.7 性能准则（UI 层）
- 所有过渡 ≤ 180ms；阴影与模糊仅用于 E2/E3；
- 列表使用虚拟化；缩略图在视口外降采样；
- 动画统一走 `will-change: transform, opacity`；禁止在高频动画中调 layout。

### 4.8 落地任务（面向执行 AI）
1) 加入上方 **Design Tokens** 与 Tailwind 扩展；
2) 按 A–F 组件清单创建 `Toolbar`, `ThumbSidebar`, `ReaderOverlay`, `CommandPalette`, `SettingsSheet`, `Toast`; 
3) 引入 **Framer Motion**：封装 `<FadeSlide>`、`<AutoHideOverlay>` 公共动效；
4) 实现**沉浸模式**（自动显隐逻辑 + 边缘感应）；
5) 在命令面板里加入：快速跳页、切换阅读顺序/单双页、主题明暗切换、打开最近；
6) 编写 UI 级快照测试（Playwright）与可达性检查（axe-core）。

---

## 5. 关键模块与数据结构（Rust）
 关键模块与数据结构（Rust）

> 以下为核心 crate（`core`）的建议结构与示例类型，便于另一 AI 直接对照实现。

```
/core
  ├── src/
  │   ├── lib.rs
  │   ├── fs/              // 目录与归档适配
  │   ├── codec/           // 解码器与格式注册
  │   ├── pipeline/        // 任务队列、预读、缩放
  │   ├── cache/           // LRU、磁盘缓存
  │   ├── meta/            // ComicInfo & 文件名解析
  │   ├── store/           // SQLite 或 JSON/TOML
  │   ├── keymap/
  │   └── types.rs
  └── Cargo.toml
```

**核心类型（示例）**
```rust
pub struct PageId { pub source_id: SourceId, pub index: u32 }

pub enum Source {
    Folder { root: PathBuf, entries: Vec<PathBuf> },
    Archive { path: PathBuf, kind: ArchiveKind, entries: Vec<ArchiveEntry> },
}

pub struct PageMeta {
    pub id: PageId,
    pub rel_path: PathBuf,
    pub width: u32,
    pub height: u32,
    pub is_double_spread: bool,
}

pub enum FitMode { FitWidth, FitHeight, FitContain, Original, Fill }

pub struct RenderParams { pub fit: FitMode, pub viewport_w: u32, pub viewport_h: u32, pub scale: f32, pub rotation: i16, pub dpi: f32 }

pub struct ImageKey { pub cache_key: String } // 用于拼装协议URL，不直接跨IPC传像素

pub struct CacheBudget { pub bytes_max: usize }

pub struct AppState { /* 当前 Source、页码、队列、缓存、设置等 */ }
```

**对外命令（Tauri IPC）**（精简示例）
```rust
#[tauri::command] fn open_path(path: String) -> Result<SourceId>;
#[tauri::command] fn list_pages(source_id: SourceId) -> Result<Vec<PageMeta>>;
#[tauri::command] fn get_page_url(page: PageId, params: RenderParams) -> Result<String>; // 通过自定义协议返回可流式读取的 URL
#[tauri::command] fn get_thumb_url(page: PageId, longest: u32) -> Result<String>;
#[tauri::command] fn prefetch(center: PageId, policy: PrefetchPolicy) -> Result<()>; // 动态窗口
#[tauri::command] fn cancel(token: RequestToken) -> Result<()>; // 取消未完成任务
#[tauri::command] fn save_progress(source_id: SourceId, page: u32) -> Result<()>;
#[tauri::command] fn query_progress(source_id: SourceId) -> Result<u32>;
#[tauri::command] fn stats() -> Result<PerfStats>; // FPS/命中率/内存占用（开发模式）
```rust
#[tauri::command] fn open_path(path: String) -> Result<SourceId>;
#[tauri::command] fn list_pages(source_id: SourceId) -> Result<Vec<PageMeta>>;
#[tauri::command] fn get_page_bitmap(page: PageId, params: RenderParams) -> Result<BitmapHandle>;
#[tauri::command] fn prefetch(center: PageId, ahead: u32, behind: u32) -> Result<()>;
#[tauri::command] fn set_fit_mode(mode: FitMode) -> Result<()>;
#[tauri::command] fn save_progress(source_id: SourceId, page: u32) -> Result<()>;
#[tauri::command] fn query_progress(source_id: SourceId) -> Result<u32>;
```

**缓存实现要点**
- LRU：`hashlink`/`lru` crate；值记录位图与最后访问时间；统一内存预算管理。
- 磁盘：目录分片（前 2 字符为子目录），避免单目录数万文件。

**解码与缩放**
- 解码：优先使用 `image` crate（JPG/PNG/WebP/GIF/BMP）。如需更高性能或更多特性可接入 `libwebp-sys`（可选）。**AVIF 解码使用 `libavif` 通过 `libavif-sys` 绑定**（需本地库，找不到时自动降级禁用 AVIF 并给出一次性提示）。
- 方向与色彩：解析 EXIF Orientation 并在解码后统一旋转到正向；如存在 ICC Profile 则转换为 sRGB（无则默认按 sRGB 处理）。
- 缩放：`fast_image_resize`（SIMD）为主，滤波器使用 Lanczos3/CatmullRom；为缩放与缩略图生成**多级金字塔（mip）**，减少重复缩放开销。
- 动图：MVP 取 GIF 首帧；后续支持逐帧播放与帧缓存（可开关）。

**归档**
- ZIP/CBZ：`zip`；RAR/CBR：`unrar`（或外部解压作为后备）；7z/CB7：优先外部 7z 调用（可配置路径）。

**文件监听**
- `notify` crate，节流去抖（300–500ms），合并批量事件再刷新列表。

---

## 6. 前端（React + Tauri）实现要点

```
/ui
  ├── src/
  │   ├── app/               // 路由（若需）
  │   ├── components/        // Toolbar/Sidebar/Canvas/ThumbList
  │   ├── hooks/             // useKeymap/useRenderer/useStore
  │   ├── state/             // Zustand store（currentPage、fitMode...）
  │   ├── ipc/               // 封装 Tauri commands 的 TS 函数
  │   └── styles/            // Tailwind 配置/主题
  └── package.json
```

- **渲染**：
  - 首选 `<canvas>` + `ImageBitmap`；可用时启用 **OffscreenCanvas** 在 Worker 内完成合成与平移/缩放，主线程只做输入与 UI。
  - 需要更强动效/巨图优化时接入 **PixiJS/WebGL**，将页图作为纹理，并启用惯性与边界回弹。
- **虚拟列表**：：缩略图使用 `react-virtualized` 或 `@tanstack/virtual`。
- **状态管理**：Zustand + Immer；快捷键与命令解耦（Command Palette）。
- **主题**：shadcn/ui + Radix Primitives；暗色优先；CSS 变量驱动。
- **键鼠**：统一手势系统（滚轮缩放、右键菜单、拖拽选择范围）。

---

## 7. 性能与目标指标

- **启动时间**：冷启动 < 500ms（非首次 < 300ms）。
- **翻页延迟**：命中缓存 < 10ms；预读后首次显示 < 40ms；未预读 < 150ms。
- **滚动帧率**：1080p @ 60fps；4K @ 60fps（单页）/ 45fps（双页）。
- **内存占用**：默认缓存上限 512MB；可调至 128MB–2GB。
- **大图**：单页 8000×12000 仍可在 200ms 内完成缩放并显示首帧。

---

## 8. 任务拆解与里程碑（面向 AI 可执行）

### Sprint 0（0.5 天）
- 脚手架：`cargo new` 三层结构（workspace：core/ui/launcher），`pnpm create` 前端；接入 Tauri。
- 搭建基础 IPC，打通 `open_path → list_pages → get_page_bitmap` 最小链路（返回占位位图）。

### Sprint 1：MVP 阅读链路（2–3 天）
1) **fs**：目录扫描、自然排序；基本过滤。
2) **codec**：JPG/PNG/WebP 解码；`fast_image_resize` 缩放；位图到前端。
3) **pipeline**：预读 + LRU；K=2（前后各 2 页）。
4) **UI**：阅读视图、工具栏、键鼠缩放/平移；页码/进度条。
5) **持久化**：SQLite 或 JSON 记录最后阅读位置；“继续阅读”。

### Sprint 2：归档/缩略图/侧栏（2 天）
1) CBZ/ZIP；（可选）CBR/7z（先外部进程方案）。
2) 缩略图生成与磁盘缓存；虚拟化列表；侧栏联动。
3) 双页/连续模式；R→L 切换；旋转。

### Sprint 3：美化与可用性（1–2 天）
1) 主题系统（暗/亮）；shadcn/ui 落地；动效与沉浸式全屏。
2) 快捷键自定义与导入/导出；命令面板；书签。
3) ComicInfo.xml 解析；元数据面板。

### Sprint 4：性能与打磨（1–2 天）
1) AVIF 解码；GIF 首帧。
2) 预读优先级管理（滚动时动态重排）；取消机制。
3) 压测与指标采集；日志分级；错误上报到本地文件。

**Definition of Done（DoD）**
- 指标达成（见 §7）；核心流程稳定；崩溃率低；
- 关键路径单测/集成测试通过；
- 文档：README（本地运行/配置）、快捷键清单、故障排查。

---

## 9. 测试与验收

### 9.1 单元测试
- 自然排序、文件过滤、路径边界（非 UTF-8、极长路径）。
- 解码正确性（像素/尺寸）、旋转/裁切/缩放一致性。
- LRU 淘汰逻辑、预算上限、并发访问。

### 9.2 集成/端到端
- 打开含 1k+ 页的大型文件夹/CBZ，滚动与跳页不卡顿。
- 切换适配模式、双页/连续、R→L 即时生效，预读策略调整正确。
- 断电/崩溃后重启，进度与设置未丢失。

### 9.3 兼容性与边界
- 各平台 DPI 缩放、HDR/色域（以 sRGB 兜底）。
- 稀有格式（奇怪的 EXIF 旋转、渐进式 JPEG）。
- 外部解压不可用时的降级与提示。

---

## 10. 安装与运行（开发者）

- 依赖：Rust stable、pnpm、Tauri 要求的系统依赖；（可选）libwebp/libavif、本机 7z。
- 运行：
  - `cargo run -p launcher`（或 `pnpm tauri dev`）
  - UI 热更新；Rust 热重载通过快速编译 + 接口稳定实现。
- 配置：`~/.config/your_app/config.toml`（缓存上限、预读 K、主题、键位）。

---

## 11. 风险与缓解

- **稀有格式不兼容**：提供“外部解码/解压”后备路径；记录失败样本。
- **大图内存压力**：统一预算、分辨率金字塔、纹理复用；提供“低内存模式”。
- **RAR 许可问题**：仅自用；文档注明；默认不内置，首次提示选择外部 unrar。
- **Tauri ↔ 前端传输：采用**自定义协议 + 流式响应**或磁盘缓存文件，前端以 URL 拉取；避免 Base64/JSON 大对象；**不使用跨进程共享内存句柄**以减少平台差异与权限问题。

---

## 12. 备选实现（方案 B：egui/eframe）

- 直接用 egui 的纹理管理 + wgpu；一个窗口即一个 `App`；
- 侧栏用 `ScrollArea` + 虚拟列表（自实现）；
- 主题通过 egui `Style` 自定义；
- 性能达标但 UI 美学略弱；作为“快速出片”的保底路线。

---

## 13. 立即可交付清单（给执行 AI）

1) 建仓：Git workspace（三 crate：`core`、`ui`、`launcher`）。
2) 接口契约：完成 §5 IPC 命令签名；TS 对应类型定义。
3) MVP 清单：Sprint 1 所有任务；优先目录读取 + JPG/PNG/WebP 解码 + 预读 + Canvas 渲染。
4) 指标采集：在状态栏打印 FPS、缓存命中率、解码时延 P50/P95（开发模式）。
5) 文档：运行步骤、快捷键、配置样例（带注释）。

---

## 14. 附：快捷键清单（默认）

- 导航：`←/→`、`PageUp/PageDown`、`Home/End`、`Ctrl/Cmd+G` 跳页。
- 视图：`1` 原始、`2` 适宽、`3` 适高、`0` 适屏、`D` 双页、`S` 单页、`C` 连续、`R` 旋转、`L` 阅读方向。
- 其他：`F` 全屏、`Shift+F` 沉浸、`B` 书签、`Ctrl/Cmd+,` 设置。

---

### 结语
- 以 **方案 A（Rust+Tauri+React）** 快速达到“好看且流畅”的最优解；
- 结构上把性能关键全部放在 Rust Core，UI 只做渲染与交互；
- 保留 **方案 B（egui）** 为快速保底；
- 通过明确的指标、DoD 与分 Sprint 计划，确保另一 AI 可直接照此开发。

