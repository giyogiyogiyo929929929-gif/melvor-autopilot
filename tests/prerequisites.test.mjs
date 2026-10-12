import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePrerequisites, planCompletionCandidates } from '../src/prerequisites.mjs';
import { generateCompletionCandidates, readSnapshot } from '../setup.mjs';

const context = { ownership: { base: true, toth: false, aod: false, ita: false }, hardcore: false };
const route = (id, requires = [], durationMs = 1, extra = {}) =>
  ({ id, requires, durationMs, evidence: 'confirmed', kind: 'noncombat', risk: 'safe', ...extra });
const node = (id, routes = [], extra = {}) => ({ id, scopeId: 'base', evidence: 'confirmed', completed: false, routes, ...extra });
const solve = (nodes, target = 'goal', ctx = context, limits) => resolvePrerequisites({ nodes }, target, ctx, limits);
const ids = plan => plan.steps.map(step => step.nodeId);
const reasons = plan => plan.rejected.map(entry => entry.reason);

test('AND prerequisites precede dependent work without executing anything', () => {
  const plan = solve([
    node('goal', [route('craft', ['ore', 'level'], 5)]), node('ore', [route('mine', [], 3)]),
    node('level', [route('train', [], 10)])
  ]);
  assert.equal(plan.status, 'planned');
  assert.deepEqual(ids(plan), ['level', 'ore', 'goal']);
  assert.equal(plan.durationMs, 18);
  assert.equal(plan.runnable, false);
  assert.ok(plan.steps.every(step => step.runnable === false));
});

test('OR chooses the shorter confirmed route including prerequisite time', () => {
  const plan = solve([
    node('goal', [route('craft', ['ore'], 1), route('purchase', ['currency'], 2)]),
    node('ore', [route('mine', [], 100)]), node('currency', [route('earn', [], 10)])
  ]);
  assert.equal(plan.durationMs, 12);
  assert.equal(plan.steps.at(-1).routeId, 'purchase');
});

test('equal plans tie by stable ID, independent of node, route and prerequisite order', () => {
  const nodes = [node('goal', [route('z', ['b', 'a']), route('a', ['a', 'b'])]),
    node('a', [route('work')]), node('b', [route('work')])];
  const expected = solve(nodes);
  nodes.reverse();
  for (const n of nodes) { n.routes.reverse(); for (const r of n.routes) r.requires.reverse(); }
  assert.deepEqual(solve(nodes), expected);
  assert.equal(expected.steps.at(-1).routeId, 'a');
});

test('known satisfied prerequisites require no repeated work', () => {
  const plan = solve([node('goal', [route('craft', ['level'])]), node('level', [], { completed: true })]);
  assert.deepEqual(ids(plan), ['goal']);
  assert.equal(solve([node('goal', [], { completed: true })]).status, 'satisfied');
});

test('shared dependencies are emitted and charged once in topological order', () => {
  const plan = solve([node('goal', [route('combine', ['a', 'b'], 2)]),
    node('a', [route('work', ['shared'], 4)]), node('b', [route('work', ['shared'], 5)]),
    node('shared', [route('gather', [], 10)])]);
  assert.deepEqual(ids(plan), ['shared', 'a', 'b', 'goal']);
  assert.equal(plan.durationMs, 21);
});

test('self cycle blocks with the cycle path', () => {
  const plan = solve([node('goal', [route('loop', ['goal'])])]);
  assert.equal(plan.status, 'blocked');
  assert.deepEqual(plan.steps, []);
  assert.deepEqual(plan.rejected.find(entry => entry.reason === 'dependency-cycle').path, ['goal', 'goal']);
});

test('mutual cycle takes a finite alternative route', () => {
  const plan = solve([node('goal', [route('a-cycle', ['resource']), route('b-alternative', [], 12)]),
    node('resource', [route('requires-goal', ['goal'])])]);
  assert.equal(plan.status, 'planned');
  assert.equal(plan.steps[0].routeId, 'b-alternative');
  assert.ok(reasons(plan).includes('dependency-cycle'));
});

test('failures under one path do not poison valid solutions under another path', () => {
  const plan = solve([node('goal', [route('work', ['a', 'b'])]),
    node('a', [route('from-b', ['b']), route('own-source', [], 10)]),
    node('b', [route('from-a', ['a']), route('own-source', [], 10)])]);
  assert.equal(plan.status, 'planned');
  assert.deepEqual(ids(plan), ['a', 'b', 'goal']);
  assert.equal(plan.durationMs, 21);
  assert.ok(reasons(plan).includes('dependency-cycle'));
});

