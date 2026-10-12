import test from 'node:test';
import assert from 'node:assert/strict';
import { readCompletionTargets, readCompletionTargetsForTesting } from '../src/completion-targets.mjs';
import { auditCompletion } from '../src/completion-audit.mjs';
const object = (name, namespace = 'melvorD', extra = {}) => ({ id: `${namespace}:${name}`, namespace, isModded: false, ...extra });
const registry = objects => ({ getObjectByID: id => objects.find(value => value.id === id), get allObjects() { throw new Error('must not scan'); } });
const target = (category, name, extra = {}) => ({ type: 'completion', scopeId: 'base', category, id: `melvorD:${name}`, ...extra });
function fixture() {
  const item = object('Item', 'melvorD', { ignoreCompletion: false, found: 3 }), monster = object('Monster', 'melvorD', { ignoreCompletion: false, killed: 2 }), pet = object('Pet', 'melvorD', { ignoreCompletion: false, unlocked: false });
  const action = object('Action'), skill = object('Skill', 'melvorD', { level: 110, currentLevelCap: 120, abyssalLevel: 5, currentAbyssalLevelCap: 60,
    isUnlocked: true, hasAbyssalLevels: true, levelCompletionBreakdown: [{ namespace: 'melvorBaseGame', levels: 100 }, { namespace: 'melvorTotH', levels: 20 }],
    abyssalLevelCompletionBreakdown: [{ namespace: 'melvorItA', levels: 60 }], masteryLevelCap: 10, actions: registry([action]), getMasteryLevel: () => 2, isMasteryActionUnlocked: () => true });
  const denominators = { melvorBaseGame: 500, melvorTotH: 200, melvorItA: 600 }, calls = [];
  const game = { currentGamemode: { id: 'Standard', isPermaDeath: false }, isGolbinRaid: false,
    skills: registry([skill]), masterySkills: registry([skill]), items: registry([item]), monsters: registry([monster]), pets: registry([pet]),
    stats: { itemFindCount: value => value.found, monsterKillCount: value => value.killed }, petManager: { isPetUnlocked: value => value.unlocked }, completion: {} };
  for (const property of ['skillProgress', 'masteryProgress', 'itemProgress', 'monsterProgress', 'petProgress']) game.completion[property] = {
    maximumCount: { getCompValue: namespace => { calls.push([property, namespace]); return denominators[namespace]; } },
    get currentCount() { throw new Error('must not read total'); }, get getPercent() { throw new Error('must not read percent'); } };
  return { game, item, skill, action, denominators, calls, context: { version: 'v1.3.1', observationId: 'target-frame', ownership: { base: true, toth: true, aod: false, ita: true } } };
}
const read = (f, targets) => readCompletionTargetsForTesting(f.game, targets, f.context);
test('all five categories use ID lookup and retain target values separately from category maxima', () => {
  const f = fixture(), result = read(f, [target('skills', 'Skill', { track: 'standard' }), target('mastery', 'Action', { skillId: 'melvorD:Skill' }),
    target('items', 'Item'), target('monsters', 'Monster'), target('pets', 'Pet')]);
  assert.equal(result.supported, true); assert.equal(result.targets.length, 5); assert.equal(result.coverage, 'targets-only');
  assert.equal(result.targets.find(value => value.category === 'skills').current, 100);
  assert.equal(result.targets.find(value => value.category === 'mastery').current, 2);
  assert.equal(result.targets.find(value => value.category === 'items').current, 1);
  assert.equal(result.targets.find(value => value.category === 'monsters').current, 1);
  assert.equal(result.targets.find(value => value.category === 'pets').current, 0);
  assert.ok(result.targets.every(value => value.categoryMaximum === 500)); assert.equal(f.calls.length, 5);
});
test('standard DLC offsets and abyssal tracks follow breakdown instead of fixed caps', () => {
  const f = fixture(), result = read(f, [target('skills', 'Skill', { scopeId: 'toth', track: 'standard' }), target('skills', 'Skill', { scopeId: 'ita', track: 'abyssal' })]);
  const toth = result.targets.find(value => value.scopeId === 'toth'), ita = result.targets.find(value => value.scopeId === 'ita');
  assert.equal(toth.current, 10); assert.equal(toth.maximum, 20); assert.equal(toth.categoryMaximum, 200);
  assert.equal(ita.current, 5); assert.equal(ita.maximum, 60); assert.equal(ita.categoryMaximum, 600);
  f.skill.currentLevelCap = 110; assert.equal(read(f, [target('skills', 'Skill', { scopeId: 'toth', track: 'standard' })]).targets[0].accessible, false);
});
test('category maxima are read once per requested scope/category', () => {
  const f = fixture(), second = object('Other', 'melvorD', { ignoreCompletion: false, found: 0 }); f.game.items = registry([f.item, second]);
  assert.equal(read(f, [target('items', 'Item'), target('items', 'Other')]).supported, true); assert.equal(f.calls.length, 1);
});
test('unknown or unowned scope never performs object lookup', () => {
  const f = fixture(); f.game.items.getObjectByID = () => { throw new Error('PRIVATE'); };
  for (const ownership of [false, null]) { f.context.ownership.ita = ownership;
    const result = read(f, [target('items', 'Item', { scopeId: 'ita', id: 'melvorItA:Item' })]);
    assert.equal(result.targets[0].reason, ownership === false ? 'scope-not-owned' : 'scope-ownership-unverified'); assert.equal(f.calls.length, 0); }
});
test('ignoreCompletion, modded objects and lookup identity mismatches do not call value helpers', () => {
  for (const change of [f => f.item.ignoreCompletion = true, f => f.item.isModded = true, f => f.game.items.getObjectByID = () => object('Different')]) {
    const f = fixture(); change(f); f.game.stats.itemFindCount = () => { throw new Error('must not read'); };
    const result = read(f, [target('items', 'Item')]); assert.equal(result.targets[0].supported, false); assert.equal(f.calls.length, 0);
  }
});
test('missing objects and target exceptions remain partial with fixed reasons', () => {
  const f = fixture(); f.game.stats.itemFindCount = () => { throw new Error('PRIVATE-SAVE'); };
  const result = read(f, [target('items', 'Item'), target('pets', 'Pet'), target('items', 'Missing')]);
  assert.equal(result.supported, false); assert.equal(result.targets.find(value => value.category === 'pets').supported, true);
  assert.equal(JSON.stringify(result).includes('PRIVATE-SAVE'), false);
});
test('invalid current/cap/denominator/track data is never repaired to known values', () => {
  for (const change of [f => f.item.found = NaN, f => f.denominators.melvorBaseGame = 0, f => f.skill.masteryLevelCap = -1,
    f => f.skill.levelCompletionBreakdown = [], f => f.skill.level = null, f => f.skill.hasAbyssalLevels = false]) {
    const f = fixture(); change(f); const result = read(f, [target('items', 'Item'), target('mastery', 'Action', { skillId: 'melvorD:Skill' }),
      target('skills', 'Skill', { track: 'standard' }), target('skills', 'Skill', { scopeId: 'ita', track: 'abyssal' })]);
    assert.equal(result.supported, false);
  }
});
test('normal entry, bad contexts, invalid targets and duplicates refuse getters before observation', () => {
  const forbidden = new Proxy({}, { get() { throw new Error('PRIVATE'); } }), f = fixture();
  assert.equal(readCompletionTargets(forbidden, [], { ...f.context, enabled: true }).reason, 'runtime-completion-targets-unverified');
  for (const targets of [Array(17).fill(target('items', 'Item')), [target('skills', 'Skill')], [target('mastery', 'Action')], [target('constructor', 'Item')], [target('items', 'Item'), target('items', 'Item')]])
    assert.equal(readCompletionTargetsForTesting(forbidden, targets, f.context).supported, false);
  assert.equal(readCompletionTargetsForTesting(forbidden, [], { ...f.context, version: 'v2' }).reason, 'version-unverified');
});
test('empty targets and all targets achieved never produce a full Completion claim', () => {
  const f = fixture(), result = read(f, [target('items', 'Item')]); assert.equal(result.targets[0].current, result.targets[0].maximum);
  assert.equal(result.achieved, false); assert.equal(result.fullCoverage, false); assert.equal(auditCompletion(result).actualComplete, false);
  const empty = read(f, []); assert.equal(empty.supported, true); assert.deepEqual(empty.targets, []); assert.equal(empty.fullCoverage, false);
});
test('UTF-8 budget includes headers rather than only target rows', () => {
  const f = fixture(); f.context.maximumBytes = 1024; f.game.currentGamemode.id = 'M'.repeat(1024);
  assert.equal(read(f, []).reason, 'completion-target-output-byte-limit');
});
test('ordered frozen inputs and returned values remain detached', () => {
  const f = fixture(), targets = [target('items', 'Item'), target('pets', 'Pet')], first = read(f, targets);
  targets.reverse(); assert.deepEqual(read(f, targets), first); Object.freeze(f.item); Object.freeze(targets); Object.freeze(f.context);
  const result = read(f, targets); result.targets[0].current = 99; assert.equal(f.item.found, 3); assert.deepEqual(read(f, targets), first);
});
