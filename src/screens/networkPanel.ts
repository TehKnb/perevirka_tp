import { config } from '../config';
import { speedProblems, type NetworkState, type SpeedProgress } from '../network/speedTest';
import { t } from '../texts';
import { byId } from '../ui/dom';

type RowId = 'download' | 'upload';
type RowStatus = 'pending' | 'pass' | 'fail';

/** Окремий блок «Швидкість інтернету»: фаза тесту, виміряні числа й потрібні мінімуми. */
export function createNetworkPanel() {
  const panel = byId('net-panel');
  const status = byId('net-status');
  const retest = byId<HTMLButtonElement>('btn-retest-internet');
  const c = config.network;

  const rows: Record<RowId, { row: HTMLElement; value: HTMLElement }> = {
    download: { row: byId('net-row-download'), value: byId('net-download') },
    upload: { row: byId('net-row-upload'), value: byId('net-upload') },
  };
  byId('net-need-download').textContent = t.setup.netNeedMin(c.minDownloadMbps, t.setup.mbps);
  byId('net-need-upload').textContent = t.setup.netNeedMin(c.minUploadMbps, t.setup.mbps);

  function setRow(id: RowId, value: number | undefined, rowStatus: RowStatus) {
    rows[id].value.textContent = value === undefined ? '—' : `${value.toFixed(1)} ${t.setup.mbps}`;
    rows[id].row.dataset.status = rowStatus;
  }

  function reset() {
    (Object.keys(rows) as RowId[]).forEach((id) => setRow(id, undefined, 'pending'));
  }

  reset();
  status.textContent = t.setup.netWaiting;

  return {
    onRetest(handler: () => void) {
      retest.addEventListener('click', handler);
    },

    /** Проміжні числа під час тесту. */
    progress(p: SpeedProgress) {
      if (p.phase === 'ping') reset();
      panel.dataset.status = 'checking';
      retest.hidden = true;
      // Пінг міряється лише для метаданих, тож для людини це просто «підготовка».
      status.textContent = p.phase === 'upload' ? t.setup.netPhaseUpload : t.setup.netPhaseDownload;
      if (p.downloadMbps !== undefined)
        setRow('download', p.downloadMbps, p.downloadMbps >= c.minDownloadMbps ? 'pass' : 'fail');
    },

    /** Підсумок тесту. */
    show(state: NetworkState) {
      if (state.status === 'checking') return;
      if (state.status === 'error') {
        panel.dataset.status = 'fail';
        status.textContent = t.setup.netError;
        retest.hidden = false;
        return;
      }
      const r = state.result;
      const problems = speedProblems(r, c);
      setRow('download', r.downloadMbps, problems.includes('download') ? 'fail' : 'pass');
      setRow('upload', r.uploadMbps, problems.includes('upload') ? 'fail' : 'pass');
      const ok = problems.length === 0;
      panel.dataset.status = ok ? 'pass' : 'fail';
      status.textContent = ok ? t.setup.netOk : t.setup.netSlow;
      retest.hidden = ok;
    },
  };
}
