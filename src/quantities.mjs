/** Bounded, pure production planning over synthetic fixed/interval effects. */
import { resourceSnapshotProblem } from './snapshot-validation.mjs';
import { normalizeRecipeEffects } from './recipe-effects.mjs';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const positive = value => count(value) && value > 0;
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const unique = values => new Set(values).size === values.length;
const SCOPES = new Set(['base', 'toth', 'aod', 'ita']);
const DEFAULTS = Object.freeze({ maxRecipes: 512, maxDemands: 128, maxDepth: 24,
  maxExpansions: 2000, maxSteps: 1000, maxBatches: 100_000, maxReasons: 64 });
const CEILINGS = { maxRecipes: 2048, maxDemands: 512, maxDepth: 64,
  maxExpansions: 10_000, maxSteps: 4096, maxBatches: 1_000_000, maxReasons: 256 };
export function normalizeQuantityLimits(value) {
  if (value !== undefined && (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !Object.hasOwn(DEFAULTS, key)))) return null;
  const limits = { ...DEFAULTS, ...value };
  return Object.entries(limits).every(([key, n]) => positive(n) && n <= CEILINGS[key]) ? limits : null;
}
function empty(reason, expansions = 0, rejected = []) {
  return { status: 'blocked', reason, steps: [], durationMs: null, projection: null, expansions, rejected, runnable: false };
}
const sortedEntries = map => [...map].sort(([a], [b]) => compare(a, b));
function clone(state) { return { stock: new Map(state.stock), upperStock: new Map(state.upperStock),
  currencies: new Map(state.currencies), upperCurrencies: new Map(state.upperCurrencies),
  reservations: new Map(state.reservations), potentialStacks: new Set(state.potentialStacks),
  steps: [...state.steps], durationMs: state.durationMs, batches: state.batches }; }
function quantities(list, max, currency = false, nonempty = false) {
  return Array.isArray(list) && list.length <= max && (!nonempty || list.length > 0) &&
    list.every(entry => id(entry?.id) && (currency ? money(entry.amount) && entry.amount > 0 : positive(entry.quantity))) &&
    unique(list.map(entry => entry.id));
}
function recipeProblem(recipe, context) {
  if (recipe.evidence !== 'confirmed' || !['fixed', 'bounded'].includes(recipe.costEvidence) || recipe.bankOrder !== 'consume-then-produce')
    return 'recipe-effects-unverified';
  if (!SCOPES.has(recipe.scopeId) || context?.ownership?.[recipe.scopeId] !== true) return 'recipe-scope-unavailable';
  if (recipe.unlocked !== true) return 'recipe-locked-or-unknown';
  if (recipe.kind !== 'noncombat' || recipe.risk !== 'safe') return 'recipe-risk-unverified';
  if (!quantities(recipe.outputs, 32, false, true) || !quantities(recipe.itemCosts, 128) ||
      !quantities(recipe.currencyCosts, 64, true) || !count(recipe.durationMs) ||
      !Array.isArray(recipe.possibleOutputIds) || recipe.possibleOutputIds.length > 256 ||
      recipe.possibleOutputIds.some(value => !id(value)) || !unique(recipe.possibleOutputIds) ||
      recipe.outputs.some(output => !recipe.possibleOutputIds.includes(output.id))) return 'recipe-data-invalid';
  if (recipe.itemCosts.some(cost => recipe.outputs.some(output => output.id === cost.id))) return 'self-consuming-recipe-unverified';
  return normalizeRecipeEffects(recipe).reason;
}

/** Demands are domain prerequisites, not a player goal UI. No rewards are generated. */
export function planResourceDemand(resources, demands, recipes, context, options) {
  try { return plan(resources, demands, recipes, context, options); }
  catch { return empty('quantity-input-unreadable'); }
}

