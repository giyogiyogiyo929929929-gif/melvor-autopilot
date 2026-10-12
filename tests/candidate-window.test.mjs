import test from 'node:test';
import assert from 'node:assert/strict';
import { selectCandidateWindow, windowGeneratedCandidates } from '../src/candidate-window.mjs';
import { indexPrerequisiteGraph, materializePrerequisites } from '../src/local-graph.mjs';
import { planCompletionCandidates } from '../src/prerequisites.mjs';
import { selectWindowedQuantifiedCompletionPlan } from '../src/quantified-planner.mjs';
import { generateCompletionCandidates, readSnapshot } from '../setup.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';

const context = { ownership: { base: true, ita: false }, hardcore: false };
const limits = { maxNodes: 512, maxRoutes: 16, maxRequirements: 32, maxDepth: 24 };
const route = (id = 'work', requires = [], extra = {}) => ({ id, requires, durationMs: 1,
  evidence: 'confirmed', kind: 'noncombat', risk: 'safe', ...extra });
const node = (id, routes = [route()], extra = {}) => ({ id, scopeId: 'base', evidence: 'confirmed', completed: false, routes, ...extra });
function fixture(count = 2001) {
  const entries = Array.from({ length: count }, (_, i) => ({ id: `melvorF:Item${String(i).padStart(5, '0')}`,
    current: 0, maximum: 1, accessible: null }));
  const categories = Object.fromEntries(['skills', 'mastery', 'items', 'monsters', 'pets'].map(category => [category,
    { supported: true, status: 'observed', current: 0, maximum: category === 'items' ? count : 0, percent: 0,
      entries: category === 'items' ? structuredClone(entries) : [], missing: category === 'items' ? structuredClone(entries) : [] }]));
  const snapshot = { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: { supported: true, achieved: false,
    scopes: [{ id: 'base', ownership: true, supported: true, achieved: false, percent: 0, categories }] } };
  const candidates = generateCompletionCandidates(snapshot).candidates;
  return { snapshot, candidates, graph: { nodes: candidates.map(candidate => node(candidate.id)) } };
}
const ids = window => window.candidates.map(candidate => candidate.id);
const local = (graph, target = 'goal', extraLimits = {}, ctx = context) =>
  materializePrerequisites(indexPrerequisiteGraph(graph), target, ctx, { ...limits, ...extraLimits });

test('more than 2000 candidates and global graph nodes can be viewed without changing full Completion', () => {
  const f = fixture(); const before = JSON.stringify(f.snapshot);
  assert.equal(planCompletionCandidates(f.snapshot, f.graph).reason, 'candidate-limit');
  const result = planCompletionCandidates(f.snapshot, f.graph, { window: {} });
  assert.equal(result.status, 'planned'); assert.equal(result.plans.length, 50);
  assert.equal(result.window.totalCandidates, 2001); assert.equal(result.window.fullCoverage, false);
  assert.equal(f.snapshot.completion.scopes[0].categories.items.missing.length, 2001);
  assert.equal(JSON.stringify(f.snapshot), before);
});

test('every candidate enters a stable rotating window with deterministic ID ordering', () => {
  const f = fixture(123); let cursor = null; const visited = new Set();
  for (let i = 0; i < 13; i++) {
    const window = selectCandidateWindow(f.snapshot, cursor, { size: 10 });
    ids(window).forEach(id => visited.add(id)); cursor = window.nextCursor;
  }
  assert.equal(visited.size, 123); assert.equal(cursor.wraps, 1);
});

test('observed active candidate is pinned without starving other goals', () => {
  const f = fixture(21); const activeCandidateId = f.candidates[20].id; let cursor = null; const visited = new Set();
  for (let i = 0; i < 20; i++) {
    const window = selectCandidateWindow(f.snapshot, cursor, { size: 2, activeCandidateId });
    assert.ok(ids(window).includes(activeCandidateId)); assert.equal(window.activeRetained, true);
    ids(window).forEach(id => visited.add(id)); cursor = window.nextCursor;
  }
  assert.equal(visited.size, 21);
  assert.equal(selectCandidateWindow(f.snapshot, null, { size: 1, activeCandidateId }).reason, 'window-no-rotation-capacity');
});

