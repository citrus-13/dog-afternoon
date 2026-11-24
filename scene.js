import {DogMotion} from './motion.js?v=bernese-13';
import {dogRig} from './motion-rig.js?v=bernese-13';
import {CoatTrail,coatTrailGLSL} from './coat-trail.js?v=soft-touch-7';

const clamp=(n,a=0,b=1)=>Math.max(a,Math.min(b,n));
const smooth=(a,b,t)=>{const p=clamp((t-a)/(b-a));return p*p*(3-2*p);};
// The cutouts have different tail positions. Blend movement into the fur at the root.
const tailRoot={
  sheepdog:{x:.775,y:.443,slope:-.10,extended:true},
  cockapoo:{x:.83,y:.39},
  golden:{x:.77,y:.59},
  shiba:{x:.84,y:.35},
  samoyed:{x:.74,y:.56},
  bichon:{x:.795,y:.52},
  bernese:{x:.731,y:.585,slope:-.16,extended:true,bend:.72}
};
// Coordinates are measured on the transparent cutouts, so the same gestures
// follow the dog's anatomy when the stage or proportions change.
const face={
  sheepdog:{head:[.20625,.34167],chin:[.29125,.77250]},
  cockapoo:{head:[.224,.32],chin:[.325,.784]},
  golden:{head:[.263,.34],chin:[.135,.63]},
  shiba:{head:[.174,.34],chin:[.120,.63]},
  samoyed:{head:[.171,.39],chin:[.127,.67]},
  bichon:{head:[.258,.350],chin:[.282,.681]},
  bernese:{head:[.226,.196],chin:[.220,.455]}
};
const back=[.58,.40];
const pointZones=['nose','paw','tail','ear','chest','side'];
const coatZones=new Set(['head','ear','chin','chest','side','back','tail']);
const restingZones=new Set(['head','chest','back']);
const faceZones=new Set(['head','ear','chin','nose']);
const coatPressure={head:.91,ear:.65,chin:.52,nose:.38,paw:.56,chest:.72,side:.70,back:.84,tail:.66};
const regionRadius=(u,v,[cx,cy,rx,ry])=>((u-cx)/rx)**2+((v-cy)/ry)**2;
const jointWeight=(u,v,region)=>1-smooth(.55,4.8,regionRadius(u,v,region));
// Rotate in image units so an ear or paw keeps the same proportions.
function turn(u,v,x,y,angle,aspect){
  const dx=u-x,dy=(v-y)*aspect;
  const sin=Math.sin(angle),cos=Math.cos(angle)-1;
  return [cos*dx-sin*dy,(sin*dx+cos*dy)/aspect];
}
// Keep nutrition-driven proportions in the torso so the face and paws retain
// their shape even when a dog's body condition changes.
const torso=(u)=>smooth(.34,.52,u)*(1-smooth(.73,.93,u));
const propDuration={treat:1.90,meal:2.80,ball:2.55};
const vertexShader=`attribute vec2 aPosition;attribute vec2 aUV;varying mediump vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}`;
const fragmentShader=`
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uImage;
uniform vec4 uTouch;
uniform vec2 uDirection;
uniform float uContact;
uniform float uFurPress;
uniform vec4 uEyeA;
uniform vec4 uEyeB;
uniform vec4 uEyeAxes;
uniform float uBlink;
varying mediump vec2 vUV;
${coatTrailGLSL}

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
  vec2 offset=(vUV-uTouch.xy)*vec2(1.,.60);
  float contact=uContact*exp(-dot(offset,offset)*mix(340.,205.,uContact));
  vec2 pressOffset=(vUV-uTouch.zw)*vec2(1.,.60);
  float press=uFurPress*exp(-dot(pressOffset,pressOffset)*mix(390.,250.,uFurPress));
  vec3 trail=coatTrail(vUV);
  vec2 brushedUV=coatUV-uDirection*contact*.0038-vec2(0.,press*.0062)-trail.xy*.010;
  vec4 brushed=texture2D(uImage,brushedUV);
  float inside=smoothstep(.85,.99,min(coat.a,brushed.a));
  vec3 fur=mix(coat.rgb,brushed.rgb,inside);
  float rim=press*smoothstep(-.047,.035,-pressOffset.y);
  vec2 grain=normalize(vec2(1.,mix(.37,.16,smoothstep(.34,.57,vUV.x))));
  float lay=inside*(dot(trail.xy,grain)*-.055-trail.z*.015);
  gl_FragColor=vec4(fur*(1.-contact*.115-press*.062-rim*.064+lay),coat.a);
}`;

