import test from 'node:test';
import assert from 'node:assert/strict';
import { readCombatSnapshot, readCombatSnapshotForTesting } from '../src/combat-observation.mjs';
import { assessCombatRisk, assessCombatEnvelope, combatObservationSignature, guardCombatGraph } from '../src/combat-risk.mjs';
import { resolvePrerequisites } from '../src/prerequisites.mjs';
const COVERAGE = ['normal', 'specials', 'dots', 'passives', 'reflection', 'conditionalStats', 'damageTypes', 'areaEffects',
  'resourceChanges', 'autoEatTiming', 'autoEatAlgorithm'];
function fixture() {
  const character = () => ({ hitpoints: 100, damageType: { id: 'Normal' }, activeEffects: new Map(), availableAttacks: [{}],
    stats: { dirty: false, maxHitpoints: 100, maxHit: 10, attackInterval: 1000, getResistanceByID: () => 20 } });
  const player = { ...character(), autoEatThreshold: 30, autoEatHPLimit: 80, autoEatEfficiency: 90,
    food: { selectedSlot: 0, slots: [{ item: { id: 'Food', healsFor: 20 }, quantity: 100 }] } };
  const enemy = { ...character(), monster: { id: 'Enemy' } };
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    combat: { player, enemy, selectedMonster: { id: 'Enemy' }, isActive: true, fightInProgress: true, paused: false } };
  const context = { version: 'v1.3.1', observationId: 'fixture-frame', observedAtMs: 0 };
  return { game, context, player, enemy };
}
const read = f => readCombatSnapshotForTesting(f.game, f.context);
const envelope = (frame, extra = {}) => ({ evidence: 'confirmed-fixture', observationId: frame.observationId,
  stateSignature: combatObservationSignature(frame), enemyId: 'Enemy', damageTypeId: 'Normal',
  horizonMs: 1000, minimumWindowIntervalMs: 1000, packetDamageUpper: [10], healingMinimumPerFood: 10,
  coverage: Object.fromEntries(COVERAGE.map(key => [key, true])), ...extra });
const assess = (frame, evidence = envelope(frame), context = { nowMs: 0, maxAgeMs: 1000 }) => assessCombatEnvelope(frame, evidence, context);

