#!/usr/bin/env node
import { readFile, readdir } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';

const root = process.argv[2] || new URL('../references/editor-profiles/', import.meta.url).pathname;
const requested = process.argv.slice(3);
const files = requested.length
  ? requested
  : (await readdir(root))
      .filter((name) => extname(name) === '.json' && name !== 'editor-profile.schema.json')
      .map((name) => join(root, name));

if (!files.length) {
  console.log(JSON.stringify({ ok: true, profiles: 0, message: 'No editor profiles to validate yet.' }, null, 2));
  process.exit(0);
}

const results = [];
for (const file of files) {
  const errors = [];
  let profile;
  try {
    profile = JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    results.push({ file, ok: false, errors: [`Invalid JSON: ${error.message}`] });
    continue;
  }

  requirePath(profile, 'platform.id', errors);
  requirePath(profile, 'platform.name', errors);
  requireArray(profile, 'platform.domains', errors, true);
  requirePath(profile, 'scan.scanned_at', errors);
  requirePath(profile, 'scan.browser', errors);
  requirePath(profile, 'scan.locale', errors);
  requirePath(profile, 'scan.authentication', errors);
  requirePath(profile, 'scan.status', errors);
  requireArray(profile, 'scan.blocked_states', errors, false);
  requireArray(profile, 'routes', errors, true);
  requireArray(profile, 'states', errors, true);
  requirePath(profile, 'observed.editor_model', errors);
  requireArray(profile, 'observed.evidence', errors, true);
  requirePath(profile, 'generation_contract.profile_status_required', errors);
  requireArray(profile, 'generation_contract.ordered_states', errors, true);
  requireArray(profile, 'generation_contract.writable_field_mapping', errors, false);
  requireArray(profile, 'generation_contract.coverage_exclusions', errors, false);
  requireArray(profile, 'generation_contract.manual_final_actions', errors, true);
  requireArray(profile, 'drift_fingerprint.route_patterns', errors, true);
  requireArray(profile, 'drift_fingerprint.major_sections', errors, true);
  requireArray(profile, 'drift_fingerprint.field_signatures', errors, false);
  requireArray(profile, 'drift_fingerprint.toolbar_capabilities', errors, false);
  requireArray(profile, 'drift_fingerprint.publication_labels', errors, true);
  requireArray(profile, 'limitations', errors, false);

  if (profile?.scan?.status === 'complete' && profile.scan.blocked_states?.length) {
    errors.push('A complete profile cannot contain blocked_states.');
  }
  if (profile?.generation_contract?.profile_status_required !== 'complete') {
    errors.push('generation_contract.profile_status_required must equal "complete".');
  }

  const evidenceIds = new Set((profile?.observed?.evidence || []).map((item) => item.id));
  const stateIds = new Set((profile?.states || []).map((state) => state.id));
  checkUnique([...stateIds], 'state id', errors);

  for (const state of profile?.states || []) {
    if (!state.id || !state.label || !Number.isInteger(state.order)) errors.push(`Invalid state in ${file}.`);
    const sectionOrders = [];
    for (const section of state.sections || []) {
      sectionOrders.push(section.order);
      if (!section.id || !section.label || !Number.isInteger(section.order)) errors.push(`Invalid section in state ${state.id}.`);
      for (const field of section.fields || []) {
        if (!field.id || !field.label || !field.control || !field.content_meaning || !field.copy_unit) {
          errors.push(`Incomplete field in ${state.id}/${section.id}.`);
        }
        checkEvidence(field, evidenceIds, `${state.id}/${section.id}/${field.id}`, errors);
      }
      for (const toolbar of section.toolbars || []) checkEvidence(toolbar, evidenceIds, `${state.id}/${section.id}/${toolbar.id}`, errors);
      for (const action of section.actions || []) checkEvidence(action, evidenceIds, `${state.id}/${section.id}/${action.id}`, errors);
    }
    if (sectionOrders.some((order, index) => order !== index + 1)) errors.push(`Section order must be contiguous in state ${state.id}.`);
  }

  for (const evidence of profile?.observed?.evidence || []) {
    if (!stateIds.has(evidence.state_id)) errors.push(`Evidence ${evidence.id} references unknown state ${evidence.state_id}.`);
  }

  const forbiddenKeys = ['current_value', 'sample_value', 'password', 'secret', 'token', 'cookie', 'credential', 'local_storage', 'session_storage'];
  walkKeys(profile, (key, path) => {
    if (forbiddenKeys.includes(key.toLowerCase())) errors.push(`Forbidden sensitive-value key at ${path}.`);
  });

  results.push({ file, platform: profile?.platform?.id || basename(file), status: profile?.scan?.status, ok: errors.length === 0, errors });
}

const ok = results.every((result) => result.ok);
console.log(JSON.stringify({ ok, profiles: results.length, results }, null, 2));
process.exit(ok ? 0 : 1);

function getPath(object, path) {
  return path.split('.').reduce((value, key) => value?.[key], object);
}

function requirePath(object, path, errors) {
  const value = getPath(object, path);
  if (value === undefined || value === null || value === '') errors.push(`Missing ${path}.`);
}

function requireArray(object, path, errors, nonEmpty) {
  const value = getPath(object, path);
  if (!Array.isArray(value)) errors.push(`${path} must be an array.`);
  else if (nonEmpty && !value.length) errors.push(`${path} must not be empty.`);
}

function checkEvidence(item, evidenceIds, label, errors) {
  if (!Array.isArray(item.evidence_ids) || !item.evidence_ids.length) {
    errors.push(`${label} has no evidence_ids.`);
    return;
  }
  for (const id of item.evidence_ids) if (!evidenceIds.has(id)) errors.push(`${label} references unknown evidence ${id}.`);
}

function checkUnique(values, label, errors) {
  if (new Set(values).size !== values.length) errors.push(`Duplicate ${label}.`);
}

function walkKeys(value, visit, path = '$') {
  if (Array.isArray(value)) return value.forEach((item, index) => walkKeys(item, visit, `${path}[${index}]`));
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    visit(key, `${path}.${key}`);
    walkKeys(child, visit, `${path}.${key}`);
  }
}
