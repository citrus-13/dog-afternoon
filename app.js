import {DogScene} from './scene.js?v=hand-play-18';
import {DogSound} from './sound.js?v=hand-play-18';
import {bindCare} from './care-ui.js?v=hand-play-18';
import {bindHaptics} from './haptics.js?v=hand-play-18';

const $=s=>document.querySelector(s);
const stage=$('#stage'),viewer=$('#viewer'),notice=$('#notice');
const soundButton=$('#sound'),expand=$('#expand'),ambientPhase=$('#ambient-phase'),ambientTime=$('#ambient-time');
const touchFeedback=$('#touch-feedback');
const buttons=[...document.querySelectorAll('[data-dog]')];
const names={sheepdog:'Rana · 古牧',cockapoo:'可卡布',golden:'金毛',shiba:'黑柴',samoyed:'萨摩耶',bichon:'比熊',bernese:'伯恩山'},images=new Map();
const sound=new DogSound();
const haptics=bindHaptics($('#haptics'));
const heldKeys=new Map();
const touchLabels={head:'额头',ear:'耳朵',chin:'下巴',nose:'鼻尖',paw:'前爪',chest:'胸口',side:'身侧',back:'背部',tail:'尾巴'};
const touchResponses={
  head:{'fur-press':'毛毛轻轻压下','head-soften':'眯了眯眼睛'},
  ear:{ear:'耳尖动了动','ear-fold':'耳尖轻轻折下'},
  chin:{chin:'仰起脸，把下巴送到手边'},
  nose:{sniff:'缩了缩鼻子，又凑过来闻'},
  paw:{paw:'把碰到的那只前爪收回来'},
  chest:{chest:'缓缓起伏'},
  side:{side:'身体向手边靠'},
  back:{back:'毛毛顺着手伏下',blink:'慢慢眨了眨眼',settle:'顺毛后安静下来'},
  tail:{'tail-straight':'顺着手舒展开','tail-curl':'往里轻轻卷起来',tail:'轻摆一下'},
};
let feedbackKey='',feedbackUntil=0,feedbackVisible=false;
let scene,wanted='sheepdog',ticket=0,pointerId=null,key=null,loop=null,ambientTimer=null,active=true,expandedFallback=false;
try{scene=new DogScene($('#scene'),stage,$('#hand'));}catch(error){$('#loading').textContent='画面暂时无法启动';$('#retry').hidden=false;console.error(error);}
const announce=text=>{notice.textContent=text;};
const care=scene?bindCare({scene,feedback:(beat,input)=>{haptics.play(beat,input);sound.playBeat(beat);},isSelecting:()=>stage.hasAttribute('aria-busy')}):null;
function localDaypart(hour){return hour<6||hour>=20?'night':hour<8?'dawn':hour<17?'day':'dusk';}
function updateAmbient(){
  const now=new Date(),hour=now.getHours(),phase=localDaypart(hour);
  const time=String(hour).padStart(2,'0')+':'+String(now.getMinutes()).padStart(2,'0');
  document.documentElement.dataset.daypart=phase;
  document.documentElement.dataset.theme=phase==='night'?'dark':'light';
  ambientPhase.textContent={dawn:'清晨',day:'白天',dusk:'傍晚',night:'夜间'}[phase];
  ambientTime.textContent=time;ambientTime.dateTime=time;
  document.querySelector('meta[name="theme-color"]').content=phase==='night'?'#111d1a':'#f4efe6';
  clearTimeout(ambientTimer);ambientTimer=null;
  if(!document.hidden)ambientTimer=setTimeout(updateAmbient,60000-now.getSeconds()*1000-now.getMilliseconds()+20);
}
updateAmbient();
function showTouchFeedback(visible){
  if(feedbackVisible===visible)return;
  feedbackVisible=visible;touchFeedback.dataset.visible=String(visible);
  touchFeedback.setAttribute('aria-hidden',String(!visible));
}
function resetTouchFeedback(){feedbackKey='';feedbackUntil=0;showTouchFeedback(false);}
function touchCaption(zone,behavior){
  const responses=touchResponses[zone];
  if(behavior==='look-back')return touchLabels[zone]+' · 偏过头来找你的手';
  if(behavior==='exhale')return touchLabels[zone]+' · 呼了口气，肩膀落下来';
  if(behavior==='nuzzle')return touchLabels[zone]+' · 伸了伸脖子，往手边蹭';
  if(behavior==='touch')return touchLabels[zone]+' · 轻触了一下';
  if(behavior==='brush')return touchLabels[zone]+' · 顺着手轻轻动';
  if(!Object.hasOwn(responses,behavior))return touchLabels[zone];
  const response=zone==='tail'&&stage.dataset.contact==='false'?'松手后慢慢收回':responses[behavior];
  return touchLabels[zone]+' · '+response;
}
function updateTouchFeedback(now){
  const zone=stage.dataset.touchZone;
  if(!Object.hasOwn(touchLabels,zone)){resetTouchFeedback();return;}
  const paw=zone==='paw'&&['1','2'].includes(stage.dataset.touchPaw)?stage.dataset.touchPaw:'';
  const behavior=stage.dataset.behavior||'';
  const tailContact=zone==='tail'&&stage.dataset.contact==='false'?'released':'';
  const next=zone+':'+paw+':'+behavior+':'+tailContact;
  if(next!==feedbackKey){
    feedbackKey=next;feedbackUntil=now+2800;
    const caption=touchCaption(zone,behavior);
    if(touchFeedback.textContent!==caption)touchFeedback.textContent=caption;
  }
  showTouchFeedback(now<feedbackUntil);
}
async function choose(id){
  if(!scene||!Object.hasOwn(names,id))return;
  if(scene.ready&&stage.dataset.selected===id&&wanted===id&&!stage.dataset.loadError)return;
  care?.stopPlay();clearInput();delete stage.dataset.loadError;
  wanted=id;const current=++ticket;stage.setAttribute('aria-busy','true');$('#retry').hidden=true;
  try{
    let img=images.get(id);
    if(!img){
      const artwork=id==='sheepdog'?'rana':id;
      img=await scene.load(`./assets/${artwork}.webp`);
      images.set(id,img);
    }
    if(current!==ticket)return;
    care?.flushPet();
    scene.setImage(img,id);resetTouchFeedback();care?.selectDog(id);stage.dataset.ready='true';stage.dataset.selected=id;stage.setAttribute('aria-label',`抚摸${names[id]}`);
    for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.dog===id));
    try{localStorage.setItem('pet-the-dog.selected',id);}catch{}
    const url=new URL(location.href);
    if(url.searchParams.get('dog')!==id){
      url.searchParams.set('dog',id);
      try{history.replaceState(history.state,'',url);}catch{}
    }
    announce(`已选择${names[id]}`);
  }catch(error){if(current!==ticket)return;stage.dataset.loadError='true';$('#loading').textContent='狗狗没有加载好';$('#retry').hidden=false;announce('加载失败，请重试');console.error(error);}
  finally{if(current===ticket)stage.removeAttribute('aria-busy');}
}
for(const b of buttons)b.addEventListener('click',()=>choose(b.dataset.dog));
$('#retry').addEventListener('click',()=>scene&&!scene.contextLost?choose(wanted):location.reload());
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&expandedFallback)setFallback(false);});
soundButton.addEventListener('click',async()=>{soundButton.disabled=true;try{const enabled=await sound.setEnabled(soundButton.getAttribute('aria-checked')!=='true');soundButton.setAttribute('aria-checked',String(enabled));announce(enabled?'已开启呼吸和抚摸声音':'已关闭声音');}catch(error){soundButton.setAttribute('aria-checked','false');announce('当前浏览器暂时不能播放声音');console.error(error);}finally{soundButton.disabled=false;}});
function syncExpanded(){const expanded=Boolean(document.fullscreenElement)||expandedFallback;expand.setAttribute('aria-pressed',String(expanded));expand.setAttribute('aria-label',expanded?'退出全屏':'全屏显示');expand.querySelector('use').setAttribute('href',expanded?'#exit':'#full');}
function setFallback(value){expandedFallback=value;viewer.classList.toggle('is-expanded',value);document.body.classList.toggle('expanded',value);syncExpanded();}
expand.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(expandedFallback)setFallback(false);else if(viewer.requestFullscreen)await viewer.requestFullscreen();else setFallback(true);}catch{setFallback(!expandedFallback);}syncExpanded();});
document.addEventListener('fullscreenchange',syncExpanded);
function pointerPosition(event){
  const rect=stage.getBoundingClientRect();
  return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
}
function pointerPressure(event){
  const pressure=event.pressure;
  if(!Number.isFinite(pressure)||pressure<=0||pressure>1)return undefined;
  if(event.pointerType==='pen')return pressure;
  // Leave the synthetic touch default to the hold-time response.
  if(event.pointerType==='touch'&&pressure!==.5)return pressure;
  return undefined;
}
function clearKeys(){heldKeys.clear();key=null;}
function clearInput(){
  clearKeys();
  const captured=pointerId;pointerId=null;
  if(captured!==null){try{if(stage.hasPointerCapture?.(captured))stage.releasePointerCapture?.(captured);}catch{}}
  haptics.cancel();scene?.leave();resetTouchFeedback();
}
stage.addEventListener('pointerdown',e=>{
  if(!scene||care?.playing||stage.hasAttribute?.('aria-busy')||e.target.closest('button')||e.isPrimary===false||pointerId!==null)return;
  if(e.pointerType!=='touch'&&e.button!==0)return;
  clearKeys();scene.leave();pointerId=e.pointerId;stage.dataset.input=e.pointerType;
  const p=pointerPosition(e);scene.press(p.x,p.y,pointerPressure(e));haptics.press(e,scene);e.preventDefault();
  try{stage.setPointerCapture?.(e.pointerId);}catch{}
  if(e.pointerType!=='touch')stage.focus?.({preventScroll:true});
});
stage.addEventListener('pointermove',e=>{
  if(!scene||care?.playing||key||e.target.closest('button'))return;
  if(pointerId!==null?e.pointerId!==pointerId:e.pointerType!=='mouse')return;
  // Preserve direction changes in a short mobile rub even when the browser
  // delivers several samples together. Bound the work on high-rate pens.
  if(pointerId===null)stage.dataset.input=e.pointerType;
  const samples=pointerId!==null?e.getCoalescedEvents?.():null;
  if(samples?.length>1){
    const stride=Math.ceil(samples.length/6);
    for(let i=0;i<samples.length-1;i+=stride){
      const sample=samples[i],p=pointerPosition(sample);
      scene.point(p.x,p.y,pointerPressure(sample));
    }
  }
  const p=pointerPosition(e);scene.point(p.x,p.y,pointerPressure(e));haptics.point(e,scene);
});
function endPointer(e){if(e.pointerId===pointerId){pointerId=null;haptics.end(e,scene);scene?.leave();}}
stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);stage.addEventListener('lostpointercapture',endPointer);
window.addEventListener('pointerup',endPointer);window.addEventListener('pointercancel',endPointer);
stage.addEventListener('pointerleave',()=>{if(pointerId===null&&!key)scene?.leave();});
function keyGesture(event){return {' ':'back',Enter:'back',h:'head',e:'ear',j:'chin',n:'nose',p:'paw',c:'chest',s:'side',t:'tail'}[event.key==='Enter'?'Enter':event.key.toLowerCase()];}
function startKey(next){
  key=next;scene.leave();if(key)stage.dataset.input='keyboard';
  if(!key)return;
  const p=scene.gesturePoint(key.type,(performance.now()-key.start)/1000,key.other);
  scene.press(p.x,p.y,undefined,key.tailDirection);
}
stage.addEventListener('keydown',e=>{
  if(e.target!==stage||!scene||care?.playing||e.altKey||e.ctrlKey||e.metaKey)return;
  const type=keyGesture(e);if(!type)return;
  e.preventDefault();if(e.repeat||pointerId!==null)return;
  const id=e.code||e.key.toLowerCase();
  if(heldKeys.has(id))return;
  const next={id,type,other:e.shiftKey&&(type==='ear'||type==='paw'),start:performance.now(),tailDirection:type==='tail'?(e.shiftKey?-1:1):0};
  heldKeys.set(id,next);startKey(next);
  announce({head:'正在轻轻摸额头',ear:'正在轻挠耳朵',chin:'正在轻挠下巴',nose:'正在轻碰鼻尖',paw:'正在轻碰前爪',chest:'正在轻抚胸口',side:'正在轻抚身侧',back:'正在慢慢顺背毛',tail:'正在顺着尾巴轻轻抚摸'}[type]);
});
stage.addEventListener('keyup',e=>{
  const id=e.code||e.key.toLowerCase();
  if(!heldKeys.has(id))return;
  e.preventDefault();heldKeys.delete(id);
  if(key?.id===id)startKey([...heldKeys.values()].at(-1)||null);
});
stage.addEventListener('blur',clearInput);
window.addEventListener('blur',clearInput);
function frame(now){
  if(active&&scene){
    if(key&&!care?.playing){const p=scene.gesturePoint(key.type,(now-key.start)/1000,key.other);scene.point(p.x,p.y);}
    scene.frame(now);updateTouchFeedback(now);care?.update(now);sound.update(scene.pet,scene.speed,now/1000,{zone:scene.zone,pressure:scene.contactForce,tap:scene.pat,breathPhase:scene.breathPhase,exhale:scene.exhale,sniff:scene.sniffBreath});
  }
  loop=requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{active=!document.hidden;updateAmbient();if(!active){care?.flushPet();clearInput();cancelAnimationFrame(loop);}else loop=requestAnimationFrame(frame);});
window.addEventListener('pagehide',e=>{active=false;clearTimeout(ambientTimer);ambientTimer=null;clearInput();cancelAnimationFrame(loop);if(!e.persisted){sound.destroy();scene?.destroy();}});
window.addEventListener('pageshow',e=>{updateAmbient();if(e.persisted){active=true;scene?.resize();cancelAnimationFrame(loop);loop=requestAnimationFrame(frame);}});
if(scene){
  const requested=new URLSearchParams(location.search).get('dog');
  let saved;
  try{saved=localStorage.getItem('pet-the-dog.selected');}catch{}
  choose(Object.hasOwn(names,requested)?requested:Object.hasOwn(names,saved)?saved:'sheepdog');
  loop=requestAnimationFrame(frame);
}
