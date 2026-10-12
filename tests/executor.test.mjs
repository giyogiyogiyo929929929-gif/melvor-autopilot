import test from 'node:test';
import assert from 'node:assert/strict';
import { createWoodcuttingExecutor, createWoodcuttingExecutorForTesting } from '../src/executor.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';

const session = { version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true };
const command = (id = 'task-1', treeId = 'Normal') => ({ id, kind: 'woodcutting-start', treeId });
const SKILL = 'melvorF:Woodcutting';
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
const flush = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setImmediate(resolve)); };

function fixture(options) {
  const logs = { id: 'Logs' };
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false,
    activeAction: undefined, pausedAction: undefined,
    bank: { items: new Map([[logs, { item: logs, quantity: 1 }]]), lockedItems: new Set(), occupiedSlots: 1, maximumSlots: 10 },
    currencies: { allObjects: [{ id: 'GP', amount: 10 }] }, combat: { player: { selectedEquipmentSet: 0,
      equipmentSets: [{ equipment: { equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Sword' }, quantity: 1, isEmpty: false }] } }] } }
  };
  const wc = { supported: true, skillId: SKILL, unlocked: true, isActive: false, canStop: true, activeTreeIds: [],
    trees: [{ id: 'Normal', unlocked: true, outputIds: ['Logs', 'Gem'], outputsEvidence: 'confirmed' },
      { id: 'Oak', unlocked: true, outputIds: ['OakLogs'], outputsEvidence: 'confirmed' }] };
  const state = { calls: { observe: 0, select: 0, stop: 0 }, game, wc };
  state.runTree = treeId => { wc.isActive = true; wc.activeTreeIds = [treeId];
    game.activeAction = { id: SKILL, isActive: true, activeSkills: [{ id: SKILL }] }; };
  state.ports = { observe: async () => { state.calls.observe++; return {
    resources: readResourcesForTesting(game, { version: 'v1.3.1' }), woodcutting: wc }; },
  selectTree: async treeId => { state.calls.select++; state.runTree(treeId); },
  stop: async () => { state.calls.stop++; wc.isActive = false; wc.activeTreeIds = []; game.activeAction = undefined; return true; } };
  state.executor = createWoodcuttingExecutorForTesting(state.ports, options);
  state.start = () => state.executor.start(session);
  return state;
}

test('runtime operations remain disabled despite flags and do not touch game or options getters', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  const executor = createWoodcuttingExecutor(forbidden, forbidden);
  assert.equal(executor.start(session).reason, 'runtime-operation-unverified');
  assert.equal((await executor.execute(command())).reason, 'runtime-operation-unverified');
  assert.equal((await executor.stop()).status, 'stopped');
  assert.equal(executor.getState().status, 'stopped');
});

test('default stopped and session gates forbid observation and operations', async () => {
  const f = fixture(); assert.equal((await f.executor.execute(command())).reason, 'executor-stopped');
  for (const key of Object.keys(session)) {
    assert.equal(f.executor.start({ ...session, [key]: null }).reason, 'session-preconditions-unverified');
  }
  assert.deepEqual(f.calls, { observe: 0, select: 0, stop: 0 });
});

test('precondition, single normal selection and postcondition produce a checkpoint', async () => {
  const f = fixture(); f.start();
  const outcome = await f.executor.execute(command());
  assert.equal(outcome.status, 'verified'); assert.equal(outcome.reason, 'target-action-confirmed');
  assert.deepEqual(f.calls, { observe: 2, select: 1, stop: 0 });
  assert.deepEqual(f.executor.getState().checkpoints, [{ id: 'task-1', treeId: 'Normal', phase: 'verified' }]);
  assert.equal(outcome.runnable, false);
});

test('already running target is not toggled and its manual action is not adopted for stopping', async () => {
  const f = fixture(); f.runTree('Normal'); f.start();
  assert.equal((await f.executor.execute(command())).reason, 'already-running');
  await f.executor.stop();
  assert.equal(f.calls.select, 0); assert.equal(f.calls.stop, 0); assert.equal(f.wc.isActive, true);
});

test('same command ID cannot toggle twice, change target or be forgotten on session restart', async () => {
  const f = fixture(); f.start(); await f.executor.execute(command());
  assert.equal((await f.executor.execute(command())).reason, 'duplicate-command');
  assert.equal((await f.executor.execute(command('task-1', 'Oak'))).reason, 'command-id-conflict');
  await f.executor.stop(); f.start();
  assert.equal((await f.executor.execute(command())).reason, 'duplicate-command');
  assert.equal(f.calls.select, 1);
});

test('only woodcutting-start with bounded IDs is allowlisted', async () => {
  const f = fixture(); f.start();
  for (const c of [null, {}, { ...command(), kind: 'award-xp' }, command('', 'Normal'), command('a', 'x'.repeat(1025))])
    assert.equal((await f.executor.execute(c)).reason, 'command-not-allowlisted');
  assert.equal(f.calls.observe, 0);
});

test('other action, other trees, paused game and leftover idle selections are refused', async () => {
  for (const modify of [f => { f.runTree('Oak'); }, f => { f.runTree('Normal'); f.wc.activeTreeIds.push('Oak'); },
    f => { f.game.activeAction = { id: 'Mining', isActive: true, activeSkills: [{ id: 'Mining' }] }; },
    f => { f.game.isPaused = true; }, f => { f.game.pausedAction = { id: SKILL, isActive: false, activeSkills: [] }; },
    f => { f.wc.activeTreeIds = ['Normal']; }]) {
    const f = fixture(); modify(f); f.start();
    assert.equal((await f.executor.execute(command())).status, 'blocked');
    assert.equal(f.calls.select, 0); assert.equal(f.calls.stop, 0);
  }
});

test('all possible new product stacks must fit, even when primary output is already held', async () => {
  const f = fixture(); f.game.bank.maximumSlots = 1; f.start();
  assert.equal((await f.executor.execute(command())).reason, 'bank-capacity-insufficient');
  assert.equal(f.calls.select, 0);
  f.wc.trees[0].outputIds = ['Logs'];
  assert.equal((await f.executor.execute(command())).status, 'verified');
});

test('missing output evidence, tree unlock, stop capability or resource category refuse writes', async () => {
  for (const modify of [f => { f.wc.trees[0].outputIds = null; }, f => { f.wc.trees[0].outputsEvidence = 'unknown'; },
    f => { f.wc.trees[0].outputIds.push('Logs'); }, f => { f.wc.trees[0].unlocked = false; },
    f => { f.wc.unlocked = false; }, f => { f.wc.canStop = false; }, f => { f.game.currencies = null; },
    f => { f.wc.supported = false; }, f => { f.wc.activeTreeIds = null; }]) {
    const f = fixture(); modify(f); f.start();
    assert.equal((await f.executor.execute(command())).status, 'blocked'); assert.equal(f.calls.select, 0);
  }
});

test('read failure retries once and no operation is retried', async () => {
  const f = fixture(); const observe = f.ports.observe; let calls = 0;
  f.ports.observe = async () => { if (++calls === 1) throw new Error('transient'); return observe(); };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  assert.equal((await f.executor.execute(command())).status, 'verified'); assert.equal(calls, 3); assert.equal(f.calls.select, 1);
  const g = fixture(); g.ports.observe = async () => { g.calls.observe++; throw new Error('private-save'); };
  g.executor = createWoodcuttingExecutorForTesting(g.ports); g.start();
  const result = await g.executor.execute(command());
  assert.equal(result.reason, 'observation-unavailable'); assert.equal(g.calls.observe, 2); assert.equal(g.calls.select, 0);
  assert.ok(!JSON.stringify(result).includes('private-save'));
});

test('operation exceptions stop and reconcile owned action without a retry', async () => {
  const f = fixture(); f.ports.selectTree = async id => { f.calls.select++; f.runTree(id); throw new Error('save-secret'); };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  const outcome = await f.executor.execute(command());
  assert.equal(outcome.reason, 'operation-outcome-unknown'); assert.equal(outcome.cleanup, 'stopped-verified');
  assert.equal(f.calls.select, 1); assert.equal(f.calls.stop, 1); assert.equal(f.wc.isActive, false);
  assert.equal(f.start().reason, 'manual-review-required'); assert.equal(f.executor.getState().checkpoints[0].phase, 'failed');
  assert.ok(!JSON.stringify(outcome).includes('save-secret'));
});

test('postcondition mismatches stop and do not accept changed currency, equipment or lost inventory', async () => {
  for (const alter of [f => { f.game.currencies.allObjects[0].amount++; },
    f => { f.game.combat.player.equipmentSets[0].equipment.equippedArray[0].item.id = 'Other'; },
    f => { f.game.bank.items.clear(); f.game.bank.occupiedSlots = 0; },
    f => { f.game.currentGamemode.id = 'Other'; }, f => { f.wc.trees[0].unlocked = false; }]) {
    const f = fixture(); f.ports.selectTree = async id => { f.calls.select++; f.runTree(id); alter(f); };
    f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
    const outcome = await f.executor.execute(command());
    assert.equal(outcome.status, 'stopped'); assert.equal(outcome.cleanup, 'stopped-verified');
    assert.equal(f.wc.isActive, false); assert.equal(f.executor.getState().requiresReview, true);
  }
});

test('natural gathering quantity increases do not fail postcondition', async () => {
  const f = fixture(); f.ports.selectTree = async id => {
    f.calls.select++; f.runTree(id); [...f.game.bank.items.values()][0].quantity++;
  };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  assert.equal((await f.executor.execute(command())).status, 'verified'); assert.equal(f.calls.stop, 0);
});

test('no target activation is a failure and never triggers repeated selection', async () => {
  const f = fixture(); f.ports.selectTree = async () => { f.calls.select++; };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  assert.equal((await f.executor.execute(command())).reason, 'target-action-not-confirmed');
  assert.equal(f.calls.select, 1); assert.equal(f.calls.stop, 0);
});

test('emergency stop invalidates a pending precondition read before any selection', async () => {
  const f = fixture(); const gate = deferred(); const observe = f.ports.observe;
  f.ports.observe = async () => { await gate.promise; return observe(); };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  const operation = f.executor.execute(command()); await flush();
  const stopped = f.executor.stop(); assert.equal(f.executor.getState().status, 'stopped');
  gate.resolve(); await stopped;
  assert.equal((await operation).reason, 'stopped-before-operation'); assert.equal(f.calls.select, 0);
});

test('concurrent commands and restart are rejected while an operation is in flight', async () => {
  const f = fixture(); const gate = deferred(); f.ports.selectTree = async id => { await gate.promise; f.calls.select++; f.runTree(id); };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  const first = f.executor.execute(command()); await flush();
  assert.equal((await f.executor.execute(command('second'))).reason, 'executor-busy');
  assert.equal(f.start().reason, 'executor-busy'); gate.resolve(); assert.equal((await first).status, 'verified');
  assert.equal(f.calls.select, 1);
});

test('stop during delayed mutation cleans up its late activation without reporting success', async () => {
  const f = fixture(); const gate = deferred(); f.ports.selectTree = async id => { await gate.promise; f.calls.select++; f.runTree(id); };
  f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
  const operation = f.executor.execute(command()); await flush();
  const stopping = await f.executor.stop();
  assert.equal(stopping.cleanup, 'operation-still-pending'); assert.equal(f.executor.getState().status, 'stopped');
  gate.resolve(); const outcome = await operation; await flush();
  assert.equal(outcome.status, 'cancelled'); assert.equal(f.wc.isActive, false); assert.equal(f.calls.stop, 1);
});

test('timeout stops session and tracks a late callback until it is cleaned up', async () => {
  const f = fixture({ timeoutMs: 10 }); const gate = deferred();
  f.ports.selectTree = async id => { await gate.promise; f.calls.select++; f.runTree(id); };
  f.executor = createWoodcuttingExecutorForTesting(f.ports, { timeoutMs: 10 }); f.start();
  const outcome = await f.executor.execute(command());
  assert.equal(outcome.reason, 'operation-outcome-unknown'); assert.equal(f.executor.getState().pendingMutation, true);
  assert.equal(f.start().reason, 'executor-busy'); gate.resolve(); await flush();
  assert.equal(f.wc.isActive, false); assert.equal(f.calls.select, 1); assert.equal(f.calls.stop, 1);
  assert.equal(f.executor.getState().pendingMutation, false); assert.equal(f.start().reason, 'manual-review-required');
});

test('timeout on reading stops without issuing a write', async () => {
  const f = fixture(); f.ports.observe = () => new Promise(() => {});
  f.executor = createWoodcuttingExecutorForTesting(f.ports, { timeoutMs: 5 }); f.start();
  assert.equal((await f.executor.execute(command())).reason, 'observation-unavailable'); assert.equal(f.calls.select, 0);
});

test('stop never interrupts another player action and records required review', async () => {
  const f = fixture(); f.start(); await f.executor.execute(command());
  f.wc.isActive = false; f.wc.activeTreeIds = []; f.game.activeAction = { id: 'Mining', isActive: true, activeSkills: [] };
  const outcome = await f.executor.stop(); assert.equal(outcome.cleanup, 'other-action-not-owned');
  assert.equal(f.calls.stop, 0); assert.equal(f.start().reason, 'manual-review-required');
});

test('stop capability, callback result, exception and postcondition failures remain stopped', async () => {
  for (const alter of [f => { f.wc.canStop = false; }, f => { f.ports.stop = async () => false; },
    f => { f.ports.stop = async () => { throw new Error('private'); }; }, f => { f.ports.stop = async () => true; }]) {
    const f = fixture(); alter(f); f.executor = createWoodcuttingExecutorForTesting(f.ports); f.start();
    // Starting requires canStop, so simulate loss of capability after activation.
    if (!f.wc.canStop) { f.wc.canStop = true; await f.executor.execute(command()); f.wc.canStop = false; }
    else await f.executor.execute(command());
    const outcome = await f.executor.stop(); assert.equal(outcome.status, 'stopped');
    assert.ok(['stop-not-allowed', 'stop-not-confirmed', 'stop-outcome-unknown', 'stop-postcondition-failed'].includes(outcome.cleanup));
    assert.equal(f.executor.getState().requiresReview, true);
  }
});

test('checkpoint bounds refuse new writes instead of evicting duplicate protection', async () => {
  const f = fixture({ maxCheckpoints: 1 }); f.start(); await f.executor.execute(command());
  assert.equal((await f.executor.execute(command('new'))).reason, 'checkpoint-limit'); assert.equal(f.calls.select, 1);
  assert.equal(f.executor.getState().checkpoints.length, 1);
});

test('executor snapshots and checkpoint output are detached from mutable inputs', async () => {
  const f = fixture(); const input = command(); f.start();
  const action = f.executor.execute(input); input.treeId = 'Oak'; await action;
  const state = f.executor.getState(); state.checkpoints[0].treeId = 'Changed';
  assert.deepEqual(f.wc.activeTreeIds, ['Normal']); assert.equal(f.executor.getState().checkpoints[0].treeId, 'Normal');
});
