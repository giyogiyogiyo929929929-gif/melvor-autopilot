import test from 'node:test';
import assert from 'node:assert/strict';
import { createAutopilotController, createAutopilotControllerForTesting } from '../src/controller.mjs';
import { createWoodcuttingExecutorForTesting } from '../src/executor.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
import { generateCompletionCandidates } from '../setup.mjs';
import { decodeControllerRecord } from '../src/controller-record.mjs';
import { readResourceTargetsForTesting } from '../src/resource-targets.mjs';
const SKILL = 'melvorF:Woodcutting';
const session = { version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true };
const ctx = (nowMs = 0, extra = {}) => ({ nowMs, sessionId: 'session', ...extra });
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
function fixture(options = {}, memory = { value: null }, scenario = {}) {
  const targets = scenario.targets ?? ['A', 'B'];
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false,
    activeAction: undefined, pausedAction: undefined, bank: { items: new Map(), lockedItems: new Set(), occupiedSlots: 0, maximumSlots: 20 },
    currencies: { allObjects: [{ id: 'GP', amount: 100 }] }, combat: { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: {
      equippedArray: [{ slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } } };
  if (scenario.bankCapacity !== undefined) game.bank.maximumSlots = scenario.bankCapacity;
  const state = { game, memory, found: new Set(), offline: false, selects: 0, stops: 0, observations: 0, writes: [], badAction: false, commands: [] };
  const wc = { supported: true, skillId: SKILL, unlocked: true, isActive: false, canStop: true, activeTreeIds: [],
    trees: targets.map(id => ({ id, unlocked: true, outputIds: [id], outputsEvidence: 'confirmed' })) };
  state.wc = wc;
  state.resources = () => readResourcesForTesting(game, { version: 'v1.3.1' });
  state.frame = () => {
    const all = targets.map(id => ({ id, current: state.found.has(id) ? 1 : 0, maximum: 1, accessible: null }));
    const categories = Object.fromEntries(['skills', 'mastery', 'items', 'monsters', 'pets'].map(category => [category,
      { supported: true, status: 'observed', current: category === 'items' ? state.found.size : 0, maximum: category === 'items' ? targets.length : 0,
        percent: category === 'items' && targets.length ? state.found.size * 100 / targets.length : 0, entries: category === 'items' ? structuredClone(all) : [],
        missing: category === 'items' ? all.filter(entry => entry.current < entry.maximum).map(entry => ({ ...entry })) : [] }]));
    const snapshot = { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: { supported: true,
      scopes: [{ id: 'base', ownership: true, supported: true, categories }] } };
    if (scenario.wholeCompletion) {
      snapshot.completion.status = 'observed'; snapshot.completion.scopes[0].status = 'observed';
      snapshot.completion.scopes[0].percent = targets.length ? state.found.size * 100 / targets.length : 0;
      snapshot.completion.scopes.push(...['toth', 'aod', 'ita'].map(id => ({ id, ownership: false })));
    }
    const candidates = generateCompletionCandidates(snapshot).candidates, sid = candidate => JSON.stringify([candidate.id, 'work']);
    return { completionSnapshot: snapshot, resources: state.resources(), offline: state.offline, woodcutting: wc,
      actionSelection: { supported: true, actionId: SKILL, selectionIds: [...wc.activeTreeIds] },
      graph: { nodes: candidates.map(candidate => ({ id: candidate.id, scopeId: 'base', completed: false, evidence: 'confirmed',
        routes: [{ id: 'work', requires: [], kind: 'noncombat', risk: 'safe', evidence: 'confirmed', durationMs: 1 }] })) },
      estimates: candidates.map(candidate => ({ stepId: sid(candidate), evidence: 'confirmed', completionGain: 0.1,
        unlockValue: 0, consumptionCost: 0, reliability: 1, deathProbability: 0 })),
      model: { steps: candidates.map(candidate => ({ stepId: sid(candidate), type: 'production', evidence: 'confirmed', demands: [{ id: candidate.targetId, quantity: 1 }], allowedRecipeIds: targets })),
        recipes: targets.map(id => ({ id, scopeId: 'base', evidence: 'confirmed', unlocked: true, kind: 'noncombat', risk: 'safe',
          costEvidence: 'fixed', bankOrder: 'consume-then-produce', outputs: [{ id, quantity: 1 }], itemCosts: [], currencyCosts: [], possibleOutputIds: [id], durationMs: 1000 })),
        recipeActions: targets.map(id => ({ recipeId: id, evidence: 'confirmed', action: { id: state.badAction && id === 'A' ? 'Smithing' : SKILL, selectionIds: [id] },
          costPerBatch: 0, reliabilityPerBatch: 1 })) } };
  };
  state.collect = id => { const item = { id }; game.bank.items.set(item, { item, quantity: 1 }); game.bank.occupiedSlots = game.bank.items.size; state.found.add(id); };
  state.ports = { observe: () => { state.observations++; return state.frame(); },
    store: { read: () => memory.value, write: value => { state.writes.push(value); memory.value = value; } },
    executor: createWoodcuttingExecutorForTesting({ observe: state.frame,
      selectTree: id => { state.selects++; assert.equal(decodeControllerRecord(memory.value).ledger.at(-1).phase, 'attempted');
        state.commands.push({ id: decodeControllerRecord(memory.value).activeCommandId, treeId: id, epoch: decodeControllerRecord(memory.value).planEpoch });
        wc.isActive = true; wc.activeTreeIds = [id]; game.activeAction = { id: SKILL, isActive: true, activeSkills: [] }; },
      stop: () => { state.stops++; wc.isActive = false; wc.activeTreeIds = []; game.activeAction = undefined; return true; } }) };
  state.controller = createAutopilotControllerForTesting(state.ports, { runId: 'run', ...options });
  state.start = () => state.controller.start(session, ctx());
  return state;
}

test('runtime entry refuses all ports and persisted flags without touching getters', async () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } });
  const controller = createAutopilotController(forbidden, forbidden);
  assert.equal((await controller.start(session, ctx())).reason, 'runtime-controller-unverified');
  assert.equal((await controller.step(ctx())).reason, 'runtime-controller-unverified');
  assert.equal((await controller.stop()).status, 'stopped'); assert.equal(controller.exportCheckpoint(), null);
  assert.equal(controller.getReport(), null);
});

