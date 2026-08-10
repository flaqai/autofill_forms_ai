import type { ProductProfile } from '@/types'

type ProductProfileStringKey = {
  [Key in keyof ProductProfile]: ProductProfile[Key] extends string ? Key : never
}[keyof ProductProfile]

export type ProductProfileTextKey = ProductProfileStringKey

export const DEFAULT_PRODUCT_FIELD_DESCRIPTIONS: Partial<Record<ProductProfileTextKey, string>> = {
  productName: '产品或工具的公开名称。用于 Product Name、Tool Name、App Name、Startup Name、Project Name 或产品标题，不要填写公司名或邮箱。',
  websiteUrl: '产品官网或产品主页 URL。Website、Product URL、Tool Link、Homepage、App Website、Official URL 等字段通常使用这里的地址。',
  shortDescription: '一句完整、可独立理解的简短产品介绍或 Tagline。遇到字数限制时应重新精简成完整短句，不要用省略号截断。',
  longDescription: '完整产品介绍，说明产品做什么、主要功能、适用人群和使用场景。用于 Long Description、Overview、Introduction、About 或 Details。',
  category: '产品所属领域和类别关键词。网页提供下拉选项时，应根据这些内容选择最接近的现有分类，不要创造列表中不存在的选项。',
  logoUrl: '可公开访问的 Logo 或 Icon 图片直链。只用于要求填写图片 URL 的字段；文件上传框应使用图库中的 Logo 图片。',
  companyName: '运营该产品的公司或组织名称。仅用于 Company、Business、Organization、Developer Company 等公司主体字段。',
  companyWebsite: '公司或组织的官方网站。只有字段明确询问 Company Website 或 Corporate Website 时使用；产品链接仍优先使用官网 URL。',
  companyPhone: '公司或业务联系电话。用于 Phone、Telephone、Business Phone、Company Phone 或 Contact Number；不要根据其他资料编造号码。',
  contactEmail: '默认使用的常用提交邮箱。普通 Email、Your Email、Contact Email、Submitter Email 等字段优先使用这里的邮箱。',
  companyEmail: '正式公司邮箱。仅在网页明确要求 Business、Work、Official、Corporate Email，或提示 Gmail、免费邮箱、个人邮箱不可用时使用。',
  contactFirstName: '联系人名字（First/Given Name），不包含姓。用于 First Name、Given Name 或联系人名字字段。',
  contactLastName: '联系人姓氏（Last/Family/Surname），不包含名字。用于 Last Name、Family Name 或 Surname 字段。',
  privacyPolicyUrl: '产品或公司隐私政策页面 URL。仅用于 Privacy Policy、Privacy URL 等明确字段。',
  termsUrl: '产品或公司的服务条款页面 URL。用于 Terms、Terms of Service、Terms and Conditions 等明确字段。',
  twitterUrl: '产品、公司或联系人用于推广的 Twitter/X 主页 URL。字段只要求用户名或 Handle 时，可从 URL 中提取账号名。',
  linkedinUrl: '产品或公司的 LinkedIn 页面 URL。仅用于 LinkedIn、Company LinkedIn 等字段。',
  githubUrl: '产品或组织的 GitHub 仓库或主页 URL。仅用于 GitHub、Repository、Source Code 等字段。',
  keywords: '用于搜索、SEO 或 META Keywords 的关键词集合，通常用英文逗号分隔。它描述用户可能搜索的词，不等同于网站的分类标签。',
  tags: '适合在目录站或产品站选择/提交的主题标签。优先匹配网页已有标签选项，并遵守最多可选数量。',
  extraInfo: '保存没有独立字段的补充资料。建议每行使用“字段名称: 内容”，例如 Founding Year: 2024，便于 AI 按语义匹配。',
  lockedFields: '以英文逗号分隔的内部字段名。列出的字段默认保持原值，不允许 AI 随意改写；只有网页存在硬性字数限制时才允许忠实精简。'
}
