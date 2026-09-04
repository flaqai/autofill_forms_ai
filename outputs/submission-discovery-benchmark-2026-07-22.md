# 主页到提交页：42 站实测报告

测试日期：2026-07-22

## 测试规则

- 每个网站只从用户给出的主页开始。
- 只沿页面上真实出现的链接或唯一、可见、明确的提交按钮前进；不使用预先知道的提交 URL。
- 到达可填写表单、登录/注册、人机验证、付款说明、站点故障或明确无入口时停止。
- 不填写、不提交表单，不绕过验证码，也不创建账号。
- “最终地址”是本次未登录会话实际到达的地址；登录后的受保护地址会保留为恢复地址。

## 总结

| 结果 | 数量 | 说明 |
|---|---:|---|
| 已到可识别提交表单或 URL 起始表单 | 15 | 可以交给现有填写器；其中部分站点最终提交仍要求登录或付款 |
| 已找到提交路径，但先要人工登录/注册 | 21 | 应进入人工队列，处理后从保存的提交地址继续 |
| 主页或提交页被人机验证拦截 | 2 | AISTage、Locanto |
| 主页内付费终点 | 1 | IndieTool 的提交按钮只打开价格区 |
| 找到提交 URL，但页面主内容为空 | 1 | Aura++ |
| 网络层无法打开 | 2 | FastLaunch、JustGotFound |
| 合计 | 42 | 全部已记录 |

本轮没有观察到“不断切换语言”的循环。确实发生了正常的语言规范化：WebCatalog 自动进入中文路径，MOGE 自动进入 `/zh`，HuntScreens 从 `/en` 规范到根路径，iuu 提交页包含多个等价语言链接。现有语言等价页过滤阻止了这些链接被反复加入候选队列。

## 逐站结果

