/** Mock-only observation coordinator. Runtime is denied before any external access. */
import { readCompletionForTesting } from '../setup.mjs';
import { readResourcesForTesting } from './resources.mjs';
import { readProductionCatalogForTesting } from './production-catalog.mjs';
import { readShopForTesting } from './shop-observation.mjs';
import { readFarmingForTesting } from './farming-observation.mjs';
import { auditCompletion } from './completion-audit.mjs';
import { buildItemAcquisitionGraph, buildProductionPrerequisiteGraph } from './production-prerequisites.mjs';
import { readCompletionTargetsForTesting } from './completion-targets.mjs';
import { readResourceTargetsForTesting } from './resource-targets.mjs';
import { readActionSelectionForTesting } from './action-selection.mjs';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256;
const count = value => Number.isSafeInteger(value) && value >= 0;
const KINDS = ['woodcutting', 'smithing', 'mining', 'fishing', 'cooking', 'crafting', 'fletching', 'runecrafting', 'herblore', 'summoning'];
const failed = reason => ({ supported: false, status: 'blocked', reason, origin: 'mock-only', frame: null, analysis: null,
  atomicObservation: false, actualComplete: false, planningReady: false, runnable: false });
export function readObservationFrame(_game, _context) { return { ...failed('runtime-observation-frame-unverified'), origin: 'runtime-disabled' }; }
function header(game) {
  const mode = game.currentGamemode, id = mode?.id, hardcore = mode?.isPermaDeath, raid = game.isGolbinRaid;
  if (typeof id !== 'string' || id.length < 1 || id.length > 1024 || typeof hardcore !== 'boolean' || typeof raid !== 'boolean') return null;
  return { id, hardcore, raid };
}
const sameMode = (first, second) => first?.id === second?.id && first?.hardcore === second?.hardcore;
export function readObservationFrameForTesting(game, context) {
  try {
    const version = context?.version;
    if (version !== 'v1.3.1') return failed('version-unverified');
    const observationId = context.observationId, nowMs = context.nowMs, maximumBytes = context.maximumBytes === undefined ? 8_388_608 : context.maximumBytes;
    const phase = context.phase === undefined ? 'planning' : context.phase, offline = context.offline === undefined ? false : context.offline;
    const ownership = Object.fromEntries(['base', 'toth', 'aod', 'ita'].map(scope => {
      const value = context.ownership?.[scope]; return [scope, value === undefined ? null : value];
    }));
    const skills = context.skills === undefined ? [...KINDS] : context.skills;
    if (!id(observationId) || !count(nowMs) || ownership.base !== true || !Object.values(ownership).every(value => [true, false, null].includes(value)) ||
        !Array.isArray(skills) || skills.length < 1 || skills.length > 10 || new Set(skills).size !== skills.length || !skills.every(kind => KINDS.includes(kind)) ||
        !count(maximumBytes) || maximumBytes < 1024 || maximumBytes > 16_777_216 || !['planning', 'monitoring'].includes(phase) ||
        typeof offline !== 'boolean') return failed('observation-frame-context-invalid');
    const expectedActionId = context.expectedActionId, treeIds = context.treeIds === undefined ? [] : context.treeIds;
    if (expectedActionId !== undefined && (typeof expectedActionId !== 'string' || expectedActionId.length < 1 || expectedActionId.length > 1024) ||
        !Array.isArray(treeIds) || treeIds.length > 64 || treeIds.some(id => typeof id !== 'string' || id.length < 1 || id.length > 1024) || new Set(treeIds).size !== treeIds.length)
      return failed('observation-frame-context-invalid');
    const stable = Object.freeze({ version, observationId, ownership: Object.freeze(ownership), skills: Object.freeze([...skills]),
      ...(expectedActionId === undefined ? {} : { expectedActionId }), treeIds: Object.freeze([...treeIds]) });
    const before = header(game); if (!before) return failed('observation-frame-mode-unverified');
    if (before.raid) return failed('observation-frame-raid-unverified');
    const targets = context.targets, targeted = phase === 'monitoring' && targets !== undefined;
    const completionSnapshot = targeted ? null : readCompletionForTesting(game, stable);
    const completionTargets = targeted ? readCompletionTargetsForTesting(game, targets, stable) : null;
    const resourceTargets = context.resourceTargets;
    const resources = phase === 'monitoring' && resourceTargets !== undefined ? readResourceTargetsForTesting(game, resourceTargets, stable) : readResourcesForTesting(game, stable);
    const fullAnalysis = phase === 'planning' && !offline;
    const productionCatalog = fullAnalysis ? readProductionCatalogForTesting(game, stable) : null;
    const shopSnapshot = fullAnalysis ? readShopForTesting(game, stable) : null;
    const farmingSnapshot = fullAnalysis ? readFarmingForTesting(game, stable) : null;
    const currentAction = readActionSelectionForTesting(game, stable);
    const after = header(game);
    if (!after || !sameMode(before, after) || after.raid) return failed('observation-frame-context-changed');
    const snapshots = { completion: targeted ? completionTargets : completionSnapshot, resources, production: productionCatalog, shop: shopSnapshot, farming: farmingSnapshot, currentAction }, stages = {};
    for (const [name, snapshot] of Object.entries(snapshots)) {
      if (snapshot === null) { stages[name] = { supported: null, status: 'deferred', reason: offline ? 'game-offline' : 'monitoring-no-full-scan' }; continue; }
      if (snapshot.version !== null && (snapshot.version !== version || !sameMode(before, snapshot.mode))) return failed('observation-frame-snapshot-mismatch');
      const supported = name === 'completion' && !targeted ? snapshot.completion.supported : snapshot.supported;
      stages[name] = { supported: supported === true, status: supported === true ? 'observed' : 'partial-or-unavailable',
        reason: supported === true ? null : name === 'completion' && !targeted ? snapshot.completion.reason : snapshot.reason };
    }
    let analysis = null;
    if (fullAnalysis) {
      const audit = auditCompletion(completionSnapshot), shopAvailable = shopSnapshot.version === version && shopSnapshot.purchases.records.length > 0;
      const acquisition = shopAvailable ? buildItemAcquisitionGraph(completionSnapshot, productionCatalog, shopSnapshot)
        : buildProductionPrerequisiteGraph(completionSnapshot, productionCatalog);
      analysis = { audit, acquisition, shopSource: shopAvailable ? 'included' : 'unavailable-production-only' };
    }
    const supported = Object.values(stages).filter(stage => stage.status !== 'deferred').every(stage => stage.supported);
    const result = { supported, status: supported ? 'observed' : 'partial', reason: supported ? null : 'observation-frame-partial', origin: 'mock-only',
      version, observationId, observedAtMs: nowMs, phase, offline, mode: { id: before.id, hardcore: before.hardcore }, ownership: { ...ownership }, stages,
      frame: { completionSnapshot, completionTargets, resources, productionCatalog, shopSnapshot, farmingSnapshot, currentAction,
        actionSelection: currentAction.actionSelection, woodcutting: currentAction.woodcutting, offline },
      analysis, analysisStatus: fullAnalysis ? 'evaluated' : offline ? 'deferred-offline' : 'deferred-monitoring',
      atomicObservation: false, actualComplete: false, planningReady: false, runnable: false };
    if (new TextEncoder().encode(JSON.stringify(result)).length > maximumBytes) return failed('observation-frame-output-byte-limit');
    return result;
  } catch { return failed('observation-frame-input-unreadable'); }
}