test('completion report uses whole observation and current step journal without persisting snapshots', async () => {
  const f = fixture(); assert.equal(f.controller.getReport(), null);
  const originalFrame = f.frame;
  f.frame = () => {
    const frame = originalFrame(), scope = frame.completionSnapshot.completion.scopes[0];
    frame.completionSnapshot.completion.status = 'observed';
    scope.status = 'observed'; scope.percent = f.found.size * 50;
    frame.completionSnapshot.completion.scopes.push(...['toth', 'aod', 'ita'].map(id => ({ id, ownership: false })));
    return frame;
  };
  await f.start(); await f.controller.step(ctx(1));
  const report = f.controller.getReport(); assert.equal(report.audit.missingCount, 2); assert.equal(report.progress.status, 'baseline');
  assert.ok(report.causes.some(value => value.reason === 'action-confirmed'));
  f.collect('A'); await f.controller.step(ctx(2));
  assert.equal(f.controller.getReport().progress.status, 'progressing');
  assert.ok(f.controller.getReport().causes.some(value => value.reason === 'end-conditions-satisfied'));
  report.audit.missingCount = 999; assert.equal(f.controller.getReport().audit.missingCount, 1);
  const saved = JSON.parse(f.controller.exportCheckpoint()); assert.equal(saved.report, undefined); assert.equal(saved.completionSnapshot, undefined);
  assert.equal(saved.checkpoint, undefined); assert.equal(f.controller.getReport().actualComplete, false);
  await f.controller.stop(); await f.controller.start(session, ctx(3)); assert.equal(f.controller.getReport(), null);
  await f.controller.step(ctx(4)); assert.equal(f.controller.getReport().progress.status, 'baseline');
  await f.controller.step(ctx(5, { sessionId: 'other' })); assert.equal(f.controller.getReport(), null);
});
test('default stopped and invalid start permissions issue no observation or write', async () => {
  const f = fixture(); assert.equal((await f.controller.step(ctx())).reason, 'controller-stopped');
  assert.equal((await f.controller.start({ ...session, saveCopy: false }, ctx())).reason, 'session-preconditions-unverified');
  assert.equal(f.observations, 0); assert.equal(f.writes.length, 0);
});
test('autonomous planning, durable attempt, monitoring, stop and fresh replan are connected', async () => {
  const f = fixture(); assert.equal((await f.start()).status, 'planning');
  assert.equal((await f.controller.step(ctx(1))).status, 'monitoring'); assert.equal(f.selects, 1);
  assert.equal((await f.controller.step(ctx(2))).status, 'monitoring'); assert.equal(f.selects, 1);
  f.collect('A'); assert.equal((await f.controller.step(ctx(3))).status, 'planning'); assert.equal(f.stops, 1);
  assert.equal((await f.controller.step(ctx(4))).status, 'monitoring'); assert.equal(f.selects, 2);
  assert.equal(f.controller.getState().planEpoch, 2); assert.ok(f.controller.getState().activeCandidateId.includes('B'));
});
test('unsupported high-ranked action is filtered so a supported candidate can proceed', async () => {
  const f = fixture(); f.badAction = true; await f.start();
  assert.equal((await f.controller.step(ctx(1))).status, 'monitoring');
  assert.ok(f.controller.getState().activeCandidateId.includes('B')); assert.equal(f.selects, 1);
});
test('valid work continues without repeated command issuance or efficiency switching', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1));
  for (let time = 2; time < 30; time++) await f.controller.step(ctx(time));
  assert.equal(f.selects, 1); assert.equal(f.stops, 0); assert.ok(f.controller.getState().journal.suppressed > 0);
});
test('manual stop is durable and a new instance never resumes automatically', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1)); await f.controller.stop();
  assert.equal(f.controller.getState().status, 'stopped'); assert.equal(f.stops, 1);
  const next = fixture({}, f.memory); assert.equal(next.controller.getState().status, 'stopped');
  assert.equal((await next.controller.step(ctx(2))).reason, 'controller-stopped'); assert.equal(next.observations, 0);
  assert.equal((await next.controller.start(session, ctx(2))).status, 'planning');
  await next.controller.step(ctx(3)); assert.equal(next.controller.getState().planEpoch, 2);
});
test('unfinished or active restored command requires review rather than a duplicate operation', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1));
  const restored = fixture({}, f.memory); const started = await restored.controller.start(session, ctx(2));
  assert.equal(started.reason, 'checkpoint-unresolved'); assert.equal(restored.selects, 0); assert.equal(restored.observations, 0);
});
test('retired commands compact to a durable epoch watermark without reusing IDs', async () => {
  const f = fixture({ ledgerLimit: 1 }); await f.start(); await f.controller.step(ctx(1)); f.collect('A'); await f.controller.step(ctx(2));
  await f.controller.step(ctx(3)); const saved = decodeControllerRecord(f.memory.value);
  assert.equal(saved.retiredThrough, 1); assert.equal(saved.planEpoch, 2); assert.equal(saved.ledger.length, 1);
  assert.equal(saved.ledger[0].epoch, 2);
});
test('offline progress requests no stop or reward generation and return requires reobservation', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1)); f.offline = true;
  assert.equal((await f.controller.step(ctx(2))).status, 'offline'); assert.equal(f.stops, 0); assert.equal(f.selects, 1);
  f.offline = false; assert.equal((await f.controller.step(ctx(3))).status, 'planning'); assert.equal(f.stops, 1);
});
test('changed session abandons ownership without stopping the new character', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1));
  const outcome = await f.controller.step(ctx(2, { sessionId: 'other' }));
  assert.equal(outcome.reason, 'session-changed'); assert.equal(f.stops, 0); assert.equal(f.controller.getState().requiresReview, true);
});
test('clock reversal and malformed offline context safely stop', async () => {
  for (const bad of [ctx(0), ctx(2, { offline: null })]) {
    const f = fixture(); await f.start(); await f.controller.step(ctx(1));
    const outcome = await f.controller.step(bad); assert.equal(outcome.status, 'blocked'); assert.equal(f.stops, 1);
  }
});
test('stagnation stops the owned action and does not loop into a new command', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1)); await f.controller.step(ctx(2));
  await f.controller.step(ctx(30_000));
  assert.equal((await f.controller.step(ctx(60_002))).reason, 'monitor-blocked'); assert.equal(f.stops, 1);
  assert.equal((await f.controller.step(ctx(60_003))).reason, 'controller-stopped'); assert.equal(f.selects, 1);
});
test('analysis failure advances windows finitely instead of claiming completion', async () => {
  const f = fixture({ maxIdleWindows: 2 }); f.ports.observe = () => { const frame = f.frame(); frame.model.recipeActions = []; return frame; };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run', maxIdleWindows: 2 }); await f.start();
  assert.equal((await f.controller.step(ctx(1))).status, 'planning');
  assert.equal((await f.controller.step(ctx(2))).reason, 'scan-limit'); assert.equal(f.selects, 0);
});
test('stop while observation is pending prevents the selected command from executing later', async () => {
  const f = fixture(); const gate = deferred(); f.ports.observe = async () => { await gate.promise; return f.frame(); };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  const step = f.controller.step(ctx(1)); await flush(); await f.controller.stop(); gate.resolve();
  assert.equal((await step).status, 'cancelled'); assert.equal(f.selects, 0); assert.equal(f.controller.getState().status, 'stopped');
});
test('writes remain serialized when stopped during a pending pre-operation checkpoint', async () => {
  const f = fixture(); const gate = deferred(); let writes = 0;
  f.ports.store.write = async value => { if (++writes === 2) await gate.promise; f.memory.value = value; f.writes.push(value); };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  const step = f.controller.step(ctx(1)); await flush(); const stop = f.controller.stop(); await flush();
  assert.equal(f.controller.getState().status, 'stopped'); assert.equal(f.selects, 0); gate.resolve();
  await Promise.all([step, stop]); assert.equal(f.selects, 0);
  assert.equal(decodeControllerRecord(f.memory.value).activeCommandId, null);
  assert.equal(decodeControllerRecord(f.memory.value).journal.entries.at(-1).event, 'user-stop');
});
test('stop during checkpoint initialization never overwrites old duplicate protection', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1)); await f.controller.stop(); const saved = f.memory.value;
  const next = fixture({}, f.memory); const gate = deferred(); next.ports.store.read = async () => { await gate.promise; return saved; };
  next.controller = createAutopilotControllerForTesting(next.ports, { runId: 'run' });
  const start = next.controller.start(session, ctx(2)); await flush(); await next.controller.stop(); gate.resolve();
  assert.equal((await start).status, 'cancelled'); assert.equal(f.memory.value, saved); assert.equal(next.selects, 0);
});
test('observation/store exceptions are masked and no command follows failed durable attempt', async () => {
  const f = fixture(); let writes = 0; f.ports.store.write = value => { if (++writes === 2) throw new Error('private-save-token'); f.memory.value = value; };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  const failed = await f.controller.step(ctx(1)); assert.equal(failed.status, 'blocked'); assert.equal(f.selects, 0);
  assert.ok(!JSON.stringify(f.controller.getState()).includes('private-save-token'));
  const g = fixture(); g.ports.observe = () => { throw new Error('credential'); };
  g.controller = createAutopilotControllerForTesting(g.ports, { runId: 'run' }); await g.start();
  assert.equal((await g.controller.step(ctx(1))).reason, 'observation-failed'); assert.equal(g.selects, 0);
});
test('concurrent steps and repeated start are rejected without an extra operation', async () => {
  const f = fixture(); await f.start(); const gate = deferred(); f.ports.observe = async () => { await gate.promise; return f.frame(); };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  const one = f.controller.step(ctx(1)); await flush();
  assert.equal((await f.controller.step(ctx(1))).reason, 'controller-busy'); gate.resolve(); await one;
  assert.equal((await f.start()).reason, 'controller-already-started'); assert.equal(f.selects, 1);
});
test('record and state outputs are detached and no whole frame or error data is persisted', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1));
  const state = f.controller.getState(); state.journal.entries[0].reason = 'tampered';
  assert.notEqual(f.controller.getState().journal.entries[0].reason, 'tampered');
  const stored = JSON.parse(f.memory.value); assert.equal(stored.running, false);
  assert.ok(!('resources' in stored)); assert.ok(!('snapshot' in stored)); assert.ok(!('model' in stored));
});

