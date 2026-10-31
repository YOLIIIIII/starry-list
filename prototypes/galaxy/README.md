# 星河设计室（隔离原型）

从仓库根目录运行：

```powershell
node prototypes/galaxy/serve.mjs
```

打开 http://127.0.0.1:4178 。不需要 npm 安装或桌面程序；关闭该终端即停止服务。端口冲突时可先设置 `$env:GALAXY_PORT=4179`。不要直接双击HTML，浏览器可能阻止本地ES模块。

从入口打开A/B/C，切换月度/年度、年月和日期。比较设置提供三字号、三材质网页示意、两顶部、三组相同规则的合成样本和月中/月末时点。日期支持Tab/方向键；“补完演示”只改本页内存，刷新还原。

这是SL-023-A设计比较，不是正式星河功能。没有Tauri/SQLite/store导入、IPC、网络请求、localStorage/IndexedDB或文件写入；独立服务器仅提供本文件夹的4个明确资源，不提供仓库浏览。正式应用构建不包含此目录，也不增加导航或设置。

设计报告、截图与规则候选见 `docs/research/SL-023-A-GALAXY-PROTOTYPES.md`。
