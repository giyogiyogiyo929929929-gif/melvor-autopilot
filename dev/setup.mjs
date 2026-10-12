import { captureCompletionProbe } from './completion-probe.mjs';

/** Separate developer package. No observation happens until the operator clicks. */
export function setup(ctx) {
  ctx.onInterfaceReady(() => {
    if (typeof document === 'undefined' || document.getElementById('autopilot-probe-panel')) return;
    let stopped = false;
    let result = null;
    const panel = document.createElement('section');
    panel.id = 'autopilot-probe-panel';
    Object.assign(panel.style, { position: 'fixed', right: '16px', bottom: '16px', zIndex: '1050',
      width: '460px', maxWidth: 'calc(100vw - 32px)', maxHeight: 'calc(100vh - 120px)',
      overflowY: 'auto', padding: '12px', background: '#17202d', color: '#f5f7fc',
      border: '1px solid #8493a7', borderRadius: '8px', font: '13px/1.5 system-ui' });
    const title = document.createElement('div');
    title.textContent = 'Completion 開発検証 — 読み取り専用';
    const status = document.createElement('div'); status.textContent = '停止中 / 手動1回観測 / 操作機能なし';
    const actions = document.createElement('div');
    Object.assign(actions.style, { display: 'flex', gap: '8px', margin: '8px 0' });
    const observe = document.createElement('button'); observe.textContent = '観測1回';
    const stop = document.createElement('button'); stop.textContent = '停止';
    const download = document.createElement('button'); download.textContent = '結果JSON'; download.disabled = true;
    const collapse = document.createElement('button'); collapse.textContent = '結果を隠す';
    const output = document.createElement('div');
    Object.assign(output.style, { whiteSpace: 'pre-wrap', wordBreak: 'break-word',
      fontSize: '12px', color: '#f5f7fc', maxHeight: '260px', overflowY: 'auto' });
    output.textContent = '複製スロット2の検証用。正常adapterの許可には使いません。';
    for (const button of [observe, stop, download, collapse]) {
      button.type = 'button';
      Object.assign(button.style, { color: '#fff', background: '#263b55', border: '1px solid #8493a7',
        borderRadius: '5px', padding: '5px' }); actions.append(button);
    }
    panel.append(title, status, actions, output); document.body.append(panel);
    observe.addEventListener('click', () => {
      if (stopped) return;
      result = captureCompletionProbe({
        context: () => ({
          gameTitle: typeof gameTitle === 'undefined' ? null : gameTitle,
          currentCharacter: typeof currentCharacter === 'undefined' ? null : currentCharacter,
          characterSelected: typeof characterSelected === 'undefined' ? null : characterSelected,
          isLoadingSave: typeof isLoadingSave === 'undefined' ? null : isLoadingSave,
          isCreatingSave: typeof isCreatingSave === 'undefined' ? null : isCreatingSave,
          loadingOfflineProgress: typeof loadingOfflineProgress === 'undefined' ? null : loadingOfflineProgress
        }), game: () => typeof game === 'undefined' ? null : game
      });
      output.textContent = JSON.stringify(result, null, 2);
      status.textContent = `観測終了 / 停止中 / ${result.status} / ${result.reason ?? '診断データ取得'}`;
      download.disabled = false;
    });
    stop.addEventListener('click', () => {
      stopped = true; observe.disabled = true; status.textContent = '停止中 / 再観測は再読み込み後';
    });
    collapse.addEventListener('click', () => {
      output.hidden = !output.hidden; collapse.textContent = output.hidden ? '結果を表示' : '結果を隠す';
    });
    download.addEventListener('click', () => {
      if (result === null) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'autopilot-completion-probe.json';
      anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  });
}
