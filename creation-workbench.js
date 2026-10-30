import { normalCounter, stateSignature } from './creation-operations.js';

const OLD_DRAFT_KEY='gsf-chatgpt-creation-draft-v1';
const CATEGORY_IDS=[4,8,6,7];
const isKnown=n=>Number.isSafeInteger(n)&&n>=0;
const bowgun=t=>t===12||t===13;
const h=(tag,text,cls)=>Object.assign(document.createElement(tag),{...(text===undefined?{}:{textContent:text}),...(cls?{className:cls}:{})});

export function mountCreationWorkbench(root,host) {
  let prefs=host.preferences();
  let form={weaponType:11,attributeForce:1,label:'',boost:'攻撃激化',mode:'keep',...prefs.form};
  if(form.weaponType!==null&&!host.weapons.some(([id])=>id===form.weaponType))form.weaponType=null;
  if(form.attributeForce!==null&&!host.attributes.some(([id])=>id===form.attributeForce))form.attributeForce=null;
  if(!host.boosts.some(([id])=>id===form.boost))form.boost='攻撃激化';
  if(!['keep','reset'].includes(form.mode))form.mode='keep';
  let selected=prefs.selected??null;
  let message=prefs.message??'', error='', working=false, external=false, renderId=0, lastFingerprint='', lastHintStamp='';
  const name=(items,id)=>items.find(([key])=>key===id)?.[1]??'未設定';
  const number=n=>isKnown(n)?n.toLocaleString('ja-JP'):'未特定';
  const label=(text,control)=>{const el=h('label');el.append(h('span',text),control);return el;};
  const select=(items,value,id)=>{
    const el=h('select');el.id=id;
    for(const [key,text]of items){const option=h('option',text);option.value=String(key);el.append(option);}
    el.value=String(value);return el;
  };
  const changed=()=>{
    try{host.savePreferences({form,selected});}catch(e){error='設定を保存できませんでした。'+e.message;}
  };
  function button(text,action,cls='secondary',id) {
    const el=h('button',text,cls);el.type='button';if(id)el.id=id;
    el.addEventListener('click',async()=>{
      if(working||external)return;
      working=true;error='';root.querySelectorAll('button').forEach(b=>b.disabled=true);
      try{await action();}catch(e){error=e.message;}
      finally{working=false;await render();}
    });
    return el;
  }
  const fieldGrid=()=>h('div',undefined,'field-grid creation-fields');
  function tags(type,values,normal) {
    const box=h('div',undefined,'creation-bonus-tags');
    if(!values||values.some(n=>n===null||n===undefined))box.append(h('span','未登録の枠があります','pool-note'));
    for(const id of values??[])if(id!==null&&id!==undefined)box.append(host.tag(type,id,normal));
    return box;
  }
  function bonusEditor(type,attribute,defaults,normal,id,title) {
    const values=defaults&&defaults.length===5?[...defaults]:[null,null,null,null,null];
    const box=h('div',undefined,'creation-result-editor');
    const preview=tags(type,values,normal);
    const details=h('details');details.open=values.some(n=>n===null);
    details.append(h('summary',title));
    const grid=fieldGrid();
    const options=normal?host.pool(type,bowgun(type)?0:attribute).ids.map(id=>[id,host.normalName(type,id)]):host.bonusOptions(type,attribute).map(([id])=>[id,host.bonusName(type,id)]);
    for(let i=0;i<5;i++){
      const control=select([['','選んでください'],...options],values[i]??'',id+'-'+i);
      control.addEventListener('change',()=>{
        values[i]=control.value===''?null:Number(control.value);
        preview.replaceChildren(...tags(type,values,normal).childNodes);
      });
      grid.append(label((i+1)+'枠目',control));
    }
    details.append(grid);box.append(preview,details);
    return {box,values};
  }
  function skillsEditor(defaults,id,title) {
    const values={seriesIndex:defaults?.seriesIndex??null,groupIndex:defaults?.groupIndex??null};
    const box=h('div',undefined,'creation-result-editor');
    const pair=h('p',undefined,'creation-skill-pair');
    const update=()=>{pair.textContent=(values.seriesIndex===null?'シリーズ未登録':host.series[values.seriesIndex])+' ／ '+(values.groupIndex===null?'グループ未登録':host.groups[values.groupIndex]);};
    const details=h('details');details.open=values.seriesIndex===null||values.groupIndex===null;details.append(h('summary',title));
    const grid=fieldGrid();
    for(const [key,text,items]of [['seriesIndex','シリーズスキル',host.series],['groupIndex','グループスキル',host.groups]]){
      const control=select([['','未登録'],...items.map((text,i)=>[i,text])],values[key]??'',id+'-'+key);
      control.addEventListener('change',()=>{values[key]=control.value===''?null:Number(control.value);update();});
      grid.append(label(text,control));
    }
    update();details.append(grid);box.append(pair,details);
    return {box,values};
  }
  const sourceWeapon=(model)=>selected?.kind==='normal'?model.normalOwned.find(w=>w.id===selected.id):selected?.kind==='giant'?model.ownedWeapons.find(w=>w.id===selected.id):null;
  const weaponText=(w,kind)=>name(host.weapons,w.weaponType)+'・'+(kind==='normal'?(w.attr===0?'無属性':w.element?name(host.attributes,w.element):'属性未設定'):name(host.attributes,w.attributeForce))+(w.label?' ｜ '+w.label:'');
  async function dispatch(action,basis) {
    const result=await host.commit(action,basis,{form,selected});
    selected=result.selected;message=result.message;prefs=result.preferences;
    form={...form,...prefs.form};
    const unknown=action.type==='create'&&!isKnown(normalCounter(basis.model,action.weaponType))?'通常作成':action.type==='upgrade'&&!isKnown(basis.model.saveState.skillCounter)?'スキル':action.type==='restore'&&!isKnown(basis.model.saveState.bonusCounter)?'復元':null;
    if(unknown)message+=' '+unknown+'カウンターは未特定のままです。現在位置は特定タブで確認してください。';
  }
  function showExternal(){
    root.replaceChildren(h('h2','通常アーティア作成'),h('p','別のタブでカウンター・手持ち武器・希望条件や表示順が更新されました。古い予測で記録しないよう操作を止めています。画面を開き直してください。','error'));
    const reload=h('button','最新のデータで開き直す','primary');reload.type='button';reload.onclick=()=>location.reload();root.append(reload);
  }

  async function render() {
    if(external){showExternal();return;}
    const revision=++renderId;
    const basis=host.read(), model=basis.model, save=model.saveState;
    const source=sourceWeapon(model);
    if(selected&&!source){selected=null;changed();}
    if(bowgun(form.weaponType))form.attributeForce=0;
    const hasWeapon=host.weapons.some(([id])=>id===form.weaponType);
    const canCreate=hasWeapon&&host.attributes.some(([id])=>id===form.attributeForce);
    let normalPrediction=null, skillPrediction=null, keepPrediction=null, resetPrediction=null, predictionError='', upcoming=null;
    const counterType=hasWeapon?form.weaponType:source?.weaponType;
    const currentNormal=isKnown(counterType)?normalCounter(model,counterType):null;
    if(canCreate&&isKnown(save.baseSeed)&&isKnown(currentNormal)){
      try{normalPrediction=host.normal(save.baseSeed,form.weaponType,form.attributeForce,currentNormal);}catch(e){predictionError=e.message;}
    }
    let attribute=source?(selected.kind==='normal'?(source.attr===0||bowgun(source.weaponType)?0:source.element??form.selectedAttribute??null):source.attributeForce):null;
    const type=source?.weaponType;
    if(source&&isKnown(save.baseSeed)&&isKnown(attribute)&&(isKnown(save.skillCounter)||isKnown(save.bonusCounter))){
      try{
        await host.ready();
        if(revision!==renderId)return;
        if(selected.kind==='normal'&&isKnown(save.skillCounter))skillPrediction=host.skill(save.baseSeed,type,attribute,save.skillCounter);
        if(isKnown(save.bonusCounter)){
          resetPrediction=host.bonus(save.baseSeed,type,attribute,save.bonusCounter,'reset',[]);
          const categories=selected.kind==='normal'?source.ids.map(id=>CATEGORY_IDS.indexOf(id)):source.categories;
          if(categories?.length===5&&categories.every(n=>Number.isInteger(n)&&n>=0&&n<=3)){
            try{keepPrediction=host.bonus(save.baseSeed,type,attribute,save.bonusCounter,'keep',categories);}catch(e){predictionError=e.message;}
          }
        }
      }catch(e){predictionError='自動予測を読み込めませんでした。実際の結果を選んで記録できます。'+e.message;}
    }
    try {
      const selectedTarget=source?{...source,attributeForce:attribute,categories:selected.kind==='normal'?source.ids.map(id=>CATEGORY_IDS.indexOf(id)):source.categories}:canCreate?{weaponType:form.weaponType,attributeForce:form.attributeForce}:null;
      upcoming=await host.upcoming(model,selectedTarget);
    } catch(e){predictionError+=' 次の希望ボーナスの確認ができませんでした。'+e.message;}
    if(revision!==renderId)return;
    lastFingerprint=stateSignature(model);lastHintStamp=basis.hintStamp;
    root.replaceChildren(h('p','CREATION WORKBENCH','step'),h('h2','通常アーティア作成'),
      h('p','ゲーム内で行った操作の直後に、対応するボタンを1回押してください。その場でカウンターと手持ち武器を更新します。予測と違う結果だった場合は、実際の結果に修正して記録できます。','prediction-intro'));
    if(message){const status=h('p',message,'continuation-message creation-action-message');status.setAttribute('role','status');root.append(status);}
    if(error){const p=h('p',error,'error');p.setAttribute('role','alert');root.append(p);}
    if(predictionError)root.append(h('p',predictionError,'error'));
    const counters=h('div',undefined,'creation-counter-strip');
    for(const [text,value,unselected]of [[isKnown(counterType)?name(host.weapons,counterType)+'の作成カウンター':'通常作成カウンター（武器種を選択）',currentNormal,!isKnown(counterType)],['スキルカウンター（全武器共通）',save.skillCounter],['復元カウンター（全武器共通）',save.bonusCounter]]){
      const item=h('div');item.append(h('span',text),h('strong',unselected?'未選択':number(value)));counters.append(item);
    }
    root.append(counters);
    if(upcoming?.matches.length){
      const notice=h('aside',undefined,'creation-upcoming-goals');notice.setAttribute('role','status');
      notice.append(h('h3','★ 次の復元で、希望ボーナスに一致します'),
        h('p','復元カウンター '+number(upcoming.counter)+' → '+number(upcoming.nextCounter)+' の1回です。別の武器で復元しても、この当たりを消費します。通常作成・巨戟化だけでは復元カウンターは進みません。'));
      const list=h('div',undefined,'creation-upcoming-list');
      for(const hit of upcoming.matches){
        const entry=h('div',undefined,'creation-upcoming-item');
        const preview=h('div',undefined,'creation-upcoming-bonuses');
        for(const id of hit.bonuses){const tag=host.tag(hit.weaponType,id,false);tag.title=tag.textContent;tag.textContent=host.compactBonusName(hit.weaponType,id);tag.classList.add('compact');preview.append(tag);}
        entry.append(h('strong',name(host.weapons,hit.weaponType)+'・'+name(host.attributes,hit.attributeForce)+(hit.label?' ｜ '+hit.label:'')),
          h('span',hit.method==='keep'?'同じ構成で復元':'リセットして復元','creation-upcoming-method'),
          h('small','希望：'+hit.wish),preview);
        list.append(entry);
      }
      notice.append(list,button('07 復元ボーナス未来予測を確認',()=>host.open('bonus-future'),'secondary','open-upcoming-bonus'));
      root.append(notice);
    }else if(!upcoming){
      root.append(h('p','次の希望ボーナスは未確認です。基準seed・復元カウンターが特定されると、07の希望に一致する次の1回をここでお知らせします。','pool-note'));
    }
    let oldDraft=null;
    try{oldDraft=localStorage.getItem(OLD_DRAFT_KEY);}catch{}
    if(oldDraft){
      const note=h('details');note.append(h('summary','以前の作成案内が保留されています'),h('p','以前の案内は最後にまとめてカウンターを更新する方式でした。すでにゲーム内で行った操作がある場合は、現在のカウンターを合わせてから新しい作成を記録してください。旧案内の控えは残しています。','pool-note'));root.append(note);
    }

    const create=h('section',undefined,'creation-operation-card');
    create.append(h('h3','1. 通常アーティアを作成'));
    const row=h('div',undefined,'creation-toolbar');
    const weaponSelect=select([['','武器種を選択してください'],...host.weapons],form.weaponType??'','creation-weapon');
    weaponSelect.addEventListener('change',()=>{form.weaponType=weaponSelect.value===''?null:Number(weaponSelect.value);changed();void render();});
    const attrSelect=select([['','属性を選択してください'],...host.attributes],form.attributeForce??'','creation-attribute');attrSelect.disabled=!hasWeapon||bowgun(form.weaponType);
    attrSelect.addEventListener('change',()=>{form.attributeForce=attrSelect.value===''?null:Number(attrSelect.value);changed();void render();});
    const normalEditor=canCreate?bonusEditor(form.weaponType,form.attributeForce,normalPrediction,true,'create-normal-slot','予測と違う場合・未特定の場合は実際の5枠を選ぶ'):null;
    const createButton=button('作成',()=>{
      if(!canCreate)throw new Error('作る武器種と属性を選んでください。');
      return dispatch({type:'create',id:host.createId(),weaponType:form.weaponType,attributeForce:form.attributeForce,label:root.querySelector('#creation-label').value.trim(),ids:normalEditor.values},basis);
    },'primary','record-normal-create');
    createButton.disabled=!canCreate;
    const nameInput=h('input');nameInput.type='text';nameInput.id='creation-label';nameInput.maxLength=24;nameInput.value=form.label;nameInput.placeholder='省略できます';nameInput.addEventListener('input',()=>{form.label=nameInput.value;});nameInput.addEventListener('change',()=>{form.label=nameInput.value.trim();changed();});
    row.append(label('作る武器種',weaponSelect),label('作る属性',attrSelect),createButton,label('名前（任意）',nameInput));
    create.append(row,h('p','ゲーム内で通常の作成・復元強化を終えて5枠を確認したら「作成」を押してください。','pool-note'));
    if(canCreate)create.append(h('p','作成を記録すると、'+name(host.weapons,form.weaponType)+'の作成カウンターだけが '+number(currentNormal)+' → '+(isKnown(currentNormal)?number(currentNormal+1):'未特定のまま')+' となり、手持ち武器【通常】に登録します。','pool-note'),
      h('h4',normalPrediction?'次に付く通常アーティアの5枠':'自動予測できないため、実際に付いた5枠を選んでください'),normalEditor.box);
    else create.append(h('p','次に作る武器種と属性を選んでください。登録が完了すると、この入力欄は未選択に戻ります。','pool-note'));
    root.append(create);

    const chooser=h('section',undefined,'creation-operation-card');
    chooser.append(h('h3','2. 続けて扱う武器'));
    const options=[['','いま作った武器、または手持ちから選択']];
    for(const w of model.normalOwned)options.push(['normal:'+w.id,'【通常】'+weaponText(w,'normal')]);
    for(const w of model.ownedWeapons)options.push(['giant:'+w.id,'【巨戟】'+weaponText(w,'giant')]);
    const ownedSelect=select(options,selected?selected.kind+':'+selected.id:'','creation-selected-weapon');
    ownedSelect.addEventListener('change',()=>{const i=ownedSelect.value.indexOf(':');selected=i<0?null:{kind:ownedSelect.value.slice(0,i),id:ownedSelect.value.slice(i+1)};delete form.selectedAttribute;changed();void render();});
    chooser.append(label('巨戟化・復元強化する武器',ownedSelect));
    if(!source)chooser.append(h('p','上の「作成」を押すと、その武器が自動で選ばれます。すでに持っている武器から選んで続けることもできます。','pool-note'));
    root.append(chooser);

    if(source){
      chooser.append(h('p',weaponText(source,selected.kind),'creation-current-weapon'));
      if(selected.kind==='normal'){
        if(attribute===null){
          const missing=select([['','属性の種類を選んでください'],...host.attributes.filter(([id])=>id!==0)],'','creation-missing-attribute');
          missing.addEventListener('change',()=>{form.selectedAttribute=missing.value===''?null:Number(missing.value);changed();void render();});
          chooser.append(label('以前の登録にない属性の種類',missing));
        }
        const current=bonusEditor(type,attribute??1,source.ids,true,'current-normal-slot','登録済みの5枠を修正する');
        const fix=button('通常ボーナスの修正を保存',()=>dispatch({type:'correct-normal',weaponId:source.id,attributeForce:attribute,ids:current.values},basis),'secondary','correct-normal');
        current.box.querySelector('details').append(fix);chooser.append(current.box);
        const upgrade=h('section',undefined,'creation-operation-card');
        upgrade.append(h('h3','3. この武器を巨戟化'));
        const boosts=h('div',undefined,'creation-boosts');boosts.setAttribute('role','group');boosts.setAttribute('aria-label','激化タイプ');
        for(const [value,text]of host.boosts){
          const b=button(text,()=>{form.boost=value;changed();});b.setAttribute('aria-pressed',String(form.boost===value));boosts.append(b);
        }
        const skillEditor=skillsEditor(skillPrediction,'upgrade-skill','実際に付いたスキルが違う場合は修正する');
        upgrade.append(h('p','激化タイプを選んでください。'),boosts,
          h('p',host.feature?.(type,attribute,form.boost)||'', 'creation-current-weapon'),
          h('h4',skillPrediction?'巨戟化すると付与されるスキル':'スキルを自動予測できません。実際のスキルを選べます'),skillEditor.box,
          h('p','スキルカウンターだけを '+number(save.skillCounter)+' → '+(isKnown(save.skillCounter)?number(save.skillCounter+1):'未特定のまま')+' に進めます。通常の5枠の系統を引き継いで、手持ち武器【巨戟】へ移します。','pool-note'),
          button('巨戟化して手持ち武器【巨戟】へ移す',()=>dispatch({type:'upgrade',id:host.createId(),weaponId:source.id,attributeForce:attribute,boost:form.boost,subtype:host.subtype(type,form.boost,attribute),autoLabel:host.autoLabel(type,attribute,form.boost),...skillEditor.values},basis),'primary','record-upgrade'));
        root.append(upgrade);
      }else{
        const currentSkills=skillsEditor(source,'current-giant-skill','現在のスキルを修正する');
        currentSkills.box.querySelector('details').append(button('スキルの修正を保存',()=>dispatch({type:'correct-skills',weaponId:source.id,...currentSkills.values},basis),'secondary','correct-skills'));
        chooser.append(h('p','激化タイプ：'+(source.boost||'未登録')),currentSkills.box);
        const known=source.bonuses?.every(n=>n!==null&&n!==undefined);
        if(!known)chooser.append(h('p','巨戟化直後：5枠の系統を引き継いでいます。II・III・EXは次の復元強化で決まります。','pool-note'),
          tags(type,source.categories?.map(n=>CATEGORY_IDS[n]??null),true));
        const currentBonus=bonusEditor(type,attribute,known?source.bonuses:null,false,'current-giant-slot','現在の復元ボーナスを修正する（カウンターは進めない）');
        if(!known)currentBonus.box.querySelector('details').open=false;
        currentBonus.box.querySelector('details').append(button('復元ボーナスの修正を保存',()=>dispatch({type:'correct-bonuses',weaponId:source.id,bonuses:currentBonus.values},basis),'secondary','correct-bonuses'));
        chooser.append(currentBonus.box);
      }

      const restore=h('section',undefined,'creation-operation-card');
      restore.append(h('h3',(selected.kind==='normal'?'4. 巨戟化後の復元強化を予測':'3. この巨戟武器を復元強化')));
      const modes=h('div',undefined,'creation-restore-modes');
      for(const [mode,text,prediction]of [['keep','同じ構成で復元',keepPrediction],['reset','リセットして復元',resetPrediction]]){
        const card=h('div',undefined,'creation-restore-card');
        const choose=button(text,()=>{form.mode=mode;changed();});choose.setAttribute('aria-pressed',String(form.mode===mode));
        card.classList.toggle('selected',form.mode===mode);
        card.append(choose,prediction?tags(type,prediction,false):h('p',attribute===null?'先に属性の種類を選んでください。':'予測に必要なカウンター・構成が未特定です。実際の結果を手入力できます。','pool-note'));
        if(prediction&&selected.kind==='giant')card.append(host.stats(source,prediction,{compact:true}));
        if(prediction&&host.goalMatch(type,prediction)){
          card.classList.add('bonus-goal-hit');card.append(h('strong','★ 希望ボーナス一致','bonus-goal-badge'),h('p','希望：'+host.goalText(type),'pool-note'));
        }
        modes.append(card);
      }
      const prediction=form.mode==='keep'?keepPrediction:resetPrediction;
      const actual=bonusEditor(type,attribute??1,prediction,false,'restore-slot','予測と違う場合・未特定の場合は実際の復元結果を選ぶ');
      const record=button('この方法で復元強化を記録',()=>dispatch({type:'restore',weaponId:source.id,mode:form.mode,bonuses:actual.values},basis),'primary','record-restore');
      record.disabled=selected.kind!=='giant';
      restore.append(h('p','現在の復元カウンターから、次の1回の結果を表示しています。','pool-note'),modes,h('h4','記録する5枠（'+(form.mode==='keep'?'同じ構成':'リセット')+'）'),actual.box,
        h('p','復元カウンターだけを '+number(save.bonusCounter)+' → '+(isKnown(save.bonusCounter)?number(save.bonusCounter+1):'未特定のまま')+' に進め、この巨戟武器のボーナスを更新します。','pool-note'),record);
      if(selected.kind==='normal')restore.append(h('p','先に上の「巨戟化」を記録すると、復元強化を記録できます。','pool-note'));
      if(upcoming?.matches.length&&(!prediction||!host.goalMatch(type,prediction))){
        const warning=h('p','★ 別の武器・方法に希望の当たりがあります。この方法でゲーム内の復元を行うと、その当たりを消費します。上の通知で武器と方法を確認してください。','creation-advance-warning');
        record.before(warning);
      }
      root.append(restore);
    }

    const footer=h('div',undefined,'creation-workbench-footer');
    const last=host.preferences().last;
    if(last?.before&&last.afterSignature===stateSignature(model)){
      footer.append(button('直前の記録を取り消す',()=>dispatch({type:'undo'},basis),'secondary','undo-creation-record'),
        h('p','ゲーム内でもその操作を取り消した場合だけ使ってください。直前の記録のカウンターと手持ち武器を戻します。','pool-note'));
    }
    footer.append(button('手持ち武器【通常】を見る',()=>host.open('artian-owned'),'text-button'),
      button('手持ち武器【巨戟】を見る',()=>host.open('owned'),'text-button'));
    root.append(footer);
  }
  function refresh(force=false){
    if(working)return;
    const current=host.read();
    if(force===true||stateSignature(current.model)!==lastFingerprint||current.hintStamp!==lastHintStamp||!root.children.length)void render();
  }
  document.addEventListener('click',event=>{
    if(!root.contains(event.target)&&!root.closest('[data-tab-view]')?.hidden)requestAnimationFrame(refresh);
  });
  document.addEventListener('change',event=>{
    if(!root.contains(event.target)&&!root.closest('[data-tab-view]')?.hidden)requestAnimationFrame(refresh);
  });
  window.addEventListener('storage',event=>{
    if(host.watchedKeys.includes(event.key)||event.key===null){external=true;++renderId;showExternal();}
  });
  void render();
  return {refresh, select:selection=>{selected=selection;delete form.selectedAttribute;changed();return render();}};
}

