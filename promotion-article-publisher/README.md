# Promotion Article Publisher

A standalone Codex plugin for researching publishing platforms, writing promotional articles, and generating copyable quick-publish pages that reuse recorded editor structures.

## Bundled skills

- `promotion-article-publisher`: researches popular content patterns, selects a traffic angle, writes a platform-adapted promotional article, and builds the quick-publish page.
- `writer`: supplies the SEO writing, fact-checking, humanization, image-upload, and output-packaging workflow required by the publisher skill.

Both skills are included under `skills/`; keep them together when moving or installing this plugin.

## Install

Install the repository as a local Codex plugin so `.codex-plugin/plugin.json` discovers both bundled skills.

As a manual fallback, copy both skill directories into your Codex skills directory:

```bash
cp -R skills/promotion-article-publisher "$CODEX_HOME/skills/"
cp -R skills/writer "$CODEX_HOME/skills/"
```

If `CODEX_HOME` is not set, the usual personal skills directory is `~/.codex/skills/`.

## Repository layout

```text
.codex-plugin/plugin.json
skills/promotion-article-publisher/
skills/writer/
```

This is an independent Codex plugin project. It is temporarily stored under `autofill_forms_ai/promotion-article-publisher/` and can later be moved unchanged into its own `flaqai/promotion-article-publisher` repository.

## Security note

Only an example R2 configuration is included. Do not commit real credentials, cookies, tokens, or a populated `r2.config.json`.
