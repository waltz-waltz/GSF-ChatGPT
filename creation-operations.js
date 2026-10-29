import { artianBasePool } from './artian-base-rng.js';

export const WORKBENCH_KEY = 'gsf-chatgpt-creation-workbench-v1';
const MAX_COUNTER = 4294967295;
const NORMAL_IDS = new Map([[4,0],[8,1],[6,2],[7,3]]);
const BONUS_IDS = new Map([[8,0],[12,0],[15,0],[9,1],[13,1],[16,1],[11,2],[14,2],[6,3],[10,3]]);
const clone = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
export const stateSignature = state => JSON.stringify(canonical(state));
const integer = (n,max) => Number.isSafeInteger(n) && n >= 0 && n <= max;
const bowgun = type => type === 12 || type === 13;
const requireType = type => { if(!integer(type,13))throw new Error('武器種を選んでください。'); };
const requireAttribute = attr => { if(!integer(attr,9))throw new Error('属性を選んでください。'); };
const increment = (value,max) => {
  if(value === null || value === undefined)return null;
  if(!integer(value,max) || value >= max)throw new Error('カウンターの上限です。現在位置を確認してください。');
  return value+1;
};
export function normalCounter(state,type) {
  if(state.saveState.baseSeed === null || state.artianBaseState.baseSeed !== state.saveState.baseSeed)return null;
  const value=state.artianBaseState.counters[type+':7'];
  return integer(value,1000000)?value:null;
}
export function validateNormal(type,attribute,ids) {
  requireType(type); requireAttribute(attribute);
  const pool=artianBasePool(type,bowgun(type)?0:attribute);
  if(!Array.isArray(ids)||ids.length!==5||ids.some(id=>!pool.ids.includes(id)))throw new Error('通常アーティアのボーナスを5枠すべて選んでください。');
  for(const [id,max]of pool.caps)if(ids.filter(v=>v===id).length>max)throw new Error('通常アーティアの系統の数が、この武器種の上限を超えています。');
}
export function validateBonuses(type,attribute,ids) {
  requireType(type); requireAttribute(attribute);
  if(!Array.isArray(ids)||ids.length!==5||ids.some(id=>!BONUS_IDS.has(id)))throw new Error('復元ボーナスを5枠すべて選んでください。');
  const categories=ids.map(id=>BONUS_IDS.get(id));
  if(type===11 && categories.includes(3) || bowgun(type)&&categories.includes(2) || attribute===0&&categories.includes(2))throw new Error('この武器種・属性では付かない復元ボーナスが含まれています。');
  if(categories.filter(n=>n===2).length>4||categories.filter(n=>n===3).length>2)throw new Error('復元ボーナスの系統の数が上限を超えています。');
}
function skillIndex(value,max) { if(value!==null&&!integer(value,max))throw new Error('スキルを正しく選んでください。'); return value; }
function requireId(state,id) {
  if(typeof id!=='string'||!id||[...state.normalOwned,...state.ownedWeapons].some(w=>w.id===id))throw new Error('武器の識別番号が重複しました。画面を更新してください。');
}
export function transition(state,action) {
  const next=clone(state); let selected, message, advanced={normal:0,skill:0,bonus:0};
  const getNormal=()=>{const w=next.normalOwned.find(w=>w.id===action.weaponId);if(!w)throw new Error('対象の通常アーティアが見つかりません。手持ち一覧を確認してください。');return w;};
  const getGiant=()=>{const w=next.ownedWeapons.find(w=>w.id===action.weaponId);if(!w)throw new Error('対象の巨戟武器が見つかりません。手持ち一覧を確認してください。');return w;};
  if(action.type==='create') {
    requireType(action.weaponType); requireAttribute(action.attributeForce); requireId(next,action.id);
    validateNormal(action.weaponType,action.attributeForce,action.ids);
    if(next.normalOwned.length>=140)throw new Error('手持ち武器【通常】は上限140本です。登録を整理してから記録してください。');
    const before=normalCounter(next,action.weaponType), after=increment(before,1000000);
    if(after!==null){next.artianBaseState.counters[action.weaponType+':7']=after;next.artianBaseState.sources[action.weaponType+':7']='通常作成';advanced.normal=1;}
    next.normalOwned.push({id:action.id,label:(action.label??'').trim().slice(0,24),weaponType:action.weaponType,attr:bowgun(action.weaponType)||action.attributeForce===0?0:1,element:bowgun(action.weaponType)||action.attributeForce===0?null:action.attributeForce,ids:[...action.ids]});
    selected={kind:'normal',id:action.id};message='通常アーティアを作成し、手持ち武器【通常】に登録しました。';
  } else if(action.type==='upgrade') {
    const normal=getNormal();
    if(next.ownedWeapons.length>=140)throw new Error('手持ち武器【巨戟】は上限140本です。登録を整理してから記録してください。');
    const attribute=normal.attr===0||bowgun(normal.weaponType)?0:normal.element??action.attributeForce;
    requireAttribute(attribute); if(normal.attr!==0&&!bowgun(normal.weaponType)&&attribute===0)throw new Error('この通常アーティアの属性の種類を選んでください。');
    validateNormal(normal.weaponType,attribute,normal.ids);
    if(!['攻撃激化','属性激化','会心激化'].includes(action.boost))throw new Error('激化タイプを選んでください。');
    const after=increment(next.saveState.skillCounter,MAX_COUNTER);
    const id=next.ownedWeapons.some(w=>w.id===normal.id)?action.id:normal.id;
    if(next.ownedWeapons.some(w=>w.id===id)||typeof id!=='string')throw new Error('武器の識別番号が重複しました。');
    const giant={id,label:normal.label||String(action.autoLabel??'').slice(0,24),weaponType:normal.weaponType,attributeForce:attribute,boost:action.boost,subtype:action.subtype??'',seriesIndex:skillIndex(action.seriesIndex,20),groupIndex:skillIndex(action.groupIndex,13),bonuses:[null,null,null,null,null],categories:normal.ids.map(id=>NORMAL_IDS.get(id)),rule:'ex',minEx:2,keepAttack:true};
    next.normalOwned=next.normalOwned.filter(w=>w.id!==normal.id);next.ownedWeapons.push(giant);
    if(after!==null){next.saveState.skillCounter=after;next.saveState.skillSource='巨戟化';advanced.skill=1;}
    selected={kind:'giant',id};message='巨戟化を記録し、手持ち武器【通常】から【巨戟】へ移しました。';
  } else if(action.type==='restore') {
    const giant=getGiant(); validateBonuses(giant.weaponType,giant.attributeForce,action.bonuses);
    if(!['keep','reset'].includes(action.mode))throw new Error('復元方法を選んでください。');
    // 実測が違う場合の訂正も受け付ける。選んだ実測が現在の構成として次の予測へ渡る。
    const after=increment(next.saveState.bonusCounter,MAX_COUNTER);
    giant.bonuses=[...action.bonuses];giant.categories=action.bonuses.map(id=>BONUS_IDS.get(id));giant.rule='upgrade';
    if(after!==null){next.saveState.bonusCounter=after;next.saveState.bonusSource='復元強化';advanced.bonus=1;}
    selected={kind:'giant',id:giant.id};message='復元強化を記録し、この巨戟武器のボーナスを更新しました。';
  } else if(action.type==='correct-normal') {
    const normal=getNormal(), attribute=normal.attr===0?0:normal.element??action.attributeForce;
    validateNormal(normal.weaponType,attribute,action.ids);normal.ids=[...action.ids];
    if(normal.attr!==0&&!bowgun(normal.weaponType))normal.element=attribute;
    selected={kind:'normal',id:normal.id};message='通常アーティアのボーナスを修正しました。カウンターは進めていません。';
  } else if(action.type==='correct-skills') {
    const giant=getGiant(); giant.seriesIndex=skillIndex(action.seriesIndex,20);giant.groupIndex=skillIndex(action.groupIndex,13);
    selected={kind:'giant',id:giant.id};message='実際に付いたスキルへ修正しました。カウンターは進めていません。';
  } else if(action.type==='correct-bonuses') {
    const giant=getGiant();validateBonuses(giant.weaponType,giant.attributeForce,action.bonuses);
    giant.bonuses=[...action.bonuses];giant.categories=action.bonuses.map(id=>BONUS_IDS.get(id));
    selected={kind:'giant',id:giant.id};message='実際の復元ボーナスへ修正しました。カウンターは進めていません。';
  } else {throw new Error('読み取れない操作です。画面を開き直してください。');}
  return {state:next,selected,message,advanced};
}

export function writeAtomic(storage,records) {
  const previous=Object.fromEntries(Object.keys(records).map(key=>[key,storage.getItem(key)]));
  try {for(const [key,value]of Object.entries(records)){if(value===null)storage.removeItem(key);else storage.setItem(key,value);}}
  catch(error){
    try {
      // 一旦対象キーだけを解放してから元の値を書き戻し、容量不足でも復元できるようにする。
      for(const key of Object.keys(records))storage.removeItem(key);
      for(const [key,value]of Object.entries(previous))if(value!==null)storage.setItem(key,value);
    }catch{throw new Error('保存と復元を完了できませんでした。このページを閉じずに保存領域を確認してください。',{cause:error});}
    throw new Error('保存できなかったため、変更前の状態に戻しました。',{cause:error});
  }
}
