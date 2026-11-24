// All stage coordinates are fractions so a grip survives rotation and resize.
const clamp=(v,lo,hi)=>Math.max(lo,Math.min(hi,v));
export function bindHandPlay({scene,finish,feedback}){
  const stage=scene.stage,grip=stage.querySelector('#play-grip'),aim=stage.querySelector('#play-aim');
  const hint=stage.querySelector('#play-prompt'),exit=stage.querySelector('#put-away');
  const returned=stage.querySelector('#return-ball');
  let kind=null,point=null,destination=null,drag=null,since=null,aimed=false,hadBall=false;
  let lastText='',sniffing=false,resultUntil=0;
  const setText=text=>{if(text!==lastText){hint.textContent=text;lastText=text;}};
  const place=(el,p)=>{el.style.left=p.x*100+'%';el.style.top=p.y*100+'%';};
  const screen=e=>{
    const r=stage.getBoundingClientRect();
    return {x:clamp((e.clientX-r.left)/r.width,.025,.975),y:clamp((e.clientY-r.top)/r.height,.04,.96)};
  };
  const distance=(a,b)=>Math.hypot((a.x-b.x)*scene.width,(a.y-b.y)*scene.height);
  function move(p){
    point=p;place(grip,p);place(scene.prop,p);
    scene.playTarget=scene.textureCoords(p.x,p.y);
  }
  function dropCapture(){
    const id=drag?.id;drag=null;
    if(id!=null&&stage.hasPointerCapture?.(id))stage.releasePointerCapture(id);
  }
  function stop(restore=true){
    if(!kind)return;
    kind=null;dropCapture();since=null;aimed=false;sniffing=false;lastText='';
    scene.playTarget=null;scene.playSniff=0;delete stage.dataset.play;
    delete aim.dataset.near;aim.style.removeProperty('--sniff');
    for(const el of [grip,aim,hint,exit])el.hidden=true;
    scene.prop.dataset.visible='false';
    if(restore&&hadBall&&scene.ballWaiting){scene.prop.dataset.kind='ball';scene.prop.dataset.visible='true';scene.renderProp(2.55,'ball');returned.hidden=false;}
  }
  function target(){
    const region=kind==='treat'?scene.rig.touch.nose:scene.rig.paws[scene.playPaw];
    const p=scene.deform(region[0],region[1],scene.pose);
    return {x:p.x/scene.width,y:p.y/scene.height};
  }
  function clearResult(){
    resultUntil=0;
    if(!kind){hint.hidden=true;lastText='';}
  }
  function result(text,now){
    if(kind)return;
    setText(text);hint.hidden=false;resultUntil=now+1300;
  }
  function start(type){
    if(!scene.canPerformCare||!scene.pose||stage.hasAttribute('aria-busy'))return false;
    stop();clearResult();scene.leave();kind=type;hadBall=scene.ballWaiting;
    const home=kind==='ball'?scene.stageCoords(.84,.93):{x:.78,y:.64};
    stage.dataset.play=kind;returned.hidden=true;
    for(const el of [grip,aim,hint,exit])el.hidden=false;
    const treat=kind==='treat';
    grip.setAttribute('aria-label',treat?'拿起零食':'拿起球');
    aim.setAttribute('aria-label',treat?'把零食送到鼻尖':'把球推向前爪');
    setText(treat?'把零食拖到鼻尖，停一下':'把球朝前爪推，再松手');
    scene.prop.dataset.kind=kind;scene.prop.dataset.visible='true';
    scene.prop.style.opacity='1';scene.prop.style.setProperty('--prop-scale','1');scene.prop.style.setProperty('--prop-turn','0deg');
    move(home);destination=target();place(aim,destination);
    return true;
  }
  function deliver(){
    const mode=kind,origin=scene.textureCoords(point.x,point.y);
    stop();finish(mode,origin);
  }
  function tryBall(e){
    const start=drag.start,goal=destination;
    const dx=(point.x-start.x)*scene.width,dy=(point.y-start.y)*scene.height;
    const gx=(goal.x-start.x)*scene.width,gy=(goal.y-start.y)*scene.height;
    const len=Math.hypot(dx,dy),toward=(dx*gx+dy*gy)/Math.max(1,len);
    const miss=Math.abs(dx*gy-dy*gx)/Math.max(1,len);
    return distance(point,goal)<32||(len>=26&&toward>0&&miss<Math.max(28,.08*scene.width)
      &&len/Math.max(1,e.timeStamp-drag.time)>.18);
  }
  function take(e){
    if(e.isPrimary===false||e.button!==0||drag)return;
    if(!kind&&e.currentTarget===returned&&!start('ball'))return;
    if(!kind)return;
    e.preventDefault();e.stopPropagation();
    aimed=false;since=null;
    drag={id:e.pointerId,start:{...point},time:e.timeStamp,offset:{x:point.x-screen(e).x,y:point.y-screen(e).y}};
    stage.setPointerCapture(e.pointerId);
    feedback('pickup',e.pointerType);
  }
  function slide(e){
    if(e.pointerId!==drag?.id)return;
    const p=screen(e);move({x:clamp(p.x+drag.offset.x,.025,.975),y:clamp(p.y+drag.offset.y,.04,.96)});
  }
  function release(e){
    if(e.pointerId!==drag?.id)return;
    slide(e);
    if(kind==='ball'){
      if(tryBall(e)){deliver();return;}
      if(distance(point,drag.start)>8)setText('再试一次，朝亮圈推球');
    }else if(distance(point,destination)<32){aimed=true;}
    dropCapture();
  }
  function update(now){
    if(resultUntil&&now>=resultUntil)clearResult();
    if(!kind||!scene.pose)return;
    destination=target();place(aim,destination);
    const near=distance(point,destination)<Math.max(30,Math.min(48,scene.width*.065));
    if(kind==='ball'){aim.dataset.near=String(near);return;}
    if(aimed)move(destination);
    if(near&&(drag||aimed)){
      if(since===null){since=now;setText('它在闻，等它张口');}
      const amount=clamp((now-since)/520,0,1);
      aim.style.setProperty('--sniff',amount+'turn');aim.dataset.near='true';
      scene.playSniff=Math.sin(amount*Math.PI*2)**2;
      sniffing=true;
      if(amount===1)deliver();
    }else if(sniffing){
      since=null;sniffing=false;scene.playSniff=0;aim.dataset.near='false';aim.style.setProperty('--sniff','0turn');
      setText('再靠近鼻尖一点');
    }
  }
  grip.addEventListener('pointerdown',take);returned.addEventListener('pointerdown',take);
  stage.addEventListener('pointermove',slide);stage.addEventListener('pointerup',release);
  const cancel=e=>{if(e.pointerId===drag?.id)stop();};
  stage.addEventListener('pointercancel',cancel);stage.addEventListener('lostpointercapture',cancel);
  function assist(e){
    if(!kind||drag)return;
    feedback('pickup',e?.pointerType||'keyboard');
    if(kind==='ball'){deliver();return;}
    aimed=true;move(destination);
  }
  aim.addEventListener('click',assist);
  grip.addEventListener('click',e=>{if(!e.detail)assist(e);});
  returned.addEventListener('click',()=>{if(!kind&&scene.ballWaiting){start('ball');}});
  exit.addEventListener('click',()=>stop());
  stage.addEventListener('keydown',e=>{if(kind&&e.key==='Escape'){e.preventDefault();stop();}});
  window.addEventListener('blur',()=>stop());
  document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
  return {start,stop,update,result,clearResult,get active(){return kind;}};
}
