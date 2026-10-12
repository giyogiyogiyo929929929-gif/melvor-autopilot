/** Woodcutting transaction protocol over artificial ports ONLY. No game adapter. */
import { resourceSnapshotProblem } from './snapshot-validation.mjs';
const SKILL_ID = 'melvorF:Woodcutting';
const validId = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const validCommandId = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const count = value => Number.isSafeInteger(value) && value >= 0;
const result = (status, reason, cleanup = null) => ({ status, reason, cleanup, runnable: false });

/** Caller flags can never activate unverified runtime operations. */
export function createWoodcuttingExecutor(_game, _options) {
  return Object.freeze({ start: () => result('blocked', 'runtime-operation-unverified'),
    execute: async () => result('blocked', 'runtime-operation-unverified'),
    stop: async () => result('stopped', 'runtime-operation-unverified'),
    abandon: () => result('stopped', 'runtime-operation-unverified'),
    getState: () => ({ status: 'stopped', reason: 'runtime-operation-unverified', busy: false,
      pendingMutation: false, requiresReview: false, checkpoints: [], runnable: false }) });
}

function snapshotProblem(snapshot) {
  const resources = snapshot?.resources;
  const wc = snapshot?.woodcutting;
  const problem = resourceSnapshotProblem(resources);
  if (problem) return problem;
  if (wc?.supported !== true || wc.skillId !== SKILL_ID || typeof wc.isActive !== 'boolean' ||
      typeof wc.unlocked !== 'boolean' || typeof wc.canStop !== 'boolean' ||
      !Array.isArray(wc.activeTreeIds) || wc.activeTreeIds.length > 16 || wc.activeTreeIds.some(id => !validId(id)) ||
      new Set(wc.activeTreeIds).size !== wc.activeTreeIds.length ||
      !Array.isArray(wc.trees) || wc.trees.length > 1024 || wc.trees.some(tree => !validId(tree?.id)) ||
      new Set(wc.trees.map(tree => tree.id)).size !== wc.trees.length) return 'woodcutting-unverified';
  return null;
}

function runningTarget(snapshot, treeId) {
  const action = snapshot.resources.categories.activity.data.active;
  const wc = snapshot.woodcutting;
  return action?.id === SKILL_ID && action.isActive === true && wc.isActive &&
    wc.activeTreeIds.length === 1 && wc.activeTreeIds[0] === treeId;
}

function precondition(snapshot, treeId) {
  const problem = snapshotProblem(snapshot);
  if (problem) return problem;
  const wc = snapshot.woodcutting;
  const activity = snapshot.resources.categories.activity.data;
  const tree = wc.trees.find(tree => tree.id === treeId);
  if (!wc.unlocked || tree?.unlocked !== true) return 'tree-locked-or-unknown';
  if (activity.isPaused || activity.paused !== null) return 'game-paused';
  if (!Array.isArray(tree.outputIds) || tree.outputIds.length === 0 || tree.outputIds.length > 256 ||
      tree.outputIds.some(id => !validId(id)) || new Set(tree.outputIds).size !== tree.outputIds.length ||
      tree.outputsEvidence !== 'confirmed') return 'possible-outputs-unverified';
  const bank = snapshot.resources.categories.bank.data;
  const held = new Set(bank.items.map(item => item.id));
  if (tree.outputIds.filter(id => !held.has(id)).length > bank.freeSlots) return 'bank-capacity-insufficient';
  if (runningTarget(snapshot, treeId)) return 'already-running';
  if (activity.active !== null || wc.isActive) return 'other-action-active';
  if (wc.activeTreeIds.length > 0) return 'idle-selection-ambiguous';
  if (!wc.canStop) return 'stop-capability-unverified';
  return null;
}

