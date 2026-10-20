# V1.0 验证记录

## 2026-10-20：UX3.0.1 外观模式与通知续修

范围为 SL-003-A 外观设置与 SL-003-B 通知布局；SL-003 继续 In Review，等待用户安装确认。阅读优先默认，新增轻玻璃与梦幻毛玻璃，14px、顶部结构、双视图、任务数据结构不变。原 SL-019 / SL-002 的 UX2.3 验收历史保留，不把本轮视觉续修当成正式发布。

### 数据与材质边界

- 沿用 SQLite `app_settings.value` JSON，增加 `appearance_mode`，没有修改表、迁移文件或 `user_version=1`。旧设置/旧版本 1 JSON 缺字段时默认 reading，读取不改写旧设置；新增设置可靠写入后才更新界面。未知模式拒绝，原任务、分类与排序不变。
- Tauri 官方 `setEffects({effects:[Effect.Acrylic]})` / `clearEffects()`，仅新增 `core:window:allow-set-effects` 权限。直接复用锁文件已存在的 windows-version 0.1.7 检测系统，锁文件只增加根依赖引用，没有升级其他包。Acrylic 限定透明原生窗口、Windows 11 build 22621+、非实色回退且低于 100%；异步请求串行，其他模式和 100% 主动清除。旧系统/不透明/请求失败使用保护更强的柔紫底色；系统透明效果等仍可能影响最终像素。
- 未用 CSS backdrop-filter 冒充桌面模糊；主字体和输入不降低 opacity。原生模糊请求是否成功与实际渲染分开记录，技术依据见 [材质说明](UX3_0_1_VISUAL_REVIEW.md)。
- 通知短文案没有 flex 导致关闭按钮紧随左侧文字，现文案占剩余宽度、关闭最右、撤销在前。所有成功通知共用约五秒与 hover / focus / 弹窗暂停；撤销保留独立状态与原 SQLite 操作。

### 检查结果

- TypeScript、Lint、**119 项前端测试**及生产构建通过：58 App、6 通知、32 域逻辑、9 surface、3 原生材质调用、5 store、6 窗口边界。覆盖外观保存/重新加载/失败保持原模式、旧备份默认、单调透明度与降级保护、原生请求串行/失败重试，以及普通恢复通知暂停计时。最终补充检查以本节收尾记录为准。
- Rust fmt、**13 项 Rust/SQLite 测试**及 Clippy `-D warnings` 通过。新增旧设置/备份兼容、读取不改写、表版本不变、三模式设置/导出和错误模式拒绝测试。
- **23 组真实 Windows 11 / WebView2 交互回归通过**：真实独立 Edge 获得前台后失焦新增、原日期及不抢焦点、Enter 连续新增、行内修改、完成、删除/撤销、通知五秒及暂停、长计划/抽屉与草稿保护、真实 SQLite INSERT / UPDATE / DELETE 失败/重试、导入导出、原生关闭及重启。追加外观偏好真正跨原生进程重启保留；只访问独立调试库，不接触安装版数据。
- **72 张真实 Windows 合成矩阵**：4 个自制背景 × 3 档透明度 × 2 主视图 × 3 材质，逐项通过溢出/14px/文本采样检查。Windows 11 25H2 build 26200.9457、当前约 200% 屏幕比例；矩阵逻辑窗口为 980 × 620，给模糊采样留出合成背景边界。样例日历固定 2026-10-19，计时器仍是真实时间。
- 梦幻模式系统 `DWMWA_SYSTEMBACKDROP_TYPE=3`，其他模式 / 100% 为非 3，确认实际系统材质配置启用与清除。还检查真实截图；API 返回成功不是唯一证据。三种 100% 的外壳采样像素各不相同，证明实色也保留材质配色区别。读取 DWM 属性只用于测试助手，不给应用新增底层窗口控制。
- 指定阅读区采样底色与主文字颜色计算的最低对比度：阅读约 **12.63:1**、轻玻璃约 **8.63:1**、梦幻约 **7.20:1**。首轮梦幻 40% 专注采样曾为 6.90:1，已提高该面板 alpha 后复测达标；未改变外壳滑块值。这是指定点检查，不是全界面 WCAG 认证或所有背景的保证。
- **48 项前景 WebView 视口截图及几何检查通过**：三材质 × 四宽度（980 / 760 / 500 / 380）× 只读详情、长文本抽屉、设置弹窗及顶部通知。关闭按钮到提示右边缘不超过 12px，新增撤销提示与普通「已撤销新增」均检查，保存按钮可见，菜单命中、无横向溢出。前景截图仅包含测试 WebView，**不包含原生桌面合成**，不把它当成 Acrylic 纹理证据。
- 前景原生截图被窗口叠放保护拒绝，曾试验只调整测试窗口叠放，仍受 Windows 前台规则影响；最终保留拒绝机制并使用明确标注的视口检查。没有关闭、隐藏或修改用户其他应用。真实合成截图前后检查自制背景、前台、无无关窗口，并额外保护四周 64 物理像素；不会为让测试通过而放宽私人内容保护。
- 原生不透明调试构建成功；三种模式的 **48 项前景视口检查**通过，原生透明能力为 false、滑块禁用、界面不声称透视。另检查两视图 × 四宽度 × 三模式 × 三档保存偏好共 **72 组原生配置/布局组合**，全基础 alpha 为 1、无横向溢出。不透明完整桌面合成矩阵未执行，不以视口截图替代它。

### 复现与未验证范围

按下方 UX3.0 的独立标识配置构建调试版后运行；正式配置不可添加测试专用 set-focus 权限。

```powershell
npm run test:appearance -- --matrix-only
npm run test:appearance -- --foreground-only --viewport-only
npm run test:desktop
```

