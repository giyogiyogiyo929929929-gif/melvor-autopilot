import test from 'node:test';
import assert from 'node:assert/strict';
import { readSnapshot, readCompletionForTesting, generateCompletionCandidates, chooseNextGoal } from '../setup.mjs';
import { auditCompletion } from '../src/completion-audit.mjs';

// Synthetic fixtures, not exported saves or proof of runtime v1.3.1 behavior.
const scopeDefs = [
  ['base', 'melvorF', 'melvorBaseGame', 'totalProgressBaseGame'],
  ['toth', 'melvorTotH', 'melvorTotH', 'totalProgressTotH'],
  ['aod', 'melvorAoD', 'melvorAoD', 'totalProgressAoD'],
  ['ita', 'melvorItA', 'melvorItA', 'totalProgressItA']
];
const categoryProps = {
  skills: 'skillProgress', mastery: 'masteryProgress', items: 'itemProgress',
  monsters: 'monsterProgress', pets: 'petProgress'
};
const registry = allObjects => ({ allObjects });
const object = (namespace, localID) => ({ id: `${namespace}:${localID}`, namespace, name: localID, isModded: false });
function fixture({ complete = false, hardcore = false } = {}) {
  const context = { version: 'v1.3.1', ownership: { base: true, toth: true, aod: true, ita: true } };
  const game = {
    currentGamemode: { id: hardcore ? 'melvorF:Hardcore' : 'melvorF:Standard', isPermaDeath: hardcore },
    skills: registry([]), masterySkills: registry([]), items: registry([]), monsters: registry([]), pets: registry([]),
    stats: { itemFindCount: item => item.found, monsterKillCount: monster => monster.kills },
    petManager: { isPetUnlocked: pet => pet.unlocked }, completion: {}
  };
  for (const [id, namespace, completionNamespace, total] of scopeDefs) {
    const skill = { ...object(namespace, 'Skill'), level: complete ? 10 : 2, currentLevelCap: 10,
      isUnlocked: true, hasAbyssalLevels: false, levelCompletionBreakdown: [{ namespace: completionNamespace, levels: 10 }] };
    game.skills.allObjects.push(skill);
    game.masterySkills.allObjects.push({ ...object(namespace, 'MasterySkill'), masteryLevelCap: 10, isUnlocked: true,
      actions: registry([{ ...object(namespace, 'Recipe'), mastery: complete ? 10 : 1, unlocked: true }]),
      getMasteryLevel: action => action.mastery, isMasteryActionUnlocked: action => action.unlocked });
    game.items.allObjects.push({ ...object(namespace, 'Item'), ignoreCompletion: false, found: complete ? 1 : 0 });
    game.monsters.allObjects.push({ ...object(namespace, 'Monster'), ignoreCompletion: false, kills: complete ? 1 : 0 });
    game.pets.allObjects.push({ ...object(namespace, 'Pet'), ignoreCompletion: false, unlocked: complete });
    game.completion[total] = complete ? 100 : 6;
  }
  for (const [category, property] of Object.entries(categoryProps)) {
    const maximum = category === 'skills' || category === 'mastery' ? 10 : 1;
    const current = complete ? maximum : category === 'skills' ? 2 : category === 'mastery' ? 1 : 0;
    game.completion[property] = {
      currentCount: { getCompValue: () => current }, maximumCount: { getCompValue: () => maximum },
      getPercent: () => 100 * current / maximum
    };
  }
  return { game, context };
}
const read = ({ game, context }) => readCompletionForTesting(game, context);
const base = snapshot => snapshot.completion.scopes.find(scope => scope.id === 'base');

test('whole completion audit consumes the detached adapter output without runtime success claims', () => {
  const unfinished = auditCompletion(read(fixture())); assert.equal(unfinished.missingCount, 20); assert.equal(unfinished.comparable, true);
  const finished = auditCompletion(read(fixture({ complete: true }))); assert.equal(finished.observationComplete, true);
  assert.equal(finished.actualComplete, false); assert.equal(finished.gameVerification, 'not-performed');
});

test('distribution adapter never touches unverified game API, even if options are supplied', () => {
  const game = new Proxy({}, { get() { throw new Error('game API accessed'); } });
  const snapshot = readSnapshot(game, { enabled: true });
  assert.equal(snapshot.completion.achieved, false);
  assert.equal(snapshot.completion.reason, 'runtime-adapter-unverified');
  assert.equal(chooseNextGoal(snapshot).type, 'blocked');
});

