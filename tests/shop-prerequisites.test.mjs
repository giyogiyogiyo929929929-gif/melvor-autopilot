import test from 'node:test';
import assert from 'node:assert/strict';
import { buildShopPrerequisiteGraph, shopCountNodeId } from '../src/shop-prerequisites.mjs';
import { resolvePrerequisites } from '../src/prerequisites.mjs';
const purchaseId = name => `melvorD:${name}`;
const group = entries => ({ entries, coverage: entries.every(value => value.supported) ? 'observed' : 'partial',
  met: entries.every(value => value.supported) ? entries.every(value => value.met) : null });
const purchaseCondition = (name, requiredCount = 1, met = false) => ({ type: 'ShopPurchase', supported: true, purchaseId: purchaseId(name), scopeId: 'base', requiredCount, met });
const skillCondition = (level = 10, met = false, type = 'SkillLevel') => ({ type, supported: true, skillId: 'melvorD:Smithing', scopeId: 'base', level, met });
const record = (name, observedPurchaseCount = 0, unlock = [], required = []) => ({ id: purchaseId(name), scopeId: 'base', status: 'observed', supported: true,
  data: { observedPurchaseCount, unlockRequirements: group(unlock), purchaseRequirements: group(required) } });
const snapshot = records => ({ version: 'v1.3.1', origin: 'mock-only', observationId: 'fixture-shop', mode: { id: 'Standard', hardcore: false }, purchases: { records } });
const build = records => buildShopPrerequisiteGraph(snapshot(records));
const countNode = (result, name, count = 1) => result.graph.nodes.find(value => value.id === shopCountNodeId(purchaseId(name), count));
test('all purchases generate stable count roots and two AND groups without supplied targets', () => {
  const result = build([record('A'), record('B', 0, [purchaseCondition('A')], [skillCondition()])]);
  assert.equal(result.supported, true); assert.deepEqual(result.roots, ['A', 'B'].map(name => shopCountNodeId(purchaseId(name), 1)));
  const node = countNode(result, 'B'); assert.equal(node.type, 'shop-count'); assert.equal(node.routes[0].requires.length, 2);
  assert.ok(node.routes[0].requires.every(id => result.graph.nodes.find(value => value.id === id).type === 'and'));
  assert.equal(result.graph.nodes.filter(value => value.type === 'SkillLevel').length, 1); assert.deepEqual(result.cycles, []);
  assert.equal(result.planningReady, false); assert.equal(result.runnable, false); assert.equal(result.modelOnly, true);
});
test('shared requirements and repeated group references are emitted once', () => {
  const result = build([record('A'), record('B', 0, [purchaseCondition('A'), purchaseCondition('A')]), record('C', 0, [purchaseCondition('A', 3)], [skillCondition()])]);
  assert.equal(result.graph.nodes.filter(value => value.purchaseId === purchaseId('A') && value.type === 'and').length, 2);
  assert.ok(countNode(result, 'A', 3)); assert.equal(result.graph.nodes.filter(value => value.type === 'shop-count' && value.requiredCount === 1 && value.purchaseId === purchaseId('A')).length, 1);
  assert.equal(result.edges, 11); // Four count routes (8 edges), plus two distinct purchase constraints and one skill edge.
});
test('ordinary and abyssal levels remain separate conditions and observations', () => {
  const result = build([record('A', 0, [], [skillCondition(10, true), skillCondition(10, false, 'AbyssalLevel')])]);
  const nodes = result.graph.nodes.filter(value => ['SkillLevel', 'AbyssalLevel'].includes(value.type));
  assert.equal(nodes.length, 2); assert.equal(nodes.find(value => value.type === 'SkillLevel').observedMet, true);
  assert.equal(nodes.find(value => value.type === 'AbyssalLevel').observedMet, false);
});
test('owned counts satisfy thresholds without reading irrelevant dependency or price getters', () => {
  const own = record('A', 3); for (const name of ['unlockRequirements', 'purchaseRequirements', 'quote', 'contains'])
    Object.defineProperty(own.data, name, { get() { throw new Error('must not read'); } });
  const result = build([own, record('B', 0, [purchaseCondition('A', 3, true)])]);
  assert.equal(countNode(result, 'A').completed, true); assert.equal(countNode(result, 'A', 3).completed, true);
  assert.deepEqual(countNode(result, 'A').routes, []); assert.deepEqual(countNode(result, 'A', 3).routes, []);
  assert.equal(result.issues.some(value => value.reason === 'shop-requirement-group-unverified'), false);
});
test('count threshold truth and an isMet observation must agree', () => {
  const result = build([record('A', 2), record('B', 0, [purchaseCondition('A', 1, false)])]);
  assert.equal(countNode(result, 'A').observedMet, null); assert.equal(countNode(result, 'A').completed, false);
  assert.ok(countNode(result, 'A').routes.length); assert.ok(result.issues.some(value => value.reason === 'shop-purchase-count-met-conflict'));
});
test('duplicate skill conditions cannot claim opposite met states', () => {
  const result = build([record('A', 0, [], [skillCondition(10, true), skillCondition(10, false)])]);
  const condition = result.graph.nodes.find(value => value.type === 'SkillLevel'); assert.equal(condition.observedMet, null);
  assert.equal(condition.completed, false); assert.ok(result.issues.some(value => value.reason === 'shop-skill-met-conflict'));
});
test('a higher met level with a lower unmet level invalidates the track rather than inventing XP', () => {
  const result = build([record('A', 0, [], [skillCondition(10, false), skillCondition(20, true)])]);
  assert.ok(result.graph.nodes.filter(value => value.type === 'SkillLevel').every(value => value.observedMet === null));
  assert.equal(result.issues.filter(value => value.reason === 'shop-skill-monotonicity-conflict').length, 2);
});
test('unknown requirements stay as AND blockers instead of being dropped', () => {
  const result = build([record('A', 0, [], [{ type: 'unknown', supported: false, met: null }, { type: 'unknown', supported: false, met: null }, skillCondition(10, true)])]);
  const unknown = result.graph.nodes.find(value => value.type === 'unknown-condition'); assert.equal(unknown.unknownRequirementCount, 2);
  const required = result.graph.nodes.find(value => value.requirementGroup === 'purchaseRequirements'); assert.equal(required.observedMet, null);
  assert.ok(required.routes[0].requires.includes(unknown.id));
});
test('summary claiming success over unmet or unsupported entries adds an unknown blocker', () => {
  const a = record('A', 0, [], [skillCondition(10, false)]); a.data.purchaseRequirements.met = true;
  const result = build([a]); assert.ok(result.issues.some(value => value.reason === 'shop-requirement-summary-conflict'));
  assert.equal(result.graph.nodes.find(value => value.requirementGroup === 'purchaseRequirements').completed, false);
});
test('self and mutual cycles are reported as unmet strongly connected components', () => {
  const self = build([record('A', 0, [purchaseCondition('A')])]); assert.equal(self.cycles.length, 1);
  assert.ok(self.cycles[0].includes(shopCountNodeId(purchaseId('A'), 1)));
  const mutual = build([record('A', 0, [purchaseCondition('B')]), record('B', 0, [purchaseCondition('A')])]);
  assert.equal(mutual.cycles.length, 1); assert.ok(mutual.cycles[0].includes(shopCountNodeId(purchaseId('B'), 1)));
});
test('cycle analysis includes an overlapping branch that a DFS back-edge list can miss', () => {
  const result = build([record('A', 0, [purchaseCondition('B'), purchaseCondition('C')]), record('B', 0, [purchaseCondition('A')]), record('C', 0, [purchaseCondition('B')])]);
  assert.equal(result.cycles.length, 1); for (const name of ['A', 'B', 'C']) assert.ok(result.cycles[0].includes(shopCountNodeId(purchaseId(name), 1)));
});
test('a previously owned prerequisite breaks the current dependency cycle', () => {
  const result = build([record('A', 1, [purchaseCondition('B', 1, false)]), record('B', 0, [purchaseCondition('A', 1, true)])]);
  assert.deepEqual(result.cycles, []); assert.equal(countNode(result, 'A').completed, true);
});
test('missing and excluded references remain unverified count stubs even if a requirement says true', () => {
  const excluded = { id: purchaseId('C'), scopeId: 'base', status: 'excluded', supported: false };
  Object.defineProperty(excluded, 'data', { get() { throw new Error('must not read'); } });
  const result = build([record('A', 0, [purchaseCondition('B', 1, true), purchaseCondition('C', 1, true)]), excluded]);
  assert.equal(countNode(result, 'B').observedMet, null); assert.equal(countNode(result, 'C').observedMet, null);
  assert.ok(result.issues.some(value => value.reason === 'shop-purchase-reference-missing'));
  assert.ok(result.issues.some(value => value.reason === 'shop-purchase-excluded'));
});
test('partial records and throwing groups are isolated with fixed diagnostic reasons', () => {
  const a = record('A'); Object.defineProperty(a.data, 'unlockRequirements', { get() { throw new Error('PRIVATE-SAVE'); } });
  const result = build([a, { id: purchaseId('B'), scopeId: 'base', status: 'blocked', supported: false }]);
  assert.equal(result.supported, true); assert.equal(JSON.stringify(result).includes('PRIVATE-SAVE'), false);
  assert.ok(result.issues.some(value => value.reason === 'shop-requirement-group-unverified'));
});
test('global shape, duplicate IDs, wrong scope and unknown provenance fail closed', () => {
  for (const change of [value => value.version = 'v2', value => value.origin = 'runtime-disabled', value => value.mode.hardcore = null,
    value => value.purchases.records = [], value => value.purchases.records.push(value.purchases.records[0]),
    value => value.purchases.records[0].scopeId = 'toth']) {
    const value = snapshot([record('A')]); change(value); const result = buildShopPrerequisiteGraph(value); assert.equal(result.supported, false); assert.equal(result.graph, null);
  }
  assert.equal(shopCountNodeId('melvorD', 1), null); assert.equal(shopCountNodeId('melvorD:', 1), null); assert.equal(shopCountNodeId(purchaseId('A'), 0), null);
});
test('node, edge, requirement, byte and option bounds discard partial graphs', () => {
  for (const options of [{ maxNodes: 1 }, { maxEdges: 1 }, { maximumBytes: 1024 }, { maxNodes: null }, { extra: true }]) {
    const result = buildShopPrerequisiteGraph(snapshot([record('A'), record('B', 0, [purchaseCondition('A')])]), options);
    assert.equal(result.supported, false); assert.equal(result.graph, null);
  }
  const a = record('A'); a.data.purchaseRequirements.entries = Array(129).fill(skillCondition());
  const result = build([a]); assert.equal(result.reason, 'shop-graph-requirement-limit'); assert.equal(result.graph, null);
});
test('bounded diagnostics do not echo extra data or claim unreachable/completion', () => {
  const result = buildShopPrerequisiteGraph(snapshot([record('A', 0, [purchaseCondition('Missing')], [skillCondition()])]), { maxIssues: 0 });
  assert.deepEqual(result.issues, []); assert.ok(result.issuesOmitted > 0); assert.equal(result.completed, undefined); assert.equal(result.unreachable, undefined);
});
test('2000-step dependency chains use iterative traversal and retain all source purchases', () => {
  const records = Array.from({ length: 2000 }, (_, index) => record(`Purchase${String(index).padStart(4, '0')}`, 0,
    index === 0 ? [] : [purchaseCondition(`Purchase${String(index - 1).padStart(4, '0')}`)]));
  const result = build(records); assert.equal(result.supported, true); assert.equal(result.sourcePurchases, 2000); assert.equal(result.roots.length, 2000);
  assert.deepEqual(result.cycles, []); assert.equal(result.graph.nodes.length, 6000);
});
test('freeze and order changes preserve deterministic detached graph data', () => {
  const records = [record('A'), record('B', 0, [purchaseCondition('A')], [skillCondition(10, true), skillCondition(20, false)])], value = snapshot(records);
  const first = buildShopPrerequisiteGraph(value); records.reverse(); records[0].data.purchaseRequirements.entries.reverse();
  assert.deepEqual(buildShopPrerequisiteGraph(value), first);
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } } freeze(value);
  assert.deepEqual(buildShopPrerequisiteGraph(value), first); first.graph.nodes[0].observedMet = 'tampered'; first.roots[0] = 'tampered';
  assert.notDeepEqual(buildShopPrerequisiteGraph(value), first);
});
test('the existing resolver refuses prototype evidence even when a count is observed complete', () => {
  const result = build([record('A', 1)]); assert.ok(result.graph.nodes.every(value => value.evidence === 'unknown'));
  const resolved = resolvePrerequisites(result.graph, result.roots[0], { ownership: { base: true }, hardcore: false });
  assert.equal(resolved.status, 'blocked'); assert.equal(resolved.runnable, false); assert.ok(resolved.rejected.some(value => value.reason === 'fact-unconfirmed'));
});
