import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { basename, join, relative } from 'node:path';
import { createHash } from 'node:crypto';
/**
 * Map legacy hard-coded per-Case answer-exclusion rules into the normalised
 * rule shape so the builder, the scanner and the back-compat facade in
 * `src/core/file-isolation.mjs` share a single source of truth.
 *
 * These are RegExp arrays (as authored before VAB-T02). Each regex is
 * promoted to both `path` and `content` rules with a synthetic id derived
 * from the regex source.
 */
export const DEFAULT_CASE_RULES = {
  'macro-map-3d-greenfield': [
    /GraphScene\.tsx/i,
    /scene\/managers\/(?:Animation|Color|Edge|Interaction|Layout|Node)Manager/i,
  ],
  'standard-chart-two-way-tree': [
    /dvTwoWayTree/i,
    /TwoWayTreeView/i,
    /twoWayTree\.js/i,
    /自定义双向树图组件扩展/i,
  ],
  'narrative-equity-relationship': [
    /EquityRelationship(?:Controller|View|Data|State|Layout|Interaction|Config)?/i,
    /ChapterTransitionCoordinator/i,
    /ChapterEntryBaseline/i,
    /NodeLayoutResolver/i,
    /AnimationEngine/i,
    /packages[\\/]+equity-relationship/i,
    /@narrative-visual\/equity-relationship/i,
    /股权关系可视化组件/i,
  ],
  'ainvest-market-heatmap-rebuild': [
    /WidgetHeatmap/i,
    /HeatmapTreemapView/i,
    /useTreemapChart/i,
    /widget-heatmap/i,
  ],
};

/**
 * Resolve legacy Case rules for a given case id into a normalised rules list.
 * Each legacy rule is applied to both path and content families.
 *
 * @param {string} caseId
 * @returns {Array<{ id: string, pattern: RegExp, recovery: string }>}
 */
export function resolveLegacyRules(caseId) {
  const raw = DEFAULT_CASE_RULES[caseId] || [];
  return raw.map(rule => normalizeRule(rule)).filter(Boolean);
}

/**
 * Leakage scanning for fixture workspaces.
 *
 * The scanner runs three independent families of rules so reviewers can tell
 * what kind of answer signal fired and where:
 *
 *   - path     : a file/dir name matches an answer-bearing identifier
 *   - content  : file body matches an answer-bearing pattern
 *   - canary   : an innocuous marker planted in the answer source material has
 *                propagated into the fixture; not a hard fail by itself but it
 *                must be flagged for human review.
 *
 * Each finding carries a recovery hint so a downstream agent or operator can
 * act without re-reading the source repository.
 */

/**
 * @typedef {Object} LeakageRuleSet
 * @property {Array<{ id: string, pattern: RegExp, recovery: string }>} [path]
 * @property {Array<{ id: string, pattern: RegExp, recovery: string }>} [content]
 * @property {Array<{ id: string, pattern: RegExp, recovery: string }>} [canary]
 */

/**
 * @typedef {Object} LeakageFinding
 * @property {string} file            Path relative to the workspace root.
 * @property {'path' | 'content' | 'canary'} source
 * @property {string} rule_id         Stable identifier of the rule that fired.
 * @property {string} pattern         Source regex, serialised verbatim.
 * @property {string} recovery        Human/agent actionable recovery hint.
 * @property {number} [line]          1-based line for content hits, if available.
 * @property {string} [snippet]       Trimmed content excerpt for content hits.
 */

const DEFAULT_MAX_CONTENT_BYTES = 1024 * 1024;
const DEFAULT_SNIPPET_RADIUS = 40;

function isRegExp(value) {
  return Object.prototype.toString.call(value) === '[object RegExp]';
}

/**
 * Normalise a Case-declared rule entry into the canonical shape.
 *
 * Accepted shapes (for ergonomic YAML authoring):
 *   - "literal"                          → /literal/i on content, generic recovery
 *   - { id, pattern, recovery }          → pattern may be RegExp or string
 *   - RegExp                             → assigned a synthetic id
 */
