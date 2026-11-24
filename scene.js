import {DogMotion} from './motion.js?v=natural-motion-3';
import {dogRig} from './motion-rig.js?v=natural-motion-3';

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,t)=>{const p=clamp((t-a)/(b-a));return p*p*(3-2*p);};
// The cutouts have different tail positions. Blend movement into the fur at the root.
const tailRoot={
  sheepdog:{x:.865,y:.54},
  cockapoo:{x:.83,y:.39},
  golden:{x:.77,y:.59},
  shiba:{x:.84,y:.35},
  samoyed:{x:.74,y:.56}
};
// Coordinates are measured on the transparent cutouts, so the same gestures
// follow the dog's anatomy when the stage or proportions change.
const face={
  sheepdog:{head:[.235,.31],chin:[.306,.76]},
  cockapoo:{head:[.224,.32],chin:[.272,.73]},
  golden:{head:[.263,.34],chin:[.135,.63]},
  shiba:{head:[.174,.34],chin:[.120,.63]},
  samoyed:{head:[.171,.39],chin:[.127,.67]}
};
const back=[.58,.40];
const propDuration={treat:1.90,meal:2.80,ball:2.55};
const vertexShader=`attribute vec2 aPosition;attribute vec2 aUV;varying mediump vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}`;
const fragmentShader=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uImage;
uniform vec2 uTouch;
uniform vec2 uDirection;
uniform float uContact;
uniform vec4 uEyeA;
uniform vec4 uEyeB;
uniform vec4 uEyeAxes;
uniform float uBlink;
varying mediump vec2 vUV;

// Compress the real eye texture into a thin line while leaving the surrounding
// fur anchored. Rotation is measured on the original 2:1 image.
vec2 closeEye(vec2 uv,vec4 eye,vec2 axis){
  if(eye.z<=0. || uBlink<=.001)return uv;
  vec2 normal=vec2(-axis.y,axis.x);
  vec2 local=(uv-eye.xy)*vec2(1.,.5);
  float across=dot(local,axis);
  float height=dot(local,normal);
  float width=eye.z*1.70;
  float band=eye.w*1.20;
  float fraction=clamp(abs(height)/band,0.,1.);
  float influence=uBlink*(1.-smoothstep(.48,1.,abs(across)/width));
  float amount=band*influence*(1.-fraction)*fraction/(.105+fraction);
  return uv+normal*vec2(1.,2.)*sign(height)*amount;
}