test('enumerates all five categories in all four scopes with no user goal', () => {
  const snapshot = read(fixture());
  assert.equal(snapshot.completion.supported, true);
  assert.equal(snapshot.completion.achieved, false);
  const result = generateCompletionCandidates(snapshot);
  assert.equal(result.candidates.length, 20);
  assert.deepEqual(result.blockers, []);
  for (const scope of snapshot.completion.scopes) {
    assert.equal(Object.keys(scope.categories).length, 5);
    for (const category of Object.values(scope.categories)) assert.equal(category.missing.length, 1);
  }
  assert.ok(result.candidates.every(candidate => !candidate.runnable && candidate.executionStatus === 'blocked'));
});

test('full entries retain explicit completed targets instead of inferring from an empty missing list', () => {
  const f = fixture({ complete: true }); const snapshot = read(f);
  for (const scope of snapshot.completion.scopes) for (const category of Object.values(scope.categories)) {
    assert.equal(category.entries.length, 1); assert.deepEqual(category.missing, []);
    assert.equal(category.entries[0].current, category.entries[0].maximum);
  }
  const unfinished = read(fixture()); const category = base(unfinished).categories.items;
  category.missing[0].current = 999;
  assert.equal(category.entries[0].current, 0);
  delete f.game.completion.itemProgress;
  assert.deepEqual(base(read(f)).categories.items.entries, []);
});

test('detached snapshot cannot mutate game and functions remain deterministic', () => {
  const f = fixture();
  const before = JSON.stringify(f.game);
  const snapshot = read(f);
  assert.equal(JSON.stringify(f.game), before);
  assert.deepEqual(read(f), snapshot);
  assert.deepEqual(generateCompletionCandidates(snapshot), generateCompletionCandidates(structuredClone(snapshot)));
  base(snapshot).categories.skills.missing[0].name = 'modified';
  assert.equal(f.game.skills.allObjects[0].name, 'Skill');
  const serialized = JSON.stringify(snapshot);
  assert.equal(typeof JSON.parse(serialized).mode.hardcore, 'boolean');
});

test('ordering is independent of registry order and wall clock', () => {
  const f = fixture();
  const expected = generateCompletionCandidates(read(f));
  for (const key of ['skills', 'masterySkills', 'items', 'monsters', 'pets']) f.game[key].allObjects.reverse();
  assert.deepEqual(generateCompletionCandidates(read(f)), expected);
  assert.deepEqual(chooseNextGoal(read(f)), expected.candidates[0]);
});

test('missing API cannot be mistaken for completion; working categories survive', () => {
  const f = fixture({ complete: true });
  delete f.game.completion.petProgress;
  const snapshot = read(f);
  assert.equal(snapshot.completion.achieved, false);
  assert.equal(base(snapshot).categories.skills.supported, true);
  assert.equal(base(snapshot).categories.pets.supported, false);
  assert.ok(generateCompletionCandidates(snapshot).blockers.length > 0);
});

test('complete skills do not hide missing items or pets', () => {
  const f = fixture({ complete: true });
  f.game.items.allObjects[0].found = 0;
  f.game.completion.itemProgress.currentCount.getCompValue = ns => ns === 'melvorBaseGame' ? 0 : 1;
  f.game.completion.itemProgress.getPercent = ns => ns === 'melvorBaseGame' ? 0 : 100;
  const snapshot = read(f);
  assert.equal(snapshot.completion.achieved, false);
  assert.equal(base(snapshot).supported, false); // total falsely claims 100
  assert.equal(generateCompletionCandidates(snapshot).candidates[0].category, 'items');
});

test('sold items use lifetime discovery, never bank possession', () => {
  const f = fixture();
  f.game.items.allObjects[0].found = 5;
  f.game.bank = new Proxy({}, { get() { throw new Error('bank must not be used'); } });
  f.game.completion.itemProgress.currentCount.getCompValue = ns => ns === 'melvorBaseGame' ? 1 : 0;
  f.game.completion.itemProgress.getPercent = ns => ns === 'melvorBaseGame' ? 100 : 0;
  const snapshot = read(f);
  assert.deepEqual(base(snapshot).categories.items.missing, []);
  assert.equal(snapshot.completion.achieved, false);
});

test('unowned DLC is excluded without accessing its total getter', () => {
  const f = fixture();
  for (const [id, , , total] of scopeDefs.slice(1)) {
    f.context.ownership[id] = false;
    Object.defineProperty(f.game.completion, total, { get() { throw new Error('unowned total accessed'); } });
  }
  const snapshot = read(f);
  assert.equal(snapshot.completion.supported, true);
  assert.equal(generateCompletionCandidates(snapshot).candidates.length, 5);
  assert.ok(snapshot.completion.scopes.slice(1).every(scope => scope.status === 'excluded'));
});