test('storage timeout keeps the real write pending so a newer stop checkpoint always wins', async () => {
  const f = fixture(); const gate = deferred(); let calls = 0;
  f.ports.store.write = async value => { if (++calls === 1) await gate.promise; f.memory.value = value; };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run', timeoutMs: 50 });
  assert.equal((await f.start()).reason, 'store-failed');
  const stopping = await f.controller.stop(); assert.equal(stopping.status, 'stopped'); assert.equal(f.selects, 0);
  gate.resolve(); await flush();
  const saved = decodeControllerRecord(f.memory.value); assert.equal(saved.running, false); assert.equal(saved.requiresReview, true);
  assert.equal(saved.journal.entries.at(-1).event, 'user-stop');
});

test('late mutation after user stop is cancelled, cleaned up and never restarts the controller', async () => {
  const f = fixture(); const gate = deferred();
  f.ports.executor = createWoodcuttingExecutorForTesting({ observe: f.frame,
    selectTree: async id => { await gate.promise; f.selects++; f.wc.isActive = true; f.wc.activeTreeIds = [id];
      f.game.activeAction = { id: SKILL, isActive: true, activeSkills: [] }; },
    stop: () => { f.stops++; f.wc.isActive = false; f.wc.activeTreeIds = []; f.game.activeAction = undefined; return true; } });
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  const step = f.controller.step(ctx(1)); await flush(); await f.controller.stop();
  assert.equal(f.controller.getState().status, 'stopped'); gate.resolve(); assert.equal((await step).status, 'cancelled'); await flush();
  assert.equal(f.wc.isActive, false); assert.equal(f.stops, 1); assert.equal(f.controller.getState().status, 'stopped');
  assert.equal(f.controller.getState().requiresReview, true); assert.equal(decodeControllerRecord(f.memory.value).requiresReview, true);
});