export function normalizeRule(entry, fallbackSource) {
  if (entry == null) return null;
  if (isRegExp(entry)) {
    return {
      id: `rule_${Math.abs(hashCode(String(entry)))}`,
      pattern: entry,
      recovery: 'Remove the matched answer artifact before exporting the fixture.',
    };
  }
  if (typeof entry === 'string') {
    return {
      id: `literal_${entry.replace(/[^a-z0-9]+/gi, '_').slice(0, 24)}`,
      pattern: new RegExp(escapeRegExp(entry), 'i'),
      recovery: 'Remove the matched answer artifact before exporting the fixture.',
    };
  }
  if (typeof entry === 'object') {
    const pattern = entry.pattern ?? entry.regex ?? entry.test;
    if (!pattern) return null;
    const compiled = isRegExp(pattern) ? pattern : new RegExp(String(pattern), entry.flags || 'i');
    return {
      id: String(entry.id || `rule_${Math.abs(hashCode(String(compiled)))}`),
      pattern: compiled,
      recovery: String(
        entry.recovery
          || entry.hint
          || 'Remove the matched answer artifact before exporting the fixture.',
      ),
      ...(entry.line !== undefined ? { line_hint: entry.line } : {}),
    };
  }
  return null;
}

/**
 * Build a LeakageRuleSet from a Case-declared YAML fragment.
 *
 * Accepted YAML shapes:
 *   rules:
 *     path:    [ literal, { id, pattern, recovery } ]
 *     content: [ ... ]
 *     canary:  [ ... ]
 * or the legacy shape:
 *   rules: [ literal, { ... } ]   # treated as content rules
 *
 * @param {Object|undefined} declared
 * @param {string} caseId
 * @returns {LeakageRuleSet}
 */
export function buildRuleSet(declared, caseId = '<case>') {
  const set = { path: [], content: [], canary: [] };
  if (!declared) return set;

  const sourceAliases = { path: ['path', 'paths', 'filename', 'filenames'], content: ['content', 'contents', 'text', 'body'], canary: ['canary', 'canaries', 'marker', 'markers'] };
  for (const [target, aliases] of Object.entries(sourceAliases)) {
    for (const alias of aliases) {
      const value = declared[alias];
      if (Array.isArray(value)) {
        for (const entry of value) {
          const rule = normalizeRule(entry);
          if (rule) set[target].push(rule);
        }
      } else if (value != null) {
        const rule = normalizeRule(value);
        if (rule) set[target].push(rule);
      }
    }
  }

  // Legacy flat list: treat each entry as a content rule unless it carries an
  // explicit `source` field.
  if (Array.isArray(declared.rules)) {
    for (const entry of declared.rules) {
      const rule = normalizeRule(entry);
      if (!rule) continue;
      const target = entry && typeof entry === 'object' && entry.source ? entry.source : 'content';
      if (set[target]) set[target].push(rule);
    }
  }

  for (const family of Object.keys(set)) {
    set[family] = dedupeRules(set[family]);
  }
  if (Object.values(set).every(list => list.length === 0)) {
    // Empty rule sets are allowed, but record provenance so a reviewer can see
    // which case was scanned.
    set._origin = `${caseId}:no-declared-rules`;
  }
  return set;
}

