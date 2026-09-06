#!/usr/bin/env node
import { readFile } from 'node:fs/promises';

const [profilePath, htmlPath] = process.argv.slice(2);
if (!profilePath || !htmlPath) {
  console.error('Usage: node scripts/validate-quick-publish-coverage.mjs <profile.json> <quick-publish.html>');
  process.exit(2);
}

const profile = JSON.parse(await readFile(profilePath, 'utf8'));
const html = await readFile(htmlPath, 'utf8');
const errors = [];
const warnings = [];

if (profile.scan?.status !== 'complete') warnings.push('Editor profile is not complete; use it as profile-assisted guidance.');
if (profile.scan?.blocked_states?.length) warnings.push('Editor profile has blocked states; represent those portions as manual or unknown.');

const rootProfileId = attributeValues(html, 'data-editor-profile-id');
const rootScannedAt = attributeValues(html, 'data-editor-profile-scanned-at');
if (rootProfileId.length && !rootProfileId.includes(profile.platform?.id)) {
  errors.push(`Quick page explicitly references a different profile instead of "${profile.platform?.id}".`);
} else if (!rootProfileId.length) {
  warnings.push(`Missing data-editor-profile-id="${profile.platform?.id}".`);
}
if (!rootScannedAt.includes(profile.scan?.scanned_at)) warnings.push(`Missing or different data-editor-profile-scanned-at="${profile.scan?.scanned_at}".`);

const representedStates = attributeValues(html, 'data-profile-state');
const requiredStates = profile.generation_contract?.ordered_states || [];
for (const state of requiredStates) {
  if (!representedStates.includes(state)) warnings.push(`Missing state block: ${state}.`);
}
const observedStateOrder = representedStates.filter((value) => requiredStates.includes(value));
if (!isOrderedSubset(observedStateOrder, requiredStates)) warnings.push('State blocks do not follow generation_contract.ordered_states.');

const representedFields = attributeValues(html, 'data-profile-field');
const requiredMappedFields = [...new Set(
  (profile.generation_contract?.writable_field_mapping || []).map((mapping) => mapping.target)
)];
for (const target of requiredMappedFields) {
  if (!representedFields.includes(target)) warnings.push(`Missing mapped field block: ${target}.`);
}

const representedExclusions = attributeValues(html, 'data-profile-exclusion');
const requiredExclusions = [...new Set(
  (profile.generation_contract?.coverage_exclusions || []).map((exclusion) => exclusion.field)
)];
for (const field of requiredExclusions) {
  if (!representedExclusions.includes(field)) warnings.push(`Missing explicit coverage exclusion: ${field}.`);
}

const stateCoverage = coverage(requiredStates, representedStates);
const fieldCoverage = coverage(requiredMappedFields, representedFields);
const exclusionCoverage = coverage(requiredExclusions, representedExclusions);
const totalRequired = requiredStates.length + requiredMappedFields.length + requiredExclusions.length;
const totalCovered = stateCoverage.covered + fieldCoverage.covered + exclusionCoverage.covered;
const overallCoveragePercent = totalRequired ? Math.round(totalCovered / totalRequired * 100) : 100;
const profileComplete = profile.scan?.status === 'complete' && !profile.scan?.blocked_states?.length;
const fullyAdapted = errors.length === 0 && warnings.length === 0 && profileComplete && overallCoveragePercent === 100;
const adaptationLevel = fullyAdapted
  ? 'fully-adapted'
  : overallCoveragePercent > 0
    ? 'profile-assisted'
    : 'legacy-or-unprofiled';

const result = {
  ok: errors.length === 0,
  usable: errors.length === 0,
  fully_adapted: fullyAdapted,
  adaptation_level: adaptationLevel,
  platform: profile.platform?.id,
  profile_path: profilePath,
  html_path: htmlPath,
  required_states: requiredStates.length,
  represented_states: representedStates.length,
  required_mapped_fields: requiredMappedFields.length,
  represented_fields: representedFields.length,
  required_exclusions: requiredExclusions.length,
  represented_exclusions: representedExclusions.length,
  coverage: {
    overall_percent: overallCoveragePercent,
    states: stateCoverage,
    fields: fieldCoverage,
    exclusions: exclusionCoverage,
  },
  errors,
  warnings,
};

console.log(JSON.stringify(result, null, 2));
process.exit(errors.length ? 1 : 0);

function attributeValues(source, name) {
  const values = [];
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']+)["']`, 'gi');
  for (const match of source.matchAll(pattern)) values.push(match[1]);
  return [...new Set(values)];
}

function isOrderedSubset(actual, expected) {
  let last = -1;
  for (const value of actual) {
    const index = expected.indexOf(value);
    if (index < last) return false;
    last = index;
  }
  return true;
}

function coverage(required, represented) {
  const covered = required.filter((value) => represented.includes(value)).length;
  return {
    required: required.length,
    covered,
    percent: required.length ? Math.round(covered / required.length * 100) : 100,
  };
}
