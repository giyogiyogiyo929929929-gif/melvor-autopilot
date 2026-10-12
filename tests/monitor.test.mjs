import test from 'node:test';
import assert from 'node:assert/strict';
import { monitorTask } from '../src/monitor.mjs';
import { resourceSnapshotProblem } from '../src/snapshot-validation.mjs';
import { readResourcesForTesting, readResourceSnapshot } from '../src/resources.mjs';
import { createWoodcuttingExecutorForTesting } from '../src/executor.mjs';
import { readActionSelectionForTesting } from '../src/action-selection.mjs';

const SKILL = 'melvorF:Woodcutting';
const categories = ['skills', 'mastery', 'items', 'monsters', 'pets'];
function fixture() {
  const log = { id: 'Logs' };
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false,
    activeAction: { id: SKILL, isActive: true, activeSkills: [{ id: SKILL }] }, pausedAction: undefined,
    bank: { items: new Map([[log, { item: log, quantity: 1 }]]), lockedItems: new Set(), occupiedSlots: 1, maximumSlots: 10 },
    currencies: { allObjects: [{ id: 'GP', amount: 10.5 }] }, combat: { player: { selectedEquipmentSet: 0,
      equipmentSets: [{ equipment: { equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Sword' }, quantity: 1, isEmpty: false }] } }] } }
  };
  const task = { id: 'task-1', action: { id: SKILL, selectionIds: ['Normal'] },
    endConditions: [{ type: 'inventory', id: 'Logs', quantity: 10 }],
    requirements: { items: [], currencies: [], outputIds: ['Logs', 'Gem'], outputsEvidence: 'confirmed' },
    bounds: { stagnationMs: 1000, maxDurationMs: 10_000, maxObservationGapMs: 5000 } };
  const entries = Object.fromEntries(categories.map(category => [category,
    [{ id: `${category}-target`, current: 0, maximum: 1, accessible: null }]]));
  const f = { game, task, entries, context: { nowMs: 0, sessionId: 'session-1', offline: false }, selectionIds: ['Normal'] };
  f.quantity = quantity => { game.bank.items.get(log).quantity = quantity; };
  f.snapshot = () => ({ resources: readResourcesForTesting(game, { version: 'v1.3.1' }),
    actionSelection: { supported: true, actionId: SKILL, selectionIds: [...f.selectionIds] },
    completionSnapshot: { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: {
      scopes: [{ id: 'base', ownership: true, supported: true, categories: Object.fromEntries(categories.map(category => {
        const all = structuredClone(entries[category]);
        const current = all.reduce((sum, entry) => sum + entry.current, 0);
        const maximum = all.reduce((sum, entry) => sum + entry.maximum, 0);
        return [category, { supported: true, status: 'observed', current, maximum, percent: maximum ? 100 * current / maximum : 100,
          entries: all, missing: all.filter(entry => entry.current < entry.maximum).map(entry => ({ ...entry })) }];
      })) }] } } });
  return f;
}
const run = (f, checkpoint = null, context = {}, snapshot = f.snapshot()) =>
  monitorTask(f.task, snapshot, checkpoint, { ...f.context, ...context });
const completionGoal = (category, extra = {}) => ({ type: 'completion', scopeId: 'base', category, id: `${category}-target`, ...extra });

test('read-only active selection detects a manual tree switch without stopping another action', () => {
  const f = fixture(), tree = { id: 'melvorF:Normal', namespace: 'melvorF', isModded: false, product: { id: 'melvorF:Logs', namespace: 'melvorF', isModded: false } },
    other = { ...tree, id: 'melvorF:Oak' };
  f.task.action.selectionIds = [tree.id];
  f.game.woodcutting = { id: SKILL, namespace: 'melvorF', isModded: false, isUnlocked: true, isActive: true, canStop: true, activeTrees: new Set([tree]),
    actions: { getObjectByID: id => [tree, other].find(value => value.id === id) }, isTreeUnlocked: () => true };
  const snapshot = () => ({ ...f.snapshot(), actionSelection: readActionSelectionForTesting(f.game, {
    version: 'v1.3.1', observationId: 'selection-frame', ownership: { base: true }, expectedActionId: SKILL }).actionSelection });
  assert.equal(run(f, null, {}, snapshot()).status, 'continue'); f.game.woodcutting.activeTrees = new Set([other]);
  assert.equal(run(f, null, {}, snapshot()).reason, 'action-selection-changed'); assert.equal(f.game.activeAction.id, SKILL);
});
test('selection variant changes replan even when action and recipe IDs stay the same', () => {
  const f = fixture(); f.task.action.id = 'Fletching'; f.game.activeAction.id = 'Fletching';
  const snapshot = index => { const value = f.snapshot(); value.actionSelection = { supported: true, actionId: 'Fletching', selectionIds: ['Normal'], variant: { kind: 'fletching', alternativeIndexRaw: index } }; return value; };
  const first = run(f, null, {}, snapshot(1)); assert.equal(first.status, 'continue'); assert.equal(typeof first.checkpoint.selectionSignature, 'string');
  assert.equal(run(f, first.checkpoint, { nowMs: 10 }, snapshot(2)).reason, 'action-selection-variant-changed');
  assert.equal(run(f, first.checkpoint, { nowMs: 10 }, snapshot(1)).status, 'continue');
});
test('planned variant mismatch and arbitrary extra variant fields cannot be accepted', () => {
  const f = fixture(); f.task.action.variant = { kind: 'fletching', alternativeIndexRaw: 1 };
  const value = f.snapshot(); value.actionSelection.variant = { kind: 'fletching', alternativeIndexRaw: 2 };
  assert.equal(run(f, null, {}, value).reason, 'action-selection-variant-changed');
  value.actionSelection.variant = { kind: 'fletching', alternativeIndexRaw: 1, save: 'PRIVATE' };
  assert.equal(run(f, null, {}, value).reason, 'action-selection-variant-unverified');
});
test('legacy checkpoint without a variant signature stays compatible with variant-free selection', () => {
  const f = fixture(), first = run(f); delete first.checkpoint.selectionSignature;
  assert.equal(run(f, first.checkpoint, { nowMs: 10 }).status, 'continue');
});
test('checkpoint variant signatures reject arbitrary or malformed payloads', () => {
  const f = fixture(), first = run(f);
  for (const value of ['PRIVATE', '["future",null]', '["fletching",-1]', '["fletching",0,1]']) {
    const checkpoint = structuredClone(first.checkpoint); checkpoint.selectionSignature = value;
    assert.equal(run(f, checkpoint, { nowMs: 10 }).reason, 'checkpoint-invalid');
  }
});

function targetedSnapshot(f, current = 0, categoryMaximum = 4) {
  const result = f.snapshot(); result.completionSnapshot = null;
  result.completionTargets = { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, observationId: 'target-frame', origin: 'mock-only',
    coverage: 'targets-only', fullCoverage: false, ownership: { base: true }, targets: [{ scopeId: 'base', category: 'items', id: 'items-target',
      current, maximum: 1, categoryMaximum, accessible: null, supported: true, status: 'observed' }] };
  return result;
}
test('target-only completion monitoring completes explicit conditions and replans on denominator change', () => {
  const f = fixture(); f.task.endConditions = [completionGoal('items')];
  const first = run(f, null, {}, targetedSnapshot(f)); assert.equal(first.status, 'continue');
  assert.equal(run(f, first.checkpoint, { nowMs: 10 }, targetedSnapshot(f, 1)).status, 'complete');
  assert.equal(run(f, first.checkpoint, { nowMs: 10 }, targetedSnapshot(f, 0, 5)).reason, 'completion-denominator-changed');
});
test('partial target DTOs reject duplicate, mixed, unknown, locked, mode and malformed values', () => {
  for (const change of [s => s.completionTargets.targets.push({ ...s.completionTargets.targets[0] }),
    s => s.completionSnapshot = fixture().snapshot().completionSnapshot, s => s.completionTargets.fullCoverage = true,
    s => s.completionTargets.mode.id = 'Other', s => s.completionTargets.targets[0].current = NaN,
    s => s.completionTargets.targets[0].supported = false, s => s.completionTargets.targets[0].accessible = false,
    s => s.completionTargets.targets = []]) {
    const f = fixture(); f.task.endConditions = [completionGoal('items')]; const s = targetedSnapshot(f); change(s);
    assert.equal(run(f, null, {}, s).status, 'blocked');
  }
});

test('inventory criteria continue until observed target quantity is met', () => {
  const f = fixture(); const first = run(f);
  assert.equal(first.status, 'continue'); assert.equal(first.stopRequired, false); assert.equal(first.runnable, false);
  f.quantity(9); const progress = run(f, first.checkpoint, { nowMs: 500 });
  assert.equal(progress.reason, 'target-progressed'); assert.equal(progress.checkpoint.lastProgressAtMs, 500);
  f.quantity(10); const completed = run(f, progress.checkpoint, { nowMs: 600 });
  assert.equal(completed.status, 'complete'); assert.equal(completed.stopRequired, true);
  assert.equal(completed.checkpoint.phase, 'terminal');
});

test('AND completion criteria use explicit entries for all five categories', () => {
  const f = fixture(); f.task.endConditions = categories.map(category => completionGoal(category));
  const first = run(f); assert.equal(first.status, 'continue');
  for (const category of categories) f.entries[category][0].current = 1;
  f.entries.pets[0].current = 0;
  const partial = run(f, first.checkpoint, { nowMs: 500 }); assert.equal(partial.status, 'continue');
  f.entries.pets[0].current = 1;
  assert.equal(run(f, partial.checkpoint, { nowMs: 600 }).status, 'complete');
});

test('mastery skill ID and abyssal track distinguish targets with the same item ID', () => {
  const f = fixture(); f.entries.mastery = [{ id: 'recipe', skillId: 'A', current: 1, maximum: 2, accessible: true },
    { id: 'recipe', skillId: 'B', current: 2, maximum: 2, accessible: true }];
  f.task.endConditions = [completionGoal('mastery', { id: 'recipe', skillId: 'A' })];
  assert.equal(run(f).status, 'continue'); f.entries.mastery[0].current = 2; assert.equal(run(f).status, 'complete');
  f.entries.skills = [{ id: 'skill', track: 'standard', current: 10, maximum: 10, accessible: true },
    { id: 'skill', track: 'abyssal', current: 1, maximum: 10, accessible: true }];
  f.task.endConditions = [completionGoal('skills', { id: 'skill', track: 'abyssal' })];
  assert.equal(run(f).status, 'continue');
});

test('missing-list disappearance and zero denominators do not prove completion', () => {
  const f = fixture(); f.task.endConditions = [completionGoal('items')];
  const snapshot = f.snapshot(); snapshot.completionSnapshot.completion.scopes[0].categories.items.missing = [];
  assert.equal(run(f, null, {}, snapshot).reason, 'completion-missing-inconsistent');
  f.entries.items = []; assert.equal(run(f).reason, 'completion-category-unverified');
  f.entries.items = [{ id: 'another-target', current: 1, maximum: 1, accessible: null }];
  assert.equal(run(f).reason, 'completion-target-unobserved');
});

test('Completion partial, inconsistent, duplicate and malformed observations are blocked', () => {
  const changes = [category => { category.supported = false; }, category => { category.entries = null; },
    category => { category.current = 1; category.percent = 100; }, category => { category.entries[0].current = NaN; },
    category => { category.entries.push({ ...category.entries[0] }); },
    category => { category.missing.push({ ...category.missing[0] }); }, category => { category.maximum = 0; }];
  for (const change of changes) {
    const f = fixture(); f.task.endConditions = [completionGoal('skills')]; const snapshot = f.snapshot();
    change(snapshot.completionSnapshot.completion.scopes[0].categories.skills);
    assert.equal(run(f, null, {}, snapshot).status, 'blocked');
  }
});

test('unowned, unknown and locked Completion targets remain unavailable', () => {
  const f = fixture(); f.task.endConditions = [completionGoal('items')];
  for (const ownership of [false, null, undefined]) {
    const snapshot = f.snapshot(); snapshot.completionSnapshot.completion.scopes[0].ownership = ownership;
    assert.equal(run(f, null, {}, snapshot).reason, ownership === false ? 'scope-not-owned' : 'scope-ownership-unknown');
  }
  f.entries.items[0].accessible = false; assert.equal(run(f).reason, 'completion-target-locked');
  f.entries.items[0].current = 1; assert.equal(run(f).status, 'complete');
});

test('denominator and mode changes force replan instead of preserving stale progress', () => {
  const f = fixture(); f.task.endConditions = [completionGoal('skills')];
  const first = run(f); f.entries.skills[0].maximum = 2;
  assert.equal(run(f, first.checkpoint, { nowMs: 1 }).reason, 'completion-denominator-changed');
  f.entries.skills[0].maximum = 1; f.game.currentGamemode.id = 'Changed';
  assert.equal(run(f, first.checkpoint, { nowMs: 1 }).reason, 'mode-changed');
});

test('only target progress resets stagnation; unrelated drops cannot keep a task alive', () => {
  const f = fixture(); const first = run(f);
  const gem = { id: 'Gem' }; f.game.bank.items.set(gem, { item: gem, quantity: 5 }); f.game.bank.occupiedSlots++;
  const waiting = run(f, first.checkpoint, { nowMs: 999 });
  assert.equal(waiting.status, 'continue'); assert.equal(waiting.checkpoint.lastProgressAtMs, 0);
  assert.equal(run(f, waiting.checkpoint, { nowMs: 1000 }).reason, 'task-stagnant');
});

test('progress at stagnation boundary wins, but total duration still has a hard bound', () => {
  const f = fixture(); const first = run(f); f.quantity(2);
  const progress = run(f, first.checkpoint, { nowMs: 1000 });
  assert.equal(progress.status, 'continue'); assert.equal(progress.metrics.stagnantMs, 0);
  f.task.bounds.maxDurationMs = 2000; const fresh = run(f); f.quantity(3);
  assert.equal(run(f, fresh.checkpoint, { nowMs: 2000 }).reason, 'task-duration-limit');
});

test('observed progress regression is not hidden by a high-water mark', () => {
  const f = fixture(); f.quantity(5); const first = run(f); f.quantity(4);
  assert.equal(run(f, first.checkpoint, { nowMs: 1 }).reason, 'task-progress-regressed');
});

test('material and currency shortages, locked items and unknown currencies stop', () => {
  const f = fixture(); f.task.requirements.items = [{ id: 'Logs', quantity: 2 }];
  assert.equal(run(f).reason, 'materials-insufficient'); f.quantity(3);
  f.game.bank.lockedItems.add([...f.game.bank.items.keys()][0]); assert.equal(run(f).reason, 'material-protected');
  f.task.requirements.items = []; f.task.requirements.currencies = [{ id: 'GP', amount: 11 }];
  assert.equal(run(f).reason, 'currency-insufficient'); f.task.requirements.currencies[0].amount = 10.5;
  assert.equal(run(f).status, 'continue'); f.task.requirements.currencies[0].id = 'Unknown';
  assert.equal(run(f).reason, 'currency-unobserved');
});

test('bank capacity uses all possible new stacks and permits held output stacks', () => {
  const f = fixture(); f.game.bank.maximumSlots = 1;
  assert.equal(run(f).reason, 'bank-capacity-insufficient'); f.task.requirements.outputIds = ['Logs'];
  assert.equal(run(f).status, 'continue');
});

test('manual action, selection, equipment changes and game pause request safe termination', () => {
  for (const [change, reason] of [
    [f => { f.game.activeAction.id = 'Mining'; }, 'expected-action-changed'],
    [f => { f.selectionIds = ['Oak']; }, 'action-selection-changed'],
    [f => { f.game.combat.player.equipmentSets[0].equipment.equippedArray[0].item.id = 'Other'; }, 'equipment-changed'],
    [f => { f.game.isPaused = true; }, 'game-paused']]) {
    const f = fixture(); const first = run(f); change(f);
    const outcome = run(f, first.checkpoint, { nowMs: 1 });
    assert.equal(outcome.reason, reason); assert.equal(outcome.stopRequired, true);
  }
});

test('offline snapshots are not read and resume always requests fresh planning', () => {
  const f = fixture(); const first = run(f);
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  const suspended = run(f, first.checkpoint, { nowMs: 100_000, offline: true }, forbidden);
  assert.equal(suspended.status, 'suspended'); assert.equal(suspended.stopRequired, false);
  assert.equal(suspended.checkpoint.lastProgressAtMs, 0);
  const resumed = run(f, suspended.checkpoint, { nowMs: 100_001 });
  assert.equal(resumed.status, 'replan'); assert.equal(resumed.reason, 'offline-return');
  const startingOffline = run(f, null, { offline: true }, forbidden);
  assert.equal(run(f, startingOffline.checkpoint, { nowMs: 1 }).reason, 'offline-return');
});

test('session changes and observation gaps invalidate old checkpoints at the boundary', () => {
  const f = fixture(); const first = run(f);
  assert.equal(run(f, first.checkpoint, { nowMs: 1, sessionId: 'new-session' }).reason, 'session-changed');
  assert.equal(run(f, first.checkpoint, { nowMs: 5000 }).reason, 'observation-gap');
});

test('explicit stop requires no snapshot, task or checkpoint getters', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  const outcome = monitorTask(forbidden, forbidden, forbidden, { stopRequested: true });
  assert.equal(outcome.status, 'stopped'); assert.equal(outcome.reason, 'user-stop'); assert.equal(outcome.stopRequired, true);
});

test('terminal monitors never automatically resume or assert stale completion', () => {
  const f = fixture(); f.quantity(10); const completed = run(f); f.quantity(1);
  assert.equal(run(f, completed.checkpoint, { nowMs: 1 }).reason, 'monitor-terminal');
  const first = run(f); const stale = run(f, first.checkpoint, { nowMs: 1000 });
  f.quantity(2); assert.equal(run(f, stale.checkpoint, { nowMs: 1001 }).reason, 'monitor-terminal');
});

test('invalid clocks, signatures, changed task criteria and malformed checkpoints fail closed', () => {
  const f = fixture(); const first = run(f);
  for (const nowMs of [NaN, null, -1, 0.1, '0', Infinity]) assert.equal(run(f, null, { nowMs }).reason, 'monitor-context-invalid');
  const later = run(f, first.checkpoint, { nowMs: 10 });
  assert.equal(run(f, later.checkpoint, { nowMs: 9 }).reason, 'observation-time-reversed');
  for (const alter of [c => { c.startedAtMs = 10; }, c => { c.progress = null; },
    c => { c.progress.push(c.progress[0]); }, c => { c.mode = null; }, c => { c.phase = 'other'; }]) {
    const checkpoint = structuredClone(first.checkpoint); alter(checkpoint);
    assert.equal(run(f, checkpoint, { nowMs: 1 }).reason, 'checkpoint-invalid');
  }
  f.task.endConditions[0].quantity++;
  assert.equal(run(f, first.checkpoint, { nowMs: 1 }).reason, 'task-checkpoint-conflict');
});

test('task criteria, materials, duplicate IDs and time/collection bounds are validated', () => {
  for (const change of [f => { f.task.id = ''; }, f => { f.task.endConditions = []; },
    f => { f.task.endConditions[0].quantity = '10'; }, f => { f.task.endConditions.push(f.task.endConditions[0]); },
    f => { f.task.endConditions = Array(17).fill(f.task.endConditions[0]); },
    f => { f.task.requirements.outputsEvidence = 'unknown'; }, f => { f.task.requirements.outputIds.push('Logs'); },
    f => { f.task.requirements.items = [{ id: 'Logs', quantity: 1.1 }]; },
    f => { f.task.bounds.stagnationMs = 0; }, f => { f.task.bounds.maxDurationMs = 2_592_000_001; },
    f => { f.task.bounds.unknown = 1; }]) {
    const f = fixture(); change(f); assert.equal(run(f).reason, 'monitor-task-invalid');
  }
});

test('malformed resource data is refused even when all supported flags claim success', () => {
  const changes = [r => { r.categories.bank.data.freeSlots = 99; }, r => { r.categories.bank.data.items[0].locked = null; },
    r => { r.categories.bank.data.lockedIds = ['Logs']; }, r => { r.categories.currencies.data.currencies[0].amount = NaN; },
    r => { r.categories.equipment.data.selectedSet = 9; }, r => { r.categories.equipment.data.sets[0].slots[0].occupiedBySlotId = 'Missing'; },
    r => { r.categories.activity.data.active.skillIds = ['duplicate', 'duplicate']; }];
  for (const change of changes) {
    const f = fixture(); const snapshot = f.snapshot(); change(snapshot.resources);
    assert.notEqual(resourceSnapshotProblem(snapshot.resources), null);
    assert.equal(run(f, null, {}, snapshot).status, 'blocked');
  }
  assert.equal(resourceSnapshotProblem(readResourceSnapshot({})), 'resources-unverified');
});

test('input order changes preserve decisions and canonical task identity', () => {
  const f = fixture(); f.task.endConditions.push(completionGoal('items'));
  f.task.requirements.currencies = [{ id: 'GP', amount: 1 }]; const first = run(f);
  f.task.endConditions.reverse(); f.task.requirements.outputIds.reverse();
  assert.deepEqual(run(f), first);
  assert.equal(run(f, first.checkpoint, { nowMs: 1 }).status, 'continue');
});

test('frozen inputs are unchanged and checkpoint data is detached', () => {
  const f = fixture(); const snapshot = f.snapshot(); const before = JSON.stringify({ task: f.task, snapshot });
  function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } }
  freeze(f.task); freeze(snapshot); const first = run(f, null, {}, snapshot); freeze(first.checkpoint);
  const next = run(f, first.checkpoint, { nowMs: 1 }, snapshot);
  next.checkpoint.progress[0].current = 999; next.checkpoint.mode.id = 'Changed';
  assert.equal(first.checkpoint.progress[0].current, 1);
  assert.equal(JSON.stringify({ task: f.task, snapshot }), before);
});

test('unreadable input returns a fixed reason rather than exception details', () => {
  const f = fixture(); Object.defineProperty(f.task, 'action', { get() { throw new Error('private-save-secret'); } });
  const outcome = run(f); assert.equal(outcome.reason, 'monitor-input-unreadable');
  assert.ok(!JSON.stringify(outcome).includes('private-save-secret'));
});

test('unrecognized nested fields are not copied into checkpoint or journal data', () => {
  const f = fixture(); const snapshot = f.snapshot(); snapshot.resources.mode.extra = { secret: 'unrelated' };
  const first = run(f, null, {}, snapshot);
  assert.ok(!('extra' in first.checkpoint.mode));
  first.checkpoint.extra = { secret: 'unrelated' }; first.checkpoint.progress[0].extra = { secret: 'unrelated' };
  first.checkpoint.mode.extra = { secret: 'unrelated' };
  const next = run(f, first.checkpoint, { nowMs: 1 }, snapshot);
  assert.ok(!JSON.stringify(next).includes('unrelated'));
});

test('woodcutting monitor completion and stagnation invoke owned, verified mock stopping', async () => {
  for (const complete of [true, false]) {
    const f = fixture(); f.game.activeAction = undefined;
    const wc = { supported: true, skillId: SKILL, unlocked: true, isActive: false, canStop: true, activeTreeIds: [],
      trees: [{ id: 'Normal', unlocked: true, outputIds: ['Logs', 'Gem'], outputsEvidence: 'confirmed' }] };
    let stopCalls = 0;
    const executor = createWoodcuttingExecutorForTesting({
      observe: () => ({ resources: f.snapshot().resources, woodcutting: wc }),
      selectTree: treeId => { wc.isActive = true; wc.activeTreeIds = [treeId];
        f.game.activeAction = { id: SKILL, isActive: true, activeSkills: [{ id: SKILL }] }; },
      stop: () => { stopCalls++; wc.isActive = false; wc.activeTreeIds = []; f.game.activeAction = undefined; return true; }
    });
    executor.start({ version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true });
    assert.equal((await executor.execute({ id: f.task.id, kind: 'woodcutting-start', treeId: 'Normal' })).status, 'verified');
    const first = run(f); if (complete) f.quantity(10);
    const decision = run(f, first.checkpoint, { nowMs: complete ? 1 : 1000 });
    assert.equal(decision.status, complete ? 'complete' : 'blocked');
    if (decision.stopRequired) assert.equal((await executor.stop()).cleanup, 'stopped-verified');
    assert.equal(stopCalls, 1); assert.equal(wc.isActive, false);
  }
});

test('manual action switch asks for replan and mock executor does not stop the player action', async () => {
  const f = fixture(); f.game.activeAction = undefined;
  const wc = { supported: true, skillId: SKILL, unlocked: true, isActive: false, canStop: true, activeTreeIds: [],
    trees: [{ id: 'Normal', unlocked: true, outputIds: ['Logs'], outputsEvidence: 'confirmed' }] };
  let stopCalls = 0;
  const executor = createWoodcuttingExecutorForTesting({ observe: () => ({ resources: f.snapshot().resources, woodcutting: wc }),
    selectTree: () => { wc.isActive = true; wc.activeTreeIds = ['Normal']; f.game.activeAction = { id: SKILL, isActive: true, activeSkills: [ {id: SKILL} ] }; },
    stop: () => { stopCalls++; return true; } });
  executor.start({ version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true });
  await executor.execute({ id: f.task.id, kind: 'woodcutting-start', treeId: 'Normal' }); const first = run(f);
  wc.isActive = false; wc.activeTreeIds = []; f.game.activeAction = { id: 'Mining', isActive: true, activeSkills: [] };
  const outcome = run(f, first.checkpoint, { nowMs: 1 }); assert.equal(outcome.reason, 'expected-action-changed');
  assert.equal((await executor.stop()).cleanup, 'other-action-not-owned'); assert.equal(stopCalls, 0);
});
