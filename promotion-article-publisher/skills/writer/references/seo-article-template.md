# SEO Article Prompt Template

Use this reference when the user wants a reusable prompt or a full Markdown article format.

## Copy-Ready Prompt

```markdown
You are a professional content editor and SEO writer.
Your task: generate a ready-to-copy Markdown article with clean paragraph spacing and no random line breaks.

## Inputs

- Topic / Title: {{TITLE}}
- Audience: {{AUDIENCE}}
- Article Type: {{TYPE}} (how-to / comparison / listicle / explainer)
- Main Keyword: {{MAIN_KEYWORD}}
- Supporting Keywords: {{SUPPORTING_KEYWORDS}}
- Target Length: {{WORD_COUNT}} (for example, 900-1500 words)
- Tone: {{TONE}} (neutral editor / industry insider / tutorial)
- CTA / Link: {{CTA_LINK}} with up to 2 anchor texts, {{CTA_ANCHOR_FIRST}} and {{CTA_ANCHOR_FINAL}} (optional)
- Must Include: {{MUST_INCLUDE}} (for example, steps, FAQ, checklist)
- Must Avoid: {{MUST_AVOID}} (for example, fake stats, exaggerated claims)

## Output Rules

- Output ONLY Markdown with no extra commentary.
- Use H1 once, then H2/H3 for structure.
- Let H2 headings be descriptive and moderately longer when useful; include the main keyword, close variants, or supporting keywords where natural.
- Keep natural paragraph spacing with a blank line between paragraphs.
- Use bullet lists only when helpful.
- Avoid Markdown tables by default because many website editors and Patreon-style rich text editors do not preserve them reliably. Use bullet lists, short subsections, comparison cards, or definition-style blocks instead unless the user explicitly asks for a table.
- If {{CTA_LINK}} is provided, link to that target promotion URL no more than twice in the article body: once on the first natural mention and once on the final natural mention or CTA. Use {{CTA_ANCHOR_FIRST}} for the first link and {{CTA_ANCHOR_FINAL}} for the final link when both are provided. Do not link every repeated mention. This limit does not apply to factual source citations or non-promotional reference links.
- Do not invent numbers, quotes, studies, rankings, citations, or product specs.
- If uncertain about a fact, phrase it safely with terms like "often" or "in many cases," or omit it.
- Ensure keywords appear naturally and avoid keyword stuffing.
- Verify objective claims before finalizing. Use current, authoritative sources for facts that may change.
- Reference existing online analysis for context only; synthesize original conclusions instead of copying structure or wording.
- If user-provided UI reference images guide the article, use them as private reference material only. In the published article, captions, alt text, source note, SEO metadata, and audit notes, describe the interface directly instead of naming the reference format.
- Use varied sentence length, clear transitions, and specific SEO-friendly phrasing.
- After drafting, audit the article for search intent, TDK, headings, first 100 words, keyword distribution, FAQ usefulness, image SEO, trust signals, and unsupported claims.
- Apply high-impact audit fixes before final output.
- After the audit fixes, load `writer/references/humanization.md` and humanize the corrected draft. Preserve verified facts, certainty, required keywords, citations, code, URLs, image paths, and the intended voice.
- Recheck all passages and publishing elements changed during humanization. Do not invent personal experience or claim that the output can bypass AI detectors.
- Save the final article as `writer/output/<article-slug>/article.md`.
- Generate article images with Codex's built-in image generation capability at 16:9, then save them under the same `writer/output/<article-slug>/` directory.
- Every final article should include image support by default: generate and insert at least one hero image when possible; for tutorials, comparisons, reviews, prompt guides, and long explainers, prepare 1 to 2 supporting section images. If image generation is not used or cannot save usable files, save `image-plan.md` with filenames, placements, alt text, and ready-to-use 16:9 prompts.
- Embed generated images with relative paths. Check for `writer/config/r2.config.json`; upload and replace the paths only when that local config exists and is valid. Missing R2 config is not an error.

## Required Article Structure

# {{TITLE}}

The H1 should naturally include {{MAIN_KEYWORD}} or a close grammatical variant unless that would make the title misleading or awkward.

## Quick Summary

Write 2-3 sentences summarizing the value of the article for {{AUDIENCE}} and naturally include {{MAIN_KEYWORD}} once.

## Why This Matters

Explain the problem or context in plain language. Mention 1-2 supporting keywords naturally.

## Key Takeaways

Provide 4-6 practical bullets. Each bullet should be specific.

## Main Content

Create 4-7 H2 sections depending on {{TYPE}}:

- If how-to: include a clear step-by-step section with numbered steps.
- If comparison: include five comparison dimensions: who it is for, ease of use, output quality, key features, and recommendations.
- If listicle: include 6-10 items with short explanations and a "best for" line when useful.
- If explainer: include definitions, common misconceptions, and practical application.

H2 headings should be specific enough for search intent. For example, prefer `## Happy Horse AI Latest News: What Changed for Video Creators` over `## Latest News` when the longer heading reads naturally.

Each main paragraph should follow this pattern:

Conclusion sentence -> 2-3 explanation sentences -> 1-3 examples or steps -> one short wrap-up sentence.

For factual or comparison sections, distinguish verified fact from editorial judgment. Explain the criteria before recommending an option.

## FAQ

Write 3-5 FAQs with concise answers.

## Conclusion

