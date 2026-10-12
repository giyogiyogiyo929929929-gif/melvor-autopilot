import test from 'node:test';
import assert from 'node:assert/strict';
import { readActionSelection, readActionSelectionForTesting } from '../src/action-selection.mjs';
import { createWoodcuttingExecutorForTesting } from '../src/executor.mjs';
import { readResourcesForTesting } from '../src/resources.mjs';
const object = (name, extra = {}, namespace = 'melvorF') => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
function fixture() {
  const trees = ['Normal', 'Oak'].map(name => object(name, { product: object(`${name}Logs`) }));
  const wc = object('Woodcutting', { isUnlocked: true, isActive: true, canStop: true, activeTrees: new Set([trees[0]]),
    actions: { getObjectByID: id => trees.find(tree => tree.id === id), get allObjects() { throw new Error('must not scan'); } }, isTreeUnlocked: () => true });
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false, isPaused: false, activeAction: wc, pausedAction: undefined, woodcutting: wc };
  return { game, wc, trees, context: { version: 'v1.3.1', observationId: 'selection-frame', ownership: { base: true, toth: false, aod: false, ita: false },
    expectedActionId: wc.id, treeIds: [trees[0].id] } };
}
const read = f => readActionSelectionForTesting(f.game, f.context);
test('selected trees, executing state, stop ability and partial primary outputs are separate', () => {
  const f = fixture(), result = read(f); assert.equal(result.supported, true); assert.equal(result.actionSelection.state, 'active');
  assert.deepEqual(result.actionSelection.selectionIds, ['melvorF:Normal']); assert.equal(result.woodcutting.isActive, true); assert.equal(result.woodcutting.canStop, true);
  assert.deepEqual(result.woodcutting.trees[0].outputIds, ['melvorF:NormalLogs']); assert.equal(result.woodcutting.trees[0].outputsEvidence, 'unknown');
  assert.equal(result.woodcutting.operationEvidence, 'unknown'); assert.equal(result.runnable, false);
});
test('idle without expected action does not read a skill or pretend its selection is known', () => {
  const f = fixture(); delete f.context.expectedActionId; f.game.activeAction = undefined;
  Object.defineProperty(f.game, 'woodcutting', { get() { throw new Error('must not read'); } });
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.actionSelection.state, 'idle'); assert.equal(result.actionSelection.actionId, null); assert.equal(result.woodcutting, null);
});
test('selection retained while inactive is not execution, and paused action remains explicit', () => {
  const f = fixture(); f.wc.isActive = false; f.game.activeAction = undefined;
  assert.equal(read(f).actionSelection.state, 'selected-inactive'); f.game.pausedAction = f.wc; f.game.isPaused = true;
  const result = read(f); assert.equal(result.actionSelection.state, 'paused'); assert.equal(result.woodcutting.isActive, false);
});
test('another active action is unverified without touching woodcutting when not requested', () => {
  const f = fixture(); delete f.context.expectedActionId; f.game.activeAction = { id: 'melvorF:Thieving', isActive: true };
  Object.defineProperty(f.game, 'woodcutting', { get() { throw new Error('must not read'); } });
  const result = read(f); assert.equal(result.reason, 'action-selector-unverified'); assert.equal(result.actionSelection.actionId, 'melvorF:Thieving');
});
test('wanted tree and multiple active trees are ID looked up and canonically referenced', () => {
  const f = fixture(); f.context.treeIds = [f.trees[1].id]; f.wc.activeTrees.add(f.trees[1]);
  const result = read(f); assert.equal(result.supported, true); assert.equal(result.woodcutting.trees.length, 2); assert.equal(result.woodcutting.activeTreeIds.length, 2);
  f.wc.actions.getObjectByID = () => ({ ...f.trees[0] }); assert.equal(read(f).supported, false);
});
test('unowned or modded selections never read product, unlock or ordinary operations', () => {
  for (const [namespace, isModded] of [['melvorItA', false], ['myMod', true]]) {
    const f = fixture(), tree = object('Other', {}, namespace); tree.isModded = isModded;
    Object.defineProperty(tree, 'product', { get() { throw new Error('PRIVATE'); } }); f.wc.activeTrees = new Set([tree]);
    const result = read(f); assert.equal(result.supported, false); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  }
});
test('bad active/paused/state/set/registry/flags fail closed', () => {
  for (const change of [f => f.game.activeAction = null, f => f.game.pausedAction = null, f => f.wc.activeTrees = [],
    f => f.wc.activeTrees.clear(), f => f.game.activeAction = { id: f.wc.id, isActive: false }, f => f.wc.canStop = null, f => f.wc.isTreeUnlocked = () => null,
    f => f.wc.actions.getObjectByID = () => undefined]) {
    const f = fixture(); change(f); assert.equal(read(f).supported, false);
  }
});
test('normal entry, invalid context, Raid and limits stop before selection helpers', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('must not read'); } }), f = fixture();
  assert.equal(readActionSelection(forbidden, { enabled: true }).reason, 'runtime-action-selection-unverified');
  assert.equal(readActionSelectionForTesting(forbidden, { ...f.context, version: 'v2' }).reason, 'version-unverified');
  for (const patch of [{ expectedActionId: null }, { treeIds: Array(65).fill('A') }, { treeIds: ['A', 'A'] }, { maximumBytes: null }])
    assert.equal(readActionSelectionForTesting(forbidden, { ...f.context, ...patch }).reason, 'action-selection-context-invalid');
  f.game.isGolbinRaid = true; assert.equal(read(f).reason, 'raid-action-selection-unverified');
});
test('idle and unsupported responses also obey the complete JSON byte limit', () => {
  const f = fixture(); delete f.context.expectedActionId; f.game.activeAction = undefined; f.game.currentGamemode.id = 'M'.repeat(1024); f.context.maximumBytes = 1024;
  assert.equal(read(f).reason, 'action-selection-output-byte-limit');
});
test('select/start/stop/XP/reward/random/save are neither accessed nor invoked', () => {
  const f = fixture(); for (const name of ['selectTree', 'start', 'stop', 'onStop', 'actionRewards', 'baseXPToAdd', 'totalXPToAdd', 'preAction', 'postAction', 'encode', 'decode'])
    Object.defineProperty(f.wc, name, { get() { throw new Error('must not read'); } });
  Object.defineProperty(f.game, 'characterName', { get() { throw new Error('PRIVATE'); } }); assert.equal(read(f).supported, true);
});
test('existing executor refuses unknown output evidence even with artificial session permission flags', async () => {
  const f = fixture(); f.wc.isActive = false; f.wc.activeTrees.clear(); f.game.activeAction = undefined;
  const game = f.game; game.bank = { items: new Map(), lockedItems: new Set(), occupiedSlots: 0, maximumSlots: 20 };
  game.currencies = { allObjects: [{ id: 'GP', amount: 100 }] }; game.combat = { player: { selectedEquipmentSet: 0, equipmentSets: [{ equipment: { equippedArray: [
    { slot: { id: 'Weapon' }, item: { id: 'Empty' }, quantity: 0, isEmpty: true }] } }] } };
  let selects = 0; const executor = createWoodcuttingExecutorForTesting({ observe: () => ({ resources: readResourcesForTesting(game, { version: 'v1.3.1' }), woodcutting: read(f).woodcutting }),
    selectTree: () => { selects++; }, stop: () => true });
  executor.start({ version: 'v1.3.1', saveCopy: true, developmentProfile: true, modsCompatible: true, operationsVerified: true });
  assert.equal((await executor.execute({ id: 'command', kind: 'woodcutting-start', treeId: f.trees[0].id })).status, 'blocked'); assert.equal(selects, 0);
});
test('sorted frozen selections and returned arrays remain detached', () => {
  const f = fixture(); f.wc.activeTrees.add(f.trees[1]); const first = read(f); f.wc.activeTrees = new Set([f.trees[1], f.trees[0]]);
  assert.deepEqual(read(f), first); Object.freeze(f.trees[0]); Object.freeze(f.context.treeIds); assert.deepEqual(read(f), first);
  first.woodcutting.activeTreeIds[0] = 'tampered'; assert.equal(f.wc.activeTrees.has(f.trees[0]), true);
});
