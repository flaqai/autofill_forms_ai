# Optional R2 Configuration Security

Cloudflare R2 support is local and optional. The writing workflow must work with no R2 configuration by keeping relative image references in `article.md`.

## Local Config Contract

Real credentials belong only in `writer/config/r2.config.json`, which must remain ignored by git. Start from `writer/config/r2.config.example.json`.

Required fields:

```json
{
  "accountId": "",
  "bucket": "",
  "accessKeyId": "",
  "secretAccessKey": "",
  "region": "auto",
  "publicBaseUrl": "",
  "keyPrefix": "",
  "blogDirectory": "blog"
}
```

Use a dedicated, bucket-scoped R2 token with the smallest useful upload permissions. Use a public custom domain or bucket domain for `publicBaseUrl`.

## Safe Behavior

- If `writer/config/r2.config.json` is absent, skip uploading and retain local Markdown image paths.
- Do not request credentials merely to finish an article.
- Do not search for, download, or decrypt remote credential files.
- If a custom local path is needed, pass it explicitly with `--config <path>`.
- Treat an existing but incomplete config as an error; do not silently fall back after the user has configured R2.

## Never Commit or Output

- `writer/config/r2.config.json`
- Account IDs, access key IDs, secret access keys, or API tokens
- Config contents in logs, prompts, articles, audits, manifests, or final responses
- Screenshots containing credentials

Safe tracked files include the example config, upload script, and reference documentation.

## Preflight Checklist

- `.gitignore` includes `writer/config/r2.config.json`.
- The local image exists and is already referenced relatively from `article.md`.
- The config exists only when R2 upload is wanted.
- Required values are present and are not placeholders.
- A dry run succeeds before a first real upload.
- The final public URL loads after upload.
- Final reporting contains only non-secret bucket, key, URL, alt-text, and compression details.

Rotate credentials immediately if they appear in chat, git history, generated files, terminal logs, or screenshots.
