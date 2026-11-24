// The button stays with its cup throughout a shuffle. Slots describe positions
// on the rug, so hit testing, the dog's gaze and the ball use the same layout.
const slots=[.18,.50,.82],names=['左边','中间','右边'];
const markings=['一颗点','两颗点','三颗点'];
const floor=.83;
export function bindCupGame({scene,onWin,feedback}){
  const stage=scene.stage,board=stage.querySelector('#cup-board');
  const cups=[...board.querySelectorAll('.cup')];
  const action=board.querySelector('#cup-action');
  const prompt=stage.querySelector('#play-prompt'),exit=stage.querySelector('#put-away');
  const launch=document.querySelector('#find-ball');
  let phase='',elapsed=0,last=0,rounds=0,hidden=0,order=[],pair=[],steps=0;
  let revealed=new Set(),clue=false,restoreBall=false;
  let peek=null,ignoreClick=-1;
  const cue=text=>{if(prompt.textContent!==text)prompt.textContent=text;};
  function position(id,x,y=floor){
    cups[id].style.left=x*100+'%';cups[id].style.top=y*100+'%';
    if(id===hidden&&phase!=='choose')scene.playTarget=scene.textureCoords(x,y);
  }
  function setPhase(next){
    phase=next;board.dataset.phase=phase;elapsed=0;
    for(const [id,cup] of cups.entries()){
      cup.disabled=phase!=='choose'||revealed.has(id);
      cup.setAttribute('aria-label',names[order.indexOf(id)]+'的杯子，'+markings[id]);
    }
    action.hidden=phase!=='choose'&&phase!=='won';
  }
  function start(){
    if(!scene.ready||!scene.canPerformCare||!scene.pose||stage.hasAttribute('aria-busy'))return false;
    if(!phase){restoreBall=scene.ballWaiting;rounds=0;}
    scene.leave();scene.cupJoy=0;scene.cupDirection=0;scene.playSniff=0;clue=false;
    scene.prop.dataset.visible='false';scene.catchBall.hidden=true;
    order=[0,1,2];hidden=Math.floor(Math.random()*3);steps=1+Math.min(2,rounds);revealed=new Set();
    stage.dataset.play='cups';board.hidden=false;exit.hidden=false;prompt.hidden=false;
    setPhase('show');last=performance.now();action.textContent='求提示';
    for(const [id,cup] of cups.entries()){
      cup.dataset.ball=String(id===hidden);cup.dataset.lift=String(id===hidden);
      position(id,slots[id]);
    }
    cue('看好小球藏在哪只杯子下');exit.focus({preventScroll:true});return true;
  }
  function stop(){
    if(!phase)return;
    releasePeek();ignoreClick=-1;phase='';board.hidden=true;prompt.hidden=true;exit.hidden=true;delete stage.dataset.play;
    scene.playTarget=null;scene.playSniff=0;scene.cupDirection=0;scene.cupJoy=0;
    if(restoreBall&&scene.ballWaiting){
      scene.prop.dataset.kind='ball';scene.prop.dataset.visible='true';
      scene.renderProp(2.55,'ball');scene.catchBall.hidden=false;
    }
  }
  function shuffle(){
    // Always move the loaded cup, sometimes across both of its neighbours.
    const a=order.indexOf(hidden),b=(a+1+Math.floor(Math.random()*2))%3;
    pair=[a,b];setPhase('shuffle');
  }
  function look(){
    const slot=order.indexOf(hidden),x=slots[slot];
    scene.playTarget=scene.textureCoords(x,floor);
    scene.cupDirection=slot-1;
    scene.playSniff=.48;
  }
  function showClue(){
    if(phase!=='choose')return;
    clue=true;look();
    cue('它低头闻了闻'+names[order.indexOf(hidden)]+'那只杯子');
  }
  function pick(id,e){
    if(phase!=='choose'||revealed.has(id))return;
    revealed.add(id);cups[id].dataset.lift='true';cups[id].disabled=true;
    if(id===hidden){
      rounds++;setPhase('won');look();scene.playSniff=0;scene.cupJoy=1;
      cue('找到啦！一起找到了 '+rounds+' 次');action.textContent='再藏一次';
      feedback('catch',e.pointerType||'keyboard');onWin(rounds);action.focus({preventScroll:true});
    }else{
      cue('这只是空的，再看看它往哪儿闻');look();feedback('pickup',e.pointerType||'keyboard');
      if(e.detail===0)cups[order.find(i=>!revealed.has(i))].focus({preventScroll:true});
    }
  }
  function update(now){
    if(!phase)return;
    elapsed+=Math.min(Math.max(now-last,0),80);last=now;
    if(phase==='show'&&elapsed>=1000){
      cups[hidden].dataset.lift='false';setPhase('cover');
    }else if(phase==='cover'&&elapsed>=340){
      cue('看好杯子，马上换位置');shuffle();
    }else if(phase==='shuffle'){
      const t=Math.min(elapsed/740,1),mix=scene.reduce.matches?Number(t>=1):t*t*(3-2*t);
      const [a,b]=pair,arc=scene.reduce.matches?0:.085*Math.sin(Math.PI*t);
      for(const [from,to,sign] of [[a,b,-1],[b,a,1]]){
        position(order[from],slots[from]+(slots[to]-slots[from])*mix,floor+sign*arc);
      }
      if(t===1){
        [order[a],order[b]]=[order[b],order[a]];
        if(--steps>0)shuffle();
        else{setPhase('choose');scene.playTarget=null;cue('往上掀，或点一只杯子');}
      }
    }else if(phase==='choose'&&elapsed>1450){
      look();
      if(!clue)scene.playSniff=.72*Math.max(0,Math.sin(elapsed/300));
    }else if(phase==='won'){
      scene.cupJoy=Math.max(0,1-elapsed/1600);
    }
  }
  function releasePeek(){
    if(!peek)return;
    const {cup,pointer}=peek;peek=null;
    delete cup.dataset.peek;
    if(cup.hasPointerCapture(pointer))cup.releasePointerCapture(pointer);
  }
  cups.forEach((cup,id)=>{
    cup.addEventListener('pointerdown',e=>{
      if(phase!=='choose'||revealed.has(id)||peek||!e.isPrimary||e.button!==0)return;
      ignoreClick=-1;
      peek={cup,pointer:e.pointerId,x:e.clientX,y:e.clientY,maxTravel:0};
      cup.setPointerCapture(e.pointerId);
    });
    cup.addEventListener('pointermove',e=>{
      if(peek?.pointer!==e.pointerId||peek.cup!==cup)return;
      const dy=peek.y-e.clientY;
      peek.maxTravel=Math.max(peek.maxTravel,Math.hypot(e.clientX-peek.x,dy));
      if(peek.maxTravel<5)return;
      const lift=Math.max(0,Math.min(1,dy/(cup.offsetHeight*.75)));
      cup.style.setProperty('--peek-y',(-75*lift)+'%');
      cup.style.setProperty('--peek-angle',(12*lift)+'deg');
      cup.dataset.peek='true';
    });
    cup.addEventListener('pointerup',e=>{
      if(peek?.pointer!==e.pointerId||peek.cup!==cup)return;
      const up=peek.y-e.clientY,moved=peek.maxTravel>=5||Math.abs(up)>=5;
      releasePeek();
      if(!moved)return;
      ignoreClick=id;
      if(up>=cup.offsetHeight*.4)pick(id,e);
    });
    function cancelPeek(e){
      if(peek?.pointer!==e.pointerId||peek.cup!==cup)return;
      ignoreClick=id;releasePeek();
    }
    cup.addEventListener('lostpointercapture',cancelPeek);
    cup.addEventListener('pointercancel',cancelPeek);
    cup.addEventListener('click',e=>{
      if(e.detail&&ignoreClick===id){ignoreClick=-1;return;}
      pick(id,e);
    });
  });
  action.addEventListener('click',()=>phase==='won'?start():showClue());
  exit.addEventListener('click',()=>{if(phase){stop();launch.focus({preventScroll:true});}});
  stage.addEventListener('keydown',e=>{if(phase&&e.key==='Escape'){e.preventDefault();stop();launch.focus({preventScroll:true});}});
  window.addEventListener('blur',stop);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  return {start,stop,update,get active(){return Boolean(phase);}};
}