test('unsafe and unconfirmed routes fall back to a known noncombat alternative', () => {
  for (const extra of [{ risk: 'unknown' }, { risk: 'dangerous' }, { evidence: 'unknown' },
    { durationMs: null }, { kind: 'unknown' }]) {
    const plan = solve([node('goal', [route('a-unsafe', [], 0, extra), route('b-safe', [], 20)])]);
    assert.equal(plan.status, 'planned');
    assert.equal(plan.steps[0].routeId, 'b-safe');
    assert.ok(plan.rejected.length > 0);
  }
});

test('Hardcore and unknown mode refuse combat even when safe is claimed', () => {
  const nodes = [node('goal', [route('combat', [], 1, { kind: 'combat' })])];
  assert.equal(solve(nodes).status, 'planned');
  for (const hardcore of [true, undefined, null, 'false']) {
    const plan = solve(nodes, 'goal', { ...context, hardcore });
    assert.equal(plan.status, 'blocked');
    assert.ok(reasons(plan).includes('combat-mode-unverified'));
  }
});

test('unowned and unknown prerequisite scopes cannot be acquired automatically', () => {
  for (const owned of [false, null, undefined]) {
    const plan = solve([node('goal', [route('work', ['dlc'])]), node('dlc', [route('gather')], { scopeId: 'ita' })],
      'goal', { ...context, ownership: { base: true, ita: owned } });
    assert.equal(plan.status, 'blocked');
    assert.ok(reasons(plan).includes(owned === false ? 'scope-not-owned' : 'scope-ownership-unknown'));
  }
});

test('unconfirmed facts cannot be treated as already satisfied', () => {
  const plan = solve([node('goal', [], { completed: true, evidence: 'unknown' })]);
  assert.equal(plan.status, 'blocked');
  assert.ok(reasons(plan).includes('fact-unconfirmed'));
});

test('missing nodes block only their route and permit another route', () => {
  const plan = solve([node('goal', [route('a-missing', ['missing']), route('b-known')])]);
  assert.equal(plan.status, 'planned');
  assert.ok(reasons(plan).includes('node-missing'));
  assert.equal(plan.steps[0].routeId, 'b-known');
});

test('ambiguous graph and route IDs fail closed', () => {
  assert.equal(solve([node('goal'), node('goal')]).reason, 'duplicate-node');
  const plan = solve([node('goal', [route('same'), route('same')])]);
  assert.equal(plan.status, 'blocked');
  assert.ok(reasons(plan).includes('duplicate-route'));
});

test('invalid graph, time and requirement data are rejected without coercion', () => {
  for (const graph of [null, {}, { nodes: null }, { nodes: [null] }])
    assert.equal(resolvePrerequisites(graph, 'goal', context).status, 'blocked');
  for (const value of [null, undefined, NaN, Infinity, -1, 0.5, '1', Number.MAX_SAFE_INTEGER + 1]) {
    const plan = solve([node('goal', [route('work', [], 1, { durationMs: value })])]);
    assert.equal(plan.status, 'blocked');
  }
  for (const requires of [null, ['a', 'a'], [null]])
    assert.equal(solve([node('goal', [route('work', requires)])]).status, 'blocked');
});

test('duration overflow does not become a finite or valid plan', () => {
  const plan = solve([node('goal', [route('work', ['a'], Number.MAX_SAFE_INTEGER)]), node('a', [route('work')])]);
  assert.equal(plan.status, 'blocked');
  assert.ok(reasons(plan).includes('duration-overflow'));
});

test('depth bounds reject the deep route while keeping a shallow alternative', () => {
  const plan = solve([node('goal', [route('deep', ['a']), route('shallow', [], 20)]),
    node('a', [route('work', ['b'])]), node('b', [route('work', ['c'])]), node('c', [route('work')])],
    'goal', context, { maxDepth: 1 });
  assert.equal(plan.status, 'planned');
  assert.ok(reasons(plan).includes('depth-limit'));
  assert.equal(plan.steps[0].routeId, 'shallow');
});

test('expansion exhaustion discards a previously found partial best plan', () => {
  const plan = solve([node('goal', [route('a-direct'), route('b-unsearched', ['other'])]), node('other', [route('work')])],
    'goal', context, { maxExpansions: 2 });
  assert.equal(plan.reason, 'expansion-limit');
  assert.equal(plan.expansions, 2);
  assert.deepEqual(plan.steps, []);
});

test('node, route and requirement fanout bounds are enforced', () => {
  assert.equal(solve([node('goal'), node('other')], 'goal', context, { maxNodes: 1 }).reason, 'node-limit');
  assert.ok(reasons(solve([node('goal', [route('a'), route('b')])], 'goal', context, { maxRoutes: 1 })).includes('route-limit'));
  assert.ok(reasons(solve([node('goal', [route('a', ['a', 'b'])])], 'goal', context, { maxRequirements: 1 }))
    .includes('requirement-limit'));
});

