/** Pure, bounded AND/OR planning over detached facts. No game API or executor. */
import { generateCompletionCandidates } from '../setup.mjs';
import { windowGeneratedCandidates } from './candidate-window.mjs';
import { indexPrerequisiteGraph, materializePrerequisites } from './local-graph.mjs';

const DEFAULTS = Object.freeze({ maxNodes: 512, maxRoutes: 16, maxRequirements: 32,
  maxDepth: 24, maxExpansions: 1000, maxReasons: 64 });
const CEILINGS = Object.freeze({ maxNodes: 4096, maxRoutes: 64, maxRequirements: 128,
  maxDepth: 64, maxExpansions: 10_000, maxReasons: 256 });
const SCOPES = new Set(['base', 'toth', 'aod', 'ita']);
const validID = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const validRouteID = value => validID(value) && value.length <= 1024;
const validTime = value => Number.isSafeInteger(value) && value >= 0;
const compareText = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const compareID = (a, b) => compareText(a.id, b.id);

function limitsFor(options) {
  if (options === undefined) return { ...DEFAULTS };
  if (!options || typeof options !== 'object' || Array.isArray(options)) return null;
  if (Object.keys(options).some(key => !(key in DEFAULTS))) return null;
  const limits = { ...DEFAULTS, ...options };
  return Object.entries(limits).every(([key, value]) => Number.isSafeInteger(value) && value > 0 && value <= CEILINGS[key])
    ? limits : null;
}
function blocked(reason, expansions = 0, rejected = []) {
  return { status: 'blocked', reason, steps: [], durationMs: null, expansions, rejected, runnable: false };
}
function routeProblem(route, limits, context) {
  if (!route || !validRouteID(route.id) || !Array.isArray(route.requires))
    return 'route-invalid';
  if (route.requires.length > limits.maxRequirements) return 'requirement-limit';
  if (route.requires.some(id => !validID(id)) || new Set(route.requires).size !== route.requires.length)
    return 'route-invalid';
  if (route.evidence !== 'confirmed') return 'route-unconfirmed';
  if (!['noncombat', 'combat'].includes(route.kind)) return 'action-kind-unknown';
  if (route.risk !== 'safe') return 'death-risk-unacceptable-or-unknown';
  if (route.kind === 'combat' && context?.hardcore !== false) return 'combat-mode-unverified';
  if (!validTime(route.durationMs)) return 'duration-unknown-or-invalid';
  return null;
}

/**
 * node: { id, scopeId, evidence, completed, routes }
 * route: { id, requires: nodeIds[], evidence, kind, risk, durationMs }
 * "confirmed" means supplied domain evidence, never executable API permission.
 * Chooses locally shorter plans, with deterministic ties. No global optimum claim.
 */
export function resolvePrerequisites(graph, targetId, context, options) {
  const limits = limitsFor(options);
  if (!limits) return blocked('limits-invalid');
  if (!validID(targetId) || !Array.isArray(graph?.nodes)) return blocked('graph-invalid');
  if (graph.nodes.length > limits.maxNodes) return blocked('node-limit');
  const nodes = new Map();
  for (const node of graph.nodes) {
    if (!node || !validID(node.id) || !SCOPES.has(node.scopeId) || typeof node.completed !== 'boolean')
      return blocked('node-invalid');
    if (nodes.has(node.id)) return blocked('duplicate-node');
    nodes.set(node.id, node);
  }
  let expansions = 0;
  let exhausted = false;
  const failures = new Map();
  function reject(nodeId, routeId, reason, path) {
    const entry = { nodeId, routeId, reason, path: [...path] };
    const key = JSON.stringify(entry);
    // Diagnostics are bounded independently from search.
    if (failures.size < limits.maxReasons) failures.set(key, entry);
    return null;
  }
  function spend() {
    if (expansions >= limits.maxExpansions) { exhausted = true; return false; }
    expansions++;
    return true;
  }
  function solve(id, ancestors) {
    if (!spend()) return null;
    const path = [...ancestors, id];
    if (ancestors.includes(id)) return reject(id, null, 'dependency-cycle', path);
    if (ancestors.length > limits.maxDepth) return reject(id, null, 'depth-limit', path);
    const node = nodes.get(id);
    if (!node) return reject(id, null, 'node-missing', path);
    const owned = context?.ownership?.[node.scopeId];
    if (owned !== true) return reject(id, null, owned === false ? 'scope-not-owned' : 'scope-ownership-unknown', path);
    if (node.evidence !== 'confirmed') return reject(id, null, 'fact-unconfirmed', path);
    if (node.completed) return { steps: [], durationMs: 0, signature: '' };
    if (!Array.isArray(node.routes) || node.routes.length === 0) return reject(id, null, 'no-known-route', path);
    if (node.routes.length > limits.maxRoutes) return reject(id, null, 'route-limit', path);
    const routes = [...node.routes];
    const routeIds = new Set();
    for (const route of routes) {
      if (!validRouteID(route?.id)) return reject(id, null, 'route-invalid', path);
      if (routeIds.has(route.id)) return reject(id, route.id, 'duplicate-route', path);
      routeIds.add(route.id);
    }
    routes.sort(compareID);
    let best = null;
    for (const route of routes) {
      if (!spend()) break;
      const problem = routeProblem(route, limits, context);
      if (problem) { reject(id, route.id, problem, path); continue; }
      const steps = new Map();
      let failed = false;
      for (const requirement of [...route.requires].sort(compareText)) {
        const dependency = solve(requirement, path);
        if (!dependency) { failed = true; break; }
        for (const step of dependency.steps) {
          const existing = steps.get(step.nodeId);
          if (existing && existing.routeId !== step.routeId) {
            reject(id, route.id, 'shared-route-conflict', path);
            failed = true;
            break;
          }
          if (!existing) steps.set(step.nodeId, step);
        }
        if (failed) break;
      }
      if (exhausted) break;
      if (failed) continue;
      steps.set(id, { id: JSON.stringify([id, route.id]), nodeId: id, routeId: route.id,
        scopeId: node.scopeId, kind: route.kind, durationMs: route.durationMs, runnable: false });
      const ordered = [...steps.values()];
      const durationMs = ordered.reduce((sum, step) => sum + step.durationMs, 0);
      if (!validTime(durationMs)) { reject(id, route.id, 'duration-overflow', path); continue; }
      const signature = JSON.stringify(ordered.map(step => step.id));
      const plan = { steps: ordered, durationMs, signature };
      if (!best || durationMs < best.durationMs || (durationMs === best.durationMs &&
        (ordered.length < best.steps.length || (ordered.length === best.steps.length && compareText(signature, best.signature) < 0))))
        best = plan;
    }
    return best;
  }
  const plan = solve(targetId, []);
  const rejected = [...failures.values()].sort((a, b) => compareText(JSON.stringify(a), JSON.stringify(b)));
  if (exhausted) return blocked('expansion-limit', expansions, rejected);
  if (!plan) return blocked('no-safe-confirmed-route', expansions, rejected);
  return { status: plan.steps.length === 0 ? 'satisfied' : 'planned', reason: null,
    steps: plan.steps, durationMs: plan.durationMs, expansions, rejected, runnable: false };
}

