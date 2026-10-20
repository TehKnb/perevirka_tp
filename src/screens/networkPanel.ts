import { config } from '../config';
import type { ConnectionKind } from '../network/mobileNetwork';
import { speedProblems, type NetworkState, type SpeedProgress } from '../network/speedTest';
import { t } from '../texts';
import { byId } from '../ui/dom';

type RowId = 'download' | 'upload';
type RowStatus = 'pending' | 'pass' | 'fail';

/** Окремий блок «Швидкість інтернету»: тип підключення, фаза тесту, виміряні числа й потрібні мінімуми. */
export function createNetworkPanel() {
  const panel = byId('net-panel');
  const status = byId('net-status');
  const retest = byId<HTMLButtonElement>('btn-retest-internet');
  const c = config.network;

  const rows: Record<RowId, { row: HTMLElement; value: HTMLElement }> = {
    download: { row: byId('net-row-download'), value: byId('net-download') },
    upload: { row: byId('net-row-upload'), value: byId('net-upload') },
  };
  const connection = { row: byId('net-row-connection'), value: byId('net-connection') };
  byId('net-row-connection').hidden = !c.rejectMobile;
  byId('net-need-download').textContent = t.setup.netNeedMin(c.minDownloadMbps, t.setup.mbps);
  byId('net-need-upload').textContent = t.setup.netNeedMin(c.minUploadMbps, t.setup.mbps);

  function setRow(id: RowId, value: number | undefined, rowStatus: RowStatus) {
    rows[id].value.textContent = value === undefined ? '—' : `${value.toFixed(1)} ${t.setup.mbps}`;
    rows[id].row.dataset.status = rowStatus;
  }

  function setConnection(kind: ConnectionKind | undefined) {
    if (!kind) {
      connection.value.textContent = '—';
      connection.row.dataset.status = 'pending';
      return;
    }
    connection.value.textContent =
      kind.kind === 'mobile'
        ? t.setup.netConnectionMobile(kind.operator)
        : kind.kind === 'other'
          ? t.setup.netConnectionOther
          : t.setup.netConnectionUnknown;
    // «Не вдалося визначити» не блокує, але й не позначаємо зеленим.
    connection.row.dataset.status = kind.kind === 'mobile' ? 'fail' : kind.kind === 'other' ? 'pass' : 'pending';
  }

  function reset() {
    setConnection(undefined);
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
      // Під час пінгу визначаємо IP-адресу, тож для людини це «перевіряємо підключення».
      status.textContent =
        p.phase === 'ping' ? t.setup.netPhaseConnection : p.phase === 'upload' ? t.setup.netPhaseUpload : t.setup.netPhaseDownload;
      if (p.network) setConnection(p.network);
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
      setConnection(r.network);
      // Швидкість не міряли (мобільний інтернет) — рядки лишаються з прочерком.
      setRow('download', r.downloadMbps ?? undefined, r.downloadMbps === null ? 'pending' : problems.includes('download') ? 'fail' : 'pass');
      setRow('upload', r.uploadMbps ?? undefined, r.uploadMbps === null ? 'pending' : problems.includes('upload') ? 'fail' : 'pass');
      const ok = problems.length === 0;
      panel.dataset.status = ok ? 'pass' : 'fail';
      status.textContent = ok ? t.setup.netOk : problems.includes('mobile') ? t.setup.netMobile : t.setup.netSlow;
      retest.hidden = ok;
    },
  };
}
