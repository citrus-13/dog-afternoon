const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,n)=>{const t=clamp((n-a)/(b-a));return t*t*(3-2*t);};
const duration={treat:1.90,meal:2.80,ball:2.55};

// Timing and intent only: the rig decides how these normalized cues move the art.
export class DogMotion{
  constructor(random=Math.random){
    this.random=random;this.time=0;this.idleFor=0;
    this.nextBlink=this.between(2.4,4.8);this.nextStretch=this.between(4,7.6);
    this.blinkAt=-Infinity;this.blinkClose=.12;this.blinkHold=.06;this.blinkOpen=.25;
    this.stretchAt=-Infinity;this.stretchLength=3;
    this.touchAt=-Infinity;this.touchSize=0;this.touchZone='idle';this.nextStroke=0;
    this.earAt=-Infinity;this.nextEar=0;
    this.comfortAt=-Infinity;this.comfortLength=3.2;this.comfortReady=true;this.nextComfort=0;
    this.slowBlinkAt=Infinity;this.nextRestBlink=0;
    this.wasContact=false;this.wasResting=false;this.lastZone='idle';this.lastAction=null;this.actionTime=0;
    this.value={blink:0,nod:0,tilt:0,stretch:0,tail:0,ear:0,behavior:'idle'};
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
  step(dt,{zone='idle',contact=false,resting=false,action=null,bond=0,comfort=0,rubbing=false}={}){
    // A suspended tab resumes a pose instead of fast-forwarding several events.
    dt=Number.isFinite(dt)?clamp(dt,0,.1):0;this.time+=dt;
    bond=Number.isFinite(bond)?clamp(bond):0;
    comfort=Number.isFinite(comfort)?clamp(comfort):0;
    rubbing=Boolean(rubbing&&contact);
    const kind=action&&Object.hasOwn(duration,action.kind)?action.kind:null;
    const actionTime=kind&&Number.isFinite(action.time)?clamp(action.time,0,duration[kind]):0;
    const freshAction=kind&&(kind!==this.lastAction||actionTime<this.actionTime-.05);
    const newTouch=contact&&(!this.wasContact||zone!==this.lastZone);
    if(contact||resting)this.stretchAt=-Infinity;
    if(freshAction){
      this.stretchAt=-Infinity;this.slowBlinkAt=Infinity;
      if(kind!=='ball')this.blink(.25,true);
    }
    if(resting&&!this.wasResting&&!kind&&this.time>=this.nextRestBlink){
      this.queueSlowBlink(this.between(.35,.60));
      this.nextRestBlink=this.time+5.5;
    }
    // Hysteresis acknowledges a sequence of comfortable strokes once. A hand
    // left in place, or a comfort value held high, cannot restart the response.
    if(comfort<.34)this.comfortReady=true;
    if(this.comfortReady&&comfort>=.68&&zone==='back'&&rubbing&&!resting&&!kind&&this.time>=this.nextComfort){
      this.comfortAt=this.time;this.comfortLength=this.between(2.9,3.5);
      this.comfortReady=false;this.nextComfort=this.time+6;
      this.queueSlowBlink(this.between(.18,.34));
    }
    if(contact&&zone==='ear'&&!resting&&!kind&&(newTouch||(rubbing&&this.time>=this.nextEar))){
      this.earAt=this.time;this.nextEar=this.time+this.between(1.5,2.3);
      this.touchAt=this.time;this.touchSize=.065;this.touchZone=zone;
    }
    if(contact&&zone!=='ear'&&!resting&&!kind&&(newTouch||(rubbing&&this.time>=this.nextStroke))){
      this.touchAt=this.time;
      this.touchSize=zone==='chin'?.42:zone==='head'?.30:.18;this.touchZone=zone;
      this.nextStroke=this.time+this.between(1.9,3.3);
      this.stretchAt=-Infinity;
      if(this.slowBlinkAt===Infinity)this.blink(this.between(.14,.27),false);
    }
    this.idleFor=contact||resting||kind?0:this.idleFor+dt;
    if(this.time>=this.slowBlinkAt){this.slowBlinkAt=Infinity;this.blink(0,true);}
    if(this.slowBlinkAt===Infinity&&this.time>=this.nextBlink)this.blink(0,resting);
    if(this.idleFor>1.4&&this.time>=this.nextStretch){
      this.stretchAt=this.time;this.stretchLength=this.between(2.7,3.4);
      this.nextStretch=this.time+this.stretchLength+this.between(22,38);
    }
    const blinkAge=this.time-this.blinkAt;
    const blink=smooth(0,this.blinkClose,blinkAge)*(1-smooth(this.blinkClose+this.blinkHold,this.blinkClose+this.blinkHold+this.blinkOpen,blinkAge));
    const stretchAge=this.time-this.stretchAt;
    let stretch=smooth(0,.85,stretchAge)*(1-smooth(1.65,this.stretchLength,stretchAge));
    const touchAge=this.time-this.touchAt;
    const touch=resting||kind?0:smooth(0,.22,touchAge)*(1-smooth(.40,1.30,touchAge));
    const earAge=this.time-this.earAt;
    const flick=smooth(0,.045,earAge)*(1-smooth(.10,.23,earAge));
    const rebound=smooth(.12,.21,earAge)*(1-smooth(.27,.42,earAge));
    const ear=resting||kind?0:.48*flick-.14*rebound;
    const comfortAge=this.time-this.comfortAt;
    const comfortTail=smooth(0,.50,comfortAge)*(1-smooth(1.35,this.comfortLength,comfortAge));
    let nod=resting?-.17:touch*this.touchSize+stretch*.16;
    let tilt=touch*(this.touchZone==='chin'?-.09:this.touchZone==='ear'?.055:.035);
    let tail=resting?0:touch*(this.touchZone==='ear'?.12+.08*bond:.22+.23*bond)+stretch*.08;
    tail=Math.max(tail,comfortTail*(.25+.08*bond));
    let behavior=resting?'settle':contact?'watch':'idle';
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
    v.blink=clamp(blink);
    v.nod=clamp(ease(v.nod,nod,resting?.42:kind?.12:contact?.17:.38),-1,1);
    v.tilt=clamp(ease(v.tilt,tilt,resting?.48:kind?.14:.25),-1,1);
    v.stretch=clamp(ease(v.stretch,stretch,kind?.10:.18));
    v.tail=clamp(ease(v.tail,tail,tail>v.tail?.22:kind?.16:.48));
    v.ear=clamp(ease(v.ear,ear,ear===0?.10:.035),-1,1);
    if(!kind){
      if(Math.abs(v.ear)>.025)behavior='ear';
      else if(comfortAge>=0&&comfortAge<this.comfortLength+.5)behavior=v.blink>.04?'blink':'settle';
      else if(!resting&&!contact)behavior=v.blink>.04?'blink':v.stretch>.035?'stretch':Math.abs(v.nod)+Math.abs(v.tilt)>.035?'settle':'idle';
    }
    v.behavior=behavior;
    this.wasContact=contact;this.wasResting=resting;this.lastZone=zone;this.lastAction=kind;this.actionTime=actionTime;
    return {...v};
  }
}