test('cleanup failures and manual action changes require review without interrupting another action', async () => {
  const f = fixture(); await f.start(); await f.controller.step(ctx(1));
  f.game.activeAction = { id: 'Mining', isActive: true, activeSkills: [] }; f.wc.isActive = false; f.wc.activeTreeIds = [];
  const outcome = await f.controller.step(ctx(2));
  assert.equal(outcome.reason, 'cleanup-failed'); assert.equal(f.stops, 0); assert.equal(f.controller.getState().requiresReview, true);
});

test('malformed restored checkpoints and observation timeouts issue no new command', async () => {
  const f = fixture({}, { value: '{"schema":1,"running":true}' });
  assert.equal((await f.start()).reason, 'checkpoint-invalid'); assert.equal(f.selects, 0);
  const g = fixture(); g.ports.observe = () => new Promise(() => {});
  g.controller = createAutopilotControllerForTesting(g.ports, { runId: 'run', timeoutMs: 50 }); await g.start();
  assert.equal((await g.controller.step(ctx(1))).reason, 'observation-failed'); assert.equal(g.selects, 0);
});

test('total step budgets halt a long waiting session without claiming Completion', async () => {
  const f = fixture({ maxSteps: 2 }); await f.start(); await f.controller.step(ctx(1)); await f.controller.step(ctx(2));
  assert.equal((await f.controller.step(ctx(3))).reason, 'step-limit'); assert.equal(f.stops, 1);
  assert.ok(!('achieved' in f.controller.getState()));
});
test('controller requests planning then lightweight monitoring and fresh planning after completion', async () => {
  const f = fixture(), requests = [];
  f.ports.observe = request => {
    requests.push({ ...request }); assert.equal(Object.isFrozen(request), true);
    const frame = f.frame(); if (request.phase === 'monitoring') { delete frame.graph; delete frame.model; delete frame.estimates; }
    return frame;
  };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  await f.controller.step(ctx(1)); await f.controller.step(ctx(2)); f.collect('A'); await f.controller.step(ctx(3)); await f.controller.step(ctx(4));
  assert.deepEqual(requests.map(request => request.phase), ['planning', 'monitoring', 'monitoring', 'planning']);
  assert.equal(f.selects, 2); assert.equal(f.stops, 1); assert.deepEqual(Object.keys(requests[0]).sort(), ['nowMs', 'offline', 'phase', 'sessionId']);
});
test('offline with no active task returns through a fresh planning observation without a sticky flag', async () => {
  const f = fixture(), requests = []; f.offline = true;
  f.ports.observe = request => { requests.push({ ...request }); const frame = f.frame(); if (request.phase === 'monitoring') { delete frame.graph; delete frame.model; delete frame.estimates; } return frame; };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start();
  assert.equal((await f.controller.step(ctx(1, { offline: true }))).status, 'offline'); assert.equal(f.selects, 0);
  f.offline = false; assert.equal((await f.controller.step(ctx(2))).reason, 'fresh-observation-required'); assert.equal(f.selects, 0);
  assert.equal((await f.controller.step(ctx(3))).status, 'monitoring'); assert.equal(f.selects, 1);
  assert.deepEqual(requests.map(request => request.phase), ['monitoring', 'monitoring', 'planning']);
  assert.deepEqual(requests.map(request => request.offline), [true, false, false]);
});
test('offline during active monitoring reobserves lightly, cleans up and requests full planning next', async () => {
  const f = fixture(), requests = [];
  f.ports.observe = request => { requests.push(request.phase); const frame = f.frame(); if (request.phase === 'monitoring') { delete frame.graph; delete frame.model; delete frame.estimates; } return frame; };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start(); await f.controller.step(ctx(1));
  f.offline = true; await f.controller.step(ctx(2)); f.offline = false;
  assert.equal((await f.controller.step(ctx(3))).status, 'planning'); assert.equal(f.stops, 1); assert.equal(f.selects, 1);
  await f.controller.step(ctx(4)); assert.deepEqual(requests, ['planning', 'monitoring', 'monitoring', 'planning']); assert.equal(f.selects, 2);
});
test('active task supplies frozen Completion targets and a partial DTO can complete it without full snapshot', async () => {
  const f = fixture(), requests = [];
  f.ports.observe = request => {
    requests.push(request); const frame = f.frame();
    if (request.targets) {
      assert.equal(Object.isFrozen(request.targets), true); assert.ok(request.targets.every(Object.isFrozen));
      assert.equal(Object.isFrozen(request.resourceTargets), true); assert.equal(Object.isFrozen(request.resourceTargets.itemIds), true);
      assert.equal(request.expectedActionId, SKILL); assert.equal(Object.isFrozen(request.treeIds), true);
      assert.ok(request.resourceTargets.itemIds.includes('A')); assert.deepEqual(request.resourceTargets.currencyIds, []);
      frame.completionSnapshot = null;
      frame.completionTargets = { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, origin: 'mock-only', observationId: 'target-frame',
        coverage: 'targets-only', fullCoverage: false, ownership: { base: true }, targets: request.targets.map(condition => ({ ...condition,
          current: f.found.has(condition.id) ? 1 : 0, maximum: 1, categoryMaximum: 2, accessible: null, supported: true, status: 'observed' })) };
      delete frame.graph; delete frame.model; delete frame.estimates;
    }
    return frame;
  };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start(); await f.controller.step(ctx(1));
  assert.equal(requests[0].targets, undefined); assert.equal((await f.controller.step(ctx(2))).status, 'monitoring');
  assert.equal(requests[1].targets.length, 1); assert.equal(requests[1].targets[0].type, 'completion');
  f.collect('A'); assert.equal((await f.controller.step(ctx(3))).status, 'planning'); assert.equal(f.stops, 1);
  assert.equal(f.controller.getReport().audit.comparable, false); assert.equal(f.controller.getReport().actualComplete, false);
});
test('task-derived partial resources integrate with controller monitoring while executor keeps full pre/post checks', async () => {
  const f = fixture(); f.game.items = { getObjectByID: id => ['A', 'B'].includes(id) ? { id } : undefined };
  f.game.bank.getQty = item => [...f.game.bank.items.values()].find(stack => stack.item.id === item.id)?.quantity ?? 0;
  f.ports.observe = request => {
    const frame = f.frame();
    if (request.resourceTargets) frame.resources = readResourceTargetsForTesting(f.game, request.resourceTargets, { version: 'v1.3.1', observationId: 'resource-frame' });
    return frame;
  };
  f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run' }); await f.start(); await f.controller.step(ctx(1));
  assert.equal((await f.controller.step(ctx(2))).status, 'monitoring'); f.collect('A');
  assert.equal((await f.controller.step(ctx(3))).status, 'planning'); assert.equal(f.selects, 1); assert.equal(f.stops, 1);
});

