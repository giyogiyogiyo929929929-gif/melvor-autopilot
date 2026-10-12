/** Analysis-only utility selection. Inputs are detached facts and synthetic estimates. */
import { planCompletionCandidates } from './prerequisites.mjs';

const POLICY = Object.freeze({ minReliability: 0.5, maxDeathProbability: 0,
  minContinuationMs: 30_000, switchCooldownMs: 60_000,
  absoluteImprovement: 1, relativeImprovement: 0.05 });
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const time = value => Number.isSafeInteger(value) && value >= 0;
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const cost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;

function blocked(reason, blockers = [], expansions = 0, evaluations = []) {
  return { status: 'blocked', reason, selected: null, nextStep: null, nextCurrent: null,
    evaluations, blockers, expansions, runnable: false };
}

function policyFor(value) {
  if (value !== undefined && (!record(value) || Object.keys(value).some(key => !Object.hasOwn(POLICY, key)))) return null;
  const policy = { ...POLICY, ...value };
  if (!unit(policy.minReliability) || !unit(policy.maxDeathProbability) ||
      !time(policy.minContinuationMs) || policy.minContinuationMs > 86_400_000 ||
      !time(policy.switchCooldownMs) || policy.switchCooldownMs > 86_400_000 ||
      !cost(policy.absoluteImprovement) || !unit(policy.relativeImprovement)) return null;
  return policy;
}

function estimateProblem(estimate, step) {
  if (!estimate) return 'estimate-missing';
  if (estimate.evidence !== 'confirmed') return 'estimate-unconfirmed';
  if (!unit(estimate.completionGain) || !cost(estimate.unlockValue) || !cost(estimate.consumptionCost) ||
      !unit(estimate.reliability) || !unit(estimate.deathProbability)) return 'estimate-invalid';
  if (step.kind === 'noncombat' && estimate.deathProbability !== 0) return 'noncombat-risk-conflict';
  return null;
}

function evaluate(plan, estimates, policy) {
  let completionGain = 0, unlockValue = 0, consumptionCost = 0, failureSum = 0, deathSum = 0;
  for (const step of plan.steps) {
    const estimate = estimates.get(step.id);
    const reason = estimateProblem(estimate, step);
    if (reason) return { reason };
    completionGain += estimate.completionGain;
    unlockValue += estimate.unlockValue;
    consumptionCost += estimate.consumptionCost;
    failureSum += 1 - estimate.reliability;
    deathSum += estimate.deathProbability;
  }
  if (!unit(completionGain)) return { reason: 'completion-gain-overflow' };
  if (completionGain === 0) return { reason: 'completion-gain-unproven' };
  // Union bounds, without assuming independent events across tasks.
  const reliability = Math.max(0, 1 - failureSum);
  const deathProbability = Math.min(1, deathSum);
  if (reliability < policy.minReliability) return { reason: 'reliability-below-minimum' };
  if (deathProbability > policy.maxDeathProbability) return { reason: 'death-risk-above-limit' };
  const components = { completion: 100 * completionGain, unlock: 10 * unlockValue,
    time: -0.01 * (plan.durationMs / 1000), consumption: -consumptionCost,
    uncertainty: -100 * (1 - reliability), risk: -1000 * deathProbability };
  const score = Object.values(components).reduce((sum, value) => sum + value, 0);
  if (!Number.isFinite(score)) return { reason: 'score-invalid' };
  return { reason: null, value: { candidateId: plan.candidateId, scopeId: plan.scopeId,
    category: plan.category, score, components,
    metrics: { completionGain, unlockValue, durationMs: plan.durationMs, consumptionCost, reliability, deathProbability },
    steps: plan.steps.map(step => ({ ...step })), runnable: false } };
}

/**
 * No target argument. Estimates use step.id = JSON.stringify([nodeId, routeId]).
 * nowMs is supplied by the caller; this module never reads a clock or persists state.
 * Ranking applies only to the locally shortest safe paths returned by the graph solver.
 */
export function selectCompletionPlan(snapshot, graph, estimates, options) {
  try { return select(snapshot, graph, estimates, options); }
  catch { return blocked('planner-input-unreadable'); }
}

function configuration(options) {
  if (!record(options) || Object.keys(options).some(key => !['nowMs', 'current', 'policy', 'planning'].includes(key)) ||
      !time(options.nowMs)) return { reason: 'planner-options-invalid' };
  const policy = policyFor(options.policy);
  if (!policy) return { reason: 'planner-policy-invalid' };
  const current = options.current ?? null;
  if (current !== null && (!record(current) || !id(current.candidateId) || !id(current.stepId) ||
      !time(current.startedAtMs) || !time(current.lastSwitchAtMs) || !time(current.evaluatedAtMs) ||
      current.evaluatedAtMs > options.nowMs || current.startedAtMs > current.evaluatedAtMs ||
      current.lastSwitchAtMs > current.startedAtMs))
    return { reason: 'current-state-invalid' };
  if (options.planning !== undefined && (!record(options.planning) ||
      Object.keys(options.planning).some(key => !['maxCandidates', 'maxTotalExpansions', 'limits', 'window'].includes(key))))
    return { reason: 'planning-options-invalid' };
  return { reason: null, policy, current };
}

export function plannerOptionsProblem(options) {
  try { return configuration(options).reason; }
  catch { return 'planner-input-unreadable'; }
}