function postcondition(before, after, treeId) {
  const problem = snapshotProblem(after);
  if (problem) return problem;
  if (!runningTarget(after, treeId) || after.resources.categories.activity.data.isPaused ||
      after.resources.categories.activity.data.paused !== null) return 'target-action-not-confirmed';
  if (!after.woodcutting.unlocked || after.woodcutting.trees.find(tree => tree.id === treeId)?.unlocked !== true)
    return 'tree-unlock-changed';
  if (after.resources.mode.id !== before.resources.mode.id ||
      after.resources.mode.hardcore !== before.resources.mode.hardcore) return 'mode-changed';
  const beforeCategories = before.resources.categories;
  const afterCategories = after.resources.categories;
  if (JSON.stringify(beforeCategories.currencies.data) !== JSON.stringify(afterCategories.currencies.data) ||
      JSON.stringify(beforeCategories.equipment.data) !== JSON.stringify(afterCategories.equipment.data)) return 'unrelated-resources-changed';
  const quantities = new Map(afterCategories.bank.data.items.map(item => [item.id, item.quantity]));
  if (beforeCategories.bank.data.items.some(item => (quantities.get(item.id) ?? 0) < item.quantity)) return 'inventory-decreased';
  return null;
}

function timed(call, timeoutMs) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('port-timeout')), timeoutMs); });
  return Promise.race([Promise.resolve().then(call), timeout]).finally(() => clearTimeout(timer));
}

