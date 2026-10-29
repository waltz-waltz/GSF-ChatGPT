// 同じ公開ドメイン内の、許可されたキーだけを扱う。通信や外部送信は行わない。
export const KEY_MAP = [
  ['state', '現在の状態・予測対象'], ['owned-weapons', '手持ち武器【巨戟】'],
  ['artian-owned', '手持ち武器【通常】'], ['owned-matrix', '所持表・手動の印'],
  ['bonus-wishes', '復元ボーナスの希望'], ['artian-wishes', '通常アーティアの希望'],
  ['detail-tier-wishes', '段階まで指定した希望'], ['weapon-filters', '武器種ごとのスキル条件'],
  ['bonus-view', '表と登録欄の設定'], ['language', '言語設定'],
].map(([name, label]) => ({
  source: `gogma-seed-finder-${name}-v1`, target: `gogma-seed-finder-chatgpt-${name}-v1`,
  label, type: name === 'language' ? 'language' : ['owned-weapons', 'artian-owned'].includes(name) ? 'array' : 'object',
}));
KEY_MAP.push({ source: 'mh-sim-launcher-v1', target: 'mh-sim-launcher-chatgpt-v1', label: 'シミュランチャーの設定', type: 'object' });
export const BACKUP_KEY = 'gsf-chatgpt-before-claude-transfer-v1';
export const DRAFT_KEY = 'gsf-chatgpt-creation-draft-v1';
const TARGET_KEYS = [...KEY_MAP.map((entry) => entry.target), DRAFT_KEY];
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const validNumber = (value, max) => value === undefined || value === null ||
  ((typeof value === 'number' || typeof value === 'string' && /^\d+$/.test(value)) && Number.isSafeInteger(Number(value)) && Number(value) >= 0 && Number(value) <= max);

function validateValue(entry, raw) {
  if (raw === null) return;
  if (entry.type === 'language') {
    if (!['ja', 'en', 'zh-Hant'].includes(raw)) throw new Error('言語設定の形式を読み取れませんでした。');
    return;
  }
  let parsed;
  try { parsed = JSON.parse(raw); } catch { throw new Error(`${entry.label}の保存内容を読み取れませんでした。元のデータを確認してください。`); }
  if (entry.type === 'array' ? !Array.isArray(parsed) : !isObject(parsed)) throw new Error(`${entry.label}の形式が異なるため、引き継ぎを止めました。`);
  if (entry.source === 'gogma-seed-finder-state-v1') {
    const state = parsed.saveState ?? {};
    if (!isObject(state) || !validNumber(state.baseSeed, 99_999_999) ||
        !validNumber(state.bonusCounter, 4_294_967_295) || !validNumber(state.skillCounter, 4_294_967_295) ||
        parsed.targets !== undefined && !Array.isArray(parsed.targets) ||
        parsed.artianBaseState !== undefined && !isObject(parsed.artianBaseState)) {
      throw new Error('seed・カウンターの形式が異なるため、引き継ぎを止めました。');
    }
    const artian = parsed.artianBaseState ?? {};
    if (!validNumber(artian.baseSeed, 99_999_999) || artian.counters !== undefined && !isObject(artian.counters) ||
        Object.values(artian.counters ?? {}).some((n) => !validNumber(n, 4_294_967_295))) {
      throw new Error('通常アーティアカウンターの形式を読み取れませんでした。');
    }
  }
  if (entry.type === 'array' && parsed.some((weapon) => !isObject(weapon) || !Number.isInteger(weapon.weaponType) || weapon.weaponType < 0 || weapon.weaponType > 13)) {
    throw new Error(`${entry.label}に読み取れない武器種があります。`);
  }
}