function select(snapshot, graph, estimates, options) {
  const config = configuration(options);
  if (config.reason) return blocked(config.reason);
  const { policy, current } = config;
  if (!Array.isArray(estimates) || estimates.length > 4096) return blocked('estimates-invalid-or-limit');
  const byStep = new Map();
  for (const estimate of estimates) {
    if (!record(estimate) || !id(estimate.stepId)) return blocked('estimate-id-invalid');
    if (byStep.has(estimate.stepId)) return blocked('duplicate-estimate');
    byStep.set(estimate.stepId, estimate);
  }
  const batch = planCompletionCandidates(snapshot, graph, options.planning);
  if (batch.status !== 'planned') return { ...blocked(batch.reason, batch.blockers, batch.expansions), ...(batch.window ? { window: batch.window } : {}) };
  const evaluations = [];
  const blockers = [...batch.blockers];
  for (const plan of batch.plans) {
    const result = evaluate(plan, byStep, policy);
    if (result.reason) blockers.push({ id: plan.candidateId, reason: result.reason, rejected: [] });
    else evaluations.push(result.value);
  }
  return { ...choose(evaluations, blockers, batch.expansions, options, policy, current), ...(batch.window ? { window: batch.window } : {}) };
}

/** Shared evaluation/continuation logic for compiled, detached candidate plans. */
export function selectPreparedCompletionPlans(prepared, blockers, expansions, options) {
  try {
    const config = configuration(options);
    if (config.reason) return blocked(config.reason);
    if (!Array.isArray(prepared) || prepared.length > 200 || !Array.isArray(blockers) || !time(expansions))
      return blocked('prepared-plans-invalid');
    const evaluations = [], failures = structuredClone(blockers), seen = new Set();
    for (const entry of prepared) {
      const plan = entry?.plan;
      if (!id(plan?.candidateId) || seen.has(plan.candidateId) ||
          !['base', 'toth', 'aod', 'ita'].includes(plan.scopeId) ||
          !['skills', 'mastery', 'items', 'monsters', 'pets'].includes(plan.category) ||
          !Array.isArray(plan.steps) || plan.steps.length === 0 || plan.steps.length > 4096 ||
          !time(plan.durationMs) || plan.steps.some(step => !id(step?.id) || !id(step.nodeId) || !id(step.routeId) ||
            !['base', 'toth', 'aod', 'ita'].includes(step.scopeId) || !['noncombat', 'combat'].includes(step.kind) ||
            !time(step.durationMs) || step.runnable !== false) ||
          new Set(plan.steps.map(step => step.id)).size !== plan.steps.length ||
          plan.steps.reduce((sum, step) => sum + step.durationMs, 0) !== plan.durationMs ||
          !Array.isArray(entry.estimates) || entry.estimates.length > 4096) return blocked('prepared-plans-invalid');
      seen.add(plan.candidateId);
      const byStep = new Map();
      for (const estimate of entry.estimates) {
        if (!record(estimate) || !id(estimate.stepId) || byStep.has(estimate.stepId)) return blocked('prepared-estimates-invalid');
        byStep.set(estimate.stepId, estimate);
      }
      // Only primitive step fields survive. Unknown nested metadata never leaks.
      const detached = { candidateId: plan.candidateId, scopeId: plan.scopeId, category: plan.category, durationMs: plan.durationMs,
        steps: plan.steps.map(step => ({ id: step.id, nodeId: step.nodeId, routeId: step.routeId, scopeId: step.scopeId,
          kind: step.kind, durationMs: step.durationMs, runnable: false })) };
      const result = evaluate(detached, byStep, config.policy);
      if (result.reason) failures.push({ id: plan.candidateId, reason: result.reason, rejected: [] });
      else evaluations.push(result.value);
    }
    return choose(evaluations, failures, expansions, options, config.policy, config.current);
  } catch { return blocked('planner-input-unreadable'); }
}

function choose(evaluations, blockers, expansions, options, policy, current) {
  evaluations.sort((a, b) => b.score - a.score || compare(a.candidateId, b.candidateId));
  blockers.sort((a, b) => compare(a.id, b.id));
  if (evaluations.length === 0) return blocked('no-safe-evaluated-candidate', blockers, expansions);
  let selected = evaluations[0];
  let reason = current ? 'current-unavailable' : 'best-utility';
  const active = current && evaluations.find(plan => plan.candidateId === current.candidateId &&
    plan.steps[0].id === current.stepId);
  if (active) {
    if (selected.candidateId === active.candidateId) { selected = active; reason = 'current-best'; }
    else if (options.nowMs - current.startedAtMs < policy.minContinuationMs) {
      selected = active; reason = 'minimum-continuation';
    } else if (options.nowMs - current.lastSwitchAtMs < policy.switchCooldownMs) {
      selected = active; reason = 'switch-cooldown';
    } else {
      const improvement = selected.score - active.score;
      const threshold = policy.absoluteImprovement + policy.relativeImprovement * Math.abs(active.score);
      // Decimal estimates can put an exact boundary a few ULPs above the threshold.
      const tolerance = 16 * Number.EPSILON * Math.max(1, Math.abs(selected.score), Math.abs(active.score), threshold);
      if (improvement <= threshold + tolerance) { selected = active; reason = 'hysteresis'; }
      else reason = 'utility-improved';
    }
  }
  const nextStep = { ...selected.steps[0] };
  const continuing = current !== null && nextStep.id === current.stepId;
  // A new goal sharing the exact current action must not reset its timers.
  const nextCurrent = { candidateId: selected.candidateId, stepId: nextStep.id,
    startedAtMs: continuing ? current.startedAtMs : options.nowMs,
    lastSwitchAtMs: continuing ? current.lastSwitchAtMs : options.nowMs, evaluatedAtMs: options.nowMs };
  return { status: continuing ? 'continue' : current ? 'switch' : 'selected', reason,
    selected: { ...selected, components: { ...selected.components }, metrics: { ...selected.metrics },
      steps: selected.steps.map(step => ({ ...step })) },
    nextStep, nextCurrent, evaluations, blockers, expansions, runnable: false };
}
