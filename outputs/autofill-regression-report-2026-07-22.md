# SEO 表单自动填写回归测试报告

测试日期：2026-07-22

## 结论摘要

- 用户提供了 50 条链接，其中 `sites-plus.com` 重复 1 次，实际测试 49 个不同网站。
- 24 个网站存在公开提交流程；其中 11 个代表性网站完成了受控写入验证，13 个完成了表单结构与入口确认。
- 14 个网站必须先登录或注册。插件可以保留任务并等待人工登录，但不能在未登录环境中验证登录后的表单。
- 8 个网站停在 Cloudflare 或浏览器安全检查页。这不是字段匹配失败，需要用户先完成验证。
- 2 个网站没有公开的 SEO/产品提交表单，属于账号上传、付费联系或内容发布流程。
- 1 个网站当前返回 504，站点服务器不可用。
- 测试没有点击任何最终提交按钮，没有发送测试资料，也没有处理 CAPTCHA。

## 本轮修复

1. **只保留主要提交表单**
   - 页面同时存在搜索、登录、订阅和真正提交表单时，按字段组合和表单语义评分，排除干扰表单。
   - 主要解决 TravelTourismDirectory、HotWebURLs、CanadianDirectory 等旧式目录站混填登录框、搜索框的问题。

2. **排除危险或无意义字段**
   - 排除搜索框、密码、验证码、OTP、计数器、只读字段。
   - 识别 `authcode`、`checkcode`、同一表格行里的 `Validation Code`。
   - 识别 honeypot / spam trap，以及 `tabindex=-1`、`autocomplete=off` 的诱饵字段。
   - 主要解决 247WebDirectory 的 `website_confirm` 诱饵字段和 Blogs-Collection 的 `txtNumber` 验证码字段。

3. **补充确定性字段匹配**
   - AI 漏掉明确的产品名、官网、描述、短描述、分类、关键词、公司、联系人、邮箱、电话时，使用推广资料做高置信度本地补充。
   - AI 请求失败时，明确字段仍可进行有限的本地填写，不再整页直接报 `Failed to generate form data`。
   - 普通邮箱仍优先使用“常用提交邮箱”，仅明确要求公司邮箱时使用“公司邮箱”。

4. **修复富文本编辑器标签识别**
   - 不再把 `H1 / H2 / B / I / Link / List` 工具栏误认为字段名称。
   - 优先识别真正的 `Introduction`、`Short Description`、`Description` 标签。
   - 覆盖 TinyMCE、iframe 编辑器和 `contenteditable` 编辑器。

5. **补一次动态字段复扫**
   - 分类或价格选择后，如果网页新显示一组字段，插件等待 650ms 后只再检查一次新字段。
   - 这是一次有上限的页面阶段补全，不是无限循环，也不会点击最终提交。

6. **保留免费推广选项**
   - `Featured Ad`、`Extended Ad` 等付费升级下拉框优先选择 `None`，除非资料库明确保存了付费选项。

## 受控写入结果

以下测试均使用无害占位内容，确认字段发生变化后立即清空：

| 网站 | 验证内容 | 结果 |
|---|---|---|
| TravelTourismDirectory | 标题、URL、描述 | 写入成功；CAPTCHA 留给人工 |
| TipSeason | Radix 自定义分类菜单 | 成功打开并选中 `Image Generation` |
| SubmitExpress | iframe 内的 Business Phone | iframe 内写入成功 |
| Sites-Plus | TinyMCE iframe 正文 | 写入并清空成功 |
| SiteLike | 单字段网站 URL | 写入成功 |
| Free-WebLink | 标题、URL、描述、姓名、邮箱 | 5 个字段全部写入成功 |
| Toolsfine | 工具名、URL、公司 | 写入成功；页面为 $10 付费流程 |
| ProjectHunt | 首页 Submit 弹窗中的邮箱、项目名、URL | 弹窗打开和写入均成功 |
| 247WebDirectory | 标题、URL、描述、邮箱 | 写入成功；诱饵字段和 CAPTCHA 已排除 |
| NextFreeAds | 标题、地点、正文、邮箱、两个推广下拉 | 文本写入成功；两个下拉均选中 `None` |
| FLSFLS | URL、网站名、图标 URL、分类 | 写入成功；验证码和反链要求留给人工 |

