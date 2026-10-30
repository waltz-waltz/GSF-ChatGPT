import { normalCounter } from './creation-operations.js';

// 予測結果を採用する際も、元データを触らず変更後を先に組み立てる。
export function advanceCounter(state, kind, steps, weaponType) {
  if (!Number.isSafeInteger(steps) || steps < 1) throw new Error('進める回数が正しくありません。予測を開き直してください。');
  const next = JSON.parse(JSON.stringify(state));
  const before = kind === 'normal' ? normalCounter(state, weaponType) : state.saveState[kind === 'skill' ? 'skillCounter' : 'bonusCounter'];
  const max = kind === 'normal' ? 1000000 : 0xffffffff;
  if (!['normal','skill','bonus'].includes(kind) || state.saveState.baseSeed === null || !Number.isSafeInteger(before) || before < 0 || before + steps > max) {
    throw new Error('カウンターが未特定、または範囲外です。現在位置を確認してください。');
  }
  if (kind === 'normal') {
    next.artianBaseState.counters[weaponType+':7'] = before + steps;
    next.artianBaseState.sources[weaponType+':7'] = '予測結果';
  } else {
    next.saveState[kind === 'skill' ? 'skillCounter' : 'bonusCounter'] = before + steps;
    next.saveState[kind === 'skill' ? 'skillSource' : 'bonusSource'] = '予測結果';
  }
  return next;
}

export function counterChangeMessages(before, after, weapons = [], normalType = null) {
  const known = n => Number.isSafeInteger(n) && n >= 0;
  const num = n => known(n) ? n.toLocaleString('ja-JP') : '未特定';
  const line = (label, a, b) => a === b
    ? `${label}：${num(a)}（変更しません）`
    : `${label}：${num(a)} → ${num(b)}${known(a)&&known(b) ? `（${Math.abs(b-a).toLocaleString('ja-JP')}${b>a?'進みます':'戻ります'}）` : ''}`;
  const lines = [line('スキルカウンター',before.saveState.skillCounter,after.saveState.skillCounter),line('復元ボーナスカウンター',before.saveState.bonusCounter,after.saveState.bonusCounter)];
  for (const [type,name] of weapons) {
    const a=normalCounter(before,type), b=normalCounter(after,type);
    if (a!==b || type===normalType) lines.unshift(line(name+'の通常作成カウンター',a,b));
  }
  return lines;
}

// 完了を閉じるまでロックする。保存できた後の通知失敗を「未保存」と取り違えない。
export function createOperationController({ask, working, notice}) {
  let busy = false;
  return async function perform(prepare) {
    if (busy) return null;
    busy = true;
    let saved = false, result = null, stopWorking = () => {};
    try {
      const config = typeof prepare === 'function' ? prepare() : prepare;
      if (!await ask(config)) { config.onCancel?.(); return null; }
      stopWorking = working?.() ?? stopWorking;
      config.verify?.();
      result = await config.execute();
      saved = true;
      stopWorking();
      await notice({title:'反映しました',message:typeof config.success==='function'?config.success(result):config.success??result?.message??'保存が完了しました。',lines:(config.lines??[]).map(line=>line.replace(/進みます/g,'進みました').replace(/戻ります/g,'戻しました').replace(/変更しません/g,'変更なし')),success:true});
      return result ?? {saved:true};
    } catch (error) {
      stopWorking();
      await notice({title:saved?'保存は完了しています':'反映できませんでした',message:saved?'データは保存済みです。もう一度押さずに画面を開き直して確認してください。':error.message,success:false});
      return saved ? result ?? {saved:true} : null;
    } finally {
      busy = false;
    }
  };
}

const element = (tag,text,cls) => Object.assign(document.createElement(tag),{...(text===undefined?{}:{textContent:text}),...(cls?{className:cls}:{})});
function popup({title,message,summary=[],lines=[],confirmLabel,notice=false,success=false,pending=false}) {
  const previous=document.activeElement;
  const overlay=element('div',undefined,'skill-adopt-overlay operation-feedback-overlay');
  const box=element('section',undefined,'skill-adopt-menu operation-feedback-popup'+(success?' operation-complete':''));
  box.setAttribute('role',pending?'status':'alertdialog');box.setAttribute('aria-modal','true');box.setAttribute('aria-label',title);box.tabIndex=-1;
  const heading=element('h3',title);box.append(heading);
  if(summary.length){const preview=element('div',undefined,'operation-preview');preview.append(...summary);box.append(preview);}
  if(message)box.append(element('p',message,'operation-message'));
  if(lines.length){const list=element('ul',undefined,'operation-counter-changes');for(const line of lines)list.append(element('li',line));box.append(list);}
  if(!notice&&!pending)box.append(element('p','ゲーム内でも、この操作を終えてセーブした場合に反映してください。','operation-note'));
  overlay.append(box);document.body.append(overlay);
  let settled=false,resolve;
  const answer=new Promise(r=>resolve=r);
  const close=value=>{if(settled)return;settled=true;overlay.remove();document.removeEventListener('keydown',onKey,true);if(previous?.isConnected)previous.focus();resolve(value);};
  let cancel,confirm;
  if(!pending){
    const actions=element('div',undefined,'operation-actions');
    if(!notice){cancel=element('button','戻る','secondary');cancel.type='button';cancel.addEventListener('click',()=>close(false));actions.append(cancel);}
    confirm=element('button',notice?'確認しました':confirmLabel??'反映する','primary');confirm.type='button';confirm.addEventListener('click',()=>close(true));actions.append(confirm);box.append(actions);
  }
  const onKey=event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(!pending)close(notice);}
    if(event.key==='Tab'){
      const buttons=[...box.querySelectorAll('button')];
      if(!buttons.length){event.preventDefault();return;}
      if(event.shiftKey&&document.activeElement===buttons[0]){event.preventDefault();buttons.at(-1).focus();}
      else if(!event.shiftKey&&document.activeElement===buttons.at(-1)){event.preventDefault();buttons[0].focus();}
    }
  };
  document.addEventListener('keydown',onKey,true);
  overlay.addEventListener('click',event=>{if(event.target===overlay&&!notice&&!pending)close(false);});
  (cancel??confirm??box).focus();
  return {answer,close};
}

export const performConfirmedOperation = createOperationController({
  ask:config=>popup({...config,success:false,message:config.message??'手持ち武器とカウンターへの変更を確認してください。'}).answer,
  working:()=>{const view=popup({title:'反映中です…',message:'保存が終わるまでお待ちください。',pending:true});return ()=>view.close(true);},
  notice:config=>popup({...config,notice:true}).answer,
});
