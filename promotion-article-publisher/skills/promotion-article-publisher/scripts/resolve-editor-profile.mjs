#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { dirname, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const targetUrl = args.find((arg) => !arg.startsWith('--'));
const maxAgeArg = args.find((arg) => arg.startsWith('--max-age-days='));
const maxAgeDays = Number(maxAgeArg?.split('=')[1] || 90);

if (!targetUrl) {
  console.error('Usage: node scripts/resolve-editor-profile.mjs <target-url> [--max-age-days=90]');
  process.exit(2);
}

let parsedUrl;
try {
  parsedUrl = new URL(targetUrl);
} catch {
  console.error(JSON.stringify({ ok: false, reason: 'invalid-url', target_url: targetUrl }, null, 2));
  process.exit(2);
}

const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const profileRoot = join(skillRoot, 'references', 'editor-profiles');
const files = (await readdir(profileRoot))
  .filter((name) => extname(name) === '.json' && name !== 'editor-profile.schema.json')
  .map((name) => join(profileRoot, name));

const profiles = [];
for (const file of files) {
  const profile = JSON.parse(await readFile(file, 'utf8'));
  const matchingDomains = (profile.platform?.domains || [])
    .filter((domain) => hostMatches(parsedUrl.hostname, domain))
    .sort((a, b) => b.length - a.length);
  if (matchingDomains.length) profiles.push({ file, profile, matchedDomain: matchingDomains[0] });
}

profiles.sort((a, b) => b.matchedDomain.length - a.matchedDomain.length);
if (!profiles.length) {
  console.log(JSON.stringify({
    ok: true,
    reason: 'profile-not-found',
    target_url: targetUrl,
    hostname: parsedUrl.hostname,
    profile_path: null,
    adaptation_level: 'unprofiled-baseline',
    can_generate_quick_publish: true,
    can_generate_fully_adapted_quick_publish: false,
    warnings: ['No matching editor profile was found. Generate a useful baseline page without claiming platform-specific coverage.'],
    required_actions: ['Use confirmed article materials and any current live-page evidence.', 'Label platform-specific unknowns as manual or unknown.', 'Scan the live editor when practical to improve future runs.']
  }, null, 2));
  process.exit(0);
}

const selected = profiles[0];
const validation = spawnSync(process.execPath, [
  join(skillRoot, 'scripts', 'validate-editor-profiles.mjs'),
  profileRoot,
  selected.file,
], { encoding: 'utf8' });

if (validation.status !== 0) {
  console.log(JSON.stringify({
    ok: true,
    reason: 'profile-validation-failed',
    profile_path: selected.file,
    adaptation_level: 'unprofiled-baseline',
    can_generate_quick_publish: true,
    can_generate_fully_adapted_quick_publish: false,
    warnings: ['A matching profile exists but failed structural validation; do not derive fields from it. Generate a baseline page instead.'],
    validation: safeJson(validation.stdout) || validation.stderr.trim(),
  }, null, 2));
  process.exit(0);
}

const scannedAt = Date.parse(selected.profile.scan?.scanned_at || '');
const ageDays = Number.isFinite(scannedAt) ? Math.floor((Date.now() - scannedAt) / 86400000) : null;
const stale = ageDays === null || ageDays > maxAgeDays;
const complete = selected.profile.scan?.status === 'complete' && !selected.profile.scan?.blocked_states?.length;
const canGenerate = complete && !stale;
const adaptationLevel = canGenerate
  ? 'fully-adapted-candidate'
  : stale && complete
    ? 'stale-profile-assisted'
    : 'partial-profile-assisted';
const warnings = [];
if (!complete) warnings.push('The editor profile is partial or has blocked states. Reuse evidence-backed fields and mark missing portions as manual or unknown.');
if (stale) warnings.push('The editor profile is older than the configured freshness window. Reuse it as a convenience aid and avoid claiming current full adaptation.');

const result = {
  ok: true,
  target_url: targetUrl,
  matched_domain: selected.matchedDomain,
  profile_path: selected.file,
  platform: selected.profile.platform,
  scan: {
    status: selected.profile.scan?.status,
    scanned_at: selected.profile.scan?.scanned_at,
    age_days: ageDays,
    stale,
    blocked_states: selected.profile.scan?.blocked_states || [],
  },
  adaptation_level: adaptationLevel,
  can_generate_quick_publish: true,
  can_generate_fully_adapted_quick_publish: canGenerate,
  warnings,
  generation_contract: selected.profile.generation_contract,
  drift_fingerprint: selected.profile.drift_fingerprint,
  required_actions: canGenerate
    ? ['Read the matched profile completely.', 'Compare the live editor fingerprint when browser access is available.', 'Generate from observed and generation_contract only.', 'Run validate-quick-publish-coverage.mjs after generation.']
    : ['Read the matched profile completely.', 'Reuse evidence-backed portions instead of discarding the profile.', 'Represent missing coverage as manual or unknown.', 'Complete or refresh the live editor scan when practical.', 'Do not claim full adaptation.'],
};

const output = JSON.stringify(result, null, 2);
console.log(output);
process.exit(0);

function hostMatches(hostname, domain) {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const candidate = String(domain).toLowerCase().replace(/^www\./, '');
  return host === candidate || host.endsWith(`.${candidate}`);
}

function safeJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}