function plan(resources, demands, recipes, context, options) {
  const limits = normalizeQuantityLimits(options);
  if (!limits) return empty('quantity-limits-invalid');
  const problem = resourceSnapshotProblem(resources);
  if (problem) return empty(problem);
  const possibleOccupiedIds = context?.possibleOccupiedIds === undefined ? [] : context.possibleOccupiedIds;
  if (!Array.isArray(possibleOccupiedIds) || possibleOccupiedIds.length > 20_000 ||
      possibleOccupiedIds.some(value => !id(value)) || !unique(possibleOccupiedIds)) return empty('possible-slots-invalid');
  if (!Array.isArray(demands) || demands.length === 0 || demands.length > limits.maxDemands ||
      demands.some(demand => !id(demand?.id) || !positive(demand.quantity))) return empty('demands-invalid-or-limit');
  if (!Array.isArray(recipes) || recipes.length > limits.maxRecipes || recipes.some(recipe => !id(recipe?.id)))
    return empty('recipes-invalid-or-limit');
  if (!unique(recipes.map(recipe => recipe.id))) return empty('duplicate-recipe');
  const totals = new Map();
  for (const demand of demands) {
    const quantity = (totals.get(demand.id) ?? 0) + demand.quantity;
    if (!positive(quantity)) return empty('demand-overflow');
    totals.set(demand.id, quantity);
  }
  const bank = resources.categories.bank.data;
  const protectedIds = new Set(bank.lockedIds);
  const upperItems = context?.upperItems === undefined ? bank.items : context.upperItems;
  const lowerCurrencies = resources.categories.currencies.data.currencies;
  const upperCurrencies = context?.upperCurrencies === undefined ? lowerCurrencies : context.upperCurrencies;
  if (!quantities(upperItems, 20_000) || !Array.isArray(upperCurrencies) || upperCurrencies.length !== lowerCurrencies.length ||
      upperCurrencies.some(currency => !id(currency?.id) || !money(currency.amount)) ||
      !unique(upperCurrencies.map(currency => currency.id))) return empty('projection-bounds-invalid');
  const hiStock = new Map(upperItems.map(item => [item.id, item.quantity]));
  const hiCurrencies = new Map(upperCurrencies.map(currency => [currency.id, currency.amount]));
  // Unknown-quantity drops have occupancy evidence but no numeric upper bound.
  // Keep a finite bookkeeping component internally; never export it as a ceiling.
  for (const item of bank.items) if (possibleOccupiedIds.includes(item.id) && !hiStock.has(item.id)) hiStock.set(item.id, item.quantity);
  if (bank.items.some(item => (hiStock.get(item.id) ?? -1) < item.quantity) ||
      lowerCurrencies.some(currency => (hiCurrencies.get(currency.id) ?? -1) < currency.amount)) return empty('projection-bounds-invalid');
  let state = { stock: new Map(bank.items.map(item => [item.id, item.quantity])), upperStock: hiStock,
    currencies: new Map(lowerCurrencies.map(currency => [currency.id, currency.amount])), upperCurrencies: hiCurrencies,
    reservations: new Map(), potentialStacks: new Set(possibleOccupiedIds), steps: [], durationMs: 0, batches: 0 };
  let expansions = 0, exhausted = false;
  const rejected = new Map();
  function reject(itemId, recipeId, reason) {
    const entry = { itemId, recipeId, reason };
    if (rejected.size < limits.maxReasons) rejected.set(JSON.stringify(entry), entry);
    return null;
  }
  function spend() {
    if (expansions >= limits.maxExpansions) { exhausted = true; return false; }
    expansions++; return true;
  }
  const available = (state, itemId) => (state.stock.get(itemId) ?? 0) - (state.reservations.get(itemId) ?? 0);
  function acquire(itemId, quantity, source, path, consumption = false) {
    if (!spend()) return null;
    if (consumption && protectedIds.has(itemId)) return reject(itemId, null, 'material-protected');
    if (available(source, itemId) >= quantity) return source;
    if (path.includes(itemId)) return reject(itemId, null, 'quantity-cycle');
    if (path.length > limits.maxDepth) return reject(itemId, null, 'quantity-depth-limit');
    let best = null;
    for (const recipe of [...recipes].sort((a, b) => compare(a.id, b.id))) {
      // Shape/evidence checks happen before considering or using recipe quantities.
      if (!Array.isArray(recipe.outputs) || !recipe.outputs.some(output => output?.id === itemId)) continue;
      if (!spend()) break;
      const problem = recipeProblem(recipe, context);
      if (problem) { reject(itemId, recipe.id, problem); continue; }
      const effects = normalizeRecipeEffects(recipe).data;
      const output = recipe.outputs.find(output => output.id === itemId);
      const batches = Math.ceil((quantity - available(source, itemId)) / output.quantity);
      if (!positive(batches) || batches > limits.maxBatches || source.batches + batches > limits.maxBatches) {
        reject(itemId, recipe.id, 'quantity-batch-limit'); continue;
      }
      let draft = clone(source);
      let failed = false;
      const itemCosts = recipe.itemCosts.map(cost => ({ id: cost.id, quantity: cost.quantity * batches }))
        .sort((a, b) => compare(a.id, b.id));
      const currencyCosts = recipe.currencyCosts.map(cost => ({ id: cost.id, amount: cost.amount * batches }))
        .sort((a, b) => compare(a.id, b.id));
      const outputs = recipe.outputs.map(output => ({ id: output.id, quantity: output.quantity * batches }))
        .sort((a, b) => compare(a.id, b.id));
      const minimumItemCosts = effects.minimumItemCosts.map(cost => ({ id: cost.id, quantity: cost.quantity * batches }));
      const minimumCurrencyCosts = effects.minimumCurrencyCosts.map(cost => ({ id: cost.id, amount: cost.amount * batches }));
      const maximumOutputs = effects.maximumOutputs.map(output => ({ id: output.id, quantity: output.quantity * batches }));
      const durationMs = recipe.durationMs * batches;
      if (itemCosts.some(cost => !positive(cost.quantity)) || outputs.some(output => !positive(output.quantity)) ||
          minimumItemCosts.some(cost => !count(cost.quantity)) || maximumOutputs.some(output => !positive(output.quantity)) ||
          minimumCurrencyCosts.some(cost => !money(cost.amount)) || currencyCosts.some(cost => !money(cost.amount)) ||
          !count(effects.minimumDurationMs * batches) || !count(durationMs)) {
        reject(itemId, recipe.id, 'quantity-overflow'); continue;
      }
      // Temporary reservations stop subsequent ingredients stealing already secured costs.
      for (const cost of itemCosts) {
        const supplied = acquire(cost.id, cost.quantity, draft, [...path, itemId], true);
        if (!supplied) { failed = true; break; }
        draft = supplied;
        const reserved = (draft.reservations.get(cost.id) ?? 0) + cost.quantity;
        if (!count(reserved)) { reject(itemId, recipe.id, 'quantity-overflow'); failed = true; break; }
        draft.reservations.set(cost.id, reserved);
      }
      if (exhausted) break;
      if (failed) continue;
      for (const cost of currencyCosts) {
        if (!draft.currencies.has(cost.id) || draft.currencies.get(cost.id) < cost.amount) {
          reject(itemId, recipe.id, draft.currencies.has(cost.id) ? 'currency-insufficient' : 'currency-unobserved');
          failed = true; break;
        }
      }
      if (failed) continue;
      // Outputs and inputs are disjoint. Once output stacks appear, input support
      // only shrinks, so the first operation bounds the entire batch's slot peak.
      const receiving = new Map(draft.upperStock);
      for (const cost of effects.minimumItemCosts) {
        const remaining = (receiving.get(cost.id) ?? 0) - cost.quantity;
        if (remaining === 0) receiving.delete(cost.id); else receiving.set(cost.id, remaining);
      }
      const peak = new Set([...receiving.keys(), ...draft.potentialStacks]);
      const newStacks = recipe.possibleOutputIds.filter(id => !peak.has(id)).length;
      if (peak.size + newStacks > 20_000) { reject(itemId, recipe.id, 'quantity-slot-limit'); continue; }
      if (newStacks > Math.max(0, bank.maximumSlots - peak.size)) {
        reject(itemId, recipe.id, 'bank-capacity-insufficient'); continue;
      }
      for (const cost of itemCosts) {
        const remaining = draft.stock.get(cost.id) - cost.quantity;
        if (remaining === 0) draft.stock.delete(cost.id); else draft.stock.set(cost.id, remaining);
        const reserved = draft.reservations.get(cost.id) - cost.quantity;
        if (reserved === 0) draft.reservations.delete(cost.id); else draft.reservations.set(cost.id, reserved);
      }
      for (const cost of currencyCosts) draft.currencies.set(cost.id, draft.currencies.get(cost.id) - cost.amount);
      for (const cost of minimumItemCosts) {
        const remaining = draft.upperStock.get(cost.id) - cost.quantity;
        if (remaining === 0) draft.upperStock.delete(cost.id); else draft.upperStock.set(cost.id, remaining);
      }
      for (const cost of minimumCurrencyCosts) draft.upperCurrencies.set(cost.id, draft.upperCurrencies.get(cost.id) - cost.amount);
      for (const output of outputs) {
        const quantity = (draft.stock.get(output.id) ?? 0) + output.quantity;
        if (!positive(quantity)) { failed = true; break; }
        draft.stock.set(output.id, quantity);
      }
      for (const output of maximumOutputs) {
        const quantity = (draft.upperStock.get(output.id) ?? 0) + output.quantity;
        if (!positive(quantity)) { failed = true; break; }
        draft.upperStock.set(output.id, quantity);
      }
      if (failed || !count(draft.durationMs + durationMs)) { reject(itemId, recipe.id, 'quantity-overflow'); continue; }
      for (const possible of recipe.possibleOutputIds)
        if (!recipe.outputs.some(output => output.id === possible)) draft.potentialStacks.add(possible);
      if (draft.steps.length >= limits.maxSteps) { reject(itemId, recipe.id, 'quantity-step-limit'); continue; }
      draft.durationMs += durationMs; draft.batches += batches;
      draft.steps.push({ id: JSON.stringify([recipe.id, batches, draft.steps.length]), recipeId: recipe.id, scopeId: recipe.scopeId,
        batches, outputs, maximumOutputs, itemCosts, minimumItemCosts, currencyCosts, minimumCurrencyCosts,
        durationMs, minimumDurationMs: effects.minimumDurationMs * batches, runnable: false });
      if (available(draft, itemId) < quantity) { reject(itemId, recipe.id, 'quantity-postcondition-failed'); continue; }
      const signature = JSON.stringify(draft.steps.map(step => step.id));
      if (!best || draft.durationMs < best.state.durationMs ||
          (draft.durationMs === best.state.durationMs && compare(signature, best.signature) < 0)) best = { state: draft, signature };
    }
    if (exhausted) return null;
    return best?.state ?? reject(itemId, null, 'no-confirmed-quantity-route');
  }
  for (const [itemId, quantity] of sortedEntries(totals)) {
    const supplied = acquire(itemId, quantity, state, []);
    if (exhausted) return empty('quantity-expansion-limit', expansions, [...rejected.values()]);
    if (!supplied) return empty('quantity-demand-blocked', expansions,
      [...rejected.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))));
    state = supplied;
    state.reservations.set(itemId, (state.reservations.get(itemId) ?? 0) + quantity);
  }
  return { status: state.steps.length ? 'planned' : 'satisfied', reason: null,
    steps: state.steps, durationMs: state.durationMs, projection: {
      items: sortedEntries(state.stock).map(([id, quantity]) => ({ id, quantity })),
      upperItems: sortedEntries(state.upperStock).filter(([id]) => !state.potentialStacks.has(id)).map(([id, quantity]) => ({ id, quantity })),
      currencies: sortedEntries(state.currencies).map(([id, amount]) => ({ id, amount })),
      upperCurrencies: sortedEntries(state.upperCurrencies).map(([id, amount]) => ({ id, amount })),
      reservations: sortedEntries(state.reservations).map(([id, quantity]) => ({ id, quantity })),
      occupiedSlots: state.stock.size, possibleOccupiedSlots: new Set([...state.upperStock.keys(), ...state.potentialStacks]).size,
      possibleOccupiedIds: [...state.potentialStacks].sort(compare), maximumSlots: bank.maximumSlots }, expansions,
    rejected: [...rejected.values()].sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))), runnable: false };
}
