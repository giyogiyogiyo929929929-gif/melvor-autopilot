/** Mock-only current selection observer. No operation or reward permission is generated. */
import { noncombatKind, observeNoncombatSelection } from './noncombat-selection.mjs';
const SCOPES = new Map([['melvorD', 'base'], ['melvorF', 'base'], ['melvorTotH', 'toth'], ['melvorAoD', 'aod'], ['melvorItA', 'ita']]);
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const requireValue = valid => { if (!valid) throw new Error('action-selection-invalid'); };
const failed = reason => ({ version: null, mode: null, origin: 'mock-only', supported: false, reason,
  actionSelection: { supported: false, actionId: null, selectionIds: [], reason }, woodcutting: null, runnable: false });
export function readActionSelection(_game, _context) { return { ...failed('runtime-action-selection-unverified'), origin: 'runtime-disabled' }; }
function action(value) {
  if (value === undefined) return null; requireValue(id(value?.id) && typeof value.isActive === 'boolean'); return { id: value.id, isActive: value.isActive };
}
function identity(value) {
  const result = { id: value?.id, namespace: value?.namespace, isModded: value?.isModded };
  requireValue(id(result.id) && typeof result.namespace === 'string' && typeof result.isModded === 'boolean' && result.id.startsWith(`${result.namespace}:`)); return result;
}
export function readActionSelectionForTesting(game, context) {
  try {
    if (context?.version !== 'v1.3.1') return failed('version-unverified');
    const expected = context.expectedActionId, wanted = context.treeIds === undefined ? [] : context.treeIds,
      maximumBytes = context.maximumBytes === undefined ? 65_536 : context.maximumBytes;
    if (!id(context.observationId) || context.observationId.length > 256 || context.ownership?.base !== true ||
        (expected !== undefined && !id(expected)) || !Array.isArray(wanted) || wanted.length > 64 || !wanted.every(id) || new Set(wanted).size !== wanted.length ||
        !count(maximumBytes) || maximumBytes < 1024 || maximumBytes > 1_048_576) return failed('action-selection-context-invalid');
    const mode = game.currentGamemode, modeId = mode?.id, hardcore = mode?.isPermaDeath, raid = game.isGolbinRaid, paused = game.isPaused;
    requireValue(id(modeId) && typeof hardcore === 'boolean' && typeof raid === 'boolean' && typeof paused === 'boolean');
    if (raid) return failed('raid-action-selection-unverified');
    const active = action(game.activeAction), suspended = action(game.pausedAction), requestedId = expected ?? active?.id ?? suspended?.id ?? null;
    const base = { version: 'v1.3.1', mode: { id: modeId, hardcore }, observationId: context.observationId, origin: 'mock-only', activity: { active, paused: suspended, isPaused: paused }, runnable: false };
    const bounded = result => new TextEncoder().encode(JSON.stringify(result)).length <= maximumBytes ? result : failed('action-selection-output-byte-limit');
    if (requestedId === null) return bounded({ ...base, supported: true, reason: null, actionSelection: { supported: true, actionId: null, selectionIds: [], state: 'idle' }, woodcutting: null });
    if (noncombatKind(requestedId)) return bounded({ ...base, ...observeNoncombatSelection(game, requestedId, context.ownership, base.activity) });
    if (!['melvorD:Woodcutting', 'melvorF:Woodcutting'].includes(requestedId)) return bounded({ ...base, supported: false, reason: 'action-selector-unverified',
      actionSelection: { supported: false, actionId: requestedId, selectionIds: [], reason: 'action-selector-unverified' }, woodcutting: null });
    const wc = game.woodcutting, skill = identity(wc); requireValue(skill.id === requestedId && !skill.isModded && SCOPES.get(skill.namespace) === 'base');
    const unlocked = wc.isUnlocked, isActive = wc.isActive, canStop = wc.canStop, selected = wc.activeTrees;
    requireValue(typeof unlocked === 'boolean' && typeof isActive === 'boolean' && typeof canStop === 'boolean' && selected instanceof Set && selected.size <= 64);
    requireValue(!isActive || active?.id === skill.id && active.isActive === true && selected.size > 0);
    requireValue(isActive || active?.id !== skill.id || active.isActive !== true || paused);
    const selectedObjects = new Map(), treeIds = new Set(wanted);
    for (const tree of selected) {
      const value = identity(tree); requireValue(!value.isModded && context.ownership[SCOPES.get(value.namespace)] === true && !selectedObjects.has(value.id));
      selectedObjects.set(value.id, tree); treeIds.add(value.id);
    }
    requireValue(treeIds.size <= 128); const trees = [];
    for (const treeId of [...treeIds].sort(compare)) {
      requireValue(context.ownership[SCOPES.get(treeId.split(':')[0])] === true);
      const tree = wc.actions.getObjectByID(treeId), value = identity(tree);
      requireValue(value.id === treeId && !value.isModded && context.ownership[SCOPES.get(value.namespace)] === true &&
        (!selectedObjects.has(treeId) || selectedObjects.get(treeId) === tree));
      const treeUnlocked = wc.isTreeUnlocked(tree), productId = identity(tree.product).id; requireValue(typeof treeUnlocked === 'boolean');
      trees.push({ id: treeId, unlocked: treeUnlocked, outputIds: [productId], outputsEvidence: 'unknown' });
    }
    const activeTreeIds = [...selectedObjects.keys()].sort(compare);
    const state = suspended?.id === skill.id || paused && active?.id === skill.id ? 'paused' : isActive ? 'active' : activeTreeIds.length ? 'selected-inactive' : 'idle';
    const result = { ...base, supported: true, reason: null, actionSelection: { supported: true, actionId: skill.id, selectionIds: [...activeTreeIds], state },
      woodcutting: { supported: true, skillId: skill.id, unlocked, isActive, canStop, activeTreeIds, trees, operationEvidence: 'unknown', runnable: false } };
    return bounded(result);
  } catch { return failed('action-selection-api-invalid'); }
}