export class DogScene{
  constructor(canvas,stage,hand){
    this.canvas=canvas;this.stage=stage;this.hand=hand;
    this.size=1;this.thickness=1;this.pet=0;this.wag=0;this.speed=0;this.dx=0;this.dy=0;
    this.target={x:.50,y:.52};this.handPosition={...this.target};
    this.petTarget={...this.target};
    this.pat=0;
    this.headResponse=0;this.headTurn=0;this.relax=0;
    this.tailPhase=0;
    this.tail=tailRoot.sheepdog;
    this.face=face.sheepdog;this.prop=stage.querySelector('#toy');
    this.rig=dogRig.sheepdog;
    this.coatLeft=0;this.tailEdge=1;
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
      ['uTouch','uDirection','uContact','uFurPress','uImage','uEyeA','uEyeB','uEyeAxes','uBlink','uCoatTrail[0]','uCoatTrailActive']
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
    const furExtent=Math.max(.50-this.coatLeft,this.tailEdge-.50,.10);
    const scale=Math.min(.91*this.size,.486/furExtent);
    const w=this.width*scale,h=w*(this.image?this.image.height/this.image.width:.5);
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
    this.image=img;
    if(id){this.tail=tailRoot[id]??tailRoot.sheepdog;this.face=face[id]??face.sheepdog;this.rig=dogRig[id]??dogRig.sheepdog;}
    const [noseX,noseY,noseWidth,noseHeight]=this.rig.touch.nose;
    const [chinX,chinY]=this.face.chin;
    this.muzzle=[
      (noseX+chinX)*.5,(noseY+chinY)*.5,
      Math.max(.04,Math.abs(noseX-chinX)*.5+noseWidth),
      Math.max(.04,Math.abs(noseY-chinY)*.5+noseHeight)
    ];
    const sample=document.createElement('canvas');sample.width=200;sample.height=100;const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,200,100);this.alpha=ctx.getImageData(0,0,200,100).data;
    this.coatLeft=1;this.tailEdge=0;
    for(let i=3;i<this.alpha.length;i+=4){
      if(this.alpha[i]<=48)continue;
      const column=(i-3)/4%200;
      this.coatLeft=Math.min(this.coatLeft,column/200);
      this.tailEdge=Math.max(this.tailEdge,(column+1)/200);
    }
    this.layout();
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
    this.headResponse=0;this.headTurn=0;this.relax=0;
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
    this.coatTrail=new CoatTrail();
    this.contactTexture=null;
    this.furTouch=null;
    this.headTouch=null;
    this.faceHand=0;
    this.inputPressure=undefined;
    this.contactForce=0;
    this.pressAge=0;
    this.nearNose=false;
    this.noseDwell=0;
    this.noseLook=0;
    this.zone='idle';
    this.pressed=false;
    this.stillTime=0;
    this.strokeTime=0;
    this.careTime=0;
    this.motionPending=0;
    this.travelThisFrame=0;
    this.brushPace=0;
    this.comfort=0;
    this.action=null;
    this.pendingTap=null;
    this.headTap=0;
    this.tailTap=0;
    this.furPress=0;
    this.furVelocity=0;
    this.tailStraight=0;
    this.tailCurl=0;
    this.tailTravel=0;
    this.tailOverride=0;
    this.tailGrab=false;
    this.tailReleaseTime=0;
    this.tailReleaseTravel=0;
    this.pawIndex=0;
    this.earIndex=0;
    this.feedbackPaw=0;
    this.feedbackZone='idle';
    this.feedbackTime=0;
    this.pose=null;
    this.stage.dataset.touchZone='idle';
    this.stage.dataset.touchPaw='';
    this.stage.dataset.coatBrushed='false';
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
    const part=zone==='paw'?this.rig.paws.find(([,v])=>v>.60):zone==='ear'?this.rig.ear:this.rig.touch?.[zone];
    const [centerU,centerV]=part??this.face[zone]??back;
    const horizontal=zone==='tail'?0:part?Math.min(.025,part[2]*.36):zone==='back'?.128:.028;
    const vertical=zone==='tail'?0:part?Math.min(.017,part[3]*.30):.015;
    const u=centerU+Math.sin(phase*4.1)*horizontal,v=centerV+Math.sin(phase*3.1)*vertical;
    if(!this.gl||!this.pose)return this.stageCoords(u,v);
    const point=this.deform(u,v,this.pose);
    return {x:point.x/this.width,y:point.y/this.height};
  }
  touchZone(u,v){
    let best=null,bestDistance=Infinity;
    for(const zone of pointZones){
      const areas=zone==='paw'?this.rig.paws:zone==='ear'?[this.rig.ear,this.rig.secondEar]
        :zone==='tail'?[this.rig.touch.tail,this.rig.touch.tailTip]:[this.rig.touch[zone]];
      for(const area of areas){
        if(!area)continue;
        const distance=regionRadius(u,v,area);
        const score=distance-(zone===this.zone ? .09 : 0);
        if(distance>=1||score>=bestDistance)continue;
        bestDistance=score;
        best={zone,area};
      }
    }
    if(best){
      if(best.zone==='paw')this.pawIndex=this.rig.paws.indexOf(best.area);
      if(best.zone==='ear')this.earIndex=Number(best.area===this.rig.secondEar);
      return best.zone;
    }
    const {head:[hx,hy],chin:[cx,cy]}=this.face;
    if(u>Math.min(hx,cx)-.115&&u<Math.max(hx,cx)+.105){
      const divider=(hy+cy)/2;
      if(v<divider)return 'head';
      if(v>divider+.025)return 'chin';
    }
    return 'back';
  }
  contactCoords(x,y){
    const point=this.textureCoords(x,y);
    if(!this.gl||!this.pose)return point;
    // Invert the small mesh deflections so a paw or tail remains touchable
    // where it is painted, including while it is moving away from its rest pose.
    const {w,h}=this.bounds,px=x*this.width,py=y*this.height;
    const unbend=this.tail.extended&&this.pose.tailCurl>.10&&point.u>this.tail.x;
    if(unbend){
      // Seed the inverse on the visible curved tail so its pixels remain
      // touchable even after the tip has moved well away from its original UV.
      const normalSeed={...point};
      let bestDistance=Infinity,tailSeed=null;
      for(let u=this.tail.x+.04;u<this.tailEdge;u+=.018){
        const v=this.tail.y+(u-this.tail.x)*this.tail.slope;
        const p=this.deform(u,v,this.pose),error=(p.x-px)**2+(p.y-py)**2;
        if(error<bestDistance){bestDistance=error;tailSeed={u,v};}
      }
      if(tailSeed&&bestDistance<(w*.047)**2)Object.assign(point,tailSeed);
      const epsilon=.001;
      for(let iteration=0;iteration<6;iteration++){
        const p=this.deform(point.u,point.v,this.pose);
        const ex=px-p.x,ey=py-p.y;
        if(ex*ex+ey*ey<.03)break;
        const horizontal=this.deform(point.u+epsilon,point.v,this.pose);
        const vertical=this.deform(point.u,point.v+epsilon,this.pose);
        const ax=horizontal.x-p.x,ay=horizontal.y-p.y;
        const bx=vertical.x-p.x,by=vertical.y-p.y;
        const determinant=ax*by-ay*bx;
        if(Math.abs(determinant)<1e-7)break;
        point.u+=clamp(epsilon*(ex*by-ey*bx)/determinant,-.075,.075);
        point.v+=clamp(epsilon*(ey*ax-ex*ay)/determinant,-.14,.14);
      }
      const p=this.deform(point.u,point.v,this.pose);
      if(this.hit(point.u,point.v)&&(p.x-px)**2+(p.y-py)**2<3)return point;
      Object.assign(point,normalSeed);
    }
    for(let iteration=0;iteration<3;iteration++){
      const surface=this.deform(point.u,point.v,this.pose);
      point.u+=(px-surface.x)/w;
      point.v+=(py-surface.y)/h;
    }
    return point;
  }
  point(x,y,force){
    if(!this.ready||!this.bounds)return;
    const previous=this.target;
    const wasContact=this.contact;
    const previousCoat=this.contactTexture;
    const previousZone=this.zone;
    const distance=Math.hypot(x-previous.x,(y-previous.y)*this.height/this.width);
    this.target={x,y};
    let at=this.contactCoords(x,y);
    const delta=(x-previous.x)*this.width/this.bounds.w;
    if(this.tailGrab&&!this.hit(at.u,at.v)&&previousCoat&&previousZone==='tail'){
      const fixed=this.textureCoords(x,y);
      if(fixed.u>this.tail.x-.04&&fixed.u<1.025&&Math.abs(y-previous.y)<.09){
        const u=clamp(previousCoat.u+delta,this.rig.touch.tail[0]-.060,this.tailEdge-.014);
        at={u,v:this.tail.y+(u-this.tail.x)*this.tail.slope};
      }
    }
    const {u,v}=at;
    if(this.pressed&&Number.isFinite(force))this.inputPressure=clamp(force);
    this.contact=this.hit(u,v);
    const zone=this.contact?this.touchZone(u,v):'idle';
    if(zone!=='tail'&&previousZone==='tail')this.tailTravel=0;
    if(zone!==this.zone){this.stillTime=0;this.pressAge=0;}
    this.zone=zone;
    const [noseX,noseY]=this.rig.touch.nose;
    this.nearNose=!this.contact&&u<noseX+.055&&v>.28&&v<.95&&
      Math.hypot(u-noseX,(v-noseY)*.5)<.167;
    if(!this.contact){
      this.contactTexture=null;this.motionPending=0;this.travelThisFrame=0;this.strokeTime=0;
      return;
    }
    this.petTarget=this.target;
    this.contactTexture=at;
    this.furTouch=at;
    if(zone==='head')this.headTouch=at;
    if(zone==='tail'&&previousZone==='tail'&&!this.tailOverride){
      this.tailTravel=clamp(this.tailTravel+delta/.082,-1,1);
    }
    if(previousCoat&&coatZones.has(previousZone)&&coatZones.has(zone)&&!this.action&&
      this.hit((previousCoat.u+u)*.5,(previousCoat.v+v)*.5)){
      this.coatTrail.trace(previousCoat,at,this.pressed ? this.inputPressure??.65 : .38);
    }
    if(!wasContact){
      if(this.handAlpha<.15){
        this.handPosition={...this.petTarget};
      }
      return;
    }
    const widthRatio=this.width/this.bounds.w;
    this.dx=clamp((x-previous.x)*45*widthRatio,-1,1);
    this.dy=clamp((y-previous.y)*45,-1,1);
    this.speed=Math.max(this.speed,clamp(distance*22));
    const moved=distance*widthRatio;
    this.motionPending+=moved;
    this.travelThisFrame+=moved;
  }
  press(x,y,force,tailOverride=0){
    this.pressed=true;
    this.inputPressure=Number.isFinite(force)?clamp(force):undefined;
    this.point(x,y,force);
    if(!this.contact)return;
    this.stillTime=0;
    this.pressAge=0;
    this.pat=1;
    this.handPosition={...this.target};
    this.faceHand=Number(faceZones.has(this.zone));
    this.handAlpha=Math.max(this.handAlpha,.86);
    this.pendingTap={zone:this.zone,paw:this.pawIndex};
    if(this.zone==='head')this.headTap=.32;
    if(this.zone==='tail'){
      this.tailTap=.43;
      this.tailGrab=Boolean(this.tail.extended);
      this.tailReleaseTime=0;
      this.tailOverride=tailOverride;
      this.tailTravel=tailOverride;
    }
  }
  leave(){
    if(this.zone==='tail'&&this.pressed&&Math.abs(this.tailTravel)>.09){
      this.tailReleaseTravel=this.tailTravel;
      this.tailReleaseTime=.30;
      this.tailTap=0;
    }
    this.contact=false;this.speed=0;this.zone='idle';this.pressed=false;
    this.stillTime=0;this.strokeTime=0;this.motionPending=0;this.travelThisFrame=0;
    this.contactTexture=null;this.inputPressure=undefined;this.pressAge=0;this.nearNose=false;
    this.tailGrab=false;this.tailTravel=0;this.tailOverride=0;
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
  deform(u,v,pose){
    const {x,y,w,h}=this.bounds,aspect=h/w;
    const {head:[headX,headY],chin:[chinX,chinY]}=this.face;
    const {paws,touch:{nose,chest,side,tail}}=this.rig;
    let dx=0,dy=torso(u)*(v-.47)*(this.thickness-1);
    const ribcage=smooth(.27,.48,u)*(1-smooth(.66,.84,u));
    dy+=ribcage*(v-.47)*pose.breath;

    const headAngle=pose.headTurn+pose.chin*.073+pose.sniff*.015;
    const movingHead=Math.abs(headAngle)+Math.abs(pose.headLift)+pose.sniff>.001&&u<.58;
    const movingPaws=pose.paw+pose.stretch>.001&&u<.46;
    // During care, move the muzzle with the head and taper the correction
    // before it reaches either front paw.
    let muzzle=0;
    if(pose.careWeight>.001&&(movingHead||movingPaws)){
      let pawDistance=Infinity;
      for(const paw of paws)pawDistance=Math.min(pawDistance,regionRadius(u,v,paw));
      const mouthWeight=1-smooth(1.18,3.1,regionRadius(u,v,this.muzzle));
      muzzle=pose.careWeight*mouthWeight*smooth(.98,1.75,pawDistance);
    }
    if(movingHead){
      const neckX=Math.max(headX,chinX,nose[0])+.092;
      let skull=(1-smooth(neckX-.05,neckX+.10,u))*(1-smooth(chinY+.012,chinY+.125,v));
      for(const [px,py,rx,ry] of paws){
        const pawRadius=((u-px)/(rx*.92))**2+((v-py)/(ry*.96))**2;
        skull*=smooth(.34,5.1,pawRadius);
      }
      skull+=muzzle*(1-skull);
      const [hx,hy]=turn(u,v,neckX,headY*.40+nose[1]*.60,headAngle,aspect);
      dx+=skull*(hx-pose.sniff*.006);
      dy+=skull*(hy-pose.headLift-pose.chin*.003);
    }
    if(Math.abs(pose.ear)+pose.earFold>.001){
      const ear=pose.earIndex&&this.rig.secondEar?this.rig.secondEar:this.rig.ear;
      const [ex,ey,rx,ry,outward]=ear;
      const rootY=ey+ry*(this.rig.uprightEar?.74:-.78);
      const angle=outward*(pose.ear*.167-pose.earFold*.147);
      const weight=jointWeight(u,v,ear);
      const [exShift,eyShift]=turn(u,v,ex-outward*rx*.40,rootY,angle,aspect);
      dx+=weight*exShift;
      dy+=weight*eyShift;
    }
    if(movingPaws){
      const reach=pose.stretch*(1-muzzle);
      const recoil=1-muzzle*.86;
      for(let index=0;index<paws.length;index++){
        const area=paws[index],strength=index===0?pose.pawA:pose.pawB;
        const [px,py,rx]=area;
        let weight=jointWeight(u,v,area);
        if(paws.length>1)weight*=smooth(.55,2.1,regionRadius(u,v,paws[1-index]));
        const [pxShift,pyShift]=turn(u,v,px+rx*.74,py,-strength*.042,aspect);
        dx+=weight*((pxShift+strength*.012)*recoil-reach*.006);
        dy+=weight*((pyShift-strength*.011)*recoil+reach*.005);
      }
    }
    if(pose.chest>.001){
      const [cx,cy]=chest;
      const breathing=pose.chest*jointWeight(u,v,chest);
      dx+=breathing*(u-cx)*.044;
      dy+=breathing*((v-cy)*.071-.016);
    }
    if(pose.side>.001){
      const lean=pose.side*jointWeight(u,v,side);
      dx+=lean*.003;
      dy+=lean*.021;
    }
    if(pose.furPress>.001){
      const distance=(u-pose.pressX)**2*1.8+(v-pose.pressY)**2*.65;
      dy+=Math.exp(-distance*168)*pose.furPress*.018;
    }
    if(pose.back>.001){
      const nearby=((u-pose.touchX-.030)/.17)**2+((v-pose.touchY)/.15)**2;
      dy+=Math.exp(-nearby)*pose.back*.0045;
    }

    const root=this.tail;
    if(u>root.x-.025&&(Math.abs(pose.wag)+pose.tailStraight+pose.tailCurl)>.001){
      if(root.extended){
        const along=Math.max(0,u-root.x),length=Math.max(.15,this.tailEdge-root.x);
        const axis=root.y+along*root.slope;
        const offset=(v-axis)*aspect;
        const bend=(pose.tailCurl*(root.bend??1.12)-pose.tailStraight*.135+pose.wag*.10)/length;
        if(along>0&&Math.abs(bend)>.001){
          const angle=bend*along,sin=Math.sin(angle),cos=Math.cos(angle);
          const across=v-axis;
          const bridge=1-smooth(.061,.32,Math.abs(across));
          const outside=1-smooth(.067,across>0?.53:.40,Math.abs(across));
          // Bend the tail around its center line while carrying each cross section
          // with the arc. This moves the tip without pulling the fur lengthwise.
          dx+=sin/bend-along-bridge*offset*sin*.42;
          dy+=outside*(1-cos)/bend/aspect+bridge*across*(cos-1)*.57;
        }
      }else{
        const [tipX,tipY,,tipRadiusY]=tail;
        const along=smooth(root.x-.025,Math.max(tipX,root.x+.044),u);
        const band=Math.exp(-(((v-(tipY+root.y)*.5)/(tipRadiusY*1.65))**2));
        const [tx,ty]=turn(u,v,root.x,root.y,pose.wag*.18+pose.tailCurl*.24-pose.tailStraight*.12,aspect);
        dx+=along*band*tx;
        dy+=along*band*ty;
      }
    }
    return {x:x+w*(u+dx),y:y+h*(v+dy)};
  }
  frame(now){
    if(!this.ready)return;
    const time=now/1000,dt=Math.min((now-this.last)/1000||.016,.05);this.last=now;
    const approach=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
    const traveled=this.travelThisFrame;
    this.travelThisFrame=0;
    this.brushPace=approach(this.brushPace,clamp(traveled/Math.max(dt,.010),0,5),9);
    const movementThreshold=this.zone==='back'?.006:this.zone==='nose'?.0018:.0033;
    const moved=this.motionPending>movementThreshold;
    if(moved){this.strokeTime=.21;this.stillTime=0;this.motionPending=0;}
    else this.motionPending*=Math.exp(-dt*10);
    this.strokeTime=Math.max(0,this.strokeTime-dt);
    const strokingBack=this.contact&&this.zone==='back'&&this.strokeTime>0;
    const gentle=smooth(.10,.32,this.brushPace)*(1-smooth(1.10,2.35,this.brushPace));
    const comfortGain=strokingBack?Math.min(traveled,.065)*gentle*2:0;
    this.comfort=clamp(this.comfort+comfortGain-dt*(strokingBack?.11:.30));
    if(this.contact&&this.pressed){this.stillTime+=dt;this.pressAge+=dt;}
    const stillContact=this.contact&&this.pressed&&this.stillTime>1.12;
    const resting=stillContact&&restingZones.has(this.zone);
    const quietCare=resting||(stillContact&&(this.zone==='ear'||this.zone==='side'));
    if(!this.action&&this.contact&&(this.strokeTime>0||(quietCare&&this.stillTime<6)))this.careTime+=dt;
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
    const tapped=this.pendingTap;
    this.pendingTap=null;
    const zone=tapped?.zone??this.zone;
    const pawIndex=tapped?.paw??this.pawIndex;
    this.noseDwell=this.nearNose&&!this.action?this.noseDwell+dt:0;
    this.headTap=Math.max(0,this.headTap-dt);
    this.tailTap=Math.max(0,this.tailTap-dt);
    const headContact=this.contact&&this.zone==='head';
    const tailContact=this.contact&&this.zone==='tail';
    const heldDepth=this.inputPressure===undefined ? .41+.51*smooth(.045,.54,this.pressAge)
      : .29+.70*smooth(0,1,this.inputPressure);
    const forceTarget=!this.contact?0:this.pressed?heldDepth:this.strokeTime>0?.27:0;
    this.contactForce=approach(this.contactForce,forceTarget,19);
    const cue=this.motion.step(dt,{zone,contact:this.contact,resting,action:this.action,bond:this.bond,
      comfort:this.comfort,rubbing:this.strokeTime>0,tapped:Boolean(tapped),pawIndex,sniffHand:this.noseDwell>.28,
      pressure:this.contactForce});
    const furTarget=this.action?0:headContact&&forceTarget>0?forceTarget:.56*smooth(0,.32,this.headTap);
    const tailEngaged=!this.action&&tailContact&&(this.pressed||this.strokeTime>0);
    this.tailReleaseTime=Math.max(0,this.tailReleaseTime-dt);
    const carryTail=!this.action&&!this.contact?smooth(0,.18,this.tailReleaseTime):0;
    const tailDirection=tailEngaged?this.tailTravel:this.tailReleaseTravel;
    const tailWeight=tailEngaged?1:carryTail;
    const inward=smooth(.045,.87,-tailDirection)*tailWeight;
    const tailTarget=this.action?0:tailEngaged||carryTail>0
      ?(.65+.24*smooth(.04,.90,tailDirection))*(1-smooth(.075,.86,-tailDirection))*tailWeight
      :this.tailTap*1.12;
    // A critically damped return preserves the movement's momentum without
    // making the coat bounce past its rest position.
    const furRate=furTarget>this.furPress?18:14;
    const offset=this.furPress-furTarget;
    const carry=this.furVelocity+furRate*offset;
    const decay=Math.exp(-furRate*dt);
    this.furPress=clamp(furTarget+(offset+carry*dt)*decay);
    this.furVelocity=(this.furVelocity-furRate*carry*dt)*decay;
    this.tailStraight=approach(this.tailStraight,tailTarget,tailTarget>this.tailStraight?7.6:5.8);
    this.tailCurl=approach(this.tailCurl,inward,inward>this.tailCurl?5.9:4.2);
    this.pet=approach(this.pet,this.contact?1:0,this.contact?19:10);
    this.wag=approach(this.wag,cue.tail,8);
    this.tailPhase+=dt*(10+this.wag*3);
    this.speed*=Math.exp(-dt*5);
    this.dx*=Math.exp(-dt*5);
    this.dy*=Math.exp(-dt*5);
    this.pat*=Math.exp(-dt*8.5);
    const handRate=32+this.speed*34;
    this.handPosition.x=approach(this.handPosition.x,this.petTarget.x,handRate);
    this.handPosition.y=approach(this.handPosition.y,this.petTarget.y,handRate);
    this.handAlpha=approach(this.handAlpha,this.contact||this.pat>.105?1:0,16);
    const b=this.bounds;
    const motion=this.reduce.matches?0:1;
    const {width:handWidth,height:handHeight}=this.handSize;
    // Lead with the fingertips around the face so the palm leaves the eyes visible.
    const faceHand=Number(faceZones.has(this.contact?zone:this.feedbackZone));
    this.faceHand=motion?approach(this.faceHand,faceHand,26):faceHand;
    const anchorX=.24-.045*this.faceHand,anchorY=.17-.085*this.faceHand;
    const handScale=1-.16*this.faceHand;
    const handAngle=this.dx*2*motion-38*this.faceHand;
    const radians=handAngle*Math.PI/180;
    const handX=this.handPosition.x*this.width-handWidth*anchorX;
    const give=this.contactForce*motion;
    const contactY=this.handPosition.y*this.height+this.furPress*b.h*.016*motion;
    const handY=contactY-handHeight*anchorY;
    // Extend only the sleeve so the fingers keep their scale and the arm exits the frame.
    const down=Math.cos(radians);
    const cuffY=contactY+handScale*(handWidth*(.65-anchorX)*Math.sin(radians)+handHeight*(.68-anchorY)*down);
    const sleeveLength=handHeight*.32*handScale*down;
    const sleeveMargin=handHeight*(.035+.09*this.faceHand);
    const sleeveStretch=Math.max(1,(this.height-cuffY+sleeveMargin)/sleeveLength);
    this.hand.style.setProperty('--sleeve-stretch',sleeveStretch.toFixed(3));
    this.hand.style.transformOrigin=`${anchorX*100}% ${anchorY*100}%`;
    this.hand.style.transform=`translate3d(${handX}px,${handY}px,0) rotate(${handAngle}deg) scale(${handScale}) scaleY(${1-give*.035})`;
    this.hand.style.opacity=String(this.handAlpha);
    const {u:touchX,v:touchY}=this.furTouch??{u:.50,v:.52};
    const {u:pressX,v:pressY}=this.headTouch??{u:touchX,v:touchY};
    const contactInk=Math.max(this.contactForce,Math.min(.65,this.pat*.72));
    const surfaceZone=tapped?.zone??(this.contact?zone:this.feedbackZone);
    const pressure=this.action?0:contactInk*(coatPressure[surfaceZone]??0);
    const targetNoseX=(this.target.x*this.width-b.x)/b.w-this.rig.touch.nose[0];
    this.noseLook=approach(this.noseLook,this.nearNose&&!this.action?clamp(targetNoseX*.17,-.021,.016):0,4.5);
    const lift=cue.nod*.052*(1-this.furPress*.76);
    this.headResponse=approach(this.headResponse,lift,5.8);
    this.headTurn=approach(this.headTurn,cue.tilt*.060+this.noseLook,5.2);
    this.relax=approach(this.relax,resting?1:0,3);
    const careEnd=this.action?propDuration[this.action.kind]:0;
    const careWeight=this.action?smooth(0,.21,this.action.time)*(1-smooth(careEnd-.30,careEnd,this.action.time)):0;
    const pose={
      touchX,touchY,pressX,pressY,
      careWeight:careWeight*motion,
      headLift:this.headResponse*motion,
      headTurn:this.headTurn*motion,
      breath:Math.sin(time*1.35)*(.011+this.relax*.015)*motion,
      wag:Math.sin(this.tailPhase)*this.wag*motion*(1-.8*Math.max(this.tailStraight,this.tailCurl)),
      stretch:cue.stretch*motion,
      earIndex:this.earIndex,
      ear:cue.ear*motion,
      earFold:cue.earFold*motion,
      sniff:cue.sniff*motion,
      paw:cue.paw*motion,
      pawA:cue.pawA*motion,
      pawB:cue.pawB*motion,
      chin:cue.chin*motion,
      chest:cue.chest*motion,
      side:cue.side*motion,
      back:cue.back*motion,
      furPress:this.furPress*motion,
      tailStraight:this.tailStraight*motion,
      tailCurl:this.tailCurl*motion
    };
    this.pose=pose;
    const coat=this.coatTrail.update(dt);
    const coatActive=this.coatTrail.active;
    if(this.stage.dataset.coatBrushed!==String(coatActive))this.stage.dataset.coatBrushed=String(coatActive);
    if(this.gl){
      const gl=this.gl;
      for(let i=0;i<this.uv.length;i+=2){const p=this.deform(this.uv[i],this.uv[i+1],pose);this.positions[i]=p.x/this.width*2-1;this.positions[i+1]=1-p.y/this.height*2;}
      gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.positions);
      gl.uniform4f(this.uniforms.uTouch,touchX,touchY,pressX,pressY);
      gl.uniform2f(this.uniforms.uDirection,this.dx*motion,this.dy*motion);gl.uniform1f(this.uniforms.uContact,pressure);
      gl.uniform1f(this.uniforms.uBlink,cue.blink*motion);
      gl.uniform1f(this.uniforms.uFurPress,this.furPress);
      gl.uniform1f(this.uniforms.uCoatTrailActive,coatActive?1:0);
      if(coatActive)gl.uniform4fv(this.uniforms['uCoatTrail[0]'],coat);
      gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
    }else{
      const ctx=this.ctx,dpr=this.canvas.width/this.width;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.width,this.height);
      // Vertical strips can show breathing and torso depth without carrying a
      // paw or muzzle movement through the full height of the dog.
      const strips=64,sw=this.image.width/strips;
      for(let x=0;x<strips;x++){
        const u=x/strips;
        const depth=torso(u)*(this.thickness-1)+smooth(.27,.48,u)*(1-smooth(.66,.84,u))*pose.breath;
        ctx.drawImage(this.image,x*sw,0,Math.min(sw+1,this.image.width-x*sw),this.image.height,
          b.x+b.w*u,b.y-b.h*.47*depth,b.w/strips+1,b.h*(1+depth));
      }
      if(coatActive)this.drawBrushedCoat(ctx,coat);
      if(pressure>.012||this.furPress>.012)this.drawContactShadow(ctx,touchX,touchY,pressure,pressX,pressY);
    }
    this.stage.dataset.contact=String(this.contact);this.stage.dataset.wagging=String(this.wag>.1);
    this.stage.dataset.reaction=this.action?.kind??(resting?'rest':this.zone);
    if(this.contact||tapped){this.feedbackZone=zone;this.feedbackPaw=pawIndex;this.feedbackTime=.68;}
    else this.feedbackTime=Math.max(0,this.feedbackTime-dt);
    const feedback=this.feedbackTime>0&&!this.action?this.feedbackZone:'idle';
    if(this.stage.dataset.touchZone!==feedback)this.stage.dataset.touchZone=feedback;
    const pawFeedback=feedback==='paw'?String(this.feedbackPaw+1):'';
    if(this.stage.dataset.touchPaw!==pawFeedback)this.stage.dataset.touchPaw=pawFeedback;
    const localFeedback=feedback==='idle'?'idle':this.strokeTime>0&&coatActive?'brush':contactInk>.10?'touch':'idle';
    const behavior=this.action?cue.behavior
      :motion&&this.gl&&headContact&&cue.blink>.60?'head-soften'
      :feedback==='head'&&this.furPress>.15?'fur-press'
      :!motion||!this.gl?localFeedback
      :feedback==='tail'&&pose.tailCurl>.16&&pose.tailCurl>pose.tailStraight?'tail-curl'
      :feedback==='tail'&&pose.tailStraight>.15&&tailDirection>.055?'tail-straight'
      :feedback==='ear'&&pose.earFold>.25&&Math.abs(pose.ear)<.12?'ear-fold'
      :cue.behavior==='watch'||cue.behavior==='idle'?localFeedback:cue.behavior;
    if(this.stage.dataset.behavior!==behavior)this.stage.dataset.behavior=behavior;
  }
  drawContactShadow(ctx,touchX,touchY,pressure,pressX,pressY){
    ctx.save();
    ctx.globalCompositeOperation='source-atop';
    for(const [u,v,strength] of [[touchX,touchY,pressure*.26],[pressX,pressY,this.furPress*.22]]){
      if(strength<.01)continue;
      const p=this.stageCoords(u,v),x=p.x*this.width,y=p.y*this.height,radius=this.bounds.w*.056;
      const shadow=ctx.createRadialGradient(x,y,0,x,y,radius);
      shadow.addColorStop(0,`rgba(38,26,20,${strength})`);
      shadow.addColorStop(1,'rgba(38,26,20,0)');
      ctx.fillStyle=shadow;
      ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    ctx.restore();
  }
  drawBrushedCoat(ctx,coat){
    const radius=this.bounds.w*.070;
    ctx.save();
    ctx.globalCompositeOperation='source-atop';
    for(let i=0;i<coat.length;i+=4){
      const dx=coat[i+2],dy=coat[i+3],strength=Math.hypot(dx,dy);
      if(strength<.012)continue;
      const p=this.stageCoords(coat[i],coat[i+1]),x=p.x*this.width,y=p.y*this.height;
      const gradient=ctx.createRadialGradient(x,y,0,x,y,radius);
      const color=dx+dy*.24<0?'255,247,230':'39,30,24';
      gradient.addColorStop(0,`rgba(${color},${.057*strength})`);
      gradient.addColorStop(1,`rgba(${color},0)`);
      ctx.fillStyle=gradient;
      ctx.fillRect(x-radius,y-radius,radius*2,radius*2);
    }
    ctx.restore();
  }
  destroy(){this.observer.disconnect();if(this.gl){const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteProgram(this.program);for(const b of [this.positionBuffer,this.uvBuffer,this.indexBuffer])gl.deleteBuffer(b);}}
}
