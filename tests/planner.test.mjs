import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCompletionPlan } from '../src/planner.mjs';
import { generateCompletionCandidates, readSnapshot } from '../setup.mjs';

const stepId = (nodeId, routeId = 'work') => JSON.stringify([nodeId, routeId]);
const route = (requires = [], durationMs = 0, extra = {}) =>
  ({ id: 'work', requires, durationMs, kind: 'noncombat', risk: 'safe', evidence: 'confirmed', ...extra });
const node = (id, routes = [route()], extra = {}) =>
  ({ id, scopeId: 'base', evidence: 'confirmed', completed: false, routes, ...extra });
const estimate = (nodeId, extra = {}, routeId = 'work') => ({ stepId: stepId(nodeId, routeId),
  evidence: 'confirmed', completionGain: 0, unlockValue: 0, consumptionCost: 0,
  reliability: 1, deathProbability: 0, ...extra });

function fixture() {
  const categories = Object.fromEntries(['skills', 'mastery', 'items', 'monsters', 'pets'].map(category =>
    [category, { supported: true, missing: category === 'items' ? ['A', 'B'].map(name =>
      ({ id: `melvorF:${name}`, name, current: 0, maximum: 1, accessible: null })) : [] }]));
  const snapshot = { mode: { hardcore: false }, completion: {
    scopes: [{ id: 'base', ownership: true, supported: true, categories }] } };
  const [a, b] = generateCompletionCandidates(snapshot).candidates.map(candidate => candidate.id);
  return { snapshot, a, b, graph: { nodes: [node(a), node(b)] },
    estimates: [estimate(a, { completionGain: 0.5 }), estimate(b, { completionGain: 0.5 })] };
}
const run = (f, options = {}) => selectCompletionPlan(f.snapshot, f.graph, f.estimates, { nowMs: 100_000, ...options });
const current = (candidateId, extra = {}) => ({ candidateId, stepId: stepId(candidateId),
  startedAtMs: 0, lastSwitchAtMs: 0, evaluatedAtMs: 0, ...extra });
const reasonFor = (result, id) => result.blockers.find(blocker => blocker.id === id)?.reason;

test('automatic goal selection returns the first prerequisite and an explainable utility', () => {
  const f = fixture();
  f.graph.nodes[1].routes = [route(['ore'], 2000)];
  f.graph.nodes.push(node('ore', [route([], 3000)]));
  f.estimates[1].completionGain = 0.9;
  f.estimates.push(estimate('ore', { consumptionCost: 2, unlockValue: 1 }));
  const result = run(f);
  assert.equal(result.status, 'selected');
  assert.equal(result.selected.candidateId, f.b);
  assert.equal(result.nextStep.nodeId, 'ore');
  assert.deepEqual(result.selected.metrics, { completionGain: 0.9, unlockValue: 1, durationMs: 5000,
    consumptionCost: 2, reliability: 1, deathProbability: 0 });
  assert.equal(result.selected.score, 97.95);
  assert.equal(result.selected.score, Object.values(result.selected.components).reduce((sum, n) => sum + n, 0));
  assert.equal(result.runnable, false);
  assert.ok(result.evaluations.every(plan => !plan.runnable && plan.steps.every(step => !step.runnable)));
});

test('each utility dimension changes ranking with other dimensions held equal', () => {
  for (const extra of [{ completionGain: 0.6 }, { unlockValue: 1 }]) {
    const f = fixture(); Object.assign(f.estimates[1], extra);
    assert.equal(run(f).selected.candidateId, f.b);
  }
  for (const extra of [{ consumptionCost: 1 }, { reliability: 0.9 }]) {
    const f = fixture(); Object.assign(f.estimates[0], extra);
    assert.equal(run(f).selected.candidateId, f.b);
  }
  const f = fixture(); f.graph.nodes[0].routes[0].durationMs = 1000;
  assert.equal(run(f).selected.candidateId, f.b);
  f.graph.nodes[0].routes[0].durationMs = 0;
  f.graph.nodes[0].routes[0].kind = 'combat';
  f.estimates[0].deathProbability = 0.001;
  assert.equal(run(f, { policy: { maxDeathProbability: 0.01 } }).selected.candidateId, f.b);
});