test('240 autonomous tasks over virtual days survive offline, reload and repeated record rotation', async t => {
  const targets = Array.from({ length: 240 }, (_, i) => `Tree${String(i).padStart(3, '0')}`);
  const options = { ledgerLimit: 3, journal: { maxEntries: 12, maxBytes: 2048 } };
  const f = fixture(options, { value: null }, { targets, bankCapacity: 242, wholeCompletion: true });
  let time = 0, reloads = 0;
  assert.equal((await f.start()).status, 'planning');
  while (f.found.size < targets.length) {
    time += 1000; const started = await f.controller.step(ctx(time));
    assert.equal(started.status, 'monitoring', `target count ${f.found.size}: ${started.reason}`);
    const target = f.wc.activeTreeIds[0], beforeSelects = f.selects;
    assert.ok(!f.found.has(target));
    time += 1000; assert.equal((await f.controller.step(ctx(time))).status, 'monitoring');
    assert.equal(f.selects, beforeSelects); // Valid work is not toggled again.
    if (f.found.size === 80) {
      f.offline = true; time += 1000;
      const stops = f.stops, found = f.found.size;
      assert.equal((await f.controller.step(ctx(time))).status, 'offline');
      assert.equal(f.stops, stops); assert.equal(f.found.size, found);
      time += 7 * 24 * 60 * 60 * 1000;
      assert.equal((await f.controller.step(ctx(time))).status, 'offline');
      assert.equal(f.stops, stops); assert.equal(f.selects, beforeSelects); assert.equal(f.found.size, found);
      // This fixture supplies a game observation; the controller does not generate a reward.
      f.collect(target); f.offline = false; time += 1000;
      assert.equal((await f.controller.step(ctx(time))).status, 'planning');
      assert.equal(f.controller.getReport().progress.status, 'baseline');
    } else {
      f.collect(target); time += 1000;
      assert.equal((await f.controller.step(ctx(time))).status, 'planning');
    }
    const report = f.controller.getReport(), saved = decodeControllerRecord(f.memory.value);
    assert.equal(report.audit.missingCount, targets.length - f.found.size);
    assert.equal(report.actualComplete, false); assert.equal(saved.running, false);
    assert.ok(saved.ledger.length <= 3); assert.ok(saved.journal.entries.length <= 12);
    assert.ok(new TextEncoder().encode(JSON.stringify(saved.journal)).length <= 2048);
    assert.ok(new TextEncoder().encode(JSON.stringify(report)).length <= 65_536);
    assert.equal(saved.activeCommandId, null); assert.ok(saved.ledger.every(entry => entry.phase === 'retired'));
    if ([60, 120, 180].includes(f.found.size)) {
      await f.controller.stop(); const selects = f.selects, observations = f.observations;
      f.controller = createAutopilotControllerForTesting(f.ports, { runId: 'run', ...options }); reloads++;
      time += 1000; assert.equal((await f.controller.step(ctx(time))).reason, 'controller-stopped');
      assert.equal(f.selects, selects); assert.equal(f.observations, observations); assert.equal(f.controller.getReport(), null);
      assert.equal((await f.controller.start(session, ctx(time))).status, 'planning');
    }
  }
  assert.equal(reloads, 3); assert.ok(time > 7 * 24 * 60 * 60 * 1000);
  assert.equal(f.selects, 240); assert.equal(f.stops, 240);
  assert.equal(new Set(f.commands.map(command => command.id)).size, 240);
  assert.equal(new Set(f.commands.map(command => command.treeId)).size, 240);
  assert.deepEqual(f.commands.map(command => command.epoch), Array.from({ length: 240 }, (_, i) => i + 1));
  const saved = decodeControllerRecord(f.memory.value); assert.ok(saved.retiredThrough >= 237); assert.ok(saved.journal.dropped > 0);
  assert.equal(f.controller.getReport().audit.observationComplete, true);
  assert.equal(f.controller.getReport().actualComplete, false);
  time += 1000; await f.controller.step(ctx(time));
  assert.equal(f.selects, 240); assert.equal(f.controller.getReport().actualComplete, false);
  await f.controller.stop();
  t.diagnostic(JSON.stringify({ kind: 'synthetic-only', virtualElapsedMs: time, completedTargets: f.found.size,
    commands: f.selects, uniqueCommands: new Set(f.commands.map(command => command.id)).size, reloads,
    retiredThrough: saved.retiredThrough, droppedJournalEntries: saved.journal.dropped, actualComplete: false }));
});