test('removed bookmarks and stale active goals do not restart every window at the first ID', () => {
  const f = fixture(10); const first = selectCandidateWindow(f.snapshot, null, { size: 3 });
  f.snapshot.completion.scopes[0].categories.items.missing.splice(2, 1);
  const next = selectCandidateWindow(f.snapshot, first.nextCursor, { size: 3, activeCandidateId: f.candidates[2].id });
  assert.equal(next.activeRetained, false); assert.equal(next.candidates[0].id, f.candidates[3].id);
});

test('a candidate exhausting local graph bounds does not poison a later simple candidate', () => {
  const f = fixture(2); f.graph.nodes = [node(f.candidates[0].id, [route('work', ['a'])]),
    node('a', [route('work', ['b'])]), node('b'), node(f.candidates[1].id)];
  const result = planCompletionCandidates(f.snapshot, f.graph, { window: {}, limits: { maxNodes: 2 } });
  assert.equal(result.status, 'planned'); assert.equal(result.plans[0].candidateId, f.candidates[1].id);
  assert.equal(result.blockers.find(blocker => blocker.id === f.candidates[0].id).reason, 'local-node-limit');
});

test('unrelated graph bodies are not read and completed facts require no route traversal', () => {
  const unrelated = { id: 'unrelated', get routes() { throw new Error('private'); } };
  const completed = { ...node('done', []), completed: true, get routes() { throw new Error('private'); } };
  const graph = { nodes: [node('goal', [route('work', ['done'])]), completed, unrelated] };
  const result = local(graph); assert.equal(result.supported, true);
  assert.deepEqual(result.graph.nodes.map(node => node.id), ['done', 'goal']);
  assert.deepEqual(result.graph.nodes.find(node => node.id === 'done').routes, []);
});

test('unsafe, unconfirmed and Hardcore combat routes preserve blockers without expanding their dependencies', () => {
  for (const extra of [{ evidence: 'unknown' }, { risk: 'unknown' }, { durationMs: null }, { kind: 'combat' }]) {
    const graph = { nodes: [node('goal', [route('a-bad', ['other'], extra), route('b-safe')]),
      { id: 'other', get routes() { throw new Error('must not read'); } }] };
    const subset = local(graph, 'goal', {}, { ...context, hardcore: true });
    assert.equal(subset.supported, true); assert.equal(subset.graph.nodes.length, 1);
  }
});

test('unconfirmed and unowned facts preserve their identity but not their route bodies', () => {
  for (const extra of [{ evidence: 'unknown' }, { scopeId: 'ita' }]) {
    const other = { ...node('other', [], extra), get routes() { throw new Error('must not read'); } };
    const subset = local({ nodes: [node('goal', [route('work', ['other'])]), other] });
    assert.equal(subset.supported, true); assert.equal(subset.graph.nodes.length, 2);
    assert.deepEqual(subset.graph.nodes.find(node => node.id === 'other').routes, []);
  }
});

test('cycles and shared prerequisites are finite, and depth-limited routes retain their requirements', () => {
  const graph = { nodes: [node('goal', [route('cycle', ['a']), route('direct')]), node('a', [route('back', ['goal'])])] };
  const subset = local(graph); assert.equal(subset.supported, true); assert.equal(subset.graph.nodes.length, 2);
  const deeper = local({ nodes: [node('goal', [route('deep', ['a']), route('shallow')]),
    node('a', [route('deep', ['b'])]), node('b')] }, 'goal', { maxDepth: 1 });
  assert.deepEqual(deeper.graph.nodes.find(node => node.id === 'a').routes[0].requires, ['b']);
  assert.ok(!deeper.graph.nodes.some(node => node.id === 'b'));
});

test('known missing dependencies do not fill the node budget or erase a direct alternative', () => {
  const graph = { nodes: [node('goal', [route('missing', ['absent1', 'absent2', 'absent3']), route('direct')])] };
  const subset = local(graph, 'goal', { maxNodes: 1 });
  assert.equal(subset.supported, true); assert.equal(subset.graph.nodes.length, 1);
});

