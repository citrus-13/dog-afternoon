import {DogScene} from './scene.js?v=natural-touch-1';
import {DogSound} from './sound.js';

const $=s=>document.querySelector(s);
const stage=$('#stage'),viewer=$('#viewer'),notice=$('#notice');
const theme=$('#theme'),soundButton=$('#sound'),expand=$('#expand'),panel=$('#proportions-panel'),adjust=$('#proportions-toggle');
const size=$('#dog-size'),width=$('#dog-width'),buttons=[...document.querySelectorAll('[data-dog]')];
const names={sheepdog:'灰白狗狗',cockapoo:'可卡布',golden:'金毛',shiba:'黑柴',samoyed:'萨摩耶'},images=new Map();
const sound=new DogSound();
let scene,selection='sheepdog',wanted='sheepdog',ticket=0,pointerId=null,key=null,loop=null,active=true,expandedFallback=false;
try{scene=new DogScene($('#scene'),stage,$('#hand'));}catch(error){$('#loading').textContent='画面暂时无法启动';$('#retry').hidden=false;console.error(error);}
const announce=text=>{notice.textContent=text;};
function save(key,value){try{localStorage.setItem('pet-the-dog.'+key,JSON.stringify(value));}catch{}}
function read(key,fallback){try{return JSON.parse(localStorage.getItem('pet-the-dog.'+key))??fallback;}catch{return fallback;}}
function setTheme(){const dark=document.documentElement.dataset.theme==='dark';theme.setAttribute('aria-checked',String(dark));document.querySelector('meta[name="theme-color"]').content=dark?'#111d1a':'#eef2e9';}
setTheme();
theme.addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=next;try{localStorage.setItem('pet-the-dog.theme',next);}catch{}const url=new URL(location.href);if(url.searchParams.has('theme')){url.searchParams.set('theme',next);try{history.replaceState(null,'',url);}catch{}}setTheme();});
async function choose(id){
  if(!scene||!names[id])return;
  wanted=id;const current=++ticket;stage.setAttribute('aria-busy','true');$('#retry').hidden=true;
  try{
    let img=images.get(id);if(!img){img=await scene.load(`./assets/${id}.webp`);images.set(id,img);}
    if(current!==ticket)return;
    selection=id;scene.setImage(img,id);stage.dataset.ready='true';stage.dataset.selected=id;stage.setAttribute('aria-label',`抚摸${names[id]}`);
    for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.dog===id));
    announce(`已选择${names[id]}`);
  }catch(error){if(current!==ticket)return;$('#loading').textContent='狗狗没有加载好';$('#retry').hidden=false;announce('加载失败，请重试');console.error(error);}
  finally{if(current===ticket)stage.removeAttribute('aria-busy');}
}
for(const b of buttons)b.addEventListener('click',()=>choose(b.dataset.dog));
$('#retry').addEventListener('click',()=>scene&&!scene.contextLost?choose(wanted):location.reload());
function updateSize(){if(!scene)return;scene.setProportions(size.value,width.value);save('proportions',{size:Number(size.value),width:Number(width.value)});}
const stored=read('proportions',{size:5,width:5});
size.value=String(Math.max(0,Math.min(10,Number(stored.size)||0)));width.value=String(Math.max(0,Math.min(10,Number(stored.width)||0)));updateSize();
size.addEventListener('input',updateSize);width.addEventListener('input',updateSize);
function closePanel(){panel.hidden=true;adjust.setAttribute('aria-expanded','false');}
adjust.addEventListener('click',()=>{panel.hidden=!panel.hidden;adjust.setAttribute('aria-expanded',String(!panel.hidden));});
document.addEventListener('pointerdown',e=>{if(!panel.contains(e.target)&&!adjust.contains(e.target))closePanel();});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){closePanel();if(expandedFallback)setFallback(false);}});
soundButton.addEventListener('click',async()=>{soundButton.disabled=true;try{const enabled=await sound.setEnabled(soundButton.getAttribute('aria-checked')!=='true');soundButton.setAttribute('aria-checked',String(enabled));announce(enabled?'已开启合成呼吸声':'已关闭声音');}catch(error){soundButton.setAttribute('aria-checked','false');announce('当前浏览器暂时不能播放声音');console.error(error);}finally{soundButton.disabled=false;}});
function syncExpanded(){const expanded=Boolean(document.fullscreenElement)||expandedFallback;expand.setAttribute('aria-pressed',String(expanded));expand.setAttribute('aria-label',expanded?'退出全屏':'全屏显示');expand.querySelector('use').setAttribute('href',expanded?'#exit':'#full');}
function setFallback(value){expandedFallback=value;viewer.classList.toggle('is-expanded',value);document.body.classList.toggle('expanded',value);syncExpanded();}
expand.addEventListener('click',async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else if(expandedFallback)setFallback(false);else if(viewer.requestFullscreen)await viewer.requestFullscreen();else setFallback(true);}catch{setFallback(!expandedFallback);}syncExpanded();});
document.addEventListener('fullscreenchange',syncExpanded);
function pointerPosition(event){
  const rect=stage.getBoundingClientRect();
  return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};
}
stage.addEventListener('pointerdown',e=>{if(!scene||e.target.closest('button'))return;if(pointerId!==null)return;key=null;pointerId=e.pointerId;stage.setPointerCapture(e.pointerId);stage.focus({preventScroll:true});const p=pointerPosition(e);scene.press(p.x,p.y);e.preventDefault();});
stage.addEventListener('pointermove',e=>{if(!scene||key||e.target.closest('button'))return;if(e.pointerType!=='mouse'&&e.pointerId!==pointerId)return;const p=pointerPosition(e);scene.point(p.x,p.y);});
function endPointer(e){if(e.pointerId===pointerId){pointerId=null;scene?.leave();}}
stage.addEventListener('pointerup',endPointer);stage.addEventListener('pointercancel',endPointer);stage.addEventListener('lostpointercapture',endPointer);
stage.addEventListener('pointerleave',()=>{if(pointerId===null)scene?.leave();});
stage.addEventListener('keydown',e=>{if(e.target!==stage||!scene)return;if([' ','Enter','t','T'].includes(e.key)){e.preventDefault();if(e.repeat)return;key={type:e.key.toLowerCase()==='t'?'tail':'back',start:performance.now()};if(key.type==='tail'){scene.wagTail();announce('狗狗开心地摇摇尾巴');}else{scene.press(.48,.5);announce('正在轻轻抚摸狗狗');}}});
stage.addEventListener('keyup',e=>{if([' ','Enter','t','T'].includes(e.key)){key=null;scene?.leave();e.preventDefault();}});
stage.addEventListener('blur',()=>{key=null;scene?.leave();});
window.addEventListener('blur',()=>{key=null;pointerId=null;scene?.leave();});
function frame(now){
  if(active&&scene){
    if(key){const t=(now-key.start)/1000;if(key.type==='back')scene.point(.43+Math.sin(t*2.8)*.13,.49+Math.sin(t*1.4)*.025);else{scene.wagTail();scene.point(.83,.61);}}
    scene.frame(now);sound.update(scene.pet,scene.speed,now/1000);
  }
  loop=requestAnimationFrame(frame);
}
document.addEventListener('visibilitychange',()=>{active=!document.hidden;if(!active){key=null;pointerId=null;scene?.leave();cancelAnimationFrame(loop);}else loop=requestAnimationFrame(frame);});
window.addEventListener('pagehide',e=>{active=false;cancelAnimationFrame(loop);if(!e.persisted){sound.destroy();scene?.destroy();}});
window.addEventListener('pageshow',e=>{if(e.persisted){active=true;scene?.resize();cancelAnimationFrame(loop);loop=requestAnimationFrame(frame);}});
if(scene){const requested=new URLSearchParams(location.search).get('dog');choose(names[requested]?requested:'sheepdog');loop=requestAnimationFrame(frame);}