function dedupeRules(rules) {
  const seen = new Set();
  const out = [];
  for (const rule of rules) {
    const key = `${rule.id}:${String(rule.pattern)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(rule);
  }
  return out;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hashCode(value) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

/**
 * Merge the legacy hard-coded per-Case rule arrays with Case-declared YAML.
 *
 * Legacy rules live in this repository's history and are kept as a safety net
 * until every primary Case ships its own leakage manifest. They always apply
 * to both path and content; YAML authors can override behaviour explicitly.
 */
export function mergeLegacyRules(declaredSet, legacyRules = []) {
  const merged = {
    path: [...(declaredSet.path || [])],
    content: [...(declaredSet.content || [])],
    canary: [...(declaredSet.canary || [])],
  };
  for (const rule of legacyRules) {
    const normalised = normalizeRule(rule);
    if (!normalised) continue;
    const alreadyCovered = merged.content.some(existing => String(existing.pattern) === String(normalised.pattern));
    if (alreadyCovered) continue;
    merged.path.push(normalised);
    merged.content.push(normalised);
  }
  return merged;
}

function walkFiles(root) {
  const files = [];
  if (!existsSync(root)) return files;
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        // Apply path rules to directories too so answer-bearing folder names
        // (e.g. `dvTwoWayTree/`) are caught before descending.
        files.push({ path: relative(root, path) + '/', bytes: 0, isDirectory: true });
        walk(path);
      } else if (entry.isFile()) {
        const stat = statSync(path);
        files.push({ path: relative(root, path), bytes: stat.size, isDirectory: false });
      }
    }
  };
  walk(root);
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

function locateMatch(text, pattern, hint) {
  const match = pattern.exec(text);
  if (!match) return null;
  const index = match.index ?? 0;
  if (hint !== undefined && hint !== null) {
    const start = Math.min(Math.max(hint, 0), Math.max(0, text.length - 1));
    if (Math.abs(start - index) > 1024) {
      // Use the hint when it is far from the natural match — keeps reported
      // locations stable when the rule author intentionally pointed at a spot.
      return { line: text.slice(0, start).split(/\r?\n/).length, snippet: excerpt(text, start) };
    }
  }
  return { line: text.slice(0, index).split(/\r?\n/).length, snippet: excerpt(text, index) };
}

function excerpt(text, index) {
  const start = Math.max(0, index - DEFAULT_SNIPPET_RADIUS);
  const end = Math.min(text.length, index + DEFAULT_SNIPPET_RADIUS);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

/**
 * Scan a workspace against a rule set.
 *
 * @param {string} workspaceRoot Absolute path to the exported workspace.
 * @param {LeakageRuleSet} ruleSet
 * @param {{ maxContentBytes?: number }} [options]
 * @returns {LeakageFinding[]}
 */
export function scanWorkspace(workspaceRoot, ruleSet, options = {}) {
  const findings = [];
  if (!existsSync(workspaceRoot)) return findings;
  const maxContentBytes = options.maxContentBytes ?? DEFAULT_MAX_CONTENT_BYTES;
  const entries = walkFiles(workspaceRoot);
  const textCache = new Map();

  for (const entry of entries) {
    const pathRules = ruleSet.path || [];
    for (const rule of pathRules) {
      if (rule.pattern.test(entry.path)) {
        findings.push({
          file: entry.path,
          source: 'path',
          rule_id: rule.id,
          pattern: String(rule.pattern),
          recovery: rule.recovery,
        });
      }
    }

    if (entry.isDirectory) continue;
    if (entry.bytes > maxContentBytes) continue;

    let text = textCache.get(entry.path);
    if (text === undefined) {
      try {
        text = readFileSync(join(workspaceRoot, entry.path), 'utf8');
      } catch {
        text = null;
      }
      textCache.set(entry.path, text);
    }
    if (text == null) continue;

    const contentRules = ruleSet.content || [];
    for (const rule of contentRules) {
      const located = locateMatch(text, rule.pattern, rule.line_hint);
      if (located) {
        findings.push({
          file: entry.path,
          source: 'content',
          rule_id: rule.id,
          pattern: String(rule.pattern),
          recovery: rule.recovery,
          line: located.line,
          snippet: located.snippet,
        });
      }
    }
    const canaryRules = ruleSet.canary || [];
    for (const rule of canaryRules) {
      const located = locateMatch(text, rule.pattern, rule.line_hint);
      if (located) {
        findings.push({
          file: entry.path,
          source: 'canary',
          rule_id: rule.id,
          pattern: String(rule.pattern),
          recovery: rule.recovery,
          line: located.line,
          snippet: located.snippet,
        });
      }
    }
  }

  return findings;
}

/**
 * Produce a stable SHA-256 digest for a rule set so manifests can record which
 * exact rule set was applied to a build.
 */
export function hashRuleSet(ruleSet) {
  const serialisable = {
    path: (ruleSet.path || []).map(rule => ({ id: rule.id, pattern: String(rule.pattern), recovery: rule.recovery })),
    content: (ruleSet.content || []).map(rule => ({ id: rule.id, pattern: String(rule.pattern), recovery: rule.recovery })),
    canary: (ruleSet.canary || []).map(rule => ({ id: rule.id, pattern: String(rule.pattern), recovery: rule.recovery })),
  };
  const json = JSON.stringify(serialisable);
  return createHash('sha256').update(json).digest('hex');
}

/**
 * @returns {Array<{ file: string, bytes: number, sha256: string }>}
 */
export function hashFiles(workspaceRoot) {
  const entries = walkFiles(workspaceRoot).filter(entry => !entry.isDirectory);
  return entries.map(entry => {
    const absolute = join(workspaceRoot, entry.path);
    const data = readFileSync(absolute);
    return {
      file: entry.path,
      bytes: entry.bytes,
      sha256: createHash('sha256').update(data).digest('hex'),
    };
  });
}