test('equal utility ties by candidate ID regardless of input order', () => {
  const f = fixture(); const first = run(f);
  assert.equal(first.selected.candidateId, f.a);
  f.graph.nodes.reverse(); f.estimates.reverse(); f.snapshot.completion.scopes[0].categories.items.missing.reverse();
  assert.deepEqual(run(f), first);
});

test('shared prerequisite duration and consumption are evaluated once', () => {
  const f = fixture();
  f.graph.nodes = [node(f.a, [route(['x', 'y'], 1000)]), node('x', [route(['shared'], 2000)]),
    node('y', [route(['shared'], 3000)]), node('shared', [route([], 4000)])];
  f.estimates = [estimate(f.a, { completionGain: 0.5 }), estimate('x'), estimate('y'),
    estimate('shared', { consumptionCost: 7 })];
  const result = run(f);
  assert.equal(result.selected.metrics.durationMs, 10_000);
  assert.equal(result.selected.metrics.consumptionCost, 7);
  assert.deepEqual(result.selected.steps.map(step => step.nodeId), ['shared', 'x', 'y', f.a]);
});

test('reliability and death use conservative union bounds across prerequisite work', () => {
  const f = fixture(); f.graph.nodes = [node(f.a, [route(['x'], 0, { kind: 'combat' })]),
    node('x', [route([], 0, { kind: 'combat' })])];
  f.estimates = [estimate(f.a, { completionGain: 0.5, reliability: 0.9, deathProbability: 0.01 }),
    estimate('x', { reliability: 0.8, deathProbability: 0.02 })];
  const result = run(f, { policy: { maxDeathProbability: 0.05 } });
  assert.ok(Math.abs(result.selected.metrics.reliability - 0.7) < 1e-12);
  assert.equal(result.selected.metrics.deathProbability, 0.03);
  assert.equal(reasonFor(run(f, { policy: { maxDeathProbability: 0.02 } }), f.a), 'death-risk-above-limit');
  f.estimates[1].reliability = 0.5;
  assert.equal(reasonFor(run(f, { policy: { maxDeathProbability: 0.05 } }), f.a), 'reliability-below-minimum');
});

test('missing, unknown and invalid estimates fall back to another candidate', () => {
  const variants = [undefined, { evidence: 'unknown' }, { completionGain: null },
    { completionGain: 0 }, { unlockValue: -1 }, { consumptionCost: NaN },
    { reliability: '1' }, { reliability: 0.1 }, { deathProbability: null }, { deathProbability: 0.1 }];
  for (const extra of variants) {
    const f = fixture();
    if (extra === undefined) f.estimates.shift(); else Object.assign(f.estimates[0], extra);
    const result = run(f);
    assert.equal(result.selected.candidateId, f.b);
    assert.ok(reasonFor(result, f.a));
  }
});

test('estimate values are never coerced or silently completed', () => {
  for (const field of ['completionGain', 'unlockValue', 'consumptionCost', 'reliability', 'deathProbability']) {
    for (const value of [null, undefined, NaN, Infinity, -1, '0']) {
      const f = fixture(); f.estimates[0][field] = value;
      assert.equal(reasonFor(run(f), f.a), 'estimate-invalid');
    }
  }
  for (const field of ['completionGain', 'reliability', 'deathProbability']) {
    const f = fixture(); f.estimates[0][field] = 1.1;
    assert.equal(reasonFor(run(f), f.a), 'estimate-invalid');
  }
});

test('route identity prevents stale estimates being used for an alternative path', () => {
  const f = fixture(); f.graph.nodes[0].routes[0].id = 'new-route';
  assert.equal(reasonFor(run(f), f.a), 'estimate-missing');
  assert.equal(run(f).selected.candidateId, f.b);
});

