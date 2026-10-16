# 星轨日历 · Starry List

Lavender × Pastel Yellow × Cream。一个无需登录、可以留在桌面角落的离线日历清单。

**V1.0 · Windows 10/11 x64**。React 界面运行在 Tauri 2 原生窗口中；SQLite 是正式数据源，不使用浏览器 localStorage 冒充桌面持久化。实际构建与测试记录见 [验证记录](docs/VALIDATION.md)。

第一次使用？请阅读 [中文用户手册](docs/USER_GUIDE.md)，从「首次使用五分钟快速上手」开始。

[开发路线图 / Development Roadmap](docs/ROADMAP.md) · [需求池 / Product Backlog](docs/PRODUCT_BACKLOG.md) · [使用手册 / User Guide](docs/USER_GUIDE.md)

## 核心特点

- **统筹总览**：周一开始的完整月历、重要任务预览及从选中日期开始的连续七天日程；空日期保持紧凑，点击日期加号后按 Enter 添加任务。
- **专注编辑**：紧凑每日清单，点击标题先阅读详情，再点「编辑」打开独立抽屉。长文本分区滚动，底部始终可见「取消 / 保存并收起」；成功保存后收起，取消时保护未保存修改。原有切换及正常退出前的保存保护仍保留。
- 普通 / 星星 / 王冠三个优先级，完成状态独立保留；完成任务排在最后。使用上下箭头进行同一天、同完成状态任务排序。
- 内置六种可选分类，完整标题始终保留；月历通过 CSS 省略号显示摘要。
- 内置 2026 年中国大陆官方假期与补班，个人休息、加班可附加显示。未录入年份明确提示，绝不推测调休。
- 紫黄主题、自绘轨道图标、减少动画支持、380px 以上响应式布局。
- 无边框标题区拖动、边缘及右下角缩放、最小化、关闭、可选置顶、窗口状态与工作模式恢复。
- 40%–100% 背景不透明度，只调整背景 alpha，文字和输入区域保持完整不透明；提供实色背景开关与不透明原生窗口构建配置。
- JSON 导出、校验、合并或明确确认覆盖导入；SQLite 事务避免部分写入。删除可确认并撤销。

## 两种视图

总览适合掌握整个月与未来七天；点月历里的任务可直接进入专注编辑。专注适合将长任务拆成步骤、写会议准备或调研笔记。两种视图共享同一份数据库数据。

## 实际截图

以下来自本机实际 Tauri / WebView2 应用，使用**独立测试数据库中的示例任务**；不是设计稿。

![统筹总览](docs/screenshots/overview.png)
![专注编辑](docs/screenshots/focus.png)

[紧凑窗口](docs/screenshots/compact.png) · [设置面板](docs/screenshots/settings.png)

[编辑抽屉](docs/screenshots/editor.png) · [窄窗口编辑](docs/screenshots/editor-compact.png)

## 安装

1. 在本仓库 GitHub 的 **Releases** 中打开最新正式版本。
2. 从 **Assets** 下载 Windows x64 的 `Starry List_1.0.0_x64-setup.exe`（以实际生成文件名为准）。
3. 运行安装程序。首次安装需要系统具有 Microsoft Edge WebView2 Runtime；安装器内置引导程序，缺失运行时可能需要联网安装。**应用日常运行完全离线**。
4. 若透明渲染异常，先在设置中打开「实色背景回退」。若窗口本身无法正常呈现，可改装 Release 中带 `opaque` 的原生不透明窗口版本。

当前未配置代码签名，Windows 可能显示「未知发布者」或 SmartScreen 警告。自行构建的产物与发布者需建立信任后再安装。本项目尚未发布 GitHub Release；工作流会生成草稿供维护者检查。

## 开发环境

- Windows 10/11 x64；Node.js 24 LTS（最低 22.12），npm。
- Rust **1.90.0**，MSVC 工具链（项目通过 rust-toolchain.toml 固定版本）。
- Visual Studio Build Tools：C++ x64/x86 编译工具、Windows 10/11 SDK。
- Microsoft Edge WebView2 Runtime。

```powershell
npm ci
npm run tauri dev
```

`npm run dev` 单独启动浏览器只用于前端开发，界面会明确提示需要原生应用，不会创建假数据库。

```powershell
npm run typecheck
npm run lint
npm test
npm run build
cargo fmt --manifest-path src-tauri/Cargo.toml --check
cargo test --manifest-path src-tauri/Cargo.toml --locked
```

本工作区另有 `.tools/node-v24.21.0-win-x64` 与 `.tools/vs-buildtools` 本地构建工具，均被 Git 忽略。使用前将 Node 目录加入当前会话 PATH；公开仓库使用正常安装的开发工具即可。

本工作区原有 Node 16，建议直接使用会自动选择项目本地 Node 与依赖缓存的 PowerShell 启动脚本：

```powershell
.\scripts\desktop.ps1 dev
.\scripts\desktop.ps1 check
.\scripts\desktop.ps1 build
.\scripts\desktop.ps1 build -Opaque
```

## Windows 打包

```powershell
npm run tauri build
# 原生不透明回退版
npm run tauri build -- --config src-tauri/tauri.opaque.conf.json
```

NSIS 安装包输出：`src-tauri/target/release/bundle/nsis/`。显式使用 `--target x86_64-pc-windows-msvc` 时，路径为 `src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis/`。

