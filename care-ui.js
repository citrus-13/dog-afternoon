import {DogCare} from './care.js?v=rana-bichon-5';

const messages={
  treat:'它嗅了嗅，把零食吃掉了。',
  meal:'它低下头，开始吃狗粮。',
  ball:'它顺着滚球的方向抬起了头。'
};
const saveHint='进度会自动保存在这个浏览器。';
const saveUnavailable='当前浏览器暂时无法存档。';

export function bindCare({scene,isSelecting=()=>false}){
  const model=new DogCare();
  const status=document.querySelector('#care-status');
  const growthStatus=document.querySelector('#growth-status');
  const meters=['affection','fullness'].map(key=>({
    key,
    bar:document.getElementById(key),
    text:document.getElementById(`${key}-value`)
  }));
  let dog=null;
  let nextUpdate=0;
  let appliedGrowth=null,wasWaiting=false,statusUntil=0;
  const ball=document.getElementById('roll-ball');
  const returned=document.getElementById('return-ball');

  function showStatus(message=''){
    statusUntil=message?performance.now()+4000:0;
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
    const growth=model.growth(dog);
    if(!appliedGrowth||Math.abs(growth.size-appliedGrowth.size)>=.025||Math.abs(growth.width-appliedGrowth.width)>=.025){
      scene.setProportions(growth.size,growth.width);
      appliedGrowth={size:growth.size,width:growth.width};
    }
    if(growthStatus&&growthStatus.textContent!==growth.label)growthStatus.textContent=growth.label;
  }

  function act(kind){
    if(!dog||!scene?.ready||isSelecting())return;
    if(!scene.canPerformCare){
      showStatus('等它做完这个动作。');
      return;
    }
    const passingBack=kind==='ball'&&scene.ballWaiting;
    const accepted=kind==='ball'?model.play(dog)||passingBack:model.feed(dog,kind);
    if(!accepted){
      showStatus(kind==='ball'
        ?'让它歇一会儿，再滚球。'
        :kind==='meal'?'它还不饿，先留着狗粮吧。':'它肚子挺饱，待会儿再给零食吧。');
      return;
    }
    scene.performCare(kind);
    wasWaiting=false;ball.textContent='滚球';
    showStatus(passingBack?'球又滚向它的前爪。':messages[kind]);
    render();
  }

  for(const [id,kind] of [['feed-treat','treat'],['feed-meal','meal'],['roll-ball','ball']]){
    document.getElementById(id).addEventListener('click',()=>act(kind));
  }

  returned?.addEventListener('click',()=>{
    if(scene.ballWaiting){
      act('ball');
      if(document.activeElement===returned||document.activeElement===document.body)ball.focus?.({preventScroll:true});
    }
  });

  function flushPet(){
    if(!dog)return;
    const seconds=scene.takeCareTime();
    if(seconds>0)model.pet(dog,seconds);
  }

  return {
    flushPet,
    selectDog(id){
      dog=id;wasWaiting=false;ball.textContent='滚球';
      showStatus();
      render();
    },
    update(now){
      if(!dog||now<nextUpdate)return;
      nextUpdate=now+240;
      if(scene.ballWaiting&&!wasWaiting){
        ball.textContent='滚回去';
        showStatus('它把球拨回来了。点球可以再滚一次。');
      }else if(statusUntil&&now>=statusUntil)showStatus();
      wasWaiting=Boolean(scene.ballWaiting);
      const previous=model.get(dog).affection;
      flushPet();
      const current=model.get(dog);
      if(previous<25&&current.affection>=25)showStatus('它已经熟悉你的手了。');
      if(previous<65&&current.affection>=65)showStatus('它现在更容易摇尾巴了。');
      if(!model.canSave&&status.textContent===saveHint)showStatus();
      render(current);
    }
  };
}
