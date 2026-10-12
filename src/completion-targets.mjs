/** Mock-only ID lookups. Partial target values never form a global Completion total. */
const SCOPES = { base: { namespace: 'melvorBaseGame', objects: ['melvorD', 'melvorF'] }, toth: { namespace: 'melvorTotH', objects: ['melvorTotH'] },
  aod: { namespace: 'melvorAoD', objects: ['melvorAoD'] }, ita: { namespace: 'melvorItA', objects: ['melvorItA'] } };
const PROGRESS = { skills: 'skillProgress', mastery: 'masteryProgress', items: 'itemProgress', monsters: 'monsterProgress', pets: 'petProgress' };
const count = value => Number.isSafeInteger(value) && value >= 0;
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const key = value => JSON.stringify([value.scopeId, value.category, value.skillId ?? '', value.id, value.track ?? '']);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const requireValue = valid => { if (!valid) throw new Error('target-observation-invalid'); };
const failed = reason => ({ version: null, mode: null, observationId: null, origin: 'mock-only', coverage: 'targets-only', fullCoverage: false,
  supported: false, reason, ownership: {}, targets: [], achieved: false, runnable: false });
export function readCompletionTargets(_game, _targets, _context) { return { ...failed('runtime-completion-targets-unverified'), origin: 'runtime-disabled' }; }
function lookup(registry, wantedId) {
  const value = registry.getObjectByID(wantedId);
  requireValue(value && value.id === wantedId && value.isModded === false && typeof value.namespace === 'string' && wantedId.startsWith(`${value.namespace}:`));
  return value;
}
function scopeObject(value, scope) { requireValue(scope.objects.includes(value.namespace)); }
function skillValue(game, target, scope) {
  const skill = lookup(game.skills, target.id); requireValue(typeof skill.hasAbyssalLevels === 'boolean' && typeof skill.isUnlocked === 'boolean');
  requireValue(target.track === 'standard' || target.track === 'abyssal' && skill.hasAbyssalLevels);
  const standard = target.track === 'standard', level = standard ? skill.level : skill.abyssalLevel,
    cap = standard ? skill.currentLevelCap : skill.currentAbyssalLevelCap,
    blocks = standard ? skill.levelCompletionBreakdown : skill.abyssalLevelCompletionBreakdown;
  requireValue(count(level) && count(cap) && Array.isArray(blocks) && blocks.length > 0 && blocks.length <= 4);
  let offset = 0, result = null; const seen = new Set();
  for (const block of blocks) {
    requireValue(block && count(block.levels) && block.levels > 0 && Object.values(SCOPES).some(scope => scope.namespace === block.namespace) && !seen.has(block.namespace));
    seen.add(block.namespace);
    if (block.namespace === scope.namespace) result = { current: Math.max(0, Math.min(block.levels, level - offset)), maximum: block.levels,
      accessible: skill.isUnlocked && cap >= offset + block.levels };
    offset += block.levels; requireValue(count(offset));
  }
  requireValue(result !== null); return result;
}
function targetValue(game, target, scope) {
  if (target.category === 'skills') return skillValue(game, target, scope);
  if (target.category === 'mastery') {
    const skill = lookup(game.masterySkills, target.skillId), action = lookup(skill.actions, target.id); scopeObject(action, scope);
    const current = skill.getMasteryLevel(action), maximum = skill.masteryLevelCap, unlocked = skill.isMasteryActionUnlocked(action), skillUnlocked = skill.isUnlocked;
    requireValue(typeof unlocked === 'boolean' && typeof skillUnlocked === 'boolean'); return { current, maximum, accessible: unlocked && skillUnlocked };
  }
  const object = lookup(game[target.category], target.id); scopeObject(object, scope);
  requireValue(object.ignoreCompletion === false);
  let current;
  if (target.category === 'pets') { const unlocked = game.petManager.isPetUnlocked(object); requireValue(typeof unlocked === 'boolean'); current = unlocked ? 1 : 0; }
  else { const value = target.category === 'items' ? game.stats.itemFindCount(object) : game.stats.monsterKillCount(object); requireValue(count(value)); current = value > 0 ? 1 : 0; }
  return { current, maximum: 1, accessible: null };
}
export function readCompletionTargetsForTesting(game, targets, context) {
  try {
    if (context?.version !== 'v1.3.1') return failed('version-unverified');
    const maximumBytes = context.maximumBytes === undefined ? 65_536 : context.maximumBytes;
    if (!id(context.observationId) || context.observationId.length > 256 || context.ownership?.base !== true || !count(maximumBytes) || maximumBytes < 1024 || maximumBytes > 1_048_576)
      return failed('completion-target-context-invalid');
    if (!Array.isArray(targets) || targets.length > 16) return failed('completion-target-list-invalid');
    const normalized = [], seen = new Set();
    for (const target of targets) {
      if (!target || target.type !== 'completion' || !Object.hasOwn(SCOPES, target.scopeId) || !Object.hasOwn(PROGRESS, target.category) || !id(target.id) ||
          (target.category === 'mastery' ? !id(target.skillId) : target.skillId !== undefined) ||
          (target.category === 'skills' ? !['standard', 'abyssal'].includes(target.track) : target.track !== undefined)) return failed('completion-target-list-invalid');
      const value = { scopeId: target.scopeId, category: target.category, id: target.id, ...(target.skillId === undefined ? {} : { skillId: target.skillId }),
        ...(target.track === undefined ? {} : { track: target.track }) };
      if (seen.has(key(value))) return failed('completion-target-list-duplicate'); seen.add(key(value)); normalized.push(value);
    }
    const ownership = Object.fromEntries(Object.keys(SCOPES).map(scope => { const value = context.ownership?.[scope]; return [scope, typeof value === 'boolean' ? value : null]; }));
    const mode = game.currentGamemode, modeId = mode?.id, hardcore = mode?.isPermaDeath, raid = game.isGolbinRaid;
    requireValue(id(modeId) && typeof hardcore === 'boolean' && typeof raid === 'boolean'); if (raid) return failed('raid-completion-targets-unverified');
    const denominators = new Map();
    const records = normalized.sort((a, b) => compare(key(a), key(b))).map(target => {
      const unavailable = reason => ({ ...target, supported: false, status: 'blocked', reason, current: null, maximum: null, categoryMaximum: null, accessible: null });
      if (ownership[target.scopeId] !== true) return unavailable(ownership[target.scopeId] === false ? 'scope-not-owned' : 'scope-ownership-unverified');
      try {
        const value = targetValue(game, target, SCOPES[target.scopeId]), denominatorKey = JSON.stringify([target.scopeId, target.category]);
        if (!denominators.has(denominatorKey)) denominators.set(denominatorKey, game.completion[PROGRESS[target.category]].maximumCount.getCompValue(SCOPES[target.scopeId].namespace));
        const categoryMaximum = denominators.get(denominatorKey);
        requireValue(count(value.current) && count(value.maximum) && value.maximum > 0 && value.current <= value.maximum &&
          count(categoryMaximum) && categoryMaximum >= value.maximum && [true, false, null].includes(value.accessible));
        return { ...target, ...value, categoryMaximum, supported: true, status: 'observed', reason: null };
      } catch { return unavailable('completion-target-api-invalid'); }
    });
    const result = {
      version: 'v1.3.1', mode: { id: modeId, hardcore }, observationId: context.observationId, origin: 'mock-only', coverage: 'targets-only', fullCoverage: false,
      supported: records.every(record => record.supported), reason: records.every(record => record.supported) ? null : 'completion-targets-partial', ownership, targets: records, achieved: false, runnable: false
    };
    return new TextEncoder().encode(JSON.stringify(result)).length <= maximumBytes ? result : failed('completion-target-output-byte-limit');
  } catch { return failed('completion-target-input-unreadable'); }
}
