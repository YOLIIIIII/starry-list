# SL-006-A 独立桌面原型

用途、结论、完整矩阵和兼容性边界见 [研究报告](../../docs/research/SL-006-WINDOWS-DESKTOP-RESIDENCY.md)。Windows 11 研究程序，不是 Starry List 功能，不制作安装包。

| 文件                                  | 用途                                                               |
| ------------------------------------- | ------------------------------------------------------------------ |
| Cargo.toml / Cargo.lock               | 独立包，锁定与项目相同的关键 Tauri / Tao / Wry 版本                |
| tauri.conf.json                       | 独立研究标识与三测试窗；bundle.active=false                        |
| capabilities/probe.json               | 仅研究窗可用的 bottom / top / 几何 / 焦点权限                      |
| src/main.rs                           | 互斥模式入口、单次 Win32 对照、只读窗口观测、恢复/超时退出         |
| ui/                                   | 合成按钮与内存文本；没有日历、任务或数据库                         |
| native-input.ps1                      | 真实鼠标与 Win+D；PID/根窗命中检查，不点击遮挡的其他应用           |
| ../../scripts/sl006-desktop-probe.mjs | 独立 WebView2/Edge profile，测试与本地 evidence.json               |
| evidence-2026-10-26.json              | 实际测量的归一化公开副本，删除原生句柄与本机路径；保留失败与未验证 |

在仓库根目录运行（先安装项目依赖，使用 Node 24 / Rust 1.90 MSVC）：

```powershell
$env:CARGO_HOME = Join-Path (Get-Location) '.cache/cargo'
$env:CARGO_TARGET_DIR = Join-Path (Get-Location) 'src-tauri/target'
cargo build --manifest-path research/sl006-desktop-probe/Cargo.toml --locked --offline
& ./.tools/node-v24.21.0-win-x64/node.exe scripts/sl006-desktop-probe.mjs
# 顺序运行，独立验证 120 秒解除 bottom 约束：
& ./.tools/node-v24.21.0-win-x64/node.exe scripts/sl006-desktop-probe.mjs --watchdog-only
```

没有本地 Node 时使用系统 Node 24；没有缓存时去掉 --offline。不要使用正式 starry-list.exe 替代研究 exe。直接启动研究 exe 也使用独立研究标识，自动化进一步覆盖到唯一 WebView profile。

测试将短暂打开三个可见窗口和独立 Edge，并成对执行 Win+D；请勿同时进行鼠标操作。原型 120 秒清除 bottom/top、180 秒退出；控制窗“返回普通窗口”和“退出研究程序”随时可用；也可在任务管理器仅结束 sl006-desktop-probe.exe。事件循环挂死时同进程 watchdog 不提供绝对保证，外部精确子进程句柄终止是另一条路径。

研究 runner 不因产品假设失败返回错误（例如 Win+D 不满足驻留是研究结果）；测试设施异常才设置非零退出码。窗口内容 CDP 输入不等于物理输入或中文 IME。被遮挡点拒绝真实鼠标输入，记为未验证，不放宽保护。

首次构建/测试的图标路径、HWND Send 类型、遮挡中止、前台请求/退出 IPC 设施问题已修正；失败尝试不计成功。120 秒解除约束已实际等待验证；180 秒自动退出与事件循环挂死恢复未验证。归一化实测摘要在本轮报告；完整原始日志仅在 `.cache/sl006-*/evidence.json`，不上传用户桌面截图。研究目录不会被正式构建入口引用。
