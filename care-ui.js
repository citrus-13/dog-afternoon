import {DogCare} from './care.js?v=pet-reactions-2';

const messages={
  treat:'它嗅了嗅，把零食吃掉了。',
  meal:'它低下头，开始吃狗粮。',
  ball:'它顺着滚球的方向抬起了头。'
};
const saveHint='进度会自动保存在这个浏览器。';
const saveUnavailable='当前浏览器暂时无法存档。';

export function bindCare({scene}){
  const model=new DogCare();
  const status=document.querySelector('#care-status');
  const meters=['affection','fullness'].map(key=>({
    key,
    bar:document.getElementById(key),
    text:document.getElementById(`${key}-value`)
  }));
  let dog=null;
  let nextUpdate=0;

  function showStatus(message=''){
    const text=message||saveHint;
    status.textContent=model.canSave?text:message?`${message} ${saveUnavailable}`:saveUnavailable;
  }

  function render(current=model.get(dog)){
    for(const {key,bar,text} of meters){
      const value=Math.round(current[key]);
      if(bar.value!==value)bar.value=value;
      const label=`${value}%`;
      if(text.textContent!==label)text.textContent=label;
    }
    scene.setBond(current.affection);
  }

  function act(kind){
    if(!dog||!scene?.ready)return;
    if(!scene.canPerformCare){
      status.textContent='稍等一下，它还在忙。';
      return;
    }
    const accepted=kind==='ball'?model.play(dog):model.feed(dog,kind);
    if(!accepted){
      status.textContent=kind==='ball'
        ?'让它歇一会儿，再滚球。'
        :kind==='meal'?'它还不饿，先留着狗粮吧。':'它肚子挺饱，待会儿再给零食吧。';
      return;
    }
    scene.performCare(kind);
    showStatus(messages[kind]);
    render();
  }

  for(const [id,kind] of [['feed-treat','treat'],['feed-meal','meal'],['roll-ball','ball']]){
    document.getElementById(id).addEventListener('click',()=>act(kind));
  }

  return {
    selectDog(id){
      dog=id;
      showStatus();
      render();
    },
    update(now){
      if(!dog||now<nextUpdate)return;
      nextUpdate=now+240;
      const seconds=scene.takeCareTime();
      const previous=model.get(dog).affection;
      if(seconds>0)model.pet(dog,seconds);
      const current=model.get(dog);
      if(previous<25&&current.affection>=25)status.textContent='它已经熟悉你的手了。';
      if(previous<65&&current.affection>=65)status.textContent='它现在更容易摇尾巴了。';
      if(!model.canSave&&status.textContent===saveHint)showStatus();
      render(current);
    }
  };
}