Wrap up with 2-4 sentences. Include {{MAIN_KEYWORD}} once.

If {{CTA_LINK}} is provided and the target URL has not already been linked twice, include the final target link here using {{CTA_ANCHOR_FINAL}} or a natural CTA anchor.
If no CTA is provided, suggest a practical next step.

---
SEO Title: {{SEO_TITLE_SUGGESTION}}
Excerpt: {{EXCERPT_SUGGESTION}}
Meta Description: {{META_DESCRIPTION_SUGGESTION}}
Tags: {{TAGS_SUGGESTION}}
```

## Image Block Pattern

Add article images where they help the reader:

```markdown
![{{ALT_TEXT}}](./hero-16x9.png)
```

Use natural alt text that describes the image and includes a relevant keyword only when it fits.

## Audit-and-Optimize Prompt

Use this when the user provides an existing draft or asks to improve SEO performance:

```markdown
You are a professional SEO editor. Audit the article first, then rewrite it for stronger Google-friendly SEO.

Inputs:
- Article / URL content: {{ARTICLE_CONTENT}}
- Audience: {{AUDIENCE}}
- Article Type: {{TYPE}}
- Main Keyword: {{MAIN_KEYWORD}}
- Supporting Keywords: {{SUPPORTING_KEYWORDS}}
- Target Length: {{WORD_COUNT}}
- Tone: {{TONE}}
- Must Avoid: {{MUST_AVOID}}

Audit rules:
- Separate deterministic checks from semantic judgment.
- Extract and check objective claims before rewriting.
- Do not invent technical facts, statistics, citations, rankings, or product specs.
- If technical page data is unavailable, mark it as "needs tool verification."
- Rank findings as Critical, High, Medium, or Low.
- Improve sentence rhythm with short and medium sentences, clear transitions, and natural keyword variations.
- After applying the audit fixes, run the post-audit humanization workflow in `writer/references/humanization.md`, then verify that the rewrite preserved facts and SEO requirements.

Output:
1. SEO Audit Summary.
2. Findings table with Priority, Area, Evidence, Why it matters, Recommended fix.
3. Rewrite plan focused on the top fixes.
4. Optimized and humanized Markdown article.
5. SEO Title, Excerpt, Meta Description, Tags.
6. File output plan: article path and 16:9 image filenames.
7. Humanization notes covering the voice target, revised patterns, and meaning preservation.
8. Re-audit notes summarizing what improved and what still needs human/tool verification.
```

## Outline-First Prompt

Use this before drafting body copy:

```markdown
Create an SEO article outline only. Do not write the full article yet.

Inputs:
- Topic / Title: {{TITLE}}
- Audience: {{AUDIENCE}}
- Article Type: {{TYPE}}
- Main Keyword: {{MAIN_KEYWORD}}
- Supporting Keywords: {{SUPPORTING_KEYWORDS}}
- Target Length: {{WORD_COUNT}}
- Tone: {{TONE}}

Output:
1. Article task card in 10 lines or fewer.
2. One recommended H1 title.
3. Table of contents with H2/H3 headings.
4. For each section, include 1-3 bullets describing the point, search intent, and keyword usage.
5. List any facts that need human verification.

Rules:
- Structure only, no body paragraphs.
- Keep the outline tightly focused on the main keyword.
- Do not invent data, citations, or claims.
```

## SEO TDK Rules

- SEO Title: attractive, related to the content, 65 to 70 characters; include the main keyword when natural.
- Article title / H1: include the main keyword or a close variant when natural and readable.
- H2 headings: include the main keyword or supporting keywords where useful, but avoid repetitive exact-match phrasing.
- Excerpt: short, related to the content, and 155 to 160 characters.
- Meta Description: attractive, related to the content, and 55 to 160 characters; summarize the benefit and search intent.
- Tags: 3-6 short tags, mixing the main keyword and supporting topics.

## Manual Review Checklist

- The topic, audience, type, and keywords are explicit.
- The H1/title includes the main keyword or a natural close variant.
- The outline matches the search intent.
- The article has one H1 and logical H2/H3 structure.
- H2 headings are descriptive, context-rich, and keyword-aware without stuffing.
- The main keyword appears in the first paragraph or H1, one H2, and the conclusion.
- Supporting keywords appear naturally at least once.
- No fake data, quotes, studies, citations, or product specifications are present.
- The tone is editorial, objective, and not overly promotional.
- FAQ has at least 3 useful questions.
- SEO Title, Excerpt, and Meta Description respect length limits.
- Audit findings have been applied, especially Critical and High issues.
- Objective claims have been verified, softened, cited, or removed.
- The audit-corrected draft has completed the humanization pass in `writer/references/humanization.md`.
- Humanization did not invent experience, strengthen claims, alter technical tokens, or break keywords, metadata, citations, links, code, or image paths.
- If user-provided UI reference images guided the article, the article describes visible interface details directly and does not mention the reference format.
- The article uses original synthesis rather than copying existing analysis.
- Sentence flow is clear, varied, and connected by explicit logic.
- Article and image assets are saved under `writer/output/<article-slug>/`.
- If local R2 config is absent, article image Markdown keeps relative paths and no `image-urls.json` is required.
- If R2 upload is used, article image Markdown uses public R2 URLs and `image-urls.json` records the mapping.
- If R2 upload is used, each image record includes SEO filename source, alt text, keyword/topic metadata, bucket, object key, date path, and public URL.
