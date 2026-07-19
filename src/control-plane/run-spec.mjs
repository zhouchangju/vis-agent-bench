import { readFileSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';

import { validateRunSpec } from '../contracts/index.mjs';

const ADAPTER_ALIASES = Object.freeze({
  'codex-cli': 'codex',
  'kimi-code-cli': 'kimi',
  'claude-code-cli': 'claude',
});

export function loadRunSpec(path) {
  const absolute = resolve(path);
  const raw = readFileSync(absolute, 'utf8');
  const value = ['.yaml', '.yml'].includes(extname(absolute))
    ? parseYaml(raw)
    : JSON.parse(raw);
  return { absolute, value };
}

export function assertValidRunSpec(value) {
  const validation = validateRunSpec(value);
  if (!validation.valid) {
    const error = new Error(`RunSpec validation failed with ${validation.errors.length} issue(s).`);
    error.validation = validation;
    throw error;
  }
  return value;
}

export function adapterId(value) {
  return ADAPTER_ALIASES[value] || value;
}

export function buildRunSpec(input) {
  const engine = input.engine || {};
  const value = {
    schema_version: 2,
    name: input.name || `${input.case_id}-${engine.adapter || 'unconfigured'}`,
    case_id: input.case_id,
    engine: {
      adapter: engine.adapter,
      executable: engine.executable,
      configured_model: engine.configured_model,
      provider: engine.provider,
      credential_ref: engine.credential_ref,
    },
    isolation: {
      mode: 'file-isolated-development',
      leaderboard_eligible: false,
      network: input.network === false ? 'disabled' : 'enabled',
      block_internal_network: input.block_internal_network === true,
      inherited_home_for_auth: true,
      answer_leakage_scan: true,
      workspace_root: input.workspace_root || '.local/runs',
    },
    permissions: {
      read_internal_source: false,
      read_answer_repository: false,
      hidden_evaluator_visible: false,
      allowed_tools: Array.isArray(input.allowed_tools) && input.allowed_tools.length
        ? input.allowed_tools
        : ['shell', 'file_read', 'file_write', ...(input.network === false ? [] : ['public_web'])],
    },
    budget: {
      wall_time_minutes: Number(input.wall_time_minutes || 180),
      max_retries: Number(input.max_retries ?? 1),
      max_tokens: nullableNumber(input.max_tokens),
      max_cost_usd: nullableNumber(input.max_cost_usd),
    },
    scenario: {
      mode: 'progressive-disclosure',
      baseline_type: input.baseline_type || 'current-ai-assisted-workflow',
      session_continuity_required: true,
    },
    evidence: {
      raw_stdout: input.evidence?.raw_stdout !== false,
      raw_stderr: input.evidence?.raw_stderr !== false,
      normalized_events: input.evidence?.normalized_events !== false,
      file_snapshots: input.evidence?.file_snapshots !== false,
      git_diff: input.evidence?.git_diff !== false,
      screenshots: input.evidence?.screenshots !== false,
      redact_secrets: true,
      human_review_required: true,
    },
  };
  return assertValidRunSpec(value);
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
