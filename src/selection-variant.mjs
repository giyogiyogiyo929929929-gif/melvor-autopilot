/** Closed, primitive selection metadata for change detection, never an operation instruction. */
export function selectionVariantSignature(value) {
  try {
    if (value === undefined || value === null) return '';
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    if (value.kind === 'fletching' && Object.keys(value).every(key => ['kind', 'alternativeIndexRaw'].includes(key))) {
      const index = value.alternativeIndexRaw;
      return index === null || Number.isSafeInteger(index) && index >= 0 && index <= 1024 ? JSON.stringify(['fletching', index]) : null;
    }
    if (value.kind === 'summoning' && Object.keys(value).every(key => ['kind', 'materialId'].includes(key))) {
      const id = value.materialId;
      return id === null || typeof id === 'string' && id.length > 0 && id.length <= 1024 ? JSON.stringify(['summoning', id]) : null;
    }
    return null;
  } catch { return null; }
}
export function validSelectionVariantSignature(signature) {
  if (signature === '') return true;
  try {
    if (typeof signature !== 'string' || signature.length > 8192) return false;
    const value = JSON.parse(signature); if (!Array.isArray(value) || value.length !== 2) return false;
    const variant = value[0] === 'fletching' ? { kind: value[0], alternativeIndexRaw: value[1] }
      : value[0] === 'summoning' ? { kind: value[0], materialId: value[1] } : null;
    return variant !== null && selectionVariantSignature(variant) === signature;
  } catch { return false; }
}
