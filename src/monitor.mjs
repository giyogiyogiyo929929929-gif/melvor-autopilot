/** Pure task lifecycle decisions over detached observations. No clock or game access. */
import { monitorResourceSnapshotProblem } from './snapshot-validation.mjs';
import { normalizeConsumptionBounds } from './recipe-effects.mjs';
import { selectionVariantSignature, validSelectionVariantSignature } from './selection-variant.mjs';

const SCOPES = new Set(['base', 'toth', 'aod', 'ita']);
const CATEGORIES = new Set(['skills', 'mastery', 'items', 'monsters', 'pets']);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const taskId = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const count = value => Number.isSafeInteger(value) && value >= 0;
const amount = value => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= Number.MAX_SAFE_INTEGER;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => new Set(values).size === values.length;
const validIds = (values, max) => Array.isArray(values) && values.length <= max && values.every(id) && unique(values);
const entryKey = entry => JSON.stringify([entry.skillId ?? '', entry.id, entry.track ?? '']);
const conditionKey = condition => JSON.stringify(condition.type === 'inventory' ? ['inventory', condition.id]
  : [condition.scopeId, condition.category, condition.skillId ?? '', condition.id, condition.track ?? '']);

function taskFor(task) {
  const plannedVariant = selectionVariantSignature(task?.action?.variant);
  if (plannedVariant === null) return null;
  if (!taskId(task?.id) || !id(task.action?.id) || !validIds(task.action.selectionIds, 64) ||
      !Array.isArray(task.endConditions) || task.endConditions.length === 0 || task.endConditions.length > 16 ||
      !record(task.requirements) || !Array.isArray(task.requirements.items) || task.requirements.items.length > 128 ||
      !Array.isArray(task.requirements.currencies) || task.requirements.currencies.length > 64 ||
      !validIds(task.requirements.outputIds, 256) || task.requirements.outputsEvidence !== 'confirmed') return null;
  const orderedCosts = ['bankOrder', 'costEvidence', 'rangeEvidence', 'minimumItems', 'minimumCurrencies']
    .some(key => task.requirements[key] !== undefined);
  let consumption = null;
  if (orderedCosts) {
    if (task.requirements.bankOrder !== 'consume-then-produce') return null;
    const normalized = normalizeConsumptionBounds({ costEvidence: task.requirements.costEvidence, rangeEvidence: task.requirements.rangeEvidence,
      itemCosts: task.requirements.items, currencyCosts: task.requirements.currencies,
      minimumItemCosts: task.requirements.minimumItems, minimumCurrencyCosts: task.requirements.minimumCurrencies });
    if (!normalized.supported) return null;
    consumption = normalized.data;
  }
  if (task.requirements.items.some(item => !id(item?.id) || !count(item.quantity) || item.quantity === 0) ||
      !unique(task.requirements.items.map(item => item.id)) ||
      task.requirements.currencies.some(currency => !id(currency?.id) || !amount(currency.amount)) ||
      !unique(task.requirements.currencies.map(currency => currency.id))) return null;
  const conditions = [];
  for (const condition of task.endConditions) {
    if (!id(condition?.id)) return null;
    if (condition.type === 'inventory') {
      if (!count(condition.quantity) || condition.quantity === 0) return null;
      conditions.push({ type: 'inventory', id: condition.id, quantity: condition.quantity });
    } else if (condition.type === 'completion') {
      if (!SCOPES.has(condition.scopeId) || !CATEGORIES.has(condition.category) ||
          (condition.skillId !== undefined && !id(condition.skillId)) ||
          (condition.track !== undefined && !['standard', 'abyssal'].includes(condition.track))) return null;
      conditions.push({ type: 'completion', scopeId: condition.scopeId, category: condition.category,
        id: condition.id, ...(condition.skillId === undefined ? {} : { skillId: condition.skillId }),
        ...(condition.track === undefined ? {} : { track: condition.track }) });
    } else return null;
  }
  if (!unique(conditions.map(conditionKey))) return null;
  const bounds = { stagnationMs: 60_000, maxDurationMs: 3_600_000, maxObservationGapMs: 60_000, ...task.bounds };
  if (task.bounds !== undefined && (!record(task.bounds) ||
      Object.keys(task.bounds).some(key => !['stagnationMs', 'maxDurationMs', 'maxObservationGapMs'].includes(key)))) return null;
  if (Object.values(bounds).some(value => !count(value) || value === 0 || value > 2_592_000_000)) return null;
  const normalized = { id: task.id, action: { id: task.action.id, selectionIds: [...task.action.selectionIds].sort(compare) },
    endConditions: conditions.sort((a, b) => compare(conditionKey(a), conditionKey(b))), requirements: {
      items: task.requirements.items.map(item => ({ id: item.id, quantity: item.quantity })).sort((a, b) => compare(a.id, b.id)),
      currencies: task.requirements.currencies.map(currency => ({ id: currency.id, amount: currency.amount })).sort((a, b) => compare(a.id, b.id)),
      outputIds: [...task.requirements.outputIds].sort(compare), outputsEvidence: 'confirmed',
      ...(orderedCosts ? { bankOrder: 'consume-then-produce', costEvidence: task.requirements.costEvidence,
        ...(task.requirements.costEvidence === 'bounded' ? { rangeEvidence: 'confirmed',
          minimumItems: consumption.minimumItemCosts, minimumCurrencies: consumption.minimumCurrencyCosts } : {}) } : {}) }, bounds };
  if (plannedVariant !== '') {
    const [kind, value] = JSON.parse(plannedVariant);
    normalized.action.variant = kind === 'fletching' ? { kind, alternativeIndexRaw: value } : { kind, materialId: value };
  }
  return { task: normalized, signature: JSON.stringify(normalized) };
}

