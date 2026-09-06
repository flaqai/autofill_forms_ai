# SEO Writing Audit Checklist

Use this reference when auditing a draft, a pasted article, or a published page for SEO writing quality. The goal is not just to find issues, but to turn findings into a better article.

## Audit Philosophy

Use a two-layer audit model:

1. Deterministic checks: verify measurable items such as lengths, counts, keyword placement, FAQ presence, and Markdown heading structure.
2. Semantic checks: judge whether the title, H1, headings, examples, FAQ, and conclusion match the user's search intent.
3. Fact checks: verify objective claims, comparisons, numbers, dates, product details, and current statements before optimizing language.

Do not let semantic judgment invent facts. If a technical result cannot be verified from available content or tools, label it as "needs tool verification."

## Audit Output Format

```markdown
## SEO Audit Summary

- Overall verdict: {{PASS / NEEDS WORK / HIGH RISK}}
- Search intent fit: {{strong / partial / weak}}
- Top priority: {{one most important fix}}

## Findings

| Priority | Area | Evidence | Why it matters | Recommended fix |
|---|---|---|---|---|
| High | Title/H1 | {{observed issue}} | {{impact}} | {{specific change}} |

## Rewrite Plan

1. {{highest impact rewrite action}}
2. {{next action}}
3. {{next action}}

## Optimized Output

{{Rewrite the article, section, TDK, FAQ, or outline depending on the request.}}

## Humanization Pass

- Voice target: {{publication, reader, register, and first-person policy}}
- Mechanical patterns revised: {{specific clusters, not isolated words}}
- Meaning and verified claims preserved: {{yes / no, with notes}}
- SEO and publishing elements rechecked: {{yes / no, with notes}}

## Re-audit Notes

- Improved: {{what changed}}
- Remaining risk: {{anything still unresolved}}
```

## Priority Rules

- Critical: false claim, fake citation, wrong search intent, missing H1, missing title, or severe mismatch between page promise and content.
- High: unverifiable high-impact claim, weak intro, missing main keyword early, poor TDK, thin content, unclear headings, missing FAQ for informational content, or no practical answer.
- Medium: supporting keyword gaps, generic examples, weak image alt suggestions, repetitive headings, unclear CTA, or missing internal-link suggestions.
- Low: minor wording polish, tag refinement, small readability improvements, or optional schema/internal-link ideas.

## Writing-Level Checks

### Search Intent

- Identify the likely user intent: learn, compare, buy, troubleshoot, evaluate, or implement.
- Check whether the title, intro, H2s, FAQ, and conclusion all serve that intent.
- If intent is mixed, recommend a narrower angle rather than adding unrelated sections.

### Title and H1

- Include the main keyword naturally.
- Make the benefit or angle specific.
- Avoid vague titles like "Complete Guide" unless the article is genuinely comprehensive.
- Keep the SEO title attractive, content-related, and 65 to 70 characters.

### Intro and First 100 Words

- State the article's value quickly.
- Include the main keyword once.
- Name the audience or situation when useful.
- Avoid long scene-setting, hype, or generic definitions.

### Heading Structure

- Use one H1 only.
- Use at least 3 meaningful H2 sections for normal articles.
- Prefer H2s that answer sub-questions users search for.
- Use H3s for steps, examples, criteria, or subtopics.
- Avoid repeated heading patterns that sound AI-generated.

### Keyword Use

- Main keyword should appear in H1 or first paragraph, one H2, and conclusion.
- Supporting keywords should appear naturally across relevant sections.
- Use synonyms and related phrases instead of repeating exact-match terms.
- Flag keyword stuffing when a keyword feels forced or repeated without value.

### Content Depth

- Each main section should contain a clear claim, explanation, example or step, and mini-wrap.
- How-to articles need prerequisites, steps, checks, and FAQ.
- Comparison articles need practical decision criteria and recommendations by use case.
- Listicles need a "best for" or selection reason for each item when relevant.
- Explainers need definition, misconceptions, examples, and application.
- Fact-heavy articles need verifiable evidence, uncertainty handling, and clear separation between fact and interpretation.

### Fact Check

- Extract objective claims before rewriting.
- Verify current or high-risk claims with reliable sources when possible.
- Flag unsupported numbers, rankings, dates, product specs, policy statements, or competitive claims.
- Replace absolute statements with conditional wording when evidence is limited.
- Do not copy external analysis; synthesize it into original criteria and reasoning.
- Add citations or source mentions when they materially improve trust.

### Language and Flow

- Use SEO-friendly phrasing that makes topic, entity, and intent easy to understand.
- Mix short and medium sentences; use longer sentences only when they add useful nuance.
- Add explicit transitions between context, comparison, steps, and conclusion.
- Rewrite vague claims into specific, reader-useful statements.
- Remove filler openings, repetitive definitions, and over-optimized keyword repetition.

### FAQ

- Include at least 3 questions.
- Match real follow-up intent: cost, difficulty, safety, alternatives, timing, use cases, limitations, or next steps.
- Keep answers concise.
- Avoid repeating the conclusion in FAQ form.

### TDK

- SEO Title: attractive, related to the content, 65 to 70 characters, and includes the main keyword when natural.
- Excerpt: short, related to the content, and 155 to 160 characters.
- Meta Description: attractive, related to the content, 55 to 160 characters, mentions the value, and avoids generic copy.
- Tags: use 3-6 tags tied to the main keyword, article type, and supporting topics.

### Image SEO

- Suggest 1-3 image ideas that genuinely help the page.
- Provide descriptive alt text, not keyword-stuffed alt text.
- Prefer diagrams, UI captures, comparison tables, step visuals, or examples over decorative images.

### E-E-A-T and Trust

- Add practical limitations, assumptions, prerequisites, or verification notes when relevant.
- Recommend author bio, update date, examples, source links, or product UI captures when the topic needs trust.
- Do not invent personal experience, credentials, or third-party citations.

## Optimization Workflow

When asked to optimize after audit:

1. Fix Critical and High issues first.
2. Resolve fact-check issues before polishing language.
3. Rewrite the title, intro, headings, thin sections, FAQ, and TDK as needed.
4. Preserve accurate details from the original article.
5. Remove unsupported claims instead of replacing them with invented proof.
6. Add missing practical details only when they can be inferred safely from the topic.
7. Improve sentence rhythm, transitions, and keyword variety.
8. Load `humanization.md` and humanize the audit-corrected draft without changing meaning, facts, certainty, citations, technical tokens, or required SEO elements.
9. Recheck claims, keywords, metadata, links, code, image paths, and CTAs touched by the humanization pass.
10. Re-audit changed sections and summarize improvements.

## URL/Page Audit Boundary

For a live URL, only report technical checks as verified if a tool actually inspected them. Otherwise, use this wording:

- "Needs tool verification: robots.txt, sitemap, canonical, schema, status code, PageSpeed, Core Web Vitals, and crawlability."
- "Content-level audit below is based on the visible/pasted content available in this session."

Technical checks that usually require tool verification include robots.txt, sitemap.xml, 404 handling, HTTP/HTTPS redirects, canonical tags, hreflang, schema JSON-LD, PageSpeed, Core Web Vitals, image alt attributes from rendered HTML, internal-link counts, and robots meta directives.
