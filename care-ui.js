import {DogCare} from './care.js?v=rana-bichon-5';

import {bindHandPlay} from './hand-play.js?v=cup-play-19';
import {bindCupGame} from './cup-game.js?v=cup-play-19';

const messages={
  treat:'它嗅了嗅，把零食吃掉了。',
  meal:'它低下头，开始吃狗粮。',
  ball:'它顺着滚球的方向抬起了头。'
};
const saveHint='进度会自动保存在这个浏览器。';
const saveUnavailable='当前浏览器暂时无法存档。';

export function bindCare({scene,isSelecting=()=>false,feedback=()=>{}}){
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
  let passes=0,impact=false,input='';
  const play=bindHandPlay({scene,finish:act,feedback:(beat,source)=>{input=source;feedback(beat,input);}});

  const cups=bindCupGame({scene,feedback,onWin(count){
    model.play(dog);render();showStatus('你和它一起找到了 '+count+' 次球。');
  }});
  function stopPlay(){cups.stop();play.stop();play.clearResult();}

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

  function act(kind,origin=null){
    if(!dog||!scene?.ready||isSelecting())return;
    if(!scene.canPerformCare){
      showStatus('等它做完这个动作。');
      return;
    }
    if(kind==='ball')model.play(dog);
    if(kind!=='ball'&&!model.feed(dog,kind)){
      showStatus(kind==='meal'?'它还不饿，先留着狗粮吧。':'它肚子挺饱，待会儿再给零食吧。');
      return;
    }
    scene.performCare(kind,origin);impact=false;
    if(kind==='ball')passes++;
    wasWaiting=false;ball.textContent='推球玩';
    showStatus(messages[kind]);
    render();
  }

  for(const [id,kind] of [['feed-treat','treat'],['feed-meal','meal'],['roll-ball','ball'],['find-ball','cups']]){
    document.getElementById(id).addEventListener('click',()=>{
      if(!dog||!scene.ready||isSelecting())return;
      if(!scene.canPerformCare){showStatus('等它做完这个动作。');return;}
      stopPlay();
      if(kind==='cups'){
        if(cups.start())scene.stage.scrollIntoView({block:'nearest'});
        return;
      }
      if(kind==='meal'){act(kind);return;}
      if(kind==='treat'&&model.get(dog).fullness>83){
        showStatus('它肚子挺饱，待会儿再给零食吧。');return;
      }
      input='';
      if(play.start(kind)){
        scene.stage.scrollIntoView({block:'nearest'});
        scene.stage.querySelector('#play-grip').focus({preventScroll:true});
      }
    });
  }

  function flushPet(){
    if(!dog)return;
    const seconds=scene.takeCareTime();
    if(seconds>0)model.pet(dog,seconds);
  }

  return {
    flushPet,stopPlay,get playing(){return cups.active||play.active;},
    selectDog(id){
      play.clearResult();dog=id;passes=0;impact=false;wasWaiting=false;ball.textContent='推球玩';
      showStatus();
      render();
    },
    update(now){
      if(cups.active)cups.update(now);else play.update(now);
      if(scene.action&&!impact&&((scene.action.kind==='ball'&&scene.action.time>=1.06)||(scene.action.kind==='treat'&&scene.action.time>=.67))){
        impact=true;
        const caught=scene.action.kind==='ball';
        play.result(caught?'接住了 · 第 '+passes+' 次':'咔嚓，吃到了',now);
        feedback(caught?'catch':'bite',input);
      }
      if(!dog||now<nextUpdate)return;
      nextUpdate=now+240;
      if(scene.ballWaiting&&!wasWaiting){
        ball.textContent='再推一次';
        showStatus('它把球拨回来了。已接 '+passes+' 次，按住球可以继续。');
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