export function readLegacy(storage) {
  const snapshot = Object.fromEntries(KEY_MAP.map((entry) => {
    const raw = storage.getItem(entry.source); validateValue(entry, raw); return [entry.target, raw];
  }));
  snapshot[DRAFT_KEY] = null;
  return snapshot;
}
export function readCurrent(storage) {
  return Object.fromEntries(TARGET_KEYS.map((key) => [key, storage.getItem(key)]));
}
export function hasLegacy(snapshot) {
  return KEY_MAP.some((entry) => entry.target.startsWith('gogma-seed-finder-chatgpt-') && entry.type !== 'language' && snapshot[entry.target] !== null);
}
export function summarize(snapshot) {
  const read = (name, fallback) => {
    try { return JSON.parse(snapshot[`gogma-seed-finder-chatgpt-${name}-v1`] ?? 'null') ?? fallback; } catch { return fallback; }
  };
  const state = read('state', {}), save = state.saveState ?? {};
  const matrix = read('owned-matrix', {});
  return [
    ['基準seed', save.baseSeed ?? '未特定'],
    ['復元カウンター', save.bonusCounter ?? '未特定'],
    ['スキルカウンター', save.skillCounter ?? '未特定'],
    ['通常アーティアカウンター', `${Object.keys(state.artianBaseState?.counters ?? {}).length}武器種`],
    ['手持ち武器【巨戟】', `${read('owned-weapons', []).length}本`],
    ['手持ち武器【通常】', `${read('artian-owned', []).length}本`],
    ['予測対象の登録', `${state.targets?.length ?? 0}件`],
    ['所持表', `${matrix.blocks?.length ?? 0}組・手動の印 ${Object.keys(matrix.marks ?? {}).length}個`],
    ['復元ボーナスの希望', `${Object.keys(read('bonus-wishes', {})).length}武器種`],
    ['通常アーティアの希望', `${Object.keys(read('artian-wishes', {})).length}武器種`],
    ['スキル条件', `${Object.keys(read('weapon-filters', {})).length}武器種`],
  ];
}
export function readBackup(storage) {
  const raw = storage.getItem(BACKUP_KEY); if (!raw) return null;
  let backup;
  try { backup = JSON.parse(raw); } catch { throw new Error('引き継ぎ前の控えを読み取れませんでした。'); }
  if (backup.format !== 'gsf-transfer-backup' || backup.version !== 1 || !isObject(backup.data) ||
      TARGET_KEYS.some((key) => backup.data[key] !== null && typeof backup.data[key] !== 'string')) throw new Error('引き継ぎ前の控えの形式が異なります。');
  return { ...backup, data: Object.fromEntries(TARGET_KEYS.map((key) => [key, backup.data[key]])) };
}
const snapshotsEqual = (a, b) => TARGET_KEYS.every((key) => a[key] === b[key]);
const writeSnapshot = (storage, data) => {
  for (const key of TARGET_KEYS) { if (data[key] === null) storage.removeItem(key); else storage.setItem(key, data[key]); }
};

export function applyTransfer(storage, source, expectedCurrent, { restore = false } = {}) {
  if (!snapshotsEqual(readCurrent(storage), expectedCurrent)) throw new Error('確認中にChatGPT版のデータが変わりました。もう一度、引き継ぐ内容を確認してください。');
  if (!restore && !snapshotsEqual(readLegacy(storage), source)) throw new Error('確認中にClaude版のデータが変わりました。もう一度、内容を確認してください。');
  if (!restore && !hasLegacy(source)) throw new Error('このブラウザではClaude版の保存データが見つかりません。');
  const oldBackup = storage.getItem(BACKUP_KEY);
  try {
    // 実データを書き換える前に、現在の状態を必ず退避する。
    storage.setItem(BACKUP_KEY, JSON.stringify({ format: 'gsf-transfer-backup', version: 1, createdAt: new Date().toISOString(), data: expectedCurrent }));
    writeSnapshot(storage, source);
  } catch (error) {
    try {
      storage.removeItem(BACKUP_KEY); writeSnapshot(storage, expectedCurrent);
      if (oldBackup !== null) storage.setItem(BACKUP_KEY, oldBackup);
    } catch {
      throw new Error('保存と復元を完了できませんでした。このページを閉じず、ブラウザの保存領域を確認してください。', { cause: error });
    }
    throw new Error('保存できなかったため、変更前の状態に戻しました。元のClaude版のデータは変更していません。', { cause: error });
  }
}

