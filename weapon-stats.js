// 巨戟アーティアの復元ボーナス。基礎攻撃力は武器係数を掛けない値。
// 実測・計算資料: https://kuroyonhon.com/mhwilds/memo/38.php
// 照合: https://gamewith.jp/mhwilds/534657
// チャージアックスの属性EXは上記2資料で一致する +80 を使用。
const ATTACK = new Map([[8, 6], [12, 9], [15, 12]]);
const AFFINITY = new Map([[9, 6], [13, 8], [16, 10]]);
const ELEMENT = [[90,110],[50,80],[30,50],[60,90],[60,90],[60,90],[60,90],[60,90],[50,80],[60,80],[50,80],[40,60],null,null];
const VALID = new Set([6,8,9,10,11,12,13,14,15,16]);
const bowgun = type => type === 12 || type === 13;
const validType = type => Number.isInteger(type) && type >= 0 && type < 14;
const validAttribute = attr => Number.isInteger(attr) && attr >= 0 && attr <= 9;
export const hasWeaponElementValue = (type,attr) => validType(type) && validAttribute(attr) && !bowgun(type) && attr !== 0 && !(type === 11 && [6,7,8].includes(attr));

export function sumRestorationStats(type,attr,bonuses) {
  if (!validType(type) || !validAttribute(attr) || !Array.isArray(bonuses) || bonuses.length !== 5 || bonuses.some(id => !VALID.has(id))) return null;
  const element = hasWeaponElementValue(type,attr);
  if (bonuses.some(id => [11,14].includes(id) && !element) || bonuses.some(id => [6,10].includes(id) && type === 11)) return null;
  const result = {attack:0,affinity:0,element:element?0:null,sharpness:bowgun(type)||type===11?null:0,ammo:bowgun(type)?0:null};
  for (const id of bonuses) {
    result.attack += ATTACK.get(id) ?? 0;
    result.affinity += AFFINITY.get(id) ?? 0;
    if (id === 11 || id === 14) result.element += ELEMENT[type][id === 11 ? 0 : 1];
    if (id === 6 || id === 10) {
      if (bowgun(type)) result.ammo += id === 6 ? 1 : 2;
      else result.sharpness += id === 6 ? 30 : 50;
    }
  }
  return result;
}

const validOptional = (value,min,max) => value === null || Number.isSafeInteger(value) && value >= min && value <= max;
export function normalizeWeaponStatReference(value) {
  if (!value || value.version !== 1 || !validType(value.weaponType) || !validAttribute(value.attributeForce) || typeof value.boost !== 'string' ||
      !validOptional(value.attack,0,99999) || !validOptional(value.element,0,99999) || !validOptional(value.affinity,-100,100) ||
      !sumRestorationStats(value.weaponType,value.attributeForce,value.bonuses)) return null;
  const totals=sumRestorationStats(value.weaponType,value.attributeForce,value.bonuses);
  if (value.attack !== null && value.attack < totals.attack || value.element !== null && (totals.element === null || value.element < totals.element)) return null;
  return {version:1,weaponType:value.weaponType,attributeForce:value.attributeForce,boost:value.boost,attack:value.attack,element:value.element,affinity:value.affinity,bonuses:[...value.bonuses]};
}

export function makeWeaponStatReference(weapon,fields) {
  const read = (key,label,min,max) => {
    const raw=fields[key];
    if (raw === null || raw === undefined || typeof raw === 'string' && raw.trim() === '') return null;
    const number=typeof raw === 'number' || typeof raw === 'string' ? Number(raw) : NaN;
    if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${label}は${min}〜${max}の整数で入力してください。空欄は未登録として扱います。`);
    return number;
  };
  const attack=read('attack','基礎攻撃力',0,99999), affinity=read('affinity','会心率',-100,100);
  const element=hasWeaponElementValue(weapon.weaponType,weapon.attributeForce)?read('element','属性・状態異常値',0,99999):null;
  if ([attack,element,affinity].every(value=>value===null)) return null;
  const totals=sumRestorationStats(weapon.weaponType,weapon.attributeForce,weapon.bonuses);
  if (!totals) throw new Error('先に、この武器の現在の復元ボーナス5枠をすべて登録してください。');
  if (attack !== null && attack < totals.attack || element !== null && element < totals.element) throw new Error('武器全体の数値を入力してください。復元ボーナスの加算分より小さいため登録できません。');
  return {version:1,weaponType:weapon.weaponType,attributeForce:weapon.attributeForce,boost:weapon.boost??'',attack,element,affinity,bonuses:[...weapon.bonuses]};
}

export function weaponStatComparison(weapon,nextBonuses) {
  const type=weapon.weaponType,attr=weapon.attributeForce;
  const before=sumRestorationStats(type,attr,weapon.bonuses),after=sumRestorationStats(type,attr,nextBonuses);
  const reference=normalizeWeaponStatReference(weapon.statReference);
  const referenceUsable=!!reference && reference.weaponType===type && reference.attributeForce===attr && reference.boost===(weapon.boost??'');
  const anchor=referenceUsable?sumRestorationStats(type,attr,reference.bonuses):null;
  const entries=[['attack','基礎攻撃力',''],['element',attr>=6?'状態異常値':'属性値',''],['affinity','会心率','%']];
  if (type!==11) entries.push(bowgun(type)?['ammo','装填数強化の加算分','発']:['sharpness','斬れ味強化の加算分','']);
  const rows=entries.map(([key,label,unit])=>{
    const applicable=key==='element'?hasWeaponElementValue(type,attr):true;
    const absolute=applicable && ['attack','element','affinity'].includes(key) && referenceUsable && reference[key]!==null;
    const value=totals=>!totals||totals[key]===null?null:absolute?reference[key]-anchor[key]+totals[key]:totals[key];
    const oldValue=value(before),newValue=value(after);
    return {key,label,unit,applicable,absolute,before:oldValue,after:newValue,delta:oldValue===null||newValue===null?null:newValue-oldValue};
  });
  return {rows,hasReference:referenceUsable,staleReference:!!reference&&!referenceUsable};
}
