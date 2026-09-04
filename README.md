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

`src/content/floatingButton.ts` 会在顶层 `http`/`https` 页面中运行，`src/content/formHandler.ts` 会同时运行于顶层页面和内嵌 frame，以支持 Airtable 等跨域嵌入表单的自定义下拉框和富文本字段。后台 Service Worker 负责标签页跟踪、独立窗口、消息路由和基于 URL 的填写流程。

## 直接 CDP 提交工作流

`scripts/cdpSubmissionWorkflow.mjs` 是独立于扩展运行时的 BitBrowser Local API + Playwright CDP 辅助模块。它的人工验证等待策略默认开启，适用于目录站的批量提交：

- 在进入页面、填写表单、提交前和提交后分别检查 Turnstile、reCAPTCHA 与 hCaptcha。
- 遇到验证时，将页面加入非阻塞等待队列，继续处理其余网站；不点击验证组件、不伪造 token、不注入隐藏验证字段。
- 用户在保留的浏览器页面完成官方验证后，队列检测到有效状态，只调用一次预先提供的后续回调；超时默认 15 分钟。

批处理脚本应在每个阶段调用 `checkpointHumanVerification(queue, { siteId, page, stage, onVerified })`，并在批次开始时调用 `queue.start()`、结束时调用 `queue.stop()`；也可在处理其他网站的间隙调用 `await queue.poll()`。`onVerified` 只能包含已获授权的正常后续动作，例如检查免费方案后点击提交；不能用于绕过安全机制。

### 私有资料包与缺失字段策略

直接 CDP 工作流可以从私有资料包中加载结构化资料和提交偏好。资料包不应放入仓库，也不应把路径、凭据或完整资料内容写入提交记录。批处理脚本启动时显式传入两个文件路径：

```js
import {
  fillResolvedSubmissionField,
  loadSubmissionContext,
  resolveSubmissionField
} from './scripts/cdpSubmissionWorkflow.mjs'

const context = await loadSubmissionContext({
  profilePath: '/private/promotion-profile.json',
  preferencesPath: '/private/seo-submission-preferences.md'
})

const description = resolveSubmissionField(context, {
  field: 'Detailed description',
  required: true
})
// description.source is profile, generated, or missing.

const filled = await fillResolvedSubmissionField(page, context, {
  field: 'Short description',
  locator: 'textarea[name="description"]',
  required: true
})
// Record filled.source and filled.generated with the site outcome.
```

资料 JSON 是事实来源；偏好 Markdown 决定免费方案、邮箱选择和允许生成字段等行为。解析顺序为：当前用户指令、网站限制、资料 JSON、偏好规则、允许的低风险生成值。`lockedFields` 不会被生成值覆盖。只有摘要、介绍、分类、标签、目标用户、平台、产品类型和商业模式可生成；联系方式、身份、地址、日期、价格、指标、法律/支付信息及反链地址缺失时保持为空并记录为 `missing`。所有生成结果必须在提交记录中标记为 `generated`。

### 单次规划、多动作执行

为了减少逐字段调用模型的延迟，CDP 工作流还提供了结构化规划接口：

```js
import {
  createOpenAICompatiblePlanner,
  SubmissionPlanCache,
  executeSubmissionPlan,
  planSubmissionPage
} from './scripts/cdpSubmissionWorkflow.mjs'

const cache = new SubmissionPlanCache()
const planner = createOpenAICompatiblePlanner({
  baseUrl: process.env.SUBMISSION_MODEL_BASE_URL,
  apiKey: process.env.SUBMISSION_MODEL_API_KEY,
  model: process.env.SUBMISSION_MODEL_NAME
})
const planned = await planSubmissionPage({
  page,
  context,
  cache,
  planner
})

const result = await executeSubmissionPlan(
  page,
  context,
  planned.snapshot,
  planned.plan
)
```

`extractSubmissionSnapshot` 只向模型提供一次脱敏后的页面快照；模型负责页面类型、字段语义映射、免费方案判断、生成字段和动作顺序，返回 `fill`、`select`、`check`、`upload`、`submit` 五类动作。Playwright 随后连续执行这些动作，不为每个输入框单独调用模型。`SubmissionPlanCache` 按站点来源、路径和控件签名缓存计划，页面结构改变时自动失效。

执行器会重新获取控件、严格匹配下拉选项、解析资料来源，并在提交动作前再次检查免费方案和人工验证状态。模型不能发出任意 JavaScript 或任意点击指令；付款、验证码、登录和受保护资料仍然必须经过规则或人工处理。`result.records` 包含每个动作的 `profile`、`generated`、`missing` 或 `planner` 来源，可直接写入提交审计记录。

## 数据与跨电脑迁移

设置、API Key、产品资料、聊天记录和导入的图片保存在 `chrome.storage.local`，不在源码仓库中。

迁移时，先在旧浏览器的设置页选择“导出完整备份”，再在新浏览器中选择“导入完整备份”。备份可能包含 API Key 和业务资料，应作为私密文件保管，不要提交到 Git。

## 权限说明

扩展使用 `<all_urls>` 主机权限，以便发现和填写不同网站的表单。它还使用 `storage`、`tabs`、`webNavigation`、`scripting`、`sidePanel` 和 `unlimitedStorage` 等权限支持相关工作流。如果准备发布到 Chrome Web Store，请同时准备清晰的权限用途与隐私说明。

## 技术栈

React 19、TypeScript、Vite、CRXJS、Zustand、Immer、React Router、i18next、ky、Radix UI 和 Tailwind CSS。

## License

[MIT](LICENSE)