function decision(status, reason, checkpoint = null, metrics = null) {
  return { status, reason, stopRequired: !['continue', 'suspended'].includes(status),
    checkpoint, metrics, runnable: false };
}
function checkpointProblem(checkpoint) {
  if (!record(checkpoint) || !taskId(checkpoint.taskId) || !id(checkpoint.sessionId) ||
      typeof checkpoint.signature !== 'string' || checkpoint.signature.length > 3_000_000 ||
      !['watching', 'offline', 'terminal'].includes(checkpoint.phase) ||
      !count(checkpoint.startedAtMs) || !count(checkpoint.lastObservedAtMs) || !count(checkpoint.lastProgressAtMs) ||
      checkpoint.startedAtMs > checkpoint.lastProgressAtMs || checkpoint.lastProgressAtMs > checkpoint.lastObservedAtMs ||
      typeof checkpoint.equipmentSignature !== 'string' || checkpoint.equipmentSignature.length > 4_000_000 ||
      (checkpoint.selectionSignature !== undefined && !validSelectionVariantSignature(checkpoint.selectionSignature)) ||
      !Array.isArray(checkpoint.progress) || checkpoint.progress.length > 16 ||
      checkpoint.progress.some(entry => typeof entry?.key !== 'string' || entry.key.length > 16_384 ||
        !count(entry.current) || !count(entry.maximum) || entry.maximum === 0 || entry.current > entry.maximum ||
        !count(entry.denominator) || entry.denominator < entry.maximum) ||
      !unique(checkpoint.progress.map(entry => entry.key))) return 'checkpoint-invalid';
  if (checkpoint.mode === null) {
    if (checkpoint.phase === 'watching' || checkpoint.progress.length !== 0 || checkpoint.equipmentSignature !== '') return 'checkpoint-invalid';
  } else if (!id(checkpoint.mode?.id) || typeof checkpoint.mode.hardcore !== 'boolean') return 'checkpoint-invalid';
  return null;
}

