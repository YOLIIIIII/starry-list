# 参与贡献

欢迎反馈问题或提交小范围、可审查的 Pull Request。

## 需求与进度

先查看 [开发路线图](docs/ROADMAP.md)、[产品需求池](docs/PRODUCT_BACKLOG.md) 和 [产品决策](docs/DECISIONS.md)。反馈已有问题时补充原 SL ID；新需求记录来源、问题、验收标准及初步评估，登记本身不代表立即开发。详细需求以 Markdown 需求池为唯一权威来源，当前不批量创建 Issues。

开发时注明对应需求 ID，遵循 [仓库协作规则](AGENTS.md)。测试通过后仍待用户体验的事项使用 In Review，验收通过才使用 Done；正式发布单独记录。未提交的其他任务需保留，提交只暂存本次范围。

## 本地贡献检查

1. 使用 Node.js 24、Rust 1.90 和 Windows C++ 构建工具。
2. `npm ci` 后运行 `npm run tauri dev`。
3. 提交前执行 `npm run check`、`cargo fmt --manifest-path src-tauri/Cargo.toml --check`、`cargo test --manifest-path src-tauri/Cargo.toml`。
4. 业务逻辑放在 domain/store，持久化与事务放在 Rust db 模块。新增 schema 时递增迁移版本；不改已发布的迁移。
5. 用简体中文设计界面文案。保证系统减少动画、键盘导航、380px 宽度和长中文文本可用。

报告问题请附 Windows/WebView2 版本、复现步骤及错误文案。不要上传个人数据库或含隐私的备份。项目采用 [MIT 许可证](LICENSE)，Copyright (c) 2026 yoli。请保留第三方资源的版权声明和真实贡献者署名。
