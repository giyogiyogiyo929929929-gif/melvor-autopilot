/** Completion -> graph -> quantity stages -> shared utility -> monitor criteria. Mock facts only. */
import { generateCompletionCandidates } from '../setup.mjs';
import { planCompletionCandidates } from './prerequisites.mjs';
import { plannerOptionsProblem, selectPreparedCompletionPlans } from './planner.mjs';
import { normalizeQuantityLimits, planResourceDemand } from './quantities.mjs';
import { normalizeMonitorTask } from './monitor.mjs';
import { resourceSnapshotProblem } from './snapshot-validation.mjs';
import { normalizeRecipeEffects } from './recipe-effects.mjs';
import { indexRecipeCatalog, materializeRecipeCatalog } from './local-catalog.mjs';

const id = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max;
const count = value => Number.isSafeInteger(value) && value >= 0;
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const cost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const validIds = (list, max) => Array.isArray(list) && list.length <= max && list.every(value => id(value)) && new Set(list).size === list.length;
function blocked(reason, blockers = [], expansions = 0, quantityExpansions = 0) {
  return { status: 'blocked', reason, selected: null, nextStep: null, nextTask: null, nextCurrent: null,
    evaluations: [], blockers, expansions, quantityExpansions, runnable: false };
}
function index(entries, key, limit, keyLimit = 1024, wanted = null) {
  if (!Array.isArray(entries) || entries.length > limit) return null;
  const map = new Map();
  for (const entry of entries) {
    if (!record(entry) || !id(entry[key], keyLimit) || map.has(entry[key])) return null;
    map.set(entry[key], entry);
  }
  return wanted === null ? map : new Map([...map].filter(([key]) => wanted.has(key)));
}
function validEstimate(value) {
  return value?.evidence === 'confirmed' && unit(value.completionGain) && cost(value.unlockValue) &&
    cost(value.consumptionCost) && unit(value.reliability) && value.deathProbability === 0;
}
function validAction(value) {
  return value?.evidence === 'confirmed' && id(value.action?.id) && validIds(value.action.selectionIds, 64) &&
    cost(value.costPerBatch) && unit(value.reliabilityPerBatch);
}
function completionCondition(candidate) {
  return { type: 'completion', scopeId: candidate.scopeId, category: candidate.category, id: candidate.targetId,
    ...(candidate.skillId === null ? {} : { skillId: candidate.skillId }),
    ...(candidate.track === null ? {} : { track: candidate.track }) };
}
function sameCompletion(a, b) {
  return a.type === 'completion' && a.scopeId === b.scopeId && a.category === b.category && a.id === b.id &&
    (a.skillId ?? null) === (b.skillId ?? null) && (a.track ?? null) === (b.track ?? null);
}
function projectResources(source, projection) {
  // Private simulation input to the next quantity stage, never a GameAdapter output.
  const next = structuredClone(source);
  const locked = new Set(next.categories.bank.data.lockedIds);
  next.categories.bank.data.items = projection.items.map(item => ({ ...item, locked: locked.has(item.id) }));
  next.categories.bank.data.occupiedSlots = projection.occupiedSlots;
  next.categories.bank.data.freeSlots = Math.max(0, projection.maximumSlots - projection.occupiedSlots);
  next.categories.bank.data.overCapacity = projection.occupiedSlots > projection.maximumSlots;
  next.categories.currencies.data.currencies = projection.currencies.map(currency => ({ ...currency }));
  return next;
}

export function selectQuantifiedCompletionPlan(snapshot, graph, estimates, resources, model, options) {
  try { return select(snapshot, graph, estimates, resources, model, options); }
  catch { return blocked('quantified-input-unreadable'); }
}

