# UX3.0.3：玻璃减法与失焦稳定性

对应 [SL-003-C / E](PRODUCT_BACKLOG.md#sl-003) 和 [SL-004-B](PRODUCT_BACKLOG.md#sl-004)。保留 UX3.0.1 三材质方向，待用户最终确认，未正式发布。实现提交 [`d5ba29a`](https://github.com/YOLIIIIII/starry-list/commit/d5ba29a1cdd790fdc3a930e293af661b4fcf942a)。

## 视觉调整

| 区域     | UX3.0.2                      | UX3.0.3                                                                                      |
| -------- | ---------------------------- | -------------------------------------------------------------------------------------------- |
| 日期数字 | 玻璃非今天数字仍有小底贴     | 移除；保留今天紫色、选中日期格及官方假期/补班                                                |
| 月历任务 | 已无常驻预览底贴，5px 间距   | 继续无底贴，4px 间距、原省略与密度规则                                                       |
| 七天日程 | 日期行、任务行有局部保护底色 | 移除常驻底块，内容面保护文字、轻 hover，任务间距 3px                                         |
| 专注清单 | 任务各有底块，分组 7px       | 无常驻任务底块、分组 3px；只读长详情保留阅读面                                               |
| 快速新增 | 文字靠左、与清单贴近         | 保留输入面，总览左右内边距 10px、专注 12px，输入文字另有 6px 内边距，清单与新增至少 9px 分离 |
| 编辑抽屉 | 部分输入与标签偏小           | 输入/计划 14px，标签/分类/操作 12px，辅助说明 11px；固定保存栏和草稿行为不变                 |

阅读优先不应用玻璃去底贴规则；任务标题保持 14px，没有全局字号系统。梦幻内容面最低 alpha 从 .54 调至 .60，以整面保护替代逐行贴片；单一原生柔色 A=82/255，不降低文字 opacity。外壳仍保持 40/70/100% 真实差异，100% 清除原生模糊，无残余灰雾；实色窗口所有背景 alpha=1。

## 失焦问题：复现、根因与修复

微软说明 [系统背景 Acrylic 失焦会转实色](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)。旧 UX3.0.2 真实透明窗口在自制彩色背景、40% 与 70%、总览/专注各三轮中复现；指定采样点最大 RGB 通道变化分别 58、29。这个失焦路径与 UX3.0.2 的部分失败残留不是同一个原因。

本轮改用官方 [HostBackdropBrush](https://learn.microsoft.com/en-us/uwp/api/windows.ui.composition.compositor.createhostbackdropbrush?view=winrt-26100) + DesktopWindowTarget，置于原 WebView 子窗口之后，配合 [DWMWA_USE_HOSTBACKDROPBRUSH](https://learn.microsoft.com/en-us/windows/win32/api/dwmapi/ne-dwmapi-dwmwindowattribute)。单窗口一棵合成树、UI 线程持有 COM 对象；先清旧树、失败析构、窗口销毁清理。保留既有异步串行与过期请求防护，不在失焦或重新激活时重新叠材质，不伪造焦点、不抢回前台。

新方案在相同 12 组真实外部 WinForms 窗口切换中，指定采样点最大通道差均为 0；另在同 CSS/背景下只开关原生材质，密集文字纹理的相邻像素变化均值由约 9.97 降到 .33，确认是真实模糊而非仅调浅背景。数值只代表本机测试点，不保证所有屏幕与系统。

**系统限制和兼容策略：** Windows 11 22H2+ 透明窗口且系统允许时请求合成；Windows 10、原生实色、100% 不请求。高级透明禁用/高对比在创建前拒绝并采用较强 CSS 衬底，初始化或部分应用失败清理后降级；不引入 Windows App SDK 运行时或 Explorer Hack。正常策略下可保持激活/失焦同一材质；节能、电池、远程桌面、GPU/驱动与系统更新可能仍停用或改变模糊，无法强制维持激活态。未对这些设备策略作真实认证，必要时选阅读优先或实色回退。

## 可重复对比

所有图片使用脚本绘制的浅几何、深圆环、彩色高对比、密集测试文字背景和隔离任务，无私人壁纸、照片或用户数据库内容。原生截图有覆盖与无关窗口检查，拒绝时不保存；日期固定 2026-10-19，原生逻辑窗口 980 × 620，屏幕约 200%。

| 同条件                | 旧 UX3.0.2                                              | UX3.0.3                                                 |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------- |
| 梦幻 40% 总览 / 激活  | [旧](screenshots/ux303/ux302-0.4-overview-active.png)   | [新](screenshots/ux303/ux303-0.4-overview-active.png)   |
| 梦幻 40% 总览 / 失焦  | [旧](screenshots/ux303/ux302-0.4-overview-inactive.png) | [新](screenshots/ux303/ux303-0.4-overview-inactive.png) |
| 梦幻 40% 专注 / 失焦  | [旧](screenshots/ux303/ux302-0.4-focus-inactive.png)    | [新](screenshots/ux303/ux303-0.4-focus-inactive.png)    |
| 轻玻璃 70% 彩色总览   | [旧](screenshots/ux302/glass-colorful-70-overview.png)  | [新](screenshots/ux303/glass-colorful-70-overview.png)  |
| 梦幻 40% 密集文字专注 | [旧](screenshots/ux302/frosted-text-40-focus.png)       | [新](screenshots/ux303/frosted-text-40-focus.png)       |

窄屏 [梦幻抽屉](screenshots/ux303/frosted-drawer-380.png)、[轻玻璃通知](screenshots/ux303/glass-notification-380.png)，以及 [月历双预览](screenshots/ux303/glass-calendar-detail-viewport.png) 为 **WebView 视口截图**，只证明布局/字体/截断，不包括桌面原生模糊。原生前景截图被额外 Chromium 小窗口阻挡，隐私保护拒绝；没有关闭用户窗口、放宽检查或把这些视口图标为原生证据。旧版所有已存档截图保持不变。

## 验收建议

1. 梦幻 40% / 70% 各在星轨与浏览器/资源管理器之间切换数次，再切总览/专注，确认没有突变实色。
2. 看日历数字、任务预览、七天日期/任务和专注任务：无多余小底贴，间距自然，今天/选中/节假日仍清楚。
3. 宽窄窗口各新增三项，Enter 返回原加号、失焦保存、快速修改、完成、删除/撤销照常；新增输入左边留白舒适。
4. 编辑长计划，检查抽屉字体与固定保存栏；阅读优先、100%、实色回退也检查。

复现命令、安装包校验、未覆盖设备及功能结果见 [验证记录](VALIDATION.md)。SL-003 / C / E 与 SL-004-B 保持 In Review；SL-004 全局字号仍 Backlog。
