# Optional Cloudflare R2 Image Upload

Cloudflare R2 is an optional post-processing step. The article workflow must remain fully usable without R2 credentials.

## Decision Rule

Use this order for every article:

1. Generate images under `writer/output/<article-slug>/`.
2. Insert local relative references such as `![Alt text](./hero-16x9.png)` into `article.md`.
3. Check whether `writer/config/r2.config.json` exists.
4. If the file does not exist, stop the upload branch and keep the local references. Missing R2 configuration is not an error.
5. If the file exists, run the upload script for each image. Replace local references only after a successful upload.

The upload script follows the same rule. When the default config is absent, it exits successfully with a JSON result containing `"skipped": true` and does not compress the image, edit the article, or create a manifest.

If the user explicitly passes `--config <path>`, that path is treated as intentional: a missing or invalid explicit config is an error that should be fixed.

## Local Configuration

Copy the tracked example:

```bash
cp writer/config/r2.config.example.json writer/config/r2.config.json
```

Fill in the local ignored file:

```json
{
  "accountId": "your-cloudflare-account-id",
  "bucket": "your-r2-bucket-name",
  "accessKeyId": "your-r2-access-key-id",
  "secretAccessKey": "your-r2-secret-access-key",
  "region": "auto",
  "publicBaseUrl": "https://cdn.example.com",
  "keyPrefix": "",
  "blogDirectory": "blog"
}
```

Required fields are `accountId`, `bucket`, `accessKeyId`, `secretAccessKey`, and `publicBaseUrl`. Keep real values only in `writer/config/r2.config.json`; never commit or print this file.

## Upload and Update an Article

Start with a local Markdown image:

```markdown
![Seedance AI video generation hero](./hero-16x9.png)
```

Then run:

```bash
node writer/scripts/upload-r2.mjs \
  --file writer/output/<article-slug>/hero-16x9.png \
  --article writer/output/<article-slug>/article.md \
  --manifest writer/output/<article-slug>/image-urls.json \
  --seoName "Seedance AI video hero" \
  --keyword "Seedance AI" \
  --topic "AI video generation" \
  --alt "Seedance AI video generation hero image"
```

When valid local configuration exists, the script:

- Compresses supported PNG, JPEG, or WebP files to a high-quality WebP candidate.
- Uses the compressed copy only when it is meaningfully smaller.
- Uploads to `<keyPrefix>/<blogDirectory>/yyyy/mm/dd/<seo-filename>`.
- Replaces the matching local image reference in `article.md`.
- Adds non-secret upload metadata to `image-urls.json`.
- Keeps the original local image for backup.

## No-Configuration Result

Running the same command without `writer/config/r2.config.json` returns a result like:

```json
{
  "ok": true,
  "skipped": true,
  "reason": "r2-config-not-found",
  "config": "writer/config/r2.config.json",
  "file": "writer/output/example/hero-16x9.png",
  "localReference": "./hero-16x9.png",
  "articleUpdated": false,
  "manifestUpdated": false
}
```

In this case, `article.md` must continue to use the local relative path. Do not create `image-urls.json` and do not report the article as incomplete.

## Useful Options

```bash
# Preview the resolved object key and URL when config exists.
node writer/scripts/upload-r2.mjs --file <image> --dryRun

# Use a different local config file.
node writer/scripts/upload-r2.mjs --file <image> --config /local/path/r2.json

# Preserve extra image detail.
node writer/scripts/upload-r2.mjs --file <image> --compressionQuality 92

# Upload the original without compression.
node writer/scripts/upload-r2.mjs --file <image> --noCompress

# Override the upload date or blog directory.
node writer/scripts/upload-r2.mjs --file <image> --date 2026-07-14 --blogDir blog
```

## Output and Safety Rules

- Public object filenames must use an alphanumeric basename and a normal image extension.
- Pass `--seoName`, `--keyword`, `--topic`, and `--alt` when useful.
- Verify public URLs after successful uploads when network access is available.
- Report bucket, object key, date path, public URL, alt text, and compression result.
- Never report account IDs, access keys, secret keys, or config contents.
- Never replace a local image reference until its upload succeeds.
- Never turn missing optional configuration into a blocked writing task.
