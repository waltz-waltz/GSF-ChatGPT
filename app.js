import initWasm, {
  find_skill_counters,
  predict_gogma_keep_rolls,
  predict_gogma_rolls,
  predict_skill_rolls,
} from "./pkg/gogma_wasm_search.js";
// 通常アーティア（元のツールの 06・07 タブ）の計算
import {
  ARTIAN_BASE_BONUSES,
  artianBonusMultisetContains,
  artianBasePool,
  findArtianCreateCounters,
  predictArtianBaseRolls,
} from "./artian-base-rng.js";
import { localizedTargetName, t } from "./i18n.js";
import { mountCreationWorkbench } from "./creation-workbench.js?v=operation-feedback-1";
import { normalizeWeaponStatReference, makeWeaponStatReference, weaponStatComparison } from "./weapon-stats.js?v=20261030-1";
import { WORKBENCH_KEY, transition, stateSignature, writeAtomic, normalCounter, validateNormal, validateBonuses } from "./creation-operations.js";
import { performConfirmedOperation, advanceCounter, counterChangeMessages } from "./operation-feedback.js?v=1";
import { setupResultToolbars } from "./result-toolbars.js";

const WEAPON_TYPES = [
  [0, "大剣"],
  [1, "片手剣"],
  [2, "双剣"],
  [3, "太刀"],
  [4, "ハンマー"],
  [5, "狩猟笛"],
  [6, "ランス"],
  [7, "ガンランス"],
  [8, "スラッシュアックス"],
  [9, "チャージアックス"],
  [10, "操虫棍"],
  [11, "弓"],
  [12, "ヘビィボウガン"],
  [13, "ライトボウガン"],
];

// The displayed element order differs from the RNG's attribute-force enum:
// Thunder uses 4 and Ice uses 3.
const ATTRIBUTES = [
  [0, "無属性"],
  [1, "火属性"],
  [2, "水属性"],
  [4, "雷属性"],
  [3, "氷属性"],
  [5, "龍属性"],
  [6, "毒属性"],
  [7, "麻痺属性"],
  [8, "睡眠属性"],
  [9, "爆破属性"],
];

// 通常アーティア（レア8）。元のツールから
const ARTIAN_R8_ENUM = 7;
const ARTIAN_ATTRIBUTE_KINDS = [
  [0, "無属性"],
  [1, "属性・状態異常"],
];
const ARTIAN_LIVE_VERIFIED_WEAPON_TYPES = new Set([0, 6, 11, 12, 13]);
// 改良版：通常アーティアのボーナス番号 → 系統（0攻撃 1会心 2属性 3斬れ味・装填。04の希望と同じ数え方）
const ARTIAN_CATEGORY_BY_ID = new Map([[4, 0], [8, 1], [6, 2], [7, 3]]);
const ARTIAN_ID_BY_CATEGORY = new Map([[0, 4], [1, 8], [2, 6], [3, 7]]);

const GOGMA_BONUSES = [
  [8, "基礎攻撃力強化Ⅱ"],
  [12, "基礎攻撃力強化Ⅲ"],
  [15, "基礎攻撃力強化ＥＸ"],
  [9, "会心率強化Ⅱ"],
  [13, "会心率強化Ⅲ"],
  [16, "会心率強化ＥＸ"],
  [11, "属性強化Ⅱ"],
  [14, "属性強化ＥＸ"],
  [6, "斬れ味強化"],
  [10, "斬れ味強化ＥＸ"],
];

const GOGMA_BONUS_CATEGORIES = [
  [0, "攻撃"],
  [1, "会心"],
  [2, "属性"],
  [3, "斬れ味・装填数"],
];

const SERIES_SKILLS = [
  "闢獣の力",
  "火竜の力",
  "暗器蛸の力",
  "鎧竜の守護",
  "雪獅子の闘志",
  "兇爪竜の力",
  "雷顎竜の闘志",
  "波衣竜の守護",
  "煌雷竜の力",
  "獄焔蛸の反逆",
  "凍峰竜の反逆",
  "黒蝕竜の力",
  "鎖刃竜の飢餓",
  "護鎖刃竜の命脈",
  "泡狐竜の力",
  "白熾龍の脈動",
  "海竜の渦雷",
  "千刃竜の闘志",
  "巨戟龍の黙示録",
  "暗黒騎士の証",
  "オメガレゾナンス",
];

const GROUP_SKILLS = [
  "甲虫の知らせ",
  "甲虫の擬態",
  "革細工の柔性",
  "革細工の滑性",
  "鱗張りの技法",
  "鱗重ねの工夫",
  "毛皮の昂揚",
  "毛皮の誘惑",
  "ヌシの誇り",
  "ヌシの憤激",
  "護竜の脈動",
  "護竜の守り",
  "先達の導き",
  "ヌシの魂",
];

// シリーズ・グループスキルで発動するスキルと効果のメモ（攻略大百科・Game8を参考に要約）
// シリーズスキル：[発動スキル, 2部位の効果, 4部位の効果]
const SERIES_SKILL_EFFECTS = {
  "黒蝕竜の力": ["黒蝕一体", "大型モンスターと対峙すると狂竜症に感染する", "狂竜症に感染し、攻撃力UP。克服するとさらに攻撃力UP"],
  "雷顎竜の闘志": ["無尽蔵", "追加のスタミナゲージを得る", "さらに長い追加のスタミナゲージを得る"],
  "兇爪竜の力": ["連撃強化", "「連撃」発動時、効果時間を延長し基礎攻撃力+3", "効果時間をさらに延長し基礎攻撃力+10"],
  "巨戟龍の黙示録": ["宣戦呼応", "戦闘中の大型モンスターが怒ると属性攻撃値UP", "上昇量がUPし、一定時間ダメージを防ぐ防壁を得る（再発動まで時間が必要）"],
  "闢獣の力": ["力自慢", "鍔迫り合い・相殺の成功で一定時間、基礎攻撃力+10", "鍔迫り合い・相殺の成功で一定時間、基礎攻撃力+25"],
  "火竜の力": ["灼熱化", "攻撃を当てると確率で追加の火属性ダメージ", "追加の火属性ダメージが上昇"],
  "暗器蛸の力": ["蛮勇の食卓", "こんがり肉などを食べると一定時間、基礎攻撃力+15", "こんがり肉などを食べると一定時間、基礎攻撃力+25"],
  "鎧竜の守護": ["無傷の重装", "体力が最大の時、受けるダメージ5%軽減", "体力が最大の時、受けるダメージ10%軽減"],
  "雪獅子の闘志": ["ウォークライ", "ジェスチャー「雄叫び」で一定時間、周りの攻撃力が少しUP（オトモ・サポートハンターは効果大）", "周りの攻撃力UPが大きくなる"],
  "波衣竜の守護": ["守護のヴェール", "特殊装具の使用で一定時間、防御力UP", "特殊装具の使用で一定時間、防御力と耐性値が大きくUP"],
  "煌雷竜の力": ["雷々響鳴", "「力の解放」の発動時間を少し延長", "「力の解放」の発動時間を延長"],
  "獄焔蛸の反逆": ["恨撃", "「逆恨み」発動中、追加で少しダメージ", "「逆恨み」発動中、追加でダメージ"],
  "凍峰竜の反逆": ["束縛反攻", "糸拘束・凍結・拘束攻撃からの解放や鍔迫り合いの後、一定時間攻撃力UP", "同じ条件で攻撃力が大きくUP"],
  "鎖刃竜の飢餓": ["加速再生", "攻撃を当て続けると体力が少し回復（武器種で回復量が変わる）", "攻撃を当て続けると体力が回復"],
  "護鎖刃竜の命脈": ["破壊衝動", "大型モンスターの傷口を破壊すると体力が少し回復", "傷口を破壊すると体力が回復"],
  "泡狐竜の力": ["泡沫の舞", "泡状態【大】にならず、泡状態の時に回避が強化", "さらに回避を何回か行うと泡状態【小】になる"],
  "白熾龍の脈動": ["超回復力", "赤ゲージが無くても体力がゆるやかに最大まで自動回復", "自動回復がより速くなる"],
  "海竜の渦雷": ["蒼雷一閃", "攻撃でダメージを蓄積させると追加の雷属性ダメージ＋一定時間会心率UP", "雷属性ダメージが上昇し、会心率UPの時間が少し延びる"],
  "千刃竜の闘志": ["千刃の身躱し", "「巧撃」の効果時間を延長。発動中に再び条件を満たすと少し延長（1回のみ）", "さらに、発動中に再び条件を満たすと攻撃力UP"],
  "暗黒騎士の証": ["ダークアーツ／ブラックナイト", "赤ゲージがある間、属性攻撃力UP。大剣の一部の溜め斬りが3段階溜めで強化", "特殊アクション「ブラックナイト」が使える"],
  "オメガレゾナンス": ["レゾナンス", "ファーとニアーが交互に発動し、条件を満たすと攻撃力か会心率UP", "さらに武器スキル「シールドオプション」「連携プログラム」が強化"],
};

// グループスキル（3部位）：[発動スキル, 効果]
const GROUP_SKILL_EFFECTS = {
  "甲虫の知らせ": ["ハニーハンター", "ハチミツの採取数が増える"],
  "甲虫の擬態": ["忍び歩き", "しゃがみ移動が速くなり、大型モンスターに見つかりにくい"],
  "革細工の柔性": ["採集の達人", "採集が速くなり、採集・剥ぎ取り中に攻撃を受けてものけぞらない"],
  "革細工の滑性": ["滑走強化", "地形を使ったスライディングの後、一定時間会心率UP"],
  "鱗張りの技法": ["乗り名人", "モンスターに乗りやすく、乗りが成功しやすい"],
  "鱗重ねの工夫": ["奮起", "体力40%以下で一定時間、スタミナ消費が減る"],
  "毛皮の昂揚": ["不屈", "力尽きるたびに攻撃力と防御力UP（最大2回）"],
  "毛皮の誘惑": ["陽動", "攻撃を当てるとモンスターの注意を強く引く"],
  "ヌシの誇り": ["激励", "旋律など範囲効果を発動した時、一時的な攻撃力UPを追加"],
  "ヌシの憤激": ["死中に活", "状態異常の間、基礎攻撃力+10（解除されると即終了）"],
  "護竜の脈動": ["竜乳活性", "竜乳結晶の近くで赤ゲージとスタミナの回復が速くなる"],
  "護竜の守り": ["竜都の護り", "竜都の跡形で属性ダメージ・特殊ダメージを軽減"],
  "先達の導き": ["探索者の幸運", "活性化した採取ポイントが出やすくなる"],
  "ヌシの魂": ["根性【果敢】", "HPのラインより上で致死ダメージを1回耐える。発動前は攻撃1.05倍・防御0.95倍、発動後は防御1.05倍・全耐性+3"],
};

function skillLabelWithEffect(label) {
  const effect = GROUP_SKILL_EFFECTS[label];
  return effect ? `${label}（${effect[0]}）` : label;
}

function skillEffectSpan(label) {
  const effect = document.createElement("small");
  effect.className = "skill-effect";
  const series = SERIES_SKILL_EFFECTS[label];
  if (series) {
    const [skill, two, four] = series;
    effect.append(
      Object.assign(document.createElement("span"), { textContent: `発動スキル：${skill}` }),
      Object.assign(document.createElement("span"), { textContent: `2部位：${two}` }),
      Object.assign(document.createElement("span"), { textContent: `4部位：${four}` }),
    );
  }
  return effect;
}

// グループスキルの選択欄の下に、選んだスキルの効果を表示する
function attachGroupEffectNote(select) {
  const note = document.createElement("small");
  note.className = "skill-effect group-effect-note";
  const update = () => {
    const label = GROUP_SKILLS[Number(select.value)];
    const effect = GROUP_SKILL_EFFECTS[label];
    note.textContent = effect ? `発動スキル：${effect[0]}（3部位）　${effect[1]}` : "";
  };
  select.addEventListener("change", update);
  update();
  select.after(note);
}

const BOW_WEAPON_TYPE = 11;
const HEAVY_BOWGUN_WEAPON_TYPE = 12;
const BOWGUN_WEAPON_TYPES = new Set([12, 13]);
const SHARPNESS_AMMO_BONUS_IDS = new Set([6, 10]);
const ELEMENT_BONUS_IDS = new Set([11, 14]);
const EX_BONUS_IDS = new Set([10, 14, 15, 16]);
const LORDS_SOUL_GROUP_INDEX = 13;
const PRIORITY_GROUP_SKILL_INDICES = [LORDS_SOUL_GROUP_INDEX];
const PRIORITY_SERIES_SKILL_INDICES = [11, 6, 5, 18];
const SKILL_COUNTER_GATE = 54;
const MAX_REGISTERED_TARGETS = 140;

// 元のサイトと見分けるため、タブの名前と見出しに「改良版」を付ける
document.title = "GSF ChatGPT";
{
  const heroTitle = document.querySelector(".hero h1");
  if (heroTitle) heroTitle.textContent = "GSF ChatGPT";
  const heroEyebrow = document.querySelector(".hero .eyebrow");
  if (heroEyebrow) heroEyebrow.textContent = "Monster Hunter Wilds · GSF ChatGPT（元のツール：apeshinzo78）";
  document.head.append(Object.assign(document.createElement("style"), {
    textContent: `
      .fork-badge {
        display: inline-block;
        margin-left: 0.4em;
        padding: 0.12em 0.5em;
        border: 2px solid #d9b45a;
        border-radius: 0.3em;
        background: rgba(217, 180, 90, 0.18);
        color: #f3d27a;
        font-size: 0.38em;
        font-weight: 700;
        letter-spacing: 0.08em;
        vertical-align: middle;
        white-space: nowrap;
      }
    `,
  }));
}

// 「一致」列の見た目
document.head.append(Object.assign(document.createElement("style"), {
  textContent: `
    .skill-prediction-table { --match-column-width: 330px; }
    .skill-match-cell { min-width: var(--match-column-width); vertical-align: top; }
    /* 画面が広いときは「一致」列も左に固定して、横スクロールしても見えるようにする */
    @media (min-width: 900px) {
      .skill-prediction-table > thead > tr > th:nth-child(3),
      .skill-prediction-table > tbody > tr > td:nth-child(3) {
        position: sticky;
        left: calc(var(--offset-column-width) + var(--state-column-width));
        z-index: 2;
        width: var(--match-column-width);
        background: #151612;
        box-shadow: 8px 0 12px rgb(0 0 0 / 20%);
      }
      .skill-prediction-table > thead > tr > th:nth-child(3) { z-index: 5; background: #20221c; }
      .skill-prediction-table > tbody > tr > td:nth-child(2) { box-shadow: none; }
    }
    .skill-match-item { margin-bottom: 8px; }
    .skill-match-item:last-child { margin-bottom: 0; }
    .skill-match-name { font-size: 12px; font-weight: 700; color: #e8c766; margin-bottom: 4px; }
    .skill-match-none { color: #777; font-size: 12px; }
    .skill-effect { display: block; color: #a9a690; font-size: 0.72rem; font-weight: 400; line-height: 1.5; margin-top: 2px; }
    .skill-effect > span { display: block; }
    .group-effect-note { margin-top: 6px; max-width: 760px; white-space: normal; }
    /* シリーズスキルの選択欄：1つずつカードにして、説明が読めるようにする */
    .skill-filter-series-options {
      grid-template-columns: repeat(auto-fill, minmax(min(280px, 100%), 1fr));
      gap: 8px;
      max-height: 420px;
      padding: 2px;
    }
    .weapon-filter-row .skill-filter-series-options { max-height: none; overflow: visible; }
    .skill-filter-series-options label {
      align-items: flex-start;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid #3a3c31;
      border-radius: 8px;
      background: rgb(0 0 0 / 18%);
      white-space: normal;
      font-size: 0.8rem;
      font-weight: 700;
    }
    .skill-filter-series-options label:has(input:checked) {
      border-color: #e8c766;
      background: rgb(214 179 92 / 12%);
    }
    .skill-filter-series-options input[type="checkbox"] { margin-top: 2px; }
    .weapon-filter-settings { display: block; }
    .weapon-filter-settings .skill-filter-intro p { margin: 4px 0 12px; color: #a9a690; font-size: 0.8rem; }
    .weapon-filter-empty { color: #a9a690; font-size: 0.8rem; }
    /* 共通の条件（当たり強調・条件一致だけ表示）：太い金色の枠。項目はシリーズスキル欄と同じく上にそろえる */
    .skill-filter-settings:not(.weapon-filter-settings) {
      align-items: start;
      border: 3px solid #b8973f;
      border-radius: 14px;
      background: rgb(214 179 92 / 5%);
    }
    /* 大枠（武器種ごとの条件）：太い金色の枠 */
    .skill-filter-settings.weapon-filter-settings {
      border: 3px solid #b8973f;
      border-radius: 14px;
      background: rgb(214 179 92 / 5%);
    }
    /* 中枠（武器種ごと）：大枠より少し細い枠。開いている武器種は明るく */
    .weapon-filter-row { border: 2px solid #5f6b52; border-radius: 10px; margin-bottom: 10px; background: rgb(95 120 80 / 8%); }
    .weapon-filter-row[open] { border-color: #8fae6f; background: rgb(110 150 90 / 10%); }
    .weapon-filter-row > summary { display: flex; flex-wrap: wrap; gap: 4px 14px; align-items: baseline; padding: 10px 14px; cursor: pointer; }
    .weapon-filter-body .text-button { color: #ffffff; border-color: rgb(255 255 255 / 55%); }
    .weapon-filter-body .text-button:hover { color: #ffffff; border-color: #ffffff; }
    .weapon-filter-name { font-weight: 700; color: #e8c766; min-width: 7em; }
    /* 名前の横の説明（今のボーナス・条件など）：大きく明るく */
    .weapon-filter-state { color: #ebe6d4; font-size: 0.9rem; font-weight: 600; }
    .weapon-filter-body { display: grid; gap: 12px; padding: 4px 14px 14px; }
    .weapon-filter-body > label { display: grid; gap: 4px; }
    .weapon-filter-body > label > select { max-width: 360px; }
    /* 復元ボーナス未来予測：武器種ごとの希望ボーナス */
    .bonus-wish-settings {
      margin: 18px 0 0;
      padding: 16px 18px;
      border: 3px solid #b8973f;
      border-radius: 14px;
      background: rgb(214 179 92 / 5%);
    }
    .bonus-wish-settings .skill-filter-intro strong { font-family: Georgia, "Yu Mincho", serif; font-size: 1.02rem; font-weight: 500; }
    .bonus-wish-settings .skill-filter-intro p { margin: 4px 0 10px; color: #a9a690; font-size: 0.78rem; line-height: 1.6; }
    .bonus-wish-toggle { display: inline-flex; gap: 8px; align-items: center; margin-bottom: 12px; font-size: 0.8rem; font-weight: 700; }
    .bonus-wish-categories { margin: 0; padding: 0; border: 0; }
    .bonus-wish-categories legend { margin-bottom: 6px; color: #d6d3c5; font-size: 0.76rem; font-weight: 800; }
    .bonus-wish-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; max-width: 560px; }
    .bonus-wish-grid label, .bonus-wish-ex { display: grid; gap: 4px; font-size: 0.76rem; font-weight: 700; }
    .bonus-wish-ex { max-width: 300px; }
    .bonus-wish-grid select, .bonus-wish-ex select { height: 38px; }
    .bonus-wish-total { margin: 6px 0 0; color: #a9a690; font-size: 0.76rem; }
    .bonus-wish-total.over { color: #ff9f8f; font-weight: 700; }
    .bonus-wish-summary {
      margin-top: 18px;
      padding: 14px 18px;
      border: 2px solid #8fae6f;
      border-radius: 12px;
      background: rgb(110 150 90 / 10%);
    }
    .bonus-wish-summary h3 { margin: 0 0 8px; font-family: Georgia, "Yu Mincho", serif; font-size: 0.98rem; font-weight: 500; }
    .bonus-wish-summary h3:not(:first-child) { margin-top: 14px; }
    .bonus-wish-summary p { margin: 8px 0 0; color: #a9a690; font-size: 0.74rem; line-height: 1.6; }
    .bonus-wish-next-list { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
    .bonus-wish-next-list li { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; font-size: 0.8rem; padding: 4px 0; border-bottom: 1px solid rgb(255 255 255 / 6%); }
    .bonus-wish-next-list strong { color: #e8c766; min-width: 9em; }
    .bonus-wish-next-list .bonus-wish-next-result { min-width: 4.5em; font-size: 0.9rem; }
    .bonus-wish-next-kind { font-size: 0.72rem; color: #e8c766; }
    /* 回ごとの結果表：内部の縦スクロールをなくす（横に長いときの横スクロールだけ残す） */
    #comparison-table-wrap { max-height: none; overflow-y: visible; overflow-x: auto; }
    .comparison-more-bar { display: flex; flex-wrap: wrap; gap: 10px 18px; align-items: center; margin-top: 12px; }
    .comparison-more-bar[hidden] { display: none; }
    .comparison-more-status { color: #b9b6a4; font-size: 0.78rem; }
    .comparison-more-bar .text-button { color: #ffffff; }
    /* 追加の横スクロールバー：表の上と、画面の下にくっつくもの */
    /* 追加の横スクロールバー：案内文＋◀ バー ▶。溝をはっきり見せる */
    .table-scroll-holder {
      display: grid; grid-template-columns: auto 28px minmax(0, 1fr) 28px; gap: 8px; align-items: center;
      padding: 6px 10px; background: #2b2c25; border: 2px solid #e8c766; border-radius: 10px;
    }
    .table-scroll-holder[hidden] { display: none; }
    .table-scroll-holder.top { margin-top: 12px; }
    .table-scroll-holder.bottom { position: sticky; bottom: 0; z-index: 8; border-radius: 10px 10px 0 0; box-shadow: 0 -6px 16px rgb(0 0 0 / 50%); }
    .table-scroll-caption { color: #ffe39a; font-size: 0.74rem; font-weight: 800; white-space: nowrap; }
    .table-scroll-arrow { display: grid; place-items: center; height: 24px; border-radius: 6px; background: #3a3b31; color: #ffe39a; font-size: 0.8rem; cursor: pointer; user-select: none; }
    .table-scroll-arrow:hover { background: #4a4330; }
    .table-scroll-mirror { overflow-x: auto; overflow-y: hidden; height: 20px; border-radius: 999px; background: #141510; box-shadow: inset 0 0 0 1px #6b6a55; scrollbar-color: #e8c766 #141510; }
    .table-scroll-mirror::-webkit-scrollbar { height: 16px; }
    .table-scroll-mirror::-webkit-scrollbar-track { background: #141510; border-radius: 999px; }
    .table-scroll-mirror::-webkit-scrollbar-thumb { background: #e8c766; border: 3px solid #141510; border-radius: 999px; }
    .table-scroll-mirror > div { height: 1px; }
    /* 「何回先」の行と行の区切り：白い中太の線 */
    .comparison-table > tbody > tr:not(.repeat-header-row) > th,
    .comparison-table > tbody > tr:not(.repeat-header-row) > td { border-bottom: 3px solid rgb(240 240 240 / 75%); }
    /* 見出しの行は低く：長い登録名は1行で「…」省略（マウスを乗せると全文）。手持ちの5枠表示も1行に */
    .comparison-table thead th, .comparison-table > tbody > tr.repeat-header-row > th { padding-top: 6px; padding-bottom: 6px; vertical-align: bottom; }
    .comparison-table th .target-label-text,
    .comparison-table th .column-layout { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .comparison-table th .weapon-badge { white-space: nowrap; }
    /* 左の「何回先」と「保存後の状態」を大きく太く */
    .comparison-table > tbody > tr > th:first-child { font-size: 1rem; font-weight: 900; color: #ffe39a; }
    .comparison-table .saved-state-cell > span { font-size: 0.8rem; font-weight: 800; color: #e6e1cf; }
    .comparison-table .saved-state-cell > strong { font-size: 1.05rem; font-weight: 900; }
    .comparison-table .saved-state-cell button { font-size: 0.82rem; font-weight: 900; padding-top: 6px; padding-bottom: 6px; }
    .comparison-table .saved-state-cell .adopt-position-button { color: #d9f5c8; border-width: 2px; }
    /* 何回先ごとに入れ直す見出しの行 */
    .comparison-table > tbody > tr.repeat-header-row > th {
      padding: 6px 7px; border-top: 2px solid #5a5236; background: #20221c; color: #c8c5b5;
      font-size: 0.72rem; white-space: normal; overflow-wrap: anywhere;
    }
    .comparison-table > tbody > tr.repeat-header-row > th:nth-child(2) {
      position: sticky; left: var(--offset-column-width); z-index: 2;
    }
    @media (min-width: 900px) {
      .comparison-table > tbody > tr.repeat-header-row > th:nth-child(3) {
        position: sticky; left: calc(var(--offset-column-width) + var(--state-column-width)); z-index: 2;
      }
    }
    .next-match-table .next-action .match-adopt-button { margin: 0; white-space: nowrap; }
    /* 次の一致：見出し付きの表 */
    .bonus-wish-summary { overflow-x: auto; }
    .next-match-table { width: 100%; border-collapse: collapse; font-size: 0.82rem; }
    .next-match-table th { padding: 6px 8px; border-bottom: 2px solid #5a6b4c; color: #b9b6a4; font-size: 0.72rem; font-weight: 800; text-align: left; white-space: nowrap; }
    .next-match-table td { padding: 6px 8px; border-bottom: 1px solid rgb(255 255 255 / 7%); vertical-align: middle; }
    .next-match-table .next-when { color: #cfeec0; font-size: 0.92rem; font-weight: 900; white-space: nowrap; }
    .next-match-table .next-weapon { color: #f2eddc; font-weight: 800; white-space: nowrap; }
    .next-match-table .next-label { color: #e8c766; font-weight: 800; }
    .next-match-table .next-note { color: #b9b6a4; font-size: 0.74rem; }
    .next-match-table .next-result .comparison-bonus-set { grid-template-columns: repeat(5, auto); justify-content: start; }
    .next-match-table tr.none td { opacity: 0.55; }
    .method-pair { white-space: nowrap; font-size: 0.78rem; color: #4a4a40; }
    .method-on { font-weight: 900; padding: 1px 6px; border-radius: 5px; }
    .method-on.reset { color: #1a1708; background: #e8c766; }
    .method-on.owned { color: #0d1f1d; background: #8fe0d6; }
    .method-off { color: #5f5e52; opacity: 0.6; }
    /* 武器種・属性の札（その横に登録名） */
    .weapon-badge {
      display: inline-block; margin-right: 6px; padding: 1px 8px; border: 1px solid #8a8670; border-radius: 6px;
      background: #2b2c25; color: #f2eddc; font-size: 0.74rem; font-weight: 800; vertical-align: 1px;
    }
    .bonus-wish-next-kind.owned { color: #8fe0d6; }
    .bonus-wish-next-list .comparison-bonus-set { grid-template-columns: repeat(5, auto); justify-content: start; }
    /* 大枠：A「登録した武器をまとめて予測」（金）、B「1つの武器だけを詳しく調べる」（青灰） */
    .big-frame { margin-top: 36px; padding: 24px 24px 28px; border: 4px solid #b8973f; border-radius: 18px; background: rgb(214 179 92 / 4%); }
    .big-frame.big-frame-detail { border-color: #6f84a6; background: rgb(111 132 166 / 6%); }
    .big-frame-note { margin: 4px 0 18px; padding: 10px 14px; border-left: 4px solid #6f84a6; background: rgb(111 132 166 / 12%); color: #d6dbe6; font-size: 0.82rem; line-height: 1.6; }
    /* 中枠：①②③ */
    .step-frame { margin-top: 20px; padding: 16px 18px 18px; border: 2px solid #6b6a55; border-radius: 14px; background: rgb(0 0 0 / 16%); }
    .step-frame-header { display: flex; gap: 12px; align-items: center; }
    .step-frame-header h3 { margin: 0; font-family: Georgia, "Yu Mincho", serif; font-size: 1.15rem; font-weight: 600; color: #f2eddc; }
    .step-frame-number { display: inline-grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; background: #e8c766; color: #1a1708; font-weight: 900; }
    .step-frame-description { margin: 6px 0 14px; color: #b9b6a4; font-size: 0.8rem; line-height: 1.6; }
    .step-subheading { margin-top: 26px; padding-top: 16px; border-top: 1px dashed #5a5236; }
    .step-subheading h4 { margin: 0 0 4px; font-family: Georgia, "Yu Mincho", serif; font-size: 1rem; font-weight: 600; }
    .step-subheading p { margin: 0; color: #b9b6a4; font-size: 0.78rem; line-height: 1.6; }
    .comparison-table-options-hint { flex-basis: 100%; margin: 0; color: #a9a690; font-size: 0.72rem; }
    /* ②の中の希望ボーナス欄は、中枠と二重にならないよう枠を外す */
    .step-frame > .bonus-wish-settings:not(.owned-weapon-settings) { margin: 0; padding: 0; border: 0; background: none; }
    .step-frame > .bonus-wish-settings:not(.owned-weapon-settings) > .skill-filter-intro { display: none; }
    /* 次の一致：希望（例：攻撃×4）と、希望に当てはまる枠の強調 */
    .bonus-wish-next-target { padding: 2px 8px; border: 1px solid #8a7a45; border-radius: 999px; color: #ffe39a; font-size: 0.72rem; font-weight: 800; }
    /* 希望に当てはまる枠：EXだけ金の太い縁＋光。EX以外は縁を付けず、白い文字を読みやすく。関係ない枠：灰色で薄く */
    .comparison-bonus-set .bonus-tag.wish-part { opacity: 1; font-weight: 900; color: #ffffff; text-shadow: 0 1px 2px rgb(0 0 0 / 90%); }
    /* 金の太い縁＋金の光。縁は少し離して付け、中の色（攻撃＝オレンジなど）は変えない */
    .comparison-bonus-set .bonus-tag.wish-part.ex {
      outline: 2px solid #ffd44d; outline-offset: 2px;
      box-shadow: 0 0 10px 2px rgb(255 212 77 / 55%);
    }
    .bonus-tag.not-wish { opacity: 0.25; filter: grayscale(1); }
    /* 5枠を1つずつ指定 */
    .bonus-wish-mode { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 12px; font-size: 0.82rem; font-weight: 700; }
    .bonus-wish-mode label { display: inline-flex; gap: 6px; align-items: center; cursor: pointer; white-space: nowrap; }
    .bonus-wish-mode input[type="radio"] { width: 18px; height: 18px; min-height: 0; margin: 0; padding: 0; accent-color: #e8c766; flex: none; }
    .bonus-wish-slots { display: grid; gap: 8px; max-width: 520px; }
    .bonus-wish-slot { display: grid; grid-template-columns: 4.5em 1fr 1fr; gap: 8px; align-items: center; font-size: 0.8rem; font-weight: 700; }
    .bonus-wish-slot select { height: 36px; }
    /* タブが6つになったので、広い画面では6列に（狭い画面は元の並び方のまま） */
    @media (min-width: 900px) {
      .app-tabs { grid-template-columns: repeat(var(--tab-count, 5), minmax(0, 1fr)); }
    }
    /* 手持ち武器の一覧：左端の武器種の札、並べ方の切り替え、武器種の見出し */
    .owned-type-badge {
      display: inline-block; min-width: 8.5em; padding: 3px 10px; border-radius: 6px; text-align: center;
      background: #2f2b1c; border: 1px solid #e8c766; color: #ffe39a; font-size: 0.82rem; font-weight: 900;
    }
    .owned-sort-bar { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 0 0 10px; color: #d6d3c5; font-size: 0.8rem; font-weight: 700; }
    .owned-sort-button { padding: 6px 12px; border: 2px solid #3a3c31; border-radius: 8px; background: #151612; color: #c9c6b8; font-size: 0.78rem; font-weight: 800; cursor: pointer; }
    .owned-sort-button.active { border-color: #4f9a92; background: rgb(79 154 146 / 16%); color: #bff3ec; }
    .owned-group-heading { margin: 14px 0 6px; padding-bottom: 4px; border-bottom: 2px solid #4f9a92; color: #8fe0d6; font-size: 0.95rem; }
    /* ===== 通常アーティア（06・07）の改良 ===== */
    /* 武器種の一覧（押せる）：特定済みは明るく、未特定は灰色 */
    .artian-weapon-picker { margin: 18px 0 8px; padding: 14px 16px; border: 2px solid #8e7a45; border-radius: 12px; background: rgb(214 179 92 / 5%); }
    .artian-weapon-picker h3 { margin: 0 0 4px; font-size: 0.98rem; }
    .artian-weapon-picker p { margin: 0 0 10px; color: #b9b6a4; font-size: 0.76rem; }
    button.artian-counter-overview-item {
      display: grid; gap: 2px; padding: 8px 10px; border: 2px solid #8e7a45; border-radius: 8px;
      background: #26231a; color: #f2eddc; text-align: left; font: inherit; cursor: pointer;
    }
    button.artian-counter-overview-item strong { color: #ffe39a; font-size: 1rem; }
    button.artian-counter-overview-item.unknown { border-color: #3a3c31; background: #151612; color: #77756a; opacity: 0.7; }
    button.artian-counter-overview-item.unknown strong { color: #6e6c62; font-size: 0.8rem; }
    button.artian-counter-overview-item.selected { outline: 3px solid #e8c766; outline-offset: 1px; opacity: 1; }
    button.artian-counter-overview-item:hover { filter: brightness(1.2); opacity: 1; }
    /* 入力を空にしたあとの「元に戻す」 */
    .artian-undo { display: flex; flex-wrap: wrap; gap: 8px 14px; align-items: center; margin: 10px 0 0; padding: 8px 12px; border: 1px solid #8e7a45; border-radius: 8px; background: #26231a; color: #ffe39a; font-size: 0.82rem; font-weight: 700; }
    .artian-undo[hidden] { display: none; }
    .artian-observation-row.card-input .roll-number { white-space: nowrap; }
    /* 07の希望：系統ごとのカード（−／＋で数を決める） */
    .artian-wish-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 10px; }
    .artian-wish-card { display: grid; gap: 6px; padding: 10px 12px; border: 1px solid #3a3c31; border-left-width: 5px; border-radius: 10px; background: rgb(0 0 0 / 18%); }
    .artian-wish-card.attack { border-left-color: #e69f00; }
    .artian-wish-card.affinity { border-left-color: #6b6b6b; }
    .artian-wish-card.element { border-left-color: #8e44c9; }
    .artian-wish-card.sharpness-ammo { border-left-color: #f2f2f2; }
    .artian-wish-card.active { border-color: #e8c766; background: rgb(214 179 92 / 12%); }
    .artian-wish-card strong { font-size: 0.95rem; }
    .artian-wish-card small { color: #8a8775; font-size: 0.7rem; }
    .artian-wish-stepper { display: grid; grid-template-columns: 38px 1fr 38px; gap: 6px; align-items: center; }
    .artian-wish-stepper button { height: 34px; border: 1px solid #6b6a55; border-radius: 8px; background: #26271f; color: #f2eddc; font-size: 1.1rem; font-weight: 900; cursor: pointer; }
    .artian-wish-stepper button:disabled { opacity: 0.3; cursor: default; }
    .artian-wish-count { text-align: center; color: #ffe39a; font-size: 1.1rem; font-weight: 900; }
    .artian-wish-none { padding: 3px 6px; border: 1px dashed #6b6a55; border-radius: 6px; background: transparent; color: #cfcab4; font-size: 0.72rem; font-weight: 700; cursor: pointer; }
    .artian-wish-card.excluded { border-color: #c0504d; background: rgb(192 80 77 / 14%); }
    .artian-wish-card.excluded .artian-wish-count { color: #ff9b97; }
    .artian-wish-card.excluded .artian-wish-none { border-style: solid; border-color: #c0504d; color: #ffd0cd; }
    /* 07の表：希望に当てはまる枠は色で塗りつぶし＋金の縁、それ以外は薄く */
    .artian-base-table .bonus-tag.artian-hit { font-weight: 900; text-shadow: none; }
    .artian-base-table .bonus-tag.artian-hit.attack { background: #e69f00; border-color: #ffc04d; color: #1a1000; }
    .artian-base-table .bonus-tag.artian-hit.element { background: #8e44c9; border-color: #d4a6ff; color: #ffffff; }
    .artian-base-table .bonus-tag.artian-hit.sharpness-ammo { background: #f2f2f2; border-color: #ffffff; color: #111111; }
    .artian-base-table .bonus-tag.artian-hit.affinity { background: #6b6b6b; border-color: #b5b5b5; color: #ffffff; }
    .artian-base-table .bonus-tag.wish-part { outline: 2px solid #ffd44d; outline-offset: 2px; box-shadow: 0 0 10px 2px rgb(255 212 77 / 55%); }
    .artian-base-table .bonus-tag.artian-off { opacity: 0.6; font-weight: 700; }
    /* 09 手持ち武器【通常アーティア】 */
    .artian-held-mark { display: block; margin-top: 4px; padding: 1px 6px; width: fit-content; border: 1px solid #66c2a5; border-radius: 999px; background: rgb(102 194 165 / 16%); color: #b8f0de; font-size: 0.68rem; font-weight: 800; white-space: nowrap; }
    .artian-owned-form, .artian-owned-list { margin-top: 14px; padding: 14px; border: 2px solid #8a7a45; border-radius: 12px; background: rgb(0 0 0 / 16%); display: grid; gap: 12px; }
    .artian-owned-form h3, .artian-owned-list h3 { margin: 0; font-size: 1rem; color: #ffe39a; }
    .artian-owned-form-row { display: flex; flex-wrap: wrap; gap: 10px 16px; }
    .artian-owned-field { display: grid; gap: 4px; font-size: 0.78rem; font-weight: 700; color: #cfcab4; }
    .artian-owned-field input[type="text"] { min-width: 220px; }
    .artian-owned-message { margin: 0; min-height: 1em; color: #ffe39a; font-size: 0.84rem; font-weight: 700; }
    .artian-owned-item { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid #3a3c31; border-left: 5px solid #66c2a5; border-radius: 10px; background: rgb(0 0 0 / 20%); }
    .artian-owned-item-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .artian-owned-controls { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; }
    .artian-owned-controls select { width: auto; min-width: 150px; }
    .artian-adopt-button { margin-top: 6px; white-space: nowrap; }
    .artian-next-adopt { margin-top: 0; margin-left: 8px; }
    .artian-next-table td:last-child { white-space: nowrap; }
    .artian-owned-verdict { padding: 2px 10px; border-radius: 999px; font-size: 0.78rem; font-weight: 800; border: 1px solid #6b6a55; color: #cfcab4; }
    .artian-owned-verdict.good { border-color: #ffd44d; background: rgb(255 212 77 / 16%); color: #ffe39a; }
    .artian-owned-verdict.bad { color: #9a9784; }
    .artian-wish-footer { grid-column: 1 / -1; display: flex; flex-wrap: wrap; gap: 8px 18px; align-items: center; color: #ffe39a; font-size: 0.86rem; font-weight: 800; }
    .artian-wish-footer .text-button { color: #ffffff; }
    /* 07の表：希望どおりの行は金色の帯 */
    .artian-base-table tbody tr.artian-wish-row { background: linear-gradient(90deg, rgb(232 199 102 / 20%), rgb(232 199 102 / 6%)); }
    .artian-base-table tbody tr.artian-wish-row > th:first-child { box-shadow: inset 5px 0 0 #e8c766; color: #ffe39a; }
    /* 07：全武器種の次の当たり */
    .artian-next-list { margin-top: 22px; padding: 14px 18px; border: 2px solid #8fae6f; border-radius: 12px; background: rgb(110 150 90 / 10%); }
    .artian-next-wrap { overflow-x: auto; }
    .artian-next-rest { margin: 10px 0 0; color: #a9a690; font-size: 0.76rem; }
    .artian-mini-tags { display: flex; flex-wrap: wrap; gap: 4px; }
    .next-match-table .next-artian { color: #cfeec0; font-weight: 800; white-space: nowrap; }
    /* 00 仕組み */
    .spec-block { margin-top: 22px; padding: 16px 18px; border: 2px solid #6b6a55; border-radius: 14px; background: rgb(0 0 0 / 16%); }
    .spec-block h3 { margin: 0 0 12px; font-size: 1.1rem; }
    .spec-flow { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
    .spec-step { display: grid; grid-template-columns: 44px 1fr; gap: 12px; padding: 12px 14px; border: 2px solid #8e7a45; border-radius: 12px; background: #1d1c16; }
    .spec-step-number { display: grid; place-items: center; width: 40px; height: 40px; border-radius: 50%; background: #e8c766; color: #1a1708; font-size: 1.2rem; font-weight: 900; }
    .spec-step-body strong { font-size: 1rem; color: #ffe39a; }
    .spec-step-body p { margin: 4px 0 0; color: #e6e1cf; font-size: 0.86rem; line-height: 1.6; }
    .spec-caution { color: #ffb4a8 !important; font-weight: 800; }
    .spec-tab-link { color: #b9b6a4 !important; font-size: 0.78rem !important; }
    .spec-tab-link .text-button, .spec-side .text-button, .fork-guide-box .text-button { color: #8fe0d6; font-weight: 800; }
    .spec-arrow { text-align: center; color: #e8c766; font-size: 1.4rem; font-weight: 900; line-height: 1; }
    .spec-side { margin-top: 10px; padding: 10px 14px; border: 2px dashed #4f9a92; border-radius: 12px; }
    .spec-side strong { color: #8fe0d6; }
    .spec-side p { margin: 4px 0 0; color: #e6e1cf; font-size: 0.86rem; }
    .spec-table-wrap { overflow-x: auto; }
    .spec-table { width: 100%; border-collapse: collapse; font-size: 0.86rem; }
    .spec-table th, .spec-table td { padding: 8px 10px; border-bottom: 1px solid rgb(255 255 255 / 10%); text-align: left; vertical-align: top; }
    .spec-table thead th { color: #b9b6a4; font-size: 0.76rem; border-bottom: 2px solid #8e7a45; }
    .spec-table tbody th { color: #ffe39a; white-space: nowrap; }
    .spec-note { margin: 8px 0 0; color: #a9a690; font-size: 0.76rem; }
    .spec-list { margin: 0; padding-left: 1.3em; display: grid; gap: 6px; color: #e6e1cf; font-size: 0.88rem; line-height: 1.6; }
    /* 01 使い方：改良版で増えた機能 */
    .fork-guide-box { margin-bottom: 22px; padding: 14px 18px; border: 3px solid #b8973f; border-radius: 14px; background: rgb(214 179 92 / 6%); }
    .fork-guide-box h3 { margin: 0 0 8px; }
    .fork-guide-box ul { margin: 0; padding-left: 1.2em; display: grid; gap: 4px; font-size: 0.86rem; color: #e6e1cf; }
    /* 元のツールの「ドラッグで並び替え」の案内（改良版はドラッグに対応していないので隠す） */
    .target-reorder-hint { display: none; }
    /* 手持ち武器：小見出し・スキルのカード */
    .owned-form-subtitle { margin: 4px 0 0; color: #d6d3c5; font-size: 0.78rem; font-weight: 800; }
    .owned-skill-picker { display: grid; gap: 12px; }
    .owned-skill-options { max-height: none; }
    /* スキル未来予測：「所持済み：弓・火（攻撃激化）」の印 */
    .skill-owned-badge {
      display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 6px;
      background: #17302d; border: 1px solid #4f9a92; color: #bff3ec; font-size: 0.74rem; font-weight: 800;
    }
    .skill-adopt { margin-top: 6px; }
    /* 画面の真ん中に出す窓（いちばん手前に出す） */
    .skill-adopt-overlay {
      position: fixed; inset: 0; z-index: 1000; display: grid; place-items: center; padding: 16px;
      background: rgb(0 0 0 / 60%);
    }
    .skill-adopt-menu {
      display: grid; gap: 8px; width: min(640px, 100%); max-height: 85vh; overflow-y: auto;
      padding: 18px; border: 3px solid #e8c766; border-radius: 14px; background: #1b1c17; box-shadow: 0 16px 48px rgb(0 0 0 / 70%);
    }
    .skill-adopt-menu h3 { margin: 0; font-family: Georgia, "Yu Mincho", serif; font-size: 1.1rem; color: #f2eddc; }
    .skill-adopt-summary { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
    .skill-adopt-note { margin: 0 0 4px; color: #b9b6a4; font-size: 0.76rem; line-height: 1.6; }
    .skill-adopt-cancel { justify-self: end; margin-top: 4px; color: #ffffff; }
    .skill-adopt-heading { margin: 0; color: #ffe39a; font-size: 0.82rem; font-weight: 800; }
    .skill-adopt-summary .comparison-bonus-set { grid-template-columns: repeat(5, auto); }
    .adopt-flow { display: grid; gap: 6px; width: 100%; }
    .adopt-flow-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: center; font-size: 1rem; font-weight: 800; }
    .adopt-flow-row { display: grid; gap: 4px; }
    .adopt-flow-label { color: #b9b6a4; font-size: 0.74rem; font-weight: 800; }
    .adopt-flow-arrow { color: #ffe39a; font-size: 2.2rem; font-weight: 900; line-height: 1; text-align: left; padding-left: 24px; }
    .adopt-flow .comparison-bonus-set { grid-template-columns: repeat(5, 88px); justify-content: start; }
    .adopt-flow .comparison-bonus-set .bonus-tag { width: 100%; box-sizing: border-box; display: inline-flex; justify-content: center; align-items: center; white-space: nowrap; }
    .skill-adopt-detail-rich { display: flex; flex-wrap: wrap; gap: 6px 10px; align-items: center; }
    .skill-adopt-detail-rich .comparison-bonus-set { grid-template-columns: repeat(5, auto); }
    .skill-adopt-menu p { margin: 0 0 2px; color: #ffe39a; font-size: 0.78rem; font-weight: 800; }
    .skill-adopt-choice { padding: 6px 10px; border: 1px solid #5a5236; border-radius: 6px; background: #26271f; color: #f2eddc; font-size: 0.78rem; text-align: left; cursor: pointer; }
    .skill-adopt-choice:hover { border-color: #e8c766; background: #322f22; }
    .skill-adopt-choice { display: grid; grid-template-columns: auto 1fr; gap: 2px 8px; align-items: center; }
    .skill-adopt-choice strong { color: #ffe39a; }
    .skill-adopt-detail { grid-column: 2; color: #d6d3c5; font-size: 0.72rem; }
    .skill-adopt-tag { grid-row: span 2; padding: 2px 8px; border-radius: 5px; background: #e8c766; color: #1a1708; font-size: 0.72rem; font-weight: 900; }
    /* 開け閉めできる欄：「▶ クリックで〜が開きます」の案内 */
    details.collapsible > summary { cursor: pointer; list-style: none; }
    details.collapsible > summary::-webkit-details-marker { display: none; }
    .collapsible-hint { color: #9fd18a; font-size: 0.74rem; font-weight: 700; white-space: nowrap; }
    details.collapsible:not([open]) .when-open, details.collapsible[open] > summary .when-closed { display: none; }
    details.collapsible[open] > summary .when-open { display: inline; }
    details.collapsible > summary:hover .collapsible-hint { color: #c6f0b4; text-decoration: underline; }
    /* 包んだ欄（登録済みリスト・1つの武器を調べる欄）の見出し */
    details.collapsible:not(.weapon-filter-row) { margin-top: 12px; border: 1px dashed #6b6a55; border-radius: 10px; }
    details.collapsible:not(.weapon-filter-row) > summary { display: flex; flex-wrap: wrap; gap: 6px 14px; align-items: baseline; padding: 10px 14px; }
    details.collapsible:not(.weapon-filter-row)[open] > summary { border-bottom: 1px dashed #6b6a55; }
    details.collapsible:not(.weapon-filter-row) > :not(summary) { margin: 12px 14px 14px; }
    .collapsible-title { color: #f2eddc; font-weight: 800; font-size: 0.86rem; }
    /* 登録欄の切り替え */
    .registration-switch { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin: 4px 0 16px; }
    .registration-switch-label { color: #a9a690; font-size: 0.78rem; font-weight: 700; margin-right: 4px; }
    .registration-switch button {
      padding: 10px 16px; border: 2px solid #3a3c31; border-radius: 10px; background: #151612;
      color: #c9c6b8; font-size: 0.82rem; font-weight: 800; cursor: pointer;
    }
    .registration-switch button.active { border-color: #e8c766; background: rgb(214 179 92 / 14%); color: #ffe39a; }
    .registration-switch button[data-value="owned"].active { border-color: #4f9a92; background: rgb(79 154 146 / 16%); color: #bff3ec; }
    /* 表の上の設定バー */
    .comparison-table-options { display: flex; flex-wrap: wrap; gap: 10px 22px; align-items: end; margin-top: 18px; padding: 12px 16px; border: 1px solid #454233; border-radius: 10px; background: #151612; }
    .comparison-table-options > label:not(.checkbox-label) { display: grid; gap: 4px; max-width: 160px; font-size: 0.74rem; font-weight: 800; }
    .comparison-table-options .checkbox-label { display: inline-flex; gap: 8px; align-items: center; font-size: 0.8rem; font-weight: 700; }
    .comparison-table.compact-columns { min-width: 0; }
    .comparison-table.compact-columns > thead > tr > th:nth-child(3),
    .comparison-table.compact-columns > tbody > tr > td:nth-child(3) { position: static; width: auto; box-shadow: none; }
    .comparison-table.compact-columns .bonus-match-cell { min-width: 320px; }
    .comparison-table.compact-columns .match-items { display: flex; flex-wrap: wrap; gap: 8px; }
    .comparison-table.compact-columns .match-items .skill-match-item {
      margin: 0; padding: 8px 10px; border: 1px solid #5a5236; border-radius: 8px; background: rgb(0 0 0 / 22%);
    }
    .comparison-table.compact-columns .match-items .comparison-bonus-set { grid-template-columns: repeat(5, auto); }
    /* 全武器の列を並べた表：一致欄は2武器で1段、武器の間は白い破線 */
    .comparison-table:not(.compact-columns) { --match-column-width: 480px; }
    .comparison-table:not(.compact-columns) .match-items { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .comparison-table:not(.compact-columns) .match-items .skill-match-item {
      margin: 0; padding: 6px 8px; border-bottom: 2px dashed rgb(255 255 255 / 55%);
    }
    .comparison-table:not(.compact-columns) .match-items .skill-match-item:nth-child(odd) { border-right: 2px dashed rgb(255 255 255 / 55%); }
    .comparison-table:not(.compact-columns) .match-items .comparison-bonus-set { grid-template-columns: repeat(5, auto); justify-content: start; }
    .comparison-table:not(.compact-columns) .match-items .skill-match-name { white-space: normal; line-height: 1.4; }
    /* 一致欄を上下に分ける：上＝狙い（リセット・金）、下＝手持ちの強化（同じ構成・青緑）。一致がない側は出さない */
    .match-split { display: grid; grid-template-columns: minmax(0, 1fr); gap: 8px; }
    .match-half.empty { display: none; }
    .match-half { min-width: 0; padding: 6px 8px 8px; border-radius: 10px; border: 2px solid transparent; }
    .match-half.reset { border-color: rgb(232 199 102 / 55%); background: rgb(232 199 102 / 6%); }
    .match-half.owned { border-color: rgb(110 205 195 / 55%); background: rgb(110 205 195 / 7%); }
    .match-half-label { margin-bottom: 6px; font-size: 0.72rem; font-weight: 900; letter-spacing: 0.04em; }
    .match-half.reset .match-half-label { color: #f3d27a; }
    .match-half.owned .match-half-label { color: #8fe0d6; }
    .match-kind-badge {
      display: inline-block; margin-right: 6px; padding: 1px 8px; border-radius: 999px;
      font-size: 0.72rem; font-weight: 900; white-space: nowrap; vertical-align: 1px;
    }
    .match-kind-badge.reset { background: #e8c766; color: #1a1708; }
    .match-kind-badge.owned { background: #4fb8ad; color: #06201d; }
    .match-half.owned .skill-match-item { border-color: rgb(110 205 195 / 45%) !important; }
    /* 全武器の列を並べた表：上下に分けたので、それぞれの中は今までどおり2武器で1段 */
    .comparison-table:not(.compact-columns) { --match-column-width: 520px; }
    /* 武器の列：見出しとボーナスを縦の白線で区切り、ボーナスは上にそろえる */
    .comparison-table:not(.compact-columns) th.reset-column-header,
    .comparison-table:not(.compact-columns) th.owned-column-header,
    .comparison-table:not(.compact-columns) td.comparison-result-cell { border-left: 2px solid rgb(240 240 240 / 55%); }
    .comparison-table td.comparison-result-cell { vertical-align: top; }
    .match-adopt-button { display: inline-block; width: auto; margin-top: 4px; padding: 4px 10px; font-size: 0.7rem; }
    .bonus-wish-next-wish { color: #a9a690; font-size: 0.74rem; }
    .bonus-wish-next-result { font-weight: 800; color: #cfeec0; }
    .bonus-wish-next-list li.none .bonus-wish-next-result { color: #888; font-weight: 400; }
    .bonus-wish-plan { margin: 0; padding-left: 1.6em; display: grid; gap: 4px; font-size: 0.8rem; line-height: 1.6; }
    .comparison-table { --match-column-width: 240px; }
    .bonus-match-cell { min-width: var(--match-column-width); vertical-align: top; }
    .bonus-match-cell .comparison-bonus-set { grid-template-columns: repeat(3, minmax(42px, auto)); justify-content: start; }
    td.bonus-wish-hit { background: rgb(232 199 102 / 16%); box-shadow: inset 0 0 0 3px #e8c766, inset 0 0 18px rgb(232 199 102 / 25%); }
    /* 一致した行：金色の帯と左の太線で目立たせる */
    .prediction-table tbody tr.bonus-wish-row-hit,
    .detail-compact-table tbody tr.prediction-match {
      background: linear-gradient(90deg, rgb(232 199 102 / 20%), rgb(232 199 102 / 6%));
    }
    .prediction-table tbody tr.bonus-wish-row-hit > th:first-child,
    .detail-compact-table tbody tr.prediction-match > th:first-child {
      box-shadow: inset 5px 0 0 #e8c766;
      color: #ffe39a;
    }
    .detail-match-badge {
      display: inline-block; padding: 4px 9px; border-radius: 999px;
      background: #e8c766; color: #1a1708; font-size: 0.74rem; font-weight: 900; white-space: nowrap;
    }
    /* EXをもっと目立たせる：太い枠・強い光・白っぽい文字 */
    .bonus-tag.ex { border-width: 2px; font-weight: 900; text-shadow: 0 0 6px currentColor; }
    /* 色弱でも見分けやすい色分け（ユーザーは色弱。ユーザーが選んだ組み合わせ）：
       攻撃＝オレンジ、属性＝紫、斬れ味・装填＝白、会心＝灰色。青は紫と紛らわしいので使わない */
    .bonus-tag.attack { border-color: rgb(230 159 0 / 75%); background: rgb(230 159 0 / 14%); color: #ffdca0; }
    .bonus-tag.element { border-color: rgb(176 112 230 / 80%); background: rgb(140 70 200 / 20%); color: #ead6ff; }
    .bonus-tag.sharpness-ammo { border-color: rgb(230 230 230 / 70%); background: rgb(255 255 255 / 9%); color: #f4f4f4; }
    .bonus-tag.affinity { border-color: #7d7d7d; background: rgb(128 128 128 / 14%); color: #c8c8c8; }
    .bonus-tag.attack.ex { border-color: #ffc04d; background: #e69f00; box-shadow: 0 0 0 1px rgb(255 192 77 / 50%), 0 0 16px rgb(230 159 0 / 60%); color: #1a1000; text-shadow: none; }
    .bonus-tag.element.ex { border-color: #d4a6ff; background: #8e44c9; box-shadow: 0 0 0 1px rgb(212 166 255 / 50%), 0 0 16px rgb(142 68 201 / 70%); color: #ffffff; text-shadow: none; }
    .bonus-tag.sharpness-ammo.ex { border-color: #ffffff; background: #f2f2f2; box-shadow: 0 0 0 1px rgb(255 255 255 / 50%), 0 0 14px rgb(255 255 255 / 45%); color: #111111; text-shadow: none; }
    .bonus-tag.affinity.ex { border-color: #b5b5b5; background: #6b6b6b; box-shadow: 0 0 0 1px rgb(181 181 181 / 45%), 0 0 12px rgb(150 150 150 / 45%); color: #ffffff; text-shadow: none; }
    .bonus-tag:not(.ex) { opacity: 0.82; }
    /* 「1条件を詳しく絞り込む」の表をスキル未来予測と同じ詰めた形に */
    .detail-compact-table { --state-column-width: 140px; min-width: 760px; }
    .detail-compact-table th, .detail-compact-table td { padding: 8px 7px; }
    .detail-compact-table > thead > tr > th:nth-child(2),
    .detail-compact-table > tbody > tr > td:nth-child(2) {
      position: sticky; left: var(--offset-column-width); z-index: 2;
      width: var(--state-column-width); min-width: var(--state-column-width);
      background: #151612; box-shadow: 8px 0 12px rgb(0 0 0 / 20%);
    }
    .detail-compact-table > thead > tr > th:nth-child(2) { z-index: 5; background: #20221c; }
    .detail-compact-table tbody tr.prediction-match > td:nth-child(2) { background: #2a2617; }
    .detail-match-cell { width: 80px; }
    .detail-bonus-set { display: flex; flex-wrap: wrap; gap: 5px; }
    .detail-bonus-set .bonus-tag { min-width: 112px; padding: 5px 7px; }
    /* seed・復元カウンター検索：連続した復元ボーナス結果をカードで入力 */
    /* 左：1〜5枠目を縦に並べた枠リスト（押して入力先を選ぶ）／右：系統ごとのカード */
    .observation-row.card-input { display: grid; grid-template-columns: minmax(0, 1fr); gap: 10px; align-items: start; padding: 14px; }
    .observation-row.card-input > label { display: none; }
    .observation-row.card-input .roll-number { font-size: 0.9rem; font-weight: 800; }
    .observation-card-body { display: grid; grid-template-columns: minmax(230px, 280px) minmax(0, 1fr); gap: 16px; align-items: start; min-width: 0; }
    .observation-slot-column { display: grid; gap: 6px; }
    .observation-slot-hint { margin: 0 0 2px; color: #a9a690; font-size: 0.7rem; }
    .observation-chips { display: grid; gap: 6px; }
    .observation-chip {
      display: grid; grid-template-columns: 46px minmax(0, 1fr) auto; gap: 8px; align-items: center;
      min-width: 0; padding: 6px 8px; border: 1px solid #44473d; border-radius: 8px;
      background: #151612; color: #eee9da; font-size: 0.76rem; text-align: left; cursor: pointer;
    }
    .observation-chip:hover { border-color: #6b6a55; }
    .observation-chip-slot { color: #d6d3c5; font-weight: 800; white-space: nowrap; }
    .observation-chip-value { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .observation-chip-value.bonus-tag { opacity: 1; padding: 4px 8px; }
    .observation-chip.empty .observation-chip-value { color: #77745f; }
    .observation-chip.empty { border-style: dashed; }
    .observation-chip.active { border: 2px solid #e8c766; background: rgb(214 179 92 / 14%); }
    .observation-chip-marker { color: #ffe39a; font-size: 0.7rem; font-weight: 800; white-space: nowrap; }
    @media (max-width: 760px) {
      .observation-card-body { grid-template-columns: minmax(0, 1fr); }
    }
    /* ボーナスのカード：シリーズスキル選択欄と同じ形（選択中は金枠＋チェック） */
    /* 系統ごとに列を分け、見出しの下に段階（II→III→EX）を縦に並べる */
    .observation-palette { display: grid; grid-template-columns: repeat(var(--category-count, 4), minmax(0, 1fr)); gap: 10px; align-items: start; }
    .observation-category { display: grid; gap: 6px; min-width: 0; }
    .observation-category-heading {
      padding: 5px 10px; border-radius: 6px; font-size: 0.8rem; font-weight: 800; letter-spacing: 0.05em;
      color: #f2eddc; user-select: none;
    }
    .observation-category.attack .observation-category-heading { background: rgb(201 102 90 / 28%); border-bottom: 2px solid #c9665a; }
    .observation-category.affinity .observation-category-heading { background: rgb(214 176 74 / 24%); border-bottom: 2px solid #d6b04a; }
    .observation-category.element .observation-category-heading { background: rgb(90 168 196 / 24%); border-bottom: 2px solid #5aa8c4; }
    .observation-category.sharpness-ammo .observation-category-heading { background: rgb(154 136 208 / 24%); border-bottom: 2px solid #9a88d0; }
    @media (max-width: 640px) {
      .observation-palette { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    .observation-card {
      display: flex; gap: 10px; align-items: flex-start; min-width: 0;
      padding: 9px 11px; border: 1px solid #3a3c31; border-left-width: 4px; border-radius: 8px;
      background: rgb(0 0 0 / 18%); color: #eee9da; text-align: left; cursor: pointer;
    }
    .observation-card:hover { border-color: #6b6a55; background: rgb(255 255 255 / 4%); }
    .observation-card.attack { border-left-color: #c9665a; }
    .observation-card.affinity { border-left-color: #d6b04a; }
    .observation-card.element { border-left-color: #5aa8c4; }
    .observation-card.sharpness-ammo { border-left-color: #9a88d0; }
    .observation-card > span:last-child { display: grid; gap: 2px; min-width: 0; }
    .observation-card strong { font-size: 0.8rem; font-weight: 700; line-height: 1.35; }
    .observation-card-sub { color: #a9a690; font-size: 0.7rem; }
    .observation-card.ex strong { color: #ffe39a; text-shadow: 0 0 8px rgb(232 199 102 / 45%); }
    .observation-card-mark {
      flex: none; width: 18px; height: 18px; margin-top: 1px;
      border: 2px solid #6b6a55; border-radius: 4px; background: #151612;
    }
    .observation-card.selected { border-color: #e8c766; border-left-color: #e8c766; background: rgb(214 179 92 / 14%); }
    .observation-card.selected .observation-card-mark { border-color: #e8c766; background: #e8c766; position: relative; }
    .observation-card.selected .observation-card-mark::after {
      content: ""; position: absolute; left: 4px; top: 0; width: 5px; height: 10px;
      border: solid #1a1708; border-width: 0 2px 2px 0; transform: rotate(45deg);
    }
    .observation-clear { justify-self: end; color: #ffffff; font-size: 0.72rem; }
    /* 手持ち武器（同じ構成で再復元）：青緑系で狙い（リセット）と区別する */
    .owned-weapon-settings { border-color: #4f9a92; background: rgb(79 154 146 / 6%); }
    .owned-weapon-form { display: grid; gap: 10px; margin-bottom: 14px; padding: 12px 14px; border: 1px dashed #4f9a92; border-radius: 10px; }
    /* 名前と種類は長い言葉が入るので広く（例：【攻撃激化】状態異常＆属性やられ無効 火） */
    .owned-weapon-form-row {
      display: grid; gap: 8px; align-items: end;
      grid-template-columns: minmax(300px, 2.4fr) minmax(130px, 1fr) minmax(130px, 1fr) minmax(150px, 1fr) minmax(260px, 2fr);
    }
    @media (max-width: 1100px) {
      .owned-weapon-form-row { grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr)); }
    }
    .owned-weapon-form-row label, .owned-weapon-card label { display: grid; gap: 4px; font-size: 0.76rem; font-weight: 700; }
    .owned-weapon-form-row select, .owned-weapon-form-row input { height: 38px; }
    .owned-weapon-slots { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 6px; max-width: 640px; }
    .owned-weapon-slots label { display: grid; gap: 4px; font-size: 0.72rem; font-weight: 700; }
    .owned-weapon-slots select { height: 36px; min-width: 0; }
    .owned-weapon-form .small-button { justify-self: start; }
    .owned-weapon-card .weapon-filter-name { color: #8fe0d6; }
    .owned-weapon-card .weapon-filter-body > label { max-width: 300px; }
    .owned-rule-controls { display: grid; grid-template-columns: minmax(0, 420px) minmax(0, 160px); gap: 8px; }
    .owned-rule-controls label { display: grid; gap: 4px; font-size: 0.76rem; font-weight: 700; }
    .owned-rule-controls label[hidden] { display: none; }
    .owned-rule-controls .owned-keep-attack { grid-column: 1 / -1; display: flex; gap: 8px; align-items: center; font-size: 0.8rem; font-weight: 800; color: #ffe39a; cursor: pointer; }
    .owned-rule-controls .owned-keep-attack input { width: 18px; height: 18px; min-height: 0; margin: 0; accent-color: #e8c766; flex: none; }
    .next-match-details { margin: 0 0 16px; }
    .bonus-wish-min-attack { display: grid; gap: 4px; max-width: 360px; margin: 10px 0; font-size: 0.8rem; font-weight: 800; color: #ffe39a; }
    .owned-rule-controls select { height: 38px; }
    /* 一致の条件をまとめて設定 */
    .owned-bulk-rule { display: grid; gap: 10px; padding: 4px 0 6px; }
    .owned-bulk-rule > label { display: grid; gap: 4px; max-width: 420px; font-size: 0.76rem; font-weight: 700; }
    .owned-bulk-rule > label select { height: 38px; }
    .owned-bulk-rule > button { justify-self: start; }
    /* 所持表（03 手持ち武器タブの一番上） */
    .owned-matrix-panel { margin-bottom: 22px; }
    .owned-matrix-legend { margin: 0 0 12px; color: #d8d3bf; font-size: 0.8rem; font-weight: 700; }
    .owned-matrix-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(330px, 1fr)); gap: 14px; align-items: start; }
    .owned-matrix-card { padding: 8px; border: 2px solid #4f8f88; border-radius: 12px; background: rgb(0 0 0 / 18%); overflow-x: auto; }
    .owned-matrix-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: 0.8rem; }
    .owned-matrix-table th, .owned-matrix-table td { padding: 4px 3px; border: 1px solid #4b4a3c; text-align: center; vertical-align: middle; }
    .owned-matrix-table thead th { background: #2c2b22; color: #f3e6bd; font-size: 0.74rem; font-weight: 800; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .owned-matrix-table th.owned-matrix-corner { width: 6.5em; background: #3a3420; color: #ffe39a; font-size: 0.8rem; font-weight: 900; text-align: left; padding-left: 6px; white-space: normal; }
    .owned-matrix-table tbody th { background: #22221b; color: #f2eddc; font-weight: 800; }
    .owned-matrix-cell { height: 40px; }
    .owned-matrix-cell.manual { cursor: pointer; }
    .owned-matrix-cell.manual:hover, .owned-matrix-cell.manual:focus-visible { background: rgb(255 255 255 / 8%); outline: none; }
    .owned-matrix-cell.auto { background: rgb(79 184 173 / 30%); color: #ffffff; }
    .owned-matrix-symbol { display: block; font-size: 1rem; font-weight: 900; line-height: 1.1; }
    .owned-matrix-partner { display: block; color: #e6fffb; font-size: 0.64rem; font-weight: 700; line-height: 1.2; overflow-wrap: anywhere; }
    .owned-matrix-cell.mark-o { color: #ffd44d; font-size: 1.05rem; font-weight: 900; }
    .owned-matrix-cell.mark-x { color: #9a9a9a; font-size: 1rem; font-weight: 900; }
    .owned-matrix-editor { display: grid; gap: 10px; padding-top: 6px; }
    .owned-matrix-edit-row { display: grid; gap: 8px; padding: 10px 12px; border: 1px solid #4b4a3c; border-radius: 10px; background: rgb(0 0 0 / 16%); }
    .owned-matrix-edit-fields { display: flex; flex-wrap: wrap; gap: 8px 12px; }
    .owned-matrix-edit-fields label { display: grid; gap: 4px; min-width: 150px; font-size: 0.74rem; font-weight: 700; }
    .owned-matrix-edit-fields input, .owned-matrix-edit-fields select { height: 36px; }
    .owned-matrix-columns { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
    .owned-matrix-chip { display: inline-flex; gap: 4px; align-items: center; padding: 3px 6px; border: 1px solid #8a7a45; border-radius: 999px; background: #2b2a20; color: #ffe39a; font-size: 0.76rem; font-weight: 800; }
    .owned-matrix-chip button { padding: 0 4px; border: 0; background: none; color: #f2eddc; font-size: 0.72rem; cursor: pointer; }
    .owned-matrix-chip button:disabled { opacity: 0.25; cursor: default; }
    .owned-matrix-columns select { width: auto; height: 32px; font-size: 0.76rem; }
    .owned-matrix-edit-actions { display: flex; gap: 6px; }
    .owned-matrix-edit-footer { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; }
    .bonus-tag .tier-up { margin-left: 2px; color: #7dff8a; font-weight: 900; text-shadow: 0 0 6px rgb(125 255 138 / 60%); }
    .bonus-tag .tier-down { margin-left: 2px; color: #ff7a6b; font-weight: 900; }
    /* 塗りつぶしたEXの上では、矢印は文字と同じ色（オレンジ・白の上は黒、紫・灰の上は白）で太く大きく。上下は ↑↓ の形で分かる */
    .bonus-tag.ex .tier-up, .bonus-tag.ex .tier-down {
      margin-left: 3px; color: inherit; text-shadow: none; font-size: 1.15em; font-weight: 900; -webkit-text-stroke: 0.6px currentColor;
    }
    .owned-update-button { border-color: #4f9a92; color: #bff3ec; }
    .owned-card-actions { display: inline-flex; gap: 6px; margin-left: auto; }
    .owned-remove-button, .owned-move-button { width: 26px; height: 26px; padding: 0; border: 0; border-radius: 50%; background: #30332b; color: #c9c6b8; font-weight: 900; cursor: pointer; }
    .owned-remove-button:hover { background: #5a2e28; color: #fff; }
    .owned-move-button:hover:not(:disabled) { background: #2f4f4b; color: #fff; }
    .owned-move-button:disabled { opacity: 0.3; cursor: default; }
    .owned-name-hint { margin: 0; color: #a9a690; font-size: 0.72rem; }
    .column-kind { display: block; margin-bottom: 2px; font-size: 0.62rem; font-weight: 700; letter-spacing: 0; color: #a9a690; }
    .column-layout { display: block; margin-top: 2px; font-size: 0.66rem; color: #8fe0d6; }
    .comparison-table thead th.owned-column-header { background: #17302d; border-bottom: 2px solid #4f9a92; }
    .comparison-table thead th.owned-column-header .column-kind { color: #8fe0d6; }
    td.owned-result-cell { background: rgb(79 154 146 / 7%); }
    .detail-result-cell .keep-transition-button { display: inline-block; width: auto; margin-top: 6px; padding-inline: 14px; }
    @media (min-width: 900px) {
      .comparison-table > thead > tr > th:nth-child(3),
      .comparison-table > tbody > tr > td:nth-child(3) {
        position: sticky;
        left: calc(var(--offset-column-width) + var(--state-column-width));
        z-index: 2;
        background: #151612;
        box-shadow: 8px 0 12px rgb(0 0 0 / 20%);
      }
      .comparison-table > thead > tr > th:nth-child(3) { z-index: 5; background: #20221c; }
      .comparison-table > tbody > tr > td:nth-child(2) { box-shadow: none; }
      .comparison-table > tbody > tr.bonus-wish-row-hit > td:nth-child(2),
      .comparison-table > tbody > tr.bonus-wish-row-hit > td:nth-child(3) { background: #2a2617; }
    }
  `,
}));
const STORAGE_KEY = "gogma-seed-finder-chatgpt-state-v1";

const SAMPLE_OBSERVATIONS = [
  [11, 12, 15, 14, 11],
  [9, 14, 8, 16, 11],
  [6, 13, 10, 11, 8],
  [8, 12, 6, 15, 10],
  [15, 8, 8, 6, 16],
  [14, 8, 11, 15, 10],
];

const BOW_SAMPLE_OBSERVATIONS = [
  [13, 14, 15, 12, 15],
  [9, 13, 14, 16, 15],
  [11, 13, 12, 14, 14],
  [11, 13, 15, 14, 9],
  [11, 15, 13, 13, 12],
  [12, 16, 12, 15, 9],
];

const HEAVY_BOWGUN_SAMPLE_OBSERVATIONS = [
  [13, 6, 8, 12, 6],
  [13, 10, 12, 15, 6],
  [9, 15, 9, 16, 6],
  [12, 16, 6, 8, 9],
  [12, 13, 15, 6, 9],
  [15, 9, 6, 16, 12],
];

const form = document.querySelector("#search-form");
const errorBox = document.querySelector("#form-error");
const startButton = document.querySelector("#start-button");
const cancelButton = document.querySelector("#cancel-button");
const statusText = document.querySelector("#status-text");
const progressBar = document.querySelector("#progress-bar");
const progressValue = document.querySelector("#progress-value");
const checkedValue = document.querySelector("#checked-value");
const elapsedValue = document.querySelector("#elapsed-value");
const candidateValue = document.querySelector("#candidate-value");
const emptyResult = document.querySelector("#empty-result");
const candidateList = document.querySelector("#candidate-list");
const workerInput = document.querySelector("#worker-count");
const observationRows = document.querySelector("#observation-rows");
const removeObservationButton = document.querySelector("#remove-observation");
const weaponSelect = document.querySelector("#weapon-type");
const attributeSelect = document.querySelector("#attribute-force");
const counterStartInput = document.querySelector("#counter-start");
const counterEndInput = document.querySelector("#counter-end");
const counterEstimateInput = document.querySelector("#counter-estimate");
const counterRadiusSelect = document.querySelector("#counter-radius");
const applyCounterEstimateButton = document.querySelector("#apply-counter-estimate");
const counterRangeSummary = document.querySelector("#counter-range-summary");
const bonusPoolNote = document.querySelector("#bonus-pool-note");
const predictionPanel = document.querySelector("#prediction-panel");
const predictionStatus = document.querySelector("#prediction-status");
const predictionSeed = document.querySelector("#prediction-seed");
const predictionOrigin = document.querySelector("#prediction-origin");
const predictionWeaponSelect = document.querySelector("#prediction-weapon-type");
const predictionAttributeSelect = document.querySelector("#prediction-attribute-force");
const predictionCountInput = document.querySelector("#prediction-count");
const predictionPoolNote = document.querySelector("#prediction-pool-note");
const predictionFilters = document.querySelector("#prediction-filters");
const predictionIgnoreTier = document.querySelector("#prediction-ignore-tier");
const predictionMatchesOnly = document.querySelector("#prediction-matches-only");
// 新しい画面では説明文が「本文」と「通常アーティアの案内」に分かれた。本文だけを書き換える
const predictionFilterDescription = document.querySelector("#prediction-filter-description-text")
  ?? document.querySelector("#prediction-filter-description");
const predictionFilterArtianHint = document.querySelector("#prediction-filter-artian-hint");
const predictionError = document.querySelector("#prediction-error");
const predictionRows = document.querySelector("#prediction-rows");
const comparisonStatus = document.querySelector("#comparison-status");
const comparisonWeaponSelect = document.querySelector("#comparison-weapon-type");
const comparisonAttributeSelect = document.querySelector("#comparison-attribute-force");
const comparisonCountInput = document.querySelector("#comparison-count");
const bonusExFilterEnabled = document.querySelector("#bonus-ex-filter-enabled");
const bonusExFilterCountSelect = document.querySelector("#bonus-ex-filter-count");
const addComparisonTargetButton = document.querySelector("#add-comparison-target");
const clearComparisonTargetsButton = document.querySelector("#clear-comparison-targets");
const comparisonTargetList = document.querySelector("#comparison-target-list");
const comparisonTargetCapacity = document.querySelector("#comparison-target-capacity");
const comparisonError = document.querySelector("#comparison-error");
const comparisonTableWrap = document.querySelector("#comparison-table-wrap");
const comparisonHeaderRow = document.querySelector("#comparison-header-row");
const comparisonRows = document.querySelector("#comparison-rows");
const exportBonusCsvButton = document.querySelector("#export-bonus-csv");
const bonusExportStatus = document.querySelector("#bonus-export-status");
// 「保存しました」のお知らせ（元のツールの新機能）
const saveFeedback = document.querySelector("#save-feedback");
const saveFeedbackTitle = document.querySelector("#save-feedback-title");
const saveFeedbackMessages = document.querySelector("#save-feedback-messages");
const closeSaveFeedbackButton = document.querySelector("#close-save-feedback");
const continuationCodeInput = document.querySelector("#continuation-code");
const openContinuationButton = document.querySelector("#open-continuation");
const continuationMessage = document.querySelector("#continuation-message");
const continuationError = document.querySelector("#continuation-error");
const skillStatus = document.querySelector("#skill-status");
const skillWeaponSelect = document.querySelector("#skill-weapon-type");
const skillAttributeSelect = document.querySelector("#skill-attribute-force");
const skillPredictionCountInput = document.querySelector("#skill-prediction-count");
const skillHighlightEnabled = document.querySelector("#skill-highlight-enabled");
const skillFilterEnabled = document.querySelector("#skill-filter-enabled");
const skillFilterGroupSelect = document.querySelector("#skill-filter-group");
const skillFilterOperatorSelect = document.querySelector("#skill-filter-operator");
const skillFilterSeriesOptions = document.querySelector("#skill-filter-series-options");
const exportSkillCsvButton = document.querySelector("#export-skill-csv");
const skillExportStatus = document.querySelector("#skill-export-status");
const skillObservationRows = document.querySelector("#skill-observation-rows");
const addSkillObservationButton = document.querySelector("#add-skill-observation");
const removeSkillObservationButton = document.querySelector("#remove-skill-observation");
const findSkillPositionButton = document.querySelector("#find-skill-position");
const skillError = document.querySelector("#skill-error");
const skillTableWrap = document.querySelector("#skill-table-wrap");
const skillPredictionRows = document.querySelector("#skill-prediction-rows");
const skillPredictionHeaderRow = document.querySelector("#skill-prediction-header-row");
const skillFutureStatus = document.querySelector("#skill-future-status");
const stateBaseSeed = document.querySelector("#state-base-seed");
const stateBonusCounter = document.querySelector("#state-bonus-counter");
const stateSkillCounter = document.querySelector("#state-skill-counter");
const stateBaseSeedStatus = document.querySelector("#state-base-seed-status");
const stateBonusCounterStatus = document.querySelector("#state-bonus-counter-status");
const stateSkillCounterStatus = document.querySelector("#state-skill-counter-status");
const saveStateSummary = document.querySelector("#save-state-summary");
const manualStateBaseSeedInput = document.querySelector("#manual-state-base-seed");
const manualStateBonusCounterInput = document.querySelector("#manual-state-bonus-counter");
const manualStateSkillCounterInput = document.querySelector("#manual-state-skill-counter");
const applyManualStateButton = document.querySelector("#apply-manual-state");
const manualStateMessage = document.querySelector("#manual-state-message");
const manualStateError = document.querySelector("#manual-state-error");
const skillSearchBaseSeed = document.querySelector("#skill-search-base-seed");
const bonusStateBaseSeedInput = document.querySelector("#bonus-state-base-seed");
const bonusStateCounterInput = document.querySelector("#bonus-state-counter");
const bonusStateSkillCounterInput = document.querySelector("#bonus-state-skill-counter");
const applyBonusStateButton = document.querySelector("#apply-bonus-state");
const bonusStateMessage = document.querySelector("#bonus-state-message");
const bonusStateError = document.querySelector("#bonus-state-error");
const skillStateBaseSeedInput = document.querySelector("#skill-state-base-seed");
const skillStateCounterInput = document.querySelector("#skill-state-counter");
const skillStateBonusCounterInput = document.querySelector("#skill-state-bonus-counter");
const applySkillStateButton = document.querySelector("#apply-skill-state");
const skillStateMessage = document.querySelector("#skill-state-message");
const skillStateError = document.querySelector("#skill-state-error");
const comparisonTargetLabelInput = document.querySelector("#comparison-target-label");
const skillTargetLabelInput = document.querySelector("#skill-target-label");
const skillTargetWeaponSelect = document.querySelector("#skill-target-weapon-type");
const skillTargetAttributeSelect = document.querySelector("#skill-target-attribute-force");
const addSkillTargetButton = document.querySelector("#add-skill-target");
const clearSkillTargetsButton = document.querySelector("#clear-skill-targets");
const skillTargetList = document.querySelector("#skill-target-list");
const skillTargetCapacity = document.querySelector("#skill-target-capacity");
const skillTargetError = document.querySelector("#skill-target-error");
const bonusFutureKicker = document.querySelector("#bonus-future-kicker");
const bonusOperationReset = document.querySelector("#bonus-operation-reset");
const bonusOperationKeep = document.querySelector("#bonus-operation-keep");
const keepLayoutPanel = document.querySelector("#keep-layout-panel");
const keepLayoutInputs = document.querySelector("#keep-layout-inputs");
const keepLayoutSource = document.querySelector("#keep-layout-source");
const keepLayoutError = document.querySelector("#keep-layout-error");
const detailPredictionSection = document.querySelector(".detail-prediction-section");
// 通常アーティア（03 通常アーティアカウンター特定・04 通常アーティア未来予測）の画面の部品
const artianBaseStatus = document.querySelector("#artian-base-status");
const artianBaseSeed = document.querySelector("#artian-base-seed");
const artianBaseCurrentCounter = document.querySelector("#artian-base-current-counter");
const artianBaseCounterSource = document.querySelector("#artian-base-counter-source");
const artianCounterOverviewGrid = document.querySelector("#artian-counter-overview-grid");
const saveStateArtianCounterOverviewGrid = document.querySelector("#save-state-artian-counter-overview-grid");
const artianBaseWeaponSelect = document.querySelector("#artian-base-weapon-type");
const artianBaseAttributeSelect = document.querySelector("#artian-base-attribute-force");
const artianSearchWeaponSelect = document.querySelector("#artian-search-weapon-type");
const artianSearchAttributeSelect = document.querySelector("#artian-search-attribute-force");
const artianBaseCounterInput = document.querySelector("#artian-base-counter");
const artianBaseCountInput = document.querySelector("#artian-base-count");
const artianWeaponVerification = document.querySelector("#artian-weapon-verification");
const artianSearchWeaponVerification = document.querySelector("#artian-search-weapon-verification");
const applyArtianBaseCounterButton = document.querySelector("#apply-artian-base-counter");
const exportArtianBaseCsvButton = document.querySelector("#export-artian-base-csv");
const artianBaseError = document.querySelector("#artian-base-error");
const artianSearchError = document.querySelector("#artian-search-error");
const openArtianFutureFromSearchButton = document.querySelector("#open-artian-future-from-search");
const artianCounterStartInput = document.querySelector("#artian-counter-start");
const artianCounterEndInput = document.querySelector("#artian-counter-end");
const artianObservationRows = document.querySelector("#artian-observation-rows");
const addArtianObservationButton = document.querySelector("#add-artian-observation");
const removeArtianObservationButton = document.querySelector("#remove-artian-observation");
const findArtianCounterButton = document.querySelector("#find-artian-counter");
const artianSearchMessage = document.querySelector("#artian-search-message");
const artianCounterCandidates = document.querySelector("#artian-counter-candidates");
const artianBaseEmpty = document.querySelector("#artian-base-empty");
const artianBaseTableWrap = document.querySelector("#artian-base-table-wrap");
const artianBaseRows = document.querySelector("#artian-base-rows");
const artianBasePager = document.querySelector("#artian-base-pager");
const artianBasePagePrev = document.querySelector("#artian-base-page-prev");
const artianBasePageNext = document.querySelector("#artian-base-page-next");
const artianBasePageStatus = document.querySelector("#artian-base-page-status");
const artianFilterEnabled = document.querySelector("#artian-filter-enabled");
const artianFilterGrid = document.querySelector("#artian-filter-grid");
const openArtianFutureButtons = [...document.querySelectorAll("[data-open-artian-future]")];
const openArtianTipButtons = [...document.querySelectorAll("[data-open-artian-tip]")];
const openArtianCounterSearchButtons = [...document.querySelectorAll("[data-open-artian-counter-search]")];
// 「手持ち武器」タブ（手持ち武器の登録・編集だけをするページ）。タブの一覧を集める前に足しておく
// （元のツールの 06・04 通常アーティアの後ろに付くので、番号は自動で 08 になる）
// 09 手持ち武器【通常アーティア】を先に足す（番号が 08、巨戟の手持ち武器が 09 になる）
const artianOwnedTabContainer = createArtianOwnedTab();
const ownedTabContainer = createOwnedWeaponTab();
// 「00 仕組み（はじめに読む）」タブと、01 使い方の「改良版で増えた機能」
setupChatGPTTabs();
const tabButtons = [...document.querySelectorAll("[data-tab]")];
const tabViews = [...document.querySelectorAll("[data-tab-view]")];

const suggestedWorkers = Math.min(16, Math.max(1, navigator.hardwareConcurrency ?? 4));
workerInput.value = String(suggestedWorkers);
populateSelect(weaponSelect, WEAPON_TYPES, 8);
populateSelect(attributeSelect, ATTRIBUTES, 1);
populateSelect(predictionWeaponSelect, WEAPON_TYPES, 8);
populateSelect(predictionAttributeSelect, ATTRIBUTES, 1);
populateSelect(comparisonWeaponSelect, WEAPON_TYPES, 3);
populateSelect(comparisonAttributeSelect, ATTRIBUTES, 1);
populateSelect(skillWeaponSelect, WEAPON_TYPES, 8);
populateSelect(skillAttributeSelect, ATTRIBUTES, 1);
populateSelect(skillTargetWeaponSelect, WEAPON_TYPES, 3);
populateSelect(skillTargetAttributeSelect, ATTRIBUTES, 1);
populateSelect(artianBaseWeaponSelect, WEAPON_TYPES, 6);
populateSelect(artianBaseAttributeSelect, ARTIAN_ATTRIBUTE_KINDS, 1);
populateSelect(artianSearchWeaponSelect, WEAPON_TYPES, 6);
populateSelect(artianSearchAttributeSelect, ARTIAN_ATTRIBUTE_KINDS, 1);
populateSelect(
  skillFilterGroupSelect,
  [[-1, "指定しない"], ...prioritizedSkillOptions(GROUP_SKILLS, PRIORITY_GROUP_SKILL_INDICES)
    .map(([index, label]) => [index, skillLabelWithEffect(label)])],
  LORDS_SOUL_GROUP_INDEX,
);
attachGroupEffectNote(skillFilterGroupSelect);
renderSkillFilterSeriesOptions(new Set([11, 5, 18]));
skillFilterEnabled.checked = true;
const persistedAppState = loadPersistedAppState();
let saveState = persistedAppState.saveState;
let comparisonTargets = persistedAppState.targets;
let bonusPrediction = persistedAppState.bonusPrediction;
// 通常アーティアの作成カウンター（武器種ごと）。起動時に使うので早めに用意する
let artianBaseState = persistedAppState.artianBaseState;
let artianBasePredictionRolls = [];
// 改良版で足した通常アーティアの部品（起動時に作る）
let artianSearchOverviewGrid = null;
let artianObservationUndo = null;
let artianWishBox = null;
let artianNextList = null;
const ARTIAN_WISHES_KEY = "gogma-seed-finder-chatgpt-artian-wishes-v1";
let artianWishes = loadJsonObject(ARTIAN_WISHES_KEY);
// 表のページ切り替え（100件ずつ）。改良版では通常アーティアの表だけで使う
const TABLE_PAGE_SIZE = 100;
const tablePageIndexes = { artianBase: 0 };
const tablePagers = {
  artianBase: {
    root: artianBasePager,
    previous: artianBasePagePrev,
    next: artianBasePageNext,
    status: artianBasePageStatus,
    wrapper: artianBaseTableWrap,
    render: () => renderArtianBaseTable(),
  },
};
// 「リセット／同じ構成」の切り替えは廃止。表はリセット（狙い）と同じ構成（手持ち武器）を並べて出す
bonusPrediction.mode = "reset";
// 手持ち武器 [{ id, label, weaponType, attributeForce, categories: 1〜5枠目の系統, minEx }]
const OWNED_WEAPONS_KEY = "gogma-seed-finder-chatgpt-owned-weapons-v1";
const MAX_OWNED_WEAPONS = 140;
// 手持ち武器を「一致」にする条件
const OWNED_RULE_OPTIONS = [
  ["upgrade", "今より強くなる（どの枠も下がらず、1つ以上上がる）"],
  ["total", "合計で強くなる（下がる枠があっても全体で上がる）"],
  ["ex", "EXの数で判定"],
];
// 手持ち武器の名前の自動入力に使う「激化」と、武器種ごとの「種類」の最初の候補
// （種類は自由に書けて、書いたものは武器種ごとに候補として覚える）
const OWNED_BOOST_OPTIONS = [["", "なし"], ["攻撃激化", "【攻撃激化】"], ["属性激化", "【属性激化】"], ["会心激化", "【会心激化】"]];
// 激化の基本候補。属性による違いは ownedSubtypeFor で解決する。
// 2026-10-30：kuroyonhon.com/mhwilds/memo/38.php の検証表と GameWith /534657 を照合。
const OWNED_SUBTYPE_BY_BOOST = {
  5: { 攻撃激化: "状態異常＆属性やられ無効", 会心激化: "スタミナ継続回復", 属性激化: "防御力＆属性耐性UP" },
  7: { 攻撃激化: "通常", 会心激化: "放射", 属性激化: "拡散" },
  8: { 攻撃激化: "強撃", 会心激化: "強属性", 属性激化: "強属性" },
  9: { 攻撃激化: "榴弾", 会心激化: "強属性", 属性激化: "強属性" },
  11: { 攻撃激化: "接撃", 会心激化: "強撃", 属性激化: "貫通" },
  13: { 攻撃激化: "通常・散弾", 会心激化: "通常・貫通", 属性激化: "散弾・貫通" },
};
let ownedWeapons = loadOwnedWeapons();
let ownedWeaponSection = null;
// 09 手持ち武器【通常アーティア】：[{ id, label, weaponType, attr(0無属性/1属性あり), ids: 1〜5枠目の通常アーティアのボーナス番号 }]
const ARTIAN_OWNED_KEY = "gogma-seed-finder-chatgpt-artian-owned-v1";
const MAX_ARTIAN_OWNED = 140;
let artianOwned = loadArtianOwned();
const artianOwnedForm = { weaponType: 11, attr: 1, element: 1, label: "", ids: [null, null, null, null, null] };
const artianOwnedUi = { openKeys: new Set() };
// 03 手持ち武器タブの一番上の所持表。かたまり（武器種＋激化）ごとに、行＝属性、列＝スキル。
// 列のスキルは "g13"（グループスキルの番号）／"s5"（シリーズスキルの番号）。印は "かたまりID|属性|列" → "o"／"x"
const OWNED_MATRIX_KEY = "gogma-seed-finder-chatgpt-owned-matrix-v1";
const OWNED_MATRIX_ATTRIBUTES = [1, 2, 4, 3, 5, 7, 6, 8, 9]; // ユーザーのExcelと同じ順（火水雷氷龍・麻痺毒睡眠爆破）
const OWNED_MATRIX_BOOST_OPTIONS = [["", "指定なし（全部）"], ["攻撃激化", "攻撃激化"], ["属性激化", "属性激化"], ["会心激化", "会心激化"]];
// 初期の形：ユーザーのExcel（ワイルズ巨戟メモ用.xlsx のシート3）と同じ
const OWNED_MATRIX_DEFAULT_BLOCKS = (() => {
  const bowColumns = ["g13", "s11", "s5", "s18", "s17"]; // ヌシ魂・黒蝕竜・兇爪竜・巨戟龍・千刃竜
  const gunlanceColumns = ["g13", "s10", "s5", "s18"]; // ヌシ魂・凍峰竜・兇爪竜・巨戟龍
  const basicColumns = ["g13", "s11", "s5"]; // ヌシ魂・黒蝕竜・兇爪竜
  const lightColumns = ["g13", "s11", "s5", "s18"];
  const lanceColumns = ["g13", "s11", "s5", "s10"];
  return [
    ["弓【接撃】", 11, "攻撃激化", bowColumns],
    ["弓【貫通】", 11, "属性激化", bowColumns],
    ["ガンス【拡散】", 7, "属性激化", gunlanceColumns],
    ["ガンス【通常】", 7, "攻撃激化", gunlanceColumns],
    ["太刀", 3, "", basicColumns],
    ["狩猟笛", 5, "", basicColumns],
    ["ライト【攻撃】", 13, "攻撃激化", lightColumns],
    ["ライト【属性】", 13, "属性激化", lightColumns],
    ["ランス【攻撃】", 6, "攻撃激化", lanceColumns],
    ["ランス【会心】", 6, "会心激化", lanceColumns],
  ].map(([name, weaponType, boost, columns]) => ({ name, weaponType, boost, columns: [...columns] }));
})();
let ownedMatrix = loadOwnedMatrix();
// 復元ボーナス未来予測の画面設定（登録欄の切り替え・表の表示）。このブラウザに保存
const BONUS_VIEW_KEY = "gogma-seed-finder-chatgpt-bonus-view-v1";
let showAllComparisonColumns = null;
// 回ごとの結果表は内部スクロールをやめ、10回分ずつ表示する（「続きを表示」で増やす）
const COMPARISON_PAGE_SIZE = 10;
let comparisonRowLimit = COMPARISON_PAGE_SIZE;
let comparisonMoreBar = null;
// 横に長い表のための追加の横スクロールバー（表の上・画面の下）
let tableScrollMirrors = [];
// スキル未来予測タブに出す手持ち武器の登録欄
let skillOwnedContainer = null;
// 開け閉めできる欄は最初は閉じておき、開いた欄は書き直しても開いたままにする
const openDetailKeys = new Set();
// 武器種ごとの希望ボーナス { [weaponType]: { counts: [攻撃, 会心, 属性, 斬れ味・装填] } }
const BONUS_WISHES_KEY = "gogma-seed-finder-chatgpt-bonus-wishes-v1";
const BONUS_WISH_MAX = [5, 5, 4, 2];
// 5枠を1つずつ指定するときの段階（起動時に使うので上の方で定義）
const BONUS_SLOT_LEVELS = [[0, "段階は問わず"], [2, "III以上"], [3, "EXだけ"]];
let bonusWishes = loadJsonObject(BONUS_WISHES_KEY);
// 「1条件を詳しく絞り込む」でII・III・EXまで指定した希望 { [weaponType]: bonusId[] }
const DETAIL_TIER_WISHES_KEY = "gogma-seed-finder-chatgpt-detail-tier-wishes-v1";
let detailTierWishes = loadJsonObject(DETAIL_TIER_WISHES_KEY);
renderObservationRows(SAMPLE_OBSERVATIONS);
renderSkillObservationRows(Array.from({ length: 4 }, () => null));
renderArtianObservationRows(Array.from({ length: 3 }, () => null));
updateBonusPoolNote();
updateCounterRangeSummary();
renderPredictionFilters();
renderArtianBaseFilters();
updatePredictionPoolNote();

let activeWorkers = [];
let workerProgress = [];
let completedWorkers = 0;
let foundCandidates = new Map();
let startedAt = 0;
let elapsedTimer = null;
let cancelled = false;
let lastSearchConfig = null;
let selectedCandidate = null;
let predictionRolls = [];
let predictionWasmReady = null;
let predictionRequestId = 0;
let comparisonRollSets = [];
let comparisonRequestId = 0;
let skillPredictionRollSets = [];
// 武器種ごとの条件 { [weaponType]: { groupIndex, seriesIndices: number[] } }
const WEAPON_SKILL_FILTERS_KEY = "gogma-seed-finder-chatgpt-weapon-filters-v1";
let weaponSkillFilters = loadWeaponSkillFilters();
let weaponFilterSection = null;
let bonusWishSection = null;
let bonusWishSummary = null;
let bonusWishDetails = null;
let bonusWishMatchesOnly = null;
let selectedSkillCounter = null;
let skillObservedCount = 0;
let currentSkillObservations = [];
let creationWorkbench = null;

wireTablePagers();
closeSaveFeedbackButton?.addEventListener("click", hideSaveFeedback);
setupArtianEnhancements();
renderArtianOwnedTab();

renderComparisonTargets();
renderBonusOperation();
syncRuntimeFromSaveState();
renderSaveState();
syncArtianAttributeControl();
renderArtianWeaponVerification();
setActiveTab(location.hash.slice(1) || "search", false);
if (selectedCandidate) {
  void Promise.all([refreshPredictions(), refreshComparisonPredictions()]);
}
if (selectedSkillCounter !== null) void refreshSkillPredictions();
if (currentArtianBaseCounter() !== null) refreshArtianBasePredictions();

document.querySelector("#load-sample").addEventListener("click", () => {
  weaponSelect.value = "8";
  attributeSelect.value = "1";
  document.querySelector("#counter-start").value = "475";
  document.querySelector("#counter-end").value = "485";
  counterEstimateInput.value = "480";
  counterRadiusSelect.value = "5";
  document.querySelector("#seed-start").value = "0";
  document.querySelector("#seed-end").value = "99999999";
  renderObservationRows(SAMPLE_OBSERVATIONS);
  updateBonusPoolNote();
  updateCounterRangeSummary();
  hideError();
});

document.querySelector("#load-bow-sample").addEventListener("click", () => {
  weaponSelect.value = String(BOW_WEAPON_TYPE);
  attributeSelect.value = "4";
  document.querySelector("#counter-start").value = "475";
  document.querySelector("#counter-end").value = "485";
  counterEstimateInput.value = "480";
  counterRadiusSelect.value = "5";
  document.querySelector("#seed-start").value = "0";
  document.querySelector("#seed-end").value = "99999999";
  renderObservationRows(BOW_SAMPLE_OBSERVATIONS);
  updateBonusPoolNote();
  updateCounterRangeSummary();
  hideError();
});

document.querySelector("#load-heavy-bowgun-sample").addEventListener("click", () => {
  weaponSelect.value = String(HEAVY_BOWGUN_WEAPON_TYPE);
  attributeSelect.value = "3";
  document.querySelector("#counter-start").value = "475";
  document.querySelector("#counter-end").value = "485";
  counterEstimateInput.value = "480";
  counterRadiusSelect.value = "5";
  document.querySelector("#seed-start").value = "0";
  document.querySelector("#seed-end").value = "99999999";
  renderObservationRows(HEAVY_BOWGUN_SAMPLE_OBSERVATIONS);
  updateBonusPoolNote();
  updateCounterRangeSummary();
  hideError();
});

weaponSelect.addEventListener("change", () => {
  const currentValues = snapshotObservationValues();
  renderObservationRows(currentValues);
  updateBonusPoolNote();
  hideError();
});

attributeSelect.addEventListener("change", () => {
  const currentValues = snapshotObservationValues();
  renderObservationRows(currentValues);
  updateBonusPoolNote();
  hideError();
});

applyCounterEstimateButton.addEventListener("click", () => applyEstimatedCounterRange());
counterStartInput.addEventListener("input", () => updateCounterRangeSummary());
counterEndInput.addEventListener("input", () => updateCounterRangeSummary());

document.querySelector("#add-observation").addEventListener("click", () => {
  observationRows.append(createObservationRow());
  renumberObservationRows();
});

removeObservationButton.addEventListener("click", () => {
  const rows = observationRows.querySelectorAll(".observation-row");
  if (rows.length > 1) rows[rows.length - 1].remove();
  renumberObservationRows();
});

observationRows.addEventListener("change", () => hideError());

form.addEventListener("submit", (event) => {
  event.preventDefault();
  try {
    beginSearch(readConfig());
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
});

cancelButton.addEventListener("click", () => finishCancelled());

tabButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab(button.dataset.tab);
    scrollToTabEntry(button.dataset.tab);
  });
});

// 希望は武器種ごとに覚えているので、武器種を変えたらその武器種の希望を呼び出す
predictionWeaponSelect.addEventListener("change", () => {
  renderPredictionFilters();
  updatePredictionPoolNote();
  void refreshPredictions();
});

predictionAttributeSelect.addEventListener("change", () => {
  renderPredictionFilters();
  updatePredictionPoolNote();
  void refreshPredictions();
});
predictionCountInput.addEventListener("change", () => void refreshPredictions());
predictionIgnoreTier.addEventListener("change", () => {
  renderPredictionFilters();
  renderPredictionTable();
});
predictionMatchesOnly.addEventListener("change", () => renderPredictionTable());
predictionFilters.addEventListener("change", () => {
  saveDetailFilters();
  renderPredictionTable();
});

addComparisonTargetButton.addEventListener("click", () => void addComparisonTarget());
clearComparisonTargetsButton.addEventListener("click", () => {
  comparisonTargets = [];
  comparisonRollSets = [];
  renderComparisonTargets();
  renderComparisonTable();
  clearSkillPredictionResults();
  persistAppState();
});
comparisonCountInput.addEventListener("change", () => void refreshComparisonPredictions());
[bonusExFilterEnabled, bonusExFilterCountSelect]
  .forEach((control) => control.addEventListener("change", () => renderComparisonTable()));
exportBonusCsvButton.addEventListener("click", () => exportVisibleBonusPredictionsCsv());

addSkillTargetButton.addEventListener("click", () => void addSkillTarget());
clearSkillTargetsButton.addEventListener("click", () => {
  comparisonTargets = [];
  comparisonRollSets = [];
  renderComparisonTargets();
  renderComparisonTable();
  clearSkillPredictionResults();
  persistAppState();
});

applyBonusStateButton.addEventListener("click", () => void applyBonusPredictionState());
applySkillStateButton.addEventListener("click", () => void applySkillPredictionState());
applyManualStateButton.addEventListener("click", () => applyManualSaveState());

// 「ボーナスを同じ構成で再復元」を選ぶと手持ち武器の登録欄が開き、「リセット」を選ぶと閉じる
document.querySelector("#bonus-operation-selector").addEventListener("change", () => {
  const view = loadBonusView();
  view.registration = bonusOperationKeep.checked ? "owned" : "reset";
  persistBonusView(view);
  renderBonusOperation();
});

openContinuationButton.addEventListener("click", () => void openContinuationCode());
continuationCodeInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    void openContinuationCode();
  }
});

addSkillObservationButton.addEventListener("click", () => {
  skillObservationRows.append(createSkillObservationRow());
  renumberSkillObservationRows();
  resetSkillSearchFeedback();
});

removeSkillObservationButton.addEventListener("click", () => {
  const rows = skillObservationRows.querySelectorAll(".skill-observation-row");
  if (rows.length > 1) rows[rows.length - 1].remove();
  renumberSkillObservationRows();
  resetSkillSearchFeedback();
});

skillObservationRows.addEventListener("change", () => resetSkillSearchFeedback());
skillWeaponSelect.addEventListener("change", () => resetSkillSearchFeedback());
skillAttributeSelect.addEventListener("change", () => resetSkillSearchFeedback());
skillPredictionCountInput.addEventListener("change", () => {
  if (selectedSkillCounter !== null) void refreshSkillPredictions();
});
[skillHighlightEnabled, skillFilterEnabled, skillFilterGroupSelect, skillFilterOperatorSelect]
  .forEach((control) => control.addEventListener("change", () => renderSkillPredictionTable()));
skillFilterSeriesOptions.addEventListener("change", () => renderSkillPredictionTable());
exportSkillCsvButton.addEventListener("click", () => exportVisibleSkillPredictionsCsv());
findSkillPositionButton.addEventListener("click", () => void findSkillPosition());

// 00 仕組み・01 使い方の中の「○○タブへ」のリンク
document.addEventListener("click", (event) => {
  const link = event.target instanceof Element ? event.target.closest("[data-goto-tab]") : null;
  if (!link) return;
  setActiveTab(link.dataset.gotoTab);
  document.querySelector(".app-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
});

// 通常アーティアへの移動ボタン（使い方のTIPS・復元ボーナス未来予測の案内など）
openArtianFutureButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab("artian-future");
    document.querySelector(".app-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
openArtianTipButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab("artian-create");
    document.querySelector(".app-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});
openArtianCounterSearchButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setActiveTab("artian-search");
    document.querySelector(".app-tabs")?.scrollIntoView({ behavior: "smooth", block: "start" });
  });
});

// 通常アーティアの操作（元のツールから）
function updateArtianTargetSelection(weaponType, attributeForce) {
  // 改良版：別の武器種に進んだら、前の武器種の入力は合わないので空にする（元に戻せる）
  const weaponChanged = Number(weaponType) !== Number(artianBaseWeaponSelect.value);
  if (weaponChanged) clearArtianObservations("武器種を変えたので、");
  const observations = snapshotArtianObservationValues();
  const filters = snapshotArtianBaseFilters();
  artianBaseWeaponSelect.value = String(weaponType);
  artianSearchWeaponSelect.value = String(weaponType);
  artianBaseAttributeSelect.value = String(attributeForce);
  artianSearchAttributeSelect.value = String(attributeForce);
  syncArtianAttributeControl();
  hideArtianBaseError();
  hideArtianSearchError();
  clearArtianCounterSearchFeedback();
  renderArtianObservationRows(observations);
  renderArtianBaseFilters(filters);
  renderArtianWeaponVerification();
  renderArtianBaseState();
  refreshArtianBasePredictions();
}

artianBaseWeaponSelect.addEventListener("change", () => {
  updateArtianTargetSelection(artianBaseWeaponSelect.value, artianBaseAttributeSelect.value);
});
artianBaseAttributeSelect.addEventListener("change", () => {
  updateArtianTargetSelection(artianBaseWeaponSelect.value, artianBaseAttributeSelect.value);
});
artianSearchWeaponSelect.addEventListener("change", () => {
  updateArtianTargetSelection(artianSearchWeaponSelect.value, artianSearchAttributeSelect.value);
});
artianSearchAttributeSelect.addEventListener("change", () => {
  updateArtianTargetSelection(artianSearchWeaponSelect.value, artianSearchAttributeSelect.value);
});
artianBaseCountInput.addEventListener("change", () => refreshArtianBasePredictions());
applyArtianBaseCounterButton.addEventListener("click", () => applyArtianBaseCounter());
addArtianObservationButton.addEventListener("click", () => {
  artianObservationRows.append(createArtianObservationRow());
  renumberArtianObservationRows();
  clearArtianCounterSearchFeedback();
});
removeArtianObservationButton.addEventListener("click", () => {
  const rows = artianObservationRows.querySelectorAll(".artian-observation-row");
  if (rows.length > 1) rows[rows.length - 1].remove();
  renumberArtianObservationRows();
  clearArtianCounterSearchFeedback();
});
artianObservationRows.addEventListener("change", () => clearArtianCounterSearchFeedback());
findArtianCounterButton.addEventListener("click", () => void searchArtianBaseCounter());
exportArtianBaseCsvButton.addEventListener("click", () => exportArtianBasePredictionsCsv());
artianFilterEnabled.addEventListener("change", () => {
  resetTablePage("artianBase");
  renderArtianBaseTable();
});
artianFilterGrid.addEventListener("change", () => {
  resetTablePage("artianBase");
  renderArtianBaseTable();
});

// 「00 仕組み（はじめに読む）」：カウンターが進む仕組みと、武器ができるまでの流れ
// （通常アーティア→巨戟化→復元強化の進み方はユーザーが実機で調べた内容）
function createOwnedWeaponTab() {
  const nav = document.querySelector(".app-tabs");
  const lastView = [...document.querySelectorAll("[data-tab-view]")].pop();
  if (!nav || !lastView) return null;
  const button = document.createElement("button");
  const number = document.createElement("span");
  button.type = "button";
  button.className = "tab-button";
  button.dataset.tab = "owned";
  button.setAttribute("aria-selected", "false");
  number.textContent = String(nav.querySelectorAll("[data-tab]").length + 1).padStart(2, "0");
  button.append(number, "手持ち武器【巨戟】");
  nav.append(button);
  nav.style.setProperty("--tab-count", String(nav.children.length));

  const view = document.createElement("div");
  view.className = "tab-view";
  view.dataset.tabView = "owned";
  const panel = document.createElement("section");
  panel.className = "panel owned-tab-panel";
  const heading = document.createElement("div");
  heading.className = "section-heading";
  const headingText = document.createElement("div");
  const step = document.createElement("p");
  const title = document.createElement("h2");
  step.className = "step";
  step.textContent = "MY WEAPONS";
  title.textContent = "手持ち武器【巨戟】";
  headingText.append(step, title);
  heading.append(headingText);
  const description = document.createElement("p");
  description.className = "prediction-intro";
  description.textContent = "巨戟アーティア武器（巨戟化したもの）を1本ずつ登録します。通常アーティアのままの武器は、前の「手持ち武器【通常】」タブに登録します。ここで登録した武器は、「復元ボーナス未来予測」（同じ構成で再復元の予測・今より強くなる回の判定）と「スキル未来予測」（すでに持っている組み合わせの判定）の両方で使われます。どのタブで登録・編集しても、同じ内容です。";
  const container = document.createElement("section");
  container.className = "bonus-wish-settings owned-weapon-settings";
  container.dataset.ownedWhere = "tab";
  panel.append(heading, description, container);

  // 一番上：所持表（ユーザーがExcelで作っていた管理表を再現。中身は renderOwnedMatrix で描く）
  const matrixPanel = document.createElement("section");
  matrixPanel.className = "panel owned-matrix-panel";
  const matrixHeading = document.createElement("div");
  matrixHeading.className = "section-heading";
  const matrixHeadingText = document.createElement("div");
  const matrixStep = document.createElement("p");
  const matrixTitle = document.createElement("h2");
  matrixStep.className = "step";
  matrixStep.textContent = "MY LIST";
  matrixTitle.textContent = "所持表";
  matrixHeadingText.append(matrixStep, matrixTitle);
  matrixHeading.append(matrixHeadingText);
  const matrixDescription = document.createElement("p");
  matrixDescription.className = "prediction-intro";
  matrixDescription.textContent = "武器種・激化ごとに、属性（行）とスキル（列）の組み合わせを持っているかを一覧にします。下で登録した手持ち武器にそのスキルがあれば自動で「◎」（小さい字はもう片方のスキル）。登録していないものは、マスを押すと「○ → × → 空」と自分で印を付けられます。";
  const matrixBody = document.createElement("div");
  matrixBody.className = "owned-matrix-body";
  matrixPanel.append(matrixHeading, matrixDescription, matrixBody);

  view.append(matrixPanel, panel);
  lastView.after(view);
  return container;
}

function readConfig() {
  const weaponType = readInteger("weapon-type", "武器種", 0, 13);
  const attributeForce = readInteger("attribute-force", "武器の属性", 0, 9);
  const counterStart = readInteger("counter-start", "内部位置の開始", 0, 0xffffffff);
  const counterEnd = readInteger("counter-end", "内部位置の終了", 0, 0xffffffff);
  const seedStart = readInteger("seed-start", "seed開始", 0, 99_999_999);
  const seedEnd = readInteger("seed-end", "seed終了", 0, 99_999_999);
  const requestedWorkers = readInteger("worker-count", "並列Worker数", 1, 16);

  if (counterStart > counterEnd) throw new Error("内部位置の開始は終了以下にしてください。");
  if (seedStart > seedEnd) throw new Error("seed開始は終了以下にしてください。");

  const observations = readObservations();
  validateGogmaObservations(weaponType, attributeForce, observations);
  const totalSeeds = seedEnd - seedStart + 1;
  return {
    weaponType,
    attributeForce,
    counterStart,
    counterEnd,
    counterGate: 35,
    seedStart,
    seedEnd,
    observations,
    workerCount: Math.min(requestedWorkers, totalSeeds),
    chunkSize: 50_000,
  };
}

function applyEstimatedCounterRange() {
  const estimate = Number(counterEstimateInput.value);
  const radius = Number(counterRadiusSelect.value);
  if (!Number.isSafeInteger(estimate) || estimate < 0 || estimate > 0xffffffff) {
    showError("推定した現在値は0〜4,294,967,295の整数で入力してください。");
    return;
  }
  if (!Number.isSafeInteger(radius) || radius < 0) return;

  counterStartInput.value = String(Math.max(0, estimate - radius));
  counterEndInput.value = String(Math.min(0xffffffff, estimate + radius));
  hideError();
  updateCounterRangeSummary();
}

function updateCounterRangeSummary() {
  const start = Number(counterStartInput.value);
  const end = Number(counterEndInput.value);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) {
    counterRangeSummary.textContent = "有効な開始・終了を入力してください。";
    counterRangeSummary.className = "counter-range-summary warning";
    return;
  }

  const candidateCount = end - start + 1;
  const suffix = candidateCount > 1001
    ? "非常に長時間かかります。端末やブラウザによっては完了が難しい場合があります。"
    : candidateCount > 501
      ? "非常に長時間かかります。可能なら推定値を見直して範囲を分割してください。"
      : candidateCount > 101
        ? "候補数が多いため長時間かかります。"
        : candidateCount > 25
          ? "端末によっては数分かかります。"
          : "狭い探索範囲です。推定値に自信がある場合に使用してください。";
  counterRangeSummary.textContent = `現在の探索範囲: ${start.toLocaleString("ja-JP")}〜${end.toLocaleString("ja-JP")}（${candidateCount.toLocaleString("ja-JP")}候補）。${suffix}`;
  counterRangeSummary.className = `counter-range-summary${candidateCount > 25 ? " warning" : ""}`;
}

function readInteger(id, label, minimum, maximum) {
  const raw = document.querySelector(`#${id}`).value.trim();
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${label}は${minimum}〜${maximum.toLocaleString("ja-JP")}の整数で入力してください。`);
  }
  return value;
}

function populateSelect(select, options, selectedValue) {
  select.replaceChildren(
    ...options.map(([value, label]) => {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = label;
      option.selected = value === selectedValue;
      return option;
    }),
  );
}

function prioritizedSkillOptions(labels, priorityIndices) {
  const priority = new Set(priorityIndices);
  return [
    ...priorityIndices.map((index) => [index, labels[index]]),
    ...labels.flatMap((label, index) => priority.has(index) ? [] : [[index, label]]),
  ];
}

function renderSkillFilterSeriesOptions(selectedIndices = new Set()) {
  skillFilterSeriesOptions.replaceChildren(
    ...prioritizedSkillOptions(SERIES_SKILLS, PRIORITY_SERIES_SKILL_INDICES).map(([index, label]) => {
      const optionLabel = document.createElement("label");
      const checkbox = document.createElement("input");
      const text = document.createElement("span");
      checkbox.type = "checkbox";
      checkbox.name = "skill-filter-series";
      checkbox.value = String(index);
      checkbox.checked = selectedIndices.has(index);
      text.textContent = label;
      text.append(skillEffectSpan(label));
      optionLabel.append(checkbox, text);
      return optionLabel;
    }),
  );
}

function loadPersistedAppState() {
  const emptyState = {
    baseSeed: null,
    bonusCounter: null,
    skillCounter: null,
    baseSource: null,
    bonusSource: null,
    skillSource: null,
  };
  const emptyArtianBaseState = {
    baseSeed: null,
    counters: {},
    sources: {},
  };
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    const candidateState = saved?.saveState ?? {};
    const baseSeed = candidateState.baseSeed === null || candidateState.baseSeed === undefined
      ? Number.NaN
      : Number(candidateState.baseSeed);
    const bonusCounter = candidateState.bonusCounter === null || candidateState.bonusCounter === undefined
      ? Number.NaN
      : Number(candidateState.bonusCounter);
    const skillCounter = candidateState.skillCounter === null || candidateState.skillCounter === undefined
      ? Number.NaN
      : Number(candidateState.skillCounter);
    const normalizedState = {
      ...emptyState,
      baseSeed: Number.isSafeInteger(baseSeed) && baseSeed >= 0 && baseSeed <= 99_999_999
        ? baseSeed
        : null,
      bonusCounter: isValidCounter(bonusCounter) ? bonusCounter : null,
      skillCounter: isValidCounter(skillCounter) ? skillCounter : null,
      baseSource: typeof candidateState.baseSource === "string" ? candidateState.baseSource : null,
      bonusSource: typeof candidateState.bonusSource === "string" ? candidateState.bonusSource : null,
      skillSource: typeof candidateState.skillSource === "string" ? candidateState.skillSource : null,
    };
    const targets = Array.isArray(saved?.targets)
      ? saved.targets
          .filter((target) =>
            Number.isSafeInteger(target?.weaponType) &&
            target.weaponType >= 0 &&
            target.weaponType <= 13 &&
            Number.isSafeInteger(target?.attributeForce) &&
            target.attributeForce >= 0 &&
            target.attributeForce <= 9,
          )
          .slice(0, MAX_REGISTERED_TARGETS)
          .map((target, index) => ({
            id: typeof target.id === "string" && target.id ? target.id : `legacy-${index}`,
            weaponType: target.weaponType,
            attributeForce: target.attributeForce,
            label: typeof target.label === "string" ? target.label.slice(0, 24) : "",
            keepCategories: normalizeKeepCategories(target.keepCategories),
            keepSource: typeof target.keepSource === "string" ? target.keepSource : null,
          }))
      : [];
    const bonusPrediction = {
      mode: saved?.bonusPrediction?.mode === "keep" ? "keep" : "reset",
    };
    // 通常アーティアの作成カウンター（元のツールと同じ形で保存）
    const savedArtianBaseState = saved?.artianBaseState ?? {};
    const artianBaseSeedValue = savedArtianBaseState.baseSeed === null ||
        savedArtianBaseState.baseSeed === undefined
      ? Number.NaN
      : Number(savedArtianBaseState.baseSeed);
    const counters = {};
    const sources = {};
    if (savedArtianBaseState.counters && typeof savedArtianBaseState.counters === "object") {
      for (const [key, rawCounter] of Object.entries(savedArtianBaseState.counters)) {
        if (!/^\d+:\d+$/.test(key)) continue;
        const counter = Number(rawCounter);
        if (!isValidCounter(counter)) continue;
        counters[key] = counter;
        if (typeof savedArtianBaseState.sources?.[key] === "string") {
          sources[key] = savedArtianBaseState.sources[key];
        }
      }
    }
    const artianBaseState = {
      ...emptyArtianBaseState,
      baseSeed: Number.isSafeInteger(artianBaseSeedValue) && artianBaseSeedValue >= 0 &&
          artianBaseSeedValue <= 99_999_999
        ? artianBaseSeedValue
        : null,
      counters,
      sources,
    };
    return { saveState: normalizedState, targets, bonusPrediction, artianBaseState };
  } catch {
    return {
      saveState: emptyState,
      targets: [],
      bonusPrediction: { mode: "reset" },
      artianBaseState: emptyArtianBaseState,
    };
  }
}

function persistAppState() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ saveState, targets: comparisonTargets, bonusPrediction, artianBaseState }),
    );
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function normalizeKeepCategories(categories) {
  if (!Array.isArray(categories) || categories.length !== 5) return [null, null, null, null, null];
  return categories.map((category) =>
    Number.isSafeInteger(category) && category >= 0 && category <= 3 ? category : null,
  );
}

function createTargetId() {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `target-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let tabEntryScrollRevision = 0;
function scrollToTabEntry(tabName, preferResults = true) {
  const revision = ++tabEntryScrollRevision;
  requestAnimationFrame(() => {
    const view = tabViews.find(view => view.dataset.tabView === tabName);
    if (revision !== tabEntryScrollRevision || !view || view.hidden) return;
    const selector = {'skill-future':'#skill-table-wrap','bonus-future':'#comparison-table-wrap','artian-future':'#artian-base-table-wrap'}[tabName];
    const results = preferResults && selector ? view.querySelector(selector) : null;
    const available = results && !results.hidden && results.querySelector('tbody tr');
    const anchor = available ? results.previousElementSibling?.classList.contains('result-toolbar') ? results.previousElementSibling : results : view.querySelector('.panel') ?? view.firstElementChild;
    if (!anchor) return;
    const tabs = document.querySelector('.app-tabs');
    const clearance = (tabs?.getBoundingClientRect().height ?? 0) + 16;
    window.scrollTo({top:Math.max(0,window.scrollY + anchor.getBoundingClientRect().top - clearance),behavior:'instant'});
  });
}

function setupTabEntryLinks() {
  for (const tabName of ['skill-future','bonus-future','artian-future']) {
    const view = tabViews.find(view=>view.dataset.tabView===tabName);
    const selector = {'skill-future':'#skill-table-wrap','bonus-future':'#comparison-table-wrap','artian-future':'#artian-base-table-wrap'}[tabName];
    const table = view?.querySelector(selector);
    const bar = table?.previousElementSibling;
    if (!bar?.classList.contains('result-toolbar')) continue;
    const settings = document.createElement('button'); settings.type='button'; settings.className='text-button tab-entry-link'; settings.textContent='条件設定へ';
    settings.addEventListener('click',()=>scrollToTabEntry(tabName,false));bar.insertBefore(settings,bar.querySelector('.result-export-status'));
    const results = document.createElement('button'); results.type='button'; results.className='secondary small-button tab-entry-link'; results.textContent='結果一覧へ';
    results.addEventListener('click',()=>scrollToTabEntry(tabName));
    view.querySelector('.panel > .section-heading')?.after(results);
  }
}

function setActiveTab(tabName, updateHash = true) {
  const previousTab = tabViews.find(view => !view.hidden)?.dataset.tabView;
  const validTab = tabViews.some((view) => view.dataset.tabView === tabName)
    ? tabName
    : "search";
  for (const button of tabButtons) {
    const active = button.dataset.tab === validTab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  for (const view of tabViews) {
    const active = view.dataset.tabView === validTab;
    view.classList.toggle("active", active);
    view.hidden = !active;
  }
  if (updateHash && location.hash !== `#${validTab}`) history.replaceState(null, "", `#${validTab}`);
  // 狙い（04）の希望が変わっていることがあるので、開くたびに書き直す
  if (validTab === "artian-owned") renderArtianOwnedTab();
  if (validTab === "artian-create") creationWorkbench?.refresh(true);
  if (updateHash && previousTab !== validTab) scrollToTabEntry(validTab);
}

function syncRuntimeFromSaveState() {
  selectedCandidate = saveState.baseSeed !== null && saveState.bonusCounter !== null
    ? { seed: saveState.baseSeed, counter: saveState.bonusCounter }
    : null;
  selectedSkillCounter = saveState.baseSeed !== null ? saveState.skillCounter : null;
  if (selectedCandidate && !lastSearchConfig) {
    lastSearchConfig = {
      weaponType: Number(weaponSelect.value),
      attributeForce: Number(attributeSelect.value),
      counterGate: 35,
      observations: [],
    };
  }
}

function stateSourceText(source, fallback) {
  return source ? `${source}から設定` : fallback;
}

function renderSaveState() {
  const knownCount = [saveState.baseSeed, saveState.bonusCounter, saveState.skillCounter]
    .filter((value) => value !== null).length;
  stateBaseSeed.textContent = saveState.baseSeed === null
    ? "未特定"
    : saveState.baseSeed.toLocaleString("ja-JP");
  stateBonusCounter.textContent = saveState.bonusCounter === null
    ? "未特定"
    : saveState.bonusCounter.toLocaleString("ja-JP");
  stateSkillCounter.textContent = saveState.skillCounter === null
    ? "未特定"
    : saveState.skillCounter.toLocaleString("ja-JP");
  stateBaseSeedStatus.textContent = stateSourceText(saveState.baseSource, "検索または手入力が必要");
  stateBonusCounterStatus.textContent = stateSourceText(saveState.bonusSource, "検索または手入力が必要");
  stateSkillCounterStatus.textContent = stateSourceText(saveState.skillSource, "スキル結果から特定");
  saveStateSummary.textContent = knownCount === 3 ? "3値を特定済み" : `${knownCount}/3 特定済み`;
  saveStateSummary.className = `status-pill${knownCount === 3 ? " complete" : ""}`;
  manualStateBaseSeedInput.value = saveState.baseSeed ?? "";
  manualStateBonusCounterInput.value = saveState.bonusCounter ?? "";
  manualStateSkillCounterInput.value = saveState.skillCounter ?? "";
  skillSearchBaseSeed.textContent = saveState.baseSeed === null
    ? "未特定"
    : saveState.baseSeed.toLocaleString("ja-JP");

  bonusStateBaseSeedInput.value = saveState.baseSeed ?? "";
  bonusStateCounterInput.value = saveState.bonusCounter ?? "";
  bonusStateSkillCounterInput.value = saveState.skillCounter ?? t("未特定");
  skillStateBaseSeedInput.value = saveState.baseSeed ?? "";
  skillStateCounterInput.value = saveState.skillCounter ?? "";
  skillStateBonusCounterInput.value = saveState.bonusCounter ?? t("未特定");
  predictionSeed.textContent = saveState.baseSeed === null
    ? "—"
    : saveState.baseSeed.toLocaleString("ja-JP");

  const stateCode = currentStateCode();
  if (stateCode) continuationCodeInput.value = stateCode;
  syncRuntimeFromSaveState();
  syncArtianBaseSeed();
  renderArtianBaseState();
  updateComparisonStatus();
  resetSkillSearchFeedback();
  persistAppState();
}

function renderBonusOperation() {
  const keepMode = bonusPrediction.mode === "keep";
  bonusOperationReset.checked = !keepMode;
  bonusOperationKeep.checked = keepMode;
  keepLayoutPanel.hidden = !keepMode;
  detailPredictionSection.hidden = keepMode;
  bonusFutureKicker.textContent = "BONUS FUTURE";
  // 「ゲーム内で行う再復元」の2つのボタンは、手持ち武器の登録欄の開け閉めに使う。
  // 予測のしかたは切り替えない（表には狙い＝リセットと手持ち＝同じ構成の両方が出る）
  keepLayoutPanel.hidden = true;
  const ownedOpen = loadBonusView().registration === "owned";
  bonusOperationReset.checked = !ownedOpen;
  bonusOperationKeep.checked = ownedOpen;
  if (ownedWeaponSection) ownedWeaponSection.style.display = ownedOpen ? "" : "none";
  renderKeepLayoutInputs();
  updateComparisonStatus();
}

function renderKeepLayoutInputs() {
  keepLayoutError.hidden = true;
  if (comparisonTargets.length === 0) {
    const empty = document.createElement("p");
    empty.className = "prediction-empty";
    empty.textContent = "先にEX厳選する武器を登録してください。";
    keepLayoutInputs.replaceChildren(empty);
    keepLayoutSource.textContent = "武器登録待ち";
    keepLayoutSource.className = "status-pill";
    return;
  }

  let readyCount = 0;
  let incompleteCount = 0;
  const cards = comparisonTargets.map((target) => {
    const card = document.createElement("section");
    const heading = document.createElement("div");
    const name = document.createElement("strong");
    const source = document.createElement("span");
    const slots = document.createElement("div");
    const categories = normalizeKeepCategories(target.keepCategories);
    const problem = keepLayoutProblem(target);
    const hasUnselectedSlot = categories.some((category) => category === null);
    target.keepCategories = categories;
    card.className = `keep-layout-card${problem ? " incomplete" : ""}`;
    heading.className = "keep-layout-card-heading";
    slots.className = "keep-layout-slots";
    name.textContent = comparisonTargetName(target);
    if (hasUnselectedSlot) {
      incompleteCount += 1;
      source.textContent = "5枠すべて選択してください";
      source.className = "keep-layout-warning";
    } else if (problem) {
      source.textContent = problem;
      source.className = "keep-layout-warning";
    } else {
      source.textContent = target.keepSource ? `${target.keepSource}から設定` : "現在構成を入力";
    }
    heading.append(name, source);

    const options = keepCategoriesForWeapon(target.weaponType, target.attributeForce);
    for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
      const label = document.createElement("label");
      const text = document.createElement("span");
      const select = document.createElement("select");
      const placeholder = document.createElement("option");
      text.textContent = `${slotIndex + 1}枠目`;
      placeholder.value = "";
      placeholder.textContent = "系統を選択";
      placeholder.selected = categories[slotIndex] === null;
      select.append(placeholder);
      select.classList.toggle("unselected", categories[slotIndex] === null);
      select.setAttribute("aria-invalid", String(categories[slotIndex] === null));
      for (const [category, categoryName] of options) {
        const option = document.createElement("option");
        option.value = String(category);
        option.textContent = categoryName;
        option.selected = categories[slotIndex] === category;
        select.append(option);
      }
      select.addEventListener("change", () => {
        target.keepCategories[slotIndex] = select.value === "" ? null : Number(select.value);
        target.keepSource = "手入力";
        persistAppState();
        renderKeepLayoutInputs();
        void Promise.all([refreshPredictions(), refreshComparisonPredictions()]);
      });
      label.append(text, select);
      slots.append(label);
    }
    if (problem === null) readyCount += 1;
    card.append(heading, slots);
    return card;
  });
  keepLayoutInputs.replaceChildren(...cards);
  keepLayoutSource.textContent = `${readyCount}/${comparisonTargets.length} 構成入力済み`;
  keepLayoutSource.className = `status-pill${readyCount === comparisonTargets.length ? " complete" : ""}`;
  if (incompleteCount > 0) {
    keepLayoutError.textContent = `${incompleteCount}件の武器に未選択の枠があります。各武器の5枠をすべて選択してください。`;
    keepLayoutError.hidden = false;
  }
}

function keepCategoriesForWeapon(weaponType, attributeForce) {
  if (weaponType === BOW_WEAPON_TYPE) {
    return GOGMA_BONUS_CATEGORIES.filter(
      ([category]) => category !== 3 && !(attributeForce === 0 && category === 2),
    );
  }
  if (BOWGUN_WEAPON_TYPES.has(weaponType)) {
    return GOGMA_BONUS_CATEGORIES
      .filter(([category]) => category !== 2)
      .map(([category, name]) => [category, category === 3 ? "装填数" : name]);
  }
  return GOGMA_BONUS_CATEGORIES
    .filter(([category]) => !(attributeForce === 0 && category === 2))
    .map(([category, name]) => [category, category === 3 ? "斬れ味" : name]);
}

function keepLayoutProblem(target) {
  const categories = normalizeKeepCategories(target.keepCategories);
  if (categories.some((category) => category === null)) return "5枠の現在構成を入力してください。";
  if (target.weaponType === BOW_WEAPON_TYPE && categories.includes(3)) {
    return "弓には斬れ味・装填系を設定できません。";
  }
  if (BOWGUN_WEAPON_TYPES.has(target.weaponType) && categories.includes(2)) {
    return "ボウガンには属性系を設定できません。";
  }
  if (target.attributeForce === 0 && categories.includes(2)) {
    return "無属性武器には属性系を設定できません。";
  }
  const count = (category) => categories.filter((value) => value === category).length;
  if (count(2) > 4) return "属性系は合計4枠までです。";
  if (count(3) > 2) return "斬れ味・装填系は合計2枠までです。";
  return null;
}

function requireTargetKeepCategories(target) {
  const problem = keepLayoutProblem(target);
  if (problem) throw new Error(`${comparisonTargetName(target)}: ${t(problem)}`);
  return target.keepCategories;
}

function currentStateCode() {
  if (saveState.baseSeed === null || saveState.bonusCounter === null) return null;
  return formatStateContinuationCode(
    saveState.baseSeed,
    saveState.bonusCounter,
    saveState.skillCounter,
  );
}

function setStateFromBonus(baseSeed, bonusCounter, source, clearSkill = false) {
  const baseChanged = saveState.baseSeed !== null && saveState.baseSeed !== baseSeed;
  saveState = {
    ...saveState,
    baseSeed,
    bonusCounter,
    skillCounter: baseChanged || clearSkill ? null : saveState.skillCounter,
    baseSource: source,
    bonusSource: source,
    skillSource: baseChanged || clearSkill ? null : saveState.skillSource,
  };
  renderSaveState();
}

function setStateFromSkill(baseSeed, skillCounter, source) {
  const baseChanged = saveState.baseSeed !== null && saveState.baseSeed !== baseSeed;
  saveState = {
    ...saveState,
    baseSeed,
    bonusCounter: baseChanged ? null : saveState.bonusCounter,
    skillCounter,
    baseSource: source,
    bonusSource: baseChanged ? null : saveState.bonusSource,
    skillSource: source,
  };
  renderSaveState();
}

function readStateNumber(input, label, maximum) {
  const value = Number(input.value.trim());
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(`${label}は0〜${maximum.toLocaleString("ja-JP")}の整数で入力してください。`);
  }
  return value;
}

function readOptionalStateNumber(input, label, maximum) {
  if (input.value.trim() === "") return null;
  return readStateNumber(input, label, maximum);
}

function applyManualSaveState() {
  return runCounterSetting('基準seedとカウンターを手入力の値に変更しますか？',model=>{
    const baseSeed=readStateNumber(manualStateBaseSeedInput,'基準seed',99999999);
    const bonusCounter=readOptionalStateNumber(manualStateBonusCounterInput,'復元ボーナスカウンター',0xffffffff);
    const skillCounter=readOptionalStateNumber(manualStateSkillCounterInput,'スキルカウンター',0xffffffff);
    model.saveState={baseSeed,bonusCounter,skillCounter,baseSource:'手入力',bonusSource:bonusCounter===null?null:'手入力',skillSource:skillCounter===null?null:'手入力'};
  });
}

function applyBonusPredictionState() {
  return runCounterSetting('この値を復元予測の0地点に設定しますか？',model=>{
    const baseSeed=readStateNumber(bonusStateBaseSeedInput,'基準seed',99999999);
    const bonusCounter=readStateNumber(bonusStateCounterInput,'復元ボーナスカウンター',0xffffffff);
    const changed=model.saveState.baseSeed!==null&&model.saveState.baseSeed!==baseSeed;
    model.saveState={...model.saveState,baseSeed,bonusCounter,skillCounter:changed?null:model.saveState.skillCounter,baseSource:'手入力',bonusSource:'手入力',skillSource:changed?null:model.saveState.skillSource};
  },{tab:'bonus-future'});
}

function applySkillPredictionState() {
  return runCounterSetting('この値をスキル予測の0地点に設定しますか？',model=>{
    const baseSeed=readStateNumber(skillStateBaseSeedInput,'基準seed',99999999);
    const skillCounter=readStateNumber(skillStateCounterInput,'スキルカウンター',0xffffffff);
    const changed=model.saveState.baseSeed!==null&&model.saveState.baseSeed!==baseSeed;
    model.saveState={...model.saveState,baseSeed,skillCounter,bonusCounter:changed?null:model.saveState.bonusCounter,baseSource:'手入力',skillSource:'手入力',bonusSource:changed?null:model.saveState.bonusSource};
  },{tab:'skill-future'});
}

function formatGogmaContinuationCode(candidate, completedRolls) {
  const nextGogmaCounter = candidate.counter + completedRolls;
  if (!isValidCounter(nextGogmaCounter)) {
    throw new Error("保存後の内部位置が対応範囲を超えました。");
  }
  return formatStateContinuationCode(candidate.seed, nextGogmaCounter, saveState.skillCounter);
}

function formatSkillContinuationCode(completedRolls) {
  if (saveState.baseSeed === null || saveState.skillCounter === null) {
    throw new Error("基準seedまたはスキルカウンターが特定されていません。");
  }
  if (saveState.bonusCounter === null) return null;
  const nextSkillCounter = saveState.skillCounter + completedRolls;
  if (!isValidCounter(nextSkillCounter)) {
    throw new Error("保存後のスキルカウンターが対応範囲を超えました。");
  }
  return formatStateContinuationCode(
    saveState.baseSeed,
    saveState.bonusCounter,
    nextSkillCounter,
  );
}

function formatStateContinuationCode(seed, gogmaCounter, skillCounter = null) {
  if (skillCounter === null) return `GSF1-${seed}-${gogmaCounter}`;
  return `GSF2-B${seed}-G${gogmaCounter}-S${skillCounter}`;
}

function isValidCounter(value) {
  return Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
}

function parseContinuationCode(rawCode) {
  const code = rawCode.trim();
  const fullMatch = code.match(/^GSF2-B(\d{1,8})-G(\d{1,10})-S(\d{1,10})$/i);
  const bonusOnlyMatch = code.match(/^GSF1-(\d{1,8})-(\d{1,10})$/i);
  if (!fullMatch && !bonusOnlyMatch) {
    throw new Error(
      "セーブ状態コードは GSF2-B基準seed-G復元カウンター-Sスキルカウンター、またはGSF1形式で入力してください。",
    );
  }

  const match = fullMatch ?? bonusOnlyMatch;
  const seed = Number(match[1]);
  const gogmaCounter = Number(match[2]);
  const skillCounter = fullMatch ? Number(match[3]) : null;
  if (!Number.isSafeInteger(seed) || seed < 0 || seed > 99_999_999) {
    throw new Error("状態コード内の基準seedが範囲外です。");
  }
  if (!isValidCounter(gogmaCounter)) {
    throw new Error("状態コード内の復元ボーナスカウンターが範囲外です。");
  }
  if (skillCounter !== null && !isValidCounter(skillCounter)) {
    throw new Error("状態コード内のスキルカウンターが範囲外です。");
  }
  return { seed, counter: gogmaCounter, skillCounter };
}

async function openContinuationCode() {
  hideContinuationError();
  continuationMessage.textContent = "";

  try {
    const parsedState = parseContinuationCode(continuationCodeInput.value);
    const candidate = { seed: parsedState.seed, counter: parsedState.counter };
    stopWorkers();
    resetResults();
    lastSearchConfig = {
      weaponType: Number(weaponSelect.value),
      attributeForce: Number(attributeSelect.value),
      counterGate: 35,
      observations: [],
    };
    saveState = {
      baseSeed: parsedState.seed,
      bonusCounter: parsedState.counter,
      skillCounter: parsedState.skillCounter,
      baseSource: "状態コード",
      bonusSource: "状態コード",
      skillSource: parsedState.skillCounter === null ? null : "状態コード",
    };
    renderSaveState();
    foundCandidates.set(candidateKey(candidate), candidate);
    statusText.textContent = "状態コード読込";
    statusText.className = "status-pill complete";
    renderCandidates();
    if (comparisonTargets.length === 0) {
      comparisonTargets.push({
        id: createTargetId(),
        weaponType: Number(weaponSelect.value),
        attributeForce: Number(attributeSelect.value),
        label: "",
        keepCategories: [null, null, null, null, null],
        keepSource: null,
      });
    }
    renderComparisonTargets();
    renderPredictionFilters();
    predictionPanel.hidden = false;
    await Promise.all([
      refreshPredictions(),
      refreshComparisonPredictions(),
      parsedState.skillCounter === null ? Promise.resolve() : refreshSkillPredictions(),
    ]);
    continuationMessage.textContent = parsedState.skillCounter === null
      ? "状態を読み込みました。基準seedと復元ボーナスカウンターを引き継いでいます。"
      : "状態を読み込みました。基準seedと2つのカウンターを引き継いでいます。";
    setActiveTab("bonus-future");
  } catch (error) {
    showContinuationError(error instanceof Error ? error.message : String(error));
  }
}

async function useContinuationCode(code) {
  if (!code) return;
  continuationCodeInput.value = code;
  hideContinuationError();
  continuationMessage.textContent = `セーブ状態コードを入力欄へコピーしました: ${code}`;
  try {
    await navigator.clipboard.writeText(code);
    continuationMessage.textContent = `セーブ状態コードをクリップボードへコピーしました: ${code}`;
  } catch {
    // Clipboard permission is not available in every browser context. The input is still populated.
  }
}

function showContinuationError(message) {
  continuationError.textContent = message;
  continuationError.hidden = false;
}

function hideContinuationError() {
  continuationError.textContent = "";
  continuationError.hidden = true;
}

function renderObservationRows(rolls) {
  observationRows.replaceChildren(...rolls.map((roll) => createObservationRow(roll)));
  renumberObservationRows();
}

function renderSkillObservationRows(rolls) {
  skillObservationRows.replaceChildren(
    ...rolls.map((roll) => createSkillObservationRow(roll)),
  );
  renumberSkillObservationRows();
}

function createSkillObservationRow(value = null) {
  const row = document.createElement("div");
  row.className = "skill-observation-row";

  const rollNumber = document.createElement("span");
  rollNumber.className = "roll-number";
  row.append(rollNumber);

  row.append(
    createIndexedSkillSelect("series", SERIES_SKILLS, value?.seriesIndex ?? null),
    createIndexedSkillSelect("group", GROUP_SKILLS, value?.groupIndex ?? null),
  );
  return row;
}

function createIndexedSkillSelect(kind, skills, selectedIndex) {
  const label = document.createElement("label");
  const accessibleLabel = document.createElement("span");
  const select = document.createElement("select");
  const placeholder = document.createElement("option");

  accessibleLabel.className = `sr-only ${kind}-skill-label`;
  select.dataset.skillKind = kind;
  placeholder.value = "";
  placeholder.textContent = kind === "series" ? "シリーズを選択" : "グループを選択";
  placeholder.disabled = true;
  placeholder.selected = selectedIndex === null;
  select.append(placeholder);

  skills.forEach((skill, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = skill;
    option.selected = selectedIndex === index;
    select.append(option);
  });

  label.append(accessibleLabel, select);
  return label;
}

function renumberSkillObservationRows() {
  const rows = [...skillObservationRows.querySelectorAll(".skill-observation-row")];
  rows.forEach((row, rollIndex) => {
    row.querySelector(".roll-number").textContent = `再付与 ${rollIndex + 1}`;
    row.querySelector(".series-skill-label").textContent =
      `再付与${rollIndex + 1}のシリーズスキル`;
    row.querySelector(".group-skill-label").textContent =
      `再付与${rollIndex + 1}のグループスキル`;
  });
  removeSkillObservationButton.disabled = rows.length <= 1;
}

function readSkillObservations() {
  const rows = [...skillObservationRows.querySelectorAll(".skill-observation-row")];
  if (rows.length === 0) throw new Error("スキル再付与結果を1回以上入力してください。");

  return rows.map((row, rollIndex) => {
    const seriesSelect = row.querySelector('[data-skill-kind="series"]');
    const groupSelect = row.querySelector('[data-skill-kind="group"]');
    if (seriesSelect.value === "" || groupSelect.value === "") {
      throw new Error(`再付与${rollIndex + 1}のシリーズとグループを選択してください。`);
    }
    return Number(seriesSelect.value) * GROUP_SKILLS.length + Number(groupSelect.value);
  });
}

function availableGogmaBonuses() {
  return gogmaBonusesForWeapon(Number(weaponSelect.value), Number(attributeSelect.value));
}

function gogmaBonusesForWeapon(weaponType, attributeForce = null) {
  if (weaponType === BOW_WEAPON_TYPE) {
    return GOGMA_BONUSES.filter(
      ([id]) => !SHARPNESS_AMMO_BONUS_IDS.has(id)
        && !(attributeForce === 0 && ELEMENT_BONUS_IDS.has(id)),
    );
  }
  if (BOWGUN_WEAPON_TYPES.has(weaponType)) {
    return GOGMA_BONUSES.filter(([id]) => !ELEMENT_BONUS_IDS.has(id)).map(([id, name]) => {
      if (id === 6) return [id, "装填数強化 +1"];
      if (id === 10) return [id, "装填強化ＥＸ"];
      return [id, name];
    });
  }
  return attributeForce === 0
    ? GOGMA_BONUSES.filter(([id]) => !ELEMENT_BONUS_IDS.has(id))
    : GOGMA_BONUSES;
}

function gogmaBonusName(weaponType, bonusId) {
  return gogmaBonusesForWeapon(weaponType).find(([id]) => id === bonusId)?.[1] ?? `ID ${bonusId}`;
}

function compactGogmaBonusName(weaponType, bonusId) {
  const sharpnessAmmoPrefix = BOWGUN_WEAPON_TYPES.has(weaponType) ? "装" : "斬";
  const labels = new Map([
    [6, `${sharpnessAmmoPrefix}I`],
    [8, "攻II"],
    [9, "会II"],
    [10, `${sharpnessAmmoPrefix}EX`],
    [11, "属II"],
    [12, "攻III"],
    [13, "会III"],
    [14, "属EX"],
    [15, "攻EX"],
    [16, "会EX"],
  ]);
  return labels.get(bonusId) ?? `ID ${bonusId}`;
}

function updateBonusPoolNote() {
  const weaponType = Number(weaponSelect.value);
  const attributeForce = Number(attributeSelect.value);
  if (weaponType === BOW_WEAPON_TYPE) {
    bonusPoolNote.textContent = attributeForce === 0
      ? "無属性の弓は攻撃・会心の6候補です。属性強化と斬れ味・装填系は抽選されません。"
      : "弓は攻撃・会心・属性の8候補です。斬れ味・装填系は抽選されません。";
    return;
  }
  if (BOWGUN_WEAPON_TYPES.has(weaponType)) {
    bonusPoolNote.textContent =
      "ボウガンは攻撃・会心・装填の8候補です。属性強化は抽選されず、装填系は合計2枠までです。";
    return;
  }
  bonusPoolNote.textContent = attributeForce === 0
    ? "無属性の近接武器は攻撃・会心・斬れ味の8候補です。属性強化は抽選されません。"
    : "近接武器は攻撃・会心・属性・斬れ味の10候補です。";
}

function updatePredictionPoolNote() {
  const weaponType = Number(predictionWeaponSelect.value);
  const attributeForce = Number(predictionAttributeSelect.value);
  if (bonusPrediction.mode === "keep") {
    predictionPoolNote.textContent =
      "「ボーナスを同じ構成で再復元」は、登録武器ごとの5枠系統を維持したままII・III・EX等だけを再抽選します。";
    return;
  }
  if (weaponType === BOW_WEAPON_TYPE) {
    predictionPoolNote.textContent = attributeForce === 0
      ? "無属性の弓は攻撃・会心の6候補で計算します。属性強化と斬れ味・装填系は出ません。"
      : "弓の未来は攻撃・会心・属性の8候補で計算します。斬れ味・装填系は出ません。";
    return;
  }
  if (BOWGUN_WEAPON_TYPES.has(weaponType)) {
    predictionPoolNote.textContent =
      "ボウガンの未来は攻撃・会心・装填の8候補で計算します。属性強化は出ません。";
    return;
  }
  predictionPoolNote.textContent = attributeForce === 0
    ? "無属性の近接武器は攻撃・会心・斬れ味の8候補で計算します。属性強化は出ません。"
    : "近接武器の未来は攻撃・会心・属性・斬れ味の10候補で計算します。";
}

function snapshotObservationValues() {
  return [...observationRows.querySelectorAll(".observation-row")].map((row) =>
    [...row.querySelectorAll("select")].map((select) =>
      select.value === "" ? null : Number(select.value),
    ),
  );
}

function createObservationRow(values = null) {
  const row = document.createElement("div");
  row.className = "observation-row";

  const rollNumber = document.createElement("span");
  rollNumber.className = "roll-number";
  row.append(rollNumber);

  for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
    const label = document.createElement("label");
    const accessibleLabel = document.createElement("span");
    accessibleLabel.className = "sr-only slot-label";
    const select = document.createElement("select");
    select.required = true;

    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "選択してください";
    placeholder.disabled = true;
    const bonuses = availableGogmaBonuses();
    const selectedId = values?.[slotIndex] ?? null;
    const selectedIdIsAvailable = bonuses.some(([id]) => id === selectedId);
    placeholder.selected = selectedId === null || !selectedIdIsAvailable;
    select.append(placeholder);

    for (const [id, name] of bonuses) {
      const option = document.createElement("option");
      option.value = String(id);
      option.textContent = name;
      option.selected = selectedId === id;
      select.append(option);
    }

    label.append(accessibleLabel, select);
    row.append(label);
  }
  enhanceObservationRowWithCards(row);
  return row;
}

// プルダウンの代わりにカードで入力する。カードを押すと選択中の枠に入り、次の空き枠へ進む。
// 値は隠したプルダウンに入れるので、検索側の読み取りはそのまま。
function enhanceObservationRowWithCards(row) {
  row.classList.add("card-input");
  const selects = [...row.querySelectorAll("select")];
  // 隠したプルダウンが未入力だとブラウザが送信を黙って止めるので、未入力チェックは検索側に任せる
  selects.forEach((select) => { select.required = false; });
  const picker = createBonusCardPicker({
    weaponType: Number(weaponSelect.value),
    options: availableGogmaBonuses(),
    values: selects.map((select) => select.value === "" ? null : Number(select.value)),
    clearText: "この回をクリア",
    onChange: (index, bonusId) => {
      selects[index].value = bonusId === null ? "" : String(bonusId);
      selects[index].dispatchEvent(new Event("change", { bubbles: true }));
    },
  });
  row.append(picker.element);
}

// 5枠のボーナスをカードで選ぶ部品（左：1〜5枠目、右：系統ごとのカード）。
// seed検索の結果入力と、手持ち武器の登録で使う
// 通常アーティアはボーナスの番号の付け方が違うので、系統・名前・EXかどうかの決め方を差し替えられる
function createBonusCardPicker({
  weaponType, options, values, onChange, clearText = "5枠をクリア",
  classOf = bonusClassName,
  nameOf = (bonusId) => gogmaBonusName(weaponType, bonusId),
  isEx = (bonusId) => EX_BONUS_IDS.has(bonusId),
}) {
  const current = Array.from({ length: 5 }, (_, index) => values?.[index] ?? null);
  const firstEmpty = current.findIndex((value) => value === null);
  let active = firstEmpty === -1 ? 0 : firstEmpty;

  const body = document.createElement("div");
  body.className = "observation-card-body";
  const chips = document.createElement("div");
  chips.className = "observation-chips";
  const palette = document.createElement("div");
  palette.className = "observation-palette";

  const setValue = (index, bonusId) => {
    current[index] = bonusId;
    onChange?.(index, bonusId, [...current]);
  };

  const render = () => {
    chips.replaceChildren(...current.map((bonusId, index) => {
      const chip = document.createElement("button");
      const slotName = document.createElement("span");
      const value = document.createElement("span");
      chip.type = "button";
      chip.className = "observation-chip";
      slotName.className = "observation-chip-slot";
      slotName.textContent = `${index + 1}枠目`;
      value.className = "observation-chip-value";
      if (bonusId === null) {
        chip.classList.add("empty");
        value.textContent = "未選択";
      } else {
        value.classList.add("bonus-tag", classOf(bonusId));
        if (isEx(bonusId)) value.classList.add("ex");
        value.textContent = nameOf(bonusId);
      }
      chip.append(slotName, value);
      if (index === active) {
        const marker = document.createElement("span");
        marker.className = "observation-chip-marker";
        marker.textContent = "◀ 入力中";
        chip.append(marker);
      }
      chip.classList.toggle("active", index === active);
      chip.title = `${index + 1}枠目（押すとこの枠を選び直せます）`;
      chip.addEventListener("click", () => {
        active = index;
        render();
      });
      return chip;
    }));
    // 選んでいる枠に入っているボーナスのカードを、チェック付きの金枠にする
    const activeValue = current[active] === null ? "" : String(current[active]);
    cards.forEach((card) => card.classList.toggle("selected", card.dataset.bonusId === activeValue));
  };

  const cards = [];
  // 系統ごとの列（見出し＋段階のカードを縦に並べる）
  const categoryColumns = new Map();
  const categoryLabel = (className) => ({
    attack: "攻撃",
    affinity: "会心",
    element: "属性",
    "sharpness-ammo": BOWGUN_WEAPON_TYPES.has(weaponType) ? "装填" : "斬れ味",
  })[className];
  const columnFor = (className) => {
    if (!categoryColumns.has(className)) {
      const column = document.createElement("div");
      const heading = document.createElement("div");
      column.className = `observation-category ${className}`;
      heading.className = "observation-category-heading";
      heading.textContent = categoryLabel(className);
      column.append(heading);
      categoryColumns.set(className, column);
      palette.append(column);
    }
    return categoryColumns.get(className);
  };
  for (const [bonusId, name] of options) {
    const card = document.createElement("button");
    const mark = document.createElement("span");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    const sub = document.createElement("span");
    card.type = "button";
    card.className = `observation-card ${classOf(bonusId)}${isEx(bonusId) ? " ex" : ""}`;
    card.dataset.bonusId = String(bonusId);
    mark.className = "observation-card-mark";
    title.textContent = name;
    sub.className = "observation-card-sub";
    sub.textContent = isEx(bonusId) ? `${categoryLabel(classOf(bonusId))}系・EX` : `${categoryLabel(classOf(bonusId))}系`;
    text.append(title, sub);
    card.append(mark, text);
    cards.push(card);
    columnFor(classOf(bonusId)).append(card);
    card.addEventListener("click", () => {
      setValue(active, bonusId);
      const nextEmpty = current.findIndex((value, index) => index > active && value === null);
      if (nextEmpty !== -1) active = nextEmpty;
      else if (active < 4) active += 1;
      render();
    });
  }

  const clearButton = document.createElement("button");
  clearButton.type = "button";
  clearButton.className = "text-button observation-clear";
  clearButton.textContent = clearText;
  clearButton.addEventListener("click", () => {
    current.forEach((_, index) => setValue(index, null));
    active = 0;
    render();
  });
  palette.style.setProperty("--category-count", String(categoryColumns.size));

  const slotColumn = document.createElement("div");
  slotColumn.className = "observation-slot-column";
  const slotHint = document.createElement("p");
  slotHint.className = "observation-slot-hint";
  slotHint.textContent = "枠を押して選び、右のカードで入力";
  slotColumn.append(slotHint, chips, clearButton);
  body.append(slotColumn, palette);
  render();
  return { element: body, getValues: () => [...current] };
}

function renumberObservationRows() {
  const rows = [...observationRows.querySelectorAll(".observation-row")];
  rows.forEach((row, rollIndex) => {
    row.querySelector(".roll-number").textContent = row.classList.contains("card-input")
      ? `${rollIndex + 1}回目の再復元`
      : `抽選 ${rollIndex + 1}`;
    row.querySelectorAll(".slot-label").forEach((label, slotIndex) => {
      label.textContent = `${slotIndex + 1}枠目`;
      label.parentElement.querySelector("select").setAttribute(
        "aria-label",
        t(`抽選${rollIndex + 1}の${slotIndex + 1}枠目`),
      );
    });
  });
  removeObservationButton.disabled = rows.length <= 1;
}

function readObservations() {
  const rows = [...observationRows.querySelectorAll(".observation-row")];
  if (rows.length === 0) throw new Error("抽選結果を1回以上入力してください。");

  return rows.flatMap((row, rollIndex) =>
    [...row.querySelectorAll("select")].map((select, slotIndex) => {
      if (select.value === "") {
        throw new Error(`抽選${rollIndex + 1}の${slotIndex + 1}枠目を選択してください。`);
      }
      return Number(select.value);
    }),
  );
}

function validateGogmaObservations(weaponType, attributeForce, observations) {
  const availableIds = new Set(
    gogmaBonusesForWeapon(weaponType, attributeForce).map(([id]) => id),
  );

  for (let offset = 0; offset < observations.length; offset += 5) {
    const rollIndex = offset / 5;
    const roll = observations.slice(offset, offset + 5);
    const exactCounts = new Map();

    for (const [slotIndex, bonusId] of roll.entries()) {
      if (!availableIds.has(bonusId)) {
        const bonusName = GOGMA_BONUSES.find(([id]) => id === bonusId)?.[1] ?? `ID ${bonusId}`;
        throw new Error(
          `抽選${rollIndex + 1}の${slotIndex + 1}枠目「${bonusName}」は、選択した武器種・属性では抽選されません。武器種・属性と入力内容を確認してください。`,
        );
      }
      exactCounts.set(bonusId, (exactCounts.get(bonusId) ?? 0) + 1);
    }

    for (const [bonusId, count] of exactCounts) {
      if (count > 2) {
        throw new Error(
          `抽選${rollIndex + 1}の「${gogmaBonusName(weaponType, bonusId)}」が${count}枠あります。同一ボーナスは最大2枠です。入力内容を確認してください。`,
        );
      }
    }

    const sharpnessAmmoCount = roll.filter((bonusId) =>
      SHARPNESS_AMMO_BONUS_IDS.has(bonusId)
    ).length;
    if (sharpnessAmmoCount > 2) {
      const categoryName = BOWGUN_WEAPON_TYPES.has(weaponType) ? "装填系" : "斬れ味系";
      throw new Error(
        `抽選${rollIndex + 1}の${categoryName}ボーナスが${sharpnessAmmoCount}枠あります。${categoryName}は合計2枠までです。入力内容を確認してください。`,
      );
    }
  }
}

function beginSearch(config) {
  stopWorkers();
  hideError();
  resetResults();
  lastSearchConfig = config;
  cancelled = false;
  startedAt = performance.now();
  completedWorkers = 0;
  workerProgress = Array(config.workerCount).fill(null).map(() => ({ checked: 0, total: 0 }));

  setRunning(true);
  statusText.textContent = "探索中";
  statusText.className = "status-pill running";
  emptyResult.textContent = "候補を探索しています…";
  elapsedTimer = window.setInterval(updateElapsed, 100);

  const totalSeeds = config.seedEnd - config.seedStart + 1;
  const baseSize = Math.floor(totalSeeds / config.workerCount);
  const remainder = totalSeeds % config.workerCount;
  let cursor = config.seedStart;

  for (let workerId = 0; workerId < config.workerCount; workerId += 1) {
    const partitionSize = baseSize + (workerId < remainder ? 1 : 0);
    const partitionStart = cursor;
    const partitionEnd = cursor + partitionSize - 1;
    cursor = partitionEnd + 1;

    const worker = new Worker(new URL("./search-worker.js", import.meta.url), { type: "module" });
    worker.addEventListener("message", handleWorkerMessage);
    worker.addEventListener("error", (event) => finishWithError(event.message));
    activeWorkers.push(worker);
    worker.postMessage({
      type: "start",
      workerId,
      config: {
        ...config,
        seedStart: partitionStart,
        seedEnd: partitionEnd,
      },
    });
  }
}

function handleWorkerMessage({ data }) {
  if (cancelled) return;
  if (data.type === "progress") {
    workerProgress[data.workerId] = { checked: data.checked, total: data.total };
    recordCandidates(data.pairs);
    updateProgress();
    return;
  }
  if (data.type === "error") {
    finishWithError(data.message);
    return;
  }
  if (data.type === "done") {
    completedWorkers += 1;
    if (completedWorkers === activeWorkers.length) finishComplete();
  }
}

function recordCandidates(flatPairs) {
  for (let index = 0; index < flatPairs.length; index += 2) {
    const seed = flatPairs[index];
    const counter = flatPairs[index + 1];
    foundCandidates.set(`${seed}:${counter}`, { seed, counter });
  }
  renderCandidates();
}

function renderCandidates() {
  const candidates = [...foundCandidates.values()].sort(
    (left, right) => left.seed - right.seed || left.counter - right.counter,
  );
  candidateValue.textContent = candidates.length.toLocaleString("ja-JP");
  candidateList.replaceChildren(
    ...candidates.map((candidate, index) => {
      const { seed, counter } = candidate;
      const item = document.createElement("li");
      const button = document.createElement("button");
      const selected = candidateKey(candidate) === candidateKey(selectedCandidate);
      button.type = "button";
      button.className = "candidate-button";
      button.setAttribute("aria-pressed", String(selected));
      button.innerHTML = `<div><span>セーブ状態</span><strong>候補 ${index + 1}</strong></div><div><span>基準seed</span><strong>${seed.toLocaleString("ja-JP")}</strong></div><div><span>復元ボーナスカウンター</span><strong>${counter.toLocaleString("ja-JP")}</strong></div><span class="candidate-action">${selected ? "現在の状態" : "この状態を使用"}</span>`;
      button.addEventListener("click", () => void selectCandidate(candidate));
      item.classList.toggle("selected", selected);
      item.append(button);
      return item;
    }),
  );
  emptyResult.hidden = candidates.length > 0;
}

function candidateKey(candidate) {
  return candidate ? `${candidate.seed}:${candidate.counter}` : "";
}

function updateProgress() {
  const checked = workerProgress.reduce((sum, worker) => sum + worker.checked, 0);
  const total = workerProgress.reduce((sum, worker) => sum + worker.total, 0);
  const percent = total === 0 ? 0 : (checked / total) * 100;
  progressBar.style.width = `${percent}%`;
  progressValue.textContent = `${percent.toFixed(2)}%`;
  checkedValue.textContent = checked.toLocaleString("ja-JP");
  updateElapsed();
}

function updateElapsed() {
  if (!startedAt) return;
  elapsedValue.textContent = `${((performance.now() - startedAt) / 1000).toFixed(1)}秒`;
}

function finishComplete() {
  updateProgress();
  progressBar.style.width = "100%";
  progressValue.textContent = "100.00%";
  statusText.textContent = "完了";
  statusText.className = "status-pill complete";
  if (foundCandidates.size === 0) {
    const start = lastSearchConfig?.counterStart;
    const end = lastSearchConfig?.counterEnd;
    const range = Number.isSafeInteger(start) && Number.isSafeInteger(end)
      ? `${start.toLocaleString("ja-JP")}〜${end.toLocaleString("ja-JP")}`
      : "指定範囲";
    emptyResult.textContent = `候補を特定できませんでした。入力内容が正しい場合、現在の復元ボーナスカウンターが探索範囲（${range}）の外にある可能性があります。これまでこのセーブデータで復元ボーナスを抽選した、おおよその累計回数が含まれるように範囲を変更して、もう一度お試しください。`;
  }
  if (foundCandidates.size === 1) {
    const [candidate] = foundCandidates.values();
    void selectCandidate(candidate);
  }
  cleanupAfterRun();
}

function finishCancelled() {
  if (activeWorkers.length === 0) return;
  cancelled = true;
  activeWorkers.forEach((worker) => worker.postMessage({ type: "cancel" }));
  statusText.textContent = "中止";
  statusText.className = "status-pill";
  cleanupAfterRun();
}

function finishWithError(message) {
  cancelled = true;
  const impossibleObservation = /Gogma observation (\d+) violates the game's bonus limits/.exec(message);
  const detail = impossibleObservation
    ? `抽選${impossibleObservation[1]}の5枠がゲーム内の復元ボーナス上限に合いません。入力内容を確認してください。`
    : message;
  showError(`探索を開始できませんでした: ${detail}`);
  statusText.textContent = "エラー";
  statusText.className = "status-pill";
  cleanupAfterRun();
}

function cleanupAfterRun() {
  window.clearInterval(elapsedTimer);
  elapsedTimer = null;
  updateElapsed();
  setRunning(false);
  stopWorkers();
}

function stopWorkers() {
  activeWorkers.forEach((worker) => worker.terminate());
  activeWorkers = [];
}

function resetResults() {
  foundCandidates = new Map();
  candidateList.replaceChildren();
  emptyResult.hidden = false;
  candidateValue.textContent = "0";
  checkedValue.textContent = "0";
  progressValue.textContent = "0.00%";
  elapsedValue.textContent = "0.0秒";
  progressBar.style.width = "0%";
}

async function selectCandidate(candidate) {
  if (!lastSearchConfig) return;

  // スキルカウンターは復元カウンターとは別なので、基準seedが同じなら消さない（seedが変わったときだけ消える）
  setStateFromBonus(candidate.seed, candidate.counter, "検索結果");
  predictionOrigin.textContent = "0";
  predictionWeaponSelect.value = String(lastSearchConfig.weaponType);
  predictionAttributeSelect.value = String(lastSearchConfig.attributeForce);
  comparisonWeaponSelect.value = String(lastSearchConfig.weaponType);
  comparisonAttributeSelect.value = String(lastSearchConfig.attributeForce);
  skillWeaponSelect.value = String(lastSearchConfig.weaponType);
  skillAttributeSelect.value = String(lastSearchConfig.attributeForce);
  const searchTarget = {
    weaponType: lastSearchConfig.weaponType,
    attributeForce: lastSearchConfig.attributeForce,
    label: "",
  };
  if (
    comparisonTargets.length < MAX_REGISTERED_TARGETS &&
    !comparisonTargets.some(
      (target) => comparisonCombinationKey(target) === comparisonCombinationKey(searchTarget),
    )
  ) {
    comparisonTargets.push({
      ...searchTarget,
      id: createTargetId(),
      keepCategories: [null, null, null, null, null],
      keepSource: null,
    });
  }
  renderComparisonTargets();
  persistAppState();
  renderPredictionFilters();
  updatePredictionPoolNote();
  predictionPanel.hidden = false;
  renderCandidates();
  await Promise.all([refreshPredictions(), refreshComparisonPredictions()]);
  setActiveTab("bonus-future");
}

function loadJsonObject(key) {
  try {
    const saved = JSON.parse(localStorage.getItem(key) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

// 「強化段階を区別しない」ときは武器種ごとの希望ボーナス（系統の数）を、
// 区別するときはII・III・EXまで指定した希望を、武器種ごとに呼び出す
function detailFilterValuesFor(weaponType) {
  if (predictionIgnoreTier.checked) {
    const wish = bonusWishFor(weaponType);
    if (wish.mode === "slots") {
      return activeWishSlots(wish).filter((slot) => slot.c >= 0).map((slot) => slot.c);
    }
    return wish.counts
      .flatMap((count, category) => Array.from({ length: count }, () => category))
      .slice(0, 5);
  }
  const saved = detailTierWishes[weaponType];
  return Array.isArray(saved) ? saved : [];
}

function saveDetailFilters() {
  const weaponType = Number(predictionWeaponSelect.value);
  const values = snapshotPredictionFilters().filter((value) => value !== null);
  if (predictionIgnoreTier.checked) {
    const counts = [0, 0, 0, 0];
    for (const category of values) counts[category] += 1;
    // ここで決めた希望は「系統の数」として保存する（5枠指定の中身は残しておく）
    const slots = bonusWishes[weaponType]?.slots;
    const minAttackEx = bonusWishes[weaponType]?.minAttackEx ?? 0;
    if (counts.some((count) => count > 0) || slots || minAttackEx > 0) {
      bonusWishes[weaponType] = { mode: "counts", counts, slots, minAttackEx };
    }
    else delete bonusWishes[weaponType];
    persistBonusWishes();
    renderBonusWishSection();
    renderComparisonTable();
    return;
  }
  if (values.length > 0) detailTierWishes[weaponType] = values;
  else delete detailTierWishes[weaponType];
  try {
    localStorage.setItem(DETAIL_TIER_WISHES_KEY, JSON.stringify(detailTierWishes));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function renderPredictionFilters(values = detailFilterValuesFor(Number(predictionWeaponSelect.value))) {
  const weaponType = Number(predictionWeaponSelect.value);
  const attributeForce = Number(predictionAttributeSelect.value);
  const ignoreTier = predictionIgnoreTier.checked;
  const bonuses = ignoreTier
    ? keepCategoriesForWeapon(weaponType, attributeForce).map(([id, name]) => [
        id,
        name === "装填数" ? "装填" : name,
      ])
    : gogmaBonusesForWeapon(weaponType, attributeForce);

  predictionFilterDescription.textContent = ignoreTier
    ? "「ボーナスをリセットして再復元」で欲しい系統構成を順不同で探します。例：攻撃×4＋斬れ味×1"
    : "Ⅱ・Ⅲ・EXまで含めて、欲しいボーナスを順不同で指定します。";
  // 系統構成だけを狙うときは、通常アーティアの方が効率的という案内（元のツールから）
  if (predictionFilterArtianHint) predictionFilterArtianHint.hidden = !ignoreTier;

  predictionFilters.replaceChildren(
    ...Array.from({ length: 5 }, (_, index) => {
      const label = document.createElement("label");
      const text = document.createElement("span");
      const select = document.createElement("select");
      const placeholder = document.createElement("option");
      const selectedId = values[index] ?? null;
      const selectedIdIsAvailable = bonuses.some(([id]) => id === selectedId);

      text.textContent = `希望 ${index + 1}`;
      placeholder.value = "";
      placeholder.textContent = "指定なし";
      placeholder.selected = selectedId === null || !selectedIdIsAvailable;
      select.append(placeholder);

      for (const [id, name] of bonuses) {
        const option = document.createElement("option");
        option.value = String(id);
        option.textContent = name;
        option.selected = selectedId === id;
        select.append(option);
      }

      label.append(text, select);
      return label;
    }),
  );
}

function snapshotPredictionFilters() {
  return [...predictionFilters.querySelectorAll("select")].map((select) =>
    select.value === "" ? null : Number(select.value),
  );
}

async function refreshPredictions() {
  if (!selectedCandidate || !lastSearchConfig) return;
  if (bonusPrediction.mode === "keep") {
    predictionRolls = [];
    predictionRows.replaceChildren();
    predictionStatus.textContent = "「ボーナスを同じ構成で再復元」の未来は武器一覧で比較します";
    predictionStatus.className = "status-pill";
    return;
  }

  const requestId = ++predictionRequestId;
  hidePredictionError();
  predictionStatus.textContent = "未来を計算中";
  predictionStatus.className = "status-pill running";

  try {
    const predictionCount = readPredictionCount();
    const weaponType = Number(predictionWeaponSelect.value);
    const attributeForce = Number(predictionAttributeSelect.value);
    const matchesSearchWeapon =
      bonusPrediction.mode === "reset" &&
      weaponType === lastSearchConfig.weaponType &&
      attributeForce === lastSearchConfig.attributeForce;
    const observationCount = lastSearchConfig.observations.length / 5;
    const generatedCount = matchesSearchWeapon
      ? Math.max(predictionCount, observationCount)
      : predictionCount;

    await ensurePredictionWasm();
    const detailTarget = { weaponType, attributeForce, label: "" };
    const flattened = predictBonusRollsForTarget(detailTarget, generatedCount);
    if (requestId !== predictionRequestId) return;

    if (
      matchesSearchWeapon &&
      !flattenedPrefixMatches(flattened, lastSearchConfig.observations)
    ) {
      throw new Error(
        "観測結果と予測の先頭が一致しません。武器種・属性・候補を確認してください。",
      );
    }

    predictionRolls = Array.from({ length: predictionCount }, (_, index) => ({
      index,
      bonusIds: Array.from(flattened.slice(index * 5, index * 5 + 5)),
      observed: matchesSearchWeapon && index < observationCount,
    }));
    renderPredictionTable();
  } catch (error) {
    if (requestId !== predictionRequestId) return;
    predictionRolls = [];
    predictionRows.replaceChildren();
    predictionStatus.textContent = "予測エラー";
    predictionStatus.className = "status-pill";
    showPredictionError(error instanceof Error ? error.message : String(error));
  }
}

function readPredictionCount() {
  const value = Number(predictionCountInput.value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("表示する回数は1〜10,000の整数で入力してください。");
  }
  return value;
}

async function ensurePredictionWasm() {
  predictionWasmReady ??= initWasm();
  await predictionWasmReady;
}

function predictBonusRollsForTarget(target, count) {
  const common = [
    selectedCandidate.seed,
    target.weaponType,
    target.attributeForce,
    selectedCandidate.counter,
    lastSearchConfig?.counterGate ?? 35,
    count,
  ];
  if (bonusPrediction.mode === "reset") return predict_gogma_rolls(...common);
  return predict_gogma_keep_rolls(
    ...common,
    new Uint8Array(requireTargetKeepCategories(target)),
  );
}

function bonusCategoryId(bonusId) {
  if ([8, 12, 15].includes(bonusId)) return 0;
  if ([9, 13, 16].includes(bonusId)) return 1;
  if ([11, 14].includes(bonusId)) return 2;
  if ([6, 10].includes(bonusId)) return 3;
  throw new Error(`未対応の復元ボーナスIDです: ${bonusId}`);
}

function beginKeepOptimization(target, bonusIds, completedRolls) {
  return performConfirmedOperation(() => {
    const basis = workbenchRead();
    const model = advanceCounter(basis.model,'bonus',completedRolls);
    validateBonuses(target.weaponType,target.attributeForce,bonusIds);
    const targets = JSON.parse(JSON.stringify(comparisonTargets));
    let profile = target.id ? targets.find(w=>w.id===target.id) : targets.find(w=>comparisonCombinationKey(w)===comparisonCombinationKey(target));
    if (!profile) {
      if (targets.length >= MAX_REGISTERED_TARGETS) throw new Error('登録できる狙いの上限です。整理してからEX厳選へ進んでください。');
      profile = {...target,id:createTargetId(),label:target.label??''}; targets.push(profile);
    }
    profile.keepCategories=bonusIds.map(bonusCategoryId); profile.keepSource=completedRolls+'回先のリセット結果';
    const success='カウンターと狙いの構成を反映し、「同じ構成で再復元」のEX厳選へ切り替えました。手持ち武器は変更していません。';
    return {title:'この構成を採用してEX厳選へ進みますか？',summary:operationWeaponPreview({target,bonuses:bonusIds}),
      message:'復元カウンターと狙いの構成を変更します。手持ち武器への登録・上書きは行いません。',
      lines:counterChangeMessages(basis.model,model,WEAPON_TYPES),confirmLabel:'この構成でカウンターを進める',
      verify:()=>assertOperationBasis(basis),execute:()=>commitCounterModel(model,basis,{targets,prediction:{...bonusPrediction,mode:'keep'},tab:'bonus-future',success,selection:profile}),success:result=>result.message};
  });
}

function flattenedPrefixMatches(actual, expected) {
  if (actual.length < expected.length) return false;
  return expected.every((value, index) => actual[index] === value);
}

function renderPredictionTable() {
  if (!selectedCandidate) return;

  const requirements = snapshotPredictionFilters().filter((value) => value !== null);
  const matchedRolls = predictionRolls.filter((roll) =>
    rollContainsRequirements(roll.bonusIds, requirements),
  );
  const visibleRolls =
    requirements.length > 0 && predictionMatchesOnly.checked ? matchedRolls : predictionRolls;

  if (requirements.length === 0) {
    predictionStatus.textContent = `${predictionRolls.length.toLocaleString("ja-JP")}回を表示`;
  } else {
    predictionStatus.textContent = `${predictionRolls.length.toLocaleString("ja-JP")}回中 ${matchedRolls.length.toLocaleString("ja-JP")}回一致`;
  }
  predictionStatus.className = "status-pill complete";
  renderDetailPredictionHeader();

  if (visibleRolls.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 4;
    cell.className = "prediction-empty";
    cell.textContent = "指定した構成は表示範囲内にありません。表示回数を増やしてください。";
    row.append(cell);
    predictionRows.replaceChildren(row);
    return;
  }

  predictionRows.replaceChildren(
    ...visibleRolls.map((roll) => createPredictionRow(roll, requirements)),
  );
}

function rollContainsRequirements(bonusIds, requirements) {
  const remaining = new Map();
  for (const bonusId of bonusIds) {
    const value = predictionIgnoreTier.checked ? bonusCategoryId(bonusId) : bonusId;
    remaining.set(value, (remaining.get(value) ?? 0) + 1);
  }
  for (const requiredId of requirements) {
    const count = remaining.get(requiredId) ?? 0;
    if (count === 0) return false;
    remaining.set(requiredId, count - 1);
  }
  return true;
}

function createPredictionRow(roll, requirements) {
  const weaponType = Number(predictionWeaponSelect.value);
  const row = document.createElement("tr");
  const offsetCell = document.createElement("th");
  const matches = requirements.length > 0 && rollContainsRequirements(roll.bonusIds, requirements);

  row.classList.toggle("prediction-match", matches);
  row.classList.toggle("prediction-observed", roll.observed);
  offsetCell.scope = "row";
  offsetCell.textContent = `${roll.index + 1}回先`;
  if (roll.observed) {
    const badge = document.createElement("span");
    badge.className = "observed-badge";
    badge.textContent = "実測一致";
    offsetCell.append(badge);
  }
  row.append(offsetCell);
  // スキル未来予測と同じく、保存後の状態は小さく表示する
  row.append(createSavedStateCell("bonus", roll.index + 1, null, true));

  const matchCell = document.createElement("td");
  matchCell.className = "detail-match-cell";
  if (matches) {
    const badge = document.createElement("span");
    badge.className = "detail-match-badge";
    badge.textContent = "★ 一致";
    matchCell.append(badge);
  } else {
    const none = document.createElement("span");
    none.className = "skill-match-none";
    none.textContent = "—";
    matchCell.append(none);
  }
  row.append(matchCell);

  const resultCell = document.createElement("td");
  resultCell.className = "detail-result-cell";
  const tags = document.createElement("div");
  tags.className = "detail-bonus-set";
  for (const bonusId of roll.bonusIds) {
    const tag = document.createElement("span");
    tag.className = `bonus-tag ${bonusClassName(bonusId)}${EX_BONUS_IDS.has(bonusId) ? " ex" : ""}`;
    tag.textContent = gogmaBonusName(weaponType, bonusId);
    tags.append(tag);
  }
  resultCell.append(tags);
  resultCell.append(createAdoptAsOwnedButton(
    { weaponType, attributeForce: Number(predictionAttributeSelect.value) },
    roll.bonusIds,
    roll.index + 1,
  ));
  row.append(resultCell);

  return row;
}

function renderDetailPredictionHeader() {
  const table = predictionRows.closest("table");
  const headerRow = table?.querySelector("thead tr");
  if (!headerRow) return;
  table.classList.add("detail-compact-table");
  headerRow.replaceChildren(...["何回先", "保存後の状態", "一致", "5枠の結果"].map((label) => {
    const header = document.createElement("th");
    header.scope = "col";
    header.textContent = label;
    return header;
  }));
}

function createSavedStateCell(kind, completedRolls, keepTransition = null, compact = false) {
  const cell = document.createElement("td");
  const counterLabel = document.createElement("span");
  const counterValue = document.createElement("strong");
  const actions = document.createElement("div");
  const adoptButton = document.createElement("button");
  const isBonus = kind === "bonus";
  const currentCounter = isBonus ? saveState.bonusCounter : saveState.skillCounter;
  const nextCounter = currentCounter === null ? null : currentCounter + completedRolls;
  const code = isBonus
    ? selectedCandidate ? formatGogmaContinuationCode(selectedCandidate, completedRolls) : null
    : formatSkillContinuationCode(completedRolls);

  cell.className = `continuation-code-cell saved-state-cell${compact ? " compact-state" : ""}`;
  counterLabel.textContent = compact
    ? isBonus ? "復元" : "スキル"
    : isBonus ? "保存後の復元ボーナスカウンター" : "保存後のスキルカウンター";
  counterValue.textContent = nextCounter === null ? "未特定" : nextCounter.toLocaleString("ja-JP");
  actions.className = "saved-state-actions";

  if (code) {
    const codeButton = document.createElement("button");
    codeButton.type = "button";
    codeButton.className = "continuation-code-button";
    codeButton.textContent = compact ? "コード" : code;
    codeButton.title = t(`セーブ状態コードをコピー: ${code}`);
    codeButton.addEventListener("click", () => void useContinuationCode(code));
    actions.append(codeButton);
  }

  adoptButton.type = "button";
  adoptButton.className = "adopt-position-button";
  adoptButton.textContent = compact ? "ここを0にする" : "この位置を新しい0にする";
  adoptButton.addEventListener("click", () => {
    if (isBonus) void adoptBonusPosition(completedRolls);
    else void adoptSkillPosition(completedRolls);
  });
  actions.append(adoptButton);
  if (isBonus && keepTransition) {
    const keepButton = document.createElement("button");
    keepButton.type = "button";
    keepButton.className = "keep-transition-button";
    keepButton.textContent = "この構成でEX厳選へ";
    keepButton.addEventListener("click", () => void beginKeepOptimization(
      keepTransition.target,
      keepTransition.bonusIds,
      completedRolls,
    ));
    actions.append(keepButton);
  }
  cell.append(counterLabel, counterValue, actions);
  return cell;
}

function adoptBonusPosition(completedRolls) {
  return runCounterChange({kind:'bonus',steps:completedRolls,title:'復元カウンターの0地点を変更しますか？',
    success:'復元カウンターの0地点を変更しました。手持ち武器は変更していません。'});
}

function adoptSkillPosition(completedRolls) {
  return runCounterChange({kind:'skill',steps:completedRolls,title:'スキルカウンターの0地点を変更しますか？',
    success:'スキルカウンターの0地点を変更しました。手持ち武器は変更していません。'});
}

function bonusClassName(bonusId) {
  if ([8, 12, 15].includes(bonusId)) return "attack";
  if ([9, 13, 16].includes(bonusId)) return "affinity";
  if ([11, 14].includes(bonusId)) return "element";
  return "sharpness-ammo";
}

async function addComparisonTarget() {
  hideComparisonError();
  const target = {
    weaponType: Number(comparisonWeaponSelect.value),
    attributeForce: Number(comparisonAttributeSelect.value),
    label: comparisonTargetLabelInput.value.trim(),
  };
  if (!registerTarget(target, showComparisonError, bonusPrediction.mode === "keep")) return;
  comparisonTargetLabelInput.value = "";
  await Promise.all([refreshComparisonPredictions(), refreshSkillPredictions()]);
}

async function addSkillTarget() {
  hideSkillTargetError();
  const target = {
    weaponType: Number(skillTargetWeaponSelect.value),
    attributeForce: Number(skillTargetAttributeSelect.value),
    label: skillTargetLabelInput.value.trim(),
  };
  if (!registerTarget(target, showSkillTargetError, false)) return;
  skillTargetLabelInput.value = "";
  await Promise.all([refreshComparisonPredictions(), refreshSkillPredictions()]);
}

function registerTarget(target, showError, allowDuplicateCombination) {
  const duplicateCombination = comparisonTargets.filter(
    (existing) => comparisonCombinationKey(existing) === comparisonCombinationKey(target),
  );
  if (duplicateCombination.length > 0 && !allowDuplicateCombination) {
    showError("この武器種・属性は登録済みです。EX未厳選の別武器は「ボーナスを同じ構成で再復元」を選んでから登録してください。");
    return false;
  }
  if (duplicateCombination.length > 0 && !target.label) {
    showError("同じ武器種・属性の別武器には、区別できる表示名を入力してください。");
    return false;
  }
  if (
    target.label &&
    comparisonTargets.some((existing) => existing.label && existing.label === target.label)
  ) {
    showError("同じ表示名が登録済みです。別の名前を入力してください。");
    return false;
  }
  if (comparisonTargets.length >= MAX_REGISTERED_TARGETS) {
    showError(`予測対象は最大${MAX_REGISTERED_TARGETS}件です。不要な武器を削除してください。`);
    return false;
  }
  comparisonTargets.push({
    ...target,
    id: createTargetId(),
    keepCategories: [null, null, null, null, null],
    keepSource: null,
  });
  renderComparisonTargets();
  persistAppState();
  return true;
}

function comparisonTargetKey(target) {
  return target.id;
}

function comparisonCombinationKey(target) {
  return `${target.weaponType}:${target.attributeForce}`;
}

function uniqueTargetsByCombination(targets = comparisonTargets) {
  const unique = new Map();
  for (const target of targets) {
    const key = comparisonCombinationKey(target);
    if (!unique.has(key)) unique.set(key, target);
  }
  return [...unique.values()];
}

function optionName(options, value) {
  return options.find(([optionValue]) => optionValue === value)?.[1] ?? String(value);
}

function comparisonTargetName(target) {
  if (target.label) return target.label;
  const weapon = optionName(WEAPON_TYPES, target.weaponType);
  const attributeName = optionName(ATTRIBUTES, target.attributeForce);
  return localizedTargetName(weapon, attributeName);
}

// 「片手剣・毒」のように武器種と属性を並べた文字
function weaponAndAttributeText(target) {
  const weapon = t(optionName(WEAPON_TYPES, target.weaponType));
  const attribute = t(optionName(ATTRIBUTES, target.attributeForce)).replace("属性", "");
  return `${weapon}・${attribute}`;
}

// 表示用の名前：［片手剣・毒］の札 ＋ 登録名（登録名があるときだけ）
function createWeaponBadge(target) {
  const badge = document.createElement("span");
  badge.className = "weapon-badge";
  badge.textContent = weaponAndAttributeText(target);
  if (!target.label) return [badge];
  const label = document.createElement("span");
  label.className = "target-label-text";
  label.textContent = target.label;
  label.title = target.label;
  return [badge, label];
}

// 文章用：「片手剣・毒「【攻撃激化】毒」」
function targetNameWithWeapon(target) {
  const base = weaponAndAttributeText(target);
  return target.label ? `${base}「${target.label}」` : base;
}

function predictionCsvTargetName(target) {
  const weapon = optionName(WEAPON_TYPES, target.weaponType);
  const attribute = optionName(ATTRIBUTES, target.attributeForce);
  const kind = target.kind === "owned" ? ` / 手持ち・同じ構成 ${ownedLayoutText(target)}` : "";
  return `${comparisonTargetName(target)} (${t(weapon)} / ${t(attribute)}${kind})`;
}

function downloadCsv(filename, headers, rows) {
  const escapeCell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const csv = [headers, ...rows]
    .map((row) => row.map(escapeCell).join(","))
    .join("\r\n");
  const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function renderComparisonTargets() {
  const createItems = (targets) => targets.map((target) => {
      const item = document.createElement("span");
      const text = document.createElement("span");
      const removeButton = document.createElement("button");
      item.className = "comparison-target";
      text.textContent = comparisonTargetName(target);
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", t(`${comparisonTargetName(target)}を比較対象から削除`));
      removeButton.addEventListener("click", () => {
        comparisonTargets = comparisonTargets.filter(
          (candidate) => comparisonTargetKey(candidate) !== comparisonTargetKey(target),
        );
        renderComparisonTargets();
        persistAppState();
        void Promise.all([refreshComparisonPredictions(), refreshSkillPredictions()]);
      });
      item.append(text, removeButton);
      return item;
    });
  comparisonTargetList.replaceChildren(...createItems(comparisonTargets));
  skillTargetList.replaceChildren(...createItems(uniqueTargetsByCombination()));
  clearComparisonTargetsButton.disabled = comparisonTargets.length === 0;
  clearSkillTargetsButton.disabled = comparisonTargets.length === 0;
  // 見出しの横の「○/140件」（新しい画面の部品）
  const capacityText = `${comparisonTargets.length.toLocaleString("ja-JP")}/${MAX_REGISTERED_TARGETS.toLocaleString("ja-JP")}件`;
  for (const pill of [comparisonTargetCapacity, skillTargetCapacity]) {
    if (pill) pill.textContent = capacityText;
  }
  renderKeepLayoutInputs();
  updateComparisonStatus();
  renderWeaponFilterSection();
  renderBonusWishSection();
  updateRegisteredListTitles();
}

function readComparisonCount() {
  const value = Number(comparisonCountInput.value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("比較表の表示回数は1〜10,000の整数で入力してください。");
  }
  return value;
}

async function refreshComparisonPredictions() {
  const requestId = ++comparisonRequestId;
  hideComparisonError();

  const usableOwned = ownedWeapons.filter((weapon) => ownedWeaponProblem(weapon) === null);
  if (!selectedCandidate || (comparisonTargets.length === 0 && usableOwned.length === 0)) {
    comparisonRollSets = [];
    renderComparisonTable();
    return;
  }

  comparisonStatus.textContent = "比較表を計算中";
  comparisonStatus.className = "status-pill running";

  try {
    const count = readComparisonCount();
    await ensurePredictionWasm();
    const toRolls = (flattened) => Array.from({ length: count }, (_, index) =>
      Array.from(flattened.slice(index * 5, index * 5 + 5)));
    const nextRollSets = [
      // 狙い：リセットして再復元
      ...uniqueTargetsByCombination().map((target) => ({
        ...target,
        kind: "reset",
        rolls: toRolls(predict_gogma_rolls(
          selectedCandidate.seed, target.weaponType, target.attributeForce,
          selectedCandidate.counter, lastSearchConfig?.counterGate ?? 35, count,
        )),
      })),
      // 手持ち武器：同じ構成で再復元
      ...usableOwned.map((weapon) => ({
        ...weapon,
        kind: "owned",
        rolls: toRolls(predict_gogma_keep_rolls(
          selectedCandidate.seed, weapon.weaponType, weapon.attributeForce,
          selectedCandidate.counter, lastSearchConfig?.counterGate ?? 35, count,
          new Uint8Array(weapon.categories),
        )),
      })),
    ];
    if (requestId !== comparisonRequestId) return;
    comparisonRollSets = nextRollSets;
    comparisonRowLimit = COMPARISON_PAGE_SIZE;
    renderComparisonTable();
  } catch (error) {
    if (requestId !== comparisonRequestId) return;
    comparisonRollSets = [];
    renderComparisonTable();
    showComparisonError(error instanceof Error ? error.message : String(error));
  }
}

function comparisonPredictionVisibility() {
  if (comparisonRollSets.length === 0) {
    return { count: 0, minimumExCount: Number(bonusExFilterCountSelect.value), visibleIndices: [] };
  }

  const count = comparisonRollSets[0].rolls.length;
  const minimumExCount = Number(bonusExFilterCountSelect.value);
  const rowMeetsExThreshold = (index) => comparisonRollSets.some((target) =>
    target.rolls[index].filter((bonusId) => EX_BONUS_IDS.has(bonusId)).length >= minimumExCount
  );
  const rowMatchesWish = (index) => comparisonRollSets.some((target) =>
    rollMatchesBonusWish(target, target.rolls[index])
  );
  const wishOnly = !!bonusWishMatchesOnly?.checked;
  const visibleIndices = Array.from({ length: count }, (_, index) => index)
    .filter((index) => !bonusExFilterEnabled.checked || rowMeetsExThreshold(index))
    .filter((index) => !wishOnly || rowMatchesWish(index));
  return { count, minimumExCount, visibleIndices };
}

function renderComparisonTable() {
  renderBonusWeaponOrder();
  comparisonRollSets = orderBonusTargets(comparisonRollSets);
  if (!selectedCandidate || comparisonRollSets.length === 0) {
    comparisonHeaderRow.replaceChildren();
    comparisonRows.replaceChildren();
    comparisonTableWrap.hidden = true;
    exportBonusCsvButton.disabled = true;
    bonusExportStatus.textContent = "予測結果を表示するとCSVへ出力できます。";
    if (comparisonMoreBar) comparisonMoreBar.hidden = true;
    updateComparisonStatus();
    renderBonusWishSummary();
    updateTableScrollMirrors();
    return;
  }

  const offsetHeader = document.createElement("th");
  const continuationHeader = document.createElement("th");
  offsetHeader.scope = "col";
  offsetHeader.textContent = "何回先";
  continuationHeader.scope = "col";
  continuationHeader.textContent = "保存後の状態";
  const matchHeader = document.createElement("th");
  matchHeader.scope = "col";
  matchHeader.textContent = "一致";
  const showAll = !!showAllComparisonColumns?.checked;
  comparisonTableWrap.querySelector("table")?.classList.toggle("compact-columns", !showAll);
  comparisonHeaderRow.replaceChildren(
    offsetHeader,
    continuationHeader,
    matchHeader,
    ...(showAll ? comparisonRollSets : []).map((target) => {
      const header = document.createElement("th");
      const kind = document.createElement("span");
      header.scope = "col";
      header.className = target.kind === "owned" ? "owned-column-header" : "reset-column-header";
      kind.className = "column-kind";
      kind.textContent = target.kind === "owned" ? "手持ち・同じ構成" : "狙い・リセット";
      header.append(kind, ...createWeaponBadge(target));
      // 見出しを低く保つため、手持ち武器の今のボーナスはマウスを乗せたときだけ出す
      if (target.kind === "owned") header.title = `今のボーナス：${ownedLayoutText(target)}`;
      return header;
    }),
  );

  const { count, minimumExCount, visibleIndices } = comparisonPredictionVisibility();
  // 全武器の列を並べたときは、どの行でも武器が分かるよう「何回先」ごとに見出しの行を入れ直す
  comparisonRows.replaceChildren(
    ...visibleIndices.slice(0, comparisonRowLimit).flatMap((index, position) => {
      const row = createComparisonRow(index);
      if (!showAll || position === 0) return [row];
      const repeatHeader = comparisonHeaderRow.cloneNode(true);
      repeatHeader.removeAttribute("id");
      repeatHeader.className = "repeat-header-row";
      return [repeatHeader, row];
    }),
  );
  renderComparisonMoreBar(visibleIndices.length);
  if (visibleIndices.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 3 + (showAll ? comparisonRollSets.length : 0);
    cell.className = "prediction-empty";
    cell.textContent = bonusWishMatchesOnly?.checked
      ? "条件に合う結果は表示範囲内にありません。表示回数を増やすか、条件を変更してください。"
      : `EXが${minimumExCount}個以上の結果は表示範囲内にありません。表示回数を増やすか最低EX数を下げてください。`;
    row.append(cell);
    comparisonRows.replaceChildren(row);
  }
  comparisonTableWrap.hidden = false;
  exportBonusCsvButton.disabled = visibleIndices.length === 0;
  bonusExportStatus.textContent = bonusExFilterEnabled.checked
    ? `EX条件一致で現在表示中の${visibleIndices.length.toLocaleString("ja-JP")}行をCSVへ出力します。`
    : `現在表示中の${visibleIndices.length.toLocaleString("ja-JP")}行をCSVへ出力します。`;
  const resetCount = comparisonRollSets.filter((target) => target.kind !== "owned").length;
  const ownedCount = comparisonRollSets.length - resetCount;
  const filterStatus = bonusExFilterEnabled.checked
    ? `・EX${minimumExCount}個以上 ${visibleIndices.length.toLocaleString("ja-JP")}行`
    : "";
  comparisonStatus.textContent = `狙い${resetCount}・手持ち${ownedCount} × ${count.toLocaleString("ja-JP")}回${filterStatus}`;
  comparisonStatus.className = "status-pill complete";
  renderBonusWishSummary();
  updateTableScrollMirrors();
}

function exportVisibleBonusPredictionsCsv() {
  const { visibleIndices } = comparisonPredictionVisibility();
  if (visibleIndices.length === 0 || comparisonRollSets.length === 0) {
    showComparisonError("CSVへ出力できる復元ボーナス未来予測の結果がありません。");
    return;
  }

  hideComparisonError();
  const headers = [
    t("何回先"),
    t("カウンター位置"),
    "一致",
    ...comparisonRollSets.flatMap((target) => Array.from({ length: 5 }, (_, index) =>
      `${predictionCsvTargetName(target)} ${t(`${index + 1}枠目`)}`
    )),
  ];
  const rows = visibleIndices.map((index) => [
    index + 1,
    saveState.bonusCounter + index + 1,
    comparisonRollSets
      .filter((target) => rollMatchesBonusWish(target, target.rolls[index]))
      .map((target) => comparisonTargetName(target))
      .join(" / "),
    ...comparisonRollSets.flatMap((target) => target.rolls[index].map((bonusId) =>
      t(gogmaBonusName(target.weaponType, bonusId))
    )),
  ]);
  downloadCsv(
    `gogma-bonus-${bonusPrediction.mode}-future-seed-${saveState.baseSeed}-counter-${saveState.bonusCounter}.csv`,
    headers,
    rows,
  );
  bonusExportStatus.textContent = `${rows.length.toLocaleString("ja-JP")}行・${headers.length.toLocaleString("ja-JP")}列をCSVへ出力しました。`;
}

// 横に長い表のための横スクロールバー（表の上と、画面の下にくっつくもの）。表と動きを合わせる
function setupTableScrollMirrors() {
  if (tableScrollMirrors.length > 0) return;
  // 「◀ 左右に動かすと表が横に動きます ▶」の案内つきの枠に入れて、スクロールバーだと分かるようにする
  tableScrollMirrors =["top", "bottom"].map((position) => {
    const holder = document.createElement("div");
    const left = document.createElement("span");
    const right = document.createElement("span");
    const caption = document.createElement("span");
    const mirror = document.createElement("div");
    const inner = document.createElement("div");
    holder.className = `table-scroll-holder ${position}`;
    left.className = "table-scroll-arrow";
    right.className = "table-scroll-arrow";
    left.textContent = "◀";
    right.textContent = "▶";
    caption.className = "table-scroll-caption";
    caption.textContent = "左右に動かすと表が横に動きます";
    mirror.className = "table-scroll-mirror";
    mirror.title = "左右に動かすと表が横に動きます";
    mirror.append(inner);
    // 矢印を押しても横に動く
    left.addEventListener("click", () => { comparisonTableWrap.scrollLeft -= 400; });
    right.addEventListener("click", () => { comparisonTableWrap.scrollLeft += 400; });
    holder.append(caption, left, mirror, right);
    if (position === "top") comparisonTableWrap.before(holder);
    else comparisonTableWrap.after(holder);
    return mirror;
  });
  let syncing = false;
  const syncFrom = (source) => {
    if (syncing) return;
    syncing = true;
    for (const element of [comparisonTableWrap, ...tableScrollMirrors]) {
      if (element !== source) element.scrollLeft = source.scrollLeft;
    }
    syncing = false;
  };
  for (const element of [comparisonTableWrap, ...tableScrollMirrors]) {
    element.addEventListener("scroll", () => syncFrom(element));
  }
  window.addEventListener("resize", () => updateTableScrollMirrors());
}

function updateTableScrollMirrors() {
  const overflowing = !comparisonTableWrap.hidden
    && comparisonTableWrap.scrollWidth > comparisonTableWrap.clientWidth + 2;
  for (const mirror of tableScrollMirrors) {
    mirror.parentElement.hidden = !overflowing;
    mirror.firstElementChild.style.width = `${comparisonTableWrap.scrollWidth}px`;
    mirror.scrollLeft = comparisonTableWrap.scrollLeft;
  }
}

// 表の下の「続きを10回分表示」「すべて表示」
function renderComparisonMoreBar(total) {
  if (!comparisonMoreBar) {
    comparisonMoreBar = document.createElement("div");
    comparisonMoreBar.className = "comparison-more-bar";
    comparisonTableWrap.after(comparisonMoreBar);
  }
  const shown = Math.min(comparisonRowLimit, total);
  const rest = total - shown;
  const status = document.createElement("span");
  status.className = "comparison-more-status";
  status.textContent = `${total.toLocaleString("ja-JP")}行中 ${shown.toLocaleString("ja-JP")}行を表示中`;
  if (rest <= 0) {
    comparisonMoreBar.replaceChildren(status);
    comparisonMoreBar.hidden = total === 0;
    return;
  }
  const more = document.createElement("button");
  more.type = "button";
  more.className = "secondary small-button";
  more.textContent = `続きを${Math.min(COMPARISON_PAGE_SIZE, rest)}回分表示（残り${rest.toLocaleString("ja-JP")}回）`;
  more.addEventListener("click", () => {
    comparisonRowLimit += COMPARISON_PAGE_SIZE;
    renderComparisonTable();
  });
  const all = document.createElement("button");
  all.type = "button";
  all.className = "text-button";
  all.textContent = "すべて表示";
  all.addEventListener("click", () => {
    comparisonRowLimit = Infinity;
    renderComparisonTable();
  });
  comparisonMoreBar.replaceChildren(status, more, all);
  comparisonMoreBar.hidden = false;
}

function createComparisonRow(index) {
  const row = document.createElement("tr");
  const offsetCell = document.createElement("th");

  offsetCell.scope = "row";
  offsetCell.textContent = `${index + 1}回先`;
  if (bonusExFilterEnabled.checked) row.classList.add("prediction-match");
  row.append(offsetCell, createSavedStateCell("bonus", index + 1, null, true));

  // 希望ボーナスに一致した武器を左側の「一致」列にまとめる。
  // 見分けやすいよう、上＝狙い（リセット）、下＝手持ちの強化（同じ構成）に分ける
  const matchCell = document.createElement("td");
  matchCell.className = "bonus-match-cell";
  const matchSplit = document.createElement("div");
  matchSplit.className = "match-split";
  const createMatchHalf = (kind, labelText) => {
    const half = document.createElement("div");
    half.className = `match-half ${kind}`;
    const label = document.createElement("div");
    label.className = "match-half-label";
    label.textContent = labelText;
    // 並べ方（2武器で1段など）を変えやすいよう、一致した武器は入れ物に入れる
    const items = document.createElement("div");
    items.className = "match-items";
    half.append(label, items);
    matchSplit.append(half);
    return { half, items, groups: new Map() };
  };
  const resetHalf = createMatchHalf("reset", "狙い（リセット）");
  const ownedHalf = createMatchHalf("owned", "手持ち（同じ構成：手持ち条件／希望ボーナス）");
  matchCell.append(matchSplit);
  row.append(matchCell);

  const showAll = !!showAllComparisonColumns?.checked;
  for (const target of comparisonRollSets) {
    const cell = document.createElement("td");
    const bonusSet = createCompactBonusSet(target, target.rolls[index]);
    const goalMatch = configuredBonusWishMatches(target.weaponType, target.rolls[index]);
    if (rollMatchesBonusWish(target, target.rolls[index])) {
      cell.classList.add("bonus-wish-hit");
      const item = document.createElement("div");
      const name = document.createElement("div");
      item.className = "skill-match-item";
      item.classList.toggle("bonus-goal-hit", goalMatch);
      cell.classList.toggle("bonus-goal-hit", goalMatch);
      name.className = "skill-match-name";
      const kindBadge = document.createElement("span");
      kindBadge.className = `match-kind-badge ${target.kind === "owned" ? "owned" : "reset"}`;
      kindBadge.textContent = target.kind === "owned" ? (ownedRollMatches(target, target.rolls[index]) ? "手持ち条件一致" : "同じ構成") : "狙い";
      name.append(kindBadge, ...createWeaponBadge(target));
      if (goalMatch) {
        name.append(createBonusGoalBadge(target.weaponType));
        if (target.kind === "owned" && !ownedRollMatches(target, target.rolls[index])) {
          const note = document.createElement("small");
          note.className = "bonus-goal-rule-note";
          note.textContent = "希望に一致（手持ち条件には未一致）";
          name.append(note);
        }
      }
      // 「一致」列だけで操作できるよう、採用ボタンもここに付ける
      const matchButton = target.kind === "owned"
        ? createAdoptOwnedUpdateButton(target, target.rolls[index], index + 1)
        : createAdoptAsOwnedButton(target, target.rolls[index], index + 1);
      matchButton.classList.add("match-adopt-button");
      item.append(name, createCompactBonusSet(target, target.rolls[index], true));
      if (target.kind === "owned") item.append(createWeaponStatComparison(target, target.rolls[index], { compact: true }));
      item.append(matchButton);
      appendWeaponMatchItem(target.kind === "owned" ? ownedHalf : resetHalf, target.weaponType, item);
    }
    if (!showAll) continue;
    if (target.kind === "owned") {
      cell.classList.add("owned-result-cell");
      bonusSet.append(createWeaponStatComparison(target, target.rolls[index], { compact: true }));
      bonusSet.append(createAdoptOwnedUpdateButton(target, target.rolls[index], index + 1));
    } else {
      bonusSet.append(createAdoptAsOwnedButton(target, target.rolls[index], index + 1));
    }
    if (goalMatch) bonusSet.prepend(createBonusGoalBadge(target.weaponType));
    cell.classList.add("comparison-result-cell");
    cell.append(bonusSet);
    row.append(cell);
  }

  const hasReset = resetHalf.items.childElementCount > 0;
  const hasOwned = ownedHalf.items.childElementCount > 0;
  if (!hasReset && !hasOwned) {
    const none = document.createElement("span");
    none.className = "skill-match-none";
    none.textContent = "—";
    matchCell.replaceChildren(none);
  } else {
    // 片方だけ一致したときは、空いた側を出さない
    if (!hasReset) resetHalf.half.classList.add("empty");
    if (!hasOwned) ownedHalf.half.classList.add("empty");
    row.classList.add("prediction-match", "bonus-wish-row-hit");
  }
  return row;
}

function createCompactBonusSet(target, bonusIds, highlightWish = false) {
  const bonusSet = document.createElement("div");
  bonusSet.className = "comparison-bonus-set";
  // 手持ち武器は、今のボーナスと枠ごとに比べて ↑（上がる）／↓（下がる）を付ける
  const current = target.kind === "owned" && ownedBonusesKnown(target) ? target.bonuses : null;
  // 狙い（リセット）は、希望の系統に当てはまる枠を強調し、それ以外を薄くする
  const wish = highlightWish && target.kind !== "owned" ? bonusWishFor(target.weaponType) : null;
  const need = wish && wish.mode === "counts" ? [...wish.counts] : null;
  const slotUsed = wish && wish.mode === "slots" ? slotWishAssignment(wish, bonusIds).used : null;
  bonusIds.forEach((bonusId, slotIndex) => {
    const tag = document.createElement("span");
    tag.className = `bonus-tag compact ${bonusClassName(bonusId)}${EX_BONUS_IDS.has(bonusId) ? " ex" : ""}`;
    tag.textContent = compactGogmaBonusName(target.weaponType, bonusId);
    if (highlightWish && target.kind === "owned" && EX_BONUS_IDS.has(bonusId)) {
      // 手持ちの強化の一致でも、EXは金の縁で目立たせる
      tag.classList.add("wish-part");
    } else if (slotUsed) {
      tag.classList.add(slotUsed.has(slotIndex) ? "wish-part" : "not-wish");
    } else if (need) {
      const category = bonusCategoryId(bonusId);
      if (need[category] > 0) {
        need[category] -= 1;
        tag.classList.add("wish-part");
      } else {
        tag.classList.add("not-wish");
      }
    }
    if (current) {
      const diff = bonusTierRank(bonusId) - bonusTierRank(current[slotIndex]);
      if (diff !== 0) {
        const arrow = document.createElement("span");
        arrow.className = diff > 0 ? "tier-up" : "tier-down";
        arrow.textContent = diff > 0 ? "↑" : "↓";
        tag.append(arrow);
      }
    }
    bonusSet.append(tag);
  });
  return bonusSet;
}

// 同じ系統の中での段階（II・斬れ味強化・属性II＜III＜EX）
function bonusTierRank(bonusId) {
  if ([15, 16, 14, 10].includes(bonusId)) return 3;
  if ([12, 13].includes(bonusId)) return 2;
  return 1;
}

function ownedBonusesKnown(weapon) {
  return Array.isArray(weapon.bonuses) && weapon.bonuses.every((bonusId) => bonusId !== null);
}

// 手持ち武器の判定。「同じ構成で再復元」は枠ごとの系統が変わらないので、枠ごとに段階を比べられる
// 攻撃系の枠の強さの合計（II=1・III=2・EX=3）。「攻撃は下げない」の判定に使う
function attackTierPoints(bonusIds) {
  return bonusIds.reduce((sum, bonusId) =>
    sum + (bonusId !== null && bonusCategoryId(bonusId) === 0 ? bonusTierRank(bonusId) : 0), 0);
}

function ownedRollMatches(weapon, bonusIds) {
  // 攻撃は下げない：今のボーナスが分かる武器は、攻撃の枠の強さの合計が下がる結果を一致にしない
  if (weapon.keepAttack !== false && ownedBonusesKnown(weapon)
    && attackTierPoints(bonusIds) < attackTierPoints(weapon.bonuses)) return false;
  if (weapon.rule === "ex" || !ownedBonusesKnown(weapon)) {
    return weapon.rule === "ex" && weapon.minEx > 0
      && bonusIds.filter((bonusId) => EX_BONUS_IDS.has(bonusId)).length >= weapon.minEx;
  }
  const diffs = bonusIds.map((bonusId, slotIndex) =>
    bonusTierRank(bonusId) - bonusTierRank(weapon.bonuses[slotIndex]));
  if (weapon.rule === "total") return diffs.reduce((sum, diff) => sum + diff, 0) > 0;
  return diffs.every((diff) => diff >= 0) && diffs.some((diff) => diff > 0);
}

function ownedRuleText(weapon) {
  const keep = weapon.keepAttack !== false && ownedBonusesKnown(weapon) ? "・攻撃は下げない" : "";
  if (weapon.rule === "ex") return `EX ${weapon.minEx}個以上${keep}`;
  if (!ownedBonusesKnown(weapon)) return "今のボーナスを入れると判定できます";
  return `${weapon.rule === "total" ? "合計で今より強い" : "今より強い（上位互換）"}${keep}`;
}

function persistBonusWishes() {
  try {
    localStorage.setItem(BONUS_WISHES_KEY, JSON.stringify(bonusWishes));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

// 希望の持ち方は2通り：mode "counts"＝系統の数（順不同・段階は区別しない）、
// mode "slots"＝5枠を1つずつ（系統 c：-1=何でも、段階 lv：0=問わず／2=III以上／3=EXだけ。並びは順不同）

function normalizeWishSlots(slots) {
  return Array.from({ length: 5 }, (_, index) => {
    const slot = Array.isArray(slots) ? slots[index] : null;
    const c = Math.trunc(Number(slot?.c));
    const lv = Math.trunc(Number(slot?.lv));
    return {
      c: c >= 0 && c <= 3 ? c : -1,
      lv: [0, 2, 3].includes(lv) ? lv : 0,
    };
  });
}

function bonusWishFor(weaponType) {
  const entry = bonusWishes[weaponType];
  return {
    mode: entry?.mode === "slots" ? "slots" : "counts",
    counts: BONUS_WISH_MAX.map((max, category) =>
      Math.max(0, Math.min(max, Math.trunc(Number(entry?.counts?.[category]) || 0)))),
    slots: normalizeWishSlots(entry?.slots),
    // 攻撃EXは最低○個（0＝指定なし）。攻撃が下がる結果を一致にしないための条件
    minAttackEx: Math.max(0, Math.min(5, Math.trunc(Number(entry?.minAttackEx) || 0))),
  };
}

function bonusWishTotal(wish) {
  return wish.counts.reduce((sum, count) => sum + count, 0);
}

// 「何でも・段階は問わず」以外の枠が1つでもあれば、希望ありとみなす
function activeWishSlots(wish) {
  return wish.slots.filter((slot) => slot.c >= 0 || slot.lv > 0);
}

function bonusWishActive(wish) {
  if (wish.minAttackEx > 0) return true;
  return wish.mode === "slots"
    ? activeWishSlots(wish).length > 0
    : bonusWishTotal(wish) > 0;
}

function attackExCount(bonusIds) {
  return bonusIds.filter((bonusId) => EX_BONUS_IDS.has(bonusId) && bonusCategoryId(bonusId) === 0).length;
}

function bonusFitsSlot(bonusId, slot) {
  return (slot.c < 0 || bonusCategoryId(bonusId) === slot.c) && bonusTierRank(bonusId) >= slot.lv;
}

// 5枠指定の希望と結果の組み合わせ。条件の厳しい枠から順に、結果の枠を1つずつ割り当てる。
// 全部割り当てられたら matched=true。返す used は「希望の枠に当てはまった結果の枠」の番号
function slotWishAssignment(wish, bonusIds) {
  const slots = activeWishSlots(wish)
    .sort((a, b) => (b.lv - a.lv) || ((b.c >= 0) - (a.c >= 0)));
  const taken = new Array(bonusIds.length).fill(false);
  const assign = (slotIndex) => {
    if (slotIndex === slots.length) return true;
    for (let i = 0; i < bonusIds.length; i += 1) {
      if (taken[i] || !bonusFitsSlot(bonusIds[i], slots[slotIndex])) continue;
      taken[i] = true;
      if (assign(slotIndex + 1)) return true;
      taken[i] = false;
    }
    return false;
  };
  if (slots.length > 0 && assign(0)) {
    return { matched: true, used: new Set(taken.flatMap((value, i) => (value ? [i] : []))) };
  }
  // 一致しないときも、当てはまる枠はできるだけ強調する
  taken.fill(false);
  for (const slot of slots) {
    const i = bonusIds.findIndex((bonusId, index) => !taken[index] && bonusFitsSlot(bonusId, slot));
    if (i >= 0) taken[i] = true;
  }
  return { matched: false, used: new Set(taken.flatMap((value, i) => (value ? [i] : []))) };
}

function wishSlotText(weaponType, slot) {
  const categoryName = slot.c < 0
    ? "何でも"
    : (keepCategoriesForWeapon(weaponType, 1).find(([category]) => category === slot.c)?.[1]
      ?? GOGMA_BONUS_CATEGORIES[slot.c][1]);
  if (slot.lv === 3) return `${categoryName}EX`;
  if (slot.lv === 2) return slot.c === 0 || slot.c === 1 ? `${categoryName}III以上` : `${categoryName}EX`;
  return categoryName;
}

// 狙い（リセット）は武器種ごとの希望、手持ち（同じ構成）は武器ごとのEX数
function targetHasWish(target) {
  return target.kind === "owned"
    ? (target.rule === "ex" ? target.minEx > 0 : ownedBonusesKnown(target)) || bonusWishActive(bonusWishFor(target.weaponType))
    : bonusWishActive(bonusWishFor(target.weaponType));
}

function targetWishText(target) {
  return target.kind === "owned"
    ? `同じ構成で${ownedRuleText(target)}${bonusWishActive(bonusWishFor(target.weaponType)) ? `、または希望：${bonusWishText(target.weaponType)}` : ""}`
    : `リセットで ${bonusWishText(target.weaponType)}`;
}

function bonusWishText(weaponType) {
  const base = bonusWishBaseText(weaponType);
  const wish = bonusWishFor(weaponType);
  if (wish.minAttackEx <= 0) return base;
  const extra = `攻撃EX${wish.minAttackEx}個以上`;
  return base === "指定なし" ? extra : `${base}＋${extra}`;
}

function bonusWishBaseText(weaponType) {
  const wish = bonusWishFor(weaponType);
  if (wish.mode === "slots") {
    // 同じ指定はまとめる（例：攻撃EX×2＋攻撃×2＋属性EX）
    const grouped = new Map();
    for (const slot of activeWishSlots(wish)) {
      const text = wishSlotText(weaponType, slot);
      grouped.set(text, (grouped.get(text) ?? 0) + 1);
    }
    const slotParts = [...grouped].map(([text, count]) => (count > 1 ? `${text}×${count}` : text));
    return slotParts.length > 0 ? slotParts.join("＋") : "指定なし";
  }
  const parts = keepCategoriesForWeapon(weaponType, 1)
    .filter(([category]) => wish.counts[category] > 0)
    .map(([category, name]) => `${name}×${wish.counts[category]}`);
  return parts.length > 0 ? parts.join("＋") : "指定なし";
}

// リセット：系統の数（順不同・II/III/EXは区別しない）を満たすか。手持ち：EXの数が最低数以上か
function rollMatchesBonusWish(target, bonusIds) {
  if (target.kind === "owned" && ownedRollMatches(target, bonusIds)) return true;
  return configuredBonusWishMatches(target.weaponType, bonusIds);
}

// 武器ごとの「今より強い」とは別に、設定した希望全体の一致だけを判定する。
function configuredBonusWishMatches(weaponType, bonusIds) {
  if (!Array.isArray(bonusIds) || bonusIds.length !== 5 || bonusIds.some((id) => ![6, 8, 9, 10, 11, 12, 13, 14, 15, 16].includes(id))) return false;
  const wish = bonusWishFor(weaponType);
  if (attackExCount(bonusIds) < wish.minAttackEx) return false;
  const hasBase = wish.mode === "slots" ? activeWishSlots(wish).length > 0 : bonusWishTotal(wish) > 0;
  // 攻撃EXの最低数だけが決まっているときは、それだけで判定する
  if (!hasBase) return wish.minAttackEx > 0;
  if (wish.mode === "slots") return slotWishAssignment(wish, bonusIds).matched;
  const total = bonusWishTotal(wish);
  if (total > 5) return false;
  const counts = [0, 0, 0, 0];
  for (const bonusId of bonusIds) counts[bonusCategoryId(bonusId)] += 1;
  return wish.counts.every((need, category) => counts[category] >= need);
}

function normalizeBonusWeaponOrder(saved) {
  const defaults = [11, 7, ...WEAPON_TYPES.map(([id]) => id).filter((id) => ![11, 7, 3].includes(id)), 3];
  return [...new Set([...(Array.isArray(saved) ? saved : []), ...defaults])]
    .filter((id) => Number.isInteger(id) && id >= 0 && id < WEAPON_TYPES.length);
}

function orderBonusTargets(targets) {
  const ranks = new Map(loadBonusView().weaponOrder.map((id, rank) => [id, rank]));
  return [...targets].sort((a, b) => ranks.get(a.weaponType) - ranks.get(b.weaponType));
}

function appendWeaponMatchItem(half, weaponType, item) {
  let group = half.groups.get(weaponType);
  if (!group) {
    const section = document.createElement("section");
    section.className = "match-weapon-group"; section.dataset.weaponType = String(weaponType);
    const heading = document.createElement("h4"); heading.className = "match-weapon-heading";
    heading.append(t(optionName(WEAPON_TYPES, weaponType)));
    const count = document.createElement("small"); heading.append(count);
    const items = document.createElement("div"); items.className = "match-weapon-items";
    section.append(heading, items); half.items.append(section);
    group = { items, count }; half.groups.set(weaponType, group);
  }
  group.items.append(item); group.count.textContent = `${group.items.childElementCount}件`;
}

function createBonusGoalBadge(weaponType) {
  const badge = document.createElement("strong"); badge.className = "bonus-goal-badge";
  badge.textContent = "★ 希望ボーナス一致"; badge.title = bonusWishText(weaponType);
  return badge;
}

function renderBonusWeaponOrder() {
  const details = document.querySelector("#bonus-weapon-order");
  if (!details) return;
  const active = new Set([...comparisonTargets, ...ownedWeapons].map((target) => target.weaponType));
  const order = loadBonusView().weaponOrder;
  const visible = order.filter((type) => active.has(type));
  const list = document.createElement("div"); list.className = "bonus-weapon-order-list";
  const save = (nextOrder, weaponType, control) => {
    const view = loadBonusView(); view.weaponOrder = nextOrder; persistBonusView(view);
    if (bonusWishSection) {
      const rows = [...bonusWishSection.querySelectorAll(":scope > details[data-weapon-type]")];
      rows.sort((a, b) => nextOrder.indexOf(Number(a.dataset.weaponType)) - nextOrder.indexOf(Number(b.dataset.weaponType)));
      bonusWishSection.append(...rows);
    }
    renderComparisonTable();
    const row = details.querySelector(`[data-order-weapon="${weaponType}"]`);
    const next = row?.querySelector(`[data-move="${control}"]:not(:disabled)`) ?? row?.querySelector("strong");
    next?.focus();
  };
  visible.forEach((type, index) => {
    const row = document.createElement("div"); row.className = "bonus-weapon-order-row"; row.dataset.orderWeapon = String(type);
    const name = document.createElement("strong"); name.textContent = t(optionName(WEAPON_TYPES, type)); name.tabIndex = -1;
    row.append(name);
    for (const [control, text, destination] of [["first", "先頭へ", 0], ["up", "↑", index - 1], ["down", "↓", index + 1], ["last", "末尾へ", visible.length - 1]]) {
      const button = document.createElement("button"); button.type = "button"; button.className = "secondary small-button";
      button.textContent = text; button.dataset.move = control;
      button.setAttribute("aria-label", `${name.textContent}を${control === "up" ? "上へ" : control === "down" ? "下へ" : text}`);
      button.disabled = destination < 0 || destination >= visible.length || destination === index;
      button.addEventListener("click", () => {
        const nextVisible = [...visible]; nextVisible.splice(index, 1); nextVisible.splice(destination, 0, type);
        let nextIndex = 0; const nextOrder = order.map((id) => active.has(id) ? nextVisible[nextIndex++] : id);
        save(nextOrder, type, control);
      });
      row.append(button);
    }
    list.append(row);
  });
  const hint = document.createElement("p"); hint.className = "pool-note";
  hint.textContent = "一致欄を武器種の見出しでまとめます。上から順に表示し、このブラウザに保存します。初期順は弓・ガンランスが先頭、太刀が最後です。";
  const reset = document.createElement("button"); reset.type = "button"; reset.className = "text-button"; reset.textContent = "初期順に戻す";
  reset.addEventListener("click", () => save(normalizeBonusWeaponOrder(null), visible[0], "up"));
  details.replaceChildren(Object.assign(document.createElement("summary"), { textContent: "武器種の見出し・並び順" }), hint, list, reset);
}

// 画面の予測範囲や古い比較表に依存せず、現在地点から次の1回を計算する。
async function upcomingBonusWishMatches(model, selectedTarget) {
  const { baseSeed: seed, bonusCounter: counter } = model.saveState;
  if (!Number.isSafeInteger(seed) || !Number.isSafeInteger(counter) || counter < 0 || counter >= 4_294_967_295) return null;
  await ensurePredictionWasm();
  const resets = new Map();
  for (const target of [...uniqueTargetsByCombination(), ...model.ownedWeapons, ...(selectedTarget ? [selectedTarget] : [])]) {
    if (!Number.isInteger(target.attributeForce) || !bonusWishActive(bonusWishFor(target.weaponType))) continue;
    resets.set(comparisonCombinationKey(target), target);
  }
  const matches = [];
  for (const target of orderBonusTargets([...resets.values()])) {
    const roll = Array.from(predict_gogma_rolls(seed, target.weaponType, target.attributeForce, counter, 35, 1));
    if (configuredBonusWishMatches(target.weaponType, roll)) matches.push({ ...target, method: "reset", bonuses: roll, wish: bonusWishText(target.weaponType) });
  }
  const keeps = [...model.ownedWeapons];
  if (selectedTarget?.categories && !keeps.some((weapon) => weapon.id === selectedTarget.id)) keeps.push(selectedTarget);
  for (const target of orderBonusTargets(keeps)) {
    if (!Number.isInteger(target.attributeForce) || !Array.isArray(target.categories) || target.categories.length !== 5 || !target.categories.every((c) => Number.isInteger(c) && c >= 0 && c <= 3) || !bonusWishActive(bonusWishFor(target.weaponType))) continue;
    const roll = Array.from(predict_gogma_keep_rolls(seed, target.weaponType, target.attributeForce, counter, 35, 1, new Uint8Array(target.categories)));
    if (configuredBonusWishMatches(target.weaponType, roll)) matches.push({ ...target, method: "keep", bonuses: roll, wish: bonusWishText(target.weaponType) });
  }
  return { counter, nextCounter: counter + 1, matches };
}

// 開け閉めする欄の共通処理：初期は閉じる・開閉を覚える・「クリックで開きます」の案内を付ける
function setupCollapsible(details, summary, key, openText = "クリックで設定欄が開きます") {
  details.classList.add("collapsible");
  details.open = openDetailKeys.has(key);
  details.addEventListener("toggle", () => {
    if (details.open) openDetailKeys.add(key);
    else openDetailKeys.delete(key);
  });
  const hint = document.createElement("span");
  hint.className = "collapsible-hint";
  const closed = document.createElement("span");
  const opened = document.createElement("span");
  closed.className = "when-closed";
  opened.className = "when-open";
  closed.textContent = `▶ ${openText}`;
  opened.textContent = "▼ クリックで閉じます";
  hint.append(closed, opened);
  summary.append(hint);
}

// 既にある要素を、開け閉めできる欄で包む
function wrapInCollapsible(element, key, titleText, openText) {
  const details = document.createElement("details");
  const summary = document.createElement("summary");
  const title = document.createElement("span");
  title.className = "collapsible-title";
  title.textContent = titleText;
  summary.append(title);
  element.before(details);
  details.append(summary, element);
  setupCollapsible(details, summary, key, openText);
  return { details, title };
}

function loadBonusView() {
  const saved = loadJsonObject(BONUS_VIEW_KEY);
  return {
    registration: saved.registration === "owned" ? "owned" : "reset",
    matchesOnly: saved.matchesOnly !== false,
    showAllColumns: saved.showAllColumns === true,
    // 手持ち武器の登録欄で直前に選んだもの（次の登録でも同じものを選んだ状態にする）
    ownedForm: saved.ownedForm && typeof saved.ownedForm === "object" ? saved.ownedForm : {},
    // 武器種ごとに使った「種類」（例：弓→貫通、ガンランス→通常）。名前の自動入力の候補にする
    subtypeHistory: saved.subtypeHistory && typeof saved.subtypeHistory === "object" ? saved.subtypeHistory : {},
    // 手持ち武器の一覧の並べ方：manual＝登録した順（↑↓で並び替え）、type＝武器種ごと
    ownedSort: saved.ownedSort === "type" ? "type" : "manual",
    weaponOrder: normalizeBonusWeaponOrder(saved.weaponOrder),
  };
}
function persistBonusView(view) {
  try {
    localStorage.setItem(BONUS_VIEW_KEY, JSON.stringify(view));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}
// 画面を「大枠A：登録した武器をまとめて予測（①登録 ②希望 ③結果）」と
// 「大枠B：1つの武器だけを詳しく調べる」に分けて、何の話かを分かりやすくする
function setupComparisonFrames() {
  const section = document.querySelector(".comparison-section");
  if (!section) return;
  section.classList.add("big-frame", "big-frame-main");
  const heading = section.querySelector(".comparison-heading h2, .comparison-heading h3");
  if (heading) heading.textContent = "登録した武器をまとめて予測";

  const createStep = (number, title, description) => {
    const frame = document.createElement("section");
    const header = document.createElement("div");
    const badge = document.createElement("span");
    const titleEl = document.createElement("h3");
    const descriptionEl = document.createElement("p");
    frame.className = "step-frame";
    header.className = "step-frame-header";
    badge.className = "step-frame-number";
    badge.textContent = number;
    titleEl.textContent = title;
    descriptionEl.className = "step-frame-description";
    descriptionEl.textContent = description;
    header.append(badge, titleEl);
    frame.append(header, descriptionEl);
    return frame;
  };

  const step1 = createStep("1", "狙いの武器を登録する",
    "リセットして再復元で狙う武器種・属性を登録します。持っている武器を「同じ構成で再復元」してEXを厳選したいときは、上の「ゲーム内で行う再復元」で「ボーナスを同じ構成で再復元」を選ぶと、手持ち武器の登録欄が開きます。");
  step1.append(...[
    document.querySelector(".comparison-settings"),
    document.querySelector(".comparison-actions"),
    comparisonTargetList,
    comparisonError,
  ].filter(Boolean));

  // 手持ち武器の登録欄は「ゲーム内で行う再復元」の2つのボタンのすぐ下に置く
  const operationSelector = document.querySelector("#bonus-operation-selector");
  if (operationSelector) operationSelector.after(ownedWeaponSection);
  else step1.append(ownedWeaponSection);

  const step2 = createStep("2", "希望ボーナスを決める（狙い）",
    "武器種ごとに希望ボーナスを決めます（系統の数か、5枠を1つずつ）。リセット・同じ構成どちらも、希望をすべて満たす結果は金枠で強調します。手持ち条件だけに一致する結果は青緑で区別します。");
  step2.append(bonusWishSection);

  const step3 = createStep("3", "結果を見る",
    "「次の一致」（どの武器があと何回で希望どおりになるか）は、このタブの一番上にあります。この下の表は、何回先ごとの詳しい結果です。");
  // 「次の一致」はよく見るので、タブの一番上に出し、開け閉めできるようにする（最初は開いている）
  openDetailKeys.add("next-match");
  const nextMatch = wrapInCollapsible(bonusWishSummary, "next-match", "次の一致", "クリックで閉じます／開きます");
  nextMatch.details.classList.add("next-match-details");
  bonusWishDetails = nextMatch.details;
  bonusWishDetails.hidden = bonusWishSummary.hidden;
  document.querySelector('[data-tab-view="bonus-future"]')?.prepend(bonusWishDetails);
  const tableHeading = document.createElement("div");
  tableHeading.className = "step-subheading";
  const tableTitle = document.createElement("h4");
  const tableDescription = document.createElement("p");
  tableTitle.textContent = "回ごとの結果表";
  tableDescription.textContent = "1行が「何回先」の1回分です。「一致」列に、その回に希望どおりになる武器が出ます。採用するときは、その武器の「採用して〜」ボタンか、左の「ここを0にする」を押します。下の設定は、この表の表示を切り替えるものです。";
  tableHeading.append(tableTitle, tableDescription);
  step3.append(...[
    tableHeading,
    comparisonTableWrap,
    document.querySelector(".bonus-export-actions"),
    document.querySelector(".comparison-section .adoption-note"),
  ].filter(Boolean));
  const adoptionNote = step3.querySelector(".adoption-note");
  if (adoptionNote) {
    adoptionNote.textContent = "「ここを0にする」は、ゲーム内でその回まで進めてセーブしたときに押します。「採用して手持ちに登録」「採用して手持ちを更新」は、0地点を進めるのと手持ち武器の登録・更新をまとめて行います。";
  }

  const firstStepAnchor = section.querySelector(".prediction-intro") ?? section.querySelector(".comparison-heading");
  firstStepAnchor.after(step1, step2, step3);

  // 登録済みの武器のリストは長くなるので、最初は閉じておく（件数だけ見せる）
  wrapInCollapsible(comparisonTargetList, "registered-list", "登録済みの狙い", "クリックで一覧が開きます");
  wrapInCollapsible(skillTargetList, "skill-registered-list", "登録済みの武器", "クリックで一覧が開きます");
  updateRegisteredListTitles();

  // スキル未来予測タブにも手持ち武器の登録欄を出す（持っているスキルの登録用。最初は閉じる）
  skillOwnedContainer = document.createElement("section");
  skillOwnedContainer.className = "bonus-wish-settings owned-weapon-settings";
  skillOwnedContainer.dataset.ownedWhere = "skill";
  skillTargetList.closest("details")?.after(skillOwnedContainer);
  wrapInCollapsible(skillOwnedContainer, "skill-owned", "手持ち武器（持っているスキルの登録・編集）", "クリックで開きます（03 手持ち武器タブと同じ内容です）");

  // 大枠B：「1条件を詳しく絞り込む」は別の調べ方。普段は閉じておく
  if (detailPredictionSection) {
    detailPredictionSection.classList.add("big-frame", "big-frame-detail");
    const note = document.createElement("p");
    note.className = "big-frame-note";
    note.textContent = "ここは上とは別の調べ方です。登録しなくても、1つの武器種・属性だけを選んで、II・III・EXまで細かく指定して探せます（seed検索の直後に、入力した結果と予測が合っているかの確認にも使えます）。";
    const detailHeading = detailPredictionSection.querySelector(".section-heading") ?? detailPredictionSection.firstElementChild;
    const body = document.createElement("div");
    body.className = "detail-collapsible-body";
    body.append(...[...detailPredictionSection.children].filter((child) => child !== detailHeading));
    detailPredictionSection.append(note, body);
    wrapInCollapsible(body, "detail-section", "1つの武器を細かい条件で調べる", "クリックで開きます");
  }
}

function updateRegisteredListTitles() {
  const resetTitle = comparisonTargetList.closest("details")?.querySelector(".collapsible-title");
  if (resetTitle) resetTitle.textContent = `登録済みの狙い（${comparisonTargets.length}件）`;
  const skillTitle = skillTargetList.closest("details")?.querySelector(".collapsible-title");
  if (skillTitle) skillTitle.textContent = `登録済みの武器（${uniqueTargetsByCombination().length}件）`;
}

// 登録欄の切り替え：「狙い（リセット）」と「手持ち武器（同じ構成）」のどちらか一方だけを出す
// 「ゲーム内で行う再復元」の説明を、手持ち武器の登録欄の開け閉めに合わせて書き直す
function setupRegistrationSwitch() {
  const intro = document.querySelector(".comparison-section .prediction-intro");
  if (intro) {
    intro.textContent = "登録した武器ぜんぶについて、これから何回再復元すると希望のボーナスが出るかを予測します。①で狙いの武器を登録し、②で希望を決めると、③に結果が出ます（上で登録した手持ち武器も③に出ます）。";
  }
  const operationSection = document.querySelector(".bonus-operation-section");
  const description = operationSection?.querySelector("p:not(.step)");
  if (description) {
    description.textContent = "「ボーナスを同じ構成で再復元」を選ぶと、手持ち武器（同じ構成で再復元してEXを厳選する武器）の登録欄が下に開きます。どちらを選んでも、下の結果には狙い（リセット）と手持ち武器（同じ構成）の両方が出ます。";
  }
  renderBonusOperation();
}

// 表のすぐ上に「表示する回数」と表示の切り替えをまとめる
function setupComparisonTableOptions() {
  const view = loadBonusView();
  const bar = document.createElement("div");
  bar.className = "comparison-table-options";
  const countLabel = comparisonCountInput.closest("label");
  if (countLabel) bar.append(countLabel);

  const makeToggle = (text, checked, onChange) => {
    const label = document.createElement("label");
    const input = document.createElement("input");
    const span = document.createElement("span");
    label.className = "checkbox-label";
    input.type = "checkbox";
    input.checked = checked;
    span.textContent = text;
    input.addEventListener("change", () => onChange(input.checked));
    label.append(input, span);
    bar.append(label);
    return input;
  };
  bonusWishMatchesOnly = makeToggle("表は、希望ボーナスに一致した行だけ表示", view.matchesOnly, (checked) => {
    const next = loadBonusView();
    next.matchesOnly = checked;
    persistBonusView(next);
    renderComparisonTable();
  });
  showAllComparisonColumns = makeToggle("表に、登録した全武器の結果も1列ずつ並べる（横に長くなり、横スクロールで見ます）", view.showAllColumns, (checked) => {
    const next = loadBonusView();
    next.showAllColumns = checked;
    persistBonusView(next);
    renderComparisonTable();
  });
  const countHint = document.createElement("p");
  countHint.className = "comparison-table-options-hint";
  countHint.textContent = "「表示する回数」は、何回先まで予測するかです（上の「次の一致」にも使われます）。";
  bar.append(countHint);
  const weaponOrder = document.createElement("details"); weaponOrder.id = "bonus-weapon-order"; weaponOrder.className = "bonus-weapon-order";
  bar.append(weaponOrder);
  comparisonTableWrap.before(bar);
  setupTableScrollMirrors();
}

function renderBonusWishSection() {
  if (!bonusWishSection) {
    bonusWishSection = document.createElement("section");
    bonusWishSection.className = "bonus-wish-settings";
    document.querySelector(".bonus-ex-filter-settings")?.after(bonusWishSection);
    bonusWishSummary = document.createElement("div");
    bonusWishSummary.className = "bonus-wish-summary";
    bonusWishSummary.hidden = true;
    comparisonTableWrap.before(bonusWishSummary);
    ownedWeaponSection = document.createElement("section");
    ownedWeaponSection.className = "bonus-wish-settings owned-weapon-settings";
    bonusWishSection.after(ownedWeaponSection);
    // 「EX数で絞り込む」は「一致」＋「一致した行だけ表示」と役割がかぶるので使わない
    const exFilterBox = document.querySelector(".bonus-ex-filter-settings");
    if (exFilterBox) exFilterBox.style.display = "none";
    bonusExFilterEnabled.checked = false;
    setupComparisonFrames();
    setupRegistrationSwitch();
    setupComparisonTableOptions();
  }
  renderOwnedWeaponSection();

  const weaponTypes = [...new Set(comparisonTargets.map((target) => target.weaponType))]
    .sort((a, b) => loadBonusView().weaponOrder.indexOf(a) - loadBonusView().weaponOrder.indexOf(b));

  const intro = document.createElement("div");
  intro.className = "skill-filter-intro";
  const title = document.createElement("strong");
  title.textContent = "狙い（リセットして再復元）の希望ボーナス";
  const description = document.createElement("p");
  description.textContent = "上で登録した武器種ごとに、リセットで欲しいボーナスを決めます（系統の数か、5枠を1つずつ。どちらも順不同）。当たりは表の「一致」列に出ます。設定はこのブラウザに保存されます。";
  description.textContent += "手持ちの同じ構成の結果も、この希望をすべて満たすと金枠の「希望ボーナス一致」で表示します。手持ち条件だけの一致とは区別できます。";
  intro.append(title, description);

  if (weaponTypes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "weapon-filter-empty";
    empty.textContent = "武器を登録すると、ここに武器種ごとの設定欄が出ます。";
    bonusWishSection.replaceChildren(intro, empty);
    return;
  }

  const rows = weaponTypes.map((weaponType) => {
    const row = document.createElement("details");
    row.className = "weapon-filter-row";
    row.dataset.weaponType = String(weaponType);

    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "weapon-filter-name";
    name.textContent = t(optionName(WEAPON_TYPES, weaponType));
    const state = document.createElement("span");
    state.className = "weapon-filter-state";
    const updateState = () => {
      state.textContent = bonusWishText(weaponType);
    };
    updateState();
    summary.append(name, state);
    setupCollapsible(row, summary, `bonus-wish:${weaponType}`);

    const wish = bonusWishFor(weaponType);
    const categoryFieldset = document.createElement("fieldset");
    categoryFieldset.className = "bonus-wish-categories";
    const legend = document.createElement("legend");
    legend.textContent = "リセットして再復元で狙う系統の数（5枠中）";
    const categoryGrid = document.createElement("div");
    categoryGrid.className = "bonus-wish-grid";
    const categorySelects = new Map();
    for (const [category, categoryName] of keepCategoriesForWeapon(weaponType, 1)) {
      const label = document.createElement("label");
      const text = document.createElement("span");
      const select = document.createElement("select");
      text.textContent = categoryName;
      populateSelect(
        select,
        Array.from({ length: BONUS_WISH_MAX[category] + 1 }, (_, count) => [count, count === 0 ? "—" : `${count}枠`]),
        wish.counts[category],
      );
      label.append(text, select);
      categoryGrid.append(label);
      categorySelects.set(category, select);
    }
    const total = document.createElement("p");
    total.className = "bonus-wish-total";
    categoryFieldset.append(legend, categoryGrid, total);

    // 指定のしかた：系統の数／5枠を1つずつ
    const modeBox = document.createElement("div");
    modeBox.className = "bonus-wish-mode";
    const modeRadios = [
      ["counts", "系統の数で指定（段階は区別しない）"],
      ["slots", "5枠を1つずつ指定（EX・III以上も指定できる）"],
    ].map(([value, text]) => {
      const label = document.createElement("label");
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `bonus-wish-mode-${weaponType}`;
      radio.value = value;
      radio.checked = wish.mode === value;
      label.append(radio, text);
      modeBox.append(label);
      return radio;
    });

    // 5枠を1つずつ：系統（何でも／攻撃…）＋段階（問わず／III以上／EXだけ）。並びは順不同
    const slotFieldset = document.createElement("fieldset");
    slotFieldset.className = "bonus-wish-categories";
    const slotLegend = document.createElement("legend");
    slotLegend.textContent = "5枠の希望（並び順は関係なし。いらない枠は「何でも」のまま）";
    const slotList = document.createElement("div");
    slotList.className = "bonus-wish-slots";
    const categoryOptions = [[-1, "何でも"], ...keepCategoriesForWeapon(weaponType, 1)];
    const slotSelects = wish.slots.map((slot, index) => {
      const line = document.createElement("label");
      line.className = "bonus-wish-slot";
      const text = document.createElement("span");
      text.textContent = `${index + 1}枠目`;
      const categorySelect = document.createElement("select");
      populateSelect(categorySelect, categoryOptions, slot.c);
      const levelSelect = document.createElement("select");
      // III があるのは攻撃・会心だけ。属性・斬れ味・何でもは「問わず／EXだけ」
      const fillLevels = (selected) => {
        const category = Number(categorySelect.value);
        const levels = category === 0 || category === 1
          ? BONUS_SLOT_LEVELS
          : BONUS_SLOT_LEVELS.filter(([level]) => level !== 2);
        const value = levels.some(([level]) => level === selected) ? selected : (selected === 2 ? 3 : 0);
        populateSelect(levelSelect, levels, value);
      };
      fillLevels(slot.lv);
      categorySelect.addEventListener("change", () => fillLevels(Number(levelSelect.value)));
      line.append(text, categorySelect, levelSelect);
      slotList.append(line);
      return { categorySelect, levelSelect, fillLevels };
    });
    slotFieldset.append(slotLegend, slotList);

    // 攻撃が下がる結果を一致にしないための条件：攻撃EXは最低○個（どちらの指定のしかたでも使える）
    const minAttackLabel = document.createElement("label");
    const minAttackText = document.createElement("span");
    const minAttackSelect = document.createElement("select");
    minAttackLabel.className = "bonus-wish-min-attack";
    minAttackText.textContent = "攻撃EXは最低（攻撃が下がる結果を一致にしない）";
    populateSelect(
      minAttackSelect,
      [0, 1, 2, 3, 4, 5].map((count) => [count, count === 0 ? "指定なし" : `攻撃EX ${count}個以上`]),
      wish.minAttackEx,
    );
    minAttackLabel.append(minAttackText, minAttackSelect);

    const updateModeView = () => {
      const slotsMode = modeRadios[1].checked;
      categoryFieldset.hidden = slotsMode;
      slotFieldset.hidden = !slotsMode;
    };
    updateModeView();

    const note = document.createElement("p");
    note.className = "weapon-filter-empty";
    note.textContent = weaponType === BOW_WEAPON_TYPE
      ? "弓は斬れ味・装填系が出ません。無属性の弓は属性も出ません。"
      : BOWGUN_WEAPON_TYPES.has(weaponType)
        ? "ボウガンは属性が出ません。装填系は2枠までです。"
        : "斬れ味は2枠まで、属性は4枠までです。無属性の武器は属性が出ません。";

    const updateTotal = () => {
      const sum = bonusWishTotal(bonusWishFor(weaponType));
      total.textContent = sum > 5 ? `合計 ${sum}枠：5枠を超えているので一致しません` : `合計 ${sum} / 5枠`;
      total.classList.toggle("over", sum > 5);
    };
    updateTotal();

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "text-button";
    clearButton.textContent = "この武器種の希望をクリア";

    const save = () => {
      const counts = [0, 0, 0, 0];
      categorySelects.forEach((select, category) => { counts[category] = Number(select.value); });
      const mode = modeRadios[1].checked ? "slots" : "counts";
      const slots = slotSelects.map(({ categorySelect, levelSelect }) => ({
        c: Number(categorySelect.value),
        lv: Number(levelSelect.value),
      }));
      const minAttackEx = Number(minAttackSelect.value);
      if (mode === "slots" || minAttackEx > 0 || counts.some((count) => count > 0)
        || slots.some((slot) => slot.c >= 0 || slot.lv > 0)) {
        bonusWishes[weaponType] = { mode, counts, slots, minAttackEx };
      } else {
        delete bonusWishes[weaponType];
      }
      persistBonusWishes();
      updateModeView();
      updateState();
      updateTotal();
      renderComparisonTable();
      // 下の「1条件を詳しく絞り込む」が同じ武器種なら、希望をそろえる
      if (predictionIgnoreTier.checked && Number(predictionWeaponSelect.value) === weaponType) {
        renderPredictionFilters();
        renderPredictionTable();
      }
    };
    categoryGrid.addEventListener("change", save);
    slotList.addEventListener("change", save);
    modeBox.addEventListener("change", save);
    minAttackLabel.addEventListener("change", save);
    clearButton.addEventListener("click", () => {
      minAttackSelect.value = "0";
      categorySelects.forEach((select) => { select.value = "0"; });
      slotSelects.forEach(({ categorySelect, fillLevels }) => {
        categorySelect.value = "-1";
        fillLevels(0);
      });
      save();
    });

    const body = document.createElement("div");
    body.className = "weapon-filter-body";
    body.append(modeBox, categoryFieldset, slotFieldset, minAttackLabel, note, clearButton);
    row.append(summary, body);
    return row;
  });

  bonusWishSection.replaceChildren(intro, ...rows);
}

// 武器ごとの「次の一致」と、カウンターの小さい順に並べた採用の順番
function renderBonusWishSummary() {
  if (!bonusWishSummary) return;
  const wishedTargets = comparisonRollSets.filter((target) => targetHasWish(target));
  if (!selectedCandidate || wishedTargets.length === 0) {
    bonusWishSummary.hidden = true;
    if (bonusWishDetails) bonusWishDetails.hidden = true;
    bonusWishSummary.replaceChildren();
    return;
  }

  const count = comparisonRollSets[0].rolls.length;
  const results = wishedTargets.map((target) => {
    const hits = [];
    target.rolls.forEach((roll, index) => {
      if (rollMatchesBonusWish(target, roll)) hits.push(index);
    });
    return { target, hits };
  });
  // 近い当たりから順に並べ、表示範囲内に当たりがない武器は最後にまとめる
  results.sort((a, b) => (a.hits[0] ?? Infinity) - (b.hits[0] ?? Infinity));

  const title = document.createElement("h3");
  title.textContent = `次の一致（表示中の${count.toLocaleString("ja-JP")}回の中）`;

  // 見出し付きの表：あと何回｜方法｜武器種・属性｜登録名｜希望｜結果（5枠）｜備考
  const list = document.createElement("table");
  list.className = "next-match-table";
  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  // 「通常アーティアなら」：同じ系統の組み合わせを、通常アーティアを作って狙うなら何本目か（系統だけの比べ）
  for (const label of ["あと何回", "方法", "武器種・属性", "登録名", "希望", "結果（5枠）", "通常アーティアなら", "備考", "採用"]) {
    const th = document.createElement("th");
    th.scope = "col";
    th.textContent = label;
    headRow.append(th);
  }
  head.append(headRow);
  const body = document.createElement("tbody");
  const cell = (className, ...children) => {
    const td = document.createElement("td");
    td.className = className;
    td.append(...children);
    return td;
  };
  for (const { target, hits } of results) {
    const row = document.createElement("tr");
    row.title = `条件：${targetWishText(target)}`;
    // 方法：「リセット・同構成」の両方を書き、該当する方だけ強調
    const method = document.createElement("span");
    method.className = "method-pair";
    const reset = document.createElement("span");
    const same = document.createElement("span");
    reset.textContent = "リセット";
    same.textContent = "同構成";
    reset.className = target.kind === "owned" ? "method-off" : "method-on reset";
    same.className = target.kind === "owned" ? "method-on owned" : "method-off";
    method.append(reset, "・", same);
    const wish = document.createElement("span");
    wish.className = "bonus-wish-next-target";
    wish.textContent = target.kind === "owned" ? ownedRuleText(target) : bonusWishText(target.weaponType);
    if (hits.length === 0) {
      row.classList.add("none");
      const none = document.createElement("span");
      none.textContent = "表示範囲内に一致なし（表示する回数を増やしてください）";
      row.append(
        cell("next-when", "—"), cell("next-method", method), cell("next-weapon", weaponAndAttributeText(target)),
        cell("next-label", target.label || "—"), cell("next-wish", wish), cell("next-result none-text", none),
        cell("next-artian", artianRouteText(target, count)), cell("next-note", ""),
        cell("next-action", ""),
      );
    } else {
      const others = results.filter((other) => other.target !== target && other.hits.includes(hits[0])).length;
      // その回の結果を採用するボタン（狙い：手持ちに登録／手持ち：手持ちを更新）
      const adoptButton = target.kind === "owned"
        ? createAdoptOwnedUpdateButton(target, target.rolls[hits[0]], hits[0] + 1)
        : createAdoptAsOwnedButton(target, target.rolls[hits[0]], hits[0] + 1);
      adoptButton.classList.add("match-adopt-button");
      row.append(
        cell("next-when", `あと${hits[0] + 1}回`), cell("next-method", method), cell("next-weapon", weaponAndAttributeText(target)),
        cell("next-label", target.label || "—"), cell("next-wish", wish),
        cell("next-result", createCompactBonusSet(target, target.rolls[hits[0]], true)),
        cell("next-artian", artianRouteText(target, count)),
        cell("next-note", others > 0 ? `同じ回にほか${others}武器も一致` : ""),
        cell("next-action", adoptButton),
      );
      if (configuredBonusWishMatches(target.weaponType, target.rolls[hits[0]])) {
        row.classList.add("bonus-goal-hit"); row.querySelector(".next-wish")?.append(createBonusGoalBadge(target.weaponType));
      }
    }
    body.append(row);
  }
  list.append(head, body);

  // 同じ回に2つの当たりが重なったら、他にも当たりがある武器はその次の当たりへずらす
  const plan = [];
  const usedIndices = new Set();
  let remaining = results.filter(({ hits }) => hits.length > 0);
  while (remaining.length > 0) {
    let best = null;
    for (const entry of remaining) {
      const index = entry.hits.find((hit) => !usedIndices.has(hit));
      if (index !== undefined && (best === null || index < best.index)) best = { entry, index };
    }
    if (best === null) {
      // 当たりが全部ほかと重なっている武器は、最初の当たりで「重なり」として出す
      for (const entry of remaining) plan.push({ target: entry.target, index: entry.hits[0] });
      break;
    }
    plan.push({ target: best.entry.target, index: best.index });
    usedIndices.add(best.index);
    remaining = remaining.filter((entry) => entry !== best.entry);
  }
  plan.sort((a, b) => a.index - b.index);

  const children = [title, list];
  if (plan.length > 0) {
    const planTitle = document.createElement("h3");
    planTitle.textContent = "採用の順番（例）";
    const planList = document.createElement("ol");
    planList.className = "bonus-wish-plan";
    let previous = 0;
    for (const { target, index } of plan) {
      const step = document.createElement("li");
      const advance = index + 1 - previous;
      const name = targetNameWithWeapon(target);
      const method = target.kind === "owned" ? "「同じ構成で再復元」" : "「リセットして再復元」";
      step.textContent = advance <= 0
        ? `${index + 1}回先：${name}（同じ回で別の武器と重なっています。どちらか1つを選んでください）`
        : advance === 1
          ? `${index + 1}回先：次の1回を${name}で${method}して採用・セーブ`
          : `${index + 1}回先：${advance - 1}回は別の武器で再復元して進める → ${advance}回目を${name}で${method}して採用・セーブ`;
      planList.append(step);
      previous = Math.max(previous, index + 1);
    }
    const planNote = document.createElement("p");
    planNote.textContent = "復元ボーナスカウンターは全武器・どちらの再復元でも共通なので、当たりまでの途中の再復元はどの武器で行っても1つずつ進みます。ただし、再復元した武器のボーナスは変わるので、採用済みの武器では進めないでください。採用したら、その行の「ここを0にする」で続きを予測できます（リセットの当たりは「採用して手持ちに登録」を押すと、0地点の更新と手持ち登録をまとめて行います）。";
    children.push(planTitle, planList, planNote);
  }

  bonusWishSummary.replaceChildren(...children);
  bonusWishSummary.hidden = false;
  if (bonusWishDetails) bonusWishDetails.hidden = false;
}

function loadOwnedWeapons() {
  try {
    const saved = JSON.parse(localStorage.getItem(OWNED_WEAPONS_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((weapon) =>
        Number.isSafeInteger(weapon?.weaponType) && weapon.weaponType >= 0 && weapon.weaponType <= 13 &&
        Number.isSafeInteger(weapon?.attributeForce) && weapon.attributeForce >= 0 && weapon.attributeForce <= 9)
      .slice(0, MAX_OWNED_WEAPONS)
      .map((weapon) => {
        const validIds = new Set(GOGMA_BONUSES.map(([id]) => id));
        const bonuses = Array.isArray(weapon.bonuses) && weapon.bonuses.length === 5
          ? weapon.bonuses.map((bonusId) => validIds.has(bonusId) ? bonusId : null)
          : [null, null, null, null, null];
        const savedCategories = normalizeKeepCategories(weapon.categories);
        const label = typeof weapon.label === "string" ? weapon.label.slice(0, 24) : "";
        const validIndex = (value, list) =>
          Number.isSafeInteger(value) && value >= 0 && value < list.length ? value : null;
        // 激化タイプが保存されていない以前の登録は、名前の「【攻撃激化】」などから読み取る
        const boostFromLabel = OWNED_BOOST_OPTIONS.find(([value]) => value && label.startsWith(`【${value}】`))?.[0] ?? "";
        return {
          id: typeof weapon.id === "string" && weapon.id ? weapon.id : createTargetId(),
          label,
          boost: OWNED_BOOST_OPTIONS.some(([value]) => value === weapon.boost) ? weapon.boost : boostFromLabel,
          subtype: typeof weapon.subtype === "string" ? weapon.subtype.slice(0, 14) : "",
          seriesIndex: validIndex(weapon.seriesIndex, SERIES_SKILLS),
          groupIndex: validIndex(weapon.groupIndex, GROUP_SKILLS),
          weaponType: weapon.weaponType,
          attributeForce: weapon.attributeForce,
          bonuses,
          // 今のボーナスが分かる枠はそこから系統を決める（以前の登録は系統だけのこともある）
          categories: bonuses.map((bonusId, slotIndex) =>
            bonusId === null ? savedCategories[slotIndex] : bonusCategoryId(bonusId)),
          rule: OWNED_RULE_OPTIONS.some(([value]) => value === weapon.rule)
            ? weapon.rule
            : (Array.isArray(weapon.bonuses) ? "upgrade" : "ex"),
          minEx: Math.max(1, Math.min(5, Math.trunc(Number(weapon.minEx) || 2))),
          keepAttack: weapon.keepAttack !== false,
          statReference: normalizeWeaponStatReference(weapon.statReference),
        };
      });
  } catch {
    return [];
  }
}

function persistOwnedWeapons() {
  try {
    localStorage.setItem(OWNED_WEAPONS_KEY, JSON.stringify(ownedWeapons));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function ownedWeaponProblem(weapon) {
  return keepLayoutProblem({ ...weapon, keepCategories: weapon.categories });
}

// 復元ボーナスを1枠も入れていない（スキルだけ登録した）武器か
function ownedBonusesEmpty(weapon) {
  return normalizeKeepCategories(weapon.categories).every((category) => category === null);
}

// 手持ちのスキルはグループ→シリーズの順で統一する。
function ownedSkillEntries(weapon) {
  return [
    ["group", GROUP_SKILLS[weapon.groupIndex]],
    ["series", SERIES_SKILLS[weapon.seriesIndex]],
  ].filter(([, skill]) => Boolean(skill));
}

function ownedSkillText(weapon) {
  return ownedSkillEntries(weapon).map(([, skill]) => skill).join(" + ");
}

function ownedWeaponAutoName(weapon) {
  const subtype = weapon.subtype || ownedSubtypeFor(weapon.weaponType, weapon.attributeForce, weapon.boost);
  const attribute = optionName(ATTRIBUTES, weapon.attributeForce).replace(/属性$/, "");
  if (!weapon.boost && !subtype) return "";
  return `${weapon.boost ? `【${weapon.boost}】` : ""}${[subtype, attribute].filter(Boolean).join(" ")}`;
}

// 既存の自動生成名だけ表示を整える。保存済みの名前や独自の名前は書き換えない。
function ownedWeaponSummaryName(weapon) {
  const label = weapon.label?.trim() || "";
  const automatic = ownedWeaponAutoName(weapon);
  if (!label) return automatic;
  if (!automatic) return label;
  const prefix = weapon.boost ? `【${weapon.boost}】` : "";
  const subtypes = [weapon.subtype || "", ownedSubtypeFor(weapon.weaponType, weapon.attributeForce, weapon.boost)];
  const attribute = optionName(ATTRIBUTES, weapon.attributeForce);
  const compact = (value) => value.replace(/\s+/g, "");
  const generated = subtypes.some((subtype) => [attribute, attribute.replace(/属性$/, "")]
    .some((attr) => compact(label) === compact(prefix + subtype + attr)));
  return generated ? automatic : label;
}

function createOwnedSummarySkills(weapon) {
  const wrap = document.createElement("span");
  wrap.className = "owned-summary-skills";
  wrap.setAttribute("aria-label", "所持スキル");
  const entries = ownedSkillEntries(weapon);
  for (const [kind, skill] of entries) {
    if (wrap.childElementCount > 0) {
      const plus = document.createElement("span");
      plus.className = "owned-skill-plus";
      plus.textContent = "+";
      wrap.append(plus);
    }
    const chip = document.createElement("span");
    chip.className = `skill-tag ${kind}`;
    chip.textContent = t(skill);
    wrap.append(chip);
  }
  if (entries.length === 0) wrap.textContent = "スキル未登録";
  return wrap;
}

function createOwnedSummaryBonuses(weapon) {
  const wrap = document.createElement("span");
  wrap.className = "owned-summary-bonuses";
  wrap.setAttribute("aria-label", "現在の復元ボーナス");
  const chips = createOwnedBonusChips(weapon);
  if (ownedBonusesKnown(weapon)) wrap.append(...chips.childNodes);
  else wrap.append(chips);
  return wrap;
}

// その武器種・属性で、同じシリーズ＋グループのスキルを持っている手持ち武器
function ownedSkillHolders(target, roll) {
  return ownedWeapons.filter((weapon) =>
    weapon.weaponType === target.weaponType
    && weapon.attributeForce === target.attributeForce
    && weapon.seriesIndex === roll.seriesIndex
    && weapon.groupIndex === roll.groupIndex);
}

// スキルは違っていても、同じ武器種・属性なら再付与の対象にできる。
function skillReplacementCandidates(target, roll) {
  return ownedWeapons.filter(weapon => weapon.weaponType === target.weaponType
    && weapon.attributeForce === target.attributeForce
    && (weapon.seriesIndex !== roll.seriesIndex || weapon.groupIndex !== roll.groupIndex));
}

function createSkillReplacementList(target, roll, completedRolls) {
  const candidates = skillReplacementCandidates(target,roll);
  if (!candidates.length) return null;
  const origin = {seed:saveState.baseSeed,counter:saveState.skillCounter};
  const section = document.createElement('section'); section.className='skill-replacement-list';
  const heading=document.createElement('h4');heading.textContent='付け替えに使える手持ち';
  const note=document.createElement('p');note.className='skill-coverage-note';note.textContent='同じ武器種・属性で、現在のスキルが違う武器です。選ぶと上書き内容を確認できます。';
  const grid=document.createElement('div');grid.className='skill-replacement-grid';
  for (const weapon of candidates) {
    const card=document.createElement('div');card.className='skill-replacement-item';
    const name=document.createElement('strong');appendSkillBoostLabel(name,weapon,weapon.boost,'手持ち：');
    const label=ownedWeaponSummaryName(weapon);
    if(label && label!==ownedWeaponAutoName(weapon)){const caption=document.createElement('span');caption.className='skill-replacement-name';caption.textContent=label;card.append(caption);}
    card.prepend(name);
    card.append(operationPreviewRow('今のスキル',createOwnedSummarySkills(weapon)),operationPreviewRow('今のボーナス',createOwnedBonusChips(weapon)));
    const button=document.createElement('button');button.type='button';button.className='keep-transition-button';button.textContent='この武器に付け替える';
    button.setAttribute('aria-label',skillBoostLabel(weapon,weapon.boost)+'のスキルを付け替える');
    button.addEventListener('click',()=>{
      const current=ownedWeapons.find(item=>item.id===weapon.id);
      if(!current || saveState.baseSeed!==origin.seed || saveState.skillCounter!==origin.counter) {
        void performConfirmedOperation(()=>{throw new Error('表示後に手持ち武器かカウンターが変わりました。最新の予測で選び直してください。');});return;
      }
      void adoptSkillToOwned(current,roll,completedRolls);
    });
    card.append(button);grid.append(card);
  }
  section.append(heading,note,grid);return section;
}

// 同じスキルの所持状況を激化別に判定する。激化不明の武器で全タイプを所持扱いにしない。
function skillBoostOwnership(target, roll) {
  const holders = ownedSkillHolders(target, roll);
  const boosts = OWNED_BOOST_OPTIONS.filter(([boost]) => boost).map(([boost]) => ({
    boost,
    holders: holders.filter((weapon) => weapon.boost === boost),
  }));
  const unknown = holders.filter((weapon) => !boosts.some(({ boost }) => weapon.boost === boost));
  return { boosts, unknown };
}

function skillBoostLabel(target, boost) {
  return `${weaponAndAttributeText(target)}（${boost || "激化未登録"}）${skillBoostFeature(target, boost)}`;
}

// チャアクの火水雷氷龍と状態異常、無属性スラアクの滅龍ビンを区別する。
function ownedSubtypeFor(weaponType, attributeForce, boost) {
  if (!OWNED_BOOST_OPTIONS.some(([value]) => value && value === boost)) return "";
  if (weaponType === 9) {
    if (boost === "攻撃激化") return "榴弾";
    if (!Number.isInteger(attributeForce) || attributeForce < 0 || attributeForce > 9) return "";
    return attributeForce >= 1 && attributeForce <= 5 ? "強属性" : "榴弾";
  }
  if (weaponType === 8) {
    if (!Number.isInteger(attributeForce) || attributeForce < 0 || attributeForce > 9) return "";
    if (attributeForce === 0) return "滅龍";
  }
  return OWNED_SUBTYPE_BY_BOOST[weaponType]?.[boost] ?? "";
}

function skillBoostFeature(target, boost) {
  if (!OWNED_BOOST_OPTIONS.some(([value]) => value && value === boost)) return "";
  if (target.weaponType === 12) {
    // 巨戟化前からの主な装填数変化。生産パーツ数が不明でも絶対装填数を捏造しない。
    const elemental = Number.isInteger(target.attributeForce) && target.attributeForce > 0 && target.attributeForce <= 9;
    const status = [6, 7, 8].includes(target.attributeForce);
    const loss = (elemental ? "・属性弾−1" : "") + (status ? "・状態異常弾−1" : "");
    const changes = boost === "攻撃激化" ? `通常Lv2+1${loss}`
      : boost === "会心激化" ? `通常/貫通Lv2+1・散弾Lv2−1${loss}`
        : "貫通Lv2+1・斬裂Lv1追加";
    return `【装填変化：${changes}】`;
  }
  let subtype = ownedSubtypeFor(target.weaponType, target.attributeForce, boost);
  if (target.weaponType === 11 && subtype && [6, 7, 8, 9].includes(target.attributeForce)) {
    subtype += `＋${({ 6: "毒", 7: "麻痺", 8: "睡眠", 9: "爆破" })[target.attributeForce]}`;
  }
  const featureNames = { 5: "響玉", 7: "砲撃", 8: "ビン", 9: "ビン", 11: "ビン", 13: "速射" };
  if (!subtype) return "";
  const name = target.weaponType === 13 ? "速射・物理弾Lv2" : featureNames[target.weaponType] ?? "特徴";
  const extra = target.weaponType === 13 && boost === "属性激化" && target.attributeForce > 0 ? "【属性弾装填：+1】" : "";
  return `【${name}：${subtype}${target.weaponType === 7 ? "型" : ""}】${extra}`;
}

function appendSkillBoostLabel(container, target, boost, prefix) {
  const boostName = document.createElement("span");
  boostName.className = "skill-boost-name";
  boostName.textContent = `（${boost || "激化未登録"}）`;
  const feature = document.createElement("span");
  feature.className = "skill-boost-feature";
  feature.textContent = skillBoostFeature(target, boost);
  container.append(`${prefix}${weaponAndAttributeText(target)}`, boostName, feature);
}

function ownedWeaponDefaultName(weapon) {
  return localizedTargetName(
    optionName(WEAPON_TYPES, weapon.weaponType),
    optionName(ATTRIBUTES, weapon.attributeForce),
  );
}

// 例：「攻III 攻EX 攻II 攻II 属EX」（今のボーナスが分からないときは「攻 攻 攻 攻 属」）
function ownedLayoutText(weapon) {
  if (ownedBonusesKnown(weapon)) {
    return weapon.bonuses.map((bonusId) => compactGogmaBonusName(weapon.weaponType, bonusId)).join(" ");
  }
  const names = new Map(keepCategoriesForWeapon(weapon.weaponType, weapon.attributeForce));
  return normalizeKeepCategories(weapon.categories)
    .map((category) => category === null ? "？" : (names.get(category) ?? "？").slice(0, 1))
    .join(" ");
}

function assertOperationBasis(expected) {
  const current = workbenchRead();
  if (current.stamp !== expected.stamp || stateSignature(current.model) !== stateSignature(expected.model)) {
    throw new Error('確認中にカウンターか手持ち武器が変わりました。最新の状態で予測を開き直してください。');
  }
}

function operationPreviewRow(label, ...nodes) {
  const row = document.createElement('div'); row.className = 'adopt-flow-row';
  const caption = document.createElement('span'); caption.className = 'adopt-flow-label'; caption.textContent = label;
  row.append(caption, ...nodes); return row;
}

function operationWeaponPreview({target, weapon, skills, bonuses, normal = false}) {
  const box = document.createElement('div'); box.className = 'adopt-flow';
  box.append(operationPreviewRow('対象の武器', ...createWeaponBadge(target)));
  if (target.boost) {
    const feature = document.createElement('strong'); feature.textContent = `【${target.boost}】${skillBoostFeature(target,target.boost)}`;
    box.append(operationPreviewRow('激化・特徴', feature));
  }
  if (weapon) box.append(operationPreviewRow('今のスキル',createOwnedSummarySkills(weapon)),operationPreviewRow('今のボーナス',createOwnedBonusChips(weapon)));
  if (skills) box.append(operationPreviewRow('反映するスキル', createOwnedSummarySkills(skills)));
  if (bonuses) {
    const tags = normal ? document.createElement('div') : createCompactBonusSet(target, bonuses);
    if (normal) { tags.className = 'artian-mini-tags'; for (const id of bonuses) {
      const tag = document.createElement('span'); tag.className = 'bonus-tag compact ' + artianBaseBonusClassName(id);
      tag.textContent = artianBaseBonusName(target.weaponType,id); tags.append(tag);
    }}
    box.append(operationPreviewRow('反映する5枠', tags));
  }
  return [box];
}

// 予測からの採用は、カウンターと所持武器を同じ保存で更新する。
async function commitCounterModel(model, expected, {targets = comparisonTargets, prediction = bonusPrediction, tab, success, selection}) {
  assertOperationBasis(expected);
  writeAtomic(localStorage, {
    [STORAGE_KEY]: JSON.stringify({saveState:model.saveState, targets, bonusPrediction:prediction, artianBaseState:model.artianBaseState}),
    [ARTIAN_OWNED_KEY]: JSON.stringify(model.normalOwned),
    [OWNED_WEAPONS_KEY]: JSON.stringify(model.ownedWeapons),
  });
  saveState = model.saveState; artianBaseState = model.artianBaseState; artianOwned = model.normalOwned; ownedWeapons = model.ownedWeapons;
  comparisonTargets = targets; bonusPrediction = prediction;
  let warning = '';
  try {
    if (selection) {
      lastSearchConfig = {weaponType:selection.weaponType,attributeForce:selection.attributeForce,counterGate:35,observations:[]};
      predictionWeaponSelect.value=String(selection.weaponType); predictionAttributeSelect.value=String(selection.attributeForce);
    }
    syncRuntimeFromSaveState(); renderSaveState(); renderOwnedWeaponSection(); renderArtianOwnedTab(); renderArtianBaseState();
    renderComparisonTargets(); renderBonusOperation(); renderPredictionFilters();
    if (tab === 'skill-future') { currentSkillObservations = []; skillObservedCount = 0; skillStateMessage.textContent = success; }
    if (tab === 'bonus-future') { predictionOrigin.textContent = '0'; bonusStateMessage.textContent = success; }
    const results = await Promise.allSettled([refreshArtianBasePredictions(),refreshPredictions(),refreshComparisonPredictions(),refreshSkillPredictions()]);
    if (results.some(result => result.status === 'rejected')) warning = '一部の予測を更新できませんでした。保存は完了しています。画面を開き直して確認してください。';
    if (tab) setActiveTab(tab);
    showSaveFeedback(success, []);
  } catch { warning = '保存は完了しています。画面を開き直して内容を確認してください。'; }
  return {message:success + (warning ? ' ' + warning : ''), state:model};
}

function runCounterChange({kind, steps, weaponType, title, summary = [], change, success, confirmLabel = '反映してカウンターを進める', expected, onCancel, targets, prediction}) {
  return performConfirmedOperation(() => {
    const basis = expected ?? workbenchRead(); assertOperationBasis(basis);
    const model = advanceCounter(basis.model, kind, steps, weaponType);
    change?.(model);
    return {
      title, summary, message:success.replace(/しました。/g,'します。').replace(/していません。/g,'しません。'), confirmLabel, onCancel,
      lines:counterChangeMessages(basis.model,model,WEAPON_TYPES,kind === 'normal' ? weaponType : null),
      verify:() => assertOperationBasis(basis),
      execute:() => commitCounterModel(model,basis,{targets,prediction,tab:kind === 'normal'?'artian-future':kind === 'skill'?'skill-future':'bonus-future',success}),
      success:result => result.message,
    };
  });
}

function runCounterSetting(title, update, {tab, normalType = null} = {}) {
  return performConfirmedOperation(() => {
    const basis = workbenchRead(), model = JSON.parse(JSON.stringify(basis.model));
    update(model);
    if (model.artianBaseState.baseSeed !== model.saveState.baseSeed) model.artianBaseState = {baseSeed:model.saveState.baseSeed,counters:{},sources:{}};
    const lines = counterChangeMessages(basis.model,model,WEAPON_TYPES,normalType);
    const seedChanged = basis.model.saveState.baseSeed !== model.saveState.baseSeed;
    if(seedChanged)lines.unshift('基準seed：'+(basis.model.saveState.baseSeed??'未特定')+' → '+model.saveState.baseSeed);
    const success = '入力した現在位置を設定しました。手持ち武器は変更していません。';
    return {title,lines,message:'手入力した値を現在位置として保存します。手持ち武器の登録内容は変更しません。'+(seedChanged?' 基準seedが変わるため、通常作成カウンターは特定し直してください。':''),confirmLabel:'この値を現在位置に設定する',
      verify:()=>assertOperationBasis(basis),execute:()=>commitCounterModel(model,basis,{tab,success}),success:result=>result.message};
  });
}

// 採用先を選ぶ窓。カウンターの変更は、その後の最終確認で確定する。
// choices: [{ tag?, name, detail?, onChoose }]。「やめる」・窓の外・Esc で閉じる
function openAdoptDialog({ title, summary = [], note, heading, choices, onCancel, cancelLabel = "やめる", focusCancel = false }) {
  const overlay = document.createElement("div");
  overlay.className = "skill-adopt-overlay";
  const menu = document.createElement("div");
  menu.className = "skill-adopt-menu";
  menu.setAttribute("role", "dialog");
  menu.setAttribute("aria-modal", "true");
  const onKey = (event) => { if (event.key === "Escape") cancelDialog(); };
  const close = () => {
    overlay.remove();
    document.removeEventListener("keydown", onKey);
  };
  const cancelDialog = () => { close(); onCancel?.(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", (event) => { if (event.target === overlay) cancelDialog(); });

  const titleEl = document.createElement("h3");
  titleEl.textContent = title;
  const summaryEl = document.createElement("div");
  summaryEl.className = "skill-adopt-summary";
  summaryEl.append(...summary);
  const noteEl = document.createElement("p");
  noteEl.className = "skill-adopt-note";
  noteEl.textContent = note;
  const headingEl = document.createElement("p");
  headingEl.className = "skill-adopt-heading";
  headingEl.textContent = heading;
  const buttons = choices.map(({ tag, name, detail, onChoose }) => {
    const item = document.createElement("button");
    item.type = "button";
    item.className = "skill-adopt-choice";
    if (tag) {
      const tagEl = document.createElement("span");
      tagEl.className = "skill-adopt-tag";
      tagEl.textContent = tag;
      item.append(tagEl);
    }
    const nameEl = document.createElement("strong");
    nameEl.textContent = name;
    item.append(nameEl);
    if (detail) {
      if (detail instanceof Node) {
        item.append(detail);
      } else {
        const detailEl = document.createElement("span");
        detailEl.className = "skill-adopt-detail";
        detailEl.textContent = detail;
        item.append(detailEl);
      }
    }
    item.addEventListener("click", () => {
      close();
      void onChoose();
    });
    return item;
  });
  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "text-button skill-adopt-cancel";
  cancel.textContent = cancelLabel;
  cancel.addEventListener("click", cancelDialog);
  menu.append(titleEl, summaryEl, noteEl, headingEl, ...buttons, cancel);
  overlay.append(menu);
  document.body.append(overlay);
  if (focusCancel) cancel.focus();
  else buttons[0]?.focus();
}

// 「弓・火・攻撃激化｜今のスキル：…｜攻EX 攻III …」（上書きする武器を見分けるための説明）
function ownedWeaponDetailText(weapon) {
  return [
    `${weaponAndAttributeText(weapon)}・${weapon.boost || "激化未設定"}`,
    `今のスキル：${ownedSkillText(weapon) || "未登録"}`,
    `今のボーナス：${ownedBonusesEmpty(weapon) ? "未入力" : ownedLayoutText(weapon)}`,
  ].join("｜");
}

// 今のボーナスを、結果の表と同じタグ（攻EX・会II など）で並べる。分からないときは文字
function createOwnedBonusChips(weapon) {
  if (ownedBonusesEmpty(weapon)) {
    const none = document.createElement("span");
    none.textContent = "未入力";
    return none;
  }
  if (!ownedBonusesKnown(weapon)) {
    const text = document.createElement("span");
    text.textContent = ownedLayoutText(weapon);
    return text;
  }
  return createCompactBonusSet({ ...weapon, kind: "reset" }, weapon.bonuses);
}

// 上書き先の武器情報・今のスキル・今のボーナスを、それぞれの行で表示する。
function ownedWeaponDetailNode(weapon) {
  const box = document.createElement("span");
  box.className = "skill-adopt-detail skill-adopt-detail-rich owned-adopt-detail";
  const text = document.createElement("span");
  text.textContent = `${weaponAndAttributeText(weapon)}・${weapon.boost || "激化未設定"}`;
  const skills = document.createElement("span");
  skills.className = "owned-adopt-row";
  const skillLabel = document.createElement("span");
  skillLabel.className = "owned-adopt-label";
  skillLabel.textContent = "今のスキル";
  skills.append(skillLabel, createOwnedSummarySkills(weapon));
  const bonuses = document.createElement("span");
  bonuses.className = "owned-adopt-row";
  const bonusLabel = document.createElement("span");
  bonusLabel.className = "owned-adopt-label";
  bonusLabel.textContent = "今のボーナス";
  bonuses.append(bonusLabel, createOwnedBonusChips(weapon));
  box.append(text, skills, bonuses);
  return box;
}

function createAdoptAsOwnedButton(target, bonusIds, completedRolls) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "keep-transition-button";
  button.textContent = "採用して手持ちに登録";
  button.title = "押すと、どの手持ち武器に反映するかを選ぶ窓が出ます";
  button.addEventListener("click", () => {
    const sameKind = ownedWeapons.filter((weapon) =>
      weapon.weaponType === target.weaponType && weapon.attributeForce === target.attributeForce);
    openAdoptDialog({
      title: `${completedRolls}回先の復元ボーナスを手持ち武器に反映`,
      summary: [...createWeaponBadge(target), createCompactBonusSet(target, bonusIds)],
      note: "武器を選ぶと、復元ボーナスとカウンターの変更内容を確認する画面が開きます。最終確認で反映すると、手持ち武器の更新と0地点の変更をまとめて保存します。",
      heading: sameKind.length > 0
        ? "どの武器の復元ボーナスを上書きしますか？（同じ武器種・属性の手持ち武器）"
        : "同じ武器種・属性の手持ち武器はありません。新しく登録します。",
      choices: [
        ...sameKind.map((weapon) => ({
          tag: "上書き",
          name: comparisonTargetName(weapon),
          detail: (() => { const detail = ownedWeaponDetailNode(weapon); detail.append(createWeaponStatComparison(weapon, bonusIds, { compact: true })); return detail; })(),
          onChoose: () => adoptResetToOwned(weapon, bonusIds, completedRolls),
        })),
        ...OWNED_BOOST_OPTIONS.map(([boost]) => ({
          name: `＋ 新しい手持ち武器として登録（${weaponAndAttributeText(target)}・${boost || "激化未設定"}）`,
          onChoose: () => adoptResetAsNewOwned(target, boost, bonusIds, completedRolls),
        })),
      ],
    });
  });
  return button;
}

// リセットの当たりを採用：選んだ手持ち武器の復元ボーナスを上書きして、0地点を進める
function adoptResetToOwned(weapon, bonusIds, completedRolls) {
  return adoptOwnedUpdate(weapon,bonusIds,completedRolls);
}

// リセットの当たりを採用：激化タイプを選んで新しい手持ち武器として登録し、0地点を進める
function adoptResetAsNewOwned(target, boost, bonusIds, completedRolls) {
  return runCounterChange({kind:'bonus',steps:completedRolls,title:'復元結果を手持ち武器【巨戟】に登録しますか？',
    summary:operationWeaponPreview({target:{...target,boost},bonuses:bonusIds}),
    change:model=>{
      if(model.ownedWeapons.length>=MAX_OWNED_WEAPONS)throw new Error('手持ち武器【巨戟】が上限です。整理してから登録してください。');
      validateBonuses(target.weaponType,target.attributeForce,bonusIds);
      model.ownedWeapons.push(newPredictionOwnedWeapon(target,boost,{bonuses:bonusIds}));
    },
    success:skillBoostLabel(target,boost)+'を手持ち武器【巨戟】に登録し、復元カウンターを更新しました。',confirmLabel:'登録してカウンターを進める'});
}

function createAdoptOwnedUpdateButton(target, bonusIds, completedRolls) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "keep-transition-button owned-update-button";
  button.textContent = "採用して手持ちを更新";
  button.title = "押すと、反映してよいかを確かめる窓が出ます";
  button.addEventListener("click", () => {
    const weapon = ownedWeapons.find((candidate) => candidate.id === target.id);
    if (!weapon) return;
    // 「今」と「新しく」を同じタグで並べて、見比べやすくする
    // 上から：武器の名前 → 今のボーナス → 大きな↓ → 新しく付与されるボーナス
    const flow = document.createElement("div");
    flow.className = "adopt-flow";
    const flowRow = (className, ...children) => {
      const row = document.createElement("div");
      row.className = className;
      row.append(...children);
      return row;
    };
    const flowLabel = (text) => Object.assign(document.createElement("span"), { className: "adopt-flow-label", textContent: text });
    flow.append(
      flowRow("adopt-flow-head", ...createWeaponBadge(target)),
      flowRow("adopt-flow-row", flowLabel("今のボーナス"), createOwnedBonusChips(weapon)),
      flowRow("adopt-flow-arrow", "↓"),
      flowRow("adopt-flow-row", flowLabel("新しく付与される復元ボーナス"), createCompactBonusSet(target, bonusIds)),
    );
    const stats = document.createElement("div");
    const updateStats = () => stats.replaceChildren(createWeaponStatComparison(weapon, bonusIds));
    updateStats();
    flow.append(stats, createWeaponStatEditor(weapon, () => { updateStats(); onOwnedWeaponsChanged(); }));
    openAdoptDialog({
      title: `${completedRolls}回先の復元ボーナスで手持ち武器を更新`,
      summary: [flow],
      note: `「${comparisonTargetName(weapon)}」の今のボーナスを書き換えて、復元ボーナスカウンターの0地点を${completedRolls}回先まで進めます。`,
      heading: "武器を選ぶと、上書き内容とカウンターの最終確認が開きます。",
      choices: [{
        tag: "手持ち武器",
        name: `${comparisonTargetName(weapon)} を更新する`,
        detail: ownedWeaponDetailNode(weapon),
        onChoose: () => adoptOwnedUpdate(target, bonusIds, completedRolls),
      }],
    });
  });
  return button;
}

function statNumber(value, unit = "", signed = false) {
  if (value === null) return "未入力";
  const text = Math.abs(value).toLocaleString("ja-JP");
  return `${value < 0 ? "−" : signed ? "+" : ""}${text}${unit}`;
}

function statDelta(row) {
  if (row.delta === null) return "未計算";
  const unit = row.key === "affinity" ? "pt" : row.unit;
  return row.delta === 0 ? `±0${unit}` : `${row.delta > 0 ? "↑ " : "↓ "}${statNumber(row.delta, unit, true)}`;
}

function createWeaponStatComparison(weapon, bonusIds, { compact = false } = {}) {
  const result = weaponStatComparison(weapon, bonusIds);
  const box = document.createElement("section");
  box.className = compact ? "weapon-stat-inline" : "weapon-stat-comparison";
  if (compact) {
    for (const row of result.rows.filter((r) => ["attack", "element", "affinity"].includes(r.key))) {
      const item = document.createElement("span");
      item.className = row.delta > 0 ? "stat-increase" : row.delta < 0 ? "stat-decrease" : "stat-unchanged";
      item.textContent = !row.applicable ? `${row.label} 対象外` : row.absolute
        ? `${row.label} ${statNumber(row.before,row.unit)}→${statNumber(row.after,row.unit)}（${statDelta(row)}）`
        : `${row.label} ${statDelta(row)}`;
      item.title = row.applicable ? `${row.absolute ? "武器全体" : "復元ボーナス分"}：${statNumber(row.before,row.unit,!row.absolute)} → ${statNumber(row.after,row.unit,!row.absolute)}` : "弾・ビンで扱うため武器の属性値には換算しません。";
      box.append(item);
    }
    const note = document.createElement("small"); note.textContent = "攻撃は係数なし。未登録の数値はボーナス差。"; box.append(note);
    return box;
  }
  const title = document.createElement("h4"); title.textContent = "更新前・更新後の数値";
  const table = document.createElement("table"); table.className = "weapon-stat-table";
  const head = document.createElement("thead"), headRow = document.createElement("tr");
  for (const text of ["項目", "更新前", "更新後", "差分"]) { const cell = document.createElement("th"); cell.scope = "col"; cell.textContent = text; headRow.append(cell); }
  head.append(headRow); const body = document.createElement("tbody");
  for (const row of result.rows) {
    const tr = document.createElement("tr"); tr.dataset.stat = row.key;
    const name = document.createElement("th"); name.scope = "row"; name.textContent = row.label;
    if (row.applicable && ["attack", "element", "affinity"].includes(row.key)) {
      const scope = document.createElement("small"); scope.textContent = row.absolute ? "武器全体" : "ボーナス分"; name.append(scope);
    }
    tr.append(name);
    for (const value of [row.before, row.after]) { const cell = document.createElement("td"); cell.textContent = row.applicable ? statNumber(value,row.unit,!row.absolute) : "対象外"; tr.append(cell); }
    const delta = document.createElement("td"); delta.className = row.delta > 0 ? "stat-increase" : row.delta < 0 ? "stat-decrease" : "stat-unchanged";
    delta.textContent = row.applicable ? statDelta(row) : "—"; tr.append(delta); body.append(tr);
  }
  table.append(head,body);
  const note = document.createElement("p"); note.className = "weapon-stat-note";
  note.textContent = "攻撃力は武器係数なしの基礎攻撃力です。未登録の項目は復元ボーナスの加算分を表示。装備スキル・護符・食事・会心による実ダメージの変化は含みません。";
  box.append(title,table,note);
  if (result.staleReference) { const stale = document.createElement("p"); stale.className = "stat-decrease"; stale.textContent = "激化タイプ等が登録時と変わったため、合計値は再登録まで使わずボーナス分を表示しています。"; box.append(stale); }
  return box;
}

function saveWeaponStatReference(weapon, fields) {
  const current = ownedWeapons.find((entry) => entry.id === weapon.id);
  if (!current) throw new Error("この武器は手持ちから削除されています。画面を開き直してください。");
  const normalized = ownedWeapons.map((entry) => ({ ...entry, statReference: normalizeWeaponStatReference(entry.statReference) }));
  if (stateSignature(loadOwnedWeapons()) !== stateSignature(normalized)) throw new Error("別の画面で手持ち武器が変更されました。最新のデータで開き直してから入力してください。");
  const reference = makeWeaponStatReference(current, fields);
  writeAtomic(localStorage, { [OWNED_WEAPONS_KEY]: JSON.stringify(ownedWeapons.map((entry) => entry === current ? { ...entry, statReference: reference } : entry)) });
  current.statReference = reference;
  return current;
}

function createWeaponStatEditor(weapon, onSaved) {
  const details = document.createElement("details"); details.className = "weapon-stat-editor";
  const summary = document.createElement("summary"); summary.textContent = "武器全体の数値を登録・修正（任意）";
  const note = document.createElement("p"); note.className = "weapon-stat-note";
  note.textContent = "初回だけ、今の5枠が付いた武器自体の数値を登録すると、以後の合計値も計算します。攻撃はゲームの表示設定を係数なしにした基礎攻撃力を入力。スキル・護符・食事などの補正は含めないでください。空欄の項目はボーナス分だけを表示します。激化タイプを変えた場合はゲーム内の数値を入れ直してください。";
  const ref = normalizeWeaponStatReference(weapon.statReference);
  const current = weaponStatComparison(weapon, weapon.bonuses);
  const grid = document.createElement("div"); grid.className = "weapon-stat-inputs";
  const inputs = new Map();
  for (const row of current.rows.filter((entry) => ["attack", "element", "affinity"].includes(entry.key) && entry.applicable)) {
    const label = document.createElement("label"), text = document.createElement("span"), input = document.createElement("input");
    text.textContent = `今の${row.label}${row.key === "affinity" ? "（%）" : ""}`;
    input.type = "number"; input.step = "1"; input.min = row.key === "affinity" ? "-100" : "0"; input.max = row.key === "affinity" ? "100" : "99999";
    input.value = row.absolute && row.before !== null ? String(row.before) : ""; input.placeholder = "未登録"; input.dataset.statInput = row.key;
    label.append(text,input); grid.append(label); inputs.set(row.key,input);
  }
  const message = document.createElement("p"); message.className = "weapon-stat-message"; message.setAttribute("role","status");
  const save = document.createElement("button"); save.type = "button"; save.className = "secondary small-button"; save.textContent = "数値を登録して比較に使う";
  const clear = document.createElement("button"); clear.type = "button"; clear.className = "text-button"; clear.textContent = "数値の登録を解除"; clear.hidden = !ref;
  const commit = (fields) => {
    message.classList.remove("error");
    try { saveWeaponStatReference(weapon,fields); clear.hidden = !weapon.statReference; message.textContent = weapon.statReference ? "数値を登録しました。カウンターやボーナスは変更していません。" : "数値の登録を解除しました。ボーナス分の比較に戻ります。"; onSaved(); }
    catch (error) { message.classList.add("error"); message.textContent = error.message; }
  };
  save.addEventListener("click",()=>commit(Object.fromEntries([...inputs].map(([key,input])=>[key,input.value]))));
  clear.addEventListener("click",()=>{ commit({}); if(!weapon.statReference) for(const input of inputs.values())input.value=""; });
  details.append(summary,note,grid,save,clear,message); return details;
}

// 同じ構成の結果を採用：手持ち武器の今のボーナスを更新して、0地点を進める
function adoptOwnedUpdate(target, bonusIds, completedRolls) {
  const weapon = ownedWeapons.find(w=>w.id===target.id);
  if(!weapon) return performConfirmedOperation(()=>{throw new Error('対象の武器が見つかりません。予測を開き直してください。');});
  return runCounterChange({kind:'bonus',steps:completedRolls,title:'この武器の復元ボーナスを上書きしますか？',
    summary:[...operationWeaponPreview({target:weapon,weapon,bonuses:bonusIds}),createWeaponStatComparison(weapon,bonusIds)],
    change:model=>{
      const owned=model.ownedWeapons.find(w=>w.id===target.id);
      if(!owned)throw new Error('対象の武器が見つかりません。');
      validateBonuses(owned.weaponType,owned.attributeForce,bonusIds);
      owned.bonuses=[...bonusIds];owned.categories=bonusIds.map(bonusCategoryId);
    },success:comparisonTargetName(weapon)+'の復元ボーナスを手持ち武器【巨戟】に反映し、復元カウンターを更新しました。',confirmLabel:'上書きしてカウンターを進める'});
}

// 1〜5枠目の今のボーナス（II・III・EXまで）をカードで選ぶ欄。その武器で出ないボーナスは外す
function createOwnedBonusPicker(weaponType, attributeForce, bonuses, onChange) {
  const options = gogmaBonusesForWeapon(weaponType, attributeForce);
  const available = new Set(options.map(([id]) => id));
  return createBonusCardPicker({
    weaponType,
    options,
    values: bonuses.map((bonusId) => available.has(bonusId) ? bonusId : null),
    onChange: (_, __, values) => onChange(values),
  });
}

function createOwnedRuleControls(weapon) {
  const wrap = document.createElement("div");
  wrap.className = "owned-rule-controls";
  const ruleLabel = document.createElement("label");
  const ruleText = document.createElement("span");
  const ruleSelect = document.createElement("select");
  ruleText.textContent = "一致にする条件";
  populateSelect(ruleSelect, OWNED_RULE_OPTIONS, weapon.rule);
  ruleLabel.append(ruleText, ruleSelect);
  const exLabel = document.createElement("label");
  const exText = document.createElement("span");
  const exSelect = createMinExSelect(weapon.minEx);
  exText.textContent = "EXの数";
  exLabel.append(exText, exSelect);
  const syncVisibility = () => { exLabel.hidden = ruleSelect.value !== "ex"; };
  ruleSelect.addEventListener("change", syncVisibility);
  syncVisibility();
  // 攻撃は下げない：攻撃の枠の強さ（II=1・III=2・EX=3）の合計が、今より下がる結果は一致にしない
  const keepLabel = document.createElement("label");
  const keepAttack = document.createElement("input");
  keepLabel.className = "owned-keep-attack";
  keepAttack.type = "checkbox";
  keepAttack.checked = weapon.keepAttack !== false;
  keepLabel.append(keepAttack, "攻撃は下げない（攻撃の枠の強さが今より下がる結果は、一致にしない）");
  wrap.append(ruleLabel, exLabel, keepLabel);
  return { wrap, ruleSelect, exSelect, keepAttack };
}

function ownedWeaponFromInputs(base, bonuses, ruleSelect, exSelect, keepAttack = null) {
  return {
    ...base,
    bonuses,
    categories: bonuses.map((bonusId) => bonusId === null ? null : bonusCategoryId(bonusId)),
    rule: ruleSelect.value,
    minEx: Number(exSelect.value),
    keepAttack: keepAttack ? keepAttack.checked : base.keepAttack !== false,
  };
}

function createMinExSelect(value) {
  const select = document.createElement("select");
  populateSelect(
    select,
    [1, 2, 3, 4, 5].map((count) => [count, count === 5 ? "EX 5個" : `EX ${count}個以上`]),
    value,
  );
  return select;
}

// 手持ち武器の登録欄は「07 復元ボーナス」「05 スキル」「03 手持ち武器」の3か所に同じものを出す（データは共通）
function ownedWeaponContainers() {
  return [ownedWeaponSection, skillOwnedContainer, ownedTabContainer].filter(Boolean);
}

// 手持ち武器が変わったら、ほかの場所の登録欄と、両方の予測表を書き直す（編集中の欄は書き直さない）
function onOwnedWeaponsChanged(editingContainer = null) {
  persistOwnedWeapons();
  renderOwnedWeaponSection(editingContainer);
  void refreshComparisonPredictions();
  if (skillPredictionRollSets.length > 0) renderSkillPredictionTable();
}

// シリーズスキル・グループスキルをカードで1つずつ選ぶ欄（「未登録」も選べる）
function createOwnedSkillPicker(seriesIndex, groupIndex, onChange) {
  const element = document.createElement("div");
  element.className = "owned-skill-picker";
  const values = { seriesIndex, groupIndex };
  const name = `owned-skill-${createTargetId()}`;
  const makeGroup = (title, kind, options, current, effectOf) => {
    const fieldset = document.createElement("fieldset");
    fieldset.className = "skill-filter-series";
    const legend = document.createElement("legend");
    legend.textContent = title;
    const grid = document.createElement("div");
    grid.className = "skill-filter-series-options owned-skill-options";
    for (const [index, label] of [[-1, "未登録"], ...options]) {
      const option = document.createElement("label");
      const radio = document.createElement("input");
      const text = document.createElement("span");
      radio.type = "radio";
      radio.name = `${name}-${kind}`;
      radio.value = String(index);
      radio.checked = (current ?? -1) === index;
      text.textContent = label;
      if (index >= 0) text.append(effectOf(label));
      radio.addEventListener("change", () => {
        values[kind] = index < 0 ? null : index;
        onChange({ ...values });
      });
      option.append(radio, text);
      grid.append(option);
    }
    fieldset.append(legend, grid);
    return fieldset;
  };
  const groupEffect = (label) => {
    const small = document.createElement("small");
    small.className = "skill-effect";
    const effect = GROUP_SKILL_EFFECTS[label];
    if (effect) small.textContent = `発動スキル：${effect[0]}（3部位）`;
    return small;
  };
  element.append(
    makeGroup("グループスキル", "groupIndex", prioritizedSkillOptions(GROUP_SKILLS, PRIORITY_GROUP_SKILL_INDICES), groupIndex, groupEffect),
    makeGroup("シリーズスキル", "seriesIndex", prioritizedSkillOptions(SERIES_SKILLS, PRIORITY_SERIES_SKILL_INDICES), seriesIndex, skillEffectSpan),
  );
  return { element, getValues: () => ({ ...values }) };
}

function renderOwnedWeaponSection(skipContainer = null) {
  for (const container of ownedWeaponContainers()) {
    if (container !== skipContainer) buildOwnedWeaponContent(container);
  }
  // 手持ち武器が変わったら、所持表の◎も書き直す
  renderOwnedMatrix();
}

function buildOwnedWeaponContent(container) {
  const where = container.dataset.ownedWhere ?? "bonus";
  const intro = document.createElement("div");
  intro.className = "skill-filter-intro";
  const title = document.createElement("strong");
  title.textContent = "手持ち武器";
  const description = document.createElement("p");
  description.textContent = "持っている武器を1本ずつ登録します。今のボーナス（1枠目〜5枠目をゲーム画面の順番どおりに）を入れると「同じ構成で再復元」の予測と今より強くなる回の判定に、スキルを入れるとスキル未来予測の「所持済み」の判定に使われます。どちらか片方だけでも登録できます。";
  intro.append(title, description);

  // 追加フォーム
  const form = document.createElement("div");
  form.className = "owned-weapon-form";
  // 直前に選んだもの（なければ狙いの登録欄の選択）を選んだ状態で始める
  const lastForm = loadBonusView().ownedForm;
  const makeField = (labelText, control) => {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = labelText;
    label.append(text, control);
    return label;
  };
  const boostSelect = document.createElement("select");
  populateSelect(boostSelect, OWNED_BOOST_OPTIONS, OWNED_BOOST_OPTIONS.some(([value]) => value === lastForm.boost) ? lastForm.boost : "");
  const weaponSelectEl = document.createElement("select");
  populateSelect(weaponSelectEl, WEAPON_TYPES,
    Number.isSafeInteger(lastForm.weaponType) ? lastForm.weaponType : Number(comparisonWeaponSelect.value));
  const attributeSelectEl = document.createElement("select");
  populateSelect(attributeSelectEl, ATTRIBUTES,
    Number.isSafeInteger(lastForm.attributeForce) ? lastForm.attributeForce : Number(comparisonAttributeSelect.value));
  const subtypeInput = document.createElement("input");
  subtypeInput.type = "text";
  subtypeInput.maxLength = 14;
  subtypeInput.placeholder = "例：貫通／通常";
  subtypeInput.value = typeof lastForm.subtype === "string" ? lastForm.subtype : "";
  const subtypeList = document.createElement("datalist");
  subtypeList.id = `owned-subtype-list-${createTargetId()}`;
  subtypeInput.setAttribute("list", subtypeList.id);
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.placeholder = "例：メイン雷弓";
  const nameHint = document.createElement("p");
  nameHint.className = "owned-name-hint";

  // 名前の自動入力：「【攻撃激化】貫通 氷」。自分で書き換えたら、その後は上書きしない
  let nameEditedByHand = false;
  const autoName = () => {
    const boost = boostSelect.value;
    const subtype = subtypeInput.value.trim();
    const attribute = optionName(ATTRIBUTES, Number(attributeSelectEl.value)).replace("属性", "");
    if (!boost && !subtype) return "";
    // 例：「【属性激化】貫通 氷」、種類のない武器は「【会心激化】火」
    return `${boost ? `【${boost}】` : ""}${subtype ? `${subtype} ` : ""}${attribute}`;
  };
  const updateName = () => {
    if (!nameEditedByHand) nameInput.value = autoName();
    nameHint.textContent = nameEditedByHand
      ? "名前は手入力中です（自動入力に戻すには、名前を空にしてください）"
      : "激化・種類・属性から名前を自動で入れます。自由に書き換えることもできます。";
  };
  const updateSubtypeList = () => {
    const weaponType = Number(weaponSelectEl.value);
    const history = loadBonusView().subtypeHistory[weaponType] ?? [];
    const suggestions = [...new Set([...OWNED_BOOST_OPTIONS.map(([boost]) => ownedSubtypeFor(weaponType, Number(attributeSelectEl.value), boost)), ...history])].filter(Boolean);
    subtypeList.replaceChildren(...suggestions.map((value) => {
      const option = document.createElement("option");
      option.value = value;
      return option;
    }));
  };
  const rememberForm = () => {
    const view = loadBonusView();
    view.ownedForm = {
      boost: boostSelect.value,
      weaponType: Number(weaponSelectEl.value),
      attributeForce: Number(attributeSelectEl.value),
      subtype: subtypeInput.value.trim(),
    };
    persistBonusView(view);
  };
  nameInput.addEventListener("input", () => {
    nameEditedByHand = nameInput.value.trim() !== "";
    updateName();
  });
  // 激化タイプで種類が決まる武器（弓・ガンランスなど）は、種類を自動で入れる
  const applySubtypeFromBoost = () => {
    const weaponType = Number(weaponSelectEl.value);
    if (OWNED_SUBTYPE_BY_BOOST[weaponType]) subtypeInput.value = ownedSubtypeFor(weaponType, Number(attributeSelectEl.value), boostSelect.value);
  };
  boostSelect.addEventListener("change", () => { applySubtypeFromBoost(); updateName(); rememberForm(); });
  subtypeInput.addEventListener("input", () => { updateName(); rememberForm(); });
  weaponSelectEl.addEventListener("change", () => {
    // 武器種が変わったら、前の武器種の種類は合わないので入れ直す
    subtypeInput.value = "";
    applySubtypeFromBoost();
    updateSubtypeList();
    updateName();
    rememberForm();
  });
  attributeSelectEl.addEventListener("change", () => { applySubtypeFromBoost(); updateSubtypeList(); updateName(); rememberForm(); });
  updateSubtypeList();
  updateName();

  const boostLabel = makeField("激化タイプ", boostSelect);
  const weaponLabel = makeField("武器種", weaponSelectEl);
  const attributeLabel = makeField("属性", attributeSelectEl);
  const subtypeLabel = makeField("種類（激化で自動・書き換え可）", subtypeInput);
  subtypeLabel.append(subtypeList);
  const nameLabel = makeField("名前（任意・自動入力）", nameInput);
  const formRule = createOwnedRuleControls({ rule: "upgrade", minEx: 2 });
  const slots = document.createElement("div");
  slots.className = "owned-weapon-picker";
  let formBonuses = [null, null, null, null, null];
  const renderFormSlots = () => {
    const picker = createOwnedBonusPicker(
      Number(weaponSelectEl.value), Number(attributeSelectEl.value), formBonuses,
      (values) => { formBonuses = values; },
    );
    formBonuses = picker.getValues();
    slots.replaceChildren(picker.element);
  };
  renderFormSlots();
  weaponSelectEl.addEventListener("change", renderFormSlots);
  attributeSelectEl.addEventListener("change", renderFormSlots);
  const bonusTitle = document.createElement("p");
  bonusTitle.className = "owned-form-subtitle";
  bonusTitle.textContent = "今の復元ボーナス（任意・入れるなら5枠すべて）";
  // スキル（任意）。長いので開け閉めできる欄に入れる
  let formSkills = { seriesIndex: null, groupIndex: null };
  const formSkillPicker = createOwnedSkillPicker(null, null, (values) => { formSkills = values; });
  const formSkillBox = document.createElement("div");
  formSkillBox.append(formSkillPicker.element);
  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "secondary small-button";
  addButton.textContent = "手持ち武器を登録";
  const error = document.createElement("p");
  error.className = "error";
  error.hidden = true;
  addButton.addEventListener("click", () => {
    const weapon = ownedWeaponFromInputs({
      id: createTargetId(),
      label: nameInput.value.trim(),
      weaponType: Number(weaponSelectEl.value),
      attributeForce: Number(attributeSelectEl.value),
      boost: boostSelect.value,
      subtype: subtypeInput.value.trim(),
      seriesIndex: formSkills.seriesIndex,
      groupIndex: formSkills.groupIndex,
    }, formBonuses, formRule.ruleSelect, formRule.exSelect, formRule.keepAttack);
    // 復元ボーナスは空でもよい（スキルだけの登録）。入れるなら5枠そろっていること
    const problem = ownedBonusesEmpty(weapon) ? null : ownedWeaponProblem(weapon);
    if (problem) {
      error.textContent = problem;
      error.hidden = false;
      return;
    }
    if (ownedBonusesEmpty(weapon) && weapon.seriesIndex === null && weapon.groupIndex === null) {
      error.textContent = "今の復元ボーナスか、スキルのどちらかを入れてください。";
      error.hidden = false;
      return;
    }
    if (ownedWeapons.length >= MAX_OWNED_WEAPONS) {
      error.textContent = `手持ち武器は最大${MAX_OWNED_WEAPONS}本です。`;
      error.hidden = false;
      return;
    }
    ownedWeapons.push(weapon);
    // 選んだ武器種・属性・激化・種類を覚え、種類は武器種ごとの候補に足す
    rememberForm();
    const subtype = subtypeInput.value.trim();
    if (subtype) {
      const view = loadBonusView();
      const history = view.subtypeHistory[weapon.weaponType] ?? [];
      view.subtypeHistory[weapon.weaponType] = [...new Set([subtype, ...history])].slice(0, 12);
      persistBonusView(view);
    }
    onOwnedWeaponsChanged();
  });
  const formRow = document.createElement("div");
  formRow.className = "owned-weapon-form-row";
  formRow.append(nameLabel, weaponLabel, attributeLabel, boostLabel, subtypeLabel);
  form.append(formRow, nameHint, bonusTitle, slots, formSkillBox, formRule.wrap, addButton, error);
  wrapInCollapsible(formSkillBox, `owned-form-skill:${where}`, "スキル（任意）：シリーズスキル・グループスキル", "クリックでスキルの選択欄が開きます");

  // 登録済みの手持ち武器（並べ方：登録した順／武器種ごと）
  const sortMode = loadBonusView().ownedSort;
  const attributeOrder = new Map(ATTRIBUTES.map(([value], index) => [value, index]));
  const boostOrder = new Map(OWNED_BOOST_OPTIONS.map(([value], index) => [value, index]));
  const displayWeapons = sortMode === "type"
    ? [...ownedWeapons].sort((a, b) =>
      a.weaponType - b.weaponType
      || attributeOrder.get(a.attributeForce) - attributeOrder.get(b.attributeForce)
      || (boostOrder.get(a.boost) ?? 0) - (boostOrder.get(b.boost) ?? 0))
    : ownedWeapons;
  const cards = displayWeapons.map((weapon) => {
    const card = document.createElement("details");
    card.className = "weapon-filter-row owned-weapon-card";
    const summary = document.createElement("summary");
    const summaryLine = document.createElement("span");
    summaryLine.className = "owned-summary-line";
    // 武器種＋属性、名前、グループ＋シリーズ、5枠、判定条件の順。
    const typeBadge = document.createElement("span");
    typeBadge.className = "owned-type-badge";
    typeBadge.textContent = weaponAndAttributeText(weapon);
    const name = document.createElement("span");
    name.className = "owned-summary-name";
    const state = document.createElement("span");
    state.className = "owned-summary-details";
    const updateState = () => {
      name.textContent = ownedWeaponSummaryName(weapon);
      name.hidden = !name.textContent;
      const rule = document.createElement("span");
      rule.className = "owned-summary-rule";
      const problem = ownedBonusesEmpty(weapon) ? null : ownedWeaponProblem(weapon);
      rule.textContent = problem ? `⚠ ${problem}` : ownedBonusesKnown(weapon) || weapon.rule === "ex"
        ? `${ownedRuleText(weapon)}で一致` : ownedRuleText(weapon);
      state.replaceChildren(createOwnedSummarySkills(weapon), createOwnedSummaryBonuses(weapon), rule);
    };
    updateState();
    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "owned-remove-button";
    removeButton.textContent = "×";
    removeButton.setAttribute("aria-label", `${comparisonTargetName(weapon)}を削除`);
    removeButton.addEventListener("click", (event) => {
      event.preventDefault();
      if (!window.confirm(`「${comparisonTargetName(weapon)}」を手持ち武器から削除しますか？`)) return;
      ownedWeapons = ownedWeapons.filter((candidate) => candidate.id !== weapon.id);
      onOwnedWeaponsChanged();
    });
    // 並び替え（表の列や一覧の順番にも反映される）
    const moveButton = (text, label, offset) => {
      const button = document.createElement("button");
      const index = ownedWeapons.indexOf(weapon);
      button.type = "button";
      button.className = "owned-move-button";
      button.textContent = text;
      button.title = label;
      button.setAttribute("aria-label", `${comparisonTargetName(weapon)}を${label}`);
      button.disabled = index + offset < 0 || index + offset >= ownedWeapons.length;
      button.addEventListener("click", (event) => {
        event.preventDefault();
        const from = ownedWeapons.indexOf(weapon);
        const to = from + offset;
        if (to < 0 || to >= ownedWeapons.length) return;
        [ownedWeapons[from], ownedWeapons[to]] = [ownedWeapons[to], ownedWeapons[from]];
        onOwnedWeaponsChanged();
      });
      return button;
    };
    summaryLine.append(typeBadge, name, state);
    summary.append(summaryLine);
    setupCollapsible(card, summary, `owned:${where}:${weapon.id}`, "クリックで設定欄が開きます");
    const actions = document.createElement("span");
    actions.className = "owned-card-actions";
    // ↑↓ は「登録した順」のときだけ（武器種ごとに並べているときは順番が自動で決まる）
    if (sortMode === "manual") actions.append(moveButton("↑", "上へ移動", -1), moveButton("↓", "下へ移動", 1));
    actions.append(removeButton);
    summary.append(actions);

    const body = document.createElement("div");
    body.className = "weapon-filter-body";
    const renameLabel = document.createElement("label");
    const renameText = document.createElement("span");
    const renameInput = document.createElement("input");
    renameText.textContent = "名前";
    renameInput.type = "text";
    renameInput.maxLength = 24;
    renameInput.value = weapon.label;
    renameInput.placeholder = ownedWeaponDefaultName(weapon);
    renameLabel.append(renameText, renameInput);
    const boostLabel = document.createElement("label");
    const boostText = document.createElement("span");
    const cardBoostSelect = document.createElement("select");
    boostText.textContent = "激化タイプ";
    populateSelect(cardBoostSelect, OWNED_BOOST_OPTIONS, weapon.boost);
    boostLabel.append(boostText, cardBoostSelect);
    let cardBonuses = [...weapon.bonuses];
    let cardSkills = { seriesIndex: weapon.seriesIndex, groupIndex: weapon.groupIndex };
    const cardRule = createOwnedRuleControls(weapon);
    const save = () => {
      const next = ownedWeaponFromInputs(weapon, cardBonuses, cardRule.ruleSelect, cardRule.exSelect, cardRule.keepAttack);
      // 以前の登録で系統だけ分かっている枠は、ボーナスを選ぶまで系統を残す
      next.categories = next.categories.map((category, slotIndex) => category ?? weapon.categories[slotIndex]);
      Object.assign(weapon, next, {
        label: renameInput.value.trim(),
        boost: cardBoostSelect.value,
        seriesIndex: cardSkills.seriesIndex,
        groupIndex: cardSkills.groupIndex,
      });
      updateState();
      onOwnedWeaponsChanged(container);
    };
    const cardPicker = createOwnedBonusPicker(weapon.weaponType, weapon.attributeForce, cardBonuses, (values) => {
      cardBonuses = values;
      save();
    });
    cardBonuses = cardPicker.getValues();
    const cardSlots = document.createElement("div");
    cardSlots.className = "owned-weapon-picker";
    cardSlots.append(cardPicker.element);
    const cardBonusTitle = document.createElement("p");
    cardBonusTitle.className = "owned-form-subtitle";
    cardBonusTitle.textContent = "今の復元ボーナス";
    const cardSkillPicker = createOwnedSkillPicker(weapon.seriesIndex, weapon.groupIndex, (values) => {
      cardSkills = values;
      save();
    });
    const cardSkillBox = document.createElement("div");
    cardSkillBox.append(cardSkillPicker.element);
    renameInput.addEventListener("change", save);
    cardBoostSelect.addEventListener("change", save);
    cardRule.wrap.addEventListener("change", save);
    body.append(renameLabel, boostLabel, createWeaponStatEditor(weapon, () => onOwnedWeaponsChanged(container)), cardBonusTitle, cardSlots, cardSkillBox, cardRule.wrap);
    card.append(summary, body);
    wrapInCollapsible(cardSkillBox, `owned-skill:${where}:${weapon.id}`,
      `スキル：${ownedSkillText(weapon) || "未登録"}`, "クリックでスキルの選択欄が開きます");
    return card;
  });

  const listTitle = document.createElement("p");
  listTitle.className = "weapon-filter-empty";
  listTitle.textContent = ownedWeapons.length === 0
    ? "まだ登録がありません。表の「採用して手持ちに登録」からも登録できます。"
    : `登録済み ${ownedWeapons.length}本（名前を押すと構成を直せます）`;

  // 並べ方の切り替え（どの場所の一覧でも共通）
  const sortBar = document.createElement("div");
  sortBar.className = "owned-sort-bar";
  const sortLabel = document.createElement("span");
  sortLabel.textContent = "並べ方：";
  sortBar.append(sortLabel, ...[
    ["manual", "登録した順（↑↓で並び替え）"],
    ["type", "武器種ごと"],
  ].map(([value, text]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `owned-sort-button${sortMode === value ? " active" : ""}`;
    button.textContent = text;
    button.addEventListener("click", () => {
      const view = loadBonusView();
      view.ownedSort = value;
      persistBonusView(view);
      renderOwnedWeaponSection();
    });
    return button;
  }));

  // 武器種ごとのときは、武器種の見出しを挟む
  const listItems = [];
  cards.forEach((card, index) => {
    const weapon = displayWeapons[index];
    if (sortMode === "type" && (index === 0 || displayWeapons[index - 1].weaponType !== weapon.weaponType)) {
      const groupHeading = document.createElement("h4");
      groupHeading.className = "owned-group-heading";
      const count = displayWeapons.filter((other) => other.weaponType === weapon.weaponType).length;
      groupHeading.textContent = `${t(optionName(WEAPON_TYPES, weapon.weaponType))}（${count}本）`;
      listItems.push(groupHeading);
    }
    listItems.push(card);
  });

  container.replaceChildren(intro, form, listTitle);
  if (ownedWeapons.length > 0) {
    const bulkBox = createOwnedBulkRuleBox();
    container.append(bulkBox, sortBar);
    wrapInCollapsible(bulkBox, `owned-bulk:${where}`, "一致の条件をまとめて設定（全部／武器種ごと）", "クリックで設定欄が開きます");
  }
  container.append(...listItems);
}

// ===== 所持表（03 手持ち武器タブの一番上） =====
function normalizeMatrixBlock(block) {
  const weaponType = Math.trunc(Number(block?.weaponType));
  return {
    id: typeof block?.id === "string" && block.id ? block.id : createTargetId(),
    name: typeof block?.name === "string" ? block.name.slice(0, 24) : "",
    weaponType: WEAPON_TYPES.some(([value]) => value === weaponType) ? weaponType : 0,
    boost: OWNED_MATRIX_BOOST_OPTIONS.some(([value]) => value === block?.boost) ? block.boost : "",
    columns: Array.isArray(block?.columns)
      ? [...new Set(block.columns.filter((key) => typeof key === "string" && matrixSkillName(key) !== null))]
      : [],
  };
}

function loadOwnedMatrix() {
  let saved = null;
  try {
    saved = JSON.parse(localStorage.getItem(OWNED_MATRIX_KEY) ?? "null");
  } catch {
    saved = null;
  }
  const blocks = Array.isArray(saved?.blocks) ? saved.blocks.map(normalizeMatrixBlock) : null;
  const marks = saved?.marks && typeof saved.marks === "object" ? saved.marks : {};
  return {
    blocks: blocks ?? OWNED_MATRIX_DEFAULT_BLOCKS.map(normalizeMatrixBlock),
    marks: Object.fromEntries(Object.entries(marks).filter(([, value]) => value === "o" || value === "x")),
  };
}

function persistOwnedMatrix() {
  try {
    localStorage.setItem(OWNED_MATRIX_KEY, JSON.stringify(ownedMatrix));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

// "g13" → ヌシの魂、"s5" → 兇爪竜の力。short は表の見出し用の短い名前（ヌシ魂・兇爪竜）
function matrixSkillName(key, short = false) {
  const match = /^([gs])(\d+)$/.exec(key);
  if (!match) return null;
  const name = (match[1] === "g" ? GROUP_SKILLS : SERIES_SKILLS)[Number(match[2])];
  if (!name) return null;
  if (!short) return name;
  return match[1] === "g" ? name.replace("の", "") : name.split("の")[0];
}

function weaponHasMatrixSkill(weapon, key) {
  const index = Number(key.slice(1));
  return key[0] === "g" ? weapon.groupIndex === index : weapon.seriesIndex === index;
}

function matrixBlockTitle(block) {
  if (block.name.trim()) return block.name.trim();
  const weaponName = optionName(WEAPON_TYPES, block.weaponType);
  return block.boost ? `${weaponName}【${block.boost}】` : weaponName;
}

// そのマスに当てはまる手持ち武器（武器種・激化・属性・スキルが同じ）
function matrixOwnedWeapons(block, attribute, key) {
  return ownedWeapons.filter((weapon) =>
    weapon.weaponType === block.weaponType
    && (!block.boost || weapon.boost === block.boost)
    && weapon.attributeForce === attribute
    && weaponHasMatrixSkill(weapon, key));
}

function renderOwnedMatrix() {
  const body = document.querySelector(".owned-matrix-body");
  if (!body) return;

  const legend = document.createElement("p");
  legend.className = "owned-matrix-legend";
  legend.textContent = "◎＝手持ち武器に登録あり（自動）　○＝自分で付けた印　×＝自分で付けた印（いらない・あきらめた など）";

  const grid = document.createElement("div");
  grid.className = "owned-matrix-grid";
  for (const block of ownedMatrix.blocks) {
    const card = document.createElement("div");
    card.className = "owned-matrix-card";
    const table = document.createElement("table");
    table.className = "owned-matrix-table";
    const head = document.createElement("tr");
    const corner = document.createElement("th");
    corner.className = "owned-matrix-corner";
    corner.textContent = matrixBlockTitle(block);
    head.append(corner);
    for (const key of block.columns) {
      const th = document.createElement("th");
      th.textContent = matrixSkillName(key, true);
      th.title = matrixSkillName(key);
      head.append(th);
    }
    const thead = document.createElement("thead");
    thead.append(head);
    const tbody = document.createElement("tbody");
    for (const attribute of OWNED_MATRIX_ATTRIBUTES) {
      const row = document.createElement("tr");
      const rowHead = document.createElement("th");
      rowHead.textContent = optionName(ATTRIBUTES, attribute).replace("属性", "");
      row.append(rowHead);
      for (const key of block.columns) {
        row.append(createOwnedMatrixCell(block, attribute, key));
      }
      tbody.append(row);
    }
    table.append(thead, tbody);
    if (block.columns.length === 0) {
      const empty = document.createElement("p");
      empty.className = "weapon-filter-empty";
      empty.textContent = "列のスキルがありません。下の「表の形を編集」で追加してください。";
      card.append(table, empty);
    } else {
      card.append(table);
    }
    grid.append(card);
  }

  const editor = createOwnedMatrixEditor();
  body.replaceChildren(legend, grid, editor);
  wrapInCollapsible(editor, "owned-matrix-editor", "表の形を編集（かたまり・列のスキルを足す／消す）", "クリックで編集欄が開きます");
}

function createOwnedMatrixCell(block, attribute, key) {
  const cell = document.createElement("td");
  const owned = matrixOwnedWeapons(block, attribute, key);
  const markKey = `${block.id}|${attribute}|${key}`;
  if (owned.length > 0) {
    // 手持ち武器から自動。小さい字でもう片方のスキル（グループの列ならシリーズ、シリーズの列ならグループ）
    cell.className = "owned-matrix-cell auto";
    const symbol = document.createElement("span");
    symbol.className = "owned-matrix-symbol";
    symbol.textContent = "◎";
    const partner = document.createElement("small");
    partner.className = "owned-matrix-partner";
    partner.textContent = [...new Set(owned.map((weapon) => {
      const other = key[0] === "g" ? weapon.seriesIndex : weapon.groupIndex;
      return other === null || other === undefined ? "—" : matrixSkillName(`${key[0] === "g" ? "s" : "g"}${other}`, true);
    }))].join("・");
    cell.append(symbol, partner);
    cell.title = `手持ち：${owned.map((weapon) => `${comparisonTargetName(weapon)}（${ownedSkillText(weapon) || "スキル未登録"}）`).join("／")}`;
    return cell;
  }
  const paint = () => {
    const mark = ownedMatrix.marks[markKey];
    cell.className = `owned-matrix-cell manual${mark === "o" ? " mark-o" : mark === "x" ? " mark-x" : ""}`;
    cell.textContent = mark === "o" ? "○" : mark === "x" ? "×" : "";
    cell.title = "押すと ○ → × → 空 と切り替わります";
  };
  paint();
  cell.tabIndex = 0;
  const cycle = () => {
    const mark = ownedMatrix.marks[markKey];
    if (!mark) ownedMatrix.marks[markKey] = "o";
    else if (mark === "o") ownedMatrix.marks[markKey] = "x";
    else delete ownedMatrix.marks[markKey];
    persistOwnedMatrix();
    paint();
  };
  cell.addEventListener("click", cycle);
  cell.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      cycle();
    }
  });
  return cell;
}

// 表の形の編集：かたまり（名前・武器種・激化・列のスキル）の追加・削除・並び替え
function createOwnedMatrixEditor() {
  const editor = document.createElement("div");
  editor.className = "owned-matrix-editor";
  const changed = () => {
    persistOwnedMatrix();
    renderOwnedMatrix();
  };
  const skillOptions = [
    ["グループスキル", prioritizedSkillOptions(GROUP_SKILLS, PRIORITY_GROUP_SKILL_INDICES).map(([index, label]) => [`g${index}`, label])],
    ["シリーズスキル", prioritizedSkillOptions(SERIES_SKILLS, PRIORITY_SERIES_SKILL_INDICES).map(([index, label]) => [`s${index}`, label])],
  ];

  ownedMatrix.blocks.forEach((block, blockIndex) => {
    const row = document.createElement("div");
    row.className = "owned-matrix-edit-row";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.maxLength = 24;
    nameInput.value = block.name;
    nameInput.placeholder = matrixBlockTitle({ ...block, name: "" });
    nameInput.addEventListener("change", () => { block.name = nameInput.value.trim(); changed(); });
    const weaponSelect = document.createElement("select");
    populateSelect(weaponSelect, WEAPON_TYPES, block.weaponType);
    weaponSelect.addEventListener("change", () => { block.weaponType = Number(weaponSelect.value); changed(); });
    const boostSelect = document.createElement("select");
    populateSelect(boostSelect, OWNED_MATRIX_BOOST_OPTIONS, block.boost);
    boostSelect.addEventListener("change", () => { block.boost = boostSelect.value; changed(); });
    const field = (text, control) => {
      const label = document.createElement("label");
      const span = document.createElement("span");
      span.textContent = text;
      label.append(span, control);
      return label;
    };

    // 列のスキル：札（×で消す）＋「列を追加」
    const columns = document.createElement("div");
    columns.className = "owned-matrix-columns";
    block.columns.forEach((key, columnIndex) => {
      const chip = document.createElement("span");
      chip.className = "owned-matrix-chip";
      const move = (text, offset, label) => {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = text;
        button.title = label;
        button.disabled = columnIndex + offset < 0 || columnIndex + offset >= block.columns.length;
        button.addEventListener("click", () => {
          const to = columnIndex + offset;
          [block.columns[columnIndex], block.columns[to]] = [block.columns[to], block.columns[columnIndex]];
          changed();
        });
        return button;
      };
      const remove = document.createElement("button");
      remove.type = "button";
      remove.textContent = "×";
      remove.title = "この列を消す";
      remove.addEventListener("click", () => { block.columns.splice(columnIndex, 1); changed(); });
      chip.append(move("◀", -1, "左へ"), matrixSkillName(key, true), move("▶", 1, "右へ"), remove);
      columns.append(chip);
    });
    const addColumn = document.createElement("select");
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "＋ 列のスキルを追加…";
    addColumn.append(placeholder);
    for (const [groupLabel, options] of skillOptions) {
      const optgroup = document.createElement("optgroup");
      optgroup.label = groupLabel;
      for (const [value, label] of options) {
        if (block.columns.includes(value)) continue;
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        optgroup.append(option);
      }
      addColumn.append(optgroup);
    }
    addColumn.addEventListener("change", () => {
      if (!addColumn.value) return;
      block.columns.push(addColumn.value);
      changed();
    });
    columns.append(addColumn);

    const actions = document.createElement("div");
    actions.className = "owned-matrix-edit-actions";
    const actionButton = (text, label, onClick, disabled = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "owned-move-button";
      button.textContent = text;
      button.title = label;
      button.setAttribute("aria-label", `${matrixBlockTitle(block)}を${label}`);
      button.disabled = disabled;
      button.addEventListener("click", onClick);
      return button;
    };
    const swap = (offset) => () => {
      const to = blockIndex + offset;
      [ownedMatrix.blocks[blockIndex], ownedMatrix.blocks[to]] = [ownedMatrix.blocks[to], ownedMatrix.blocks[blockIndex]];
      changed();
    };
    actions.append(
      actionButton("↑", "上へ移動", swap(-1), blockIndex === 0),
      actionButton("↓", "下へ移動", swap(1), blockIndex === ownedMatrix.blocks.length - 1),
      actionButton("×", "削除", () => {
        if (!window.confirm(`「${matrixBlockTitle(block)}」のかたまりを表から消しますか？（自分で付けた○×も消えます）`)) return;
        ownedMatrix.blocks.splice(blockIndex, 1);
        for (const markKey of Object.keys(ownedMatrix.marks)) {
          if (markKey.startsWith(`${block.id}|`)) delete ownedMatrix.marks[markKey];
        }
        changed();
      }),
    );

    const fields = document.createElement("div");
    fields.className = "owned-matrix-edit-fields";
    fields.append(field("名前（空なら自動）", nameInput), field("武器種", weaponSelect), field("激化", boostSelect));
    row.append(fields, columns, actions);
    editor.append(row);
  });

  const footer = document.createElement("div");
  footer.className = "owned-matrix-edit-footer";
  const addBlock = document.createElement("button");
  addBlock.type = "button";
  addBlock.className = "secondary small-button";
  addBlock.textContent = "かたまりを追加";
  addBlock.addEventListener("click", () => {
    ownedMatrix.blocks.push(normalizeMatrixBlock({ weaponType: 0, boost: "", columns: ["g13"] }));
    changed();
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "text-button";
  reset.textContent = "最初の形（Excelと同じ）に戻す";
  reset.addEventListener("click", () => {
    if (!window.confirm("表の形を最初の形に戻します。自分で付けた○×も消えます。よろしいですか？")) return;
    ownedMatrix = { blocks: OWNED_MATRIX_DEFAULT_BLOCKS.map(normalizeMatrixBlock), marks: {} };
    changed();
  });
  footer.append(addBlock, reset);
  editor.append(footer);
  return editor;
}

// 手持ち武器の「一致にする条件」を、全部または武器種ごとにまとめて書き換える
function createOwnedBulkRuleBox() {
  const box = document.createElement("div");
  box.className = "owned-bulk-rule";
  const description = document.createElement("p");
  description.className = "weapon-filter-empty";
  description.textContent = "登録済みの手持ち武器の「一致にする条件」を、まとめて同じものにします。あとから1本ずつ直すこともできます。";
  const targetLabel = document.createElement("label");
  const targetText = document.createElement("span");
  targetText.textContent = "対象";
  const targetSelect = document.createElement("select");
  const weaponTypes = [...new Set(ownedWeapons.map((weapon) => weapon.weaponType))].sort((a, b) => a - b);
  const countOf = (weaponType) => ownedWeapons.filter((weapon) => weapon.weaponType === weaponType).length;
  populateSelect(targetSelect, [
    ["all", `すべての手持ち武器（${ownedWeapons.length}本）`],
    ...weaponTypes.map((weaponType) =>
      [String(weaponType), `${t(optionName(WEAPON_TYPES, weaponType))}だけ（${countOf(weaponType)}本）`]),
  ], "all");
  targetLabel.append(targetText, targetSelect);
  const rule = createOwnedRuleControls({ rule: "upgrade", minEx: 2 });
  const applyButton = document.createElement("button");
  applyButton.type = "button";
  applyButton.className = "secondary small-button";
  applyButton.textContent = "まとめて設定する";
  applyButton.addEventListener("click", () => {
    const targets = targetSelect.value === "all"
      ? ownedWeapons
      : ownedWeapons.filter((weapon) => weapon.weaponType === Number(targetSelect.value));
    const ruleName = rule.ruleSelect.value === "ex"
      ? `EX ${rule.exSelect.value}個以上`
      : optionName(OWNED_RULE_OPTIONS, rule.ruleSelect.value);
    const targetName = targetSelect.selectedOptions[0]?.textContent ?? "";
    const keepText = rule.keepAttack.checked ? "・攻撃は下げない" : "・攻撃を下げてもよい";
    if (!window.confirm(`${targetName}の一致にする条件を「${ruleName}${keepText}」にします。よろしいですか？`)) return;
    for (const weapon of targets) {
      weapon.rule = rule.ruleSelect.value;
      weapon.minEx = Number(rule.exSelect.value);
      weapon.keepAttack = rule.keepAttack.checked;
    }
    onOwnedWeaponsChanged();
  });
  box.append(description, targetLabel, rule.wrap, applyButton);
  return box;
}

function updateComparisonStatus() {
  if (comparisonTargets.length === 0 && ownedWeapons.length === 0) {
    comparisonStatus.textContent = "予測対象を登録してください";
  } else if (!selectedCandidate) {
    comparisonStatus.textContent = `${comparisonTargets.length.toLocaleString("ja-JP")}件・基準seedと復元カウンター待ち`;
  } else if (comparisonRollSets.length === 0) {
    if (bonusPrediction.mode === "keep") {
      const ready = comparisonTargets.filter((target) => keepLayoutProblem(target) === null).length;
      comparisonStatus.textContent = `${ready}/${comparisonTargets.length} 武器の構成入力済み`;
    } else {
      comparisonStatus.textContent = `${comparisonTargets.length.toLocaleString("ja-JP")}条件`;
    }
  }
  comparisonStatus.className = "status-pill";
}

function showComparisonError(message) {
  comparisonError.textContent = message;
  comparisonError.hidden = false;
}

function hideComparisonError() {
  comparisonError.textContent = "";
  comparisonError.hidden = true;
}

async function findSkillPosition() {
  hideSkillError();
  resetSkillSearchFeedback();

  if (saveState.baseSeed === null) {
    showSkillError("先に基準seedを検索するか、未来予測タブで基準seedを入力してください。");
    return;
  }

  findSkillPositionButton.disabled = true;
  skillStatus.textContent = "スキルカウンターを探索中";
  skillStatus.className = "status-pill running";

  try {
    const observations = readSkillObservations();
    const counterStart = readInteger("skill-counter-start", "スキル内部位置の開始", 0, 0xffffffff);
    const counterEnd = readInteger("skill-counter-end", "スキル内部位置の終了", 0, 0xffffffff);
    if (counterStart > counterEnd) {
      throw new Error("スキル内部位置の開始は終了以下にしてください。");
    }

    await ensurePredictionWasm();
    const counters = Array.from(
      find_skill_counters(
        saveState.baseSeed,
        Number(skillWeaponSelect.value),
        Number(skillAttributeSelect.value),
        SKILL_COUNTER_GATE,
        counterStart,
        counterEnd,
        new Uint16Array(observations),
      ),
    );

    if (counters.length === 0) {
      throw new Error(
        "一致するスキルカウンターがありません。武器種・属性・入力順を確認し、必要なら探索範囲を広げてください。",
      );
    }
    if (counters.length > 1) {
      skillStatus.textContent = `${counters.length.toLocaleString("ja-JP")}候補`;
      skillStatus.className = "status-pill";
      showSkillError(
        `候補が${counters.length.toLocaleString("ja-JP")}件あります。続きの再付与結果を追加してください。`,
      );
      return;
    }

    selectedSkillCounter = counters[0];
    skillObservedCount = observations.length;
    currentSkillObservations = observations;
    setStateFromSkill(saveState.baseSeed, selectedSkillCounter, "検索結果");
    const observedTarget = {
      weaponType: Number(skillWeaponSelect.value),
      attributeForce: Number(skillAttributeSelect.value),
      label: "",
    };
    if (
      comparisonTargets.length < MAX_REGISTERED_TARGETS &&
      !comparisonTargets.some(
        (target) => comparisonCombinationKey(target) === comparisonCombinationKey(observedTarget),
      )
    ) {
      comparisonTargets.push({
        ...observedTarget,
        id: createTargetId(),
        keepCategories: [null, null, null, null, null],
        keepSource: null,
      });
      renderComparisonTargets();
      persistAppState();
    }
    await verifySkillObservationPrefix(observations);
    renderPredictionTable();
    renderComparisonTable();
    await refreshSkillPredictions();
    skillStatus.textContent = `スキルカウンター ${selectedSkillCounter.toLocaleString("ja-JP")} を特定`;
    skillStatus.className = "status-pill complete";
  } catch (error) {
    if (selectedSkillCounter === null) {
      skillStatus.textContent = "位置未特定";
      skillStatus.className = "status-pill";
    }
    showSkillError(error instanceof Error ? error.message : String(error));
  } finally {
    findSkillPositionButton.disabled = false;
  }
}

async function verifySkillObservationPrefix(observations) {
  await ensurePredictionWasm();
  const tableIndices = predict_skill_rolls(
    saveState.baseSeed,
    Number(skillWeaponSelect.value),
    Number(skillAttributeSelect.value),
    saveState.skillCounter,
    SKILL_COUNTER_GATE,
    observations.length,
  );
  if (!flattenedPrefixMatches(tableIndices, observations)) {
    throw new Error("観測したスキル結果と特定位置の先頭が一致しません。");
  }
}

async function refreshSkillPredictions() {
  if (saveState.baseSeed === null || saveState.skillCounter === null) {
    clearSkillPredictionResults();
    skillFutureStatus.textContent = "基準seedとスキルカウンターを入力してください";
    return;
  }
  if (comparisonTargets.length === 0) {
    clearSkillPredictionResults();
    skillFutureStatus.textContent = "予測対象を登録してください";
    return;
  }

  skillFutureStatus.textContent = "スキル未来を計算中";
  skillFutureStatus.className = "status-pill running";

  try {
    const predictionCount = readSkillPredictionCount();
    await ensurePredictionWasm();
    skillPredictionRollSets = uniqueTargetsByCombination().map((target) => {
      const tableIndices = predict_skill_rolls(
        saveState.baseSeed,
        target.weaponType,
        target.attributeForce,
        saveState.skillCounter,
        SKILL_COUNTER_GATE,
        predictionCount,
      );
      return {
        ...target,
        rolls: Array.from(tableIndices, (tableIndex) => ({
          seriesIndex: Math.floor(tableIndex / GROUP_SKILLS.length),
          groupIndex: tableIndex % GROUP_SKILLS.length,
        })),
      };
    });
    renderSkillPredictionTable();
  } catch (error) {
    clearSkillPredictionResults();
    skillFutureStatus.textContent = "予測エラー";
    skillFutureStatus.className = "status-pill";
    showSkillTargetError(error instanceof Error ? error.message : String(error));
  }
}

function readSkillPredictionCount() {
  const value = Number(skillPredictionCountInput.value);
  if (!Number.isSafeInteger(value) || value < 1 || value > 10_000) {
    throw new Error("スキルの表示回数は1〜10,000の整数で入力してください。");
  }
  return value;
}

function selectedSkillFilter() {
  return {
    enabled: skillFilterEnabled.checked,
    groupIndex: Number(skillFilterGroupSelect.value),
    operator: skillFilterOperatorSelect.value,
    seriesIndices: new Set(
      [...skillFilterSeriesOptions.querySelectorAll('input[name="skill-filter-series"]:checked')]
        .map((checkbox) => Number(checkbox.value)),
    ),
  };
}

function loadWeaponSkillFilters() {
  try {
    const saved = JSON.parse(localStorage.getItem(WEAPON_SKILL_FILTERS_KEY) ?? "{}");
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

function persistWeaponSkillFilters() {
  try {
    localStorage.setItem(WEAPON_SKILL_FILTERS_KEY, JSON.stringify(weaponSkillFilters));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function hasWeaponSkillFilter(weaponType) {
  const entry = weaponSkillFilters[weaponType];
  return !!entry && (entry.groupIndex >= 0 || entry.seriesIndices.length > 0);
}

// 武器種ごとの条件があればそれを使う（グループとシリーズは常にAND）。なければ共通の条件
function skillFilterForTarget(filter, target) {
  if (!hasWeaponSkillFilter(target.weaponType)) return filter;
  const entry = weaponSkillFilters[target.weaponType];
  return {
    ...filter,
    groupIndex: entry.groupIndex,
    operator: "and",
    seriesIndices: new Set(entry.seriesIndices),
  };
}

function renderWeaponFilterSection() {
  if (!weaponFilterSection) {
    weaponFilterSection = document.createElement("section");
    weaponFilterSection.className = "skill-filter-settings weapon-filter-settings";
    document.querySelector(".skill-filter-settings")?.after(weaponFilterSection);
  }

  const weaponTypes = [...new Set(comparisonTargets.map((target) => target.weaponType))]
    .sort((a, b) => a - b);

  const intro = document.createElement("div");
  intro.className = "skill-filter-intro";
  const title = document.createElement("strong");
  title.textContent = "武器種ごとの条件";
  const description = document.createElement("p");
  description.textContent = "武器種ごとにグループスキルとシリーズスキルを指定できます。指定した武器種は「グループスキル かつ 選んだシリーズスキルのどれか」で判定し、上の共通の条件は使いません。何も指定していない武器種は共通の条件で判定します。";
  intro.append(title, description);

  if (weaponTypes.length === 0) {
    const empty = document.createElement("p");
    empty.className = "weapon-filter-empty";
    empty.textContent = "武器を登録すると、ここに武器種ごとの設定欄が出ます。";
    weaponFilterSection.replaceChildren(intro, empty);
    return;
  }

  const rows = weaponTypes.map((weaponType) => {
    const entry = weaponSkillFilters[weaponType] ?? { groupIndex: -1, seriesIndices: [] };
    const row = document.createElement("details");
    row.className = "weapon-filter-row";

    const summary = document.createElement("summary");
    const name = document.createElement("span");
    name.className = "weapon-filter-name";
    name.textContent = t(optionName(WEAPON_TYPES, weaponType));
    const state = document.createElement("span");
    state.className = "weapon-filter-state";
    const stateText = (current) => hasWeaponSkillFilter(weaponType)
      ? [
          current.groupIndex >= 0 ? GROUP_SKILLS[current.groupIndex] : null,
          current.seriesIndices.length > 0 ? current.seriesIndices.map((i) => SERIES_SKILLS[i]).join(" / ") : null,
        ].filter(Boolean).join(" ＋ ")
      : "共通の条件を使用";
    state.textContent = stateText(entry);
    summary.append(name, state);
    setupCollapsible(row, summary, `skill-filter:${weaponType}`);

    const groupLabel = document.createElement("label");
    groupLabel.textContent = "グループスキル";
    const groupSelect = document.createElement("select");
    populateSelect(
      groupSelect,
      [[-1, "指定しない"], ...prioritizedSkillOptions(GROUP_SKILLS, PRIORITY_GROUP_SKILL_INDICES)
        .map(([index, label]) => [index, skillLabelWithEffect(label)])],
      entry.groupIndex,
    );
    groupLabel.append(groupSelect);
    attachGroupEffectNote(groupSelect);

    const seriesFieldset = document.createElement("fieldset");
    seriesFieldset.className = "skill-filter-series";
    const legend = document.createElement("legend");
    legend.textContent = "シリーズスキル（複数選択はOR）";
    const seriesOptions = document.createElement("div");
    seriesOptions.className = "skill-filter-series-options";
    seriesOptions.append(
      ...prioritizedSkillOptions(SERIES_SKILLS, PRIORITY_SERIES_SKILL_INDICES).map(([index, label]) => {
        const optionLabel = document.createElement("label");
        const checkbox = document.createElement("input");
        const text = document.createElement("span");
        checkbox.type = "checkbox";
        checkbox.value = String(index);
        checkbox.checked = entry.seriesIndices.includes(index);
        text.textContent = label;
        text.append(skillEffectSpan(label));
        optionLabel.append(checkbox, text);
        return optionLabel;
      }),
    );
    seriesFieldset.append(legend, seriesOptions);

    const clearButton = document.createElement("button");
    clearButton.type = "button";
    clearButton.className = "text-button";
    clearButton.textContent = "この武器種の条件をクリア";

    const save = () => {
      const next = {
        groupIndex: Number(groupSelect.value),
        seriesIndices: [...seriesOptions.querySelectorAll("input:checked")].map((c) => Number(c.value)),
      };
      if (next.groupIndex >= 0 || next.seriesIndices.length > 0) weaponSkillFilters[weaponType] = next;
      else delete weaponSkillFilters[weaponType];
      persistWeaponSkillFilters();
      state.textContent = stateText(next);
      renderSkillPredictionTable();
    };
    groupSelect.addEventListener("change", save);
    seriesOptions.addEventListener("change", save);
    clearButton.addEventListener("click", () => {
      groupSelect.value = "-1";
      seriesOptions.querySelectorAll("input").forEach((c) => (c.checked = false));
      groupSelect.dispatchEvent(new Event("change"));
    });

    const body = document.createElement("div");
    body.className = "weapon-filter-body";
    body.append(groupLabel, seriesFieldset, clearButton);
    row.append(summary, body);
    return row;
  });

  weaponFilterSection.replaceChildren(intro, ...rows);
}

function skillRollMatchesFilter(roll, filter) {
  const hasGroup = filter.groupIndex >= 0;
  const hasSeries = filter.seriesIndices.size > 0;
  const groupMatches = hasGroup && roll.groupIndex === filter.groupIndex;
  const seriesMatches = hasSeries && filter.seriesIndices.has(roll.seriesIndex);

  if (!hasGroup && !hasSeries) return false;
  if (!hasGroup) return seriesMatches;
  if (!hasSeries) return groupMatches;
  return filter.operator === "and"
    ? groupMatches && seriesMatches
    : groupMatches || seriesMatches;
}

function skillPredictionVisibility(filter = selectedSkillFilter()) {
  if (skillPredictionRollSets.length === 0) {
    return { count: 0, matchingRowCount: 0, visibleIndices: [] };
  }

  const count = skillPredictionRollSets[0].rolls.length;
  const allIndices = Array.from({ length: count }, (_, index) => index);
  const rowMatchesFilter = (index) => skillPredictionRollSets.some((target) =>
    skillRollMatchesFilter(target.rolls[index], skillFilterForTarget(filter, target))
  );
  const matchingIndices = allIndices.filter(rowMatchesFilter);
  return {
    count,
    matchingRowCount: matchingIndices.length,
    visibleIndices: filter.enabled ? matchingIndices : allIndices,
  };
}

function renderSkillPredictionTable() {
  if (skillPredictionRollSets.length === 0) return;

  const skillFilter = selectedSkillFilter();
  const highlightEnabled = skillHighlightEnabled.checked;
  skillTableWrap.classList.toggle("skill-results-focused", skillFilter.enabled);
  const { count, matchingRowCount, visibleIndices } = skillPredictionVisibility(skillFilter);
  const conditionMatchCount = skillPredictionRollSets.reduce((total, target) => {
    const targetFilter = skillFilterForTarget(skillFilter, target);
    return total + target.rolls.filter((roll) => skillRollMatchesFilter(roll, targetFilter)).length;
  }, 0);

  const filterStatus = skillFilter.enabled
    ? `・条件一致${matchingRowCount.toLocaleString("ja-JP")}行`
    : "";
  skillFutureStatus.textContent = `${skillPredictionRollSets.length.toLocaleString("ja-JP")}件 × ${count.toLocaleString("ja-JP")}回・条件一致${conditionMatchCount.toLocaleString("ja-JP")}セル${filterStatus}`;
  skillFutureStatus.className = "status-pill complete";
  skillTableWrap.hidden = false;
  exportSkillCsvButton.disabled = visibleIndices.length === 0;
  skillExportStatus.textContent = skillFilter.enabled
    ? `条件一致で現在表示中の${visibleIndices.length.toLocaleString("ja-JP")}行をCSVへ出力します。`
    : `現在表示中の${visibleIndices.length.toLocaleString("ja-JP")}行をCSVへ出力します。`;

  const offsetHeader = document.createElement("th");
  const stateHeader = document.createElement("th");
  offsetHeader.scope = "col";
  offsetHeader.textContent = "何回先";
  stateHeader.scope = "col";
  stateHeader.textContent = "保存後の状態";
  const matchHeader = document.createElement("th");
  matchHeader.scope = "col";
  matchHeader.textContent = skillFilter.enabled ? "条件に一致した武器" : "一致";
  skillPredictionHeaderRow.replaceChildren(
    offsetHeader,
    stateHeader,
    matchHeader,
    ...(skillFilter.enabled ? [] : skillPredictionRollSets.map((target) => {
      const header = document.createElement("th");
      header.scope = "col";
      header.textContent = comparisonTargetName(target);
      return header;
    })),
  );

  if (visibleIndices.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = skillFilter.enabled ? 3 : 3 + skillPredictionRollSets.length;
    cell.className = "prediction-empty";
    cell.textContent = "指定したグループ・シリーズ条件に合う結果は表示範囲内にありません。表示回数を増やすか条件を変更してください。";
    row.append(cell);
    skillPredictionRows.replaceChildren(row);
    return;
  }

  skillPredictionRows.replaceChildren(
    ...visibleIndices.map((index) => createSkillPredictionRow(index, skillFilter, highlightEnabled)),
  );
}

function exportVisibleSkillPredictionsCsv() {
  const { visibleIndices } = skillPredictionVisibility();
  if (visibleIndices.length === 0 || skillPredictionRollSets.length === 0) {
    showSkillTargetError("CSVへ出力できるスキル未来予測の結果がありません。");
    return;
  }

  hideSkillTargetError();
  const headers = [
    t("何回先"),
    t("カウンター位置"),
    ...skillPredictionRollSets.flatMap((target) => {
      const targetName = predictionCsvTargetName(target);
      return [
        `${targetName} ${t("シリーズスキル")}`,
        `${targetName} ${t("グループスキル")}`,
      ];
    }),
  ];
  const rows = visibleIndices.map((index) => [
    index + 1,
    saveState.skillCounter + index + 1,
    ...skillPredictionRollSets.flatMap((target) => {
      const roll = target.rolls[index];
      return [
        t(SERIES_SKILLS[roll.seriesIndex] ?? `シリーズ ${roll.seriesIndex}`),
        t(GROUP_SKILLS[roll.groupIndex] ?? `グループ ${roll.groupIndex}`),
      ];
    }),
  ]);
  downloadCsv(
    `gogma-skill-future-seed-${saveState.baseSeed}-counter-${saveState.skillCounter}.csv`,
    headers,
    rows,
  );
  skillExportStatus.textContent = `${rows.length.toLocaleString("ja-JP")}行・${headers.length.toLocaleString("ja-JP")}列をCSVへ出力しました。`;
}

function createSkillPredictionRow(index, skillFilter, highlightEnabled) {
  const row = document.createElement("tr");
  const offsetCell = document.createElement("th");
  offsetCell.scope = "row";
  offsetCell.textContent = `${index + 1}回先`;
  row.append(offsetCell, createSavedStateCell("skill", index + 1, null, true));

  // 条件に一致した武器を左側の「一致」列にまとめる
  const matchCell = document.createElement("td");
  matchCell.className = "skill-match-cell";
  const matches = document.createElement("div");
  matches.className = "skill-matches-grid";
  row.append(matchCell);

  for (const target of skillPredictionRollSets) {
    const roll = target.rolls[index];
    // 一致の判定を色の強調から独立させ、強調OFFでも一致カードを残す。
    const conditionMatch = skillRollMatchesFilter(roll, skillFilterForTarget(skillFilter, target));
    if (!skillFilter.enabled) {
      const cell = document.createElement("td");
      cell.append(createSkillResultPair(roll, conditionMatch && highlightEnabled));
      const holdersBadge = createOwnedSkillBadge(target, roll);
      if (holdersBadge) cell.append(holdersBadge);
      row.append(cell);
    }

    if (conditionMatch) {
      const item = document.createElement("div");
      const name = document.createElement("div");
      const summary = document.createElement("div");
      item.className = "skill-match-item";
      summary.className = "skill-match-summary";
      name.className = "skill-match-name";
      name.append(...createWeaponBadge(target));
      summary.append(name, createSkillResultPair(roll, highlightEnabled));
      item.append(summary);
      const coverage = createSkillBoostCoverage(target, roll);
      let replacements = null;
      if (skillFilter.enabled) {
        replacements = createSkillReplacementList(target, roll, index + 1);
      }
      if (replacements) {
        const options = document.createElement('div'); options.className='skill-match-options';
        options.append(replacements,coverage);item.append(options);
      } else item.append(coverage);
      item.append(createSkillAdoptButton(target, roll, index + 1));
      matches.append(item);
    }
  }

  if (matches.childElementCount === 0) {
    const none = document.createElement("span");
    none.className = "skill-match-none";
    none.textContent = "—";
    matchCell.append(none);
  } else {
    matchCell.append(matches);
  }
  return row;
}

// 各武器の列に表示する、同じスキルを持つ激化タイプ（特徴付き）。
function createOwnedSkillBadge(target, roll) {
  const coverage = skillBoostOwnership(target, roll);
  const holders = [...coverage.boosts.flatMap((entry) => entry.holders), ...coverage.unknown];
  if (holders.length === 0) return null;
  const badge = document.createElement("div");
  badge.className = "skill-owned-list";
  for (const weapon of new Map(holders.map((weapon) => [weapon.boost, weapon])).values()) {
    const entry = document.createElement("div");
    entry.className = "skill-owned-badge";
    appendSkillBoostLabel(entry, weapon, weapon.boost, "所持済み：");
    badge.append(entry);
  }
  badge.title = holders.map((weapon) => comparisonTargetName(weapon)).join("\n");
  return badge;
}

// 一致したスキルを新しく作るときの候補。表示だけで武器やカウンターを変更しない。
function createSkillBoostCoverage(target, roll) {
  const { boosts, unknown } = skillBoostOwnership(target, roll);
  const wrap = document.createElement("div");
  wrap.className = "skill-boost-coverage";
  const note = document.createElement("small");
  note.className = "skill-coverage-note";
  note.textContent = "このスキルの組み合わせでの所持状況";
  wrap.append(note);
  const owned = createOwnedSkillBadge(target, roll);
  if (owned) wrap.append(owned);
  const missing = boosts.filter((entry) => entry.holders.length === 0);
  if (missing.length > 0) {
    const heading = document.createElement("strong");
    heading.className = "skill-missing-heading";
    heading.textContent = unknown.length > 0 ? "作成候補（所持状況の確認が必要）" : "作るなら（未所持）";
    wrap.append(heading);
    for (const { boost } of missing) {
      const candidate = document.createElement("div");
      candidate.className = "skill-missing-candidate";
      candidate.dataset.boost = boost;
      appendSkillBoostLabel(candidate, target, boost, `${unknown.length > 0 ? "所持未確認" : "未所持"}：`);
      wrap.append(candidate);
    }
  } else {
    const complete = document.createElement("strong");
    complete.className = "skill-coverage-complete";
    complete.textContent = "全3タイプ所持済み";
    wrap.append(complete);
  }
  if (unknown.length > 0) {
    const warning = document.createElement("small");
    warning.className = "skill-coverage-note";
    warning.textContent = "同じスキルの武器に激化未登録のものがあります。手持ち武器【巨戟】で登録すると判定できます。";
    wrap.append(warning);
  }
  return wrap;
}

// 武器を選んだあと、スキルとカウンターの変更を確定する前に確認する。
function newPredictionOwnedWeapon(target, boost, {skills = {}, bonuses = null} = {}) {
  const subtype=ownedSubtypeFor(target.weaponType,target.attributeForce,boost);
  return {id:createTargetId(),label:boost?ownedWeaponAutoName({...target,boost,subtype}).slice(0,24):'',
    weaponType:target.weaponType,attributeForce:target.attributeForce,boost,subtype,
    seriesIndex:skills.seriesIndex??null,groupIndex:skills.groupIndex??null,
    bonuses:bonuses?[...bonuses]:[null,null,null,null,null],categories:bonuses?bonuses.map(bonusCategoryId):[null,null,null,null,null],rule:'upgrade',minEx:2};
}

// スキルの当たりを採用するボタン。武器選択→最終確認→反映の順に進める。
function createSkillAdoptButton(target, roll, completedRolls) {
  const wrap = document.createElement("div");
  wrap.className = "skill-adopt";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "keep-transition-button match-adopt-button";
  button.textContent = "採用して手持ちに反映";
  button.title = "このスキルを採用してセーブしたものとしてスキルカウンターの0地点を進め、手持ち武器に反映します";
  // 表の中に出すと下の行（左に固定した一致列）の後ろに隠れるので、画面の真ん中に出す窓にする
  button.addEventListener("click", () => {
    const basis = workbenchRead();
    const sameKind = ownedWeapons.filter((weapon) =>
      weapon.weaponType === target.weaponType && weapon.attributeForce === target.attributeForce);
    openAdoptDialog({
      title: `${completedRolls}回先のスキルを手持ち武器に反映`,
      summary: [...createWeaponBadge(target), createSkillResultPair(roll, true)],
      note: "武器を選ぶと、上書きするスキルとカウンターの変更内容を確認する画面が開きます。確認して反映すると、スキルカウンターの0地点もこの回まで進めます。",
      heading: sameKind.length > 0
        ? "どの武器のスキルを上書きしますか？（同じ武器種・属性の手持ち武器）"
        : "同じ武器種・属性の手持ち武器はありません。新しく登録します。",
      // 同じ武器が2本以上あっても見分けられるよう、激化・今のスキル・今の復元ボーナスまで出す
      choices: [
        ...sameKind.map((weapon) => ({
          tag: "上書き",
          name: comparisonTargetName(weapon),
          detail: ownedWeaponDetailNode(weapon),
          onChoose: () => adoptSkillToOwned(weapon, roll, completedRolls, basis, () => button.click()),
        })),
        ...OWNED_BOOST_OPTIONS.map(([boost]) => ({
          name: `＋ 新しい手持ち武器として登録：${skillBoostLabel(target, boost)}`,
          onChoose: () => adoptSkillAsNewOwned(target, boost, roll, completedRolls, basis, () => button.click()),
        })),
      ],
    });
  });
  wrap.append(button);
  return wrap;
}

function adoptSkillToOwned(weapon, roll, completedRolls, expected, onCancel) {
  return runCounterChange({kind:'skill',steps:completedRolls,title:'この武器のスキルを上書きしますか？',expected,onCancel,
    summary:operationWeaponPreview({target:weapon,weapon,skills:roll}),
    change:model=>{
      const owned=model.ownedWeapons.find(w=>w.id===weapon.id);
      if(!owned)throw new Error('対象の武器が見つかりません。');
      if(!Number.isInteger(roll.seriesIndex)||!SERIES_SKILLS[roll.seriesIndex]||!Number.isInteger(roll.groupIndex)||!GROUP_SKILLS[roll.groupIndex])throw new Error('スキルの指定を確認してください。');
      owned.seriesIndex=roll.seriesIndex;owned.groupIndex=roll.groupIndex;
    },success:comparisonTargetName(weapon)+'のスキルを '+ownedSkillText(roll)+' に反映し、スキルカウンターを更新しました。',confirmLabel:'上書きしてカウンターを進める'});
}

function adoptSkillAsNewOwned(target, boost, roll, completedRolls, expected, onCancel) {
  return runCounterChange({kind:'skill',steps:completedRolls,title:'新しい手持ち武器として登録しますか？',expected,onCancel,
    summary:operationWeaponPreview({target:{...target,boost},skills:roll}),
    change:model=>{
      if(model.ownedWeapons.length>=MAX_OWNED_WEAPONS)throw new Error('手持ち武器【巨戟】が上限です。整理してから登録してください。');
      if(!Number.isInteger(roll.seriesIndex)||!SERIES_SKILLS[roll.seriesIndex]||!Number.isInteger(roll.groupIndex)||!GROUP_SKILLS[roll.groupIndex])throw new Error('スキルの指定を確認してください。');
      model.ownedWeapons.push(newPredictionOwnedWeapon(target,boost,{skills:roll}));
    },success:skillBoostLabel(target,boost)+'を '+ownedSkillText(roll)+' で手持ち武器【巨戟】に登録し、スキルカウンターを更新しました。',confirmLabel:'登録してカウンターを進める'});
}

function createSkillResultPair(roll, conditionMatch) {
  const tags = document.createElement("div");
  const seriesTag = document.createElement("span");
  const groupTag = document.createElement("span");
  tags.className = "skill-result-pair";
  seriesTag.className = `skill-tag series${conditionMatch ? " desired" : ""}`;
  seriesTag.textContent = SERIES_SKILLS[roll.seriesIndex] ?? `シリーズ ${roll.seriesIndex}`;
  groupTag.className = `skill-tag group${conditionMatch ? " jackpot" : ""}`;
  groupTag.textContent = GROUP_SKILLS[roll.groupIndex] ?? `グループ ${roll.groupIndex}`;
  tags.append(seriesTag, groupTag);
  return tags;
}

function clearSkillPredictionResults() {
  skillPredictionRollSets = [];
  skillPredictionHeaderRow.replaceChildren();
  skillPredictionRows.replaceChildren();
  skillTableWrap.hidden = true;
  exportSkillCsvButton.disabled = true;
  skillExportStatus.textContent = "予測結果を表示するとCSVへ出力できます。";
}

function resetSkillSearchFeedback() {
  skillStatus.textContent = saveState.skillCounter === null
    ? "観測結果を入力してください"
    : `現在のスキルカウンター ${saveState.skillCounter.toLocaleString("ja-JP")}`;
  skillStatus.className = `status-pill${saveState.skillCounter === null ? "" : " complete"}`;
  hideSkillError();
}

function showSkillError(message) {
  skillError.textContent = message;
  skillError.hidden = false;
}

function hideSkillError() {
  skillError.textContent = "";
  skillError.hidden = true;
}

function showSkillTargetError(message) {
  skillTargetError.textContent = message;
  skillTargetError.hidden = false;
}

function hideSkillTargetError() {
  skillTargetError.textContent = "";
  skillTargetError.hidden = true;
}

function showPredictionError(message) {
  predictionError.textContent = message;
  predictionError.hidden = false;
}

function hidePredictionError() {
  predictionError.textContent = "";
  predictionError.hidden = true;
}

function setRunning(running) {
  startButton.disabled = running;
  cancelButton.disabled = !running;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function hideError() {
  errorBox.textContent = "";
  errorBox.hidden = true;
}

// ===== ここから下は元のツール（apeshinzo78/GogmaSeedFinder）の新しい版から取り込んだ部分 =====
// 「保存しました」のお知らせ
function showSaveFeedback(title, messages) {
  saveFeedbackTitle.textContent = t(title);
  saveFeedbackMessages.replaceChildren(...messages.map((message) => {
    const line = document.createElement("p");
    line.textContent = t(message);
    return line;
  }));
  saveFeedback.hidden = false;
}

function hideSaveFeedback() {
  saveFeedback.hidden = true;
}

function savedCounterMessage(label, value) {
  return `${label} ${value.toLocaleString("ja-JP")} を保存しました。`;
}

function showSavedCounters(messages, details = []) {
  const [title, ...remainingMessages] = messages;
  if (!title) return;
  showSaveFeedback(title, [...remainingMessages, ...details]);
}

// 表のページ切り替え（改良版では通常アーティアの表だけで使う）
function wireTablePagers() {
  for (const [key, pager] of Object.entries(tablePagers)) {
    pager.previous.addEventListener("click", () => changeTablePage(key, -1));
    pager.next.addEventListener("click", () => changeTablePage(key, 1));
  }
}

function changeTablePage(key, delta) {
  tablePageIndexes[key] += delta;
  const pager = tablePagers[key];
  pager.render();
  pager.wrapper.scrollTop = 0;
  pager.wrapper.scrollLeft = 0;
}

function resetTablePage(key) {
  tablePageIndexes[key] = 0;
}

function clearTablePager(key) {
  resetTablePage(key);
  const pager = tablePagers[key];
  pager.root.hidden = true;
  pager.status.textContent = "";
  pager.previous.disabled = true;
  pager.next.disabled = true;
}

function tablePage(items, key) {
  const total = items.length;
  const pageCount = Math.max(1, Math.ceil(total / TABLE_PAGE_SIZE));
  const page = Math.min(Math.max(0, tablePageIndexes[key]), pageCount - 1);
  tablePageIndexes[key] = page;
  const start = page * TABLE_PAGE_SIZE;
  const end = Math.min(total, start + TABLE_PAGE_SIZE);
  const pager = tablePagers[key];
  pager.root.hidden = total <= TABLE_PAGE_SIZE;
  pager.previous.disabled = page === 0;
  pager.next.disabled = page >= pageCount - 1;
  pager.status.textContent = total === 0
    ? ""
    : t(`${(start + 1).toLocaleString("ja-JP")}〜${end.toLocaleString("ja-JP")} / ${total.toLocaleString("ja-JP")}件`);
  return items.slice(start, end);
}

// 通常アーティア（03 通常アーティアカウンター特定・04 通常アーティア未来予測）
function artianBaseCounterKey(
  weaponType = Number(artianBaseWeaponSelect.value),
) {
  return `${weaponType}:${ARTIAN_R8_ENUM}`;
}

function currentArtianAttributeForce() {
  return BOWGUN_WEAPON_TYPES.has(Number(artianBaseWeaponSelect.value))
    ? 0
    : Number(artianBaseAttributeSelect.value);
}

function syncArtianAttributeControl() {
  const isBowgun = BOWGUN_WEAPON_TYPES.has(Number(artianBaseWeaponSelect.value));
  if (isBowgun) {
    artianBaseAttributeSelect.value = "0";
    artianSearchAttributeSelect.value = "0";
  } else {
    artianSearchAttributeSelect.value = artianBaseAttributeSelect.value;
  }
  artianSearchWeaponSelect.value = artianBaseWeaponSelect.value;
  artianBaseAttributeSelect.disabled = isBowgun;
  artianSearchAttributeSelect.disabled = isBowgun;
}

function syncArtianBaseSeed() {
  if (saveState.baseSeed === null) return;
  if (artianBaseState.baseSeed === saveState.baseSeed) return;
  artianBaseState = {
    baseSeed: saveState.baseSeed,
    counters: {},
    sources: {},
  };
  artianBasePredictionRolls = [];
}

function currentArtianBaseCounter() {
  return artianBaseCounterForWeapon(Number(artianBaseWeaponSelect.value));
}

function artianBaseCounterForWeapon(weaponType) {
  if (saveState.baseSeed === null || artianBaseState.baseSeed !== saveState.baseSeed) return null;
  const value = Number(artianBaseState.counters[artianBaseCounterKey(weaponType)]);
  return Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

// 改良版：06・07 の一覧は押せるボタンにして、押すとその武器種を選ぶ（未特定は灰色）
function createArtianCounterOverviewItems(highlightSelectedWeapon) {
  const selectedWeaponType = Number(artianBaseWeaponSelect.value);
  return WEAPON_TYPES.map(([weaponType, weaponName]) => {
      const counter = artianBaseCounterForWeapon(weaponType);
      const item = document.createElement(highlightSelectedWeapon ? "button" : "div");
      const label = document.createElement("span");
      const value = document.createElement("strong");
      item.className = `artian-counter-overview-item${highlightSelectedWeapon && weaponType === selectedWeaponType ? " selected" : ""}${counter === null ? " unknown" : ""}`;
      label.textContent = t(weaponName);
      value.textContent = counter === null ? t("未特定") : counter.toLocaleString("ja-JP");
      item.append(label, value);
      if (highlightSelectedWeapon) {
        item.type = "button";
        item.title = counter === null
          ? `${weaponName}を選びます（まだカウンターが分かっていません）`
          : `${weaponName}を選びます（作成カウンター ${counter.toLocaleString("ja-JP")}）`;
        item.addEventListener("click", () => {
          updateArtianTargetSelection(weaponType, Number(artianBaseAttributeSelect.value));
        });
      }
      return item;
    });
}

function renderArtianCounterOverview() {
  artianCounterOverviewGrid.replaceChildren(...createArtianCounterOverviewItems(true));
  saveStateArtianCounterOverviewGrid.replaceChildren(...createArtianCounterOverviewItems(false));
  if (artianSearchOverviewGrid) artianSearchOverviewGrid.replaceChildren(...createArtianCounterOverviewItems(true));
}

function renderArtianBaseState() {
  const counter = currentArtianBaseCounter();
  const key = artianBaseCounterKey();
  artianBaseSeed.textContent = saveState.baseSeed === null
    ? "未特定"
    : saveState.baseSeed.toLocaleString("ja-JP");
  artianBaseCurrentCounter.textContent = counter === null
    ? "未特定"
    : counter.toLocaleString("ja-JP");
  artianBaseCounterInput.value = counter ?? "";
  artianBaseCounterSource.textContent = counter === null
    ? "武器種ごとに設定（レア8）"
    : stateSourceText(artianBaseState.sources[key] ?? "保存値", "武器種ごとに設定（レア8）");
  openArtianFutureFromSearchButton.disabled = counter === null;
  renderArtianCounterOverview();

  if (saveState.baseSeed === null) {
    artianBaseStatus.textContent = "基準seedを先に特定してください";
    artianBaseStatus.className = "status-pill";
  } else if (counter === null) {
    artianBaseStatus.textContent = "作成カウンターを入力または検索してください";
    artianBaseStatus.className = "status-pill";
  } else {
    artianBaseStatus.textContent = `作成カウンター ${counter.toLocaleString("ja-JP")}から予測`;
    artianBaseStatus.className = "status-pill complete";
  }
  // 改良版：全武器種の次の当たり
  renderArtianNextList();
}

function renderArtianWeaponVerification() {
  const weaponType = Number(artianBaseWeaponSelect.value);
  const profile = artianBasePool(weaponType, currentArtianAttributeForce()).name;
  const poolText = {
    element_melee: "属性・状態異常近接は、攻撃・属性・斬れ味・会心から抽選されます。",
    raw_melee: "無属性近接は、攻撃・斬れ味・会心から抽選されます。",
    element_bow: "属性・状態異常弓は、攻撃・属性・会心から抽選されます。",
    raw_bow: "無属性弓は、攻撃・会心から抽選されます。",
    bowgun: "ボウガンは、攻撃・装填数・会心から抽選されます。",
  }[profile];
  const verificationText = ARTIAN_LIVE_VERIFIED_WEAPON_TYPES.has(weaponType)
    ? "この武器種はレア8の実機結果と一致を確認済みです。"
    : "この武器種は実機一致を確認した共通式から予測します。個別の確認は未完了です。";
  const message = `${t(poolText)} ${t(verificationText)}`;
  artianWeaponVerification.textContent = message;
  artianSearchWeaponVerification.textContent = message;
}

function applyArtianBaseCounter() {
  const weaponType=Number(artianBaseWeaponSelect.value);
  return runCounterSetting('通常作成カウンターを入力した値に設定しますか？',model=>{
    if(model.saveState.baseSeed===null)throw new Error('先に基準seedを設定してください。');
    const counter=readStateNumber(artianBaseCounterInput,'通常作成カウンター',1000000);
    if(model.artianBaseState.baseSeed!==model.saveState.baseSeed)model.artianBaseState={baseSeed:model.saveState.baseSeed,counters:{},sources:{}};
    const key=artianBaseCounterKey(weaponType);model.artianBaseState.counters[key]=counter;model.artianBaseState.sources[key]='手入力';
  },{tab:'artian-future',normalType:weaponType});
}

function refreshArtianBasePredictions() {
  hideArtianBaseError();
  const counter = currentArtianBaseCounter();
  if (saveState.baseSeed === null || counter === null) {
    artianBasePredictionRolls = [];
    artianBaseRows.replaceChildren();
    artianBaseTableWrap.hidden = true;
    artianBaseEmpty.hidden = false;
    exportArtianBaseCsvButton.disabled = true;
    renderArtianBaseState();
    return;
  }
  const count = Number(artianBaseCountInput.value);
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000) {
    showArtianBaseError("表示する本数は1〜10,000の整数で入力してください。");
    return;
  }
  try {
    artianBasePredictionRolls = predictArtianBaseRolls(
      saveState.baseSeed,
      Number(artianBaseWeaponSelect.value),
      ARTIAN_R8_ENUM,
      currentArtianAttributeForce(),
      counter,
      count,
    );
    resetTablePage("artianBase");
    renderArtianBaseTable();
    renderArtianBaseState();
  } catch (error) {
    showArtianBaseError(error instanceof Error ? error.message : String(error));
  }
}

function artianBaseBonusName(weaponType, bonusId) {
  if (bonusId === 4) return t("基礎攻撃力強化");
  if (bonusId === 6) return t("属性強化");
  if (bonusId === 7 && BOWGUN_WEAPON_TYPES.has(weaponType)) return t("装填数強化");
  if (bonusId === 7) return t("斬れ味強化");
  if (bonusId === 8) return t("会心率強化");
  return `ID ${bonusId}`;
}

function artianBaseBonusClassName(bonusId) {
  if (bonusId === 4) return "attack";
  if (bonusId === 6) return "element";
  if (bonusId === 8) return "affinity";
  return "sharpness-ammo";
}

// 改良版：希望1〜5のプルダウンの代わりに、武器種ごとに覚える「系統の数」のカード（renderArtianWishCards）
function renderArtianBaseFilters() {
  renderArtianWishCards();
}

// 希望を、通常アーティアのボーナス番号の並び（例：攻撃×4＋属性×1 → [4,4,4,4,6]）にする
function snapshotArtianBaseFilters() {
  const { counts } = artianWishFor(Number(artianBaseWeaponSelect.value));
  return counts.flatMap((count, category) =>
    Array.from({ length: count }, () => ARTIAN_ID_BY_CATEGORY.get(category)));
}

function visibleArtianBaseRolls() {
  const { counts, none } = artianWishFor(Number(artianBaseWeaponSelect.value));
  const allRolls = artianBasePredictionRolls.map((roll, index) => ({ roll, index }));
  if (!artianFilterEnabled.checked || !artianWishIsSet(counts, none)) return allRolls;
  return allRolls.filter(({ roll }) => artianRollMeetsCounts(roll.bonusIds, counts, none));
}

function renderArtianBaseTable() {
  if (artianBasePredictionRolls.length === 0) {
    artianBaseRows.replaceChildren();
    clearTablePager("artianBase");
    artianBaseTableWrap.hidden = true;
    artianBaseEmpty.hidden = false;
    exportArtianBaseCsvButton.disabled = true;
    return;
  }
  const visibleRolls = visibleArtianBaseRolls();
  if (visibleRolls.length === 0) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 8;
    cell.className = "prediction-empty";
    cell.textContent = "指定した復元ボーナス構成は表示範囲内にありません。表示する本数を増やすか条件を変更してください。";
    row.append(cell);
    artianBaseRows.replaceChildren(row);
    clearTablePager("artianBase");
  } else {
    artianBaseRows.replaceChildren(
      ...tablePage(visibleRolls, "artianBase").map(({ roll, index }) => createArtianBaseRow(roll, index)),
    );
  }
  artianBaseTableWrap.hidden = false;
  artianBaseEmpty.hidden = true;
  exportArtianBaseCsvButton.disabled = visibleRolls.length === 0;
}

function createArtianBaseRow(roll, index) {
  const row = document.createElement("tr");
  const offsetCell = document.createElement("th");
  const beforeCounterCell = document.createElement("td");
  offsetCell.scope = "row";
  offsetCell.textContent = `${index + 1}本先`;
  beforeCounterCell.className = "artian-counter-cell";
  beforeCounterCell.textContent = roll.counter.toLocaleString("ja-JP");
  // 手持ち（08）に同じ系統の組み合わせがあれば「所持済み」の印
  const heldText = artianHeldText(artianOwnedMatches(Number(artianBaseWeaponSelect.value), currentArtianAttributeForce() === 0 ? 0 : 1, roll.bonusIds));
  if (heldText) {
    const mark = document.createElement("span");
    mark.className = "artian-held-mark";
    mark.textContent = heldText;
    mark.title = "手持ち武器【通常】に、同じ系統の組み合わせの武器があります";
    offsetCell.append(mark);
  }
  row.append(offsetCell, beforeCounterCell, createArtianSavedStateCell(index + 1));
  // 改良版：基礎攻撃力はいつも、希望に当てはまる枠も、金の縁で強調。希望どおりの行は金色の帯
  const { counts, none } = artianWishFor(Number(artianBaseWeaponSelect.value));
  const hasWish = artianWishIsSet(counts, none);
  if (artianRollMeetsCounts(roll.bonusIds, counts, none)) row.classList.add("prediction-match", "artian-wish-row");
  for (const bonusId of roll.bonusIds) {
    const cell = document.createElement("td");
    const tag = document.createElement("span");
    tag.className = `bonus-tag ${artianBaseBonusClassName(bonusId)}`;
    tag.textContent = artianBaseBonusName(Number(artianBaseWeaponSelect.value), bonusId);
    const category = ARTIAN_CATEGORY_BY_ID.get(bonusId);
    if (counts[category] > 0) {
      // 希望した系統の枠は、希望の数を超えて出ていても全部強調（色で塗りつぶし＋金の縁）
      tag.classList.add("artian-hit", "wish-part");
    } else if (bonusId === 4) {
      tag.classList.add("wish-part");
    } else if (hasWish) {
      tag.classList.add("artian-off");
    }
    cell.append(tag);
    row.append(cell);
  }
  return row;
}

function createArtianSavedStateCell(completedCreations) {
  const cell = document.createElement("td");
  const counter = currentArtianBaseCounter();
  const value = document.createElement("strong");
  const button = document.createElement("button");
  cell.className = "saved-state-cell artian-counter-cell";
  value.textContent = counter === null
    ? "未特定"
    : (counter + completedCreations).toLocaleString("ja-JP");
  button.type = "button";
  button.className = "adopt-position-button";
  button.textContent = "ここを0にする";
  button.addEventListener("click", () => adoptArtianBasePosition(completedCreations));
  cell.append(value, button);
  if (counter !== null) {
    const weaponType = Number(artianBaseWeaponSelect.value);
    const bonusIds = artianBasePredictionRolls[completedCreations - 1]?.bonusIds;
    if (bonusIds) {
      cell.append(createArtianAdoptButton(weaponType, currentArtianAttributeForce() === 0 ? 0 : 1, completedCreations, bonusIds));
    }
  }
  return cell;
}

// 「採用して手持ち武器に登録」：その本数まで作ったことにして（0地点を進める）、できた武器を手持ち武器【通常】に登録する
function createArtianAdoptButton(weaponType, attr, completedCreations, bonusIds) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "keep-transition-button artian-adopt-button";
  button.textContent = "採用して手持ち武器に登録";
  button.title = "押すと、確かめる窓が出ます（押しただけでは何も変わりません）";
  button.addEventListener("click", () => {
    const weapon = { weaponType, attr };
    const tags = document.createElement("div");
    tags.className = "artian-mini-tags";
    for (const bonusId of bonusIds) {
      const tag = document.createElement("span");
      tag.className = `bonus-tag compact ${artianBaseBonusClassName(bonusId)}`;
      tag.textContent = artianBaseBonusName(weaponType, bonusId).replace("強化", "");
      tags.append(tag);
    }
    const badge = document.createElement("span");
    badge.className = "weapon-badge";
    badge.textContent = artianOwnedWeaponText(weapon);
    const held = artianOwnedMatches(weaponType, attr, bonusIds);
    // 属性なしは1択。属性ありは、作るときに決めた属性を選ぶ（この組み合わせをまだ持っていない属性を先頭に）
    const elements = attr === 0
      ? [0]
      : ATTRIBUTES.map(([value]) => value).filter((value) => value !== 0)
        .map((value, order) => ({ value, order, has: held.some((owned) => owned.element === value) }))
        .sort((a, b) => Number(a.has) - Number(b.has) || a.order - b.order)
        .map((entry) => entry.value);
    openAdoptDialog({
      title: `${completedCreations}本先の通常アーティアを手持ち武器に登録`,
      summary: [badge, tags],
      note: `選ぶと最終確認が開きます。反映すると、作成カウンターの0地点を${completedCreations}本先まで進め、この武器を「手持ち武器【通常】」に登録します。${attr === 1 ? "作るときに決めた属性を選んでください。" : ""}`,
      heading: held.length > 0 ? `この系統の組み合わせは、${artianHeldText(held)}。` : "どれで登録しますか？",
      choices: elements.map((element) => {
        const target = { weaponType, attr, element: attr === 1 ? element : null };
        const has = held.some((owned) => owned.element === target.element);
        return {
          tag: "手持ち武器【通常】",
          name: `${artianOwnedWeaponText(target)} として登録する`,
          detail: attr === 1 ? (has ? "この属性では、すでに持っている構成です" : "この属性では未所持の構成です") : undefined,
          onChoose: () => adoptArtianAndRegister(weaponType, attr, target.element, completedCreations, bonusIds),
        };
      }),
    });
  });
  return button;
}

function adoptArtianAndRegister(weaponType, attr, element, completedCreations, bonusIds) {
  const target={weaponType,attributeForce:attr===0?0:element};
  return runCounterChange({kind:'normal',weaponType,steps:completedCreations,title:'この通常アーティアを手持ち武器に登録しますか？',
    summary:operationWeaponPreview({target,bonuses:bonusIds,normal:true}),
    change:model=>{
      if(model.normalOwned.length>=MAX_ARTIAN_OWNED)throw new Error('手持ち武器【通常】が上限です。カウンターも進めていません。整理してから登録してください。');
      validateNormal(weaponType,target.attributeForce,bonusIds);
      model.normalOwned.push({id:createTargetId(),label:'',weaponType,attr,element:attr===0?null:element,ids:[...bonusIds]});
    },success:artianOwnedWeaponText({weaponType,attr,element})+'を手持ち武器【通常】に登録し、この武器種の作成カウンターを更新しました。',confirmLabel:'登録してカウンターを進める'});
}

function adoptArtianBasePosition(completedCreations) {
  const weaponType=Number(artianBaseWeaponSelect.value);
  return runCounterChange({kind:'normal',weaponType,steps:completedCreations,title:'通常作成カウンターを進めますか？',
    success:optionName(WEAPON_TYPES,weaponType)+'の通常作成カウンターを更新しました。手持ち武器は変更していません。'});
}

function snapshotArtianObservationValues() {
  return [...artianObservationRows.querySelectorAll(".artian-observation-row")].map((row) =>
    [...row.querySelectorAll("select")].map((select) =>
      select.value === "" ? null : Number(select.value),
    ),
  );
}

function renderArtianObservationRows(values) {
  const allowed = new Set(artianBasePool(
    Number(artianBaseWeaponSelect.value),
    currentArtianAttributeForce(),
  ).ids);
  const normalized = values.map((roll) => roll?.map((bonusId) =>
    allowed.has(bonusId) ? bonusId : null,
  ));
  artianObservationRows.replaceChildren(...normalized.map((roll) => createArtianObservationRow(roll)));
  renumberArtianObservationRows();
}

function createArtianObservationRow(values = null) {
  const row = document.createElement("div");
  row.className = "observation-row artian-observation-row";
  const rollNumber = document.createElement("span");
  rollNumber.className = "roll-number";
  row.append(rollNumber);
  for (let slotIndex = 0; slotIndex < 5; slotIndex += 1) {
    const label = document.createElement("label");
    const accessibleLabel = document.createElement("span");
    const select = document.createElement("select");
    accessibleLabel.className = "sr-only slot-label";
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "選択してください";
    placeholder.disabled = true;
    placeholder.selected = values?.[slotIndex] === null || values?.[slotIndex] === undefined;
    select.append(placeholder);
    const allowedIds = new Set(artianBasePool(
      Number(artianBaseWeaponSelect.value),
      currentArtianAttributeForce(),
    ).ids);
    for (const [bonusId] of ARTIAN_BASE_BONUSES.filter(([bonusId]) => allowedIds.has(bonusId))) {
      const option = document.createElement("option");
      option.value = String(bonusId);
      option.textContent = artianBaseBonusName(Number(artianBaseWeaponSelect.value), bonusId);
      option.selected = values?.[slotIndex] === bonusId;
      select.append(option);
    }
    label.append(accessibleLabel, select);
    row.append(label);
  }
  // 改良版：プルダウンの代わりにカードで入力する（プルダウンは隠して値の入れ物として残す）
  row.classList.add("card-input");
  const selects = [...row.querySelectorAll("select")];
  const weaponType = Number(artianBaseWeaponSelect.value);
  const allowedIds = new Set(artianBasePool(weaponType, currentArtianAttributeForce()).ids);
  const picker = createBonusCardPicker({
    weaponType,
    options: ARTIAN_BASE_BONUSES
      .filter(([bonusId]) => allowedIds.has(bonusId))
      .map(([bonusId]) => [bonusId, artianBaseBonusName(weaponType, bonusId)]),
    values: selects.map((select) => select.value === "" ? null : Number(select.value)),
    clearText: "この1本をクリア",
    classOf: artianBaseBonusClassName,
    nameOf: (bonusId) => artianBaseBonusName(weaponType, bonusId),
    isEx: () => false,
    onChange: (index, bonusId) => {
      selects[index].value = bonusId === null ? "" : String(bonusId);
      selects[index].dispatchEvent(new Event("change", { bubbles: true }));
    },
  });
  row.append(picker.element);
  return row;
}

function renumberArtianObservationRows() {
  const rows = [...artianObservationRows.querySelectorAll(".artian-observation-row")];
  rows.forEach((row, rollIndex) => {
    row.querySelector(".roll-number").textContent = `${rollIndex + 1}本目に作った武器`;
    row.querySelectorAll(".slot-label").forEach((label, slotIndex) => {
      label.textContent = `${slotIndex + 1}枠目`;
      label.parentElement.querySelector("select").setAttribute(
        "aria-label",
        t(`作成${rollIndex + 1}の${slotIndex + 1}枠目`),
      );
    });
  });
  removeArtianObservationButton.disabled = rows.length <= 1;
}

function readArtianObservations() {
  const observations = snapshotArtianObservationValues();
  const profile = artianBasePool(
    Number(artianBaseWeaponSelect.value),
    currentArtianAttributeForce(),
  );
  const allowedIds = new Set(profile.ids);
  if (observations.length === 0) throw new Error("作成結果を1回以上入力してください。");
  for (const [rollIndex, roll] of observations.entries()) {
    for (const [slotIndex, bonusId] of roll.entries()) {
      if (bonusId === null) {
        throw new Error(`作成${rollIndex + 1}の${slotIndex + 1}枠目を選択してください。`);
      }
    }
    const counts = new Map();
    for (const bonusId of roll) {
      if (!allowedIds.has(bonusId)) {
        throw new Error("選択した武器種・属性では出ない強化が含まれています。入力内容を確認してください。");
      }
      counts.set(bonusId, (counts.get(bonusId) ?? 0) + 1);
    }
    if ([...counts].some(([bonusId, count]) => count > profile.caps.get(bonusId))) {
      throw new Error("入力した5枠はゲーム内の上限を超えています。入力内容を確認してください。");
    }
  }
  return observations;
}

async function searchArtianBaseCounter() {
  hideArtianSearchError();
  clearArtianCounterSearchFeedback();
  if (saveState.baseSeed === null) {
    showArtianSearchError("基準seedを先に特定するか、上部の現在のセーブ状態から手入力してください。");
    return;
  }
  const start = Number(artianCounterStartInput.value);
  const end = Number(artianCounterEndInput.value);
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) ||
      start < 0 || end < start || end > 1_000_000) {
    showArtianSearchError("カウンター候補は0〜1,000,000の範囲で、開始を終了以下にしてください。");
    return;
  }
  let observations;
  try {
    observations = readArtianObservations();
  } catch (error) {
    showArtianSearchError(error instanceof Error ? error.message : String(error));
    return;
  }
  findArtianCounterButton.disabled = true;
  artianSearchMessage.textContent = `作成カウンター${start.toLocaleString("ja-JP")}〜${end.toLocaleString("ja-JP")}を検索中…`;
  await new Promise((resolve) => requestAnimationFrame(resolve));
  try {
    const matches = findArtianCreateCounters(
      saveState.baseSeed,
      Number(artianBaseWeaponSelect.value),
      ARTIAN_R8_ENUM,
      currentArtianAttributeForce(),
      start,
      end,
      observations,
    );
    renderArtianCounterCandidates(matches);
    artianSearchMessage.textContent = matches.length === 0
      ? "候補を特定できませんでした。入力内容と探索範囲を確認してください。"
      : matches.length >= 100
        ? "候補が100件以上あります。作成結果を追加して絞り込んでください。"
        : `${matches.length.toLocaleString("ja-JP")}件の候補が見つかりました。使用するカウンターを選んでください。`;
  } catch (error) {
    showArtianSearchError(error instanceof Error ? error.message : String(error));
  } finally {
    findArtianCounterButton.disabled = false;
  }
}

function renderArtianCounterCandidates(matches) {
  artianCounterCandidates.replaceChildren(...matches.map((counter) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `カウンター ${counter.toLocaleString("ja-JP")}を使用`;
    button.addEventListener("click", () => {
      syncArtianBaseSeed();
      const key = artianBaseCounterKey();
      artianBaseState.counters[key] = counter;
      artianBaseState.sources[key] = "検索結果";
      persistAppState();
      renderArtianBaseState();
      artianSearchMessage.textContent = `作成カウンター${counter.toLocaleString("ja-JP")}を現在位置に設定しました。`;
      const weaponName = optionName(WEAPON_TYPES, Number(artianBaseWeaponSelect.value));
      showSavedCounters([
        `${weaponName}の作成カウンター ${counter.toLocaleString("ja-JP")} を保存しました。`,
      ]);
      refreshArtianBasePredictions();
    });
    return button;
  }));
}

function clearArtianCounterSearchFeedback() {
  hideArtianSearchError();
  artianSearchMessage.textContent = "";
  artianCounterCandidates.replaceChildren();
}

function exportArtianBasePredictionsCsv() {
  const counter = currentArtianBaseCounter();
  const visibleRolls = visibleArtianBaseRolls();
  if (saveState.baseSeed === null || counter === null || visibleRolls.length === 0) return;
  const weaponType = Number(artianBaseWeaponSelect.value);
  const attributeForce = currentArtianAttributeForce();
  const headers = [
    t("何本先"),
    t("作成前カウンター"),
    t("保存後の作成カウンター"),
    ...Array.from({ length: 5 }, (_, index) => t(`${index + 1}枠目`)),
  ];
  const rows = visibleRolls.map(({ roll, index }) => [
    index + 1,
    roll.counter,
    roll.counter + 1,
    ...roll.bonusIds.map((bonusId) => artianBaseBonusName(weaponType, bonusId)),
  ]);
  downloadCsv(
    `artian-base-future-seed-${saveState.baseSeed}-weapon-${weaponType}-attribute-${attributeForce}-counter-${counter}.csv`,
    headers,
    rows,
  );
}

function showArtianBaseError(message) {
  artianBaseError.textContent = message;
  artianBaseError.hidden = false;
}

function hideArtianBaseError() {
  artianBaseError.textContent = "";
  artianBaseError.hidden = true;
}

function showArtianSearchError(message) {
  artianSearchError.textContent = message;
  artianSearchError.hidden = false;
}

function hideArtianSearchError() {
  artianSearchError.textContent = "";
  artianSearchError.hidden = true;
}

// ===== 改良版：通常アーティア（06・07）の使い勝手 =====


// 起動時に一度だけ：06の武器一覧・全部クリア・元に戻す、07の「1本作った」と「全武器種の次の当たり」
function setupArtianEnhancements() {
  // 06：観測した通常アーティア武器の上に、特定済み・未特定の武器一覧
  const searchTarget = document.querySelector("#artian-search-target-title")?.closest("section");
  if (searchTarget) {
    const box = document.createElement("section");
    box.className = "artian-weapon-picker";
    const title = document.createElement("h3");
    title.textContent = "武器種ごとの作成カウンター（押すとその武器種を選びます）";
    const note = document.createElement("p");
    note.textContent = "明るい武器種は特定済み（数字が今のカウンター）、灰色は未特定です。";
    artianSearchOverviewGrid = document.createElement("div");
    artianSearchOverviewGrid.className = "artian-counter-overview-grid artian-clickable-grid";
    box.append(title, note, artianSearchOverviewGrid);
    searchTarget.before(box);
  }
  // 07の一覧も押せるので、その案内を添える
  const overviewHeading = document.querySelector(".artian-counter-overview-heading small");
  if (overviewHeading) overviewHeading.textContent = "属性・無属性で共通（レア8）。押すとその武器種を選びます";

  // 06：全部クリアのボタンと、空にしたあとの「元に戻す」
  const controls = removeArtianObservationButton?.parentElement;
  if (controls) {
    const clearAll = document.createElement("button");
    clearAll.type = "button";
    clearAll.className = "text-button";
    clearAll.textContent = "入力した結果をすべてクリア";
    clearAll.addEventListener("click", () => clearArtianObservations(""));
    controls.append(clearAll);
    const undo = document.createElement("p");
    undo.className = "artian-undo";
    undo.hidden = true;
    controls.after(undo);
  }
  // 「このカウンターで未来予測へ」を押したら、次の武器種のために入力を空にする
  openArtianFutureFromSearchButton?.addEventListener("click", () => {
    clearArtianObservations("未来予測へ進んだので、");
  });

  // 07：「1本作った」ボタン（その武器種のカウンターを1つ進める）
  const applyButton = applyArtianBaseCounterButton;
  if (applyButton) {
    const made = document.createElement("button");
    made.type = "button";
    made.className = "secondary small-button";
    made.id = "artian-made-one";
    made.textContent = "1本作った（カウンターを1つ進める）";
    made.title = "ゲームでこの武器種の通常アーティアを1本作ったら押します";
    made.addEventListener("click", () => {
      if (currentArtianBaseCounter() === null) {
        showArtianBaseError("先にこの武器種の作成カウンターを入力するか、03で特定してください。");
        return;
      }
      adoptArtianBasePosition(1);
    });
    applyButton.after(made);
  }

  // 07：希望の説明を、カード式（武器種ごとに覚える）に合わせて書き直す
  const wishDescription = document.querySelector(".artian-result-filter .prediction-filter-heading p");
  if (wishDescription) {
    wishDescription.textContent = "欲しい系統の数を、−／＋で決めます（順不同）。武器種ごとに覚えるので、武器種を切り替えるとその武器種の希望が出ます。まだ決めていない武器種は、07の「狙いの希望」が最初に入ります。基礎攻撃力と、希望に当てはまる枠は金の縁で強調します。";
  }

  // 07：全武器種の次の当たり
  const results = document.querySelector(".artian-results");
  if (results) {
    artianNextList = document.createElement("section");
    artianNextList.className = "artian-next-list";
    results.before(artianNextList);
  }
}

// 06の入力を空にする（元に戻せる）。reason は「武器種を変えたので、」など
function clearArtianObservations(reason) {
  const current = snapshotArtianObservationValues();
  if (current.every((roll) => roll.every((value) => value === null))) return;
  // 元に戻すときは、入力していたときの武器種・属性の有無にも戻す
  artianObservationUndo = {
    values: current,
    weaponType: Number(artianBaseWeaponSelect.value),
    attributeForce: Number(artianBaseAttributeSelect.value),
  };
  renderArtianObservationRows(Array.from({ length: 3 }, () => null));
  clearArtianCounterSearchFeedback();
  const notice = document.querySelector(".artian-undo");
  if (!notice) return;
  const text = document.createElement("span");
  text.textContent = `${reason}入力した作成結果を空にしました。`;
  const undoButton = document.createElement("button");
  undoButton.type = "button";
  undoButton.className = "secondary small-button";
  undoButton.textContent = "元に戻す";
  undoButton.addEventListener("click", () => {
    const saved = artianObservationUndo;
    artianObservationUndo = null;
    notice.hidden = true;
    if (!saved) return;
    // 武器種を先に戻してから（同じ武器種なので入力は消えない）、入力を戻す
    artianBaseWeaponSelect.value = String(saved.weaponType);
    updateArtianTargetSelection(saved.weaponType, saved.attributeForce);
    renderArtianObservationRows(saved.values);
  });
  notice.replaceChildren(text, undoButton);
  notice.hidden = false;
}

// 07の希望（武器種ごと）。まだ決めていない武器種は、07の「狙いの希望」を最初の値にする
function artianWishFor(weaponType) {
  const saved = artianWishes[weaponType];
  if (saved && Array.isArray(saved.counts)) {
    const none = [0, 1, 2, 3].map((category) => Array.isArray(saved.none) && saved.none[category] === true);
    return {
      counts: [0, 1, 2, 3].map((category) =>
        none[category] ? 0 : Math.max(0, Math.min(5, Math.trunc(Number(saved.counts[category]) || 0)))),
      none,
      attr: saved.attr === 0 ? 0 : 1,
    };
  }
  return {
    counts: wishCategoryCounts(weaponType).counts,
    none: [false, false, false, false],
    attr: BOWGUN_WEAPON_TYPES.has(weaponType) ? 0 : 1,
  };
}

// 希望が1つでも決まっているか（系統の数、または「不要」）
function artianWishIsSet(counts, none) {
  return counts.some((count) => count > 0) || (none || []).some(Boolean);
}

// 04の狙いの希望を、系統の数だけにしたもの。EX・III以上の指定があれば needsTier=true（通常アーティアでは出ない）
function wishCategoryCounts(weaponType) {
  const wish = bonusWishFor(weaponType);
  if (wish.mode !== "slots") return { counts: [...wish.counts], needsTier: false };
  const counts = [0, 0, 0, 0];
  let needsTier = false;
  for (const slot of activeWishSlots(wish)) {
    if (slot.c >= 0) counts[slot.c] += 1;
    if (slot.lv > 0) needsTier = true;
  }
  return { counts, needsTier };
}

function persistArtianWishes() {
  try {
    localStorage.setItem(ARTIAN_WISHES_KEY, JSON.stringify(artianWishes));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

function artianCategoryName(weaponType, category) {
  if (category === 0) return "攻撃";
  if (category === 1) return "会心";
  if (category === 2) return "属性";
  return BOWGUN_WEAPON_TYPES.has(weaponType) ? "装填" : "斬れ味";
}

function artianWishText(weaponType, counts, none = []) {
  const parts = [0, 2, 3, 1]
    .filter((category) => counts[category] > 0)
    .map((category) => `${artianCategoryName(weaponType, category)}×${counts[category]}`);
  const excluded = [0, 2, 3, 1]
    .filter((category) => none[category])
    .map((category) => `${artianCategoryName(weaponType, category)}なし`);
  const all = [...parts.length > 0 ? [parts.join("＋")] : [], ...excluded];
  return all.length > 0 ? all.join("・") : "指定なし";
}

// 結果の5枠が希望の系統の数を満たすか（順不同）。「不要」にした系統が1つでもあれば外れ
function artianRollMeetsCounts(bonusIds, counts, none = []) {
  if (!artianWishIsSet(counts, none)) return false;
  const have = [0, 0, 0, 0];
  for (const bonusId of bonusIds) {
    const category = ARTIAN_CATEGORY_BY_ID.get(bonusId);
    if (category !== undefined) have[category] += 1;
  }
  if (none.some((excluded, category) => excluded && have[category] > 0)) return false;
  return counts.every((need, category) => have[category] >= need);
}

// 07の「希望する復元ボーナス」をカードで（系統ごとに −／＋ で数を決める）
function renderArtianWishCards() {
  const weaponType = Number(artianBaseWeaponSelect.value);
  const pool = artianBasePool(weaponType, currentArtianAttributeForce());
  const wish = artianWishFor(weaponType);
  const total = wish.counts.reduce((sum, count) => sum + count, 0);
  const save = (counts, none = wish.none) => {
    artianWishes[weaponType] = { counts, none, attr: currentArtianAttributeForce() === 0 ? 0 : 1 };
    persistArtianWishes();
    renderArtianWishCards();
    resetTablePage("artianBase");
    renderArtianBaseTable();
    renderArtianNextList();
  };
  const cards = pool.ids.map((bonusId) => {
    const category = ARTIAN_CATEGORY_BY_ID.get(bonusId);
    const cap = pool.caps.get(bonusId) ?? 5;
    const card = document.createElement("div");
    const excluded = wish.none[category];
    card.className = `artian-wish-card ${artianBaseBonusClassName(bonusId)}${wish.counts[category] > 0 ? " active" : ""}${excluded ? " excluded" : ""}`;
    const name = document.createElement("strong");
    name.textContent = artianCategoryName(weaponType, category);
    const minus = document.createElement("button");
    const plus = document.createElement("button");
    const value = document.createElement("span");
    minus.type = "button";
    plus.type = "button";
    minus.textContent = "−";
    plus.textContent = "＋";
    minus.setAttribute("aria-label", `${name.textContent}を1つ減らす`);
    plus.setAttribute("aria-label", `${name.textContent}を1つ増やす`);
    value.className = "artian-wish-count";
    value.textContent = excluded ? "不要" : wish.counts[category] > 0 ? `×${wish.counts[category]}` : "—";
    minus.disabled = wish.counts[category] === 0;
    plus.disabled = excluded || wish.counts[category] >= cap || total >= 5;
    minus.addEventListener("click", () => {
      const counts = [...wish.counts];
      counts[category] -= 1;
      save(counts);
    });
    plus.addEventListener("click", () => {
      const counts = [...wish.counts];
      counts[category] += 1;
      save(counts);
    });
    const stepper = document.createElement("div");
    stepper.className = "artian-wish-stepper";
    stepper.append(minus, value, plus);
    const capNote = document.createElement("small");
    capNote.textContent = `最大${cap}枠`;
    const noneButton = document.createElement("button");
    noneButton.type = "button";
    noneButton.className = "artian-wish-none";
    noneButton.setAttribute("aria-pressed", excluded ? "true" : "false");
    noneButton.textContent = excluded ? "不要を解除" : `${name.textContent}は不要`;
    noneButton.addEventListener("click", () => {
      const none = [...wish.none];
      none[category] = !none[category];
      const counts = [...wish.counts];
      if (none[category]) counts[category] = 0;
      save(counts, none);
    });
    card.append(name, stepper, noneButton, capNote);
    return card;
  });
  const footer = document.createElement("div");
  footer.className = "artian-wish-footer";
  const summary = document.createElement("span");
  summary.textContent = `希望：${artianWishText(weaponType, wish.counts, wish.none)}（合計 ${total} / 5枠）`;
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "text-button";
  clear.textContent = "この武器種の希望をクリア";
  clear.addEventListener("click", () => save([0, 0, 0, 0], [false, false, false, false]));
  footer.append(summary, clear);
  artianFilterGrid.classList.add("artian-wish-grid");
  artianFilterGrid.replaceChildren(...cards, footer);
}

// 07：カウンターと希望が分かっている武器種について、次の当たりを近い順に並べる
function renderArtianNextList() {
  if (!artianNextList) return;
  const count = Math.max(1, Math.min(10_000, Math.trunc(Number(artianBaseCountInput.value)) || 100));
  const heading = document.createElement("div");
  heading.className = "section-heading compact-heading";
  heading.innerHTML = '<div><p class="step">NEXT HITS</p><h3>全武器種の次の当たり</h3></div>';
  const note = document.createElement("p");
  note.className = "prediction-intro";
  note.textContent = `作成カウンターが分かっていて、希望を決めた武器種について、${count.toLocaleString("ja-JP")}本先までの中で一番近い当たりを並べます。武器種を押すと、その武器種の予測を開きます。`;
  if (saveState.baseSeed === null) {
    artianNextList.replaceChildren(heading, note);
    return;
  }
  const rows = [];
  const noCounter = [];
  const noWish = [];
  for (const [weaponType, weaponName] of WEAPON_TYPES) {
    const counter = artianBaseCounterForWeapon(weaponType);
    const wish = artianWishFor(weaponType);
    if (counter === null) { noCounter.push(weaponName); continue; }
    if (!artianWishIsSet(wish.counts, wish.none)) { noWish.push(weaponName); continue; }
    const attr = BOWGUN_WEAPON_TYPES.has(weaponType) ? 0 : wish.attr;
    const rolls = predictArtianBaseRolls(saveState.baseSeed, weaponType, ARTIAN_R8_ENUM, attr, counter, count);
    const index = rolls.findIndex((roll) => artianRollMeetsCounts(roll.bonusIds, wish.counts, wish.none));
    rows.push({ weaponType, weaponName, attr, wish, index, roll: rolls[index] });
  }
  rows.sort((a, b) => (a.index < 0 ? Infinity : a.index) - (b.index < 0 ? Infinity : b.index));
  const table = document.createElement("table");
  table.className = "next-match-table artian-next-table";
  table.innerHTML = "<thead><tr><th>あと何本</th><th>武器種</th><th>属性</th><th>希望</th><th>結果（5枠）</th><th></th></tr></thead>";
  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    if (row.index < 0) tr.classList.add("none");
    const cells = [
      row.index < 0
        ? "—"
        : `あと${row.index + 1}本${(() => {
          const held = artianHeldText(artianOwnedMatches(row.weaponType, row.attr, row.roll.bonusIds));
          return held ? `（${held}）` : "";
        })()}`,
      row.weaponName,
      row.attr === 0 ? "無属性" : "属性あり",
      artianWishText(row.weaponType, row.wish.counts, row.wish.none),
    ].map((text, i) => {
      const td = document.createElement("td");
      td.className = ["next-when", "next-weapon", "", "next-wish"][i];
      td.textContent = text;
      return td;
    });
    const result = document.createElement("td");
    if (row.index < 0) {
      result.textContent = `${count.toLocaleString("ja-JP")}本以内になし（表示する本数を増やしてください）`;
    } else {
      const tags = document.createElement("div");
      tags.className = "artian-mini-tags";
      for (const bonusId of row.roll.bonusIds) {
        const tag = document.createElement("span");
        tag.className = `bonus-tag compact ${artianBaseBonusClassName(bonusId)}`;
        tag.textContent = artianBaseBonusName(row.weaponType, bonusId).replace("強化", "");
        tags.append(tag);
      }
      result.append(tags);
    }
    const open = document.createElement("td");
    const openButton = document.createElement("button");
    openButton.type = "button";
    openButton.className = "secondary small-button";
    openButton.textContent = "この武器種を開く";
    openButton.addEventListener("click", () => updateArtianTargetSelection(row.weaponType, row.attr));
    open.append(openButton);
    if (row.index >= 0) {
      const adopt = createArtianAdoptButton(row.weaponType, row.attr, row.index + 1, row.roll.bonusIds);
      adopt.classList.add("artian-next-adopt");
      open.append(adopt);
    }
    tr.append(...cells, result, open);
    body.append(tr);
  }
  table.append(body);
  const children = [heading, note];
  if (rows.length > 0) {
    const wrap = document.createElement("div");
    wrap.className = "artian-next-wrap";
    wrap.append(table);
    children.push(wrap);
  } else {
    const empty = document.createElement("p");
    empty.className = "empty-result";
    empty.textContent = "まだ表示できる武器種がありません。03で作成カウンターを特定し、下の「希望する復元ボーナス」を決めると、ここに並びます。";
    children.push(empty);
  }
  const rest = document.createElement("p");
  rest.className = "artian-next-rest";
  rest.textContent = [
    noCounter.length > 0 ? `カウンター未特定：${noCounter.join("・")}` : "",
    noWish.length > 0 ? `希望未設定：${noWish.join("・")}` : "",
  ].filter(Boolean).join("　／　");
  if (rest.textContent) children.push(rest);
  artianNextList.replaceChildren(...children);
}

// 04の「次の一致」用：その狙いの武器種を通常アーティアで作るなら、あと何本か
function artianRouteText(target, count) {
  if (target.kind === "owned") return "—";
  const { counts, needsTier } = wishCategoryCounts(target.weaponType);
  if (needsTier) return "EX・III指定があるので対象外";
  if (counts.every((value) => value === 0)) return "—";
  if (saveState.baseSeed === null) return "—";
  const counter = artianBaseCounterForWeapon(target.weaponType);
  if (counter === null) return "カウンター未特定（03で特定）";
  const attr = BOWGUN_WEAPON_TYPES.has(target.weaponType) || target.attributeForce === 0 ? 0 : 1;
  const rolls = predictArtianBaseRolls(saveState.baseSeed, target.weaponType, ARTIAN_R8_ENUM, attr, counter, count);
  const index = rolls.findIndex((roll) => artianRollMeetsCounts(roll.bonusIds, counts));
  if (index < 0) return `${count.toLocaleString("ja-JP")}本以内になし`;
  const held = artianHeldText(artianOwnedMatches(target.weaponType, attr, rolls[index].bonusIds));
  return `あと${index + 1}本${held ? `（${held}）` : ""}`;
}

// ===== 09 手持ち武器【通常アーティア】 =====
function loadArtianOwned() {
  try {
    const saved = JSON.parse(localStorage.getItem(ARTIAN_OWNED_KEY) ?? "[]");
    if (!Array.isArray(saved)) return [];
    return saved
      .filter((weapon) =>
        Number.isSafeInteger(weapon?.weaponType) && weapon.weaponType >= 0 && weapon.weaponType <= 13
        && Array.isArray(weapon.ids) && weapon.ids.length === 5
        && weapon.ids.every((bonusId) => ARTIAN_CATEGORY_BY_ID.has(bonusId)))
      .slice(0, MAX_ARTIAN_OWNED)
      .map((weapon) => ({
        id: typeof weapon.id === "string" && weapon.id ? weapon.id : createTargetId(),
        label: typeof weapon.label === "string" ? weapon.label.slice(0, 24) : "",
        weaponType: weapon.weaponType,
        attr: BOWGUN_WEAPON_TYPES.has(weapon.weaponType) || weapon.attr === 0 ? 0 : 1,
        // 属性の種類（ATTRIBUTES の番号）。無属性・以前の登録（種類未設定）は null
        element: !BOWGUN_WEAPON_TYPES.has(weapon.weaponType) && weapon.attr !== 0
          && ATTRIBUTES.some(([value]) => value !== 0 && value === weapon.element) ? weapon.element : null,
        ids: [...weapon.ids],
      }));
  } catch {
    return [];
  }
}

function persistArtianOwned() {
  try {
    localStorage.setItem(ARTIAN_OWNED_KEY, JSON.stringify(artianOwned));
  } catch {
    // The app remains usable when storage is unavailable.
  }
}

// 5枠の並びは問わず、系統の組み合わせが同じか（通常アーティアは巨戟化しても系統が引き継がれる）
function artianOwnedSignature(ids) {
  return [...ids].sort((a, b) => a - b).join(",");
}

function artianOwnedMatches(weaponType, attr, bonusIds) {
  const signature = artianOwnedSignature(bonusIds);
  return artianOwned.filter((weapon) =>
    weapon.weaponType === weaponType && weapon.attr === attr && artianOwnedSignature(weapon.ids) === signature);
}

function artianElementName(element) {
  return optionName(ATTRIBUTES, element).replace("属性", "");
}

// 例：「弓・火」「ランス・無属性」「弓・属性あり（種類未設定）」
function artianOwnedWeaponText(weapon) {
  const base = optionName(WEAPON_TYPES, weapon.weaponType);
  if (weapon.attr === 0) return `${base}・無属性`;
  return weapon.element ? `${base}・${artianElementName(weapon.element)}` : `${base}・属性あり（種類未設定）`;
}

// 「所持済み：火・水」（その武器種・系統の組み合わせを、どの属性で持っているか）
function artianHeldText(matches) {
  if (matches.length === 0) return "";
  if (matches[0].attr === 0) return matches.length > 1 ? `所持済み×${matches.length}` : "所持済み";
  const counts = new Map();
  for (const weapon of matches) {
    const name = weapon.element ? artianElementName(weapon.element) : "種類未設定";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return `所持済み：${[...counts].map(([name, count]) => (count > 1 ? `${name}×${count}` : name)).join("・")}`;
}

function createArtianOwnedTab() {
  const nav = document.querySelector(".app-tabs");
  const lastView = [...document.querySelectorAll("[data-tab-view]")].pop();
  if (!nav || !lastView) return null;
  const button = document.createElement("button");
  const number = document.createElement("span");
  button.type = "button";
  button.className = "tab-button";
  button.dataset.tab = "artian-owned";
  button.setAttribute("aria-selected", "false");
  number.textContent = String(nav.querySelectorAll("[data-tab]").length + 1).padStart(2, "0");
  button.append(number, "手持ち武器【通常】");
  nav.append(button);
  nav.style.setProperty("--tab-count", String(nav.children.length));

  const view = document.createElement("div");
  view.className = "tab-view";
  view.dataset.tabView = "artian-owned";
  const panel = document.createElement("section");
  panel.className = "panel owned-tab-panel artian-owned-panel";
  panel.innerHTML = `
    <div class="section-heading"><div><p class="step">MY NORMAL ARTIAN</p><h2>手持ち武器【通常アーティア】</h2></div></div>
    <p class="prediction-intro">通常アーティアのままの武器を登録します。05で作成を記録すると自動でここに入り、05で巨戟化を記録すると手持ち武器【巨戟】へ移ります。
    ① 04の表に、同じ系統の組み合わせが出たら「所持済み」の印を出します（作るのをやめる必要はありません。もう1本ほしければ作れます）。
    ② 07で決めた狙いに合うかを判定します（巨戟化の候補）。③ 「05で巨戟化・復元へ」から予測を確認して記録すると、スキルカウンターと手持ち武器を一緒に更新できます。</p>
    <div class="artian-owned-body"></div>`;
  view.append(panel);
  lastView.after(view);
  return panel.querySelector(".artian-owned-body");
}

function onArtianOwnedChanged() {
  persistArtianOwned();
  renderArtianOwnedTab();
  if (!artianBaseTableWrap.hidden) renderArtianBaseTable();
  renderArtianNextList();
  void refreshComparisonPredictions();
}

function renderArtianOwnedTab() {
  const root = artianOwnedTabContainer;
  if (!root) return;
  const form = artianOwnedForm;
  if (BOWGUN_WEAPON_TYPES.has(form.weaponType)) form.attr = 0;
  const pool = artianBasePool(form.weaponType, form.attr);

  const field = (labelText, control) => {
    const label = document.createElement("label");
    const text = document.createElement("span");
    label.className = "artian-owned-field";
    text.textContent = labelText;
    label.append(text, control);
    return label;
  };
  const makeSelect = (options, value, onChange, disabled = false) => {
    const select = document.createElement("select");
    for (const [optionValue, name] of options) {
      const option = document.createElement("option");
      option.value = String(optionValue);
      option.textContent = name;
      option.selected = optionValue === value;
      select.append(option);
    }
    select.disabled = disabled;
    select.addEventListener("change", () => onChange(Number(select.value)));
    return select;
  };
  const resetIds = () => { form.ids = [null, null, null, null, null]; };
  const weaponSelect = makeSelect(WEAPON_TYPES, form.weaponType, (value) => {
    form.weaponType = value;
    resetIds();
    renderArtianOwnedTab();
  });
  const attrSelect = makeSelect([[0, "無属性"], [1, "属性あり"]], form.attr, (value) => {
    form.attr = value;
    resetIds();
    renderArtianOwnedTab();
  }, BOWGUN_WEAPON_TYPES.has(form.weaponType));
  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.maxLength = 24;
  nameInput.placeholder = "名前（なくてもOK）";
  nameInput.value = form.label;
  nameInput.addEventListener("input", () => { form.label = nameInput.value; });

  const formBox = document.createElement("section");
  formBox.className = "artian-owned-form";
  const formTitle = document.createElement("h3");
  formTitle.textContent = "新しく登録";
  const formRow = document.createElement("div");
  formRow.className = "artian-owned-form-row";
  formRow.append(field("武器種", weaponSelect), field("属性", attrSelect));
  // 属性ありの武器は、作るときに決めた属性の種類も選ぶ（属性ごとに別の武器になる）
  if (form.attr === 1) {
    formRow.append(field("属性の種類", makeSelect(
      ATTRIBUTES.filter(([value]) => value !== 0).map(([value, name]) => [value, name]),
      form.element,
      (value) => { form.element = value; },
    )));
  }
  formRow.append(field("名前", nameInput));

  const registerButton = document.createElement("button");
  const formMessage = document.createElement("p");
  formMessage.className = "artian-owned-message";
  formMessage.textContent = artianOwnedUi.message ?? "";
  const picker = createBonusCardPicker({
    weaponType: form.weaponType,
    options: ARTIAN_BASE_BONUSES
      .filter(([bonusId]) => pool.ids.includes(bonusId))
      .map(([bonusId]) => [bonusId, artianBaseBonusName(form.weaponType, bonusId)]),
    values: form.ids,
    clearText: "5枠をクリア",
    classOf: artianBaseBonusClassName,
    nameOf: (bonusId) => artianBaseBonusName(form.weaponType, bonusId),
    isEx: () => false,
    onChange: (_index, _bonusId, all) => {
      form.ids = all;
      registerButton.disabled = all.some((value) => value === null);
    },
  });
  registerButton.type = "button";
  registerButton.className = "primary-button artian-owned-register";
  registerButton.textContent = "この武器を登録する";
  registerButton.disabled = form.ids.some((value) => value === null);
  registerButton.addEventListener("click", () => {
    if (form.ids.some((value) => value === null)) return;
    if (artianOwned.length >= MAX_ARTIAN_OWNED) {
      artianOwnedUi.message = `手持ち武器【通常】は最大${MAX_ARTIAN_OWNED}本です。不要な武器を削除してください。`;
      renderArtianOwnedTab();
      return;
    }
    for (const bonusId of pool.ids) {
      const used = form.ids.filter((value) => value === bonusId).length;
      const cap = pool.caps.get(bonusId) ?? 5;
      if (used > cap) {
        artianOwnedUi.message = `この武器種では「${artianBaseBonusName(form.weaponType, bonusId)}」は最大${cap}枠までです（入力を確かめてください）。`;
        renderArtianOwnedTab();
        return;
      }
    }
    const weapon = {
      id: createTargetId(),
      label: form.label.trim().slice(0, 24),
      weaponType: form.weaponType,
      attr: form.attr,
      element: form.attr === 1 ? form.element : null,
      ids: [...form.ids],
    };
    artianOwned.push(weapon);
    artianOwnedUi.message = `${artianOwnedWeaponText(weapon)}を登録しました。`;
    resetIds();
    form.label = "";
    onArtianOwnedChanged();
  });
  formBox.append(formTitle, formRow, picker.element, registerButton, formMessage);

  const listBox = document.createElement("section");
  listBox.className = "artian-owned-list";
  const listTitle = document.createElement("h3");
  listTitle.textContent = `登録済み（${artianOwned.length}/${MAX_ARTIAN_OWNED}本）`;
  listBox.append(listTitle);
  if (artianOwned.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-result";
    empty.textContent = "まだ登録がありません。上で武器種・属性・5枠の系統を入れて登録してください。";
    listBox.append(empty);
  }
  const sorted = [...artianOwned].sort((a, b) =>
    a.weaponType - b.weaponType || a.attr - b.attr || (a.element ?? 99) - (b.element ?? 99));
  for (const weapon of sorted) listBox.append(createArtianOwnedItem(weapon));
  root.replaceChildren(formBox, listBox);
}

function createArtianOwnedItem(weapon) {
  const item = document.createElement("div");
  item.className = "artian-owned-item";
  const head = document.createElement("div");
  head.className = "artian-owned-item-head";
  const badge = document.createElement("span");
  badge.className = "weapon-badge";
  badge.textContent = artianOwnedWeaponText(weapon);
  head.append(badge);
  if (weapon.label) {
    const label = document.createElement("span");
    label.className = "target-label-text";
    label.textContent = weapon.label;
    head.append(label);
  }
  const tags = document.createElement("div");
  tags.className = "artian-mini-tags";
  for (const bonusId of weapon.ids) {
    const tag = document.createElement("span");
    tag.className = `bonus-tag compact ${artianBaseBonusClassName(bonusId)}`;
    tag.textContent = artianBaseBonusName(weapon.weaponType, bonusId).replace("強化", "");
    tags.append(tag);
  }

  // 巨戟化の候補：04で決めた狙い（系統の数）に合うか
  const verdict = document.createElement("span");
  verdict.className = "artian-owned-verdict";
  const { counts } = wishCategoryCounts(weapon.weaponType);
  if (!artianWishIsSet(counts, [])) {
    verdict.classList.add("unset");
    verdict.textContent = "狙い未設定（07で希望を決めると判定します）";
  } else if (artianRollMeetsCounts(weapon.ids, counts, [])) {
    verdict.classList.add("good");
    verdict.textContent = `巨戟化の候補：狙い（${artianWishText(weapon.weaponType, counts)}）に合います`;
  } else {
    verdict.classList.add("bad");
    verdict.textContent = `狙い（${artianWishText(weapon.weaponType, counts)}）には足りません`;
  }
  head.append(verdict);

  const controls = document.createElement("div");
  controls.className = "artian-owned-controls";
  if (weapon.attr === 1) {
    // 作るときに決めた属性の種類（以前の登録は「種類未設定」。ここで選べる）
    const select = document.createElement("select");
    const unset = document.createElement("option");
    unset.value = "";
    unset.textContent = "属性の種類：未設定";
    unset.selected = !weapon.element;
    select.append(unset);
    for (const [value, name] of ATTRIBUTES.filter(([value]) => value !== 0)) {
      const option = document.createElement("option");
      option.value = String(value);
      option.textContent = name;
      option.selected = value === weapon.element;
      select.append(option);
    }
    select.addEventListener("change", () => {
      weapon.element = select.value === "" ? null : Number(select.value);
      artianOwnedUi.message = "";
      onArtianOwnedChanged();
    });
    select.title = "この武器を作るときに決めた属性";
    controls.append(select);
  }
  const moveButton = document.createElement("button");
  moveButton.type = "button";
  moveButton.className = "secondary small-button";
  moveButton.textContent = "05で巨戟化・復元へ";
  moveButton.title = "05で予測と激化タイプを確認してから巨戟化を記録します";
  moveButton.addEventListener("click", () => {
    if (!creationWorkbench) return;
    void creationWorkbench.select({kind:'normal',id:weapon.id});
    setActiveTab('artian-create');
    document.querySelector('.app-tabs')?.scrollIntoView({behavior:'smooth',block:'start'});
  });
  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.className = "text-button";
  removeButton.textContent = "削除";
  let armed = false;
  removeButton.addEventListener("click", () => {
    if (!armed) {
      armed = true;
      removeButton.textContent = "もう一度押すと削除";
      setTimeout(() => { armed = false; removeButton.textContent = "削除"; }, 3000);
      return;
    }
    artianOwned = artianOwned.filter((candidate) => candidate.id !== weapon.id);
    artianOwnedUi.message = "削除しました。";
    onArtianOwnedChanged();
  });
  controls.append(moveButton, removeButton);
  item.append(head, tags, controls);
  return item;
}

function setupChatGPTTabs() {
  for (const key of ["guide", "spec"]) {
    document.querySelector(`[data-tab="${key}"]`)?.remove();
    document.querySelector(`[data-tab-view="${key}"]`)?.remove();
  }
  const nav = document.querySelector(".app-tabs");
  const view = document.createElement("div");
  view.className = "tab-view"; view.dataset.tabView = "artian-create"; view.hidden = true;
  const root = document.createElement("section"); root.className = "panel creation-guide"; root.id = "creation-guide";
  view.append(root); document.querySelector(".site-footer").before(view);
  const order = [
    ["search", "02", "seed・復元カウンター検索"],
    ["artian-search", "03", "通常アーティアカウンター特定"],
    ["artian-future", "04", "通常アーティア未来予測"],
    ["artian-create", "05", "通常アーティア作成"],
    ["skill-search", "06", "スキルカウンター特定"],
    ["bonus-future", "07", "復元ボーナス未来予測"],
    ["skill-future", "08", "スキル未来予測"],
    ["artian-owned", "09", "手持ち武器【通常】"],
    ["owned", "10", "手持ち武器【巨戟】"],
  ];
  for (const [key, number, title] of order) {
    const button = nav.querySelector(`[data-tab="${key}"]`) ?? document.createElement("button");
    button.type = "button"; button.className = "tab-button"; button.dataset.tab = key;
    button.setAttribute("aria-selected", "false");
    const span = document.createElement("span"); span.textContent = number;
    button.replaceChildren(span, title); nav.append(button);
  }
  nav.style.setProperty("--tab-count", String(order.length));
}

function workbenchRead() {
  return {
    model: JSON.parse(JSON.stringify({ saveState, artianBaseState, normalOwned: artianOwned, ownedWeapons })),
    stamp: JSON.stringify([STORAGE_KEY, ARTIAN_OWNED_KEY, OWNED_WEAPONS_KEY].map(key => [key, localStorage.getItem(key)])),
    hintStamp: JSON.stringify([bonusWishes, comparisonTargets, loadBonusView().weaponOrder]),
  };
}
function workbenchPreferences() {
  try { return JSON.parse(localStorage.getItem(WORKBENCH_KEY) ?? 'null') ?? {}; } catch { return {}; }
}
function saveWorkbenchPreferences(settings) {
  localStorage.setItem(WORKBENCH_KEY, JSON.stringify({ ...workbenchPreferences(), ...settings, version: 1 }));
}
function commitWorkbenchWithFeedback(action, expected, settings) {
  return performConfirmedOperation(() => {
    assertOperationBasis(expected);
    let preview;
    if (action.type === 'undo') {
      const previous = workbenchPreferences().last;
      if (!previous?.before || previous.afterSignature !== stateSignature(expected.model)) throw new Error('直前の記録後にデータが変わったため取り消せません。');
      preview = {state:previous.before,selected:previous.selectedBefore??null};
    } else preview = transition(expected.model,action);
    const oldWeapon = expected.model.ownedWeapons.find(w=>w.id===action.weaponId);
    const normal = preview.selected?.kind === 'normal';
    const nextWeapon = (normal?preview.state.normalOwned:preview.state.ownedWeapons).find(w=>w.id===preview.selected?.id);
    const titles = {
      create:'通常アーティアの作成を記録しますか？', upgrade:'巨戟化して手持ち武器【巨戟】に反映しますか？',
      restore:'復元結果を手持ち武器に反映しますか？', undo:'直前の記録を取り消して元に戻しますか？',
      'correct-normal':'通常ボーナスの修正を保存しますか？', 'correct-skills':'現在のスキルを修正しますか？', 'correct-bonuses':'現在の復元ボーナスを修正しますか？',
    };
    const target = nextWeapon ? {...nextWeapon,attributeForce:normal?(nextWeapon.attr===0?0:nextWeapon.element):nextWeapon.attributeForce} : null;
    const summary = target ? operationWeaponPreview({target,weapon:oldWeapon,
      skills:!normal&&['upgrade','correct-skills','undo'].includes(action.type)?nextWeapon:null,
      bonuses:normal?nextWeapon.ids:['restore','correct-bonuses','undo'].includes(action.type)&&ownedBonusesKnown(nextWeapon)?nextWeapon.bonuses:null,normal}) : [];
    if(action.type==='restore'&&oldWeapon)summary.push(createWeaponStatComparison(oldWeapon,action.bonuses));
    const inventory = action.type==='create'?'手持ち武器【通常】に1本登録します。':action.type==='upgrade'?'この1本を手持ち武器【通常】から外し、手持ち武器【巨戟】へ移します。'
      :action.type==='undo'?'カウンターと手持ち武器を、直前の記録前の状態に戻します。ゲーム内でも操作を取り消した場合だけ使ってください。'
      :'選んだ武器の登録内容を上書きします。';
    const unknown = (action.type==='create'&&normalCounter(expected.model,action.weaponType)===null)||(action.type==='upgrade'&&expected.model.saveState.skillCounter===null)||(action.type==='restore'&&expected.model.saveState.bonusCounter===null);
    const weaponName = target ? weaponAndAttributeText(target)+(target.label?'「'+target.label+'」':'')+'：' : '';
    return {title:titles[action.type]??'変更を反映しますか？',summary,
      message:inventory+(unknown?' 対応するカウンターは未特定のままです。現在位置は特定タブで確認してください。':''),
      lines:counterChangeMessages(expected.model,preview.state,WEAPON_TYPES,action.type==='create'?action.weaponType:null),
      confirmLabel:action.type==='undo'?'直前の状態に戻す':'手持ち武器に反映する',
      verify:()=>assertOperationBasis(expected),execute:()=>commitWorkbench(action,expected,settings),
      success:result=>weaponName+result.message+(unknown?' 対応するカウンターは未特定のままです。':'')+(result.renderWarning?' '+result.renderWarning:''),
    };
  });
}
async function commitWorkbench(action, expected, settings) {
  const current = workbenchRead();
  if (current.stamp !== expected.stamp || stateSignature(current.model) !== stateSignature(expected.model)) {
    throw new Error('予測の表示後にカウンターか手持ち武器が変わりました。最新の予測を確認して、もう一度記録してください。');
  }
  let result, last;
  if (action.type === 'undo') {
    const previous = workbenchPreferences().last;
    if (!previous?.before || previous.afterSignature !== stateSignature(current.model)) throw new Error('直前の記録後にデータが変わったため取り消せません。現在位置を確認してください。');
    result = {state: previous.before, selected: previous.selectedBefore ?? null, message:'直前の記録を取り消しました。ゲーム内の状態とカウンターが合っているか確認してください。'};
    last = null;
  } else {
    result = transition(current.model, action);
    last = {before:current.model, afterSignature:stateSignature(result.state), selectedBefore:workbenchPreferences().selected??null, message:result.message, at:new Date().toISOString()};
  }
  const nextSettings={...workbenchPreferences(),...settings,version:1,selected:result.selected,last,message:result.message};
  // 作成の登録と入力欄のリセットを一緒に保存する。失敗したら入力も元のまま。
  if(action.type==='create')nextSettings.form={...nextSettings.form,weaponType:null,attributeForce:null,label:''};
  const model=result.state;
  writeAtomic(localStorage, {
    [STORAGE_KEY]:JSON.stringify({saveState:model.saveState, targets:comparisonTargets, bonusPrediction, artianBaseState:model.artianBaseState}),
    [ARTIAN_OWNED_KEY]:JSON.stringify(model.normalOwned),
    [OWNED_WEAPONS_KEY]:JSON.stringify(model.ownedWeapons),
    [WORKBENCH_KEY]:JSON.stringify(nextSettings),
  });
  saveState=model.saveState; artianBaseState=model.artianBaseState; artianOwned=model.normalOwned; ownedWeapons=model.ownedWeapons;
  let renderWarning = '';
  try {
    syncRuntimeFromSaveState(); renderSaveState(); renderArtianOwnedTab(); renderOwnedWeaponSection();
    const refreshed = await Promise.allSettled([refreshArtianBasePredictions(),refreshPredictions(),refreshComparisonPredictions(),refreshSkillPredictions()]);
    if (refreshed.some(item=>item.status==='rejected')) renderWarning = '一部の予測を更新できませんでした。保存は完了しています。画面を開き直して確認してください。';
    showSaveFeedback(result.message,[]);
  } catch { renderWarning = '保存は完了しています。画面を開き直して内容を確認してください。'; }
  return { ...result, preferences: nextSettings, renderWarning };
}

creationWorkbench = mountCreationWorkbench(document.querySelector('#creation-guide'), {
  read:workbenchRead, preferences:workbenchPreferences, savePreferences:saveWorkbenchPreferences, commit:commitWorkbenchWithFeedback,
  watchedKeys:[STORAGE_KEY,ARTIAN_OWNED_KEY,OWNED_WEAPONS_KEY,BONUS_WISHES_KEY,BONUS_VIEW_KEY],
  weapons:WEAPON_TYPES, attributes:ATTRIBUTES, boosts:OWNED_BOOST_OPTIONS.filter(([id])=>id),
  series:SERIES_SKILLS, groups:GROUP_SKILLS,
  createId:createTargetId, open:setActiveTab, pool:artianBasePool,
  normal:(seed,type,attr,counter)=>predictArtianBaseRolls(seed,type,ARTIAN_R8_ENUM,BOWGUN_WEAPON_TYPES.has(type)?0:attr,counter,1)[0].bonusIds,
  ready:ensurePredictionWasm,
  upcoming:upcomingBonusWishMatches,
  goalMatch:configuredBonusWishMatches,
  goalText:bonusWishText,
  skill:(seed,type,attr,counter)=>{const index=predict_skill_rolls(seed,type,attr,counter,SKILL_COUNTER_GATE,1)[0]; return {seriesIndex:Math.floor(index/GROUP_SKILLS.length),groupIndex:index%GROUP_SKILLS.length};},
  bonus:(seed,type,attr,counter,mode,categories)=>Array.from(mode==='keep'
    ?predict_gogma_keep_rolls(seed,type,attr,counter,35,1,new Uint8Array(categories))
    :predict_gogma_rolls(seed,type,attr,counter,35,1)),
  normalName:artianBaseBonusName, bonusName:gogmaBonusName, bonusOptions:gogmaBonusesForWeapon,
  compactBonusName:compactGogmaBonusName,
  stats:createWeaponStatComparison,
  subtype:(type,boost,attr)=>ownedSubtypeFor(type,attr,boost),
  feature:(type,attr,boost)=>skillBoostFeature({weaponType:type,attributeForce:attr},boost),
  autoLabel:(type,attr,boost)=>ownedWeaponAutoName({weaponType:type,attributeForce:attr,boost}).slice(0,24),
  tag:(type,id,normal)=>{const tag=document.createElement('span');tag.className='bonus-tag '+(normal?artianBaseBonusClassName(id):bonusClassName(id))+(!normal&&EX_BONUS_IDS.has(id)?' ex':'');tag.textContent=normal?artianBaseBonusName(type,id):gogmaBonusName(type,id);return tag;},
});

setupResultToolbars([
  { table: skillTableWrap.querySelector("table"), exportButton: exportSkillCsvButton, status: skillExportStatus, highlight: skillHighlightEnabled, filter: skillFilterEnabled },
  { table: comparisonTableWrap.querySelector("table"), exportButton: exportBonusCsvButton, status: bonusExportStatus, filter: bonusWishMatchesOnly,
    extra: [...document.querySelector(".comparison-table-options")?.children ?? []].filter((el) => !el.contains(bonusWishMatchesOnly)) },
  { table: artianBaseTableWrap.querySelector("table"), exportButton: exportArtianBaseCsvButton, filter: artianFilterEnabled },
  { table: predictionRows.closest("table"), filter: predictionMatchesOnly },
]);
setupTabEntryLinks();
document.querySelectorAll(".prediction-export-actions, .bonus-export-actions, .comparison-table-options, .skill-filter-actions").forEach((box) => { if (!box.children.length) box.remove(); });
