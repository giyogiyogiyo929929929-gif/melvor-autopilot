import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCompletion, auditCompletionCategory } from '../src/completion-audit.mjs';
import { buildCompletionReport } from '../src/completion-report.mjs';
const scopes = ['base', 'toth', 'aod', 'ita'];
const categories = ['skills', 'mastery', 'items', 'monsters', 'pets'];
const size = value => new TextEncoder().encode(JSON.stringify(value)).length;
function category(entries) {
  const current = entries.reduce((sum, entry) => sum + entry.current, 0);
  const maximum = entries.reduce((sum, entry) => sum + entry.maximum, 0);
  return { supported: true, status: 'observed', current, maximum, percent: maximum ? 100 * current / maximum : 0,
    entries: structuredClone(entries), missing: entries.filter(entry => entry.current < entry.maximum).map(entry => ({ ...entry })) };
}
function fixture(complete = false) {
  return { version: 'v1.3.1', mode: { id: 'Standard', hardcore: false }, completion: { achieved: true, supported: true, status: 'observed',
    scopes: scopes.map(id => ({ id, ownership: true, supported: true, status: 'observed', percent: complete ? 100 : 12,
      categories: Object.fromEntries(categories.map(name => [name, category([{ id: `${id}:${name}`, current: complete ? 10 : 1,
        maximum: 10, accessible: name === 'pets' ? false : null }])])) })) } };
}
const item = snapshot => snapshot.completion.scopes[0].categories.items;
const report = (snapshot, nowMs = 0, previous = null, options = {}) => buildCompletionReport(snapshot, {}, { nowMs, stagnationMs: 10, ...options }, previous);
function freeze(value) { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }

test('all four scopes and five categories retain official scope rates and count missing targets', () => {
  const result = auditCompletion(fixture());
  assert.equal(result.status, 'incomplete'); assert.equal(result.comparable, true); assert.equal(result.missingCount, 20);
  for (const scope of result.scopes) { assert.equal(scope.percent, 12); assert.equal(Object.keys(scope.categories).length, 5);
    assert.equal(scope.categories.pets.lockedCount, 1); }
  assert.equal(result.actualComplete, false); assert.equal(result.runnable, false);
});
test('consistent mock 100 percent is observation only, never runtime completion or stagnation', () => {
  const snapshot = fixture(true), first = report(snapshot), next = report(snapshot, 100, first.checkpoint);
  assert.equal(first.audit.observationComplete, true); assert.equal(first.audit.actualComplete, false);
  assert.equal(next.progress.status, 'observed-complete'); assert.equal(next.actualComplete, false);
  assert.equal(next.audit.gameVerification, 'not-performed');
});
test('all skills complete and achieved flags cannot hide other missing categories', () => {
  const snapshot = fixture(); for (const scope of snapshot.completion.scopes) scope.categories.skills = category([{ id: 'Skill', current: 10, maximum: 10, accessible: true }]);
  assert.equal(auditCompletion(snapshot).missingCount, 16); assert.equal(auditCompletion(snapshot).observationComplete, false);
});
test('unowned scopes are excluded without touching their categories or summaries', () => {
  const snapshot = fixture(true); for (const scope of snapshot.completion.scopes.slice(1)) { scope.ownership = false;
    Object.defineProperty(scope, 'categories', { get() { throw new Error('secret'); } }); Object.defineProperty(scope, 'percent', { get() { throw new Error('secret'); } }); }
  assert.equal(auditCompletion(snapshot).observationComplete, true); assert.equal(auditCompletion(snapshot).scopes[1].status, 'excluded');
});
test('unknown or absent DLC ownership prevents whole observation comparison', () => {
  for (const change of [snapshot => snapshot.completion.scopes.pop(), snapshot => snapshot.completion.scopes[1].ownership = null]) {
    const snapshot = fixture(true); change(snapshot); const result = report(snapshot);
    assert.equal(result.audit.comparable, false); assert.equal(result.progress.status, 'unverified'); assert.equal(result.checkpoint, null);
  }
});
test('duplicate scope, unknown version and invalid mode fail closed', () => {
  for (const change of [snapshot => snapshot.version = 'v2', snapshot => snapshot.mode.hardcore = null,
    snapshot => snapshot.completion.scopes[1].id = 'base', snapshot => snapshot.completion.scopes[0].id = 'unknown']) {
    const snapshot = fixture(true); change(snapshot); assert.equal(auditCompletion(snapshot).comparable, false);
  }
});
test('unverified whole or scope observation flags prevent comparison despite valid entries', () => {
  for (const change of [snapshot => snapshot.completion.supported = false, snapshot => snapshot.completion.status = 'blocked',
    snapshot => snapshot.completion.scopes[0].supported = false, snapshot => snapshot.completion.scopes[0].status = 'blocked']) {
    const snapshot = fixture(true); change(snapshot); assert.equal(auditCompletion(snapshot).comparable, false);
  }
});
test('empty scopes and partial categories cannot prove completion', () => {
  const snapshot = fixture(true); for (const scope of snapshot.completion.scopes) for (const name of categories) scope.categories[name] = category([]);
  assert.equal(auditCompletion(snapshot).comparable, false);
  const partial = fixture(true); delete partial.completion.scopes[0].categories.pets;
  assert.equal(auditCompletion(partial).scopes[0].categories.pets.status, 'unverified');
});
test('scope 100 percent conflicts with unfinished entries, while lower rate stays authoritative', () => {
  const snapshot = fixture(); snapshot.completion.scopes[0].percent = 100;
  assert.equal(auditCompletion(snapshot).scopes[0].reason, 'scope-summary-conflict');
  const complete = fixture(true); complete.completion.scopes[0].percent = 99;
  assert.equal(auditCompletion(complete).observationComplete, false); assert.equal(auditCompletion(complete).scopes[0].percent, 99);
});
test('mastery skill IDs and standard/abyssal tracks distinguish repeated target IDs', () => {
  const entries = [{ id: 'Tree', skillId: 'Woodcutting', current: 1, maximum: 10, accessible: true },
    { id: 'Tree', skillId: 'Firemaking', current: 1, maximum: 10, accessible: false },
    { id: 'Skill', track: 'standard', current: 1, maximum: 10, accessible: null },
    { id: 'Skill', track: 'abyssal', current: 1, maximum: 10, accessible: null }];
  assert.equal(auditCompletionCategory(category(entries)).missingCount, 4);
});
for (const [name, change] of [
  ['duplicate entry', value => value.entries.push({ ...value.entries[0] })],
  ['invalid number', value => value.entries[0].current = NaN],
  ['aggregate disagreement', value => value.current++],
  ['category percentage disagreement', value => value.percent = 100],
  ['missing target omitted', value => value.missing = []],
  ['missing target value disagreement', value => value.missing[0].current++],
  ['missing accessibility disagreement', value => value.missing[0].accessible = true],
  ['missing identity shape disagreement', value => value.missing[0].skillId = null],
  ['duplicate missing target', value => value.missing.push({ ...value.missing[0] })],
  ['collection limit', value => value.entries = Array(20_001).fill(value.entries[0])]
]) test(`category rejects ${name}`, () => {
  const value = item(fixture()); change(value); assert.equal(auditCompletionCategory(value).status, 'unverified');
});
test('limited examples preserve full missing and locked totals without declaring unreachable', () => {
  const result = report(fixture(), 0, null, { maxMissingPerCategory: 0 });
  assert.equal(result.audit.missingCount, 20); assert.equal(result.audit.scopes[0].categories.pets.lockedCount, 1);
  assert.equal(result.audit.scopes[0].categories.pets.omitted, 1); assert.deepEqual(result.audit.scopes[0].categories.pets.missing, []);
  assert.equal(result.reachability, 'not-proven'); assert.equal(result.explorationCoverage, 'partial-or-unverified');
});
test('progress resets the clock and stagnation begins exactly at the threshold', () => {
  const snapshot = fixture(), first = report(snapshot), waiting = report(snapshot, 9, first.checkpoint);
  assert.equal(first.progress.status, 'baseline'); assert.equal(waiting.progress.status, 'waiting');
  assert.equal(report(snapshot, 10, waiting.checkpoint).progress.status, 'stagnant');
  snapshot.completion.scopes[0].categories.items = category([{ id: 'base:items', current: 2, maximum: 10, accessible: null }]);
  const progressed = report(snapshot, 11, waiting.checkpoint); assert.equal(progressed.progress.status, 'progressing');
  assert.equal(progressed.checkpoint.lastProgressAtMs, 11); assert.equal(report(snapshot, 20, progressed.checkpoint).progress.status, 'waiting');
});
test('regression, denominator, mode and ownership changes establish a new baseline', () => {
  for (const change of [snapshot => snapshot.completion.scopes[0].categories.items = category([{ id: 'base:items', current: 0, maximum: 10, accessible: null }]),
    snapshot => snapshot.completion.scopes[0].categories.items = category([{ id: 'base:items', current: 1, maximum: 11, accessible: null }]),
    snapshot => snapshot.mode.id = 'Hardcore', snapshot => snapshot.completion.scopes[1].ownership = false]) {
    const snapshot = fixture(), first = report(snapshot); change(snapshot);
    const next = report(snapshot, 100, first.checkpoint); assert.equal(next.progress.status, 'baseline'); assert.equal(next.checkpoint.lastProgressAtMs, 100);
  }
});
test('partial observation discards comparison state and recovery establishes a baseline', () => {
  const snapshot = fixture(), first = report(snapshot); delete snapshot.completion.scopes[0].categories.items;
  const partial = report(snapshot, 100, first.checkpoint); assert.equal(partial.progress.status, 'unverified'); assert.equal(partial.checkpoint, null);
  assert.equal(report(fixture(), 200, partial.checkpoint).progress.status, 'baseline');
});
test('a category getter failure retains other observations and hides exception text', () => {
  const snapshot = fixture(); Object.defineProperty(snapshot.completion.scopes[0].categories, 'items', { get() { throw new Error('SECRET'); } });
  const result = auditCompletion(snapshot); assert.equal(result.scopes[0].categories.items.reason, 'category-input-unreadable');
  assert.equal(result.scopes[0].categories.skills.status, 'incomplete'); assert.equal(JSON.stringify(result).includes('SECRET'), false);
});
test('unobserved gaps establish a baseline rather than inventing long stagnation', () => {
  const snapshot = fixture(), first = report(snapshot);
  assert.equal(report(snapshot, 300_000, first.checkpoint).progress.status, 'stagnant');
  const gap = report(snapshot, 300_001, first.checkpoint); assert.equal(gap.progress.status, 'baseline');
  assert.equal(gap.progress.reason, 'observation-gap'); assert.equal(gap.checkpoint.lastProgressAtMs, 300_001);
  assert.equal(report(snapshot, 11, first.checkpoint, { maxObservationGapMs: 10 }).progress.reason, 'observation-gap');
});
test('offline time is excluded and return establishes a fresh baseline', () => {
  const snapshot = fixture(), first = report(snapshot), offline = report(snapshot, 100, first.checkpoint, { offline: true });
  assert.equal(offline.progress.status, 'offline'); assert.equal(report(snapshot, 1000, offline.checkpoint).progress.status, 'baseline');
});
test('time reversal and corrupted checkpoint require reevaluation', () => {
  const snapshot = fixture(), first = report(snapshot, 10);
  assert.equal(report(snapshot, 9, first.checkpoint).progress.reason, 'report-time-reversed');
  for (const change of [value => value.lastProgressAtMs = 11, value => value.counts.push({ ...value.counts[0] }),
    value => value.counts.pop(), value => value.signature = 'x'.repeat(4097)]) {
    const checkpoint = structuredClone(first.checkpoint); change(checkpoint);
    const next = report(snapshot, 100, checkpoint); assert.equal(next.progress.reason, 'report-checkpoint-invalid'); assert.equal(next.checkpoint, null);
  }
});
test('reasons are fixed, deduplicated, bounded and do not copy save or exception fields', () => {
  const result = buildCompletionReport(fixture(), { journal: { entries: [{ reason: 'store-failed', save: 'SECRET' },
    { reason: 'store-failed' }, { reason: 'SECRET', error: 'SECRET' }, { reason: 'scan-limit' }] }, save: 'SECRET' }, { nowMs: 0, maxCauses: 2 });
  assert.deepEqual(result.causes, [{ reason: 'store-failed' }, { reason: 'external-reason-rejected' }]);
  assert.equal(result.causesOmitted, 1); assert.equal(JSON.stringify(result).includes('SECRET'), false);
  assert.equal(buildCompletionReport(fixture(), { journal: { entries: Array(1001).fill({ reason: 'store-failed' }) } }, { nowMs: 0 }).reason, 'report-journal-invalid');
});
test('UTF-8 report budget includes checkpoint, preserves totals and trims only report examples', () => {
  const snapshot = fixture(); for (const scope of snapshot.completion.scopes) for (const name of categories)
    scope.categories[name] = category(Array.from({ length: 20 }, (_, n) => ({ id: `${scope.id}:${name}:${n}:` + '木'.repeat(80), current: 0, maximum: 1, accessible: false })));
  const result = report(snapshot, 0, null, { maxBytes: 8000 });
  assert.equal(result.supported, true); assert.equal(result.truncated, true); assert.ok(size(result) <= 8000);
  assert.equal(result.audit.missingCount, 400); assert.equal(item(snapshot).missing.length, 20); assert.ok(result.checkpoint);
  const tooSmall = report(snapshot, 0, null, { maxBytes: 1024 });
  assert.equal(tooSmall.reason, 'report-byte-limit'); assert.ok(size(tooSmall) <= 1024); assert.equal(tooSmall.checkpoint, null);
});
test('invalid options and throwing input use fixed reasons', () => {
  for (const options of [{ nowMs: -1 }, { maxBytes: 100 }, { maxCauses: 257 }, { offline: null }, { stagnationMs: 0 }])
    assert.equal(report(fixture(), 0, null, options).supported, false);
  assert.equal(auditCompletion(fixture(), { maxMissingPerCategory: 1001 }).status, 'unverified');
  const snapshot = { get version() { throw new Error('SECRET'); } };
  assert.equal(JSON.stringify(report(snapshot)).includes('SECRET'), false);
});
test('frozen inputs stay unchanged, sorted outputs are deterministic and detached', () => {
  const snapshot = fixture(), before = JSON.stringify(snapshot); freeze(snapshot);
  const first = report(snapshot), second = report(snapshot); assert.deepEqual(first, second); assert.equal(JSON.stringify(snapshot), before);
  first.audit.scopes[0].categories.items.missing[0].id = 'changed'; first.checkpoint.counts[0].current = 9;
  assert.deepEqual(report(snapshot), second);
  const reordered = fixture(); reordered.completion.scopes.reverse(); assert.deepEqual(auditCompletion(reordered), auditCompletion(snapshot));
});