结果与完整矩阵在忽略的 `.cache/visual-materials-*`；公开图片全部为自制背景与隔离示例。三种材质的公开图及来源见 [UX3.0.1 对比](UX3_0_1_VISUAL_REVIEW.md)。原生不透明调试构建合并已有 opaque 配置后，添加 `--opaque` 运行相同前景检查。

本轮未完成梦幻材质下真实鼠标拖动/边缘缩放的独立验证；原生 API 调整窗口与先前 UX3.0 拖动证据不能替代本轮材质性能验收。未实际安装/覆盖/卸载，未独立验证 Windows 10、旧 Windows 11、不同 GPU/远程桌面/节能组合、真实 IME 候选窗、混合 DPI 和多显示器。全局字号、顶部重排、桌面驻留及星河未开发。本轮视觉仍等待用户确认。

### UX3.0.1 交付收尾

最终 `npm run check` 再次通过 TypeScript、Lint、119 项前端测试与生产构建；Rust fmt 检查通过。默认透明与原生不透明的生产配置 Windows x64 NSIS 构建均成功。BUNDLEID 仍为 `app.starrylist.desktop`、正式版本仍为 1.0.0，Publisher / Copyright 为 yoli；体验迭代名仅用于独立归档文件名，不创建 Tag 或 Release。测试用 set-focus 权限未加入正式 capability。

| 安装包（本地 artifacts/，不提交 Git）                             | 字节数    | SHA256                                                             |
| ----------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `Starry-List_1.0.0_x64-ux3.0.1-preview-20261020-setup.exe`        | 5,224,040 | `1686b497f5f910445ba7cf422425e75ce96cc1156804ff3ae9945e589d98aa2e` |
| `Starry-List_1.0.0_x64-ux3.0.1-opaque-preview-20261020-setup.exe` | 5,224,109 | `3520ada2bb76565d2936c4552f4311bd48600dfdfe3e41d82886f302c1e324ca` |

校验文件：`artifacts/UX3.0.1-PREVIEW-20261020-SHA256SUMS.txt`。UX3.0 两个旧归档包校验值未变；正式 SQLite 主文件测试前后校验值一致。未关闭用户安装版、未删除或重置数据库。安装体验前请自行导出备份、正常退出旧版后按手册覆盖；本轮没有执行安装器。

