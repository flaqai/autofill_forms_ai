# Chat4o AI Plugin

Chat4o AI Plugin 是一个基于 Manifest V3 的 Chrome/Chromium 扩展，用于 AI 对话、产品资料管理、网页表单自动填写和批量提交。界面可在 Chrome 侧边栏中运行，也可通过工具栏图标打开独立弹出窗口。

## 主要功能

- 调用 OpenAI 兼容 API 进行 AI 对话，并支持部分 Gemini 模型。
- 管理多套产品推广资料、图片资产和自定义字段。
- 分析当前网页表单，使用已保存的推广资料自动填写。
- 批量发现提交页、填写表单，并记录运行结果和评估日志。
- 通过页面悬浮按钮快速打开扩展并填写当前页。
- 支持简体中文、繁体中文和英文。
- 导出和导入 Chrome 本地存储的完整备份，方便跨电脑迁移。

## 环境要求

- Chrome 114+ 或兼容 Chrome Side Panel API 的 Chromium 浏览器
- Node.js 20+
- pnpm 10

## 开发

```bash
pnpm install --frozen-lockfile
pnpm run dev
```

常用命令：

```bash
pnpm run lint       # 执行 ESLint
pnpm run build      # TypeScript 检查并生成 dist/
pnpm run preview    # 预览 Vite 生产产物
pnpm run package    # 构建并生成 releases/chat4o-ai-plugin-v*.zip
```

## 在 Chrome 中加载

1. 执行 `pnpm run build`。
2. 打开 `chrome://extensions/`。
3. 开启“开发者模式”。
4. 选择“加载已解压的扩展程序”，然后选择项目中的 `dist/` 目录。
5. 修改源码后重新构建，并在扩展管理页点击刷新。

点击扩展图标会打开独立窗口。快捷键为 `Ctrl+Shift+Y`，macOS 上为 `Command+Shift+Y`。

## 项目结构

```text
manifest.json                   Manifest V3 配置
sidepanel.html                  React 界面入口
src/background/                 Service Worker 和 URL 自动填写流程
src/content/                    悬浮按钮、表单探测与填写
src/pages/                      对话、批量提交和设置页
src/components/                 UI 和业务组件
src/store/                      Zustand 状态与 Chrome 存储适配器
src/services/api.ts             OpenAI 兼容 API 客户端
src/utils/                      表单、批处理、提交页发现和日志工具
benchmarks/                     提交页发现基准数据与脚本
public/                         扩展图标和内置产品资产
scripts/package.js              发布包构建脚本
```

应用使用 hash router，主路由为：

- `#/chat`：AI 对话和当前页填写
- `#/batch`：批量提交
- `#/settings`：API、产品资料、图片和备份管理

`src/content/floatingButton.ts` 和 `src/content/formHandler.ts` 会在 `http`/`https` 页面中作为 content scripts 运行。后台 Service Worker 负责标签页跟踪、独立窗口、消息路由和基于 URL 的填写流程。

## 数据与跨电脑迁移

设置、API Key、产品资料、聊天记录和导入的图片保存在 `chrome.storage.local`，不在源码仓库中。

迁移时，先在旧浏览器的设置页选择“导出完整备份”，再在新浏览器中选择“导入完整备份”。备份可能包含 API Key 和业务资料，应作为私密文件保管，不要提交到 Git。

## 权限说明

扩展使用 `<all_urls>` 主机权限，以便发现和填写不同网站的表单。它还使用 `storage`、`tabs`、`webNavigation`、`scripting`、`sidePanel` 和 `unlimitedStorage` 等权限支持相关工作流。如果准备发布到 Chrome Web Store，请同时准备清晰的权限用途与隐私说明。

## 技术栈

React 19、TypeScript、Vite、CRXJS、Zustand、Immer、React Router、i18next、ky、Radix UI 和 Tailwind CSS。

## License

[MIT](LICENSE)
