const STORAGE_KEY='pet-the-dog.haptics';
const CONTACT_ZONES=new Set(['head','ear','chin','nose','paw','chest','side','back','tail']);

export function bindHaptics(button){
  const coarse=window.matchMedia?.('(any-pointer: coarse)');
  const toolbar=button.closest('.tools');
  let enabled=true,available=false,gesture=null,lastPulse=-Infinity;
  try{const saved=localStorage.getItem(STORAGE_KEY);if(saved==='false')enabled=false;}catch{}

  function vibrate(duration){
    try{return navigator.vibrate(duration)!==false;}catch{return false;}
  }
  function cancel(){
    gesture=null;
    if(available)vibrate(0);
  }
  function syncAvailability(){
    const next=typeof navigator.vibrate==='function'&&Boolean(coarse?.matches);
    if(!next&&available)cancel();
    available=next;button.hidden=!available;
    toolbar.dataset.haptics=String(available);
    button.setAttribute('aria-checked',String(enabled));
  }
  function trustedTouch(event){
    return available&&enabled&&!document.hidden&&event.isTrusted===true&&event.isPrimary===true&&event.pointerType==='touch';
  }
  function grounded(scene){return scene?.contact===true&&CONTACT_ZONES.has(scene.zone);}
  function pulse(kind){
    if(!gesture||navigator.userActivation?.hasBeenActive===false)return false;
    const now=performance.now();
    if(now-gesture.lastPulse<140||now-lastPulse<70)return false;
    gesture.lastPulse=now;lastPulse=now;
    const accepted=vibrate(kind==='tap'?14:5);
    if(accepted)gesture.pulsed=true;
    return accepted;
  }
  function press(event,scene){
    if(!trustedTouch(event)){gesture=null;return;}
    gesture={id:event.pointerId,x:event.clientX,y:event.clientY,distance:0,lastPulse:-Infinity,pulsed:false,contact:grounded(scene)};
    if(gesture.contact)pulse('tap');
  }
  function point(event,scene){
    if(!gesture||gesture.id!==event.pointerId||!trustedTouch(event))return;
    const distance=Math.hypot(event.clientX-gesture.x,event.clientY-gesture.y);
    gesture.x=event.clientX;gesture.y=event.clientY;
    if(!grounded(scene)){gesture.contact=false;gesture.distance=0;return;}
    if(!gesture.contact){
      gesture.contact=true;gesture.distance=0;pulse('stroke');return;
    }
    gesture.distance+=distance;
    if(gesture.distance>=12&&pulse('stroke'))gesture.distance=0;
  }
  function end(event,scene){
    if(!gesture||gesture.id!==event.pointerId)return;
    if(event.type!=='pointerup'){cancel();return;}
    // The first touch may establish browser activation only on release.
    if(trustedTouch(event)&&gesture.contact&&!gesture.pulsed&&grounded(scene))pulse('tap');
    gesture=null;
  }

  button.addEventListener('click',()=>{
    enabled=!enabled;
    try{localStorage.setItem(STORAGE_KEY,String(enabled));}catch{}
    button.setAttribute('aria-checked',String(enabled));
    if(!enabled)cancel();
  });
  coarse?.addEventListener?.('change',syncAvailability);
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  syncAvailability();
  return {press,point,end,cancel};
}