function select(snapshot, graph, estimates, resources, model, options) {
  const optionKeys = ['nowMs', 'current', 'policy', 'planning', 'quantityLimits', 'maxTotalQuantityExpansions',
    'maxCompiledSteps', 'planEpoch', 'monitorBounds', 'capabilities'];
  if (!record(options) || Object.keys(options).some(key => !optionKeys.includes(key))) return blocked('quantified-options-invalid');
  const plannerOptions = { nowMs: options.nowMs,
    ...(options.current === undefined ? {} : { current: options.current }),
    ...(options.policy === undefined ? {} : { policy: options.policy }),
    ...(options.planning === undefined ? {} : { planning: options.planning }) };
  const configProblem = plannerOptionsProblem(plannerOptions);
  if (configProblem) return blocked(configProblem);
  if (options.capabilities !== undefined && !validIds(options.capabilities, 64)) return blocked('capabilities-invalid');
  const capabilities = options.capabilities === undefined ? null : new Set(options.capabilities);
  const limits = normalizeQuantityLimits(options.quantityLimits);
  const totalBudget = options.maxTotalQuantityExpansions ?? 4000;
  const maxSteps = options.maxCompiledSteps ?? 512;
  const epoch = options.planEpoch ?? 0;
  if (!limits || !count(totalBudget) || totalBudget < 1 || totalBudget > 20_000 ||
      !count(maxSteps) || maxSteps < 1 || maxSteps > 4096 || !count(epoch)) return blocked('quantified-limits-invalid');
  if (options.monitorBounds !== undefined && (!record(options.monitorBounds) ||
      Object.keys(options.monitorBounds).some(key => !['maxDurationMs', 'stagnationMs', 'maxObservationGapMs'].includes(key)) ||
      Object.values(options.monitorBounds).some(value => !count(value) || value === 0 || value > 2_592_000_000)))
    return blocked('monitor-bounds-invalid');
  const problem = resourceSnapshotProblem(resources);
  if (problem) return blocked(problem);
  if (snapshot?.version !== resources.version || snapshot.mode?.id !== resources.mode.id ||
      snapshot.mode?.hardcore !== resources.mode.hardcore) return blocked('snapshot-mode-conflict');
  const batch = planCompletionCandidates(snapshot, graph, options.planning);
  if (batch.status !== 'planned') return { ...blocked(batch.reason, batch.blockers, batch.expansions), ...(batch.window ? { window: batch.window } : {}) };
  const wanted = batch.window ? new Set(batch.plans.flatMap(plan => plan.steps.map(step => step.id))) : null;
  const metadataLimit = batch.window ? 100_000 : 4096;
  const bindings = index(model?.steps, 'stepId', metadataLimit, 16_384, wanted);
  const catalogIndex = batch.window ? indexRecipeCatalog(model?.recipes) : null;
  if (catalogIndex && !catalogIndex.supported) return { ...blocked(catalogIndex.reason), window: batch.window };
  const recipes = catalogIndex?.byId ?? index(model?.recipes, 'id', 2048);
  const actions = index(model?.recipeActions, 'recipeId', batch.window ? 20_000 : 2048);
  const byEstimate = index(estimates, 'stepId', metadataLimit, 16_384, wanted);
  if (!bindings || !recipes || !actions || !byEstimate) return { ...blocked('quantified-model-invalid-or-duplicate'), ...(batch.window ? { window: batch.window } : {}) };
  const candidates = new Map(generateCompletionCandidates(snapshot).candidates.map(candidate => [candidate.id, candidate]));
  const ownership = Object.fromEntries(snapshot.completion.scopes.map(scope => [scope.id, scope.ownership]));
  const prepared = [], failures = [...batch.blockers], metadata = new Map();
  let quantityExpansions = 0;
  for (const plan of batch.plans) {
    const candidate = candidates.get(plan.candidateId);
    const end = completionCondition(candidate);
    let projected = structuredClone(resources), potential = [], upperItems, upperCurrencies, finalProjection = null, failure = null;
    const compiled = [], compiledEstimates = [], tasks = new Map();
    const rejects = [];
    for (const graphStep of plan.steps) {
      const binding = bindings.get(graphStep.id), estimate = byEstimate.get(graphStep.id);
      if (binding?.evidence !== 'confirmed' || !validEstimate(estimate) || graphStep.kind !== 'noncombat') {
        failure = 'step-binding-or-estimate-unverified'; break;
      }
      const terminal = graphStep.nodeId === candidate.id;
      if (binding.type === 'neutral') {
        if (binding.resourceNeutral !== true) { failure = 'neutral-effects-unverified'; break; }
        const task = normalizeMonitorTask({ ...binding.task, id: JSON.stringify([graphStep.id, epoch]),
          ...(options.monitorBounds === undefined ? {} : { bounds: options.monitorBounds }) });
        if (!task || task.requirements.items.length || task.requirements.currencies.length || task.requirements.outputIds.length ||
            (capabilities && !capabilities.has(task.action.id)) ||
            task.endConditions.some(condition => condition.type !== 'completion') ||
            (terminal && !task.endConditions.some(condition => sameCompletion(condition, end)))) {
          failure = 'neutral-monitor-unverified'; break;
        }
        compiled.push({ ...graphStep }); compiledEstimates.push({ ...estimate });
        tasks.set(graphStep.id, { ...task, runnable: false });
      } else if (binding.type === 'production') {
        if (!validIds(binding.allowedRecipeIds, batch.window ? 20_000 : 2048) || binding.allowedRecipeIds.some(id => !recipes.has(id)) ||
            (terminal && candidate.category === 'items' &&
              !binding.demands?.some(demand => demand?.id === candidate.targetId && count(demand.quantity) && demand.quantity > 0))) {
          failure = 'production-binding-invalid'; break;
        }
        const remaining = totalBudget - quantityExpansions;
        if (remaining <= 0) return blocked('quantity-batch-expansion-limit', failures, batch.expansions + quantityExpansions, quantityExpansions);
        let stageRecipes;
        if (catalogIndex) {
          const subset = materializeRecipeCatalog(catalogIndex, binding.demands, binding.allowedRecipeIds, actions,
            { ownership, capabilities }, limits, new Map(projected.categories.bank.data.items.map(item => [item.id, item.quantity])));
          rejects.push(...subset.rejected);
          if (!subset.supported) { failure = subset.reason; break; }
          stageRecipes = subset.recipes;
        } else stageRecipes = binding.allowedRecipeIds.map(id => recipes.get(id))
          .map(recipe => validAction(actions.get(recipe.id)) && (!capabilities || capabilities.has(actions.get(recipe.id).action.id))
            ? recipe : { ...recipe, evidence: 'unknown' });
        const quantity = planResourceDemand(projected, binding.demands, stageRecipes,
          { ownership, possibleOccupiedIds: potential, upperItems, upperCurrencies },
          { ...limits, maxExpansions: Math.min(limits.maxExpansions, remaining) });
        quantityExpansions += quantity.expansions;
        rejects.push(...quantity.rejected);
        if (quantity.reason === 'quantity-expansion-limit' && quantityExpansions >= totalBudget)
          return blocked('quantity-batch-expansion-limit', failures, batch.expansions + quantityExpansions, quantityExpansions);
        if (quantity.status === 'blocked') { failure = quantity.reason; break; }
        if (quantity.status === 'satisfied' && terminal) { failure = 'quantity-terminal-awaiting-completion'; break; }
        const occurrences = new Map();
        let localStock = new Map(projected.categories.bank.data.items.map(item => [item.id, item.quantity]));
        for (const [i, operation] of quantity.steps.entries()) {
          const recipe = recipes.get(operation.recipeId), action = actions.get(operation.recipeId);
          const effects = normalizeRecipeEffects(recipe).data;
          const ordinal = occurrences.get(recipe.id) ?? 0; occurrences.set(recipe.id, ordinal + 1);
          const stepId = JSON.stringify(['quantity', graphStep.id, recipe.id, ordinal]);
          if (!id(stepId, 16_384)) { failure = 'compiled-id-limit'; break; }
          const last = i === quantity.steps.length - 1;
          const targets = operation.outputs.map(output => ({ type: 'inventory', id: output.id,
            quantity: (localStock.get(output.id) ?? 0) + output.quantity }));
          if (terminal && last) targets.push(end);
          const durationBound = Math.max(3_600_000, operation.durationMs * 2);
          const stagnantBound = Math.max(60_000, recipe.durationMs * 3);
          const task = normalizeMonitorTask({ id: JSON.stringify([stepId, epoch]), action: action.action, endConditions: targets,
            requirements: { items: effects.itemCosts, currencies: effects.currencyCosts,
              outputIds: recipe.possibleOutputIds, outputsEvidence: 'confirmed', bankOrder: 'consume-then-produce', costEvidence: effects.costEvidence,
              ...(effects.costEvidence === 'bounded' ? { rangeEvidence: 'confirmed', minimumItems: effects.minimumItemCosts,
                minimumCurrencies: effects.minimumCurrencyCosts } : {}) },
            bounds: { maxDurationMs: durationBound, stagnationMs: stagnantBound, maxObservationGapMs: 60_000, ...options.monitorBounds } });
          if (!task) { failure = 'production-monitor-unrepresentable'; break; }
          compiled.push({ id: stepId, nodeId: graphStep.nodeId, routeId: recipe.id, scopeId: operation.scopeId,
            kind: 'noncombat', durationMs: operation.durationMs, runnable: false });
          if (compiled.length > maxSteps) { failure = 'compiled-step-limit'; break; }
          compiledEstimates.push({ stepId, evidence: 'confirmed', completionGain: last ? estimate.completionGain : 0,
            unlockValue: last ? estimate.unlockValue : 0, consumptionCost: action.costPerBatch * operation.batches,
            reliability: Math.max(0, 1 - (1 - action.reliabilityPerBatch) * operation.batches - (last ? 1 - estimate.reliability : 0)),
            deathProbability: 0 });
          tasks.set(stepId, { ...task, runnable: false });
          for (const item of operation.itemCosts) {
            const remaining = localStock.get(item.id) - item.quantity;
            if (remaining === 0) localStock.delete(item.id); else localStock.set(item.id, remaining);
          }
          for (const output of operation.outputs) localStock.set(output.id, (localStock.get(output.id) ?? 0) + output.quantity);
        }
        if (failure) break;
        finalProjection = quantity.projection;
        projected = projectResources(projected, quantity.projection); potential = quantity.projection.possibleOccupiedIds;
        upperItems = quantity.projection.upperItems; upperCurrencies = quantity.projection.upperCurrencies;
      } else { failure = 'step-binding-type-unverified'; break; }
      if (compiled.length > maxSteps) { failure = 'compiled-step-limit'; break; }
    }
    if (failure) { failures.push({ id: candidate.id, reason: failure, rejected: rejects }); continue; }
    const durationMs = compiled.reduce((sum, step) => sum + step.durationMs, 0);
    if (compiled.length === 0 || !count(durationMs)) { failures.push({ id: candidate.id, reason: 'compiled-plan-invalid', rejected: rejects }); continue; }
    prepared.push({ plan: { candidateId: candidate.id, scopeId: candidate.scopeId, category: candidate.category,
      durationMs, steps: compiled }, estimates: compiledEstimates });
    metadata.set(candidate.id, { tasks, projection: finalProjection });
  }
  const selected = selectPreparedCompletionPlans(prepared, failures, batch.expansions + quantityExpansions, plannerOptions);
  const evaluations = selected.evaluations.map(evaluation => ({ ...evaluation,
    resourceProjection: structuredClone(metadata.get(evaluation.candidateId).projection) }));
  if (!selected.selected) return { ...selected, nextTask: null, quantityExpansions, evaluations, ...(batch.window ? { window: batch.window } : {}) };
  const data = metadata.get(selected.selected.candidateId);
  return { ...selected, evaluations, quantityExpansions,
    selected: { ...selected.selected, resourceProjection: structuredClone(data.projection) },
    nextTask: structuredClone(data.tasks.get(selected.nextStep.id)), ...(batch.window ? { window: batch.window } : {}) };
}

/** Autonomous fair window, with a pinned observed current goal. No player target input. */
export function selectWindowedQuantifiedCompletionPlan(snapshot, graph, estimates, resources, model, options) {
  try {
    if (!record(options)) return blocked('quantified-options-invalid');
    const { cursor = null, ...base } = options;
    if (base.planning !== undefined && !record(base.planning)) return blocked('planning-options-invalid');
    return selectQuantifiedCompletionPlan(snapshot, graph, estimates, resources, model, { ...base,
      planning: { ...base.planning, window: { cursor, activeCandidateId: base.current?.candidateId ?? null } } });
  } catch { return blocked('quantified-input-unreadable'); }
}
