# Editor Structure Scanning

Use this reference when a target publishing editor profile is missing, stale, contradicted by the live page, or explicitly requested by the user.

## Source of Truth

The authenticated live editor is the only primary source for editor structure.

Evidence priority:

1. Current live editor DOM/ARIA plus visible UI in each reachable editor state.
2. Current non-submitting interaction results such as opened toolbars, menus, media/link dialogs, metadata panels, and preview/settings panels.
3. A previously completed profile whose drift fingerprint still matches.
4. Current user screenshots, only for states that cannot be reached safely.

Never use an old generated article, publishing checklist, or `quick-publish.html` as evidence of the website's structure. Those are outputs and may contain earlier assumptions.

## Safety and Data Minimization

- Read labels, placeholders, help text, control types, constraints, options, editor capabilities, and state transitions.
- Never read or record current input values, draft body text, account credentials, cookies, local storage, session storage, browser history, or private profile data.
- Do not type probe content. Many editors auto-save on input.
- Do not save drafts, upload files, submit forms, send notifications, or click the final publish action during a structure scan.
- Open only reversible controls that do not create an external side effect. If a state can only be reached through a potentially mutating action, record it as blocked and request action-time confirmation before proceeding.

## Required Scan Layers

Complete all layers that the editor exposes.

### 1. Route and Authentication

Record the exact editor URL pattern, redirects, locale, login requirement, account/workspace selector presence, and whether the page is an existing draft, new draft, submission form, or multi-step publishing flow.

### 2. Baseline Page Structure

At the initial viewport, record:

- ordered page regions and headings;
- title, subtitle/description, tags, category, body, cover/thumbnail, SEO, and other fields only when actually present;
- each control's real label, placeholder, control type, required indicator, help text, visible default behavior, and constraints;
- fixed headers, sidebars, bottom bars, character counters, save status, preview controls, and publication controls.

Do not assume a conventional blog schema. A site may be a URL submission form, block editor, Markdown editor, forum composer, or list builder.

### 3. Full-Page Inventory

Inspect the full page from top to bottom. Record sections that appear only after scrolling, sticky/fixed controls, collapsible sections, side panels, and controls whose labels change by viewport position.

DOM extraction alone is insufficient when virtualized or sticky UI is present. Cross-check section order and visibility with the rendered page.

### 4. Editor Capabilities

For every body-like editor, identify:

- implementation class: plain input, textarea, contenteditable, Markdown, rich text, block editor, or iframe editor;
- supported blocks and formatting visible in the toolbar;
- heading levels, lists, quote, code, divider, table, embed, media, link, undo/redo, and mode switches;
- whether paste is expected as plain text, Markdown, HTML, or rich content;
- whether the editor exposes source/HTML mode and whether it has auto-formatting behavior.

Record capabilities, not toolbar icon guesses. Use accessible names, tooltips, menu labels, or opened menus to resolve ambiguous icons.

### 5. Link and Media Workflows

Open reversible link/image/media controls when safe and record every field in the resulting dialog or popover:

- upload versus public URL;
- file types, dimensions, size hints, and multiple-file support;
- alt text, Short Description, caption, credit, title, alignment, and size controls;
- link text, URL, target behavior, preview card behavior, and whether selected text is required;
- insertion location and whether media becomes an independent block.

Close the dialog without submitting or uploading.

### 6. Metadata and Publication States

Record categories, tags, themes, collections, slug, SEO title/description, excerpt, cover, visibility, comments, scheduling, notifications, cross-posting, canonical URL, licensing, audience, and age restrictions only when observed.

For multi-step flows, record the state graph from editor to preview/settings to final confirmation. Distinguish:

- non-submitting navigation;
- actions that may save or mutate a draft;
- the final external publish/submit action.

### 7. Conditional Behavior

Record dependencies such as fields that appear only after selecting a category, choosing URL versus text submission, enabling scheduling, opening advanced settings, or switching editor mode.

Do not manufacture test data to reveal a condition. Use labels, disabled-state explanations, existing empty-state UI, and safe menu inspection. Mark unreachable conditions explicitly.

## Profile Requirements

Save one JSON profile per platform under `references/editor-profiles/`, conforming to `editor-profile.schema.json`.

Every profile must contain:

- scan date, browser, locale, auth state, and completeness status;
- exact routes and all observed editor states;
- ordered sections, fields, toolbars, actions, dialogs, and conditional dependencies;
- an evidence entry for every state;
- a separate `generation_contract` derived from observed facts;
- a drift fingerprint and known limitations.

`observed` content describes the website. `generation_contract` describes how a future quick publishing page should map article material to that website. Never mix the two.

## Completeness Gate

A profile may be marked `complete` only when:

- the authenticated editor route was reached;
- the entire page was inspected, including below-the-fold settings;
- every body editor and visible toolbar was classified;
- safe link/media dialogs were inspected;
- metadata and publication settings were inspected or explicitly confirmed absent;
- the final publish/submit boundary was identified without crossing it;
- every observed field has a label or stable semantic name, control type, order, content meaning, and evidence;
- no blocked state remains that would change the quick-page field list.

Otherwise use `partial`, list blocked states, and do not claim 100% adaptation.

This gate grades the scan, not whether a quick publishing page may be generated. A partial, stale, or drift-risk profile can still improve a quick page when its observed fields have evidence. Preserve those verified portions and downgrade the adaptation claim instead of discarding the profile.

## Drift Detection

Before reusing a profile, compare the live editor against its fingerprint:

- canonical route pattern and locale;
- ordered major section labels;
- ordered field signatures (`label + control type`);
- toolbar capability set;
- publication-state labels;
- last scanned date.

Any material mismatch invalidates reuse and requires a rescan. Cosmetic class names and unstable generated IDs are not fingerprint inputs.

## Quick Publishing Page Derivation

Use progressive adaptation:

1. **Fully adapted** — the profile is complete, current, fingerprint-compatible, and the quick page covers every mapped field or explicit exclusion.
2. **Profile-assisted** — the profile is partial, stale, drift-risk, or the quick page covers only part of the contract. Reuse every evidence-backed state and field, label confidence, and turn missing portions into manual or unknown steps.
3. **Unprofiled baseline** — no matching profile exists. Generate a useful article-material page without claiming platform structure: title, body segments, images, links, and tags may be provided, while site-specific fields remain unasserted unless confirmed by the live page or current user evidence.

For all levels:

- Preserve the real top-to-bottom state and field order for the profile portions that are used.
- Create copy controls at the same granularity as confirmed editor fields and dialogs.
- Include non-copy instructions only for observed interactions; label generic fallback instructions as such.
- Keep final save/publish/submit actions manual.
- Run coverage validation. Missing states, fields, and exclusions lower the coverage score and produce warnings; they do not make the page unusable. Explicitly attaching the wrong platform profile remains a hard error.
- Never add guessed fields merely to reach 100% coverage.
