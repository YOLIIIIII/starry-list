# SL-006-A：Windows 桌面驻留研究

日期：2026-10-26（Asia/Shanghai）。维护者 yoli 授权技术研究与安全隔离原型；基线 `cd84cbe88fd9b408f15ad261896f4267f007d263`。本报告不是 SL-006-B 开发授权，也不是正式功能或发布。详细需求以 [PRODUCT_BACKLOG](../PRODUCT_BACKLOG.md#sl-006) 为准。

## 结论与进入下一阶段的条件

**选择 C：暂不推荐实现。** 指当前完整的桌面驻留定义：普通应用自然覆盖、返回桌面仍可见、可交互、不干扰焦点/全屏并可恢复。

最值得保留研究的是 **A：Tauri 内置 alwaysOnBottom**，公开接口、依赖已存在、维护改动最少。本机原型确实维持普通应用后方的顺序，激活不会像单次 HWND_BOTTOM 那样上浮；但 **Win+D 实际最小化了原型**，没有实现可靠桌面驻留。API 成功、持续靠后、关闭置顶均不能替代完整产品目标。

**目前不建议进入 SL-006-B。** 若继续研究，应先在可丢弃的 Windows 11/10 虚拟机或专用设备验证 Shell 生命周期、原生鼠标/IME、可见性及独立救援入口。WorkerW 没有达到正式推荐的证据门槛。本轮停止于研究结论，等待用户确认，不接入正式主窗口。

## UX3.2 验收复核

审查 [UX3.2 对比](../UX3_2_VISUAL_REVIEW.md)、[VALIDATION](../VALIDATION.md) 和实际源码，区分历史测试、用户确认与本轮测试。用户已安装 UX3.2，并确认「功能都还不错，已经可以了，我们接下来看下一项任务」。以下不是重新运行 UX3.2 的全套回归。

| 需求                     | 本次状态     | 核对依据 / 保留缺口                                                                                                                                                  |
| ------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SL-005-A                 | **Done**     | 经典/紧凑、18 种偏好组合、两原生配置共 360 个布局状态；持久化/重启、失败回滚/重试、旧 JSON；真实空白拖动及右/下缩放；图标名称/Tab/窗口按钮证据齐全，结合此次安装确认 |
| SL-001-A                 | **Done**     | 长详情单列表滚动、底部新增位置稳定；380–980px、480px 高、三字号/材质/两顶部；12 组窄矮草稿、连续 Enter、真实跨应用失焦、失败重试、撤销与抽屉证据，结合此次确认       |
| SL-001 父项              | In Review    | 完整阅读/编辑、2000 字计划、所有取消与导航保护仍缺独立完整用户验收；底部入口通过不替代整项                                                                           |
| SL-005 父项              | In Review    | 现方案已由 A 替代旧压缩方案；父项全部边缘/窗口操作的完整验收边界继续保留，既有记录只覆盖真实右/下方向，并未逐方向认证；不由子项自动关闭                              |
| SL-003 父项              | In Review    | D/E 的针对性原环境长时间与失焦确认仍缺                                                                                                                               |
| SL-003-A / B / C         | Done 保持    | 已有独立历史确认与证据；不重新开项，也不把历史段落的当时 In Review 当作当前状态                                                                                      |
| SL-003-D                 | In Review    | 反复切换与降级残留：已有自动化/故障注入证据，缺原环境针对性长时间确认                                                                                                |
| SL-003-E                 | In Review    | 已有合成激活/失焦证据，缺明确的原环境最终体验确认                                                                                                                    |
| SL-004 父项              | In Review    | 字号切换正面反馈保留，完整范围/抽屉最终验收不扩大解释                                                                                                                |
| SL-004-A                 | In Review    | 局部新增字号已纳入三档回归，保留原实现与局部最终验收缺口                                                                                                             |
| SL-004-B                 | In Review    | 三档阅读与宽窄编辑抽屉最终确认仍缺                                                                                                                                   |
| SL-002 / SL-019 / SL-021 | Done 保持    | 独立历史确认和错误路径证据已记录                                                                                                                                     |
| SL-006                   | **Research** | 本次仅 A 授权；B 未开发；不标 Done                                                                                                                                   |
| 其余 Backlog / Idea      | 原状态保持   | 未获本轮开发或验收授权                                                                                                                                               |

UX3.2 实现为 [`4586f33`](https://github.com/YOLIIIIII/starry-list/commit/4586f33e062714dd255c4645bf521efaad47a4e3)，历史 141 项前端、14 项 Rust、25 组桌面等证据不充作 SL-006 原型证据。UX3.2 安装体验已由用户确认，不代表本轮执行过安装/升级/卸载。无正式 Release，发布版本字段不填。

## 当前窗口架构

- `src-tauri/tauri.conf.json`：正式标识 `app.starrylist.desktop`；单主窗口 main，无边框、透明、无原生阴影，可缩放，初始隐藏；980×680，最小 380×480。没有 alwaysOnBottom 配置。
- `src/platform.ts`：初始化后恢复几何、按显示器工作区约束位置、读取持久化 `always_on_top`、显示窗口。置顶按钮走 `setAlwaysOnTop`。`src/App.tsx` 在真实设置保存失败时回滚。当前没有三模式状态机。
- `src-tauri/src/lib.rs`：窗口状态插件只恢复 SIZE/POSITION/MAXIMIZED；单实例回调会 show / set_focus。将来驻留时须独立评审这个显式唤起行为。SQLite 与窗口状态为正式数据，本轮不访问它们。
- `src-tauri/src/material.rs`：UI 线程持有 HostBackdropBrush / DesktopWindowTarget，支持时 DWM host backdrop 配合单棵合成树；不使用失焦变实色的旧 Acrylic 方案。现有正式入口限制 Windows 11 build 22621+、透明/高对比/系统效果策略，并有实色回退。
- `src-tauri/capabilities/default.json`：有 allow-set-always-on-top，没有 allow-set-always-on-bottom。生产权限本轮不变。

## 锁定版本与内置 API

来自实际 lockfile，不以浮动 `version = "2"` 或官网 latest 代替。原型保留独立 Cargo.lock，关键后端版本相同。

| 组件                              | 仓库实际锁定    |
| --------------------------------- | --------------- |
| tauri                             | 2.12.3          |
| tauri-runtime / tauri-runtime-wry | 2.12.1 / 2.12.1 |
| tao / wry                         | 0.37.1 / 0.57.0 |
| webview2-com                      | 0.39.1          |
| tauri-build                       | 2.7.2           |
| @tauri-apps/api / CLI             | 2.12.3 / 2.12.2 |

三种入口均可用：[Rust 文档](https://docs.rs/tauri/2.12.3/tauri/webview/struct.WebviewWindow.html#method.set_always_on_bottom)、[JS 文档](https://v2.tauri.app/reference/javascript/api/namespacewindow/#setalwaysonbottom)、[配置参考](https://v2.tauri.app/reference/config/#windowconfig)。当前本地源码和生成 schema 也有对应定义。

```rust
// 仅示意候选调用，不是正式主窗口代码。
window.set_always_on_top(false)?;
window.set_always_on_bottom(true)?;
```

```javascript
await getCurrentWindow().setAlwaysOnTop(false);
await getCurrentWindow().setAlwaysOnBottom(true);
```

JS 需要 `core:window:allow-set-always-on-bottom`，不包含在 core:window:default 中；现正式 capability 未授予。Rust 直接调用不经这项前端 ACL；若暴露自定义 command，仍须限制调用来源、窗口和状态。原型只在自身 capability 加权限并实际调用 JS wrapper 与 Rust API。配置 `alwaysOnBottom: true` 控制创建初值，不等于三模式管理；本轮未单独运行配置初值实验。

调用链为 Tauri → tauri-runtime-wry → Tao；窗口层级逻辑在 **Tao**，不是 Wry 的 WebView 内容层。锁定 Tao 的 Windows 实现：

- `window.rs` 修改 `ALWAYS_ON_BOTTOM` 标志。
- `window_state.rs` 用 `SetWindowPos(HWND_BOTTOM, SWP_ASYNCWINDOWPOS | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE)`；关闭时请求 HWND_NOTOPMOST。
- `event_loop.rs` 的 WM_WINDOWPOSCHANGING 在标志启用时将 hwndInsertAfter 设为 HWND_BOTTOM，所以比单次置底更持久；这仍不是 Shell 桌面宿主协议。
- Tao 公共 API 明确保留 Windows 不能保证绝对最底层的边界。见锁定 [window.rs](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/window.rs)、[Windows 消息处理](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/windows/event_loop.rs)、[状态应用](https://github.com/tauri-apps/tao/blob/tao-v0.37.1/src/platform_impl/windows/window_state.rs)。

Rust Result / JS Promise 仅表示调用被处理；Tao 内部还有异步消息与忽略返回值的原生调用，不构成层级、可见性或焦点验收。本轮等待状态稳定后读取真实 HWND 顺序、WS_EX_TOPMOST、IsIconic、前台窗口和命中结果。

top 与 bottom 是独立标志，不能直接同时启用。原型已复现同时 true 时 Tauri isAlwaysOnTop=true，原生 WS_EX_TOPMOST=false。正式候选应先清除二者再启用一个，串行处理并验证原生结果；失败退 normal。退出 bottom 清除约束不意味着自动置前；原型显式“返回普通窗口”采用单次 HWND_TOP 并允许 set_focus，解决已经前台时 set_focus 不改变顺序的情况；后台超时恢复不抢焦点。普通模式可自然被其他窗口遮挡。

## 候选比较

下表“预期/风险”是文档与源码推断；只有测试矩阵和证据表中标明的行为经过实测。

| 维度              | A：Tauri bottom                                    | B：Win32 HWND_BOTTOM / Z-order              | C：Progman / WorkerW                        | D：其他公开方式                                |
| ----------------- | -------------------------------------------------- | ------------------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| 真正桌面驻留      | 本机 **不满足** Win+D                              | 单次置底不满足；本机激活后上浮              | 可能接近桌面层，但本轮未验证                | 无已证实同时满足的低成本方案                   |
| 普通应用覆盖      | 普通 cover 顺序通过；独立 Edge 原生遮挡未验证      | 可以暂时靠后                                | 理论桌面子层，普通窗口在上                  | 普通非置顶窗口会随激活改变顺序                 |
| 点击 / 激活       | 原生按钮点击/激活保持靠后；未覆盖完整日历          | 原生激活上浮，随后 OS 点击成功              | 子窗焦点、桌面图标命中与 WebView 键盘需验证 | WS_EX_NOACTIVATE 会损害键盘/IME，不能简单套用  |
| Win+D             | 实际最小化，失败                                   | 没有绕开 Shell 的机制；未单测               | 依赖具体 Shell 层级与版本                   | 不能仅去掉最小化按钮；桌面也可能提升遮挡       |
| Explorer 生命周期 | 保留顶层窗口、不依赖 Explorer 父 HWND；重启未验证  | 同左；恢复层级仍需验证                      | 宿主句柄可能失效，窗口可能丢失或被销毁      | 托盘可作恢复入口，Explorer 重建后须重注册      |
| 显示器 / DPI      | 保留顶层 DPI 模型，实际混合 DPI 未验证             | 可用公开工作区/DPI API，未验证              | 跨进程 SetParent 有 DPI 重置风险            | Widgets 平台需另一套宿主/产品适配              |
| 全屏              | 自建无边框全屏窗在上；游戏/独占未验证              | 高频重排可能干扰，不能采用                  | 绘制/暂停/宿主可见性均未验证                | 无通用保证                                     |
| Tauri / WebView2  | 当前依赖已实际运行                                 | 顶层句柄仍由 Tao 管理；自建 hook 有竞争风险 | 改父窗会改变坐标/焦点/生命周期假设          | 重写成另一 UI 框架成本更高，不能当作无风险替代 |
| 透明 / 毛玻璃     | 透明运行、合成初始化成功；像素视觉未验证           | 顶层 Z-order 理论不改合成树                 | 桌面子层下 host backdrop、裁切/渲染未验证   | Layered window 不自动等于可交互桌面层          |
| 鼠标 / 键盘       | 原生按钮/标题拖动/东南缩放通过；物理键盘/IME未验证 | 普通激活可输入，但破坏靠后                  | Wallpaper 用例不能证明任务编辑/弹窗/IME     | 输入穿透会直接破坏任务点击                     |
| Windows 版本      | 本机 Win11 26200；Win10 未验证                     | 公开 API 覆盖更广，不代表行为已认证         | 内部 Shell 结构随系统更新可能变化           | Win10/11 Widgets 等能力不同                    |
| 成本与维护        | 最小；仍需模式/恢复/错误处理                       | 单次低，消息拦截与生命周期高                | 高，兼容分支、宿主发现、失效与安全回退      | 未发现更低成本且有完整证据的实现               |
| 普通窗口回退      | 原型独立控制命令恢复通过                           | 顶层本身可恢复；持久 hook 须先卸载          | SetParent(NULL) 未必足够，必要时重建主 HWND | 应以独立救援入口与安全启动兜底                 |

[SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos) 公开支持 HWND_BOTTOM 与 NOACTIVATE 等标志，但一次排序不能建立永久桌面归属。事件驱动的自建 WM_WINDOWPOSCHANGING 控制与 A 机制重叠，无证据能额外解决 Win+D；本轮不实现全局 hook、不以定时重排/抢焦点掩盖缺陷。

没有发现可直接将任意现有 Tauri 主窗口注册为可靠交互式桌面组件的公开 Shell 接口。Windows Widgets / 独立桌面组件框架是另一宿主和分发设计，不能无成本保留当前窗口。此项是本次检索范围内的判断，不是对所有平台未来能力的保证。

## WorkerW 风险与未执行边界

社区常见方式是寻找 Progman / SHELLDLL_DefView / WorkerW，发送未公开语义的 `0x052C`，再跨进程 SetParent。虽然 SetParent 本身是公开 Win32 API，这种 Explorer 内部层级与消息组合没有变成受支持的桌面插件契约。[Lively 项目问题 #2074](https://github.com/lively-community/lively/issues/2074) 记录过 Win11 新构建导致原枚举假设变化；这是实际项目的兼容问题证据，不能推广为本项目验证成功。

主要风险：

- 找错 WorkerW 会进入壁纸后方、图标前方或不可见宿主；有的桌面拓扑根本不符合假设。避免隐藏/重排 Shell 的窗口来“修好”原型。
- [SetParent 文档](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setparent) 要求调用方管理窗口样式、坐标和 UI 状态；跨进程且 DPI awareness 不一致会触发子进程 DPI 重置。API 成功不代表 Tauri/WebView2 的内部几何与输入假设仍成立。
- [WebView2 环境文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2environment?view=webview2-1.0.3856.49) 与 [Controller 文档](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/icorewebview2controller?view=webview2-1.0.2849.39) 分别说明父窗、位置通知、焦点与可访问性维护。本方案重挂的是 Tauri 外窗，不能直接推断必须更换 WebView 的直接父窗；必须检查 Wry/Tao 消息传递，验证工具提示、IME 与无障碍树。
- Explorer 退出会使宿主 HWND 生命周期结束；监测 TaskbarCreated 只能成为恢复信号之一，不能证明窗口还活着。需要检测宿主/自身销毁，必要时由独立进程或可靠控制窗重建普通窗口。
- 同进程所有救援窗口/线程若一起被阻塞，不能宣称“永远可恢复”；单独托盘入口也依赖 Shell。生产救援必须覆盖进程重启与 safe-normal 启动。

**本机未发送 0x052C、未调用 SetParent、未隐藏/重排任何 Shell 窗口，未终止/重启 Explorer。** 未执行这类高风险候选不是实测失败，应标未验证。后续只能先在可恢复快照的隔离系统验证。

## 原型隔离、结构与复现

源码：[`research/sl006-desktop-probe`](../../research/sl006-desktop-probe/README.md)，自动化入口 [`scripts/sl006-desktop-probe.mjs`](../../scripts/sl006-desktop-probe.mjs)。独立 Cargo crate / lockfile / tauri.conf / capability / 静态 HTML，不是正式应用分支入口。

- 独立 productName、研究标识 `app.starrylist.research.sl006`、独立可执行文件 sl006-desktop-probe.exe；正式 App ID、正式配置、权限和源码均不变。
- 无 rusqlite、无任务/备份/窗口设置插件、无数据导入、无注册表写入；页面输入仅在内存。WebView/Edge 使用每次唯一的 `.cache/sl006-*` profile；没有读取/写入正式 SQLite，不以哈希检查为由触碰用户数据库。
- probe 为透明无边框测试窗，cover 为本进程普通遮挡/全屏窗，recovery 为独立装饰控制窗。恢复命令来自 recovery 的 IPC 已实际验证；其物理按钮/Alt+Tab 可达性仍需人工确认。
- 只读编译复用正式 `material.rs` 验证同一 HostBackdropBrush；不调用正式应用启动函数。当前原型只面向 Windows 11 的本次设备，不是 Win10 可交付功能。
- 120 秒后台清除 bottom/top，180 秒退出；显式返回 normal 可聚焦，自动恢复不周期抢焦点。事件循环彻底挂死时不能依靠同循环保证退出，外部子进程句柄终止仍是独立手段。没有循环强制 Z-order。
- 独立 `--watchdog-only` 实际等待超过 120 秒后，同样的单次置前请求不再被 bottom 约束拦截，证明超时清除生效；180 秒自动退出未单独等待验证，由 finally 正常退出。此结果不覆盖事件循环挂死。
- 为复用已编译依赖，本机输出到忽略的 `src-tauri/target`，文件名不同，不覆盖 starry-list.exe；缓存复用不是共享进程、数据库或用户配置。
- OS 鼠标注入前检查 HWND 属于精确子进程且命中点为目标根窗；被其他应用遮挡时拒绝输入，保留未验证；不点击未知窗口。Win+D 成对执行，finally 尝试恢复。
- 没有安装器、DLL 注入、Explorer 文件修改、系统安全设置修改或后台常驻安装。

根目录 PowerShell（需项目 Node 24 / Rust 1.90 MSVC / Windows WebView2；使用项目现有依赖与本地缓存）：

```powershell
$env:CARGO_HOME = Join-Path (Get-Location) '.cache/cargo'
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'src-tauri/target'
cargo build --manifest-path research/sl006-desktop-probe/Cargo.toml --locked --offline
& ./.tools/node-v24.21.0-win-x64/node.exe scripts/sl006-desktop-probe.mjs
# 单独验证 120 秒解除约束；请与上面的测试顺序运行：
& ./.tools/node-v24.21.0-win-x64/node.exe scripts/sl006-desktop-probe.mjs --watchdog-only
```

如果没有项目本地 Node，使用已安装的 Node 24；没有缓存时去掉 --offline 下载锁定依赖。脚本会打开短暂可见的研究窗口和独立 Edge、临时执行 Win+D；请顺序运行，不与真实鼠标操作并发。运行结束只关闭自己创建的进程/profile，不清理用户应用或数据。原始 evidence.json 留在忽略的本地缓存；公开证据只包含合成窗口测量，不上传桌面截图。

## 真实测试与证据

本机 Windows 11 家庭版 build 26200；原型 scale=2（200%），Intel Iris Xe 32.0.101.5542，另有 Sharing Monitor；WebView2 UA Edg/155。不是多 GPU 组合认证。真实测试使用原生窗口 + WebView2 IPC + Win32 状态观测；CDP 内容事件和真实 OS 输入单独标明。

完成记录见 [原型说明](../../research/sl006-desktop-probe/README.md)，可审查的原生状态值见 [归一化实测 JSON](../../research/sl006-desktop-probe/evidence-2026-10-26.json)。rank 随当前窗口数变化，只比较同次采样的先后，不能跨次把绝对名次当作稳定 API。关键实测：

1. normal → Rust bottom，普通 cover 前台，原型 WS_EX_TOPMOST=false、probeRank 大于 coverRank，进入模式未夺走 cover 前台。
2. 后续露出区域的真实 OS 按钮点击成功，原型成为前台而顺序仍在 cover 后；CDP 文本事件到达真实 WebView。早期被遮挡点拒绝输入的结果另存，不混为通过。
3. JS setAlwaysOnBottom 同样改变原生顺序；单次 HWND_BOTTOM 在原生 set_focus 后上浮到 cover 前，其后 OS 按钮点击可执行。
4. bottom 下真实 OS 标题拖动将物理位置 (80,120) 改为 (125,145)；先最小化自己的遮挡窗后，东南角 OS 拖动将 1000×720 改为 1045×747。其余边缘方向没有逐个认证；早期受遮挡时仅 API 改变几何，记为部分满足。
5. cover 最小化/恢复、自建无边框全屏、独立 Edge 遮挡及现有 HostBackdropBrush 初始化见矩阵。材质 API 成功不能证明失焦像素视觉稳定。
6. Win+D 前原型正常几何；按键后 IsIconic=true、位置为 (-32000,-32000)，**目标失败**。第二次按键恢复非最小化及原尺寸。IsWindowVisible 仍可为 true，不能用它断言用户看得见。
7. recovery IPC → normal 后原型可激活、置前且非置顶；互斥转换、正常退出/重启验证只涉及研究程序。

首次自动化在被遮挡点拒绝 OS 点击后停止；修正测试将该项目记录为未验证并继续，不移除命中保护。另有 Windows 前台请求被拒绝、退出时 IPC 页面已先关闭的设施失败；分别补充原生状态采样、确认子进程实际正常退出，未把请求成功当作聚焦成功。Edge 的原生遮挡没有得到可靠命中证据，保留未验证。构建曾暴露资源图标路径与 HWND 跨线程类型问题，修正后重新构建；这些失败尝试不计成功测试。

## 完整矩阵

“实际通过”只覆盖所述子场景；“部分满足”表示有真实证据但产品行为仍有缺口；“未验证”表示未执行。C / WorkerW 的全部桌面行为均未验证。

| #   | 行为                 | A：Tauri bottom 的实际结果 | 边界 / B 对照                                                                                                             |
| --- | -------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1   | 进入候选模式         | **实际通过**               | Rust / JS，真实 HWND 顺序；不代表驻留通过                                                                                 |
| 2   | 浏览器覆盖           | **部分满足**               | 自建普通 cover 的真实顺序通过；独立 Edge 已打开合成页面，但未取得原生遮挡命中，浏览器/Word/资源管理器的实际覆盖保留未验证 |
| 3   | 浏览器/日历焦点切换  | **部分满足**               | 普通 cover 原生 set_focus 可交替，bottom 激活仍靠后；浏览器原生反复点击未完成                                             |
| 4   | 点击按钮             | **实际通过**               | 原型按钮真实 OS 点击，获得前台仍保持在 cover 后；不是正式日历任务全套交互。B 激活后可 OS 点击但已上浮，违反驻留           |
| 5   | 中文/英文输入        | **部分满足**               | 真实 WebView 接收 CDP English / Unicode 中文；不是物理键盘/IME 候选窗验收                                                 |
| 6   | 关闭其他窗口后可见   | **未验证**                 | 只关闭自建 Edge、最小化 cover；其余用户应用保持，不声称已验证桌面露出                                                     |
| 7   | Win+D 显示桌面仍可见 | **实际失败**               | IsIconic=true，窗口被最小化                                                                                               |
| 8   | 再按 Win+D 恢复      | **实际通过**               | 本机恢复非最小化和原尺寸；未认证所有用户窗口堆叠还原                                                                      |
| 9   | Alt+Tab              | **未验证**                 | 不以 set_focus 代替真实快捷键；恢复控制窗可达性须人工检查                                                                 |
| 10  | 最小化/恢复其他窗口  | **部分满足**               | 自建 cover 操作完成、原型仍存在；窗口都关闭后的桌面可见性未证实                                                           |
| 11  | 全屏软件             | **部分满足**               | 自建 Tauri 无边框全屏窗在上、前台不被夺走；独占游戏、视频、多个显示器未验证                                               |
| 12  | 锁屏/解锁            | **未验证**                 | 不自动锁定当前用户会话                                                                                                    |
| 13  | 正常重启             | **实际通过**               | 独立研究进程关闭/重开，默认普通模式、无临时文本；不声称正式驻留偏好持久化                                                 |
| 14  | 返回普通窗口         | **实际通过**               | 独立 recovery IPC 清除约束、show/unminimize；显式激活后普通非置顶并可点击；不是 Shell 子窗恢复                            |
| 15  | 普通→置顶            | **实际通过**               | 原生 WS_EX_TOPMOST=true，确在 cover 前                                                                                    |
| 16  | 三模式互斥           | **实际通过**               | 原型协调入口先清两旗再设目标；直接同时 true 的风险单独记录                                                                |
| 17  | 拖动/缩放            | **部分满足**               | bottom 真实 OS 标题拖动与东南角缩放通过；其余方向未逐个验证。遮挡拒绝与仅 API 结果单独保留                                |
| 18  | 透明/轻玻璃/毛玻璃   | **部分满足**               | 原生透明窗口、HostBackdropBrush enable/disable 与内容事件可运行；未复制三材质 CSS、未测视觉/复杂背景像素                  |
| 19  | 多显示器/混合 DPI    | **未验证**                 | 仅当前 scale=2，未切系统 DPI、不做显示器热插拔；WebView 模拟不能替代                                                      |
| 20  | Explorer 重启        | **未验证**                 | 没有安全可丢弃的隔离 Shell，本机未执行                                                                                    |

Windows 10、其他 Windows 11 构建、实际混合 DPI、多 GPU、独占全屏、远程桌面、休眠、节能和无障碍策略均未认证。本机窗口测试不是完整日历任务/SQLite 回归；原型没有这些功能。

[Microsoft 对 Win+D 的说明](https://devblogs.microsoft.com/oldnewthing/20241021-00/?p=110393) 与本机结果一致：先最小化可最小化窗口，再提升桌面。去除 WS_MINIMIZEBOX 最多避开最小化，不保证窗口位于提升后的桌面之上；本轮未实现或验证这种替代，不能据此宣布解决。

## 可恢复性与正式实现预估

| 风险                            | 最安全候选处理                                                                                              | 本轮证据 / 缺口                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------ |
| 无法点击 / 被壁纸挡住           | 保留独立普通控制入口，外部 safe-normal 启动；取消 bottom 后 show/unminimize、校验工作区，用户主动恢复才聚焦 | recovery IPC 实测；壁纸后方、控制窗物理入口/托盘与热键未验证 |
| 点击后上浮                      | A 的事件驱动机制有原生点击/激活证据；拒绝单次 B 作为最终方案                                                | 完整任务/菜单/弹窗仍待测；不能上高频重排                     |
| 设置/编辑弹窗打不开             | 正式应用优先保留同主窗 DOM 抽屉；独立原生对话框必须校验 owner、顺序与焦点                                   | 原型无正式对话框，未验证                                     |
| 切换半成功 / top 与 bottom 冲突 | 串行事务式转换，先清约束、再设目标、观察原生状态；成功才持久化，失败尝试 normal 并提供退出                  | 原型互斥入口实测，不含持久化或错误注入                       |
| Explorer 消失 / 重启            | A/B 不主动依附 Explorer；C 若研究必须保存窗口样式/几何、检测宿主销毁并由独立入口重建 normal                 | Shell 生命周期未验证，不能承诺 SetParent(NULL) 总能救回      |
| 桌面图标/任务栏异常             | 不改变 Shell 窗口；C 只在 VM 快照研究，异常停止并回滚快照                                                   | 本轮无 Shell 修改，不等于已认证所有任务栏行为                |
| 显示器断开导致离屏              | 复用现有 visibleBounds，监听显示器/DPI 变化并限制尺寸位置；恢复入口可移回主工作区                           | 现有源码已有启动约束；原型热插拔未验证                       |
| UI / 进程挂死                   | 独立救援进程或新进程 safe-normal；不自动再次进入上次失败模式；保留正常任务数据                              | 同进程 watchdog 不是挂死全保证；外部精确子进程终止可用       |

若以后获准 B，预计范围：新增三值窗口模式类型及旧 always_on_top 迁移/兼容、设置与图钉语义、Rust 模式协调与错误回退、capability、启动/单实例唤起、可见边界、独立恢复入口、状态持久化与备份兼容、真实桌面测试及手册。无需为窗口模式改变任务表；也不能让模式错误影响任务写入。A 路线为**中等**工作量/**高兼容风险**；WorkerW 为**大**工作量/高风险，包含宿主重建与更多系统矩阵；均不是精确工时或发布日期。

进入 SL-006-B 的门槛：用户明确接受经证明的方案和限制；Win+D 的目标有实际解决证据；原生鼠标/IME/弹窗/拖动、全屏/锁屏/重启、Win10/11 与显示器组合补齐约定范围；失败可从独立入口恢复。当前不满足，维持 Research，不开发正式功能。

## Git、验证与发布边界

本轮提交范围仅报告、需求/决策/验证同步、隔离研究源码与必要测试。最终 Commit / Push / CI 以交付消息和 GitHub 对应 SHA 的真实运行结果为准；研究源码被 Push 不表示发布。没有 Tag、Release、安装器、正式窗口改动或用户数据库操作。没有公开桌面截图、个人壁纸/照片、备份、密钥或本机绝对路径。