function completionCategory(snapshot, condition, cache) {
  if (snapshot.completionTargets !== undefined && snapshot.completionTargets !== null) return targetedCompletionCategory(snapshot, condition, cache);
  const completionSnapshot = snapshot.completionSnapshot;
  const resources = snapshot.resources;
  if (completionSnapshot?.version !== 'v1.3.1' || completionSnapshot.mode?.id !== resources.mode.id ||
      completionSnapshot.mode?.hardcore !== resources.mode.hardcore ||
      !Array.isArray(completionSnapshot.completion?.scopes) || completionSnapshot.completion.scopes.length > 4 ||
      !unique(completionSnapshot.completion.scopes.map(scope => scope?.id))) return { reason: 'completion-snapshot-unverified' };
  const scope = completionSnapshot.completion.scopes.find(scope => scope?.id === condition.scopeId);
  if (scope?.ownership !== true) return { reason: scope?.ownership === false ? 'scope-not-owned' : 'scope-ownership-unknown' };
  const key = JSON.stringify([condition.scopeId, condition.category]);
  if (cache.has(key)) return cache.get(key);
  const category = scope.categories?.[condition.category];
  if (category?.supported !== true || category.status !== 'observed' ||
      !count(category.current) || !count(category.maximum) || category.maximum === 0 || category.current > category.maximum ||
      typeof category.percent !== 'number' || !Number.isFinite(category.percent) ||
      Math.abs(category.percent - 100 * category.current / category.maximum) > 1e-7 ||
      !Array.isArray(category.entries) || category.entries.length > 20_000 ||
      !Array.isArray(category.missing) || category.missing.length > category.entries.length)
    return { reason: 'completion-category-unverified' };
  const entries = new Map();
  let current = 0, maximum = 0;
  for (const entry of category.entries) {
    if (!id(entry?.id) || !count(entry.current) || !count(entry.maximum) || entry.maximum === 0 || entry.current > entry.maximum ||
        ![true, false, null].includes(entry.accessible) || (entry.skillId !== undefined && !id(entry.skillId)) ||
        (entry.track !== undefined && !['standard', 'abyssal'].includes(entry.track))) return { reason: 'completion-entry-invalid' };
    const key = entryKey(entry);
    if (entries.has(key)) return { reason: 'completion-entry-duplicate' };
    entries.set(key, entry); current += entry.current; maximum += entry.maximum;
  }
  if (!count(current) || !count(maximum) || current !== category.current || maximum !== category.maximum)
    return { reason: 'completion-aggregate-inconsistent' };
  const missing = new Set();
  for (const entry of category.missing) {
    const key = entryKey(entry);
    const full = entries.get(key);
    if (!full || missing.has(key) || full.current === full.maximum || entry.current !== full.current || entry.maximum !== full.maximum)
      return { reason: 'completion-missing-inconsistent' };
    missing.add(key);
  }
  if ([...entries].some(([key, entry]) => (entry.current < entry.maximum) !== missing.has(key)))
    return { reason: 'completion-missing-inconsistent' };
  const result = { reason: null, entries, denominator: maximum };
  cache.set(key, result);
  return result;
}

function targetedCompletionCategory(snapshot, condition, cache) {
  const source = snapshot.completionTargets, resources = snapshot.resources;
  if (snapshot.completionSnapshot !== undefined && snapshot.completionSnapshot !== null || source?.version !== 'v1.3.1' || source.origin !== 'mock-only' ||
      source.coverage !== 'targets-only' || source.fullCoverage !== false || source.mode?.id !== resources.mode.id || source.mode.hardcore !== resources.mode.hardcore ||
      !id(source.observationId) || !Array.isArray(source.targets) || source.targets.length > 16) return { reason: 'completion-targets-snapshot-unverified' };
  if (source.ownership?.[condition.scopeId] !== true) return { reason: source.ownership?.[condition.scopeId] === false ? 'scope-not-owned' : 'scope-ownership-unknown' };
  const cacheKey = JSON.stringify(['targets', condition.scopeId, condition.category]); if (cache.has(cacheKey)) return cache.get(cacheKey);
  const seen = new Set(), entries = new Map(); let denominator = null;
  for (const entry of source.targets) {
    if (!SCOPES.has(entry?.scopeId) || !CATEGORIES.has(entry.category) || !id(entry.id) ||
        (entry.skillId !== undefined && !id(entry.skillId)) || (entry.track !== undefined && !['standard', 'abyssal'].includes(entry.track))) return { reason: 'completion-targets-entry-invalid' };
    const targetKey = conditionKey({ ...entry, type: 'completion' }); if (seen.has(targetKey)) return { reason: 'completion-targets-entry-duplicate' }; seen.add(targetKey);
    if (entry.scopeId !== condition.scopeId || entry.category !== condition.category) continue;
    if (entry.supported !== true || entry.status !== 'observed' || !count(entry.current) || !count(entry.maximum) || entry.maximum < 1 || entry.current > entry.maximum ||
        !count(entry.categoryMaximum) || entry.categoryMaximum < entry.maximum || ![true, false, null].includes(entry.accessible)) return { reason: 'completion-target-unverified' };
    if (denominator !== null && denominator !== entry.categoryMaximum) return { reason: 'completion-targets-denominator-inconsistent' };
    denominator = entry.categoryMaximum; entries.set(entryKey(entry), { id: entry.id, current: entry.current, maximum: entry.maximum, accessible: entry.accessible,
      ...(entry.skillId === undefined ? {} : { skillId: entry.skillId }), ...(entry.track === undefined ? {} : { track: entry.track }) });
  }
  if (denominator === null) return { reason: 'completion-target-unobserved' };
  const result = { reason: null, entries, denominator }; cache.set(cacheKey, result); return result;
}

