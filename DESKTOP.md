# Scene Studio 桌面后台版

桌面版把场景替换、Logo 替换及对应的多文件夹任务交给 Electron 主进程执行。关闭主窗口后任务继续在托盘运行，状态保存在 `userData/scene-studio.sqlite`，生成图片直接写入创建任务时选择的输出目录。

## 本地开发

```powershell
npm install
npm run typecheck
npm run typecheck:electron
npm test
npm run desktop:dev
```

## Windows 打包

```powershell
npm run desktop:pack
```

产物位于 `release/`：NSIS 安装包和便携 ZIP。`better-sqlite3` 是原生依赖，本地打包需要 Python 与 Visual Studio C++ Build Tools；GitHub Actions 的 Windows 构建机已包含这些工具。

## 数据与安全

- API Key 使用 Electron `safeStorage` 加密后保存，不写入 SQLite 或网页 `localStorage`。
- SQLite 只保存任务状态、文件路径和请求元数据，大图片不会写入数据库。
- 结果先写入临时文件，再原子重命名；同名文件自动增加序号，绝不覆盖已有文件。
- 渲染层只能调用 Preload 暴露的任务 API，不能直接访问 Node.js、SQLite 或任意文件系统路径。
- 首次安装默认启用登录后启动到托盘，用户关闭后不会被下次启动强制重新开启。

未签名安装包可能触发 Windows SmartScreen，这是没有配置代码签名证书时的预期行为。