项目使用 [Tauri 官方窗口 API](https://v2.tauri.app/reference/javascript/api/namespacewindow/)、[Window State 插件](https://v2.tauri.app/plugin/window-state/) 与 [官方 GitHub Actions 发布方案](https://v2.tauri.app/distribute/pipelines/github/)。无需桌面图标层 Hack。

## 创建 GitHub Release

1. 将仓库推送到自己的 GitHub 远程，确保默认分支 CI 通过。
2. 更新 `package.json`、`src-tauri/Cargo.toml`、`src-tauri/tauri.conf.json` 的一致版本及 CHANGELOG。
3. 创建匹配版本的标签并推送：

```powershell
git tag v1.0.0
git push origin v1.0.0
```

4. `release.yml` 在 Windows x64 上运行检查、原生测试、Tauri 打包，并创建 **Release 草稿**，附带默认透明版与 opaque 版 NSIS 安装包。
5. 检查产物、填写发布说明，并在 GitHub 手动发布草稿。未配置签名不会假称已签名。源码提交与推送不等于正式发布；Tag 和 Release 需要单独明确授权。

## 数据与隐私

- 数据库：`%APPDATA%\app.starrylist.desktop\starry-list.db`（由 Tauri `app_data_dir()` 解析）。窗口状态由官方插件保存到应用配置目录。
- `Task`、`Category`、`DayMark`、`AppSettings` 分别存储。官方假期是只读年份 JSON；来源：[国务院 2026 年节假日通知](https://www.gov.cn/zhengce/zhengceku/202511/content_7047091.htm)，国办发明电〔2025〕7号。
- Rust `rusqlite` 使用捆绑的 SQLite、WAL、完整同步、外键约束、参数化 SQL；数据库连接由互斥锁保护，前端写入队列串行执行，成功后再同步 UI。选择 Rust 管理 SQLite，是为了让导入、覆盖和排序在**同一连接的真实事务**中完成，而不依赖 SQL 插件连接池里的多次 IPC 事务调用。
- `PRAGMA user_version` 驱动版本化迁移，迁移在事务中执行；较新数据库不会被旧应用清空。
- JSON 备份版本为 1，包含任务、分类、个人日期标记和设置。最多 32 MB 的导入文件；不含窗口坐标。前后端均校验结构、日期、引用和重复 ID。
- 默认合并：已有任务不变；重复任务 ID 生成新 ID；有冲突的分类 ID 映射为新 ID；已有同日期个人标记保留；设置不覆盖。同一份备份重复导入可能产生重复内容，这是保留用户数据的策略。
- 覆盖导入会先要求勾选并输入「覆盖」；删除和重建在同一事务内完成。覆盖前请手动导出。
- 无账号、云端、遥测、在线字体或远程图标。数据未加密，依赖本机账户权限保护。卸载前先导出备份；不要上传个人数据库到 GitHub。

## 主要结构

```text
src/
  App.tsx               双视图与设置交互
  components.tsx        任务行、长文本编辑器、快速新增、对话框
  domain.ts             类型、日期、排序、预览、备份校验
  store.ts              串行写入与共享状态
  platform.ts           Tauri IPC、窗口、原生文件对话框
  holidays/2026.json    官方节假日元数据与日期集合
  styles.css            主题、响应式、动画
src-tauri/
  src/db.rs             数据库、校验、事务及原生测试
  src/lib.rs            IPC、插件与桌面初始化
  migrations/           版本化 SQL
  capabilities/         窗口与文件对话框权限
scripts/desktop-smoke.mjs  真正的 WebView2/SQLite 冒烟验证
.github/workflows/     Windows CI 与 Tag 发布
docs/VALIDATION.md     验证范围与限制
```

## 开发路线图 / Development Roadmap

详细计划见 [开发路线图](docs/ROADMAP.md)，需求、优先级、状态与验收标准见 [产品需求池](docs/PRODUCT_BACKLOG.md)，重要取舍见 [产品决策记录](docs/DECISIONS.md)。登记需求不会自动启动开发，不承诺未经评估的版本范围或发布日期。

UX2.3 修复总览 Enter 保存后返回原日期加号的连续新增体验，新增/删除撤销通知移至顶部居中、约 5 秒；SL-002 / SL-019 仍 In Review，待用户体验验收。SL-021 行内标题编辑已记录用户确认并标记 Done，尚未正式发布；SL-004-A 的 14px 与 In Review 状态不变。SL-022 每日星星与 SL-023 星河仅登记。之后再评审透明视觉、全局字号和顶部空间。桌面驻留先研究可行性；自然周与切换流畅度可独立评估。主题、分类管理、重复任务、搜索、位置锁定、macOS 和可选云端能力均保留在需求池中。

当前初始 V1.0 源码已同步，第一轮 UX 改进已作为独立实现提交 [`23a7cd3`](https://github.com/YOLIIIIII/starry-list/commit/23a7cd3941a28d0724e254ca7b9bb71c9b8fd5c8) 纳入历史；SL-001 / SL-002 仍为 In Review，等待最终用户验收。本项目尚无正式 GitHub Release。原 V1.1 / V2.0 列表作为候选想法整合到需求池，不代表已实现功能或发布日期。

## 许可证

[MIT](LICENSE)，Copyright (c) 2026 yoli。