test('unknown ownership is not inferred from registered DLC content', () => {
  const f = fixture({ complete: true });
  delete f.context.ownership.ita;
  const snapshot = read(f);
  assert.equal(snapshot.completion.achieved, false);
  assert.equal(snapshot.completion.scopes[3].ownership, null);
  assert.ok(generateCompletionCandidates(snapshot).blockers.some(blocker => blocker.reason === 'ownership-unknown'));
});

test('version and mode failures fail closed without leaking exception text', () => {
  const f = fixture();
  f.context.version = 'v1.4.0';
  assert.equal(read(f).completion.reason, 'version-unverified');
  f.context.version = 'v1.3.1';
  Object.defineProperty(f.game, 'currentGamemode', { get() { throw new Error('SECRET_SAVE_TOKEN'); } });
  const snapshot = read(f);
  assert.equal(snapshot.completion.achieved, false);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET_SAVE_TOKEN/);
});

test('exceptions are isolated by category and sanitized', () => {
  const f = fixture();
  f.game.stats.itemFindCount = () => { throw new Error('SECRET'); };
  const snapshot = read(f);
  assert.equal(base(snapshot).categories.items.supported, false);
  assert.equal(base(snapshot).categories.monsters.supported, true);
  assert.equal(generateCompletionCandidates(snapshot).candidates.length, 16);
  assert.doesNotMatch(JSON.stringify(snapshot), /SECRET/);
});

test('invalid aggregate numbers and strings are rejected without coercion', () => {
  for (const value of [null, undefined, NaN, Infinity, -1, '100', 101]) {
    const f = fixture({ complete: true });
    f.game.completion.totalProgressBaseGame = value;
    assert.equal(base(read(f)).supported, false);
    assert.equal(read(f).completion.achieved, false);
  }
  for (const value of [null, NaN, Infinity, -1, '1', 0.5]) {
    const f = fixture();
    f.game.stats.itemFindCount = () => value;
    assert.equal(base(read(f)).categories.items.supported, false);
  }
});

test('invalid flags, duplicate IDs and count mismatches block a category', () => {
  for (const mutation of [
    f => { delete f.game.pets.allObjects[0].ignoreCompletion; },
    f => { f.game.pets.allObjects.push({ ...f.game.pets.allObjects[0] }); },
    f => { f.game.pets.allObjects[0].namespace = 'unknown'; },
    f => { f.game.petManager.isPetUnlocked = () => null; },
    f => { f.game.completion.petProgress.maximumCount.getCompValue = () => 5; },
    f => { f.game.completion.petProgress.getPercent = () => 100; }
  ]) {
    const f = fixture(); mutation(f);
    assert.equal(base(read(f)).categories.pets.supported, false);
    assert.equal(read(f).completion.achieved, false);
  }
});

test('ignoreCompletion and mod content never generate official targets', () => {
  const f = fixture();
  f.game.items.allObjects.push({ ...object('melvorF', 'Ignored'), ignoreCompletion: true });
  f.game.items.allObjects.push({ ...object('someMod', 'ModItem'), isModded: true });
  assert.equal(base(read(f)).categories.items.supported, true);
  assert.equal(generateCompletionCandidates(read(f)).candidates.length, 20);
});

test('locked skills and mastery remain missing with a blocker', () => {
  const f = fixture();
  f.game.skills.allObjects[0].isUnlocked = false;
  f.game.masterySkills.allObjects[0].actions.allObjects[0].unlocked = false;
  const snapshot = read(f);
  assert.equal(base(snapshot).categories.skills.missing.length, 1);
  const locked = generateCompletionCandidates(snapshot).candidates.filter(c => c.reason === 'locked-or-level-cap');
  assert.equal(locked.length, 2);
});

test('Hardcore combat candidates require separate verification', () => {
  const result = generateCompletionCandidates(read(fixture({ hardcore: true })));
  assert.ok(result.candidates.filter(c => c.category === 'monsters').every(c => c.reason === 'hardcore-combat-unverified'));
  const normal = generateCompletionCandidates(read(fixture()));
  assert.ok(normal.candidates.filter(c => c.category === 'monsters').every(c => c.reason === 'combat-risk-unknown'));
});