test('risky or Hardcore combat cannot win by claiming huge utility', () => {
  const f = fixture(); f.graph.nodes[0].routes[0].kind = 'combat';
  f.estimates[0].unlockValue = 1e9; f.estimates[0].deathProbability = 0.01;
  assert.equal(reasonFor(run(f), f.a), 'death-risk-above-limit');
  f.snapshot.mode.hardcore = true;
  const result = run(f, { policy: { maxDeathProbability: 1 } });
  assert.equal(result.selected.candidateId, f.b);
  assert.ok(result.blockers.find(blocker => blocker.id === f.a).rejected.some(r => r.reason === 'combat-mode-unverified'));
  f.snapshot.mode.hardcore = false; f.graph.nodes[0].routes[0].risk = 'unknown';
  assert.equal(run(f, { policy: { maxDeathProbability: 1 } }).selected.candidateId, f.b);
});

test('noncombat risk contradiction and impossible total Completion gain are blocked', () => {
  const f = fixture(); f.estimates[0].deathProbability = 0.001;
  assert.equal(reasonFor(run(f, { policy: { maxDeathProbability: 1 } }), f.a), 'noncombat-risk-conflict');
  f.estimates[0].deathProbability = 0; f.estimates[0].completionGain = 0.8;
  f.graph.nodes[0].routes[0].requires = ['x']; f.graph.nodes.push(node('x'));
  f.estimates.push(estimate('x', { completionGain: 0.3 }));
  assert.equal(reasonFor(run(f), f.a), 'completion-gain-overflow');
});

test('candidate and total exploration limits discard partial ranking', () => {
  const f = fixture();
  for (const planning of [{ maxCandidates: 1 }, { maxTotalExpansions: 2 }]) {
    const result = run(f, { planning });
    assert.equal(result.status, 'blocked'); assert.equal(result.selected, null);
    assert.deepEqual(result.evaluations, []);
  }
});

test('local graph failure retains a blocker and evaluates the next candidate', () => {
  const f = fixture(); f.graph.nodes[0].routes[0].requires = ['long']; f.graph.nodes.push(node('long'));
  const result = run(f, { planning: { limits: { maxExpansions: 2 }, maxTotalExpansions: 10 } });
  assert.equal(result.selected.candidateId, f.b);
  assert.equal(reasonFor(result, f.a), 'expansion-limit');
});

test('minimum continuation and switch cooldown prevent early switches', () => {
  const f = fixture(); f.estimates[1].completionGain = 1;
  const c = current(f.a);
  assert.equal(run(f, { nowMs: 29_999, current: c }).reason, 'minimum-continuation');
  assert.equal(run(f, { nowMs: 30_000, current: c }).reason, 'switch-cooldown');
  assert.equal(run(f, { nowMs: 59_999, current: c }).status, 'continue');
  const switched = run(f, { nowMs: 60_000, current: c });
  assert.equal(switched.status, 'switch'); assert.equal(switched.reason, 'utility-improved');
  assert.equal(switched.nextCurrent.startedAtMs, 60_000);
  assert.equal(switched.nextCurrent.lastSwitchAtMs, 60_000);
});

test('absolute plus relative hysteresis retains the current action at the boundary', () => {
  const f = fixture(); f.estimates[1].completionGain = 0.55; // Scores 50 and 55; threshold 5.
  const opts = { current: current(f.a), policy: { absoluteImprovement: 0, relativeImprovement: 0.1 } };
  const held = run(f, opts);
  assert.equal(held.reason, 'hysteresis'); assert.equal(held.selected.candidateId, f.a);
  assert.equal(held.nextCurrent.startedAtMs, 0); assert.equal(held.nextCurrent.lastSwitchAtMs, 0);
  f.estimates[1].completionGain = 0.56;
  assert.equal(run(f, opts).status, 'switch');
});