export function mountTransfer(panel, storage = localStorage) {
  const el = (tag, text) => Object.assign(document.createElement(tag), text === undefined ? {} : { textContent: text });
  const details = el('details'); details.className = 'state-code-details'; details.id = 'claude-data-transfer';
  const summary = el('summary', 'Claude版からデータをまとめて引き継ぐ'); details.append(summary);
  details.append(el('p', 'Claude版を使っているのと同じブラウザ・同じプロフィールで、この公開ページを開いてください。手持ち武器、各カウンター、所持表、希望条件、表の設定をまとめて引き継ぎます。'));
  const error = el('p'); error.className = 'error'; error.setAttribute('role', 'alert');
  const preview = el('div');
  const actions = el('div'); actions.className = 'comparison-actions';
  const makeButton = (text, action) => {
    const button = el('button', text); button.type = 'button'; button.className = 'secondary small-button';
    button.addEventListener('click', () => { error.textContent = ''; try { action(); } catch (e) { error.textContent = e.message; } });
    return button;
  };
  const reloadButton = makeButton('引き継いだデータで画面を開き直す', () => location.reload());
  const showPreview = (source, restore) => {
    const current = readCurrent(storage);
    preview.replaceChildren();
    if (!restore && !hasLegacy(source)) {
      preview.append(el('p', 'Claude版の保存データが見つかりませんでした。登録済みのClaude版を普段開いているブラウザ・プロフィールで、GSF ChatGPTを開いてください。PC内で開く版と公開版は保存領域が別です。'));
      return;
    }
    const heading = el('h3', restore ? '引き継ぎ前の控えに戻す内容' : 'Claude版から引き継ぐ内容');
    const list = el('dl'); list.style.cssText = 'display:grid;grid-template-columns:minmax(150px,1fr) 1fr 1fr;gap:8px 14px;max-width:760px';
    list.append(el('dt', '項目'), el('dd', '取り込み後'), el('dd', '今のChatGPT版'));
    const before = summarize(current);
    summarize(source).forEach(([label, value], i) => list.append(el('dt', label), el('dd', String(value)), el('dd', String(before[i][1]))));
    const note = el('p', `今のChatGPT版の登録と設定を、表示した内容に置き換えます。変更前の状態はブラウザ内に控えを残します。${restore ? '作成案内も控えを保存した時点に戻します。' : '進行中の作成案内は取り消されます。'}Claude版の登録はそのまま残ります。`);
    const commit = makeButton(restore ? '現在の状態を控えて、引き継ぎ前に戻す' : '今の状態を控えて、Claude版から引き継ぐ', () => {
      if (restore) {
        const latest = readBackup(storage);
        if (!latest || !snapshotsEqual(latest.data, source)) throw new Error('控えが更新されています。もう一度確認してください。');
      }
      applyTransfer(storage, source, current, { restore });
      preview.replaceChildren(el('p', restore ? '引き継ぎ前の状態に戻しました。下のボタンで画面を開き直してください。' : '引き継ぎが完了しました。下のボタンで画面を開き直すと、手持ち武器やカウンターが表示されます。'), reloadButton);
      actions.replaceChildren();
      // 旧状態のアプリが再保存するのを防ぐため、再読み込みまで操作を保留する。
      for (const control of document.querySelectorAll('button,input,select,textarea,summary,a')) {
        if (details.contains(control)) continue;
        if ('disabled' in control) control.disabled = true;
        control.setAttribute('inert', '');
      }
    });
    commit.classList.add('primary');
    preview.append(heading, list, note, commit);
  };
  const check = makeButton('Claude版のデータを確認する', () => showPreview(readLegacy(storage), false));
  const restore = makeButton('引き継ぎ前の控えを確認する', () => {
    const backup = readBackup(storage);
    if (!backup) throw new Error('このブラウザには、まだ引き継ぎ前の控えがありません。');
    showPreview(backup.data, true);
  });
  actions.append(check, restore); details.append(actions, error, preview);
  panel.querySelector('.storage-note')?.after(details);
  if (!details.isConnected) panel.append(details);
}

if (typeof document !== 'undefined') {
  const panel = document.querySelector('.save-state-panel');
  if (panel) mountTransfer(panel);
}