test('partial windows and empty or blocked snapshots cannot announce completion', () => {
  const f = fixture(1); const window = selectCandidateWindow(f.snapshot);
  assert.equal(window.fullCoverage, false); assert.ok(!('achieved' in window));
  const blocked = selectCandidateWindow(readSnapshot({}));
  assert.equal(blocked.status, 'blocked'); assert.equal(blocked.fullCoverage, false);
  assert.ok(blocked.blockers.some(blocker => blocker.reason === 'runtime-adapter-unverified'));
});

test('invalid settings, duplicate candidates and cursor overflow fail closed', () => {
  const f = fixture(3);
  for (const options of [null, [], { size: 0 }, { size: 201 }, { size: '2' }, { unknown: 1 }])
    assert.equal(selectCandidateWindow(f.snapshot, null, options).reason, 'window-options-invalid');
  for (const cursor of [{ afterId: '', wraps: 0 }, { afterId: null, wraps: -1 }, {}, { afterId: null, wraps: 0, extra: 1 }])
    assert.equal(selectCandidateWindow(f.snapshot, cursor).reason, 'window-cursor-invalid');
  assert.equal(selectCandidateWindow(f.snapshot, { afterId: 'z', wraps: Number.MAX_SAFE_INTEGER }).reason, 'window-cursor-overflow');
  const generated = generateCompletionCandidates(f.snapshot); generated.candidates.push(generated.candidates[0]);
  assert.equal(windowGeneratedCandidates(generated).reason, 'window-candidate-invalid-or-duplicate');
  assert.equal(selectCandidateWindow(fixture(20_001).snapshot).reason, 'window-candidates-invalid-or-limit');
});

test('global graph ambiguity and local limit misuse are rejected', () => {
  assert.equal(indexPrerequisiteGraph({ nodes: [node('same'), node('same')] }).reason, 'global-node-invalid-or-duplicate');
  assert.equal(indexPrerequisiteGraph({ nodes: Array(20_001).fill({}) }).reason, 'global-graph-limit-or-invalid');
  assert.equal(local({ nodes: [node('goal')] }, 'goal', { maxNodes: Infinity }).reason, 'local-limits-invalid');
  assert.equal(local({ nodes: [node('goal', Array(17).fill(route()))] }).reason, 'local-route-limit');
});

test('graph and window outputs are detached from frozen source facts', () => {
  const f = fixture(5); const graph = { nodes: [node('goal', [route('work', ['other'])]), node('other')] };
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f.snapshot); freeze(graph); const first = selectCandidateWindow(f.snapshot);
  assert.deepEqual(selectCandidateWindow(f.snapshot), first); first.candidates[0].title = 'Changed';
  assert.ok(!f.snapshot.completion.scopes[0].categories.items.missing[0].title);
  const subset = local(graph); subset.graph.nodes.find(node => node.id === 'goal').routes[0].requires.push('changed');
  assert.deepEqual(graph.nodes[0].routes[0].requires, ['other']);
});

test('ordering changes preserve windows and local graphs', () => {
  const f = fixture(8); const first = selectCandidateWindow(f.snapshot, null, { size: 3 });
  f.snapshot.completion.scopes[0].categories.items.missing.reverse();
  assert.deepEqual(selectCandidateWindow(f.snapshot, null, { size: 3 }), first);
  const graph = { nodes: [node('goal', [route('z', ['a', 'b']), route('a')]), node('a'), node('b')] };
  const subset = local(graph); graph.nodes.reverse(); graph.nodes.find(n => n.id === 'goal').routes.reverse();
  assert.deepEqual(local(graph), subset);
});