test('negative utility still uses absolute current score for relative hysteresis', () => {
  const f = fixture(); f.estimates[0].consumptionCost = 100; f.estimates[1].consumptionCost = 96;
  const held = run(f, { current: current(f.a), policy: { absoluteImprovement: 0, relativeImprovement: 0.1 } });
  assert.equal(held.reason, 'hysteresis'); assert.equal(held.selected.score, -50);
});

test('equal scores retain a valid current action even when its ID sorts later', () => {
  const f = fixture(); const result = run(f, { current: current(f.b) });
  assert.equal(result.status, 'continue'); assert.equal(result.selected.candidateId, f.b);
  assert.equal(result.reason, 'hysteresis');
});

test('best current action continues with stable start and switch times', () => {
  const f = fixture(); const result = run(f, { current: current(f.a) });
  assert.equal(result.reason, 'current-best');
  assert.equal(result.nextCurrent.startedAtMs, 0);
  assert.equal(result.nextCurrent.evaluatedAtMs, 100_000);
});

test('repeated small changes do not reset timers or oscillate between goals', () => {
  const f = fixture(); let state = run(f, { nowMs: 0 }).nextCurrent;
  for (let nowMs = 10_000; nowMs <= 120_000; nowMs += 10_000) {
    f.estimates[1].completionGain = nowMs % 20_000 === 0 ? 0.51 : 0.49;
    const result = run(f, { nowMs, current: state });
    assert.equal(result.status, 'continue'); assert.equal(result.selected.candidateId, f.a);
    assert.equal(result.nextCurrent.startedAtMs, 0); state = result.nextCurrent;
  }
  f.estimates[1].completionGain = 0.9;
  const switched = run(f, { nowMs: 130_000, current: state });
  assert.equal(switched.status, 'switch');
  f.estimates[0].completionGain = 1;
  assert.equal(run(f, { nowMs: 160_000, current: switched.nextCurrent }).reason, 'switch-cooldown');
});

test('invalid current work bypasses continuation limits for a safe alternative', () => {
  for (const invalidate of [f => { f.estimates[0].evidence = 'unknown'; },
    f => { f.graph.nodes[0].routes[0].risk = 'dangerous'; },
    f => { f.snapshot.completion.scopes[0].categories.items.missing.shift(); }]) {
    const f = fixture(); invalidate(f);
    const result = run(f, { nowMs: 1, current: current(f.a) });
    assert.equal(result.status, 'switch'); assert.equal(result.selected.candidateId, f.b);
    assert.equal(result.reason, 'current-unavailable');
  }
});

test('completed prerequisite advances the first step despite cooldown', () => {
  const f = fixture(); f.graph.nodes = [node(f.a, [route(['x'])]), node('x')];
  f.estimates.push(estimate('x')); const initial = run(f, { nowMs: 0 });
  assert.equal(initial.nextStep.nodeId, 'x');
  f.graph.nodes[1].completed = true;
  const next = run(f, { nowMs: 1, current: initial.nextCurrent });
  assert.equal(next.status, 'switch'); assert.equal(next.nextStep.nodeId, f.a);
  assert.equal(next.nextCurrent.startedAtMs, 1);
});

test('goal change sharing the exact action preserves action timers', () => {
  const f = fixture(); f.graph.nodes = [node(f.a, [route(['shared'])]), node(f.b, [route(['shared'])]), node('shared')];
  f.estimates.push(estimate('shared'));
  const initial = run(f, { nowMs: 0 }); f.estimates[1].completionGain = 0.9;
  const result = run(f, { current: initial.nextCurrent });
  assert.equal(result.selected.candidateId, f.b); assert.equal(result.status, 'continue');
  assert.equal(result.nextCurrent.startedAtMs, 0); assert.equal(result.nextCurrent.lastSwitchAtMs, 0);
});

test('no usable candidate clears state rather than continuing dangerous work', () => {
  const f = fixture(); f.estimates.forEach(e => { e.evidence = 'unknown'; });
  const result = run(f, { nowMs: 1, current: current(f.a) });
  assert.equal(result.status, 'blocked'); assert.equal(result.nextCurrent, null);
  assert.equal(result.selected, null); assert.equal(result.nextStep, null);
});

