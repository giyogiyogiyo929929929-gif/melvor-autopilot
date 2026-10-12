/**
 * Melvor Autopilot prototype (v0.1.0)
 * READ-ONLY. Unverified game observation is disabled in the distribution UI.
 * Completion observation is exposed separately for mock tests only.
 *
 * Runtime entry: manifest.json -> setup(ctx)
 * Pure helpers are exported for independent Node.js tests.
 */

const LOG_LIMIT = 120;
const POLL_INTERVAL_MS = 10_000;

const CATEGORIES = Object.freeze({
  skills: 'skillProgress', mastery: 'masteryProgress', items: 'itemProgress',
  monsters: 'monsterProgress', pets: 'petProgress'
});
// Hypotheses for mocks, NOT a verified v1.3.1 compatibility profile.
const SCOPES = Object.freeze([
  { id: 'base', namespaces: ['melvorD', 'melvorF'], namespace: 'melvorBaseGame', total: 'totalProgressBaseGame' },
  { id: 'toth', namespaces: ['melvorTotH'], namespace: 'melvorTotH', total: 'totalProgressTotH' },
  { id: 'aod', namespaces: ['melvorAoD'], namespace: 'melvorAoD', total: 'totalProgressAoD' },
  { id: 'ita', namespaces: ['melvorItA'], namespace: 'melvorItA', total: 'totalProgressItA' }
]);
const compareID = (a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
const isCount = value => Number.isSafeInteger(value) && value >= 0;
const isPercent = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100;
function requireValue(valid) { if (!valid) throw new Error('invalid-observation'); }
function unavailable(reason) {
  return { supported: false, status: 'blocked', reason, percent: null, current: null, maximum: null, entries: [], missing: [] };
}
function blockedSnapshot(reason) {
  return {
    version: null, mode: null, dataAvailable: false,
    completion: { supported: false, status: 'blocked', reason, achieved: false, scopes: [] }
  };
}

/** No validated runtime profile exists. Do not even access game getters here. */
export function readSnapshot(_gameObject) {
  return blockedSnapshot('runtime-adapter-unverified');
}

function registryObjects(registry) {
  const objects = registry?.allObjects;
  requireValue(Array.isArray(objects));
  const seen = new Set();
  for (const object of objects) {
    requireValue(object && typeof object.id === 'string' && object.id.length > 0 &&
      typeof object.namespace === 'string' && typeof object.isModded === 'boolean');
    requireValue(!seen.has(object.id));
    seen.add(object.id);
    requireValue(object.id.startsWith(`${object.namespace}:`));
    requireValue(object.isModded || SCOPES.some(scope => scope.namespaces.includes(object.namespace)));
  }
  return objects;
}
function target(object, current, maximum, accessible, extra = {}) {
  requireValue(isCount(current) && isCount(maximum) && maximum > 0 && current <= maximum);
  requireValue(accessible === null || typeof accessible === 'boolean');
  return {
    id: object.id, name: typeof object.name === 'string' ? object.name : object.id,
    current, maximum, accessible, ...extra
  };
}
function readSkillTargets(gameObject, scope) {
  const result = [];
  for (const skill of registryObjects(gameObject.skills)) {
    if (skill.isModded) continue;
    requireValue(typeof skill.isUnlocked === 'boolean' && typeof skill.hasAbyssalLevels === 'boolean');
    for (const track of ['standard', ...(skill.hasAbyssalLevels ? ['abyssal'] : [])]) {
      const level = track === 'standard' ? skill.level : skill.abyssalLevel;
      const cap = track === 'standard' ? skill.currentLevelCap : skill.currentAbyssalLevelCap;
      const breakdown = track === 'standard' ? skill.levelCompletionBreakdown : skill.abyssalLevelCompletionBreakdown;
      requireValue(isCount(level) && isCount(cap) && Array.isArray(breakdown) && breakdown.length > 0);
      let offset = 0;
      const seen = new Set();
      for (const block of breakdown) {
        requireValue(block && isCount(block.levels) && block.levels > 0 &&
          SCOPES.some(s => s.namespace === block.namespace) && !seen.has(block.namespace));
        seen.add(block.namespace);
        if (block.namespace === scope.namespace) {
          const maximum = block.levels;
          const current = Math.max(0, Math.min(maximum, level - offset));
          result.push(target(skill, current, maximum, skill.isUnlocked && cap >= offset + maximum,
            { track, targetLevel: offset + maximum }));
        }
        offset += block.levels;
        requireValue(isCount(offset));
      }
    }
  }
  return result;
}
function readMasteryTargets(gameObject, scope) {
  const result = [];
  for (const skill of registryObjects(gameObject.masterySkills)) {
    if (skill.isModded) continue;
    const maximum = skill.masteryLevelCap;
    requireValue(isCount(maximum) && maximum > 0 && typeof skill.isUnlocked === 'boolean');
    for (const action of registryObjects(skill.actions)) {
      if (action.isModded || !scope.namespaces.includes(action.namespace)) continue;
      const current = skill.getMasteryLevel(action);
      const unlocked = skill.isMasteryActionUnlocked(action);
      requireValue(typeof unlocked === 'boolean');
      result.push(target(action, current, maximum, skill.isUnlocked && unlocked, { skillId: skill.id }));
    }
  }
  return result;
}
function readCollectionTargets(gameObject, scope, category) {
  const result = [];
  for (const object of registryObjects(gameObject[category])) {
    if (object.isModded || !scope.namespaces.includes(object.namespace)) continue;
    requireValue(typeof object.ignoreCompletion === 'boolean');
    if (object.ignoreCompletion) continue;
    let current;
    if (category === 'pets') {
      const unlocked = gameObject.petManager.isPetUnlocked(object);
      requireValue(typeof unlocked === 'boolean');
      current = unlocked ? 1 : 0;
    } else {
      const count = category === 'items' ? gameObject.stats.itemFindCount(object) : gameObject.stats.monsterKillCount(object);
      requireValue(isCount(count));
      current = count > 0 ? 1 : 0;
    }
    result.push(target(object, current, 1, null));
  }
  return result;
}
function readCategory(gameObject, scope, category) {
  try {
    const progress = gameObject.completion[CATEGORIES[category]];
    const current = progress.currentCount.getCompValue(scope.namespace);
    const maximum = progress.maximumCount.getCompValue(scope.namespace);
    const percent = progress.getPercent(scope.namespace);
    requireValue(isCount(current) && isCount(maximum) && current <= maximum && isPercent(percent));
    const entries = category === 'skills' ? readSkillTargets(gameObject, scope)
      : category === 'mastery' ? readMasteryTargets(gameObject, scope)
      : readCollectionTargets(gameObject, scope, category);
    const seen = new Set();
    for (const entry of entries) {
      const key = JSON.stringify([entry.skillId ?? '', entry.id, entry.track ?? '']);
      requireValue(!seen.has(key));
      seen.add(key);
    }
    requireValue(entries.reduce((sum, entry) => sum + entry.current, 0) === current &&
      entries.reduce((sum, entry) => sum + entry.maximum, 0) === maximum);
    // No rounded/displayed percentage may hide a missing target.
    if (maximum > 0) requireValue(Math.abs(percent - 100 * current / maximum) < 1e-7);
    else requireValue(percent === 0 || percent === 100);
    const ordered = entries.sort((a, b) => {
      const key = entry => JSON.stringify([entry.skillId ?? '', entry.id, entry.track ?? '']);
      return key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0;
    });
    return { supported: true, status: 'observed', reason: null, percent, current, maximum,
      entries: ordered, missing: ordered.filter(entry => entry.current < entry.maximum).map(entry => ({ ...entry })) };
  } catch {
    return unavailable('category-api-invalid-or-inconsistent');
  }
}

/**
 * Mock-only GameAdapter -> detached snapshot. Never called by setup/readSnapshot.
 * Context contains fixture version/entitlements, not user-selected goals.
 */
export function readCompletionForTesting(gameObject, context) {
  try {
    if (context?.version !== 'v1.3.1') return blockedSnapshot('version-unverified');
    const mode = gameObject.currentGamemode;
    requireValue(mode && typeof mode.id === 'string' && mode.id.length > 0 && typeof mode.isPermaDeath === 'boolean');
    const scopes = SCOPES.map(scope => {
      const owned = context.ownership?.[scope.id];
      const ownership = typeof owned === 'boolean' ? owned : null;
      const base = { id: scope.id, ownership, percent: null, achieved: false };
      if (ownership !== true) return { ...base, supported: false,
        status: ownership === false ? 'excluded' : 'blocked',
        reason: ownership === false ? 'not-owned' : 'ownership-unknown', categories: {} };
      let percent = null;
      try {
        const value = gameObject.completion[scope.total];
        if (isPercent(value)) percent = value;
      } catch { /* fixed reason below; never expose exception messages */ }
      const categories = Object.fromEntries(Object.keys(CATEGORIES).map(category =>
        [category, readCategory(gameObject, scope, category)]));
      const supported = percent !== null && Object.values(categories).every(category => category.supported);
      const missing = Object.values(categories).some(category => category.missing.length > 0);
      const hasDenominator = Object.values(categories).some(category => category.maximum > 0);
      // An aggregate claiming 100 while any category disagrees is unknown.
      const consistent = percent !== 100 || (!missing && Object.values(categories).every(c => c.current === c.maximum));
      return { ...base, percent, categories, supported: supported && consistent,
        status: supported && consistent ? 'observed' : 'blocked',
        reason: supported && consistent ? null : 'scope-data-incomplete-or-inconsistent',
        achieved: supported && consistent && hasDenominator && percent === 100 && !missing };
    });
    const owned = scopes.filter(scope => scope.ownership === true);
    const supported = scopes.every(scope => scope.ownership !== null) && owned.length > 0 && owned.every(scope => scope.supported);
    return { version: context.version, mode: { id: mode.id, hardcore: mode.isPermaDeath },
      dataAvailable: owned.some(scope => Object.values(scope.categories).some(category => category.supported)),
      completion: { supported, status: supported ? 'observed' : 'blocked',
        reason: supported ? null : 'completion-observation-incomplete',
        achieved: supported && owned.every(scope => scope.achieved), scopes } };
  } catch {
    return blockedSnapshot('mode-or-context-api-invalid');
  }
}

/** Pure candidate generation; no game references, clock, random or user goals. */
export function generateCompletionCandidates(snapshot) {
  const candidates = [];
  const blockers = [];
  if (!Array.isArray(snapshot?.completion?.scopes) || snapshot.completion.scopes.length === 0)
    return { candidates, blockers: [{ id: 'completion', reason: snapshot?.completion?.reason ?? 'completion-unavailable' }] };
  for (const scope of snapshot.completion.scopes) {
    if (scope.status === 'excluded' && scope.ownership === false) continue;
    if (scope.ownership !== true) {
      blockers.push({ id: scope.id, reason: 'ownership-unknown' });
      continue;
    }
    if (!scope.supported) blockers.push({ id: scope.id, reason: scope.reason ?? 'scope-unavailable' });
    for (const category of Object.keys(CATEGORIES)) {
      const state = scope.categories?.[category];
      if (state?.supported !== true || !Array.isArray(state.missing)) {
        blockers.push({ id: `${scope.id}:${category}`, reason: state?.reason ?? 'category-unavailable' });
        continue;
      }
      for (const entry of state.missing) {
        if (!entry || typeof entry.id !== 'string' || !isCount(entry.current) || !isCount(entry.maximum) || entry.current >= entry.maximum) {
          blockers.push({ id: `${scope.id}:${category}`, reason: 'target-invalid' });
          continue;
        }
        const reason = entry.accessible === false ? 'locked-or-level-cap'
          : category === 'monsters' ? (snapshot.mode?.hardcore ? 'hardcore-combat-unverified' : 'combat-risk-unknown')
          : 'acquisition-path-unverified';
        candidates.push({ id: JSON.stringify([scope.id, category, entry.skillId ?? '', entry.id, entry.track ?? '']),
          type: 'completion-target', scopeId: scope.id, category, targetId: entry.id,
          skillId: entry.skillId ?? null, track: entry.track ?? null,
          title: `${scope.id} / ${category}: ${entry.name ?? entry.id} (${entry.current}/${entry.maximum})`,
          current: entry.current, maximum: entry.maximum, targetLevel: entry.targetLevel ?? null,
          executionStatus: 'blocked', reason, runnable: false });
      }
    }
  }
  return { candidates: candidates.sort(compareID), blockers: blockers.sort(compareID) };
}

export function chooseNextGoal(snapshot) {
  const { candidates, blockers } = generateCompletionCandidates(snapshot);
  if (candidates.length > 0) return candidates[0];
  return { id: 'needs-completion-adapter', type: 'blocked',
    title: 'Completion解析は実機確認待ちです',
    reason: blockers.map(blocker => `${blocker.id}: ${blocker.reason}`).join('; ') || '実行経路は未実装です。',
    runnable: false };
}

export function setup(ctx) {
  ctx.onInterfaceReady(() => {
    if (typeof document === 'undefined') return;
    let timer = null;
    let lastGoalId = '';
    const logEntries = [];

    const root = document.createElement('section');
    root.id = 'melvor-autopilot-panel';
    root.setAttribute('aria-label', 'Melvor Autopilot');
    Object.assign(root.style, {
      position: 'fixed', bottom: '16px', right: '16px', zIndex: '1050',
      width: '320px', maxWidth: 'calc(100vw - 32px)',
      background: '#17202d', color: '#f5f7fc', border: '1px solid #607087',
      borderRadius: '10px', padding: '12px', boxShadow: '0 4px 18px #0009',
      font: '13px/1.5 system-ui, sans-serif'
    });
    const heading = document.createElement('div');
    heading.textContent = 'Melvor Autopilot — v0.1.0';
    heading.style.fontWeight = 'bold';
    heading.style.marginBottom = '4px';
    const mode = document.createElement('div');
    mode.textContent = '解析専用 / ゲーム操作なし';
    mode.style.color = '#ffdc8b';
    const status = document.createElement('div');
    status.textContent = '停止中';
    status.style.marginTop = '8px';
    const detail = document.createElement('div');
    detail.textContent = '開始すると、目標を指定せずに次の候補を選びます。';
    detail.style.margin = '6px 0';
    const actions = document.createElement('div');
    actions.style.display = 'flex';
    actions.style.gap = '8px';
    const start = document.createElement('button');
    start.type = 'button';
    start.textContent = '解析開始';
    const stop = document.createElement('button');
    stop.type = 'button';
    stop.textContent = '緊急停止';
    stop.disabled = true;
    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'ログ出力';
    for (const button of [start, stop, exportButton]) {
      button.style.padding = '5px 7px';
      button.style.borderRadius = '6px';
      button.style.border = '1px solid #8493a7';
      button.style.background = '#263b55';
      button.style.color = '#fff';
      actions.appendChild(button);
    }
    const log = document.createElement('div');
    log.style.color = '#f5f7fc';
    log.style.whiteSpace = 'pre-wrap';
    log.style.wordBreak = 'break-word';
    log.style.maxHeight = '105px';
    log.style.overflowY = 'auto';
    log.style.fontSize = '11px';
    log.textContent = 'ログはこのウィンドウに表示されます。';
    root.append(heading, mode, status, detail, actions, log);
    (document.body || document.documentElement).appendChild(root);

    function appendLog(message) {
      const entry = { timestamp: new Date().toISOString(), message };
      logEntries.push(entry);
      if (logEntries.length > LOG_LIMIT) logEntries.shift();
      log.textContent = logEntries.slice(-6).map(x => `${x.timestamp.slice(11, 19)} ${x.message}`).join('\n');
    }
    function pause(reason = '手動停止') {
      if (timer !== null) clearInterval(timer);
      timer = null;
      status.textContent = '停止中';
      start.disabled = false;
      stop.disabled = true;
      appendLog(reason);
    }
    function tick() {
      try {
        if (typeof game === 'undefined') {
          status.textContent = 'ゲーム情報待機中';
          return;
        }
        const snapshot = readSnapshot(game);
        const goal = chooseNextGoal(snapshot);
        status.textContent = snapshot.completion.supported ? 'Completion観測済み（解析のみ）' : 'Completion API実機未確認';
        detail.textContent = goal.title;
        if (goal.id !== lastGoalId) {
          appendLog(`提案: ${goal.title} / ${goal.reason}`);
          lastGoalId = goal.id;
        }
        // Critical safety boundary: no game mutations at all in v0.1.0.
      } catch {
        appendLog('解析エラー: 観測に失敗しました');
        pause('エラーで停止');
      }
    }
    start.addEventListener('click', () => {
      if (timer !== null) return;
      appendLog('解析を開始しました（実行機能は未実装）');
      start.disabled = true;
      stop.disabled = false;
      lastGoalId = '';
      timer = setInterval(tick, POLL_INTERVAL_MS);
      tick();
    });
    stop.addEventListener('click', () => pause());
    exportButton.addEventListener('click', () => {
      const body = JSON.stringify({ app: 'Melvor Autopilot', version: '0.1.0', logs: logEntries }, null, 2);
      const blob = new Blob([body], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = 'melvor-autopilot-log.json';
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
    appendLog('初期化完了。ゲーム進行に変更は加えません。');
  });
}