test('standard skill levels split into Base and TotH; abyssal track stays distinct', () => {
  const f = fixture();
  const skill = f.game.skills.allObjects[0];
  Object.assign(skill, { level: 12, currentLevelCap: 15, hasAbyssalLevels: true, abyssalLevel: 2,
    currentAbyssalLevelCap: 8, levelCompletionBreakdown: [
      { namespace: 'melvorBaseGame', levels: 10 }, { namespace: 'melvorTotH', levels: 5 }
    ], abyssalLevelCompletionBreakdown: [{ namespace: 'melvorItA', levels: 8 }] });
  f.game.skills.allObjects = [skill];
  const current = { melvorBaseGame: 10, melvorTotH: 2, melvorAoD: 0, melvorItA: 2 };
  const maximum = { melvorBaseGame: 10, melvorTotH: 5, melvorAoD: 0, melvorItA: 8 };
  Object.assign(f.game.completion.skillProgress, {
    currentCount: { getCompValue: ns => current[ns] }, maximumCount: { getCompValue: ns => maximum[ns] },
    getPercent: ns => maximum[ns] ? 100 * current[ns] / maximum[ns] : 0
  });
  const snapshot = read(f);
  assert.deepEqual(base(snapshot).categories.skills.missing, []);
  const targets = generateCompletionCandidates(snapshot).candidates.filter(c => c.category === 'skills');
  assert.equal(targets.length, 2);
  assert.equal(targets.find(c => c.scopeId === 'toth').targetLevel, 15);
  assert.equal(targets.find(c => c.scopeId === 'ita').track, 'abyssal');
});

test('zero registries do not count as 100%; unknown APIs cannot yield empty success', () => {
  const f = fixture({ complete: true });
  for (const key of ['skills', 'masterySkills', 'items', 'monsters', 'pets']) f.game[key].allObjects = [];
  for (const property of Object.values(categoryProps)) Object.assign(f.game.completion[property], {
    currentCount: { getCompValue: () => 0 }, maximumCount: { getCompValue: () => 0 }, getPercent: () => 100
  });
  assert.equal(read(f).completion.achieved, false);
  assert.equal(readCompletionForTesting({}, f.context).completion.achieved, false);
});

test('complete synthetic log requires every owned scope and category to agree', () => {
  const snapshot = read(fixture({ complete: true }));
  assert.equal(snapshot.completion.achieved, true); // simulation only
  assert.deepEqual(generateCompletionCandidates(snapshot), { candidates: [], blockers: [] });
  assert.equal(chooseNextGoal(snapshot).runnable, false);
});

test('frozen game objects are observed without writes or registry sorting', () => {
  const f = fixture();
  function freeze(value) {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) {
      for (const child of Object.values(value)) freeze(child);
      Object.freeze(value);
    }
    return value;
  }
  freeze(f.game);
  assert.equal(read(f).completion.supported, true);
});

test('current cap limitations block missing skills rather than reducing completion goal', () => {
  const f = fixture();
  f.game.skills.allObjects[0].currentLevelCap = 2;
  const snapshot = read(f);
  const entry = base(snapshot).categories.skills.missing[0];
  assert.equal(entry.maximum, 10);
  assert.equal(entry.accessible, false);
  assert.equal(generateCompletionCandidates(snapshot).candidates.find(c => c.scopeId === 'base' && c.category === 'skills').reason,
    'locked-or-level-cap');
});

test('unknown skill breakdown, missing registry and malformed mastery block safely', () => {
  for (const mutation of [
    f => { f.game.skills.allObjects[0].level = null; },
    f => { f.game.skills.allObjects[0].levelCompletionBreakdown = []; },
    f => { f.game.skills.allObjects[0].levelCompletionBreakdown[0].namespace = 'unknown'; },
    f => { f.game.skills.allObjects[0].levelCompletionBreakdown.push({ namespace: 'melvorBaseGame', levels: 5 }); },
    f => { delete f.game.skills; },
    f => { f.game.skills = []; }
  ]) {
    const f = fixture(); mutation(f);
    assert.equal(base(read(f)).categories.skills.supported, false);
  }
  const f = fixture();
  f.game.masterySkills.allObjects[0].getMasteryLevel = () => '10';
  assert.equal(base(read(f)).categories.mastery.supported, false);
});

test('both demo and full namespaces aggregate into Base separately from DLC', () => {
  const f = fixture();
  f.game.items.allObjects.push({ ...object('melvorD', 'DemoItem'), ignoreCompletion: false, found: 0 });
  f.game.completion.itemProgress.maximumCount.getCompValue = ns => ns === 'melvorBaseGame' ? 2 : 1;
  const snapshot = read(f);
  assert.equal(base(snapshot).categories.items.maximum, 2);
  assert.equal(base(snapshot).categories.items.missing.length, 2);
  assert.equal(snapshot.completion.scopes[1].categories.items.missing.length, 1);
});