| # | 主页 | 实际发现路径 / 最终停点 | 结果与异常 |
|---:|---|---|---|
| 1 | `https://iuu.ai/` | `/en/submit` → `/submit` | 到达网站名、网址、邮箱表单；按钮显示 Login，最终提交需要账号。提交页含多个语言等价链接，但未发生循环。 |
| 2 | `https://aistage.net/` | `/submit` → Cloudflare `Just a moment...` | 入口正确；提交页被人机验证拦截，应立即交给人工队列。 |
| 3 | `https://www.indietool.io/` | `/#pricing` | “Submit Your Startup”只滚动到主页价格区。Pro 为一次性 `$6.99`，Premium 为 `$17.99`；这是主页内付费终点。 |
| 4 | `https://dirs.cc/` | `/submit` → `/auth/login?callbackUrl=%2Fsubmit` | 正确找到提交入口；先登录。登录后很可能进入付费方案，本次因未登录未继续确认。 |
| 5 | `http://antdirectory.com` | HTTP → HTTPS；`/submit` → `/auth/login?callbackUrl=%2Fsubmit` | 正确找到入口；先登录。保留 `/submit` 作为恢复地址。 |
| 6 | `https://featuredtool.com/` | `/submit` → `/auth/login?callbackUrl=%2Fsubmit` | 正确找到入口；先登录。 |
| 7 | `https://oecd.ai/en/catalogue/tools` | `/en/catalogue/tools/submit` | 到达完整 OECD 工具提交表单，含名称、简介、详细描述、官网和多种仓库链接等字段。 |
| 8 | `https://www.linkcentre.com/` | `/addurl/` | 到达单一 Website URL 起始表单；页面同时提示创建账号和透明定价，后续可能进入账号/付款步骤。 |
| 9 | `https://www.ai138.com/` | `/submit` | 到达完整中文表单。可免费提交，也可选 `¥99` 极速收录；反链可选。 |
| 10 | `https://localpages.com/` | `/signup` | “Claim Your Business Listing For FREE”先进入账号注册表单；注册后才能继续认领商家。 |
| 11 | `https://www.locanto.me/` | 主页即 `Checking your browser` | 在读取任何站内入口前就被反机器人验证拦截，必须先人工通过。 |
| 12 | `https://protocol.ooo/` | `/signup` | 主页只有通用注册/融资服务入口，没有公开的项目提交表单。到达日文注册页；应先人工注册，并标记为“尚未验证实际提交入口”。 |
| 13 | `https://webcatalog.io/` | `/zh-CN/desktop` → `/zh-CN/developers/app-listing` → `/zh-CN/apps/submit` → `auth.webcatalog.io/zh-CN/signup?...` | 路径正确，最后进入独立认证子域。异常：提交路由先显示空文档，约 3.5 秒后才跳到注册页。 |
| 14 | `https://mossai.org` | `/submit` | 到达提交说明页；明确要求先登录，并要求提交网站先添加 MossAI 反向链接。 |
| 15 | `https://directory.com.au/` | `/add-directory-listing/` | 到达 Add Listing 注册步骤，要求用户名、邮箱和同意条款；页面显示 Visa/PayPal/Stripe，后续可能付费。 |
| 16 | `https://dofollow.tools/` | `/submit` | 到达完整工具提交表单，含 URL、名称、Tagline、描述、Logo、截图、分类和邮箱等。 |
| 17 | `https://deeplaunch.io/` | `/submit` | 到达完整工具提交表单；免费审核约 48 小时，也提供付费优先方案。 |
| 18 | `https://www.spotsaas.com/` | `/get-listed` → `https://partners.spotsaas.com/register` | 到达 Vendor Portal 注册表单。真实入口在同品牌第一方子域；旧规则会因主机名不完全相同而拦截。 |
| 19 | `https://best-ai-tools.org/` | 规范到 `https://best-ai.org/` → `/submit-tool` | 到达免费的单 URL 起始表单；无需信用卡。 |
| 20 | `https://auraplusplus.com/` | `/projects/submit` | URL 明确正确，但未登录页面只渲染导航和页脚，主内容、表单、登录提示均为空。应标记“空壳提交页，人工检查”，不能在同页无限重试。 |
| 21 | `https://launchitx.com/` | `/projects/submit` → `/auth/login?callbackUrl=%2Fprojects%2Fsubmit` | 先登录；恢复地址完整保留。 |
| 22 | `https://rankinpublic.xyz/` | 主页 `/` | 主页本身就是最终 URL 提交步骤，含 “Enter your SaaS website” 和 Launch 按钮；无需继续找下一页。 |
| 23 | `https://openhunts.com/` | `/projects/submit` → `/sign-in?redirect=/projects/submit` | 先登录；恢复地址完整保留。 |
| 24 | `https://saashunt.best/` | `/projects/submit` → `/sign-in?redirect=/projects/submit` | 先登录；恢复地址完整保留。 |
| 25 | `https://navs.site/` | `/submit` | 到达完整表单。页面提示必须登录，并要求先添加反向链接；表单本身可识别。 |
| 26 | `https://openlaunch.ai/` | `/projects/submit` → `/sign-in?redirect=/projects/submit` | 先登录；恢复地址完整保留。 |
| 27 | `https://hunt0.com` | `/submit` | 到达完整多段表单。免费队列每天 10 个名额；付费方案页面显示 `$16.9 / $29.9`。最终按钮为 “Sign in to submit”。 |
| 28 | `https://startups.gallery/` | 外部真实链接 `https://tally.so/r/3ylOB8` | 到达完整 Tally “Submit a Startup” 表单。页面说明人工审核，并称自动提交可能不被审核。 |
| 29 | `https://aieducator.tools/` | `/for-companies` → `/register-tool?plan=gold` | 到达 6 步流程的第一步“Create Your Account”；当前 Gold 方案限时免费，先人工注册。 |
| 30 | `https://www.launchvault.dev/` | `/projects/submit` → `/sign-in?redirect=/projects/submit` | 先登录；恢复地址完整保留。 |
| 31 | `https://fastlaunch.io/` | 主页 | 两次常规导航和一次连接建立复查都超时；地址栏已到域名，但没有完成可读取文档。网络/站点异常。 |
| 32 | `https://productlaunch.com.br/` | `/projetos/enviar` → `/entrar?redirect=/projetos/enviar` | 葡萄牙语 “Enviar Projeto” 是真实入口；先登录。旧动作词表会漏掉它。 |
| 33 | `https://devhub.best/` | `/projects/submit` → `/sign-in?redirect=/projects/submit` | 先登录；恢复地址完整保留。 |
| 34 | `https://huntscreens.com/en` | 规范到 `/` → `/submit` | 到达 Product website 单 URL 起始表单。免费队列约 30 天，付费可在 24 小时内审核。未发生语言循环。 |
| 35 | `https://techbasedirectory.com/` | `/submit-product` | 找到 AI 辅助提交页；先登录，再粘贴 URL 生成草稿，发布为一次性 `$10`。 |
| 36 | `https://shipstry.com/` | `/submit/` → `/login/?redirect=%2Fsubmit%2F` | 先登录；恢复地址完整保留。 |
| 37 | `https://moge.ai/` | 自动到 `/zh`；点击唯一“提交产品”按钮；URL 不变 | 按钮打开主页内嵌单字段“您的产品官方网站”表单。旧逻辑只扫描 `<a>`，会漏掉这种按钮内弹表单。 |
| 38 | `https://novatools.ai/` | `/submit/` | 到达完整表单。当前快速收录 `$19.9`；免费队列最早到 2026 年 10 月，并要求 Badge。 |
| 39 | `https://21st.tools/` | `/submit` | 到达完整多字段工具表单，包含名称、Slug、URL、分类、价格、标签和富文本描述。 |
| 40 | `https://justgotfound.com/` | 主页 | 两次访问均在页面内容出现前返回 `net::ERR_CONNECTION_CLOSED`。 |
| 41 | `https://desifounder.com/` | `/spotlight` → `/spotlight/2026/30` → 页面真实 “Feature” 链接 `/create/project` → `/login?ReturnUrl=%2Fcreate%2Fproject` | 需要三层导航；最终先登录。只停在 Spotlight 周榜会误判，必须继续识别 “Feature”。 |
| 42 | `https://shipybara.com/` | `/projects/submit` → `/sign-in?redirect=/projects/submit` | 先登录；恢复地址完整保留。 |

