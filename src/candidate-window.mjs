/** Fair, bounded views of full Completion candidates. Never a Completion aggregate. */
import { generateCompletionCandidates } from '../setup.mjs';
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 16_384;
const count = value => Number.isSafeInteger(value) && value >= 0;
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
function blocked(reason) { return { status: 'blocked', reason, candidates: [], blockers: [], totalCandidates: null,
  nextCursor: null, wrapped: false, activeRetained: false, fullCoverage: false, runnable: false }; }

export function selectCandidateWindow(snapshot, cursor = null, options = {}) {
  try { return windowGeneratedCandidates(generateCompletionCandidates(snapshot), cursor, options); }
  catch { return blocked('candidate-window-unreadable'); }
}
export function windowGeneratedCandidates(generated, cursor = null, options = {}) {
  try {
    if (!record(options) || Object.keys(options).some(key => !['size', 'activeCandidateId'].includes(key))) return blocked('window-options-invalid');
    const size = options.size ?? 50, active = options.activeCandidateId ?? null;
    if (!count(size) || size < 1 || size > 200 || (active !== null && !id(active))) return blocked('window-options-invalid');
    if (cursor !== null && (!record(cursor) || Object.keys(cursor).some(key => !['afterId', 'wraps'].includes(key)) ||
        (cursor.afterId !== null && !id(cursor.afterId)) || !count(cursor.wraps))) return blocked('window-cursor-invalid');
    if (!Array.isArray(generated?.candidates) || generated.candidates.length > 20_000 || !Array.isArray(generated.blockers))
      return blocked('window-candidates-invalid-or-limit');
    const seen = new Set();
    for (const candidate of generated.candidates) {
      if (!id(candidate?.id) || seen.has(candidate.id) || !['base', 'toth', 'aod', 'ita'].includes(candidate.scopeId) ||
          !['skills', 'mastery', 'items', 'monsters', 'pets'].includes(candidate.category) ||
          !id(candidate.targetId) || candidate.targetId.length > 1024 ||
          (candidate.skillId !== null && (!id(candidate.skillId) || candidate.skillId.length > 1024)) ||
          (candidate.track !== null && !['standard', 'abyssal'].includes(candidate.track)) ||
          (candidate.targetLevel !== null && !count(candidate.targetLevel)) ||
          typeof candidate.title !== 'string' || candidate.title.length > 32_768 ||
          !count(candidate.current) || !count(candidate.maximum) ||
          candidate.current >= candidate.maximum || candidate.runnable !== false) return blocked('window-candidate-invalid-or-duplicate');
      seen.add(candidate.id);
    }
    const all = [...generated.candidates].sort((a, b) => compare(a.id, b.id));
    const pinned = all.find(candidate => candidate.id === active) ?? null;
    const rotating = all.filter(candidate => candidate.id !== pinned?.id);
    if (pinned && rotating.length && size < 2) return blocked('window-no-rotation-capacity');
    const capacity = Math.min(size - (pinned ? 1 : 0), rotating.length);
    let start = cursor?.afterId === null || cursor === null ? 0 : rotating.findIndex(candidate => candidate.id > cursor.afterId);
    let wrapped = start === -1 && rotating.length > 0;
    if (start < 0) start = 0;
    const selected = pinned ? [pinned] : [];
    let afterId = cursor?.afterId ?? null;
    for (let i = 0; i < capacity; i++) {
      const index = (start + i) % rotating.length;
      if (start + i >= rotating.length) wrapped = true;
      selected.push(rotating[index]); afterId = rotating[index].id;
    }
    const wraps = (cursor?.wraps ?? 0) + (wrapped ? 1 : 0);
    if (!count(wraps)) return blocked('window-cursor-overflow');
    const blockers = generated.blockers.slice(0, 256).map(blocker => ({
      id: id(blocker?.id) ? blocker.id : 'completion', reason: typeof blocker?.reason === 'string' && blocker.reason.length <= 512
        ? blocker.reason : 'completion-observation-unavailable' }));
    return { status: selected.length ? 'window' : 'blocked', reason: selected.length ? null : 'no-observed-candidates',
      candidates: structuredClone(selected.sort((a, b) => compare(a.id, b.id))), blockers,
      blockersOmitted: Math.max(0, generated.blockers.length - blockers.length),
      totalCandidates: all.length, nextCursor: { afterId, wraps }, wrapped, activeRetained: pinned !== null,
      fullCoverage: false, runnable: false };
  } catch { return blocked('candidate-window-unreadable'); }
}