test('unknown runtime adapter remains blocked and never touches game getters', () => {
  let touched = false;
  const game = { get completion() { touched = true; throw new Error('secret'); } };
  const result = selectCompletionPlan(readSnapshot(game), { nodes: [] }, [], { nowMs: 0 });
  assert.equal(result.status, 'blocked'); assert.equal(touched, false);
  assert.ok(result.blockers.some(b => b.reason === 'runtime-adapter-unverified'));
});

test('bad clocks and current state, including backwards reevaluation time, fail closed', () => {
  const f = fixture();
  for (const nowMs of [undefined, null, -1, 0.5, NaN, Infinity, '100', Number.MAX_SAFE_INTEGER + 1])
    assert.equal(run(f, { nowMs }).reason, 'planner-options-invalid');
  for (const c of [current(f.a, { startedAtMs: 100_001 }), current(f.a, { lastSwitchAtMs: 1 }),
    current(f.a, { evaluatedAtMs: 100_001 }), current(f.a, { evaluatedAtMs: null }), {}, []])
    assert.equal(run(f, { current: c }).reason, 'current-state-invalid');
  const initial = run(f, { current: current(f.a) });
  assert.equal(run(f, { nowMs: 99_999, current: initial.nextCurrent }).reason, 'current-state-invalid');
});

test('policy, estimate identity and work limits are bounded and validated', () => {
  const f = fixture();
  for (const policy of [null, [], { unknown: 1 }, { minReliability: null }, { maxDeathProbability: 1.1 },
    { minContinuationMs: 86_400_001 }, { switchCooldownMs: Infinity }, { absoluteImprovement: -1 }, { relativeImprovement: '0' }])
    assert.equal(run(f, { policy }).reason, 'planner-policy-invalid');
  assert.equal(run(f, { planning: null }).reason, 'planning-options-invalid');
  assert.equal(run(f, { planning: { unknown: 1 } }).reason, 'planning-options-invalid');
  assert.equal(selectCompletionPlan(f.snapshot, f.graph, null, { nowMs: 0 }).reason, 'estimates-invalid-or-limit');
  assert.equal(selectCompletionPlan(f.snapshot, f.graph, Array(4097).fill(f.estimates[0]), { nowMs: 0 }).reason, 'estimates-invalid-or-limit');
  f.estimates.push({ ...f.estimates[0] }); assert.equal(run(f).reason, 'duplicate-estimate');
  f.estimates = [{ stepId: '' }]; assert.equal(run(f).reason, 'estimate-id-invalid');
  assert.equal(selectCompletionPlan(f.snapshot, f.graph, [], null).reason, 'planner-options-invalid');
});

test('unreadable input returns a fixed reason without leaking exception content', () => {
  const f = fixture(); f.estimates[0] = { get stepId() { throw new Error('private-save-token'); } };
  const result = run(f);
  assert.equal(result.reason, 'planner-input-unreadable');
  assert.ok(!JSON.stringify(result).includes('private-save-token'));
});

test('frozen input is unchanged and selected output is detached', () => {
  const f = fixture(); const options = { nowMs: 100_000, current: current(f.a) };
  function freeze(value) { if (value && typeof value === 'object') {
    Object.values(value).forEach(freeze); Object.freeze(value);
  } }
  freeze(f); freeze(options);
  const original = JSON.stringify({ f, options });
  const result = selectCompletionPlan(f.snapshot, f.graph, f.estimates, options);
  assert.deepEqual(selectCompletionPlan(f.snapshot, f.graph, f.estimates, options), result);
  result.selected.metrics.completionGain = 999; result.selected.steps[0].routeId = 'changed';
  result.nextCurrent.startedAtMs = 999; result.nextStep.routeId = 'different';
  assert.equal(result.evaluations[0].metrics.completionGain, 0.5);
  assert.equal(result.evaluations[0].steps[0].routeId, 'work');
  assert.equal(JSON.stringify({ f, options }), original);
});
