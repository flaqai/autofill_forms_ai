# Fact Check and SEO Style Guide

Use this reference for fact-heavy writing, objective comparisons, article polishing, and final optimization. The goal is to make content useful, reliable, original, and easy to read without copying existing analysis.

## Fact Check Workflow

1. Extract claims from the draft.
2. Sort claims by risk:
   - High risk: legal, medical, financial, safety, policy, pricing, availability, rankings, statistics, and product specs.
   - Medium risk: definitions, market claims, feature comparisons, trend claims, and historical context.
   - Low risk: general advice, subjective framing, and common workflow suggestions.
3. Verify high-risk and medium-risk claims with reliable sources.
4. Decide the action for each claim:
   - Keep: evidence supports it.
   - Cite: source is important for trust or decision-making.
   - Soften: evidence is partial or context-dependent.
   - Remove: claim is unsupported, unverifiable, outdated, or unnecessary.
5. Rewrite the article after fact checks.
6. Re-read the changed sections to make sure the article still flows naturally.

## Source Preference

Prefer sources in this order:

1. Primary sources: official documentation, product pages, company announcements, standards, laws, government pages, research papers, public datasets.
2. Reputable secondary sources: established industry publications, expert explainers, well-maintained documentation, or credible analysis.
3. Community discussion: useful for pain points and use cases, but do not treat it as verified fact without stronger support.

For current facts, browse or verify. Do not rely on memory for prices, product features, rankings, policies, regulations, statistics, or recent market claims.

## Using Existing Online Analysis

Use online analysis as context, not as copy:

- Identify common criteria, missing angles, objections, and user questions.
- Compare multiple viewpoints before forming a recommendation.
- Write the final explanation in original structure and phrasing.
- Add your own reasoning, trade-offs, and decision rules.
- Do not copy another article's order, examples, metaphors, scoring, or conclusion.
- When a source supplies a key fact, cite or mention it instead of disguising it as original discovery.

## Claim Ledger Format

Use this compact ledger internally or in the output when the user asks for transparency:

```markdown
| Claim | Risk | Evidence | Action |
|---|---:|---|---|
| {{claim}} | High | {{source or reason}} | Keep / Cite / Soften / Remove |
```

## Deep Comparison Pattern

Before writing a comparison, define the criteria. Good comparison criteria often include:

- Target user or scenario.
- Ease of use and learning curve.
- Setup cost, maintenance effort, or workflow friction.
- Output quality or performance.
- Customization and control.
- Integrations and ecosystem.
- Risk, limitations, privacy, compliance, or lock-in.
- Best-fit recommendation.

Use this section shape for each option:

1. What it is best for.
2. What it does well.
3. Where it is limited.
4. Evidence or grounded reasoning.
5. Who should choose it.

Avoid shallow "A is better than B" claims. Prefer conditional recommendations:

- "Choose A if..."
- "Choose B when..."
- "Avoid C if..."
- "The main trade-off is..."

## SEO-Friendly Sentence Style

Write for skimmability and semantic clarity:

- Start sections with the answer or conclusion.
- Follow with context, evidence, and examples.
- Mix sentence length: use short sentences for key points and longer sentences for nuance.
- Keep one idea per sentence when explaining steps or criteria.
- Use transition words intentionally: because, however, for example, in practice, by contrast, as a result, before, after, if, when.
- Use exact keywords where natural, then vary with related terms and synonyms.
- Use concrete nouns: "meta description," "comparison criteria," "setup time," "image alt text."
- Avoid filler: "very," "extremely," "game-changing," "revolutionary," "best-in-class" unless objectively proven.
- Avoid vague SEO padding: repeated definitions, generic benefits, and broad claims with no example.

## Paragraph Rewrite Pattern

Use this pattern to improve weak paragraphs:

1. Lead with the point.
2. Add the reason or context.
3. Add evidence, example, step, or comparison.
4. Close with the implication for the reader.

Weak:

```markdown
There are many tools available today, and choosing one can be difficult. It is important to compare them carefully because every tool is different.
```

Stronger:

```markdown
Choose the tool based on the workflow you need to repeat most often. A beginner may care more about setup time and templates, while an experienced team may value customization, integrations, and review controls. This makes the comparison more useful than a simple feature checklist.
```

## Final Style Check

- Does each H2 answer a real search question?
- Does the first sentence of each section make a clear point?
- Are long sentences balanced with shorter ones?
- Are transitions clear between ideas?
- Are keywords natural and varied?
- Are examples specific enough to help the reader decide or act?
- Are claims verified, softened, cited, or removed?
- Is the article original in structure and interpretation?
