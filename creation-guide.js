// 作成案内は最後の確定まで保存中のカウンターを変更しない。
export function finalCounters(origin, used) {
  const limits = { normal: 1_000_000, skill: 4_294_967_295, bonus: 4_294_967_295 };
  const result = {};
  for (const key of Object.keys(limits)) {
    if (!Number.isSafeInteger(origin[key]) || origin[key] < 0 ||
        !Number.isSafeInteger(used[key]) || used[key] < 1 || origin[key] + used[key] > limits[key]) {
      throw new Error("カウンターの範囲を超えています。現在位置と消化回数を確認してください。");
    }
    result[key] = origin[key] + used[key];
  }
  return result;
}

const DRAFT_KEY = "gsf-chatgpt-creation-draft-v1";
const SERIES_DEFAULT = [11, 5, 18];
const CATEGORY_IDS = [4, 8, 6, 7];
const node = (tag, text, cls) => Object.assign(document.createElement(tag), {
  ...(text === undefined ? {} : { textContent: text }), ...(cls ? { className: cls } : {}),
});

export function mountCreationGuide(root, host) {
  let draft = null;
  let rows = [];
  let rowLimit = 30;
  let busy = false;
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "null");
    if (saved?.version === 1 && Number.isInteger(saved.stage) && saved.stage >= 1 && saved.stage <= 4 &&
        saved.config && saved.origin && saved.choices && saved.used) draft = saved;
  } catch { /* 保存を利用できない場合も、新規の案内は使える。 */ }
  const persist = () => {
    // カウンターを保留する案内なので、再読み込みに備えて必ず途中経過を保存する。
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  };
  const fail = (error) => {
    let message = root.querySelector(".creation-error");
    if (!message) { message = node("p", "", "error creation-error"); root.prepend(message); }
    message.textContent = error instanceof Error ? error.message : String(error);
    message.scrollIntoView({ block: "nearest" });
  };
  const button = (text, action, cls = "secondary") => {
    const b = node("button", text, cls); b.type = "button";
    b.addEventListener("click", async () => {
      if (busy) return;
      busy = true; b.disabled = true;
      try { await action(); } catch (e) { fail(e); }
      finally { busy = false; b.disabled = false; }
    });
    return b;
  };
  const field = (label, input) => { const box = node("label"); box.append(node("span", label), input); return box; };
  const select = (items, value) => {
    const el = node("select");
    for (const [id, text] of items) { const opt = node("option", text); opt.value = String(id); el.append(opt); }
    el.value = String(value); return el;
  };
  const number = (value, min, max) => {
    const el = node("input"); el.type = "number"; el.min = min; el.max = max; el.value = value; return el;
  };
  const toggle = (text, checked, onChange) => {
    const el = node("input"); el.type = "checkbox"; el.checked = checked;
    if (onChange) el.addEventListener("change", onChange);
    const label = node("label", undefined, "checkbox-label"); label.append(el, node("span", text));
    return { el, label };
  };
  const validNumber = (input, min, max, label) => {
    const value = Number(input.value);
    if (input.value === "" || !Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${label}を${min}〜${max}の整数で入力してください。`);
    return value;
  };
  const heading = () => {
    root.replaceChildren(node("p", "CREATION GUIDE", "step"), node("h2", "通常アーティア作成"),
      node("p", "通常作成 → 巨戟化（スキル） → 復元強化 → 完成・セーブの順に案内します。途中で消化した回数も数え、最後に各カウンターと手持ち武器をまとめて更新します。"));
  };
  const assertCurrent = () => {
    const now = host.snapshot(draft.config.weaponType);
    if (["baseSeed", "normal", "skill", "bonus"].some((key) => now[key] !== draft.origin[key])) {
      throw new Error("案内開始後に現在のカウンターが変わりました。二重に進めないため更新を止めました。現在位置を確認して案内を作り直してください。");
    }
  };
  function setup() {
    heading();
    const grid = node("div", undefined, "field-grid creation-fields");
    const weapon = select(host.weapons, 11), attribute = select(host.attributes, 1);
    const boost = select(host.boosts, "攻撃激化"), count = number(1000, 1, 10000);
    const name = node("input"); name.type = "text"; name.maxLength = 24; name.placeholder = "省略すると自動で名前を付けます";
    const mode = select([["keep", "同じ構成で強化する"], ["reset", "リセットして強化する"]], "keep");
    grid.append(field("武器種", weapon), field("属性", attribute), field("激化タイプ", boost),
      field("各段階で何回先まで探すか", count), field("完成武器の名前（任意）", name), field("最初の復元強化の方法", mode));
    root.append(grid, node("h3", "通常アーティアで欲しい系統の数（最低数・順不同）"));
    const wishes = node("div", undefined, "field-grid creation-fields");
    const counts = ["攻撃", "会心", "属性", "斬れ味・装填"].map((text) => {
      const input = number(0, 0, 5); wishes.append(field(text, input)); return input;
    });
    root.append(wishes, node("p", "0は指定なしです。武器種に存在しない系統や上限を超える希望は、作成案内を始めるときにお知らせします。", "pool-note"), node("h3", "巨戟化で欲しいスキル"));
    const group = select([[-1, "指定しない"], ...host.groups.map((text, id) => [id, text])], 13);
    root.append(field("グループスキル（シリーズとはAND）", group));
    const series = node("div", undefined, "creation-series");
    const ordered = [...SERIES_DEFAULT, ...host.series.map((_, i) => i).filter((i) => !SERIES_DEFAULT.includes(i))];
    const checks = ordered.map((i) => {
      const check = toggle(host.series[i], SERIES_DEFAULT.includes(i)); check.el.value = i; series.append(check.label); return check.el;
    });
    const minEx = number(2, 0, 5);
    root.append(series, field("復元強化で欲しいEXの最低数", minEx), node("p", "まず作成・スキル・復元の現在位置を、上部の手入力や各特定タブで設定してください。希望を変更するときは、案内を取り消して設定し直せます。", "pool-note"));
    const start = button("現在のカウンターから作成案内を始める", async () => {
      const config = {
        weaponType: Number(weapon.value), attributeForce: Number(attribute.value), boost: boost.value,
        label: name.value.trim(), mode: mode.value, count: validNumber(count, 1, 10000, "予測回数"),
        counts: counts.map((input) => validNumber(input, 0, 5, "希望の数")),
        group: Number(group.value), series: checks.filter((el) => el.checked).map((el) => Number(el.value)),
        minEx: validNumber(minEx, 0, 5, "EXの最低数"),
      };
      const pool = host.pool(config.weaponType, config.attributeForce);
      if (config.counts.reduce((a, b) => a + b, 0) > 5 || config.counts.some((need, i) => need > (pool.caps.get(CATEGORY_IDS[i]) ?? 0))) {
        throw new Error("希望する系統の数が、この武器種で作れる上限を超えています。");
      }
      const origin = host.snapshot(config.weaponType);
      if (["baseSeed", "normal", "skill", "bonus"].some((key) => !Number.isSafeInteger(origin[key]) || origin[key] < 0)) {
        throw new Error("基準seed・この武器種の通常アーティアカウンター・スキルカウンター・復元カウンターを先に設定してください。");
      }
      draft = { version: 1, stage: 1, config, origin, used: {}, choices: {} };
      persist(); await renderStage();
    }, "primary");
    root.append(start);
  }
  function discardDialog() {
    const box = node("div", undefined, "creation-discard");
    box.append(node("p", "案内だけを取り消します。ゲーム内ですでに作成・強化してセーブしている場合は、その分のカウンターを手入力で合わせてから次の案内を始めてください。"),
      button("案内を取り消して設定へ戻る", () => { localStorage.removeItem(DRAFT_KEY); draft = null; setup(); }),
      button("案内を続ける", () => box.remove()));
    root.append(box);
  }
  async function renderStage() {
    heading();
    try { assertCurrent(); } catch (error) {
      fail(error); root.append(button("保留中の案内を取り消す", discardDialog)); return;
    }
    const { config: c, origin: o, stage } = draft;
    root.append(node("p", `${host.weapons.find(([id]) => id === c.weaponType)?.[1]}・${host.attributes.find(([id]) => id === c.attributeForce)?.[1]}　${c.boost}　｜　${stage}/4`, "status-pill complete"),
      node("p", "案内中のカウンターは保留中です。途中経過はこのブラウザに保存され、続きから再開できます。"));
    root.append(button("案内を取り消す・設定を変える", discardDialog, "text-button"));
    if (stage === 4) { renderFinish(); return; }
    const keyForStage = ["", "normal", "skill", "bonus"][stage];
    const remaining = (stage === 1 ? 1_000_000 : 4_294_967_295) - o[keyForStage];
    const countToGenerate = Math.min(c.count, remaining);
    if (countToGenerate < 1) throw new Error("このカウンターは上限です。現在位置を確認してください。");
    const titles = ["", "① 通常アーティアを作る", "② 巨戟化してスキルを付ける", "③ 復元強化する"];
    root.append(node("h3", titles[stage]));
    if (stage === 1) {
      rows = host.normal(o.baseSeed, c.weaponType, o.normal, countToGenerate, c.attributeForce).map((roll, i) => ({
        offset: i + 1, value: roll.bonusIds, match: c.counts.every((need, category) => roll.bonusIds.filter((id) => id === CATEGORY_IDS[category]).length >= need),
      }));
      root.append(node("p", "欲しい行を選び、その本数まで同じ武器種のレア8を作ってください。途中の武器は消化用です。狙いの1本の5枠をゲーム内で照合してから次へ進みます。", "adoption-note"));
    } else {
      await host.ready();
      if (stage === 2) {
        rows = Array.from(host.skill(o.baseSeed, c.weaponType, c.attributeForce, o.skill, countToGenerate), (index, i) => {
          const value = { seriesIndex: Math.floor(index / host.groups.length), groupIndex: index % host.groups.length };
          return { offset: i + 1, value, match: (c.group < 0 || value.groupIndex === c.group) && (c.series.length === 0 || c.series.includes(value.seriesIndex)) };
        });
        root.append(node("p", "狙いの回の1つ前まで、別の巨戟武器へのスキル再付与などで消化します。最後の1回で、今回作った通常アーティアを巨戟化してください。巨戟化だけでは復元カウンターは進みません。", "adoption-note"));
      } else {
        const mode = select([["keep", "同じ構成で強化する"], ["reset", "リセットして強化する"]], c.mode);
        mode.addEventListener("change", async () => {
          c.mode = mode.value; delete draft.choices.bonus; delete draft.used.bonus;
          persist(); try { await renderStage(); } catch (e) { fail(e); }
        });
        root.append(field("ゲーム内で選ぶ復元強化の方法", mode));
        const categories = draft.choices.normal.map((id) => CATEGORY_IDS.indexOf(id));
        const flat = host.bonus(o.baseSeed, c.weaponType, c.attributeForce, o.bonus, countToGenerate, c.mode, categories);
        rows = Array.from({ length: countToGenerate }, (_, i) => {
          const value = Array.from(flat.slice(i * 5, i * 5 + 5));
          const resetMatches = c.mode !== "reset" || c.counts.every((need, category) => value.filter((id) => host.category(id) === category).length >= need);
          return { offset: i + 1, value, match: value.filter((id) => host.isEx(id)).length >= c.minEx && resetMatches };
        });
        root.append(node("p", "狙いの回の1つ前まで、別の武器の復元強化・再復元などで消化し、最後の1回で今回の武器を強化します。最初の強化でも選択方法と5枠をゲーム内で照合してください。異なる場合は確定せず、現在位置や方法を確認してください。", "adoption-note"));
      }
    }
    rowLimit = 30;
    const key = ["", "normal", "skill", "bonus"][stage];
    const selected = node("div", undefined, "creation-selected");
    const confirm = toggle("ゲーム内で、選んだ回まで実行し、最後の結果が一致した", false);
    const next = button(stage === 3 ? "復元強化できた・完成確認へ" : "この結果ができた・次へ", async () => {
      assertCurrent();
      if (!confirm.el.checked || !draft.choices[key]) throw new Error("結果を選び、ゲーム内の実行・一致を確認してください。");
      draft.stage += 1; persist(); await renderStage();
    }, "primary");
    next.disabled = true;
    const wrapper = node("div", undefined, "prediction-table-wrap creation-results");
    const table = node("table", undefined, "prediction-table");
    const head = node("thead"), hr = node("tr");
    [stage === 1 ? "何本先" : "何回先", "結果", "選択"].forEach((text) => hr.append(node("th", text)));
    head.append(hr); const body = node("tbody"); table.append(head, body); wrapper.append(table);
    const toolbar = node("div", undefined, "result-toolbar");
    const highlight = toggle("条件に合う要素だけ強調表示", true, () => draw());
    const matchesOnly = toggle("条件に合う行だけ表示", true, () => { rowLimit = 30; draw(); });
    const more = button("続きを30件表示", () => { rowLimit += 30; draw(); });
    const exportCsv = button("検索結果をCSV出力", () => {
      host.csv(`gsf-creation-${key}.csv`, ["何回先", "結果"], visible().map((r) => [r.offset, resultText(r.value)]));
    });
    toolbar.append(exportCsv, highlight.label, matchesOnly.label);
    const count = node("p", "", "pool-note");
    root.append(count, toolbar, wrapper, more, selected, confirm.label, next);
    confirm.el.addEventListener("change", () => { next.disabled = !confirm.el.checked || !draft.choices[key]; });
    const resultText = (value) => stage === 2 ? `${host.series[value.seriesIndex]} ／ ${host.groups[value.groupIndex]}` : value.map((id) => stage === 1 ? host.normalName(c.weaponType, id) : host.bonusName(c.weaponType, id)).join(" ／ ");
    const visible = () => rows.filter((r) => !matchesOnly.el.checked || r.match);
    function choose(row) {
      draft.choices[key] = row.value; draft.used[key] = row.offset; persist();
      confirm.el.checked = false; next.disabled = true;
      const skip = row.offset - 1;
      selected.replaceChildren(node("strong", `選択：${row.offset}${stage === 1 ? "本" : "回"}先　${resultText(row.value)}`),
        node("p", `途中の消化 ${skip}${stage === 1 ? "本" : "回"} ＋ 最後の${stage === 1 ? "作成" : stage === 2 ? "巨戟化" : "復元強化"} 1回。${key === "normal" ? "この武器種の作成" : key === "skill" ? "スキル" : "復元"}カウンター：${o[key]} → ${o[key] + row.offset}`));
      draw();
    }
    function draw() {
      const filtered = visible();
      count.textContent = `${rows.length}件中 ${rows.filter((r) => r.match).length}件が希望に一致。${filtered.length}件から表示しています。`;
      body.replaceChildren(...filtered.slice(0, rowLimit).map((r) => {
        const tr = node("tr"); if (highlight.el.checked && r.match) tr.className = "prediction-match";
        const result = node("td");
        if (stage === 2) result.textContent = resultText(r.value);
        else r.value.forEach((id) => result.append(host.tag(c.weaponType, id, stage === 1)));
        const action = node("td");
        const b = button(draft.used[key] === r.offset ? "選択中" : "この結果を選ぶ", () => choose(r));
        action.append(b); tr.append(node("th", `${r.offset}${stage === 1 ? "本" : "回"}先`), result, action); return tr;
      }));
      if (!filtered.length) { const tr = node("tr"), td = node("td", "希望に一致する結果がありません。絞り込みを外して選ぶか、案内の設定で予測回数や希望を変更してください。"); td.colSpan = 3; tr.append(td); body.append(tr); }
      more.hidden = rowLimit >= filtered.length;
    }
    draw();
    if (draft.choices[key]) {
      const row = rows.find((r) => r.offset === draft.used[key]); if (row) choose(row);
    }
  }
  function renderFinish() {
    const next = finalCounters(draft.origin, draft.used);
    root.append(node("h3", "④ 完成・セーブの確認"));
    for (const [key, label] of [["normal", "通常アーティア作成"], ["skill", "スキル"], ["bonus", "復元"]]) {
      root.append(node("p", `${label}：${draft.origin[key]} → ${next[key]}（${draft.used[key]}${key === "normal" ? "本作成" : "回抽選"}）`));
    }
    const c = draft.config, skill = draft.choices.skill;
    root.append(node("p", `${host.series[skill.seriesIndex]} ／ ${host.groups[skill.groupIndex]}`));
    const tags = node("p"); draft.choices.bonus.forEach((id) => tags.append(host.tag(c.weaponType, id, false))); root.append(tags);
    const saved = toggle("この武器が完成し、ゲーム内でセーブした", false);
    const done = button("完成を記録してカウンター・手持ち武器を更新", async () => {
      if (!saved.el.checked) return;
      assertCurrent();
      await host.commit(draft);
      draft = null;
      // 更新済みの保存状態と旧案内の起点が異なるため、削除に失敗しても再適用はできない。
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* 次回は起点不一致で停止する。 */ }
      heading();
      root.append(node("h3", "完成を記録しました"), node("p", "3つのカウンターを進め、完成武器を「10 手持ち武器【巨戟】」に登録しました。"),
        button("手持ち武器【巨戟】を見る", () => host.open("owned")), button("次の武器を作る", setup));
    }, "primary");
    done.disabled = true; saved.el.addEventListener("change", () => { done.disabled = !saved.el.checked; });
    root.append(saved.label, done);
  }
  if (draft) renderStage().catch((e) => {
    heading(); fail(e); root.append(button("保留中の案内を取り消す", discardDialog));
  });
  else setup();
}
