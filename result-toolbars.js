// 入力欄そのものを移動し、既存の絞り込み・CSV処理との接続を維持する。
export function setupResultToolbars(known) {
  const mounted = new WeakSet();
  const genericUpdates = new Set();
  const state = new Map();
  const labelFor = (input) => input.closest("label");
  const createToggle = (text, checked, change) => {
    const label = document.createElement("label"); label.className = "checkbox-label";
    const input = document.createElement("input"); input.type = "checkbox"; input.checked = checked;
    const span = document.createElement("span"); span.textContent = text;
    label.append(input, span); input.addEventListener("change", change);
    return { input, label };
  };
  function mount(table, options = {}) {
    if (mounted.has(table) || table.closest('[data-tab-view="artian-create"]')) return;
    mounted.add(table);
    const container = table.closest(".prediction-table-wrap") ?? table;
    const bar = document.createElement("div"); bar.className = "result-toolbar";
    // 注記・ページ切り替えは表の前に残し、操作バーを表の直前にまとめる。
    container.before(bar);
    if (options.exportButton) bar.append(options.exportButton);
    if (options.extra) bar.append(...options.extra);
    let highlight = options.highlight;
    if (!highlight) {
      const made = createToggle("条件に合う要素だけ強調表示", true, () => {
        table.classList.toggle("gsf-highlight-off", !made.input.checked);
      });
      highlight = made.input; bar.append(made.label);
    } else bar.append(labelFor(highlight));
    let filter = options.filter;
    if (filter) {
      const label = labelFor(filter);
      const text = label.querySelector("span"); if (text) text.textContent = "条件に合う行だけ表示";
      bar.append(label);
    } else {
      const view = table.closest("[data-tab-view]")?.dataset.tabView ?? "";
      const kind = table.classList.contains("owned-matrix-table") ? "matrix" : "matches";
      const stateKey = `${view}:${kind}`;
      const saved = state.get(stateKey) ?? { filter: false, highlight: true };
      state.set(stateKey, saved);
      const made = createToggle("条件に合う行だけ表示", saved.filter, () => { saved.filter = made.input.checked; update(); });
      filter = made.input; bar.append(made.label);
      highlight.checked = saved.highlight;
      highlight.addEventListener("change", () => { saved.highlight = highlight.checked; update(); });
      table.classList.toggle("gsf-highlight-off", !highlight.checked);
      const matrix = table.classList.contains("owned-matrix-table");
      if (matrix) {
        const hint = document.createElement("small"); hint.textContent = "所持（◎）または手動の○がある属性の行を一致として表示します。"; bar.append(hint);
      }
      const update = () => {
        if (!table.isConnected) { genericUpdates.delete(update); return; }
        const current = state.get(stateKey);
        filter.checked = current.filter; highlight.checked = current.highlight;
        table.classList.toggle("gsf-highlight-off", !current.highlight);
        for (const row of table.tBodies[0]?.rows ?? []) {
          const match = matrix ? !!row.querySelector(".auto, .mark-o") : !row.classList.contains("none");
          const hide = current.filter && !match;
          if (row.hidden !== hide) row.hidden = hide;
          const mark = !matrix && match && current.highlight;
          if (row.classList.contains("gsf-result-hit") !== mark) row.classList.toggle("gsf-result-hit", mark);
        }
      };
      genericUpdates.add(update); update();
    }
    if (options.status) {
      options.status.classList.add("result-export-status"); bar.append(options.status);
    }
    table.dataset.resultToolbar = "true";
  }
  for (const entry of known) if (entry.table) mount(entry.table, entry);
  const scan = () => {
    document.querySelectorAll("[data-tab-view] table").forEach((table) => mount(table));
    for (const update of genericUpdates) update();
  };
  scan();
  let scheduled = false;
  new MutationObserver(() => {
    if (scheduled) return; scheduled = true;
    requestAnimationFrame(() => { scheduled = false; scan(); });
  }).observe(document.querySelector("main"), { childList: true, subtree: true, characterData: true });
}
