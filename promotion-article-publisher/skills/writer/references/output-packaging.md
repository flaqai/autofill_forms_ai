# Output Packaging Guide

Use this reference when the user asks for a final SEO article deliverable, especially when files and images are required.

## Directory Structure

Create one folder per article:

```text
writer/output/<article-slug>/
├── article.md
├── hero-16x9.png
├── hero-16x9-r2.webp
├── section-01-16x9.png
├── comparison-chart-16x9.png
├── image-urls.json
└── seo-audit.md
```

Only include files that are actually created. `seo-audit.md` is optional unless the user requests audit notes or the audit findings are useful to preserve. `*-r2.webp` and `image-urls.json` exist only when optional R2 upload is configured and succeeds.

## Slug Rules

Derive `<article-slug>` from the final article title:

- Lowercase.
- Prefer ASCII transliteration when practical.
- Replace spaces with hyphens.
- Remove punctuation and symbols.
- Keep under 80 characters when practical.
- If the title is not English, use a short English slug that reflects the topic.

Examples:

- `Happy Horse 1.0 vs Seedance 2.0: What Creators Should Know` -> `happy-horse-10-vs-seedance-20`
- `AI 视频生成器教程` -> `ai-video-generator-guide`

## Markdown Article Rules

Save the article to:

```text
writer/output/<article-slug>/article.md
```

The Markdown should include:

- One H1.
- A short intro or quick summary.
- Logical H2/H3 sections.
- Embedded images using relative paths first, then public R2 URLs after upload when R2 is configured.
- No Markdown tables by default, because many publishing editors do not preserve them reliably. Use bullet lists, short subsections, comparison cards, or definition-style blocks unless the user explicitly asks for tables.
- FAQ.
- Conclusion.
- SEO meta pack at the bottom with SEO Title, Excerpt, Meta Description, and Tags.

Use local image references before upload:

```markdown
![Descriptive alt text](./hero-16x9.png)
```

Local relative paths are valid final output. Only when `writer/config/r2.config.json` exists and is valid should the script upload images and replace local references with returned public URLs. If the config is absent, keep local paths and complete the task normally.

Image placement should support the reading flow:

- Put `hero-16x9.png` after the H1 or the first short intro paragraph.
- Put section images immediately before the section they support.
- Put chart images immediately before or after the relevant chart/table.
- Do not cluster all images at the end unless the user asks for an image gallery.

## Image Asset Rules

Generate article images with Codex's built-in image generation capability when available. Store all article images in the same article folder. Use 16:9 resolution.

Every final article should include image support by default. Generate and insert at least one hero image when possible. For tutorials, comparisons, reviews, prompt guides, and long explainers, prepare 1 to 2 supporting section images when they help the reader. If image generation is not used or cannot save usable files, create `image-plan.md` in the article folder with filenames, placements, alt text, and ready-to-use 16:9 prompts.

Do not use hand-drawn SVGs, generic placeholders, or chart mockups as a substitute for Codex image generation unless Codex image generation is unavailable in the current environment. If generated images are saved in Codex's generated image directory, copy the PNG files into the article folder and keep the original generated files untouched.

Recommended filenames:

- `hero-16x9.png`: primary article image.
- `section-01-16x9.png`: section image.
- `section-02-16x9.png`: another section image.
- `comparison-chart-16x9.png`: editorial chart or comparison visual.

For local draft files, descriptive names are acceptable. For R2 public object filenames, use SEO-friendly alphanumeric-only basenames. Prefer filenames that include the image subject, article keyword, and image role, such as `seedance20AiVideoHero.png`. The upload script can derive this from `--seoName`, `--keyword`, or `--topic`.

Before R2 upload, let `writer/scripts/upload-r2.mjs` create a compressed local upload copy. By default it uses high-quality WebP (`--compressionQuality 88`) and writes a sibling file such as `hero-16x9-r2.webp`; it uploads that copy only when it is meaningfully smaller, otherwise it uploads the original and records the skip reason in `image-urls.json`.

Recommended image types:

- News/review article: hero image plus comparison chart.
- Tutorial: hero image plus step/workflow image.
- Comparison article: hero image plus one chart image.
- Prompt guide: hero image plus prompt workflow diagram.

## Codex Image Prompt Pattern

Use this prompt pattern when generating article images:

```text
Create a 16:9 editorial image for an SEO article about {{TOPIC}}.
Visual focus: {{MAIN_SUBJECT}}.
Context: {{ARTICLE_ANGLE}}.
Style: clean modern editorial, realistic or polished product-workflow aesthetic, high clarity, no fake UI text, no misleading logos, no unreadable small text.
Composition: wide 16:9 layout, clear focal point, enough negative space for article placement, visually aligned with {{AUDIENCE}}.
Avoid: generic stock-photo look, fake UI captures, fabricated brand marks, clutter, distorted text, unrelated objects.
Aspect ratio: 16:9.
```

For comparison chart images, use:

```text
Create a 16:9 clean editorial comparison graphic for {{MODEL_A}} vs {{MODEL_B}}.
Show abstract labeled columns or visual zones for strengths such as {{CRITERIA}}.
Use simple shapes, readable layout, no fake metrics, no tiny text, no unauthorized logos.
Aspect ratio: 16:9.
```

## Image Save and Insert Steps

1. Generate the image with Codex's built-in image generation capability.
2. Copy the generated PNG into `writer/output/<article-slug>/`.
3. Rename it using the expected filename, such as `hero-16x9.png`.
4. Insert the image into `article.md` with a relative path near the relevant section.
5. Verify the saved image is 16:9 when possible.
6. Check for `writer/config/r2.config.json`. When it exists, run `writer/scripts/upload-r2.mjs`; otherwise keep local image references and do not create R2-only artifacts.

Example:

```markdown
![Happy Horse AI and Seedance 2.0 video model comparison](./hero-16x9.png)
```

If Codex image generation cannot save usable local image files in the current environment, save a short image plan in the article folder, listing:

- Filename.
- Intended placement.
- Alt text.
- Codex image prompt.

Then tell the user image assets still need generation.

## Final Response Rules

After creating files, respond with:

- The saved article path.
- The saved image paths.
- The public R2 image URLs and non-secret storage info only when upload succeeds; otherwise confirm that the article uses local relative image paths.
- Confirmation that images were generated with Codex's built-in image generation capability, or a clear note if only prompts were prepared.
- A short note about any verification limits.

Do not paste the full article in chat unless the user explicitly asks for it.
