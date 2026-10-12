/** Bounded producer closure over detached catalog facts; no game API or rewards. */
import { normalizeRecipeEffects } from './recipe-effects.mjs';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const cost = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1e9;
const unit = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const SCOPES = new Set(['base', 'toth', 'aod', 'ita']);
export function recipeActionSupported(value, capabilities = null) {
  return value?.evidence === 'confirmed' && id(value.action?.id) && (!capabilities || capabilities.has(value.action.id)) && Array.isArray(value.action.selectionIds) &&
    value.action.selectionIds.length <= 64 && value.action.selectionIds.every(id) &&
    new Set(value.action.selectionIds).size === value.action.selectionIds.length &&
    cost(value.costPerBatch) && unit(value.reliabilityPerBatch);
}
const fail = reason => ({ supported: false, reason, recipes: [], inspected: 0, rejected: [], runnable: false });

export function indexRecipeCatalog(recipes) {
  try {
    if (!Array.isArray(recipes) || recipes.length > 20_000) return { supported: false, reason: 'global-catalog-limit-or-invalid' };
    const byId = new Map(), producers = new Map(); let edges = 0;
    for (const recipe of recipes) {
      if (!id(recipe?.id) || byId.has(recipe.id)) return { supported: false, reason: 'global-recipe-invalid-or-duplicate' };
      const outputs = recipe.outputs;
      if (!Array.isArray(outputs) || outputs.length === 0 || outputs.length > 32 || outputs.some(output => !id(output?.id)))
        return { supported: false, reason: 'global-output-index-invalid' };
      byId.set(recipe.id, recipe);
      for (const outputId of new Set(outputs.map(output => output.id))) {
        if (++edges > 100_000) return { supported: false, reason: 'global-output-index-limit' };
        const list = producers.get(outputId) ?? [];
        list.push(recipe.id); producers.set(outputId, list);
      }
    }
    for (const list of producers.values()) list.sort(compare);
    return { supported: true, reason: null, byId, producers };
  } catch { return { supported: false, reason: 'global-catalog-unreadable' }; }
}

export function materializeRecipeCatalog(index, demands, allowedIds, actions, context, limits, stock = new Map()) {
  try {
    if (!index?.supported || !(index.byId instanceof Map) || !(index.producers instanceof Map) || !(actions instanceof Map) ||
        !Array.isArray(demands) || demands.length === 0 || demands.length > limits?.maxDemands ||
        demands.some(demand => !id(demand?.id) || !count(demand.quantity) || demand.quantity === 0) ||
        !Array.isArray(allowedIds) || allowedIds.length > 20_000 || allowedIds.some(value => !id(value) || !index.byId.has(value)) ||
        new Set(allowedIds).size !== allowedIds.length || !(stock instanceof Map) ||
        !Number.isSafeInteger(limits?.maxRecipes) || limits.maxRecipes < 1 || limits.maxRecipes > 2048 ||
        !Number.isSafeInteger(limits.maxDepth) || limits.maxDepth < 1 || limits.maxDepth > 64 ||
        !Number.isSafeInteger(limits.maxDemands) || limits.maxDemands < 1 || limits.maxDemands > 512 || !context?.ownership)
      return fail('local-catalog-input-invalid');
    const totals = new Map();
    if (stock.size > 20_000 || [...stock].some(([itemId, quantity]) => !id(itemId) || !count(quantity) || quantity === 0))
      return fail('local-stock-invalid');
    for (const demand of demands) {
      const total = (totals.get(demand.id) ?? 0) + demand.quantity;
      if (!count(total)) return fail('local-demand-overflow');
      totals.set(demand.id, total);
    }
    if ([...totals].every(([id, quantity]) => (stock.get(id) ?? 0) >= quantity))
      return { supported: true, reason: null, recipes: [], inspected: 0, rejected: [], runnable: false };
    const allowed = new Set(allowedIds), selected = new Map(), rejected = [];
    const queue = [...totals.keys()].sort(compare).map(id => ({ id, depth: 0 })), enqueued = new Set(totals.keys());
    let inspected = 0;
    for (let cursor = 0; cursor < queue.length; cursor++) {
      const item = queue[cursor];
      for (const recipeId of index.producers.get(item.id) ?? []) {
        if (++inspected > 10_000) return fail('local-producer-inspection-limit');
        if (!allowed.has(recipeId) || selected.has(recipeId)) continue;
        if (selected.size >= limits.maxRecipes) return fail('local-recipe-limit');
        const recipe = index.byId.get(recipeId);
        let problem = null, effects = null;
        try {
          if (recipe.evidence !== 'confirmed' || recipe.bankOrder !== 'consume-then-produce') problem = 'recipe-effects-unverified';
          else if (!SCOPES.has(recipe.scopeId) || context.ownership[recipe.scopeId] !== true) problem = 'recipe-scope-unavailable';
          else if (recipe.unlocked !== true) problem = 'recipe-locked-or-unknown';
          else if (recipe.kind !== 'noncombat' || recipe.risk !== 'safe') problem = 'recipe-risk-unverified';
          else if (!recipeActionSupported(actions.get(recipeId), context.capabilities ?? null)) problem = 'recipe-action-unverified';
          else {
            const normalized = normalizeRecipeEffects(recipe);
            problem = normalized.reason; effects = normalized.data;
            if (!problem && (!Array.isArray(recipe.possibleOutputIds) || recipe.possibleOutputIds.length > 256 ||
                recipe.possibleOutputIds.some(value => !id(value)) || new Set(recipe.possibleOutputIds).size !== recipe.possibleOutputIds.length ||
                effects.outputs.some(output => !recipe.possibleOutputIds.includes(output.id)))) problem = 'recipe-data-invalid';
            if (!problem && effects.itemCosts.some(cost => effects.outputs.some(output => cost.id === output.id))) problem = 'self-consuming-recipe-unverified';
          }
        } catch { problem = 'local-recipe-unreadable'; }
        if (problem) {
          if (rejected.length < 64) rejected.push({ recipeId, reason: problem });
          // Keep an explicit unusable producer for Solver diagnostics, never a fake yield.
          selected.set(recipeId, { id: recipeId, evidence: 'unknown', outputs: [{ id: item.id, quantity: null }] });
          continue;
        }
        selected.set(recipeId, { id: recipeId, scopeId: recipe.scopeId, evidence: 'confirmed', unlocked: true, kind: 'noncombat', risk: 'safe',
          bankOrder: 'consume-then-produce', costEvidence: recipe.costEvidence,
          ...(recipe.costEvidence === 'bounded' ? { rangeEvidence: 'confirmed', minimumItemCosts: effects.minimumItemCosts,
            minimumCurrencyCosts: effects.minimumCurrencyCosts, maximumOutputs: effects.maximumOutputs, minimumDurationMs: effects.minimumDurationMs } : {}),
          outputs: effects.outputs, itemCosts: effects.itemCosts, currencyCosts: effects.currencyCosts,
          durationMs: effects.durationMs, possibleOutputIds: [...recipe.possibleOutputIds].sort(compare) });
        if (item.depth >= limits.maxDepth) continue;
        for (const dependency of effects.itemCosts) {
          if (enqueued.has(dependency.id)) continue;
          if (enqueued.size >= 4096) return fail('local-material-limit');
          enqueued.add(dependency.id); queue.push({ id: dependency.id, depth: item.depth + 1 });
        }
      }
    }
    return { supported: true, reason: null, recipes: [...selected.values()].sort((a, b) => compare(a.id, b.id)), inspected, rejected, runnable: false };
  } catch { return fail('local-catalog-unreadable'); }
}