/** No exported/runtime UI calls this. Ports must operate on synthetic fixtures only. */
export function createWoodcuttingExecutorForTesting(ports, options = {}) {
  const timeoutMs = options?.timeoutMs ?? 5000;
  const maxCheckpoints = options?.maxCheckpoints ?? 1000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30_000 ||
      !Number.isSafeInteger(maxCheckpoints) || maxCheckpoints < 1 || maxCheckpoints > 1000 ||
      !ports || !['observe', 'selectTree', 'stop'].every(key => typeof ports[key] === 'function'))
    return createWoodcuttingExecutor();
  const port = { observe: ports.observe, selectTree: ports.selectTree, stop: ports.stop };
  let status = 'stopped', reason = 'default-stopped', generation = 0, busy = false;
  let pendingMutation = false, requiresReview = false, ownedTree = null, cleanupFlight = null;
  const checkpoints = new Map();
  async function observe() {
    // Only read failures retry; ambiguous mutation failures never retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try { return structuredClone(await timed(() => port.observe(), timeoutMs)); }
      catch { if (attempt === 1) throw new Error('observation-unavailable'); }
    }
  }
  function disable(why, review = false) {
    generation++; status = 'stopped'; reason = why; requiresReview ||= review;
  }
  function cleanupOwned() {
    if (cleanupFlight) return cleanupFlight;
    if (ownedTree === null) return Promise.resolve('no-owned-action');
    const target = ownedTree;
    cleanupFlight = (async () => {
      try {
        const observedWhilePending = pendingMutation;
        const before = await observe();
        if (snapshotProblem(before)) return 'stop-observation-unverified';
        const wc = before.woodcutting;
        const active = before.resources.categories.activity.data.active;
        if (!wc.isActive && active === null) {
          if (pendingMutation || observedWhilePending) return 'operation-still-pending';
          ownedTree = null; return 'already-stopped';
        }
        if (!runningTarget(before, target)) return 'other-action-not-owned';
        if (!wc.canStop) return 'stop-not-allowed';
        const stopped = await timed(() => port.stop(), timeoutMs);
        if (stopped !== true) return 'stop-not-confirmed';
        const after = await observe();
        if (snapshotProblem(after) || after.woodcutting.isActive ||
            after.resources.categories.activity.data.active !== null || after.woodcutting.activeTreeIds.length !== 0)
          return 'stop-postcondition-failed';
        if (!pendingMutation && !observedWhilePending) ownedTree = null;
        return pendingMutation || observedWhilePending ? 'operation-still-pending' : 'stopped-verified';
      } catch { return 'stop-outcome-unknown'; }
    })().then(cleanup => {
      if (!['no-owned-action', 'already-stopped', 'stopped-verified'].includes(cleanup)) requiresReview = true;
      return cleanup;
    }).finally(() => { cleanupFlight = null; });
    return cleanupFlight;
  }
  return Object.freeze({
    start(context) {
      if (busy || pendingMutation || cleanupFlight) return result('blocked', 'executor-busy');
      if (requiresReview) return result('blocked', 'manual-review-required');
      if (context?.version !== 'v1.3.1' || context.saveCopy !== true || context.developmentProfile !== true ||
          context.modsCompatible !== true || context.operationsVerified !== true)
        return result('blocked', 'session-preconditions-unverified');
      generation++; status = 'ready'; reason = null;
      return result('ready', null);
    },
    async execute(command) {
      if (status !== 'ready') return result('blocked', 'executor-stopped');
      if (busy || pendingMutation || cleanupFlight) return result('blocked', 'executor-busy');
      if (!validCommandId(command?.id) || command.kind !== 'woodcutting-start' || !validId(command.treeId))
        return result('blocked', 'command-not-allowlisted');
      const task = { id: command.id, treeId: command.treeId };
      const existing = checkpoints.get(task.id);
      if (existing) return result('blocked', existing.treeId === task.treeId ? 'duplicate-command' : 'command-id-conflict');
      if (checkpoints.size >= maxCheckpoints) { disable('checkpoint-limit'); return result('blocked', 'checkpoint-limit'); }
      const token = generation;
      busy = true;
      let attempted = false;
      try {
        const before = await observe();
        if (token !== generation) return result('cancelled', 'stopped-before-operation');
        const problem = precondition(before, task.treeId);
        if (problem === 'already-running') {
          checkpoints.set(task.id, { ...task, phase: 'observed-existing' });
          return result('verified', 'already-running');
        }
        if (problem) return result('blocked', problem);
        // Persist attempt BEFORE invoking a toggle callback. Never forget failed IDs.
        const checkpoint = { ...task, phase: 'attempted' };
        checkpoints.set(task.id, checkpoint);
        ownedTree = task.treeId; pendingMutation = true; attempted = true;
        const operation = Promise.resolve().then(() => {
          if (token !== generation) return;
          return port.selectTree(task.treeId);
        });
        const settled = async () => {
          pendingMutation = false;
          // A timeout cannot cancel a port. Recheck ownership if it settles later.
          if (token !== generation) {
            if (cleanupFlight) await cleanupFlight;
            return cleanupOwned();
          }
        };
        operation.then(settled, settled).catch(() => { requiresReview = true; });
        await timed(() => operation, timeoutMs);
        if (token !== generation) {
          checkpoint.phase = 'cancelled';
          return result('cancelled', 'stopped-during-operation', await cleanupOwned());
        }
        const after = await observe();
        if (token !== generation) {
          checkpoint.phase = 'cancelled';
          return result('cancelled', 'stopped-before-verification', await cleanupOwned());
        }
        const failure = postcondition(before, after, task.treeId);
        if (failure) {
          checkpoint.phase = 'failed'; disable('postcondition-failed', true);
          return result('stopped', failure, await cleanupOwned());
        }
        checkpoint.phase = 'verified';
        return result('verified', 'target-action-confirmed');
      } catch {
        if (attempted) checkpoints.get(task.id).phase = 'failed';
        disable(attempted ? 'operation-outcome-unknown' : 'observation-unavailable', attempted);
        return result('stopped', reason, await cleanupOwned());
      } finally { busy = false; }
    },
    async stop() {
      disable('user-stop');
      return result('stopped', 'user-stop', await cleanupOwned());
    },
    abandon() {
      // The session changed: ownership cannot authorize stopping the new character.
      disable('session-abandoned', true); ownedTree = null;
      return result('stopped', 'session-abandoned');
    },
    getState: () => ({ status, reason, busy, pendingMutation, requiresReview,
      checkpoints: [...checkpoints.values()].map(entry => ({ ...entry })), runnable: false })
  });
}