## 过程异常记录

### 1. 未出现语言循环，但有四种正常语言行为

- iuu：提交页列出多个同路径语言版本。
- WebCatalog：根据环境进入 `/zh-CN/...`。
- MOGE：根路径规范到 `/zh`。
- HuntScreens：`/en` 规范回无语言前缀的根路径。

这些都不应被视为新的提交候选。测试中语言等价页过滤正常工作，没有重复切换。

### 2. 延迟认证跳转

WebCatalog 的 `/zh-CN/apps/submit` 会先完成一个几乎空白的文档，然后约 3.5 秒后跳到 `auth.webcatalog.io`。过早检查会错误报告“空页面”。

### 3. 唯一按钮打开内嵌表单

MOGE 的“提交产品”不是链接，点击后 URL 不变，但主页出现 URL 表单。只扫描 `<a href>` 永远找不到它。

### 4. 第一方子域

SpotSaaS 从 `www.spotsaas.com` 跳到 `partners.spotsaas.com`。这是同一父域下的第一方流程，不应按外站拦截。

### 5. 多语言动作词遗漏

ProductLaunch 使用葡萄牙语 “Enviar Projeto”，登录路径也使用 `/entrar`。旧英文/中文动作词和登录路径规则无法可靠识别。

### 6. 主页就是最终表单

RankInPublic 的主页已经含 URL 字段。若算法假设“提交页一定不是主页”，会错过正确结果。

### 7. 主页内价格锚点

IndieTool 的提交 CTA 只滚动到 `#pricing`，没有独立提交页面。它应被归类为付费终点，不能围绕相同锚点重复搜索。

### 8. 空壳提交路由

Aura++ 的路径正确，但匿名状态下主内容为空。等待后仍为空，应停止自动搜索并请求人工检查。

### 9. 网络层故障

- FastLaunch：重复超时，无法取得文档。
- JustGotFound：连接被服务器关闭。

这两项不能通过增加搜索层数解决，应设置有限重试和失败原因。

## 本轮已经实施的通用优化

1. **第一方子域放行**：父域与其真实子域现在视为同一站点，例如 `spotsaas.com` → `partners.spotsaas.com`；相似但不属于该域的地址仍不会放行。
2. **葡萄牙语识别**：加入 `Enviar Projeto`、`Cadastrar Produto` 等动作、`projeto/produto/ferramenta` 产品词，以及 `/entrar` 等登录路径。
3. **唯一提交按钮分支**：链接图无高置信入口时，可点击页面上唯一、可见、精确匹配且不属于任何表单的提交按钮；点击后重新扫描字段。该安全限制避免误触真正的表单提交按钮。
4. **空页面稳定等待**：仅当页面正文极少且没有字段时额外等待 3 秒，再读取一次 URL、字段和正文，以捕获 WebCatalog 这类延迟认证跳转。正常页面不增加等待。
5. **继续沿多层真实入口搜索**：Desifounder 的 `Spotlight → Feature → Login` 验证了多层图搜索的必要性；现有限额为最多 8 层，并有总尝试次数上限，不会无限循环。

## 验证结果

- `pnpm run build`：通过，TypeScript 和生产构建均成功。
- `pnpm run lint`：未进入代码检查；仓库现有 `eslint.config.js:15` 在加载配置时抛出 `Cannot read properties of undefined (reading 'recommended')`。这不是本轮改动引起的代码 lint 错误。
- 本轮未提交任何第三方表单，未创建账号，未绕过验证码。

## 建议的产品呈现

批量界面应同时维护三个队列：

1. **自动队列**：继续扫描和填写无需人工的网站。
2. **人工队列**：立即展示登录、注册、验证码、付款确认或空壳页；人工处理后自动恢复保存的提交地址。
3. **故障队列**：记录超时、连接关闭、404、空壳页和有限重试次数，避免无限重跑。

这样人工队列与自动队列可以并行，不需要等所有人工步骤处理完才继续其他网站。
