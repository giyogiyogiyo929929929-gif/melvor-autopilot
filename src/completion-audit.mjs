/** Whole-snapshot consistency audit. This prototype has no runtime verification profile. */
const SCOPES = ['base', 'toth', 'aod', 'ita'];
const CATEGORIES = ['skills', 'mastery', 'items', 'monsters', 'pets'];
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const percent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const key = entry => JSON.stringify([entry.skillId ?? '', entry.id, entry.track ?? '']);
function categoryFailure(reason) { return { status: 'unverified', reason, current: null, maximum: null, percent: null,
  missingCount: null, lockedCount: null, missing: [], omitted: 0 }; }

export function auditCompletionCategory(category, maxMissing = 100) {
  try {
    if (!count(maxMissing) || maxMissing > 1000 || category?.supported !== true || category.status !== 'observed' ||
        !count(category.current) || !count(category.maximum) || category.current > category.maximum || !percent(category.percent) ||
        !Array.isArray(category.entries) || category.entries.length > 20_000 || !Array.isArray(category.missing) || category.missing.length > 20_000)
      return categoryFailure('category-unverified');
    const entries = new Map(); let current = 0, maximum = 0;
    for (const entry of category.entries) {
      if (!id(entry?.id) || !count(entry.current) || !count(entry.maximum) || entry.maximum < 1 || entry.current > entry.maximum ||
          ![true, false, null].includes(entry.accessible) || (entry.skillId !== undefined && !id(entry.skillId)) ||
          (entry.track !== undefined && !['standard', 'abyssal'].includes(entry.track)) || entries.has(key(entry))) return categoryFailure('entry-invalid-or-duplicate');
      const value = { id: entry.id, current: entry.current, maximum: entry.maximum, accessible: entry.accessible,
        ...(entry.skillId === undefined ? {} : { skillId: entry.skillId }), ...(entry.track === undefined ? {} : { track: entry.track }) };
      entries.set(key(entry), value); current += entry.current; maximum += entry.maximum;
    }
    if (!count(current) || !count(maximum) || current !== category.current || maximum !== category.maximum ||
        (maximum > 0 ? Math.abs(category.percent - 100 * current / maximum) > 1e-7 : ![0, 100].includes(category.percent)))
      return categoryFailure('category-aggregate-inconsistent');
    const missingKeys = new Set();
    for (const entry of category.missing) {
      const full = entries.get(key(entry));
      if (!full || missingKeys.has(key(entry)) || full.current === full.maximum || full.current !== entry.current || full.maximum !== entry.maximum ||
          full.accessible !== entry.accessible || full.skillId !== entry.skillId || full.track !== entry.track)
        return categoryFailure('missing-list-inconsistent');
      missingKeys.add(key(entry));
    }
    if ([...entries].some(([id, entry]) => (entry.current < entry.maximum) !== missingKeys.has(id))) return categoryFailure('missing-list-inconsistent');
    const missing = [...entries.values()].filter(entry => entry.current < entry.maximum).sort((a, b) => compare(key(a), key(b)));
    return { status: maximum === 0 ? 'empty' : missing.length ? 'incomplete' : 'complete', reason: null,
      current, maximum, percent: category.percent, missingCount: missing.length,
      lockedCount: missing.filter(entry => entry.accessible === false).length,
      missing: missing.slice(0, maxMissing), omitted: Math.max(0, missing.length - maxMissing) };
  } catch { return categoryFailure('category-input-unreadable'); }
}
const failed = reason => ({ status: 'unverified', reason, observationComplete: false, comparable: false,
  actualComplete: false, gameVerification: 'not-performed', scopes: [], missingCount: null, runnable: false });
export function auditCompletion(snapshot, options = {}) {
  try {
    const maxMissing = options.maxMissingPerCategory ?? 100;
    if (!count(maxMissing) || maxMissing > 1000) return failed('audit-options-invalid');
    if (snapshot?.version !== 'v1.3.1' || !id(snapshot.mode?.id) || typeof snapshot.mode.hardcore !== 'boolean' ||
        !Array.isArray(snapshot.completion?.scopes) || snapshot.completion.scopes.length > 4) return failed('snapshot-unverified');
    const byScope = new Map();
    for (const scope of snapshot.completion.scopes) {
      if (!SCOPES.includes(scope?.id) || byScope.has(scope.id)) return failed('scope-invalid-or-duplicate');
      byScope.set(scope.id, scope);
    }
    const scopes = SCOPES.map(scopeId => {
      const scope = byScope.get(scopeId), ownership = typeof scope?.ownership === 'boolean' ? scope.ownership : null;
      if (ownership !== true) return { id: scopeId, ownership, status: ownership === false ? 'excluded' : 'unverified',
        reason: ownership === false ? 'scope-not-owned' : 'scope-ownership-unverified', percent: null, categories: {} };
      const categories = Object.fromEntries(CATEGORIES.map(category => {
        try { return [category, auditCompletionCategory(scope.categories?.[category], maxMissing)]; }
        catch { return [category, categoryFailure('category-input-unreadable')]; }
      }));
      const valid = Object.values(categories).every(category => category.status !== 'unverified');
      const allDone = valid && Object.values(categories).every(category => category.missingCount === 0);
      const hasData = valid && Object.values(categories).some(category => category.maximum > 0);
      const conflicting = scope.percent === 100 && !allDone;
      const observed = scope.supported === true && scope.status === 'observed' && percent(scope.percent) && valid && hasData && !conflicting;
      return { id: scopeId, ownership, status: observed ? allDone && scope.percent === 100 ? 'complete' : 'incomplete' : 'unverified',
        reason: observed ? null : conflicting ? 'scope-summary-conflict' : !hasData ? 'scope-empty-or-unverified' : 'scope-observation-unverified',
        percent: percent(scope.percent) ? scope.percent : null, categories };
    });
    const owned = scopes.filter(scope => scope.ownership === true);
    const comparable = snapshot.completion.supported === true && snapshot.completion.status === 'observed' &&
      scopes[0].ownership === true && owned.length > 0 && scopes.every(scope => scope.status !== 'unverified');
    const observationComplete = comparable && owned.every(scope => scope.status === 'complete');
    const missingCount = owned.reduce((sum, scope) => sum + Object.values(scope.categories).reduce((sum, category) => sum + (category.missingCount ?? 0), 0), 0);
    return { status: !comparable ? 'unverified' : observationComplete ? 'observed-complete' : 'incomplete',
      reason: observationComplete ? 'runtime-verification-required' : comparable ? 'completion-targets-remain' : 'completion-observation-unverified',
      observationComplete, comparable, actualComplete: false, gameVerification: 'not-performed', scopes,
      missingCount: comparable ? missingCount : null, runnable: false };
  } catch { return failed('audit-input-unreadable'); }
}