void main(){
  vec2 coatUV=closeEye(closeEye(vUV,uEyeA,uEyeAxes.xy),uEyeB,uEyeAxes.zw);
  vec4 coat=texture2D(uImage,coatUV);
  vec2 offset=(vUV-uTouch)*vec2(1.,.60);
  float contact=uContact*exp(-dot(offset,offset)*175.);
  vec2 brushedUV=coatUV-uDirection*contact*.0019;
  vec4 brushed=texture2D(uImage,brushedUV);
  float inside=smoothstep(.85,.99,min(coat.a,brushed.a));
  vec3 fur=mix(coat.rgb,brushed.rgb,inside);
  gl_FragColor=vec4(fur*(1.-contact*.055),coat.a);
}`;

export class DogScene{
  constructor(canvas,stage,hand){
    this.canvas=canvas;this.stage=stage;this.hand=hand;
    this.size=1;this.thickness=1;this.pet=0;this.wag=0;this.speed=0;this.dx=0;this.dy=0;
    this.target={x:.50,y:.52};this.touch={...this.target};this.handPosition={...this.target};
    this.petTarget={...this.target};
    this.pat=0;
    this.familiarity=0;
    this.headResponse=0;this.headTurn=0;this.relax=0;
    this.wagStrength=0;
    this.tailPhase=0;
    this.tail=tailRoot.sheepdog;
    this.face=face.sheepdog;this.prop=stage.querySelector('#toy');
    this.rig=dogRig.sheepdog;
    this.bond=0;
    this.resetInteraction();
    this.contact=false;this.handAlpha=0;this.ready=false;this.last=0;
    this.reduce=matchMedia('(prefers-reduced-motion: reduce)');
    this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});
    if(this.gl)this.initGL();else this.ctx=canvas.getContext('2d');
    this.observer=new ResizeObserver(()=>this.resize());this.observer.observe(stage);
    this.resize();
  }
  initGL(){
    const gl=this.gl;
    const compile=(kind,source)=>{const s=gl.createShader(kind);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s;};
    const program=gl.createProgram(),vs=compile(gl.VERTEX_SHADER,vertexShader),fs=compile(gl.FRAGMENT_SHADER,fragmentShader);
    gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));
    gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(program);this.program=program;
    this.cols=64;this.rows=32;
    const count=(this.cols+1)*(this.rows+1);this.uv=new Float32Array(count*2);this.positions=new Float32Array(count*2);
    const indices=[];
    for(let y=0;y<=this.rows;y++)for(let x=0;x<=this.cols;x++){
      const n=y*(this.cols+1)+x;this.uv[n*2]=x/this.cols;this.uv[n*2+1]=y/this.rows;
      if(y<this.rows&&x<this.cols)indices.push(n,n+this.cols+1,n+1,n+1,n+this.cols+1,n+this.cols+2);
    }
    this.positionBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferData(gl.ARRAY_BUFFER,this.positions,gl.DYNAMIC_DRAW);
    const pos=gl.getAttribLocation(program,'aPosition');gl.enableVertexAttribArray(pos);gl.vertexAttribPointer(pos,2,gl.FLOAT,false,0,0);
    this.uvBuffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,this.uvBuffer);gl.bufferData(gl.ARRAY_BUFFER,this.uv,gl.STATIC_DRAW);
    const uv=gl.getAttribLocation(program,'aUV');gl.enableVertexAttribArray(uv);gl.vertexAttribPointer(uv,2,gl.FLOAT,false,0,0);
    this.indexBuffer=gl.createBuffer();gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,this.indexBuffer);gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,new Uint16Array(indices),gl.STATIC_DRAW);this.indexCount=indices.length;
    this.texture=gl.createTexture();gl.bindTexture(gl.TEXTURE_2D,this.texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
    this.uniforms=Object.fromEntries(
      ['uTouch','uDirection','uContact','uImage','uEyeA','uEyeB','uEyeAxes','uBlink']
        .map(name=>[name,gl.getUniformLocation(program,name)])
    );
    gl.uniform1i(this.uniforms.uImage,0);gl.clearColor(0,0,0,0);gl.disable(gl.BLEND);
    if(!this.contextListeners){
      this.contextListeners=true;
      this.canvas.addEventListener('webglcontextlost',e=>{e.preventDefault();this.contextLost=true;this.ready=false;this.stage.dataset.ready='false';document.querySelector('#loading').textContent='画面暂停，请重新加载';document.querySelector('#retry').hidden=false;});
      this.canvas.addEventListener('webglcontextrestored',()=>{try{this.initGL();this.contextLost=false;this.resize();if(this.image){this.setImage(this.image);this.stage.dataset.ready='true';document.querySelector('#retry').hidden=true;}}catch{this.contextLost=true;}});
    }
  }
  resize(){
    const {width,height}=this.stage.getBoundingClientRect();if(!width||!height)return;
    this.width=width;this.height=height;
    const dpr=Math.min(devicePixelRatio||1,2,2400/width);this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    if(this.gl)this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
    this.layout();
  }
  layout(){
    const w=this.width*.91*this.size,h=w*(this.image?this.image.height/this.image.width:.5)*this.thickness;
    this.bounds={x:(this.width-w)/2,y:this.height*.52-h*.5,w,h};
    const handWidth=clamp(this.width*.235,68,220);
    this.handSize={width:handWidth,height:handWidth*1.5};
    this.hand.style.width=`${handWidth}px`;
    this.hand.style.height=`${this.handSize.height}px`;
  }
  setProportions(size,width){this.size=.72+Number(size)*.056;this.thickness=.8+Number(width)*.04;this.layout();}
  async load(url){
    const img=new Image();img.src=url;await img.decode();
    return img;
  }
  setImage(img,id){
    this.image=img;this.layout();
    if(id){this.tail=tailRoot[id]??tailRoot.sheepdog;this.face=face[id]??face.sheepdog;this.rig=dogRig[id]??dogRig.sheepdog;}
    const sample=document.createElement('canvas');sample.width=200;sample.height=100;const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,200,100);this.alpha=ctx.getImageData(0,0,200,100).data;
    if(this.gl){
      const gl=this.gl;
      gl.useProgram(this.program);
      gl.bindTexture(gl.TEXTURE_2D,this.texture);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,img);
      const empty=[0,0,0,0,0];
      const [first=empty,second=empty]=this.rig.eyes;
      gl.uniform4f(this.uniforms.uEyeA,first[0],first[1],first[2],first[3]);
      gl.uniform4f(this.uniforms.uEyeB,second[0],second[1],second[2],second[3]);
      gl.uniform4f(this.uniforms.uEyeAxes,Math.cos(first[4]),Math.sin(first[4]),Math.cos(second[4]),Math.sin(second[4]));
    }
    this.ready=true;
    this.pet=0;
    this.wag=0;
    this.pat=0;
    this.familiarity=0;
    this.headResponse=0;this.headTurn=0;this.relax=0;
    this.wagStrength=0;
    this.tailPhase=0;
    this.speed=0;
    this.dx=0;
    this.dy=0;
    this.contact=false;
    this.handAlpha=0;
    this.hand.style.opacity='0';
    this.target={x:.50,y:.52};
    this.petTarget={...this.target};
    this.resetInteraction();
  }
  resetInteraction(){
    this.motion=new DogMotion();
    this.zone='idle';
    this.pressed=false;
    this.stillTime=0;
    this.strokeTime=0;
    this.careTime=0;
    this.motionPending=0;
    this.action=null;
    if(this.prop)this.prop.dataset.visible='false';
  }
  textureCoords(x,y){
    const b=this.bounds;
    return {u:(x*this.width-b.x)/b.w,v:(y*this.height-b.y)/b.h};
  }
  stageCoords(u,v){
    const b=this.bounds;
    return {x:(b.x+b.w*u)/this.width,y:(b.y+b.h*v)/this.height};
  }
  hit(u,v){
    if(u<0||u>=1||v<0||v>=1)return false;
    return this.alpha[4*(Math.floor(v*100)*200+Math.floor(u*200))+3]>35;
  }
  gesturePoint(zone,phase=0){
    const [u,v]=this.face[zone]??back;
    const range=zone==='back'?.128:.028;
    return this.stageCoords(u+Math.sin(phase*4.1)*range,v+Math.sin(phase*3.1)*.015);
  }
  touchZone(u,v){
    const {head:[hx,hy],chin:[cx,cy]}=this.face;
    if(u>Math.min(hx,cx)-.115&&u<Math.max(hx,cx)+.12){
      const divider=(hy+cy)/2;
      if(v<divider)return 'head';
      if(v>divider+.025)return 'chin';
    }
    return 'back';
  }
  point(x,y){
    if(!this.ready||!this.bounds)return;
    const previous=this.target;
    const wasContact=this.contact;
    const distance=Math.hypot(x-previous.x,(y-previous.y)*this.height/this.width);
    this.target={x,y};
    const {u,v}=this.textureCoords(x,y);
    this.contact=this.hit(u,v);
    const zone=this.contact?this.touchZone(u,v):'idle';
    if(zone!==this.zone)this.stillTime=0;
    this.zone=zone;
    if(!this.contact){this.motionPending=0;this.strokeTime=0;return;}
    this.petTarget=this.target;
    if(!wasContact){
      if(this.handAlpha<.15){
        this.handPosition={...this.petTarget};
        this.touch={...this.petTarget};
      }
      return;
    }
    const widthRatio=this.width/this.bounds.w;
    this.dx=clamp((x-previous.x)*45*widthRatio,-1,1);
    this.dy=clamp((y-previous.y)*45,-1,1);
    this.speed=Math.max(this.speed,clamp(distance*22));
    const moved=distance*widthRatio;
    this.motionPending+=moved;
    this.accumulateTouch(Math.min(moved,.12)*(zone==='back'?1:.55));
  }
  press(x,y){
    this.point(x,y);
    if(!this.contact)return;
    this.pressed=true;
    this.stillTime=0;
    this.pat=1;
    this.accumulateTouch(.065);
  }
  accumulateTouch(amount){
    this.familiarity=clamp(this.familiarity+amount);
    this.wagTail(smooth(.17-this.bond*.08,.56-this.bond*.19,this.familiarity));
  }
  leave(){
    this.contact=false;this.speed=0;this.zone='idle';this.pressed=false;
    this.stillTime=0;this.strokeTime=0;this.motionPending=0;
  }
  takeCareTime(){
    const seconds=this.careTime;
    this.careTime=0;
    return seconds;
  }
  setBond(affection){this.bond=clamp(affection/100);}
  get canPerformCare(){return this.ready&&!this.action;}
  performCare(kind){
    if(!this.canPerformCare||!propDuration[kind])return;
    this.action={kind,time:0};
    if(this.prop){
      this.prop.dataset.kind=kind;
      this.prop.dataset.visible='true';
      this.renderProp(0,kind);
    }
  }
  renderProp(time,kind){
    if(!this.prop)return;
    const duration=propDuration[kind];
    const [cx,cy]=this.face.chin;
    const [pawX,pawY]=this.rig.paws.find(([,y])=>y>.60)??[cx,cy];
    const reduced=this.reduce.matches;
    const roll=kind==='ball'&&!reduced?1-(1-clamp(time/1.1))**3:1;
    const arrive=reduced?1:smooth(.32,1.08,time);
    const isBall=kind==='ball';
    const isTreat=kind==='treat';
    const u=isBall?.84+((pawX-.054)-.84)*roll:cx+.035-(isTreat?arrive*.025:0);
    const v=isBall?.91+(Math.min(.941,pawY+.075)-.91)*roll+.035*Math.sin(roll*Math.PI)
      :isTreat?Math.min(.96,cy+.23)-arrive*.105:Math.min(.94,cy+.16);
    const position=this.stageCoords(u,v);
    this.prop.style.left=`${position.x*100}%`;
    this.prop.style.top=`${position.y*100}%`;
    this.prop.style.setProperty('--prop-turn',`${isBall&&!reduced?-roll*420:0}deg`);
    this.prop.style.opacity=String(smooth(0,.16,time)*(1-smooth(duration-.55,duration,time)));
  }
  wagTail(strength=1){this.wagStrength=Math.max(this.wagStrength,strength);}
  deform(u,v,pose){
    const {x,y,w,h}=this.bounds;
    const distance=(u-pose.touchX)**2*1.8+(v-pose.touchY)**2*.65;
    const underHand=Math.exp(-distance*115)*pose.pressure;
    const tail=smooth(this.tail.x,.98,u)*smooth(this.tail.y-.10,this.tail.y+.10,v);
    const chest=smooth(.27,.43,u)*(1-smooth(.64,.81,u));
    const pivot=Math.max(this.face.head[0],this.face.chin[0])+.106;
    const head=(1-smooth(pivot-.025,pivot+.115,u))*(1-.82*smooth(.63,.93,v));
    const shoulder=chest*(1-smooth(.42,.83,v));
    let paw=0;
    if(pose.stretch>.001&&u<.46&&v>.53){
      for(const [px,py,rx,ry] of this.rig.paws){
        const radius=((u-px)/(rx*1.40))**2+((v-py)/(ry*1.45))**2;
        paw=Math.max(paw,Math.exp(-radius));
      }
      paw*=smooth(.53,.65,v)*(1-smooth(.37,.46,u));
    }
    const stretch=pose.stretch;
    return {
      x:x+w*(u+underHand*pose.shearX-head*(v-.45)*pose.headTurn*.52
        -tail*(v-this.tail.y)*pose.wag*.034-stretch*(paw*.034+shoulder*.011)),
      y:y+h*(v+underHand*pose.shearY+chest*(v-.47)*pose.breath
        +head*((u-pivot)*pose.headTurn*1.5-pose.headLift)
        +tail*pose.wag*.063+stretch*(paw*.026-shoulder*.026))
    };
  }
  frame(now){
    if(!this.ready)return;
    const time=now/1000,dt=Math.min((now-this.last)/1000||.016,.05);this.last=now;
    const approach=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
    const moved=this.motionPending>.006;
    if(moved){this.strokeTime=.21;this.stillTime=0;this.motionPending=0;}
    else this.motionPending*=Math.exp(-dt*10);
    this.strokeTime=Math.max(0,this.strokeTime-dt);
    if(this.contact&&this.pressed)this.stillTime+=dt;
    const resting=this.contact&&this.pressed&&this.zone!=='chin'&&this.stillTime>1.12;
    if(!this.action&&this.contact&&(this.strokeTime>0||(resting&&this.stillTime<6)))this.careTime+=dt;
    if(this.action){
      const {kind}=this.action;
      const elapsed=this.action.time+=dt;
      const duration=propDuration[kind];
      this.renderProp(elapsed,kind);
      if(elapsed>=duration){
        this.action=null;
        if(this.prop)this.prop.dataset.visible='false';
      }
    }
    const cue=this.motion.step(dt,{zone:this.zone,contact:this.contact,resting,action:this.action,bond:this.bond});
    this.pet=approach(this.pet,this.contact?1:0,this.contact?19:10);
    this.wag=approach(this.wag,Math.max(this.wagStrength,cue.tail),8);
    this.wagStrength*=Math.exp(-dt*1.1);
    this.tailPhase+=dt*(10+this.wag*3);
    this.speed*=Math.exp(-dt*5);
    this.dx*=Math.exp(-dt*5);
    this.dy*=Math.exp(-dt*5);
    this.pat*=Math.exp(-dt*8.5);
    this.familiarity=Math.max(0,this.familiarity-dt*(this.contact?.13:.23));
    this.touch.x=approach(this.touch.x,this.petTarget.x,27);this.touch.y=approach(this.touch.y,this.petTarget.y,27);
    this.handPosition.x=approach(this.handPosition.x,this.petTarget.x,32);
    this.handPosition.y=approach(this.handPosition.y,this.petTarget.y,32);
    this.handAlpha=approach(this.handAlpha,this.contact||this.pat>.18?1:0,17);
    const {width:handWidth,height:handHeight}=this.handSize;
    const handX=this.handPosition.x*this.width-handWidth*.24;
    const handY=this.handPosition.y*this.height-handHeight*.17;
    // Extend only the sleeve so the fingers keep their scale and the arm exits the frame.
    const sleeveLength=handHeight*.32;
    const sleeveStretch=Math.max(1,(this.height-handY+8-handHeight*.68)/sleeveLength);
    this.hand.style.setProperty('--sleeve-stretch',sleeveStretch.toFixed(3));
    const handAngle=this.reduce.matches?0:this.dx*2;
    this.hand.style.transform=`translate3d(${handX}px,${handY}px,0) rotate(${handAngle}deg)`;
    this.hand.style.opacity=String(this.handAlpha);
    const b=this.bounds;
    const motion=this.reduce.matches?0:1;
    const touchX=(this.touch.x*this.width-b.x)/b.w;
    const touchY=(this.touch.y*this.height-b.y)/b.h;
    const pressure=Math.max(this.pet,this.pat);
    const headContact=this.contact&&this.zone==='head';
    const chinContact=this.contact&&this.zone==='chin';
    const petLift=this.action||resting?0:headContact?.013:chinContact?.032:0;
    const followHand=petLift?clamp((touchX-this.face.head[0])*.25,-.033,.033):0;
    this.headResponse=approach(this.headResponse,petLift*pressure+cue.nod*.117,5.8);
    this.headTurn=approach(this.headTurn,cue.tilt*.087+followHand,5.2);
    this.relax=approach(this.relax,resting?1:0,3);
    const pose={
      touchX,touchY,
      pressure:pressure*motion,
      shearX:this.dx*.009,
      shearY:.008+this.dy*.009+this.pat*.009,
      headLift:this.headResponse*motion,
      headTurn:this.headTurn*motion,
      breath:Math.sin(time*1.35)*(.011+this.relax*.015)*motion,
      wag:Math.sin(this.tailPhase)*this.wag*motion,
      stretch:cue.stretch*motion
    };
    if(this.gl){
      const gl=this.gl;
      for(let i=0;i<this.uv.length;i+=2){const p=this.deform(this.uv[i],this.uv[i+1],pose);this.positions[i]=p.x/this.width*2-1;this.positions[i+1]=1-p.y/this.height*2;}
      gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.positions);
      gl.uniform2f(this.uniforms.uTouch,touchX,touchY);gl.uniform2f(this.uniforms.uDirection,this.dx,this.dy);gl.uniform1f(this.uniforms.uContact,Math.max(this.pet,this.pat));
      gl.uniform1f(this.uniforms.uBlink,cue.blink*motion);
      gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
    }else{
      const ctx=this.ctx,dpr=this.canvas.width/this.width;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.width,this.height);
      const strips=64,sw=this.image.width/strips;
      for(let x=0;x<strips;x++){
        const u=x/strips;
        const v=u>this.tail.x?this.tail.y+.11:.5;
        const p=this.deform(u,v,pose);
        const next=this.deform((x+1)/strips,v,pose);
        ctx.drawImage(this.image,x*sw,0,Math.min(sw+1,this.image.width-x*sw),this.image.height,p.x,p.y-v*b.h,Math.max(1,next.x-p.x+1),b.h);
      }
    }
    this.stage.dataset.contact=String(this.contact);this.stage.dataset.wagging=String(this.wag>.1);
    this.stage.dataset.reaction=this.action?.kind??(resting?'rest':this.zone);
    const behavior=motion?cue.behavior:'idle';
    if(this.stage.dataset.behavior!==behavior)this.stage.dataset.behavior=behavior;
  }
  destroy(){this.observer.disconnect();if(this.gl){const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteProgram(this.program);for(const b of [this.positionBuffer,this.uvBuffer,this.indexBuffer])gl.deleteBuffer(b);}}
}