## 逐站结果

状态说明：

- **已验证**：真实页面完成受控写入并清空。
- **结构确认**：已打开真实表单并确认字段，未点击最终提交。
- **人工登录**：必须先登录或注册，登录后可继续测试。
- **人工验证**：Cloudflare、浏览器检查或 CAPTCHA 需要人工完成。
- **非公开流程**：当前没有公开的 SEO/产品提交表单。

| # | 网站 | 状态 | 结果与限制 |
|---:|---|---|---|
| 1 | traveltourismdirectory.info/submit.php | 已验证 + 人工验证 | 老式目录表单可写；搜索/登录/计数器已排除；最终 CAPTCHA 人工处理。 |
| 2 | tipseason.com/ai-tools/submit-free | 已验证 | 普通字段可读；自定义分类菜单成功选择 Image Generation。 |
| 3 | tipocode.com/submit-site | 人工登录 | 页面要求创建账号或登录。 |
| 4 | tinystartups.com/submit | 人工登录 | 未登录时进入登录流程。 |
| 5 | submitexpress.com/free-tools/free-website-submission/ | 已验证 | 表单位于 iframe；跨 iframe 字段写入成功；站点有每日提交限制。 |
| 6 | startupinspire.com/dashboard | 人工登录 | 自动跳转到登录页。 |
| 7 | sitesondisplay.com/add.html | 结构确认 | URL、邮箱、姓名和条款字段可识别。 |
| 8 | sites-plus.com/submit?c=3&LINK_TYPE=9 | 已验证 | 标题、URL 等普通字段可读；TinyMCE 描述写入成功。 |
| 9 | sitelike.org/add-site | 已验证 | 页面广告 iframe 很多，但主表单只有一个 URL 字段，写入成功。 |
| 10 | promptzone.com | 人工登录 | 首页只有搜索和账号入口，没有公开产品提交表单。 |
| 11 | navgood.com | 人工验证 | Cloudflare 安全检查。 |
| 12 | locanto.org | 人工验证 | 浏览器检查页面。 |
| 13 | lionaibox.com | 站点异常 | 实测返回 Cloudflare 504 Gateway Time-out，Host Error。 |
| 14 | hotweburls.com/submit.php?c=1&LINK_TYPE=2 | 结构确认 + 人工验证 | 真实老式目录表单；主表单筛选规则适用；最终验证人工处理。 |
| 15 | gtawebdirectory.com/submit.php | 结构确认 + 人工验证 | 标题、URL、描述、关键词、邮箱、分类可识别。 |
| 16 | freewebsubmission.com | 结构确认 | 发现公开提交表单；站点资源加载较慢。 |
| 17 | freelistingindia.in/create-listing | 人工登录 | 自动跳转登录。 |
| 18 | free-weblink.com/submit.php | 已验证 | 标题、URL、描述、姓名、邮箱全部写入成功；页面加载慢但表单可用。 |
| 19 | early.tools/submit | 人工登录 | 需要账号或 magic-link 登录。 |
| 20 | directory.ldmstudio.com | 结构确认 | 先选择免费/付费和分类链接，再进入具体提交表单；属于多步公开流程。 |
| 21 | coodoeil.fr | 结构确认 | `proposer_un_site.php` 为 1/2 步表单，包含 URL、公司、姓名等字段。 |
| 22 | classifiedads.com/post.php | 结构确认 | 先选 Category，再选 Subcategory，再出现 Location；一次动态复扫用于接住后续字段。 |
| 23 | canadiandirectory.org/submit.php | 结构确认 + 人工验证 | 老式目录表单可识别；计数器和 CAPTCHA 已从自动填写候选中排除。 |
| 24 | calameo.com | 非公开流程 | 当前是账号内文档发布/上传产品，不是公开 SEO 收录表单。 |
| 25 | blogs-collection.com/submit/submit-blog.php | 结构确认 + 人工验证 | 从 `/submit/` 点击 Submit Blog 后进入真实表单；Validation Code 已排除。 |
| 26 | athenelinks.com/submit.php | 结构确认 + 人工验证 | 真实目录表单，含免费/付费层级和最终验证。 |
| 27 | articleted.com | 人工登录 | 属于登录后的文章发布流程。 |
| 28 | 247webdirectory.com/submit | 已验证 + 人工验证 | 4 个业务字段写入成功；`website_confirm` 诱饵字段和 CAPTCHA 已排除。 |
| 29 | vendor.revleads.com | 人工登录 | 自动跳转 `/user/login`。 |
| 30 | toolsfine.com | 已验证 + 付费 | `/submit-ai-tools-or-product` 字段写入成功；当前页面明确收费 $10。 |
| 31 | search.ezilon.com | 非公开流程 | Add URL 指向说明/付费联系页，没有公开可直接填写表单。 |
| 32 | projecthunt.me | 已验证 | 首页唯一 Submit 按钮可打开提交弹窗；邮箱、项目名、URL 写入成功。 |
| 33 | producthubx.com/submit | 人工登录 | 自动跳转登录。 |
| 34 | posthereads.com | 人工验证 | Cloudflare 安全检查。 |
| 35 | open-launch.com/projects/submit | 人工登录 | 自动跳转 `/sign-in?redirect=/projects/submit`；登录后的富文本逻辑已修。 |
| 36 | nextfreeads.com | 已验证 | 文本字段写入成功；Featured Ad 和 Extended Ad 均成功选中 None。 |
| 37 | moonfruit.com/sign-up | 结构确认 | 页面存在公开申请/联系表单，字段较多；不是纯目录表单但可交给共享填写器。 |
| 38 | manytools.ai/submit-tool/ | 人工登录 | 首步可填工具 URL，后续要求登录。 |
| 39 | linkorado.com/add-site.html | 人工登录 | 页面明确提示未登录。 |
| 40 | linkdirectorylistings.org/submit-site/ | 结构确认 | 公开目录提交表单，广告较多；主表单筛选规则适用。 |
| 41 | letspostfree.com | 人工验证 | Cloudflare 安全检查。 |
| 42 | globalclassified.net | 人工验证 | Cloudflare 安全检查。 |
| 43 | genify.dev | 人工登录 + 付费 | `/submit` 跳转登录；用户已标注收费。 |
| 44 | freewebads.biz | 人工验证 | Cloudflare 安全检查；免费推广 None 规则已在同结构站点验证。 |
| 45 | freebestads.com | 人工验证 | Cloudflare 安全检查。 |
| 46 | freeadsonline.biz | 人工验证 | Cloudflare 安全检查。 |
| 47 | freead1.net/post-free-ad | 结构确认 | 公开复杂分类广告表单，含多个地区/分类下拉；需要按步骤检查。 |
| 48 | flsfls.net/apply/ | 已验证 + 人工验证 | URL、名称、图标和分类写入成功；验证码及反向链接要求人工处理。 |
| 49 | firsto.co/projects/submit | 人工登录 | 自动跳转登录。 |

## 验证记录

- `pnpm run build`：通过。
- `git diff --check`：通过。
- `pnpm run lint`：未能执行到源码检查阶段。当前 `eslint.config.js` 使用了依赖版本里不存在的 `reactHooks.configs.flat.recommended`，ESLint 在读取配置时退出；这不是本轮表单代码的编译错误。

## 仍需在用户浏览器确认的事项

1. 更新扩展后，在已登录的 BitBrowser 中复测 Open-Launch、600.tools、FeaturedTool 等登录后富文本页面。
2. 遇到 Cloudflare/CAPTCHA 时先人工完成验证，再点击悬浮按钮或在批量页继续任务。
3. 最终提交前仍需人工检查付费选项、分类、反向链接要求和图片，因为本轮测试刻意没有产生任何外部提交。
4. 由于测试浏览器不加载本地扩展，也没有用户登录态，本报告的“已验证”由真实网页 DOM 写入与插件对应代码路径共同验证；最终的扩展 UI 行为需要更新扩展后在用户浏览器完成最后一轮验收。