test('observes current encounter and selected food without equating telemetry with safety', () => {
  const frame = read(fixture()); assert.equal(frame.supported, true); assert.equal(frame.planningReady, false);
  assert.equal(frame.parts.resistance.data.resistance, 20); assert.equal(frame.parts.autoEat.data.thresholdHP, 30);
  assert.equal(frame.parts.food.data.nominalHeal, 20); assert.equal(frame.parts.enemy.data.effectCoverage, 'unknown');
});
test('runtime/version/context gates never touch game getters or allow combat', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  assert.equal(readCombatSnapshot(forbidden, { enabled: true }).reason, 'runtime-combat-adapter-unverified');
  assert.equal(readCombatSnapshotForTesting(forbidden, { version: 'v1.4' }).reason, 'version-unverified');
  assert.equal(assessCombatRisk(forbidden, forbidden).runtimeAllowed, false);
});
test('dirty stats do not invoke number getters or resistance recalculation', () => {
  const f = fixture(); f.player.stats.dirty = true;
  Object.defineProperties(f.player.stats, { maxHitpoints: { get() { throw new Error('must not read'); } },
    getResistanceByID: { get() { throw new Error('must not read'); } } });
  const frame = read(f); assert.equal(frame.parts.player.reason, 'combat-stats-dirty-or-unknown');
  assert.equal(frame.supported, false); assert.equal(assess(frame).modelSafe, false);
});
test('absent or mismatched monster identity is unknown, not a harmless enemy', () => {
  for (const monster of [undefined, { id: 'Other' }]) {
    const f = fixture(); f.enemy.monster = monster; const frame = read(f);
    assert.equal(frame.parts.encounter.reason, 'encounter-identity-unverified'); assert.equal(frame.supported, false);
  }
});
test('partial exceptions are isolated and exception text is not exposed', () => {
  const f = fixture(); Object.defineProperty(f.player, 'autoEatThreshold', { get() { throw new Error('private-save'); } });
  const frame = read(f); assert.equal(frame.parts.player.supported, true); assert.equal(frame.parts.autoEat.supported, false);
  assert.ok(!JSON.stringify(frame).includes('private-save'));
});
test('malformed scalars, food/attack/effect bounds and unknown flags refuse observation', () => {
  for (const change of [f => { f.player.hitpoints = NaN; }, f => { f.enemy.stats.maxHit = -1; },
    f => { f.player.food.selectedSlot = 9; }, f => { f.player.food.slots[0].quantity = '1'; },
    f => { f.enemy.availableAttacks = Array(65).fill({}); }, f => { f.enemy.activeEffects = new Map(Array.from({ length: 129 }, (_, i) => [i, {}])); },
    f => { f.game.combat.isActive = null; }]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('attack/eat/damage/heal/compute/render/roll/save helpers are never touched', () => {
  const f = fixture(); const fail = { get() { throw new Error('unsafe'); } };
  for (const value of [f.player, f.enemy]) Object.defineProperties(value, { damage: fail, heal: fail, attack: fail, autoEat: fail,
    computeCombatStats: fail, processDeath: fail, encode: fail, rollToHit: fail });
  Object.defineProperties(f.game.combat, { selectMonster: fail, startFight: fail, stop: fail });
  assert.equal(read(f).supported, true);
});
test('telemetry alone and missing effect coverage cannot produce a survival bound', () => {
  const frame = read(fixture()); assert.equal(assess(frame, {}).modelSafe, false);
  for (const key of COVERAGE) {
    const proof = envelope(frame); proof.coverage[key] = false;
    assert.equal(assess(frame, proof).reason, 'combat-coverage-incomplete');
  }
});
test('complete synthetic bounds prove only conditional model survival and leave real probability unknown', () => {
  const frame = read(fixture()); const risk = assess(frame);
  assert.equal(risk.modelSafe, true); assert.equal(risk.modelOnly, true); assert.equal(risk.actualDeathProbability, null);
  assert.equal(risk.runtimeAllowed, false); assert.equal(risk.runnable, false);
  assert.equal(risk.metrics.windows, 2); assert.equal(risk.metrics.foodNeededUpper, 16);
});
test('threshold equal to burst is refused even when max-damage-only trajectories might survive', () => {
  const frame = read(fixture());
  assert.equal(assess(frame, envelope(frame, { packetDamageUpper: [30] })).reason, 'combat-autoeat-bound-insufficient');
  frame.parts.player.data.hp = 10;
  assert.equal(assess(frame, envelope(frame)).reason, 'combat-initial-lethal-bound');
});
test('multi-hit/effect burst uses the full incoming bound rather than normal maxHit', () => {
  const frame = read(fixture()); assert.equal(frame.parts.enemy.data.maxHit, 10);
  assert.equal(assess(frame, envelope(frame, { packetDamageUpper: [10, 50] })).modelSafe, false);
});
test('Hardcore, unknown mode and stale or changed observation identities are refused', () => {
  for (const hardcore of [true, undefined, null]) {
    const frame = read(fixture()); frame.mode.hardcore = hardcore;
    assert.equal(assess(frame).reason, 'combat-mode-refused');
  }
  const frame = read(fixture()), old = envelope(frame); frame.parts.food.data.quantity = 99;
  assert.equal(assess(frame, old).reason, 'combat-envelope-unverified');
  assert.equal(assess(frame, envelope(frame), { nowMs: 1001, maxAgeMs: 1000 }).reason, 'combat-frame-stale');
  assert.equal(assess(frame, envelope(frame, { enemyId: 'Other' })).reason, 'combat-envelope-unverified');
});
test('selected food and verified minimum healing must cover the entire finite horizon', () => {
  const frame = read(fixture()); frame.parts.food.data.quantity = 15;
  assert.equal(assess(frame).reason, 'combat-food-insufficient');
  frame.parts.food.data.quantity = 16; assert.equal(assess(frame).modelSafe, true);
  assert.equal(assess(frame, envelope(frame, { healingMinimumPerFood: null })).reason, 'combat-healing-unverified');
  frame.parts.autoEat.data.efficiencyPercent = 0;
  assert.equal(assess(frame).reason, 'combat-healing-unverified');
});
test('food overflow, unsupported horizons/frequencies and invalid packet bounds fail closed', () => {
  const frame = read(fixture());
  for (const extra of [{ horizonMs: 0 }, { horizonMs: Infinity }, { minimumWindowIntervalMs: '1' },
    { packetDamageUpper: [NaN] }, { packetDamageUpper: [] }, { packetDamageUpper: Array(65).fill(1) }])
    assert.equal(assess(frame, envelope(frame, extra)).reason, 'combat-envelope-invalid');
  assert.equal(assess(frame, envelope(frame, { horizonMs: 20_000, minimumWindowIntervalMs: 1 })).reason, 'combat-window-limit');
});
test('a zero-damage proof still needs complete coverage and does not use empty telemetry as proof', () => {
  const frame = read(fixture()); frame.parts.food.data.quantity = 0;
  const risk = assess(frame, envelope(frame, { packetDamageUpper: [0] }));
  assert.equal(risk.modelSafe, true); assert.equal(risk.metrics.foodNeededUpper, 0); assert.equal(risk.actualDeathProbability, null);
  frame.supported = false; assert.equal(assess(frame, envelope(frame, { packetDamageUpper: [0] })).modelSafe, false);
});
test('unassessed claimed-safe combat falls back to a confirmed noncombat route', () => {
  const graph = { nodes: [{ id: 'goal', scopeId: 'base', evidence: 'confirmed', completed: false, routes: [
    { id: 'combat', requires: [], evidence: 'confirmed', kind: 'combat', risk: 'safe', durationMs: 1 },
    { id: 'work', requires: [], evidence: 'confirmed', kind: 'noncombat', risk: 'safe', durationMs: 100 } ] }] };
  const guarded = guardCombatGraph(graph, read(fixture()), [], { nowMs: 0, maxAgeMs: 1000 });
  assert.equal(guarded.supported, true); assert.equal(guarded.graph.nodes[0].routes[0].risk, 'unknown');
  const plan = resolvePrerequisites(guarded.graph, 'goal', { ownership: { base: true }, hardcore: false });
  assert.equal(plan.steps[0].routeId, 'work'); assert.equal(plan.runnable, false);
  assert.equal(graph.nodes[0].routes[0].risk, 'safe');
});
test('synthetic graph admission is labeled model-only and does not admit Hardcore', () => {
  const graph = { nodes: [{ id: 'goal', scopeId: 'base', evidence: 'confirmed', completed: false,
    routes: [{ id: 'fight', requires: [], evidence: 'confirmed', kind: 'combat', risk: 'unknown', durationMs: 1 }] }] };
  const frame = read(fixture()), records = [{ nodeId: 'goal', routeId: 'fight', envelope: envelope(frame) }];
  const guarded = guardCombatGraph(graph, frame, records, { nowMs: 0, maxAgeMs: 1000 });
  assert.equal(guarded.graph.nodes[0].routes[0].risk, 'safe'); assert.equal(guarded.assessments[0].modelOnly, true);
  assert.equal(guarded.assessments[0].runtimeAllowed, false);
  frame.mode.hardcore = true; records[0].envelope = envelope(frame);
  assert.equal(guardCombatGraph(graph, frame, records, { nowMs: 0, maxAgeMs: 1000 }).graph.nodes[0].routes[0].risk, 'unknown');
});
test('frozen telemetry/envelopes are deterministic and outputs share no caller references', () => {
  const frame = read(fixture()), proof = envelope(frame); function freeze(value) {
    if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  }
  freeze(frame); freeze(proof); const risk = assess(frame, proof); assert.deepEqual(assess(frame, proof), risk);
  risk.metrics.foodNeededUpper = 999; assert.equal(proof.healingMinimumPerFood, 10);
});