test('many blocked candidate windows terminate with all missing entries retained in the report', async () => {
  const targets = Array.from({ length: 240 }, (_, i) => `Tree${String(i).padStart(3, '0')}`);
  const f = fixture({ maxIdleWindows: 6 }, { value: null }, { targets, bankCapacity: 242, wholeCompletion: true });
  const originalFrame = f.frame;
  f.frame = () => { const frame = originalFrame(); frame.estimates.forEach(value => value.evidence = 'unknown'); return frame; };
  await f.start();
  for (let i = 1; i <= 6; i++) await f.controller.step(ctx(i * 1000));
  assert.equal(f.controller.getState().reason, 'scan-limit'); assert.equal(f.selects, 0);
  const report = f.controller.getReport(); assert.equal(report.audit.missingCount, 240); assert.equal(report.audit.observationComplete, false);
  assert.equal(report.audit.scopes[0].categories.items.missing.length, 100); assert.equal(report.audit.scopes[0].categories.items.omitted, 140);
  assert.ok(report.causes.some(cause => cause.reason === 'scan-limit')); assert.equal(report.reachability, 'not-proven');
  const observations = f.observations; await f.controller.step(ctx(10_000)); assert.equal(f.observations, observations);
});

test('bank exhaustion after prior successful tasks stops without changing completion or issuing an operation', async () => {
  const targets = Array.from({ length: 12 }, (_, i) => `Tree${String(i).padStart(2, '0')}`);
  const f = fixture({ maxIdleWindows: 2 }, { value: null }, { targets, bankCapacity: 5, wholeCompletion: true });
  await f.start(); let time = 0;
  for (let i = 0; i < 5; i++) {
    assert.equal((await f.controller.step(ctx(++time))).status, 'monitoring');
    f.collect(f.wc.activeTreeIds[0]); assert.equal((await f.controller.step(ctx(++time))).status, 'planning');
  }
  const snapshot = JSON.stringify(f.frame().completionSnapshot);
  await f.controller.step(ctx(++time)); await f.controller.step(ctx(++time));
  assert.equal(f.controller.getState().reason, 'scan-limit'); assert.equal(f.selects, 5); assert.equal(f.stops, 5);
  assert.equal(JSON.stringify(f.frame().completionSnapshot), snapshot); assert.equal(f.controller.getReport().audit.missingCount, 7);
});