test('limits cannot be unbounded, fractional, zero, unknown or string values', () => {
  for (const limits of [{ maxDepth: 0 }, { maxDepth: 65 }, { maxDepth: '10' }, { maxExpansions: Infinity },
    { maxNodes: 0.5 }, { unknown: 5 }, null])
    assert.equal(solve([node('goal')], 'goal', context, limits).reason, 'limits-invalid');
});

test('diagnostics are bounded separately from search', () => {
  const plan = solve([node('goal', [route('a', ['missingA']), route('b', ['missingB']), route('c', ['missingC'])])],
    'goal', context, { maxReasons: 1 });
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.rejected.length, 1);
});

test('planning frozen input is pure and output contains no input object references', () => {
  const graph = { nodes: [node('goal', [route('work')])] };
  function freeze(value) {
    if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  }
  freeze(graph);
  const first = resolvePrerequisites(graph, 'goal', context);
  assert.deepEqual(resolvePrerequisites(graph, 'goal', context), first);
  first.steps[0].routeId = 'changed';
  assert.equal(graph.nodes[0].routes[0].id, 'work');
});

function completionFixture() {
  const missing = [{ id: 'melvorF:Item', name: 'Item', current: 0, maximum: 1, accessible: null },
    { id: 'melvorF:Other', name: 'Other', current: 0, maximum: 1, accessible: null }];
  const categories = Object.fromEntries(['skills', 'mastery', 'items', 'monsters', 'pets'].map(category =>
    [category, { supported: true, missing: category === 'items' ? missing : [] }]));
  return { mode: { hardcore: false }, completion: { scopes: [{ id: 'base', ownership: true, supported: true, categories }] } };
}

test('Completion generates goals automatically and routes available goals while retaining blockers', () => {
  const snapshot = completionFixture();
  const candidates = generateCompletionCandidates(snapshot).candidates;
  const graph = { nodes: [node(candidates[0].id, [route('craft', ['material'])]), node('material', [route('gather')])] };
  const result = planCompletionCandidates(snapshot, graph);
  assert.equal(result.status, 'planned');
  assert.equal(result.plans.length, 1);
  assert.equal(result.plans[0].candidateId, candidates[0].id);
  assert.equal(result.blockers.length, 1);
  assert.equal(result.runnable, false);
});

test('Completion versus satisfied graph contradiction is blocked', () => {
  const snapshot = completionFixture();
  const candidates = generateCompletionCandidates(snapshot).candidates;
  const result = planCompletionCandidates(snapshot, { nodes: candidates.map(c => node(c.id, [], { completed: true })) });
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.every(blocker => blocker.reason === 'completion-fact-conflict'));
});

test('batch candidate and shared expansion limits discard partial results', () => {
  const snapshot = completionFixture();
  const candidates = generateCompletionCandidates(snapshot).candidates;
  const graph = { nodes: candidates.map(c => node(c.id, [route('work')])) };
  assert.equal(planCompletionCandidates(snapshot, graph, { maxCandidates: 1 }).reason, 'candidate-limit');
  const result = planCompletionCandidates(snapshot, graph, { maxTotalExpansions: 2 });
  assert.equal(result.reason, 'batch-expansion-limit');
  assert.deepEqual(result.plans, []);
  assert.ok(result.expansions <= 2);
});

test('blocked runtime snapshot cannot activate planning or claim completion', () => {
  const result = planCompletionCandidates(readSnapshot({}), { nodes: [] });
  assert.equal(result.status, 'blocked');
  assert.deepEqual(result.plans, []);
  assert.ok(result.blockers.some(blocker => blocker.reason === 'runtime-adapter-unverified'));
});

test('one candidate hitting its local budget does not block a later simple candidate', () => {
  const snapshot = completionFixture();
  const candidates = generateCompletionCandidates(snapshot).candidates;
  const graph = { nodes: [node(candidates[0].id, [route('work', ['long'])]), node('long', [route('work')]),
    node(candidates[1].id, [route('work')])] };
  const result = planCompletionCandidates(snapshot, graph, { limits: { maxExpansions: 2 }, maxTotalExpansions: 10 });
  assert.equal(result.status, 'planned');
  assert.equal(result.plans[0].candidateId, candidates[1].id);
  assert.equal(result.blockers[0].reason, 'expansion-limit');
  assert.equal(result.expansions, 4);
});

test('graph target scope cannot silently change a Completion goal scope', () => {
  const snapshot = completionFixture();
  const candidates = generateCompletionCandidates(snapshot).candidates;
  const graph = { nodes: [node(candidates[0].id, [route('work')], { scopeId: 'ita' })] };
  const result = planCompletionCandidates(snapshot, graph);
  assert.equal(result.status, 'blocked');
  assert.ok(result.blockers.some(blocker => blocker.reason === 'completion-scope-conflict'));
});