test('a late usable goal is reached through autonomous quantified windows without cutting Completion', () => {
  const f = fixture(2001), last = f.candidates.at(-1), sid = JSON.stringify([last.id, 'work']);
  const estimates = [{ stepId: sid, evidence: 'confirmed', completionGain: 0.01, unlockValue: 0, consumptionCost: 0, reliability: 1, deathProbability: 0 }];
  const model = { steps: [{ stepId: sid, type: 'production', evidence: 'confirmed', demands: [{ id: last.targetId, quantity: 1 }], allowedRecipeIds: ['make'] }],
    recipes: [{ id: 'make', scopeId: 'base', unlocked: true, evidence: 'confirmed', bankOrder: 'consume-then-produce', costEvidence: 'fixed',
      kind: 'noncombat', risk: 'safe', outputs: [{ id: last.targetId, quantity: 1 }], itemCosts: [], currencyCosts: [], possibleOutputIds: [last.targetId], durationMs: 1000 }],
    recipeActions: [{ recipeId: 'make', evidence: 'confirmed', action: { id: 'Woodcutting', selectionIds: ['Tree'] }, costPerBatch: 0, reliabilityPerBatch: 1 }] };
  const resources = readResourcesForTesting({ currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    bank: { items: new Map(), lockedItems: new Set(), occupiedSlots: 0, maximumSlots: 10 }, currencies: { allObjects: [{ id: 'GP', amount: 0 }] },
    combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: { equippedArray: [
      { slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } },
    isPaused: false, activeAction: undefined, pausedAction: undefined }, { version: 'v1.3.1' });
  let cursor = null, selected = null;
  for (let page = 0; page < 41; page++) {
    const result = selectWindowedQuantifiedCompletionPlan(f.snapshot, f.graph, estimates, resources, model, { nowMs: page, cursor });
    assert.ok(result.window); cursor = result.window.nextCursor;
    if (result.selected) { selected = result; break; }
  }
  assert.equal(selected.selected.candidateId, last.id); assert.equal(selected.nextTask.action.id, 'Woodcutting');
  assert.equal(selected.window.fullCoverage, false); assert.equal(f.snapshot.completion.scopes[0].categories.items.entries.length, 2001);

  const larger = fixture(5000), later = larger.candidates.at(-1), laterStep = JSON.stringify([later.id, 'work']);
  const largeEstimates = larger.candidates.map(candidate => ({ stepId: JSON.stringify([candidate.id, 'work']), evidence: 'unknown' }));
  largeEstimates[4999] = { ...estimates[0], stepId: laterStep };
  const largeModel = { ...model, steps: larger.candidates.map(candidate => ({ stepId: JSON.stringify([candidate.id, 'work']), evidence: 'unknown' })),
    recipes: [{ ...model.recipes[0], outputs: [{ id: later.targetId, quantity: 1 }], possibleOutputIds: [later.targetId] }] };
  largeModel.steps[4999] = { ...model.steps[0], stepId: laterStep, demands: [{ id: later.targetId, quantity: 1 }] };
  const lastWindow = selectWindowedQuantifiedCompletionPlan(larger.snapshot, larger.graph, largeEstimates, resources, largeModel,
    { nowMs: 0, cursor: { afterId: larger.candidates[4998].id, wraps: 0 } });
  assert.equal(lastWindow.selected.candidateId, later.id); assert.equal(lastWindow.window.totalCandidates, 5000);
});

test('scope/category observation blockers survive partial windows with bounded sanitized diagnostics', () => {
  const f = fixture(3); f.snapshot.completion.scopes.push({ id: 'ita', ownership: null, supported: false, categories: {} });
  const window = selectCandidateWindow(f.snapshot, null, { size: 1 });
  assert.ok(window.blockers.some(blocker => blocker.id === 'ita')); assert.equal(window.fullCoverage, false);
  const generated = generateCompletionCandidates(f.snapshot);
  generated.blockers = Array.from({ length: 300 }, () => ({ id: 'problem', reason: { private: 'save-token' } }));
  const safe = windowGeneratedCandidates(generated); assert.equal(safe.blockers.length, 256); assert.equal(safe.blockersOmitted, 44);
  assert.ok(!JSON.stringify(safe).includes('save-token'));
});

test('window cursors remain available on aggregate graph budget exhaustion without implying coverage', () => {
  const f = fixture(2); const result = planCompletionCandidates(f.snapshot, f.graph, { window: {}, maxTotalExpansions: 2 });
  assert.equal(result.reason, 'batch-expansion-limit'); assert.deepEqual(result.plans, []);
  assert.ok(result.window.nextCursor); assert.equal(result.window.fullCoverage, false);
});
