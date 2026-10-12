/** Normalize verified synthetic fixed/bounded effects. Never infer limits from probabilities. */
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 1024;
const count = value => Number.isSafeInteger(value) && value >= 0;
const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function list(source, field, max, validate, positive) {
  if (!Array.isArray(source) || source.length > max) return null;
  const seen = new Set(), result = [];
  for (const entry of source) {
    if (!id(entry?.id) || seen.has(entry.id) || !validate(entry[field]) || (positive && entry[field] === 0)) return null;
    seen.add(entry.id); result.push({ id: entry.id, [field]: entry[field] });
  }
  return result.sort((a, b) => compare(a.id, b.id));
}
function paired(source, reference, field, validate, lower) {
  const normalized = list(source, field, reference.length, validate, false);
  if (!normalized || normalized.length !== reference.length) return null;
  for (let i = 0; i < reference.length; i++) {
    if (normalized[i].id !== reference[i].id ||
        (lower ? normalized[i][field] > reference[i][field] : normalized[i][field] < reference[i][field])) return null;
  }
  return normalized;
}
export function normalizeConsumptionBounds(value) {
  try {
    const fail = reason => ({ supported: false, reason, data: null });
    const bounded = value?.costEvidence === 'bounded';
    if (!['fixed', 'bounded'].includes(value?.costEvidence)) return fail('recipe-effects-unverified');
    if (bounded && value.rangeEvidence !== 'confirmed') return fail('recipe-bounds-unverified');
    const itemCosts = list(value.itemCosts, 'quantity', 128, count, true);
    const currencyCosts = list(value.currencyCosts, 'amount', 64, money, true);
    if (!itemCosts || !currencyCosts) return fail('recipe-data-invalid');
    const minimumItemCosts = value.minimumItemCosts === undefined && !bounded ? itemCosts.map(item => ({ ...item }))
      : paired(value.minimumItemCosts, itemCosts, 'quantity', count, true);
    const minimumCurrencyCosts = value.minimumCurrencyCosts === undefined && !bounded ? currencyCosts.map(currency => ({ ...currency }))
      : paired(value.minimumCurrencyCosts, currencyCosts, 'amount', money, true);
    if (!minimumItemCosts || !minimumCurrencyCosts) return fail('recipe-bounds-invalid');
    if (!bounded && (JSON.stringify(minimumItemCosts) !== JSON.stringify(itemCosts) ||
        JSON.stringify(minimumCurrencyCosts) !== JSON.stringify(currencyCosts))) return fail('fixed-effects-conflict');
    return { supported: true, reason: null, data: { itemCosts, currencyCosts, minimumItemCosts, minimumCurrencyCosts } };
  } catch { return { supported: false, reason: 'recipe-bounds-invalid', data: null }; }
}

export function normalizeRecipeEffects(recipe) {
  try {
    const fail = reason => ({ supported: false, reason, data: null });
    if (recipe?.evidence !== 'confirmed' || recipe.bankOrder !== 'consume-then-produce' ||
        !['fixed', 'bounded'].includes(recipe.costEvidence)) return fail('recipe-effects-unverified');
    const outputs = list(recipe.outputs, 'quantity', 32, count, true);
    const consumption = normalizeConsumptionBounds(recipe);
    if (!consumption.supported) return consumption;
    const { itemCosts, currencyCosts, minimumItemCosts, minimumCurrencyCosts } = consumption.data;
    if (!outputs?.length || !count(recipe.durationMs)) return fail('recipe-data-invalid');
    const bounded = recipe.costEvidence === 'bounded';
    if (bounded && recipe.rangeEvidence !== 'confirmed') return fail('recipe-bounds-unverified');
    const maximumOutputs = recipe.maximumOutputs === undefined && !bounded ? outputs.map(output => ({ ...output }))
      : paired(recipe.maximumOutputs, outputs, 'quantity', count, false);
    const minimumDurationMs = recipe.minimumDurationMs === undefined && !bounded ? recipe.durationMs : recipe.minimumDurationMs;
    if (!minimumItemCosts || !minimumCurrencyCosts || !maximumOutputs || !count(minimumDurationMs) || minimumDurationMs > recipe.durationMs)
      return fail('recipe-bounds-invalid');
    if (!bounded && (JSON.stringify(minimumItemCosts) !== JSON.stringify(itemCosts) ||
        JSON.stringify(minimumCurrencyCosts) !== JSON.stringify(currencyCosts) ||
        JSON.stringify(maximumOutputs) !== JSON.stringify(outputs) || minimumDurationMs !== recipe.durationMs)) return fail('fixed-effects-conflict');
    return { supported: true, reason: null, data: { outputs, maximumOutputs, itemCosts, minimumItemCosts,
      currencyCosts, minimumCurrencyCosts, durationMs: recipe.durationMs, minimumDurationMs,
      costEvidence: recipe.costEvidence, rangeEvidence: bounded ? 'confirmed' : null } };
  } catch { return { supported: false, reason: 'recipe-bounds-invalid', data: null }; }
}