/** Task criteria come from the planner, never a player goal input. Context is supplied. */
export function monitorTask(task, snapshot, checkpoint = null, context) {
  try { return monitor(task, snapshot, checkpoint, context); }
  catch { return decision('blocked', 'monitor-input-unreadable'); }
}

/** Used by the compiler to validate and detach generated criteria without observing a game. */
export function normalizeMonitorTask(task) {
  try { return taskFor(task)?.task ?? null; }
  catch { return null; }
}

function monitor(inputTask, snapshot, previous, context) {
  if (context?.stopRequested === true) return decision('stopped', 'user-stop');
  if (!record(context) || !count(context.nowMs) || !id(context.sessionId) ||
      (context.offline !== undefined && typeof context.offline !== 'boolean') ||
      (context.stopRequested !== undefined && typeof context.stopRequested !== 'boolean')) return decision('blocked', 'monitor-context-invalid');
  const normalized = taskFor(inputTask);
  if (!normalized) return decision('blocked', 'monitor-task-invalid');
  const { task, signature } = normalized;
  if (previous !== null) {
    const problem = checkpointProblem(previous);
    if (problem) return decision('blocked', problem);
    if (previous.taskId !== task.id || previous.signature !== signature) return decision('blocked', 'task-checkpoint-conflict');
    if (context.nowMs < previous.lastObservedAtMs) return decision('blocked', 'observation-time-reversed');
    if (previous.phase === 'terminal') return decision('blocked', 'monitor-terminal');
  }
  const next = previous === null ? null : { taskId: previous.taskId, signature: previous.signature,
    sessionId: previous.sessionId, phase: previous.phase,
    mode: previous.mode === null ? null : { id: previous.mode.id, hardcore: previous.mode.hardcore },
    startedAtMs: previous.startedAtMs, lastProgressAtMs: previous.lastProgressAtMs, lastObservedAtMs: context.nowMs,
    equipmentSignature: previous.equipmentSignature, ...(previous.selectionSignature === undefined ? {} : { selectionSignature: previous.selectionSignature }),
    progress: previous.progress.map(entry => ({ key: entry.key, current: entry.current,
      maximum: entry.maximum, denominator: entry.denominator })) };
  const finish = (status, reason, state = next, metrics = null) =>
    decision(status, reason, state === null ? null : { ...state, phase: status === 'suspended' ? 'offline' : 'terminal' }, metrics);
  if (previous && context.sessionId !== previous.sessionId) return finish('replan', 'session-changed');
  // Offline snapshots may be stale. Do not request a game stop or read their getters.
  if (context.offline) return decision('suspended', 'game-offline', next === null ? {
    taskId: task.id, signature, sessionId: context.sessionId, phase: 'offline', mode: null,
    startedAtMs: context.nowMs, lastObservedAtMs: context.nowMs, lastProgressAtMs: context.nowMs,
    equipmentSignature: '', progress: [] } : { ...next, phase: 'offline' });
  if (previous?.phase === 'offline') return finish('replan', 'offline-return');
  if (previous && context.nowMs - previous.lastObservedAtMs >= task.bounds.maxObservationGapMs)
    return finish('replan', 'observation-gap');
  const problem = monitorResourceSnapshotProblem(snapshot?.resources, task);
  if (problem) return finish('blocked', problem);
  const resources = snapshot.resources;
  if (previous && (resources.mode.id !== previous.mode.id || resources.mode.hardcore !== previous.mode.hardcore))
    return finish('replan', 'mode-changed');
  const categories = resources.categories;
  const selected = categories.equipment.data.sets[categories.equipment.data.selectedSet];
  const equipmentSignature = JSON.stringify([categories.equipment.data.selectedSet,
    [...selected.slots].sort((a, b) => compare(a.slotId, b.slotId))]);
  if (previous && previous.equipmentSignature !== equipmentSignature) return finish('replan', 'equipment-changed');
  const inventory = new Map(categories.bank.data.items.map(item => [item.id, item]));
  const cache = new Map();
  const progress = [];
  for (const condition of task.endConditions) {
    const key = conditionKey(condition);
    if (condition.type === 'inventory') {
      progress.push({ key, current: Math.min(inventory.get(condition.id)?.quantity ?? 0, condition.quantity),
        maximum: condition.quantity, denominator: condition.quantity });
    } else {
      const category = completionCategory(snapshot, condition, cache);
      if (category.reason) return finish('blocked', category.reason);
      const entry = category.entries.get(entryKey(condition));
      if (!entry) return finish('blocked', 'completion-target-unobserved');
      if (entry.accessible === false && entry.current < entry.maximum) return finish('blocked', 'completion-target-locked');
      progress.push({ key, current: entry.current, maximum: entry.maximum, denominator: category.denominator });
    }
  }
  const state = next ?? { taskId: task.id, signature, sessionId: context.sessionId, phase: 'watching',
    mode: { id: resources.mode.id, hardcore: resources.mode.hardcore }, startedAtMs: context.nowMs, lastObservedAtMs: context.nowMs,
    lastProgressAtMs: context.nowMs, equipmentSignature, progress: progress.map(entry => ({ ...entry })) };
  let progressed = false;
  if (previous) {
    if (previous.progress.length !== progress.length) return finish('blocked', 'checkpoint-progress-conflict', state);
    for (const entry of progress) {
      const old = previous.progress.find(item => item.key === entry.key);
      if (!old || old.maximum !== entry.maximum || old.denominator !== entry.denominator)
        return finish('replan', 'completion-denominator-changed', state);
      if (entry.current < old.current) return finish('blocked', 'task-progress-regressed', state);
      progressed ||= entry.current > old.current;
    }
  }
  state.progress = progress;
  if (progressed) state.lastProgressAtMs = context.nowMs;
  const metrics = { elapsedMs: context.nowMs - state.startedAtMs, stagnantMs: context.nowMs - state.lastProgressAtMs, progressed };
  if (progress.every(entry => entry.current === entry.maximum)) return finish('complete', 'end-conditions-satisfied', state, metrics);
  const activity = categories.activity.data;
  if (activity.isPaused || activity.paused !== null) return finish('stopped', 'game-paused', state, metrics);
  if (activity.active?.id !== task.action.id || activity.active.isActive !== true)
    return finish('replan', 'expected-action-changed', state, metrics);
  const selection = snapshot.actionSelection;
  if (selection?.supported !== true || selection.actionId !== task.action.id || !validIds(selection.selectionIds, 64))
    return finish('blocked', 'action-selection-unverified', state, metrics);
  if (JSON.stringify([...selection.selectionIds].sort(compare)) !== JSON.stringify(task.action.selectionIds))
    return finish('replan', 'action-selection-changed', state, metrics);
  const variantSignature = selectionVariantSignature(selection.variant);
  if (variantSignature === null) return finish('blocked', 'action-selection-variant-unverified', state, metrics);
  if (task.action.variant !== undefined && selectionVariantSignature(task.action.variant) !== variantSignature) return finish('replan', 'action-selection-variant-changed', state, metrics);
  if (previous && (previous.selectionSignature ?? '') !== variantSignature) return finish('replan', 'action-selection-variant-changed', state, metrics);
  state.selectionSignature = variantSignature;
  for (const item of task.requirements.items) {
    const held = inventory.get(item.id);
    if (!held || held.quantity < item.quantity) return finish('blocked', 'materials-insufficient', state, metrics);
    if (held.locked) return finish('blocked', 'material-protected', state, metrics);
  }
  const currencies = new Map(categories.currencies.data.currencies.map(currency => [currency.id, currency.amount]));
  for (const currency of task.requirements.currencies) {
    if (!currencies.has(currency.id)) return finish('blocked', 'currency-unobserved', state, metrics);
    if (currencies.get(currency.id) < currency.amount) return finish('blocked', 'currency-insufficient', state, metrics);
  }
  const receiving = new Set(inventory.keys());
  let releasedSlots = 0;
  if (task.requirements.bankOrder === 'consume-then-produce') {
    const minimumItems = task.requirements.costEvidence === 'bounded' ? task.requirements.minimumItems : task.requirements.items;
    for (const item of minimumItems) if (inventory.get(item.id)?.quantity === item.quantity) { receiving.delete(item.id); releasedSlots++; }
  }
  const occupied = resources.coverage === 'targets-only' ? categories.bank.data.occupiedSlots - releasedSlots : receiving.size;
  if (task.requirements.outputIds.filter(id => !receiving.has(id)).length > Math.max(0, categories.bank.data.maximumSlots - occupied))
    return finish('blocked', 'bank-capacity-insufficient', state, metrics);
  if (metrics.elapsedMs >= task.bounds.maxDurationMs) return finish('blocked', 'task-duration-limit', state, metrics);
  if (metrics.stagnantMs >= task.bounds.stagnationMs) return finish('blocked', 'task-stagnant', state, metrics);
  return decision('continue', progressed ? 'target-progressed' : 'awaiting-target-progress', { ...state, phase: 'watching' }, metrics);
}
