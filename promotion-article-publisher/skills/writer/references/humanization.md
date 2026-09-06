# Post-Audit Humanization Guide

Use this reference after fact-checking, SEO auditing, and the first audit-driven rewrite. Its purpose is to make the final article easier and more natural to read without weakening accuracy, search intent, or the author's voice.

This workflow is inspired by [blader/humanizer](https://github.com/blader/humanizer), an MIT-licensed agent skill based on Wikipedia's “Signs of AI writing” guidance. This project adapts the underlying editorial ideas to an SEO production workflow; it does not copy the upstream skill or treat any single phrase as proof that text was written by AI.

## Goal

Humanization is an editorial pass, not an AI-detector evasion pass. Improve rhythm, specificity, voice, and reader comfort. Do not optimize for an “AI score,” insert deliberate errors, or make the prose less accurate to appear human.

The final article should:

- preserve every verified fact, limitation, citation, URL, code sample, image path, product name, and required keyword;
- keep the original argument and level of certainty;
- sound appropriate for its format, audience, and publication;
- replace generic or mechanical prose with concrete, direct language;
- retain useful structure without making every section look identical.

## Inputs

Use these inputs when available:

1. The audit-corrected article draft.
2. The task card and intended publication format.
3. The fact-check or claim ledger.
4. SEO requirements and metadata length limits.
5. A user-provided writing sample or an existing approved article.

If a writing sample is provided, calibrate the voice before editing. Note its sentence length, vocabulary, paragraph openings, punctuation, transitions, directness, and amount of first-person commentary. Match those traits without copying memorable phrases.

If no sample is provided, use a clear editorial voice with varied sentence length and a level of personality appropriate to the content. Technical, legal, medical, and reference content may need a neutral voice. Do not inject jokes, opinions, or first-person experience into those formats.

## Non-Negotiable Preservation Rules

Do not invent any of the following during humanization:

- personal experience, product testing, interviews, quotes, or anecdotes;
- measurements, examples presented as real events, or named customers;
- stronger product claims, rankings, guarantees, or causal conclusions;
- certainty that was not present in the verified draft;
- sources or attributions that were not checked.

Do not edit text inside quotations, code blocks, API paths, model identifiers, filenames, URLs, or legal wording merely to improve style. Preserve meaningful keywords and metadata constraints, but rewrite surrounding sentences when exact-match SEO language sounds forced.

## Humanization Pass

### 1. Establish the voice target

Write a one-line internal voice brief before editing. Include:

- publication and reader;
- formal, conversational, technical, editorial, or narrative register;
- first person allowed or not allowed;
- desired pace and paragraph density;
- any author sample to follow.

Example: “Practical third-party review for working designers; direct, lightly opinionated, mixed sentence lengths, no invented first-person testing.”

### 2. Look for clusters of mechanical writing

Do not flag a word or punctuation mark in isolation. Look for repeated patterns across a paragraph or section:

- significance inflation that turns ordinary details into major shifts or broader trends;
- promotional adjectives and unsupported superlatives;
- vague attribution such as “experts say” or “industry reports show” without a source;
- trailing `-ing` phrases that imply analysis without adding evidence;
- repeated AI-coded vocabulary, ceremonial transitions, or abstract nouns where a plain verb would work;
- repeated “not just X, but Y” constructions, forced contrasts, or fake-candid rhetorical openers;
- lists that repeatedly contain exactly three items for no practical reason;
- synonym cycling that renames the same subject in every sentence;
- uniform sentence length, paragraph shape, and section cadence;
- headings followed by a sentence that merely repeats the heading;
- excessive bold text, emojis, title-case headings, or dense dash-heavy asides;
- chatbot artifacts such as “I hope this helps,” “let me know,” or offers to continue;
- generic conclusions about a bright future, changing landscapes, or exciting possibilities;
- manufactured punchlines, stacked sentence fragments, or slogan-like aphorisms.

Preserve legitimate technical terminology, deliberate repetition, house style, quotations, and punctuation habits from a real voice sample. A polished or formal sentence is not automatically an AI pattern.

### 3. Rewrite for a reader, not for a pattern checklist

Apply the smallest change that improves the passage:

- state the concrete fact before interpreting it;
- prefer `is`, `has`, and specific verbs when a grander construction adds nothing;
- replace vague authority with a named source, or remove the attribution;
- vary sentence length and paragraph openings naturally;
- merge repetitive setup sentences and cut signposting that announces the next section;
- use the number of examples the subject requires instead of forcing symmetry;
- keep some asymmetry in section length when the information warrants it;
- allow qualified judgment, tension, or uncertainty only when the writer can support it;
- end on a specific implication, decision, or next action rather than a generic summary.

Natural writing does not require slang, fragments, humor, or first person. Use them only when they fit the publication and the verified author voice.

### 4. Run the “still mechanical” question

After the first rewrite, ask internally:

> What still makes this passage feel templated, over-polished, or generated rather than written for this reader?

List only concrete remaining issues, then revise once more. Do not expose this internal critique in the article unless the user asks for an audit report.

### 5. Read for cadence and friction

Read the final text aloud or simulate an aloud reading. Fix:

- consecutive sentences with the same length or opening;
- paragraphs that take too long to reach the point;
- abrupt transitions introduced during shortening;
- lists that would read better as prose, and prose that would scan better as a list;
- claims whose meaning or certainty changed during rewriting.

## Post-Humanization Integrity Check

Humanization happens after the main SEO audit, so it can accidentally reintroduce problems. Check the changed areas again:

- search intent and reader promise still match;
- H1 and heading hierarchy are intact;
- the primary keyword remains in required positions and still sounds natural;
- SEO title, excerpt, and meta description remain within their limits;
- verified numbers, dates, prices, product features, and citations are unchanged;
- code, URLs, filenames, local image paths, and CTA destinations still work;
- no invented experience or attribution was introduced;
- no promotional claim became stronger;
- the ending is specific and appropriate to the publication;
- the prose has varied rhythm without theatrical messiness.

If the humanization pass conflicts with factual accuracy, required legal wording, code correctness, or a direct user instruction, preserve the higher-priority requirement.

## Audit Note Format

Record the pass briefly in the article audit:

```markdown
## Humanization pass

- Voice target: ...
- Patterns revised: ...
- Meaning and verified claims preserved: yes / no, with notes
- SEO and metadata rechecked: yes / no, with notes
- Remaining style risk: ...
```

Do not claim that the article is “undetectable,” “100% human,” or guaranteed to bypass an AI detector. The defensible result is a more specific, natural, and reader-appropriate final edit.