/** No player-specified target. Graph goal IDs match stable Completion candidate IDs. */
export function planCompletionCandidates(snapshot, graph, options = {}) {
  const generated = generateCompletionCandidates(snapshot);
  const maxCandidates = options?.maxCandidates ?? 50;
  const maxTotalExpansions = options?.maxTotalExpansions ?? 2000;
  if (!Number.isSafeInteger(maxCandidates) || maxCandidates < 1 || maxCandidates > 200 ||
      !Number.isSafeInteger(maxTotalExpansions) || maxTotalExpansions < 1 || maxTotalExpansions > 10_000)
    return { ...blocked('batch-limits-invalid'), plans: [], blockers: generated.blockers };
  let window = null;
  if (options?.window !== undefined) {
    const setting = options.window;
    if (!setting || typeof setting !== 'object' || Array.isArray(setting) || Object.keys(setting).some(key => !['cursor', 'activeCandidateId'].includes(key)))
      return { ...blocked('window-options-invalid'), plans: [], blockers: generated.blockers };
    window = windowGeneratedCandidates(generated, setting.cursor ?? null, { size: maxCandidates, activeCandidateId: setting.activeCandidateId });
    if (window.status !== 'window') return { ...blocked(window.reason), plans: [], blockers: window.blockers, window };
  }
  const candidates = window?.candidates ?? generated.candidates;
  if (candidates.length > maxCandidates)
    return { ...blocked('candidate-limit'), plans: [], blockers: generated.blockers };
  const limits = limitsFor(options?.limits);
  if (!limits) return { ...blocked('limits-invalid'), plans: [], blockers: generated.blockers };
  if (!Array.isArray(graph?.nodes)) return { ...blocked('graph-invalid'), plans: [], blockers: generated.blockers };
  if (!window && graph.nodes.length > limits.maxNodes) return { ...blocked('node-limit'), plans: [], blockers: generated.blockers };
  const indexed = window ? indexPrerequisiteGraph(graph) : null;
  if (indexed && !indexed.supported) return { ...blocked(indexed.reason), plans: [], blockers: generated.blockers, window };
  const ownership = Object.fromEntries((snapshot?.completion?.scopes ?? [])
    .map(scope => [scope.id, scope.ownership]));
  const context = { ownership, hardcore: snapshot?.mode?.hardcore };
  const plans = [];
  const blockers = [...(window?.blockers ?? generated.blockers)];
  let expansions = 0;
  for (const candidate of candidates) {
    const remaining = maxTotalExpansions - expansions;
    if (remaining <= 0)
      return { ...blocked('batch-expansion-limit', expansions), plans: [], blockers, ...(window ? { window } : {}) };
    let local = graph;
    if (indexed) {
      const subset = materializePrerequisites(indexed, candidate.id, context, limits);
      if (!subset.supported) { blockers.push({ id: candidate.id, reason: subset.reason, rejected: [] }); continue; }
      local = subset.graph;
    }
    const target = local.nodes.find(node => node?.id === candidate.id);
    if (target && target.scopeId !== candidate.scopeId) {
      blockers.push({ id: candidate.id, reason: 'completion-scope-conflict', rejected: [] });
      continue;
    }
    const plan = resolvePrerequisites(local, candidate.id, context,
      { ...limits, maxExpansions: Math.min(limits.maxExpansions, remaining) });
    expansions += plan.expansions;
    if (plan.reason === 'expansion-limit' && expansions >= maxTotalExpansions)
      return { ...blocked('batch-expansion-limit', expansions, plan.rejected), plans: [], blockers, ...(window ? { window } : {}) };
    if (plan.status !== 'planned') {
      blockers.push({ id: candidate.id, reason: plan.status === 'satisfied' ? 'completion-fact-conflict' : plan.reason,
        rejected: plan.rejected });
      continue;
    }
    plans.push({ candidateId: candidate.id, category: candidate.category, scopeId: candidate.scopeId, ...plan });
  }
  return { status: plans.length > 0 ? 'planned' : 'blocked', reason: plans.length > 0 ? null : 'no-plannable-completion-candidate',
    plans: plans.sort((a, b) => compareText(a.candidateId, b.candidateId)), blockers: blockers.sort(compareID),
    expansions, runnable: false, ...(window ? { window } : {}) };
}