本轮实现提交：[`faa14e8`](https://github.com/YOLIIIIII/starry-list/commit/faa14e8e06f328001af6d82dec898ae0969d8b6c)；文档与自制示例截图独立提交。安装包和完整测试目录不提交 Git。

## 2026-10-20：UX3.0 透明视觉体系（SL-003）

仅改透明视觉层级与测试工具：连续圆角顶栏、真正随滑块变化的透明外壳、稳定奶油色阅读衬底和清楚的前景。14px、顶部排布、日期计算、任务排序、数据库 Schema、应用标识及 UX2.3 交互不变。不依赖模糊滤镜或新增原生窗口特效。

用户确认 UX2.3 体验良好；对照此前逐项标准、100 项前端及 22 组桌面证据，SL-002 / SL-019 记录 2026-10-19 用户确认并标记 Done。SL-021 已 Done，未重复修改。SL-001 / SL-004-A 仍缺独立完整验收，保留 In Review；用户未再反馈 14px 问题不等于关闭字号父需求。SL-003 实现后 **In Review**，等待本轮体验版视觉确认；所有事项均未正式发布。

### 自动化与真实桌面结果

- `npm run check`：TypeScript、ESLint、**109 项 Vitest**（57 App、5 撤销提示、31 域逻辑、5 store、6 窗口边界、5 视觉 alpha）和前端生产构建通过。新增测试覆盖 40% / 70% / 100% 的真实外壳数值与持久化、局部衬底单调增强、实色回退禁用/恢复偏好，不用父级 opacity。
- `cargo fmt --check`、**11 项 Rust/SQLite 测试**及 Clippy `-D warnings` 通过。没有修改 Rust 业务实现、迁移、Tauri 生产配置或 capability。
- **22 组 Windows 11 / 原生 WebView2 交互回归通过**：Enter 在三个日期分别连续新增三条、加号焦点返回、失焦新增与撤销、行内更新、完成、删除确认/撤销、顶部约 5 秒通知及独立暂停、长计划与固定保存栏、抽屉草稿保护、真实 INSERT / UPDATE / DELETE 失败重试、导入导出及重启持久化。独立 Edge 实际获得前台后，标题只保存一次且保持原日期；原生 `is_focused=false`，保存不重新激活应用。
- 桌面回归首次跨软件等待超时；重试确认自动新增成功，但先关闭测试 Edge 再撤销可能超过 5 秒。测试现先回到应用撤销，再关闭自己创建的浏览器，最终完整通过；没有延长产品通知时间或修改新增逻辑来适应测试。
- **48 张真实合成背景矩阵截图通过**：4 种自制背景 × 3 档透明度 × 2 主视图 × 新旧 2 套样式；另有 **16 项前景截图检查**，覆盖 980 / 760 / 500 / 380px 的菜单、只读长详情、固定抽屉保存栏、设置和顶部通知，无水平溢出，菜单与按钮命中正常。真实 OS 鼠标拖动标题区及右侧边缘缩放成功，不仅是调用 set-size。
- 环境为 Windows 11 25H2、build 26200.9457，截图使用当前屏幕约 200% 比例；不等于混合 DPI 认证。四种背景是脚本绘制的浅色几何、深色圆环、高对比色块与斜线、密集测试文字/图标；全部任务为自建隔离示例。截图前后检查自制背景覆盖、测试应用前台及无无关窗口穿入，条件不满足拒绝写图。未使用私人壁纸、照片或个人窗口内容。
- 相同阅读区采样点跨背景最大 RGB 通道变化：40% 时旧总览 / 专注为 26 / 39，新版为 2 / 1；70% 为旧 35 / 52、新 0 / 0；100% 均为 0。新版外壳采样仍为 131 / 66 / 0，证明透明度没有被伪装为相同效果。新版采样底色与主文字颜色计算对比度最低约 12.63:1；只代表指定采样，不宣称所有文字完成无障碍认证。
- 新旧对比是固定 `d50af11` 编译 CSS 与旧 alpha 公式在同一应用中的样式基线，不是旧安装包重新运行。前端日历固定 2026-10-19，计时器仍使用真实时间；旧样式可从 Git 历史独立编译，已验证缓存为空时的生成。方法、原图与比较见 [视觉对比](UX3_VISUAL_REVIEW.md)。

### 隔离复现

Node.js 24、Rust、Windows WebView2 / Edge 就绪后使用以下**仅测试**配置；不将额外权限加入正式构建。测试只关闭自己创建的进程。

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
'{"identifier":"app.starrylist.desktop.ux30-test","app":{"security":{"capabilities":["main-capability",{"identifier":"ux30-focus-test","windows":["main"],"permissions":["core:window:allow-set-focus"]}]}}}' | Set-Content .cache/ux30-test.conf.json -Encoding utf8NoBOM
npm run tauri build -- --debug --no-bundle --config .cache/ux30-test.conf.json
npm run test:desktop
npm run test:visual
```

`test:visual` 需要完整的 Git 历史来编译固定旧样式；结果矩阵、隔离数据库和完整原图保存在忽略的 `.cache/visual-*`，公开文档只保留已逐张检查的自制示例。原生不透明调试配置需要合并 `src-tauri/tauri.opaque.conf.json` 与独立测试标识/权限，再运行 `npm run test:visual -- --opaque`；不要误用安装版或正式数据目录。

### 不透明回退与交付

原生不透明调试构建成功；本轮不透明合成截图两次因隐私保护发现无关窗口而被拒绝，**不将其记为视觉通过**。另用不截屏的隔离原生窗口检查：`native_transparency=false`，两种视图 × 四种宽度 × 40% / 70% / 100% 的已保存偏好共 **24 组**均为全 alpha=1、无水平溢出，四种宽度的滑块均禁用。实色回退的偏好恢复另有前端测试。真实不透明背景的完整合成截图矩阵仍待补齐。

默认透明与原生不透明的**生产配置 Windows x64 NSIS 构建均成功**；安装包独立归档，无测试专用配置/权限，BUNDLEID 仍为 `app.starrylist.desktop`，Publisher / Copyright 为 yoli。体验包如下，校验文件为 `artifacts/UX3.0-PREVIEW-20261020-SHA256SUMS.txt`：

| 安装包（本地 artifacts/）                                       | 字节数    | SHA256                                                             |
| --------------------------------------------------------------- | --------- | ------------------------------------------------------------------ |
| `Starry-List_1.0.0_x64-ux3.0-preview-20261020-setup.exe`        | 5,222,532 | `c4ff894071b27f87a9216ef06407f1bc8bc39d6747bfec92e134d7fd9c981fba` |
| `Starry-List_1.0.0_x64-ux3.0-opaque-preview-20261020-setup.exe` | 5,221,615 | `f8413c514a7c3622476a5da263b7ccd66e7ad699fe4017cc0d9022220ee9aef0` |

尚未执行安装器、同版本覆盖、卸载；未验证独立 Windows 10、真实中文输入法候选窗、不同 GPU、混合 DPI / 多显示器。中文输入法组合事件与不同设备比例由既有前端/WebView 测试覆盖，不冒充真实 IME 或硬件认证。复杂壁纸下外壳轻盈程度、内容衬底是否过厚、圆角与配色仍须用户最终确认；SL-004 / SL-005 留 UX3.1 独立授权，SL-006 及星星/星河未开发。

正式 SQLite 主文件测试前后 SHA256 一致；所有测试写入独立测试目录，未删除、重置或迁移用户数据。安装包、测试数据库与全量原图不纳入 Git；旧 UX2.3 包保留，不创建 Tag 或正式 Release。

本轮实现提交：[`4e640e0`](https://github.com/YOLIIIIII/starry-list/commit/4e640e0b87e39fe0308e9ab00549971bd235605f)；验证记录、需求状态、用户手册和自制对比截图另作文档提交。

## 2026-10-16：UX2.3 通知与连续新增修复

范围仅为 SL-002 Enter 成功后的焦点返回及 SL-019 新增/删除通知位置与时长。失焦自动新增、已有任务完整编辑和 SQLite Schema 均未修改；14px 与 SL-004-A / In Review 不变，SL-022 / SL-023 仅规划。用户已认可 UX2.2 应用内/跨窗口失焦新增、新增撤销与七天行内修改；核对既有标准和测试证据后记录 SL-021 用户确认并标记 **Done**，仍未正式发布。SL-002 / SL-019 继续 **In Review**，等待本轮体验验收。

- `npm run check`：TypeScript、ESLint、**100 项 Vitest**（53 项 App、5 项通知、31 项域逻辑、5 项 store、6 项窗口边界）与前端生产构建通过。Rust fmt、**11 项 Rust/SQLite 测试**及 Clippy `-D warnings` 通过。
- **22 组真实 Windows 11 / WebView2 回归通过**。在三个不同日期各连续新增三条任务，确认第一次 Enter 只保存、成功后焦点返回正确加号、第二次 Enter 重新展开，SQLite 日期正确且无重复；清理的仅为隔离测试库中的自建记录。前端另外用延迟 Promise 验证等待成功才返回、指针/Tab/导航/窗口失焦取消迟到返回，按钮/外部点击保存不返回，失败保留草稿，按住 Enter 不提前聚焦或重复新增；IME 组合、取消优先和原编辑抽屉保护继续回归。
- 焦点返回由 Enter 提交产生可取消请求，等该键释放和持久化成功，再检查当前视图、原日期按钮是否仍存在，以及原生窗口是否仍在前台。使用 Tauri `isFocused()` 后仅作 DOM focus，不调用原生 set-focus；测试专用 set-focus 权限仍只存在忽略的调试配置。浏览器单测明确模拟前台状态，不把 jsdom 的焦点行为当成真实桌面证据。
- 真实跨软件：独立临时 profile 的 Edge 获得 Windows 前台，Starry List 原生 `is_focused` 确认为 false；失焦自动新增仅一次并保存原日期，保存后原生状态仍为 false，未重新激活窗口。只关闭测试脚本创建的应用/浏览器，不关闭用户应用。
- 新增/删除通知由独立计时器管理，约 **5 秒**；hover / 键盘焦点暂停，离开恢复剩余时间，手动关闭和卸载清理，失败保留重试，超时不修改数据库。前端连续删除两条分别撤销仍通过；原生测试连续删除两条后暂停其中一条，另一条 5 秒到期，SQLite 不受影响，暂停项撤销完整恢复原任务。
- 顶部居中 **24px 单行区域**不推动布局；多条保留各自撤销与计时，可通过数量按钮逐条查看或 Tab 访问。980 / 860 / 760 / 500 / 380px、两种主视图逐项检查与 Logo、窗口按钮、模式切换、日期导航、输入及主标题的几何交叠，均无交叠；区域外命中测试通过。窄窗口通知只临时隐藏装饰性眉题以使用现有间隙，不移动主体布局。编辑抽屉、删除确认、设置及导入弹窗隐藏并暂停撤销提示；真实抽屉打开超过 5 秒后仍可撤销，前端验证恢复剩余时长。
- 真实 SQLite INSERT / UPDATE / DELETE 失败、重试、撤销、原日期、任务阅读/长文本、固定保存栏、关闭保护与重启持久化、导入导出及窗口能力继续回归。已有测试截图均来自自建隔离示例，并已逐张检查；不含用户壁纸、照片或个人任务。正式数据库主文件测试前后 SHA256 一致，未删除、迁移或重置用户数据。

### 复现本轮隔离桌面测试

Node.js 24、Rust、Windows WebView2 / Edge 就绪后，使用独立调试标识和测试专用权限；以下配置不得用于正式打包。

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
'{"identifier":"app.starrylist.desktop.ux23-test","app":{"security":{"capabilities":["main-capability",{"identifier":"ux23-focus-test","windows":["main"],"permissions":["core:window:allow-set-focus"]}]}}}' | Set-Content .cache/ux23-desktop.conf.json -Encoding utf8NoBOM
npm run tauri build -- --debug --no-bundle --config .cache/ux23-desktop.conf.json
npm run test:desktop
```

### 体验构建与边界

正式默认透明配置的 Windows x64 NSIS 构建通过；独立体验包为 `artifacts/Starry-List_1.0.0_x64-ux2.3-preview-20261016-setup.exe`（5,218,484 bytes），SHA256：`17aab0d6e40ef444e4c670852e5c505f50ef846e30f181ee67a7c7054390047b`。校验文件为 `artifacts/UX2.3-PREVIEW-20261016-SHA256SUMS.txt`。生产 BUNDLEID 保持 `app.starrylist.desktop`，发布者/版权仍为 yoli，测试标识及 set-focus 权限未加入正式配置。旧包全部保留，安装包及校验文件不提交 Git，本轮未重建不透明回退包。

未实际运行安装器、同版本覆盖、升级或卸载；未验证独立 Windows 10、真实中文 IME 候选窗、混合 DPI / 多显示器与不同 GPU。前端组合事件模拟及 WebView 缩放模拟不等于这些实机认证。进程崩溃、断电或强制结束不承诺尚未持久化的草稿恢复。普通浏览器失焦自动新增不受影响；慢速保存后再切换其他软件的防抢焦点由前端延迟测试覆盖，未对真实窗口额外注入 SQLite 慢写入。用户可按 [手册](USER_GUIDE.md) 自行备份、正常退出旧版后安装同版本体验包；不要选择删除应用程序数据。未创建 Tag 或正式 Release。

本轮实现提交：[`277ca90`](https://github.com/YOLIIIIII/starry-list/commit/277ca906816e94aa76eaabb0726800bafdd16054)；需求、手册、验证和自建测试截图另作文档提交。

## 2026-10-16：UX2.2 快速操作精修

本轮仅实现 SL-002 可靠失焦自动新增、SL-019 独立撤销提示计时和 SL-021 七天日程行内标题修改。上述事项仍为 **In Review**；SL-001、SL-004-A 不关闭，14px 不变，SL-004 全局字号未实现。SL-022 每日星星（P2 / Backlog）、SL-023 星河（P2 / Idea）仅登记设计，无星星统计、奖励、页面或最终视觉资产代码。SL-018 / SL-020 保持原编号与范围。

- `npm run check`：TypeScript、ESLint、**88 项 Vitest**（42 项 App、4 项撤销提示、31 项域逻辑、5 项 store、6 项窗口边界）和前端生产构建通过。`cargo fmt --check`、**11 项 Rust/SQLite 测试**及 Clippy `-D warnings` 通过。
- **20 组真实 Windows 11 / WebView2 检查通过**。使用独立调试标识、数据库、窗口状态和 WebView profile；所有新增/更新/删除/备份操作只访问测试库。正式 SQLite 主文件测试前后 SHA256 一致，未关闭/卸载用户现有应用，未操作正式数据。
- 真实跨窗口：先用原生 `is_focused` 确认 Starry List 位于前台，再启动**独立临时 profile 的 Edge**，将焦点转到该浏览器，原生状态确认为失焦；标题只写入一次且归属原日期，回到测试应用可真正撤销新增。DOM `document.hasFocus()` 在 WebView 自动化中与原生状态不同，本次不以它作为跨窗口通过证据。只关闭测试脚本自己创建的应用/浏览器。
- QuickAdd 区域外点击、键盘失焦、WebView blur 与 Tauri [onFocusChanged](https://v2.tauri.app/reference/javascript/api/namespacewindow/#onfocuschanged) 进入同一保存 Promise；点击触发在点击完成后处理，避免收起输入区使日期按钮在鼠标按下/释放之间移位。真实 SQLite INSERT 失败保留原稿与日期，阻止范围导航；重试成功后才切换。组合输入的失焦先记录意图，compositionend 后延迟读取最终文字；若没有收到结束事件，仍保留草稿，不伪称已保存。
- 显式取消意图优先；区内操作不自动提交。原生测试发现「继续填写」按钮移除后会被误认作外部点击，改为检查事件原始路径；新行内编辑打开动作同样排除铅笔触发入口，避免刚打开就因外部点击而关闭。这些事件顺序问题已修正并回归；另补测行内保存尚未完成就删除的竞态，确认与撤销都读取最新已保存任务，避免恢复旧标题。
- 新增和删除各自有独立的约 8 秒撤销窗口。前端假计时测试覆盖超时、hover / focus 暂停与剩余时长恢复、关闭/卸载清理和失败重试；真实窗口确认指针进入后暂停、键盘焦点继续暂停、另一条未暂停通知到时消失，数据库无新修改，撤销完整恢复原任务。连续删除两条的独立撤销另有 App 测试。跨视图保留同一通知及剩余时间，不重复创建计时器。
- 行内标题编辑真实验证 Enter / 行外保存，SQLite 更新和视图同步；真实 UPDATE 失败保留输入，阻止切换和正常原生关闭；Esc 恢复原标题。前端覆盖空白拒绝、无变化不写库、取消和导航保护、原菜单及完整抽屉回归。
- 980 / 760 / 500 / 380px 原生窗口无水平溢出；长中文行内输入、铅笔/菜单命中、专注直接删除与排序箭头、固定抽屉保存栏和长文本回归通过。14px 保持不变；WebView 设备比例模拟不能代替真实混合 DPI / 多显示器认证。

并行编译期间曾出现前端 5 秒用例超时；编译结束后顺序重跑全部通过，未放宽测试超时。Vite 的第三方 Zod PURE 注释提示不影响产物；未修改依赖来隐藏提示。

### 复现隔离桌面测试

Node.js 24、Rust 与 Windows WebView2/Edge 就绪后，在 PowerShell 7 运行。以下配置仅用于测试，不用于正式打包；额外 set-focus 权限只存在于忽略的临时配置，正式 capability 未改变。

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
'{"identifier":"app.starrylist.desktop.ux22-test","app":{"security":{"capabilities":["main-capability",{"identifier":"ux22-focus-test","windows":["main"],"permissions":["core:window:allow-set-focus"]}]}}}' | Set-Content .cache/ux22-desktop.conf.json -Encoding utf8NoBOM
npm run tauri build -- --debug --no-bundle --config .cache/ux22-desktop.conf.json
npm run test:desktop
```

### 体验构建与未验证范围

默认透明 Windows x64 NSIS 体验包：`artifacts/Starry-List_1.0.0_x64-ux2.2-preview-20261016-setup.exe`（5,220,695 bytes）。SHA256：`017ff7d705c301451796f2278a0f1432299b254e506b0eb3500dfeae0c0bbe4c`；校验文件：`artifacts/UX2.2-PREVIEW-20261016-SHA256SUMS.txt`。生产 BUNDLEID 仍为 `app.starrylist.desktop`，test-focus 权限未加入正式 capability；旧体验包保留，本轮未重建不透明回退包。源码与文档可提交，安装包/校验文件留在忽略的本地 artifacts。安装前请自行导出 JSON 并正常退出旧版，按 [用户手册](USER_GUIDE.md) 的同版本覆盖流程操作。

未实际安装、同版本覆盖、升级或卸载；未做独立 Windows 10、真实中文 IME 候选窗、不同 GPU、混合 DPI / 多显示器认证。输入法组合由前端自动化模拟，仍请用户在实际输入法中验收。正常关闭有保存保护；进程崩溃、断电、强制结束、系统未发送结束/关闭事件不承诺未持久化草稿恢复。没有创建 Tag 或正式 Release。

本轮实现提交：[`afd262f`](https://github.com/YOLIIIIII/starry-list/commit/afd262f6923828097b7ccb7bf39eb51680aa9da0)；需求与文档另行提交。安装包仅保留在本地，尚未正式发布。

## 2026-10-16：UX2.1 用户反馈精修

实现提交：[`6d7c64e`](https://github.com/YOLIIIIII/starry-list/commit/6d7c64e5127d600a7e61485d9f44faa42e89bdd1)。用户认可 UX2 的空白收起、删除撤销、数据保持与布局；本轮简化非空快速新增的导航流程，专注行去除重复编辑入口，任务及输入文字从 15px 调整为 **14px**。SL-002 / SL-019 / SL-004-A 仍为 In Review；SL-004 父需求未完成，SL-020 同日拖动排序仅登记 P2 / Backlog，未实现。

- TypeScript、ESLint、**77 项前端测试**（35 项双视图、31 项日期/备份域、5 项 store、6 项窗口边界）通过，**11 项 Rust/SQLite 测试**通过；前端构建、Tauri 默认透明 Windows x64 NSIS 构建成功。旧测试的抽屉删除查询因新增同名图标需限定查询范围，修正测试后全部通过。
- **16 组真实 Windows 11 / WebView2 桌面检查通过**：非空普通外部点击不创建；显式取消确认；自动新增遇真实 SQLite INSERT 失败保留草稿并阻止导航，移除触发器后点击原导航可重试，保存归属原日期；删除失败、重试、撤销、任务详情、长文本和窗口状态等同时回归。
- 前端测试额外覆盖跨日期/模式/周的自动新增、等待写入后才导航、连续提交不重复、IME 组合时不提交/切换、专注删除键盘/取消/失败/撤销、未修改或改回原值的编辑抽屉不弹确认。真实 Windows IME 候选窗仍需人工体验。
- 980 / 760 / 500 / 380px 原生窗口均无水平溢出；总览菜单可命中且未被滚动容器裁切；输入、占位符和任务计算字号为 14px。专注 980 / 380px 检查删除图标与排序箭头不重叠。WebView 设备比例 1 / 1.5 / 2 的**模拟**检查通过，但不能替代独立设备、多显示器混合 DPI 或操作系统 100% / 150% / 200% 实测认证。
- 正式 SQLite 主文件测试前后 SHA256 一致；现有安装版进程保留运行，未关闭、卸载或重置用户应用。Rust、Schema、store、正式窗口配置及生产应用标识均未改变。

桌面测试最初因安装版已运行而被单实例锁阻止。为避免关闭用户应用，使用忽略目录中的临时配置，仅将**调试测试构建**标识改为独立值，数据库、窗口状态与 WebView profile 均隔离。测试脚本用 Node.js 24 直接读取同一日期/备份域模块，兼容内置资源与 Vite 界面；最终测试窗口加载内置资源。发布安装包仍使用 `app.starrylist.desktop`，已核对 NSIS 的 BUNDLEID。WebView 测试 profile 使用仅对子进程生效的 [官方环境覆盖](https://learn.microsoft.com/en-us/microsoft-edge/webview2/reference/win32/webview2-idl?view=webview2-1.0.3912.50)。

并行保留安装版时的调试构建可复现方式（PowerShell 7；临时配置不要用于正式打包）：

```powershell
New-Item -ItemType Directory -Force .cache | Out-Null
'{"identifier":"app.starrylist.desktop.ux21-test"}' | Set-Content .cache/ux21-desktop.conf.json -Encoding utf8NoBOM
npm run tauri build -- --debug --no-bundle --config .cache/ux21-desktop.conf.json
npm run test:desktop
```

体验包：`artifacts/Starry-List_1.0.0_x64-ux2.1-preview-20261016-setup.exe`（5,217,553 bytes）。SHA256：`919b81ef1501386316ffdaef81202d934cced8820f9487e6119ada88c27123c8`；校验文件：`artifacts/UX2.1-PREVIEW-20261016-SHA256SUMS.txt`。旧包保留，本轮未重建不透明版，未实际安装/同版本覆盖/卸载，未创建 Tag 或 Release；安装前请导出重要任务、正常退出旧版，按 [用户手册](USER_GUIDE.md) 处理同版本覆盖。

## 2026-10-16：第二轮基础任务交互（SL-002 / SL-019 / SL-004-A）

本轮实现提交：[`242fad5`](https://github.com/YOLIIIIII/starry-list/commit/242fad550f17213ae2b2e7ad06819628b1257e67)。SL-002、SL-019、SL-004-A 均为 **In Review**，等待用户体验确认；SL-001 未新增用户验收，SL-004 父需求仍未完成。未创建 Tag 或 GitHub Release。

- TypeScript、ESLint、**74 项 Vitest**（32 项双视图交互、31 项日期/备份域、5 项 store、6 项窗口边界）全部通过；新增覆盖草稿切换/取消、空白失焦、IME、重复提交、菜单键盘、指定/已完成任务删除、取消、失败和撤销。
- 既有 **11 项 Rust/SQLite** 测试通过；前端生产构建和 **Tauri Windows x64 NSIS** 构建成功。Rust 源码、迁移、store、数据库 Schema 和原生窗口配置均未改动。
- **15 组真实 Windows 11 / WebView2 测试通过**，使用新建的独立调试数据目录，运行前校验 SQLite 文件头。真实 INSERT / DELETE / UPDATE 失败由测试库临时触发器注入，均确认草稿/原记录保留、无错误成功通知、移除触发器后重试成功；完整删除撤销恢复原任务。
- 原生事件测试覆盖空白外部点击、同日期加号、Esc、唯一活动区、非空草稿外部点击、范围切换行内处理、总览编辑定位、专注菜单键盘与焦点返回。浏览器 IME 组合由前端自动化模拟，真实输入法候选窗仍需用户人工体验。
- 实际 980 / 760 / 500 / 380px 窗口下，菜单挂载到 body，不被滚动容器裁切；矩形边界在窗口内、命中检测可点击；新增输入、占位符、任务标题计算字号均为 15px。菜单随滚动/缩放重新定位，靠近下边缘向上显示。
- 980×680 和 380×480 抽屉固定保存栏、长文本完整保存、保存失败、优先级/完成、备份、窗口恢复、最小化等原有回归同时通过；正式 SQLite 主文件测试前后 SHA256 一致，没有重置正式数据。
- 首次桌面回归发现菜单在自动滚动后提前关闭，已修正为无滚动抢焦点及随滚动重新定位；最终完整桌面回归通过。构建最初遭沙箱 `spawn EPERM`，正常权限下构建通过。补充测试曾因嵌套组织错误失败，修正测试层级后 74 项全部通过。

截图仍来自真实隔离窗口和普通示例任务，新增 [任务菜单](screenshots/task-menu.png) 与 [新增草稿提示](screenshots/quick-add.png)，不包含私人壁纸或正式数据。

本轮独立体验包：`artifacts/Starry-List_1.0.0_x64-ux2-preview-20261016-setup.exe`（5,219,560 bytes）。SHA256：`f74e4551480db75fa65d1742782559bce48dfd4b4bdf89e9b37248103d4de739`；校验文件为 `artifacts/UX2-PREVIEW-20261016-SHA256SUMS.txt`。旧版及首轮 UX 安装包保留不变，本轮未重建不透明版；产物被 Git 忽略，只推送源码与文档。

安装前正常退出旧版并导出重要任务。仍为 1.0.0，同应用标识、同数据目录，不并行安装第二套；同版本的「添加/重新安装组件」路径已按生成的 NSIS 脚本核对，但**未实际执行安装、同版本覆盖、升级或卸载**。未做独立 Windows 10、混合 DPI/多显示器及不同 GPU 认证，未配置代码签名；详见 [使用手册](USER_GUIDE.md)。

## 2026-10-15：提交前复核与需求同步

- 第一轮 UX 源码、测试、手册和截图已整理为独立提交 [`23a7cd3`](https://github.com/YOLIIIIII/starry-list/commit/23a7cd3941a28d0724e254ca7b9bb71c9b8fd5c8)，需求文档另行提交。原初始提交 `830b88f` 与首次规划提交 `2665774` 均已在 GitHub，后者 [CI 已通过](https://github.com/YOLIIIIII/starry-list/actions/runs/38748524618)。不把源码同步当作发布。
- 本次重新执行 TypeScript、ESLint 与 59 项 Vitest，全部通过。Vitest 首次被沙箱文件访问权限拦截，在正常权限下重跑通过；未修改测试或应用代码来绕过失败。
- 下文的 11 项 Rust、12 组真实桌面测试与体验安装包是先前 UX 轮次的记录；本次未重跑原生测试、未构建软件或安装包、未操作用户数据库。
- SL-001 / SL-002 保留 In Review。SL-002 空输入失焦收起、SL-004-A 快速新增字号、SL-019 快捷删除菜单均只登记，尚未实现，不能声称这些新验收条件已通过。未创建 Tag 或 GitHub Release。

## 2026-10-15：第一轮 UX 优化

实际环境：Windows 11 / WebView2 155.0.4283.45，系统缩放 200%。本轮保留数据模型、SQLite 迁移、store 写入队列、节假日和原生窗口配置，未重置正式数据库。

- `npm run check` 通过：TypeScript、ESLint、59 项 Vitest（含 17 项双视图交互测试）、Vite 构建。
- `cargo fmt --check` 和既有 11 项 Rust 测试通过。
- `npm run test:desktop` 通过 12 组真实 WebView2 → Tauri → SQLite 检查，使用唯一 `.cache/desktop-smoke-*` 测试目录。
- 新增覆盖：折叠 / 只读 / 抽屉编辑、长文本完整保存与重新阅读、保存后收起、取消确认、日期与模式切换保护、按需新增、焦点循环、宽窄窗口滚动与按钮位置。
- 真实写入失败检查：只在隔离数据库中临时创建拒绝 UPDATE 的 SQLite 触发器。确认保存失败时原记录不变、草稿仍在；移除触发器后 Ctrl + Enter 重试成功。触发器随测试清理，不写入正式库。
- 正式 SQLite 主文件在本轮测试前后的 SHA256 相同；Rust、迁移及持久化模块无源码修改。

原生窗口实测尺寸均为逻辑像素：

| 窗口      | 抽屉宽度 | 保存栏纵向范围 | 长文本框高度 | 保存按钮命中检查 |
| --------- | -------- | -------------- | ------------ | ---------------- |
| 980 × 680 | 520      | 611–667        | 340          | 可见且可点击     |
| 380 × 480 | 370      | 407–461        | 340          | 可见且可点击     |

表单滚动到顶部和底部时，保存栏位置不变；文本框超过上限后内部滚动。阅读状态不使用输入框，无详细计划时卡片保持紧凑。截图来自真实隔离测试窗口，包括 `screenshots/editor.png` 和 `screenshots/editor-compact.png`。

已生成默认透明版 Windows x64 NSIS 体验包：`artifacts/Starry-List_1.0.0_x64-ux-preview-setup.exe`，校验值见 `artifacts/UX-PREVIEW-SHA256SUMS.txt`。体验包包含当前 UX 和 `yoli` 发布元数据；本轮没有重建不透明版，也没有替换此前 `artifacts/` 中的两个 V1.0 安装包。版本号仍为 1.0.0，尚未执行全新设备安装/升级/卸载回归。

最终生产可执行文件已通过 `npm run test:release`：使用内置资源，阻断外部网络后可正常读取同一数据快照，无页面运行错误。此项只读，不创建示例任务。在该轮测试结束时尚未执行 Git Commit、Push、Tag 或 Release；后续提交状态见本页顶部复核记录。

## 原始 V1.0 验证（2026-10-14）

以下保留先前的构建与测试范围；其中不透明安装包对应最初的 V1.0 界面，不代表本轮已重新验证该安装包。

验证日期：2026-10-14（Asia/Shanghai）。本机 Windows 11，系统版本 `10.0.26200.0`；WebView2 `155.0.4283.45`；Node.js 24.21.0；Rust 1.90.0 / MSVC。记录的是实际执行结果，不代表所有 Windows 设备组合都已认证。

## 已通过

| 检查               | 实际范围                                                                                                                                                                                                                                  |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TypeScript、ESLint | 全部前端代码与测试、验证脚本                                                                                                                                                                                                              |
| Vitest：48 项      | 月份与跨年、闰年、周一月历、七天日期范围、预览顺序与 +N、简称回退、完成进度、全部 2026 假期/补班、未知年份、备份结构与 RFC3339 偏移时间、串行写入、失败不产生幽灵任务、重复恢复 ID 幂等、长文本切换保存、删除撤销、Escape、显示器边界计算 |
| Rust：11 项        | 真正 SQLite 迁移、重复迁移、中文长文本、日期修改、完成与优先级独立、参数化 SQL、ID 合并、确认覆盖、排序校验、真实文件关闭重开、导入中途 SQL 失败完整回滚                                                                                  |
| Rust 格式 / Clippy | `cargo fmt --check`；`cargo clippy -- -D warnings`                                                                                                                                                                                        |
| Vite 生产构建      | 内置 JS/CSS/SVG，无在线字体和图标                                                                                                                                                                                                         |
| 原生桌面冒烟：8 组 | 实际 WebView2 → Tauri IPC → Rust → SQLite，无浏览器持久化替代                                                                                                                                                                             |
| 两种 NSIS 构建     | Windows x64 透明版与原生不透明回退版，含 WebView2 引导程序与 C++ 运行库                                                                                                                                                                   |

实际桌面冒烟覆盖：

1. 七天日程的新增自动绑定所在日期，数据库真实保存。
2. 中文多行长说明、分类、王冠优先级切换视图后保存。
3. 完成与取消完成同步到月历，优先级保持。
4. 真正置顶 API、生效后的持久化、40% 背景设置，文字自身 opacity 保持 1。
5. 真正调整到 980、760、500、380px 逻辑宽度，文档没有水平溢出，七天日程仍可访问。
6. Rust 导出 JSON 经同一前端备份 schema 校验；合并、重复 ID 重映射、无效版本拒绝、替换事务。
7. 正常关闭先保存详情，再退出进程；新进程保留任务、分类、视图、透明度。自定义 **760×600 逻辑尺寸**和**物理位置 (170,190)** 重启前后精确一致。本机 200% 缩放下内外尺寸均为 1520×1200，窗口无传统装饰标题栏。
8. 标题栏最小化按钮调用真实窗口 API，并验证系统最小化状态。

截图是实际应用的 WebView2 内容截图，使用独立测试数据库的示例任务，位于 `docs/screenshots/`。未将测试任务写入正式应用数据库。

## 正式版离线检查

`scripts/release-smoke.mjs` 启动生产可执行文件，核对页面来自 `http://tauri.localhost/` 内置资源；阻断页面所有外部网络请求后重新加载，仍正常读取同一 SQLite 快照，且没有页面运行错误。该检查只读取正式数据，不添加、编辑或删除任务。透明版与原生不透明回退版均通过。

不透明回退版本已完成构建与正式版检查，实际原生透明状态为 false；默认版为 true。最终产物和 SHA256 见 `artifacts/`。回退版会报告真实原生不透明状态，禁用滑块并说明不能透视桌面。

## 已修复的实测问题

- Node 16 / Rust 1.89 与当前构建工具不兼容：安装项目本地 Node 24 与 Rust 1.90，并提供 `scripts/desktop.ps1` 启动脚本。
- Vite 监视 Rust DLL、安装器和 tsbuildinfo 导致开发服务退出或重载：排除全部构建、缓存、截图目录与 tsbuildinfo。
- Tauri `onCloseRequested` 最终销毁窗口需要 `allow-destroy`：补齐 capability，并通过真实关闭及重启验证。
- 矮窗口月历预览溢出：按单元格实际尺寸决定 0 / 1 / 2 条文字预览，保留数量与优先级标记；格子不撑坏布局。
- Rust 生成的 `+00:00` 时间被前端原先只接受 `Z` 的校验拒绝：统一接受带时区偏移的 RFC3339 时间，并用真实导出文件验证前后端互通。
- 无边框原生阴影的尺寸补偿导致重启后高度增加 56 像素：关闭原生阴影，使用界面内部柔和阴影；在 WebView2 初始化后通过官方插件恢复窗口。八个边缘/角落及右下角使用官方 `startResizeDragging` API，没有系统级窗口 Hack。

## 可复现命令

```powershell
.\scripts\desktop.ps1 check
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
.\scripts\desktop.ps1 build
.\scripts\desktop.ps1 build -Opaque
```

桌面冒烟需要独立启动 Vite（不要同时打开另一实例的 Starry List），以及调试可执行文件：

```powershell
npm run build
cargo build --manifest-path src-tauri/Cargo.toml --locked
# 在另一终端启动 npm run dev
npm run test:desktop
# 正式可执行文件构建后；会只读打开正常应用数据
npm run test:release
```

调试版才接受 `STARRY_LIST_TEST_DATA_DIR`，数据库和窗口状态保存到唯一 `.cache/desktop-smoke-*` 目录；脚本先确认该目录存在真实 SQLite 文件再写入任务。正式版忽略测试目录环境变量。测试目录、安装器和构建工具均被 Git 忽略。

## 尚需发布前人工验证

- 独立 Windows 10 设备、不同 GPU / 混合 DPI / 多显示器热插拔组合。
- 实际鼠标拖动标题区、八方向边缘缩放、任务栏 / Alt+Tab 行为、不同壁纸的最终透明混色。
- 在全新设备上完成安装、升级和卸载；安装包已实际生成，尚未运行安装/卸载回归。缺失 WebView2 时安装运行时可能需要网络；应用日常离线运行。
- 初始源码及首次规划的 GitHub Actions CI 已在远程通过；本次新增提交的 CI 需以对应 GitHub 运行结果为准。Release 工作流及安装包发布尚未执行。
- 未配置 Windows 代码签名，安装器会有未知发布者或 SmartScreen 提示。macOS 未验证，属于后续版本。

构建中的 Zod `@__PURE__` 注释提示来自上游依赖，Rollup 已移除该注释；不影响构建成功。没有伪称完成物理交互或未执行的安装测试。
