const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,n)=>{const t=clamp((n-a)/(b-a));return t*t*(3-2*t);};
const duration={treat:1.90,meal:2.80,ball:2.55};
const localCooldown={nose:.80,paw:.90,chin:1.8,chest:2.2,side:1.5,tail:1.9};
const localLength={nose:1.1,paw:1.2,chin:2.8,chest:3.2,side:2.6,tail:2.5};
const responseWindow={nose:.84,paw:.78,ear:1.0,chin:1.4,chest:1.15,side:1.0,tail:1.25,head:.24,back:.25};
const pulse=(age,rise,hold,end)=>smooth(0,rise,age)*(1-smooth(hold,end,age));

// Timing and intent only: the rig decides how these normalized cues move the art.
export class DogMotion{
  constructor(random=Math.random){
    this.random=random;this.time=0;this.idleFor=0;
    this.nextBlink=this.between(2.4,4.8);this.nextStretch=this.between(4,7.6);
    this.blinkAt=-Infinity;this.blinkClose=.12;this.blinkHold=.06;this.blinkOpen=.25;
    this.headEyeAt=-Infinity;this.headEye=0;this.headAcknowledged=false;this.nextHeadEye=0;
    this.stretchAt=-Infinity;this.stretchLength=3;
    this.earAt=-Infinity;this.nextEar=0;
    this.earContactAt=-Infinity;this.earFoldStrength=.7;this.chinStrength=.85;
    this.backStrokeTime=0;this.backAt=-Infinity;
    this.localAt={nose:-Infinity,paw:-Infinity,chin:-Infinity,chest:-Infinity,side:-Infinity,tail:-Infinity};
    this.nextLocal={nose:0,paw:0,chin:0,chest:0,side:0,tail:0};this.nextTouch=Object.create(null);
    this.pawAt=[-Infinity,-Infinity];this.nextPaw=[0,0];
    this.activePaw=0;this.lastPaw=0;this.lastTapPaw=0;
    this.sniffScale=1;this.wasSniffingHand=false;
    this.tailTouchSize=.72;this.tailAck=0;this.tailContactAt=-Infinity;this.nextTailRelease=0;
    this.holdIntentTime=0;this.strokeIntentTime=0;this.tailHeldTime=0;
    this.wasIntent=false;this.intentUntil=-Infinity;
    this.comfortAt=-Infinity;this.comfortLength=3.2;this.comfortReady=true;this.nextComfort=0;
    this.slowBlinkAt=Infinity;this.nextRestBlink=0;
    this.wasContact=false;this.wasResting=false;this.wasTapped=false;this.lastTapZone='idle';
    this.activePart='idle';
    this.lastZone='idle';this.lastAction=null;this.actionTime=0;
    this.value={blink:0,nod:0,tilt:0,stretch:0,tail:0,ear:0,earFold:0,sniff:0,paw:0,pawA:0,pawB:0,
      chin:0,chest:0,side:0,back:0,behavior:'idle'};
  }
  between(a,b){const n=Number(this.random());return a+(b-a)*(Number.isFinite(n)?clamp(n):.5);}
  blink(delay=0,sleepy=false){
    const end=this.blinkAt+this.blinkClose+this.blinkHold+this.blinkOpen;
    if(this.time<end+.35)return;
    this.blinkAt=this.time+delay;
    this.blinkClose=sleepy?.17:this.between(.09,.13);
    this.blinkHold=sleepy?this.between(.18,.37):this.between(.025,.07);
    this.blinkOpen=sleepy?.34:this.between(.20,.29);
    this.nextBlink=this.blinkAt+this.blinkClose+this.blinkHold+this.blinkOpen+this.between(sleepy?4.6:3.2,sleepy?7.8:6.6);
  }
  queueSlowBlink(delay){
    const end=this.blinkAt+this.blinkClose+this.blinkHold+this.blinkOpen;
    this.slowBlinkAt=Math.min(this.slowBlinkAt,Math.max(this.time+delay,end+.38));
  }
  step(dt,{zone='idle',contact=false,resting=false,action=null,bond=0,comfort=0,rubbing=false,tapped=false,
    pawIndex=0,sniffHand=false,pressure=0}={}){
    // A suspended tab resumes a pose instead of fast-forwarding several events.
    dt=Number.isFinite(dt)?clamp(dt,0,.1):0;this.time+=dt;
    bond=Number.isFinite(bond)?clamp(bond):0;
    comfort=Number.isFinite(comfort)?clamp(comfort):0;
    pressure=Number.isFinite(pressure)?clamp(pressure):0;
    rubbing=Boolean(rubbing&&contact);
    tapped=Boolean(tapped);
    const kind=action&&Object.hasOwn(duration,action.kind)?action.kind:null;
    const actionTime=kind&&Number.isFinite(action.time)?clamp(action.time,0,duration[kind]):0;
    const freshAction=kind&&(kind!==this.lastAction||actionTime<this.actionTime-.05);
    const pawNumber=pawIndex===1?1:0;
    const differentPaw=zone==='paw'&&pawNumber!==this.lastPaw;
    const newTouch=contact&&(!this.wasContact||zone!==this.lastZone||differentPaw);
    const tapEdge=tapped&&(!this.wasTapped||zone!==this.lastTapZone||
      (zone==='paw'&&pawNumber!==this.lastTapPaw));
    if(newTouch){
      this.holdIntentTime=0;this.strokeIntentTime=0;this.tailHeldTime=0;
      if(this.activePart!==zone||differentPaw){this.activePart='idle';this.slowBlinkAt=Infinity;}
      if(zone==='head'){this.headAcknowledged=false;this.headEyeAt=-Infinity;}
    }
    if(!contact||kind){this.holdIntentTime=0;this.strokeIntentTime=0;}
    else{
      if(pressure>=.40)this.holdIntentTime+=dt;
      else if(pressure<.32)this.holdIntentTime=0;
      this.strokeIntentTime=rubbing?Math.min(1,this.strokeIntentTime+dt):0;
    }
    const heldIntent=this.holdIntentTime>=.10,strokeIntent=this.strokeIntentTime>=.07;
    const intent=Boolean(contact&&!kind&&(heldIntent||strokeIntent));
    const onset=tapEdge||(intent&&(!this.wasIntent||newTouch)),localZone=Object.hasOwn(localCooldown,zone);
    if(onset&&!kind){
      if(this.activePart!==zone)this.slowBlinkAt=Infinity;
      this.activePart=zone;
      this.intentUntil=this.time+(responseWindow[zone]??.25);
      if(zone==='paw')this.activePaw=pawNumber;
      if(zone==='head'&&this.time>=this.nextHeadEye)this.headAcknowledged=false;
    }
    // Passing the hand over a part is not a request for a pose. A deliberate
    // short tap is latched briefly; held pressure or a sustained stroke keeps
    // the response engaged. Previous parts only retain their smooth return.
    const localGain=part=>this.activePart===part&&((intent&&zone===part)||this.time<=this.intentUntil)?1:0;
    if(contact&&zone==='tail'&&onset)this.tailContactAt=this.time;
    if(contact&&zone==='ear'&&onset)this.earContactAt=this.time;
    if(intent&&zone==='tail')this.tailHeldTime+=dt;
    const slowRest=Boolean(intent&&resting&&(zone==='head'||zone==='chest'));
    if(contact||resting||tapEdge)this.stretchAt=-Infinity;
    if(freshAction){
      this.stretchAt=-Infinity;this.slowBlinkAt=Infinity;
      if(kind!=='ball')this.blink(.25,true);
    }
    if(!kind&&zone==='head'&&intent&&!this.headAcknowledged&&this.time>=this.nextHeadEye&&
      (heldIntent||this.strokeIntentTime>=.14)){
      // A forehead hold or deliberate pass gets one readable, soft eye closure.
      // It uses only the eye channel and cannot repeat from stationary hovering.
      this.headEyeAt=this.time+.025;this.headAcknowledged=true;this.nextHeadEye=this.time+4;
      this.nextRestBlink=Math.max(this.nextRestBlink,this.time+5.5);
      this.nextBlink=Math.max(this.nextBlink,this.time+5.5);this.slowBlinkAt=Infinity;
    }
    if(slowRest&&!this.wasResting&&!kind&&this.time>=this.nextRestBlink){
      this.queueSlowBlink(this.between(.35,.60));
      this.nextRestBlink=this.time+5.5;
    }
    // Hysteresis acknowledges a sequence of comfortable strokes once. A hand
    // left in place, or a comfort value held high, cannot restart the response.
    if(comfort<.34)this.comfortReady=true;
    if(this.comfortReady&&comfort>=.68&&zone==='back'&&strokeIntent&&!resting&&!kind&&this.time>=this.nextComfort){
      this.comfortAt=this.time;this.comfortLength=this.between(3.1,3.6);
      this.comfortReady=false;this.nextComfort=this.time+6;
      this.queueSlowBlink(this.between(.08,.16));
    }
    if(sniffHand&&!this.wasSniffingHand&&!contact&&!tapped&&!kind&&this.time>=this.nextLocal.nose){
      this.activePart='nose';this.localAt.nose=this.time;this.sniffScale=.55;
      this.intentUntil=this.time+responseWindow.nose;this.slowBlinkAt=Infinity;
      this.nextLocal.nose=this.time+.75;
      this.stretchAt=-Infinity;
    }
    const localReady=zone==='paw'?this.nextPaw[pawNumber]:this.nextLocal[zone];
    if(localZone&&onset&&!kind&&this.time>=localReady){
      // A tap can have ended before this frame; latch its event independently
      // of contact, without restarting it when a tapped flag stays high.
      this.localAt[zone]=this.time-(tapEdge?Math.min(dt,.025):0);
      if(zone==='paw'){
        this.pawAt[pawNumber]=this.localAt.paw;
        this.nextPaw[pawNumber]=this.time+localCooldown.paw;
      }else this.nextLocal[zone]=this.time+localCooldown[zone];
      if(zone==='nose')this.sniffScale=1;
      if(zone==='chin')this.chinStrength=.74+.26*pressure;
      if(zone==='tail')this.tailTouchSize=.72+.10*bond;
    }
    if(!kind&&!tapEdge&&!contact&&this.wasContact&&this.lastZone==='tail'&&
      this.tailHeldTime>.45&&this.time>=this.nextTailRelease){
      // A held tail can settle into the hand, then give one small release wag.
      this.localAt.tail=this.time;this.tailTouchSize=.68+.10*bond;
      this.activePart='tail';this.intentUntil=this.time+responseWindow.tail;
      this.nextTailRelease=this.time+2.6;this.nextLocal.tail=Math.max(this.nextLocal.tail,this.time+1.8);
    }
    if((contact||tapEdge)&&zone==='ear'&&!kind&&
      ((onset&&this.time>=(this.nextTouch.ear??0))||(strokeIntent&&this.time>=this.nextEar))){
      this.earAt=this.time-(tapEdge?Math.min(dt,.025):0);this.nextEar=this.time+this.between(1.5,2.3);
      this.earFoldStrength=.58+.22*pressure;
      this.nextTouch.ear=this.time+.85;
    }
    const previousBackTime=this.backStrokeTime;
    this.backStrokeTime=!kind&&zone==='back'&&rubbing?Math.min(1,this.backStrokeTime+dt):0;
    if(this.backStrokeTime>=.10&&previousBackTime<.10)this.backAt=this.time;
    const localBusy=Object.keys(localLength).some(part=>this.time-this.localAt[part]<localLength[part])||
      this.time-this.earAt<1.9||this.value.earFold>.025||this.value.back>.025||this.headEye>.025;
    this.idleFor=contact||resting||kind||tapEdge||localBusy?0:this.idleFor+dt;
    if(this.time>=this.slowBlinkAt){this.slowBlinkAt=Infinity;this.blink(0,true);}
    if(this.slowBlinkAt===Infinity&&this.time>=this.nextBlink&&
      ((!contact&&!tapEdge&&!localBusy)||slowRest))this.blink(0,slowRest);
    if(this.idleFor>1.4&&this.time>=this.nextStretch){
      this.stretchAt=this.time;this.stretchLength=this.between(2.7,3.4);
      this.nextStretch=this.time+this.stretchLength+this.between(22,38);
    }
    const blinkAge=this.time-this.blinkAt;
    const blink=smooth(0,this.blinkClose,blinkAge)*(1-smooth(this.blinkClose+this.blinkHold,this.blinkClose+this.blinkHold+this.blinkOpen,blinkAge));
    const headEyeAge=this.time-this.headEyeAt;
    const headEye=kind||this.activePart!=='head'?0:.94*pulse(headEyeAge,.13,.29,.68);
    const stretchAge=this.time-this.stretchAt;
    let stretch=smooth(0,.85,stretchAge)*(1-smooth(1.65,this.stretchLength,stretchAge));
    const earAge=this.time-this.earAt;
    const flick=smooth(0,.035,earAge)*(1-smooth(.16,.30,earAge));
    const rebound=smooth(.19,.27,earAge)*(1-smooth(.34,.49,earAge));
    const ear=kind?0:(.48*flick-.14*rebound)*localGain('ear');
    const earHold=intent&&zone==='ear'?
      smooth(.20,.60,this.time-this.earContactAt)*(.28+.34*pressure+(strokeIntent?.12:0)):0;
    const earFold=kind?0:Math.max(this.earFoldStrength*pulse(earAge-.16,.26,.60,1.20),earHold)*localGain('ear');
    const noseAge=this.time-this.localAt.nose;
    const sniff=kind?0:(.86*pulse(noseAge,.045,.15,.27)+pulse(noseAge-.34,.050,.17,.31))*localGain('nose')*this.sniffScale;
    const pawTarget=index=>kind?0:pulse(this.time-this.pawAt[index],.055,.28,.72)*localGain('paw')*(this.activePaw===index?1:0);
    const pawA=pawTarget(0),pawB=pawTarget(1),paw=Math.max(pawA,pawB);
    const chinAge=this.time-this.localAt.chin;
    const chinHold=intent&&zone==='chin'?smooth(.35,1.05,chinAge)*(.42+.28*pressure):0;
    const chin=kind?0:Math.max(this.chinStrength*pulse(chinAge,.48,1.08,2.20),chinHold)*localGain('chin');
    const chest=kind?0:pulse(this.time-this.localAt.chest,.65,1.10,2.60)*localGain('chest');
    const side=kind?0:pulse(this.time-this.localAt.side,.38,.82,1.95)*localGain('side');
    const back=kind?0:smooth(.10,.28,this.backStrokeTime)*(.65+.25*pressure)*(.85+.15*comfort)*localGain('back');
    const tailTouch=kind?0:this.tailTouchSize*pulse(this.time-this.localAt.tail,.13,.43,1.52)*localGain('tail');
    const comfortAge=this.time-this.comfortAt;
    const comfortTail=smooth(0,.38,comfortAge)*(1-smooth(1.65,this.comfortLength,comfortAge))*(this.activePart==='back'?1:0);
    // Local cues only move their own patch. Global poses belong to idle stretch
    // and explicit care actions; only tail contact and back comfort add a wag.
    let nod=stretch*.16,tilt=0;
    let tail=Math.max(stretch*.08,comfortTail*(.32+.08*bond),tailTouch);
    let behavior=slowRest?'settle':contact?'watch':'idle';
    if(kind){
      const t=actionTime,end=duration[kind];
      const orient=smooth(.08,.40,t)*(1-smooth(end-.64,end-.08,t));
      if(kind==='ball'){
        nod=.36*orient;tilt=.54*orient*(1-.25*smooth(.8,1.8,t));tail=.66*orient;
        // One deliberate reach once the rolling ball arrives at the paws.
        stretch=.46*smooth(.95,1.16,t)*(1-smooth(1.34,1.62,t));
      }else{
        const bites=kind==='treat'?[.66,.98,1.28]:[.70,1.06,1.42,1.78,2.14];
        const chew=bites.reduce((sum,at)=>sum+Math.exp(-(((t-at)/.085)**2)),0);
        nod=orient*(-.26-.06*chew);tilt=-.075*orient;tail=.25*orient;stretch=0;
      }
      behavior=t>end-.56?'settle':kind==='ball'||t<.40?'watch':'eat';
    }
    const ease=(a,b,seconds)=>a+(b-a)*-Math.expm1(-dt/seconds),v=this.value;
    const localEase=(part,from,to,rise,fall)=>ease(from,to,to>from?rise:this.activePart===part?fall:Math.min(fall,.12));
    this.headEye=clamp(ease(this.headEye,headEye,headEye>this.headEye?.035:.075));
    v.blink=clamp(Math.max(blink,this.headEye));
    v.nod=clamp(ease(v.nod,nod,resting?.42:kind?.12:contact?.17:.38),-1,1);
    v.tilt=clamp(ease(v.tilt,tilt,resting?.48:kind?.14:.25),-1,1);
    v.stretch=clamp(ease(v.stretch,stretch,kind?.10:.18));
    const tailFall=kind?.16:this.activePart==='back'&&comfortAge<this.comfortLength+.5?.48:.32;
    v.tail=clamp(ease(v.tail,tail,tail>v.tail?.22:tailFall));
    v.ear=clamp(ease(v.ear,ear,ear===0?(this.activePart==='ear'?.10:.06):.035),-1,1);
    v.earFold=clamp(localEase('ear',v.earFold,earFold,.16,.20));
    v.sniff=clamp(ease(v.sniff,sniff,sniff>v.sniff?.025:.035));
    v.pawA=clamp(ease(v.pawA,pawA,pawA>v.pawA?.040:this.activePart==='paw'&&this.activePaw===0?.095:.06));
    v.pawB=clamp(ease(v.pawB,pawB,pawB>v.pawB?.040:this.activePart==='paw'&&this.activePaw===1?.095:.06));
    v.paw=Math.max(v.pawA,v.pawB);
    v.chin=clamp(localEase('chin',v.chin,chin,.20,.26));
    v.chest=clamp(localEase('chest',v.chest,chest,.18,.26));
    v.side=clamp(localEase('side',v.side,side,.15,.22));
    v.back=clamp(localEase('back',v.back,back,.18,.30));
    this.tailAck=clamp(ease(this.tailAck,tailTouch,tailTouch>this.tailAck?.22:.32));
    if(!kind){
      let latest=-Infinity;
      const responses=[['ear','ear',this.earAt,Math.max(Math.abs(v.ear),v.earFold),1.75],['nose','sniff',this.localAt.nose,v.sniff,.65],
        ['paw','paw',this.localAt.paw,v.paw,.72],['chin','chin',this.localAt.chin,v.chin,2.15],['chest','chest',this.localAt.chest,v.chest,2.65],
        ['back','back',this.backAt,v.back,0],
        ['side','side',this.localAt.side,v.side,2.05],['tail','tail',this.localAt.tail,this.tailAck,1.65]];
      for(const [part,name,at,strength,activeFor] of responses){
        if(part===this.activePart&&(strength>.025||(localGain(part)&&this.time-at<activeFor))&&at>=latest){behavior=name;latest=at;}
      }
      if(this.activePart==='head'&&headEyeAge>=0&&headEyeAge<.85){
        behavior=v.blink>.04?'blink':'settle';latest=this.headEyeAt;
      }
      if(this.activePart==='back'&&comfortAge>=0&&comfortAge<this.comfortLength+.5){
        behavior=v.blink>.04?'blink':'settle';latest=this.comfortAt;
      }
      if(latest===-Infinity&&slowRest)behavior=v.blink>.04?'blink':'settle';
      else if(latest===-Infinity&&!resting&&!contact)behavior=v.blink>.04?'blink':v.stretch>.035?'stretch':Math.abs(v.nod)+Math.abs(v.tilt)>.035?'settle':'idle';
    }
    v.behavior=behavior;
    this.wasContact=contact;this.wasResting=slowRest;this.wasTapped=tapped;
    this.wasIntent=intent;if(!contact)this.tailHeldTime=0;
    this.lastPaw=pawNumber;this.wasSniffingHand=sniffHand;
    if(tapped){this.lastTapZone=zone;this.lastTapPaw=pawNumber;}
    this.lastZone=zone;this.lastAction=kind;this.actionTime=actionTime;
    return {...v};
  }
}
