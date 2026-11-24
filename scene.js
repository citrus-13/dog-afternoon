import {eyeShader,CanvasEyeTexture} from './face-expression.js?v=expression-15';
import {DogMotion} from './motion.js?v=bernese-13';
import {dogRig} from './motion-rig.js?v=companion-16';
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
const canvasCols=36,canvasRows=18;
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
${eyeShader}
varying mediump vec2 vUV;
${coatTrailGLSL}

void main(){
  vec2 coatUV=expressEye(expressEye(vUV,uEyeA,uEyeAxes.xy,uExpression.x),uEyeB,uEyeAxes.zw,uExpression.y);
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
    try{
      this.gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});
      if(this.gl)this.initGL();
    }catch{this.useCanvas();}
    if(!this.gl&&!this.ctx)this.useCanvas();
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
      ['uTouch','uDirection','uContact','uFurPress','uImage','uEyeA','uEyeB','uEyeAxes','uExpression','uCoatTrail[0]','uCoatTrailActive']
        .map(name=>[name,gl.getUniformLocation(program,name)])
    );
    gl.uniform1i(this.uniforms.uImage,0);gl.clearColor(0,0,0,0);gl.disable(gl.BLEND);
    this.canvas.addEventListener('webglcontextlost',()=>{
      try{this.useCanvas();this.resize();}
      catch{
        this.contextLost=true;this.ready=false;this.stage.dataset.ready='false';
        document.querySelector('#loading').textContent='画面暂停，请重新加载';
        document.querySelector('#retry').hidden=false;
      }
    },{once:true});
  }
  useCanvas(){
    // A canvas that already owns a WebGL context cannot acquire a 2D context.
    if(this.gl){
      const next=this.canvas.cloneNode(false);
      this.canvas.replaceWith(next);this.canvas=next;this.gl=null;
    }
    this.ctx=this.canvas.getContext('2d');
    if(!this.ctx)throw Error('Canvas unavailable');
    if(this.image)this.canvasEyes=new CanvasEyeTexture(this.image,this.rig.eyes);
  }
  resize(){
    const {width,height}=this.stage.getBoundingClientRect();if(!width||!height)return;
    this.width=width;this.height=height;
    const dpr=Math.min(devicePixelRatio||1,2,2400/width);this.canvas.width=Math.round(width*dpr);this.canvas.height=Math.round(height*dpr);
    if(this.gl)this.gl.viewport(0,0,this.canvas.width,this.canvas.height);
    this.layout();
  }
  layout(){
    // Keep room at full growth for the muzzle to reach toward a rubbing hand.
    const scale=Math.min(.91*this.size,.429/Math.max(.50-this.coatLeft,.10),.486/Math.max(this.tailEdge-.50,.10));
    const w=this.width*scale,h=w*(this.image?this.image.height/this.image.width:.5);
    this.bounds={x:(this.width-w)/2,y:this.height*.52-h*.5,w,h};
    const handWidth=clamp(this.width*.235,68,220);
    this.handSize={width:handWidth,height:handWidth*1.5};
    this.hand.style.width=`${handWidth}px`;
    this.hand.style.height=`${this.handSize.height}px`;
    if(this.ballWaiting&&!this.stage.dataset.play&&!this.playTarget)this.renderProp(propDuration.ball,'ball');
  }
  setProportions(size,width){this.size=.72+Number(size)*.056;this.thickness=.8+Number(width)*.04;this.layout();}
  async load(url){
    const img=new Image();img.src=url;await img.decode();
    return img;
  }
  setImage(img,id){
    this.image=img;
    if(id){this.tail=tailRoot[id]??tailRoot.sheepdog;this.face=face[id]??face.sheepdog;this.rig=dogRig[id]??dogRig.sheepdog;}
    this.canvasEyes=!this.gl&&this.ctx?.createImageData?new CanvasEyeTexture(img,this.rig.eyes):null;
    const [noseX,noseY,noseWidth,noseHeight]=this.rig.touch.nose;
    this.playPaw=Math.max(0,this.rig.paws.findIndex(([,y])=>y>.60));
    const [chinX,chinY]=this.face.chin;
    this.muzzle=[
      (noseX+chinX)*.5,(noseY+chinY)*.5,
      Math.max(.04,Math.abs(noseX-chinX)*.5+noseWidth),
      Math.max(.04,Math.abs(noseY-chinY)*.5+noseHeight)
    ];
    const sample=document.createElement('canvas');sample.width=200;sample.height=100;const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,200,100);this.alpha=ctx.getImageData(0,0,200,100).data;
    this.coatLeft=1;this.tailEdge=0;
    this.canvasTiles=new Uint8Array(canvasCols*canvasRows);
    for(let i=3;i<this.alpha.length;i+=4){
      const pixel=(i-3)/4,column=pixel%200;
      if(this.alpha[i]>0){
        const x=Math.floor(column/200*canvasCols),y=Math.floor(Math.floor(pixel/200)/100*canvasRows);
        this.canvasTiles[y*canvasCols+x]=1;
      }
      if(this.alpha[i]<=48)continue;
      this.coatLeft=Math.min(this.coatLeft,column/200);
      this.tailEdge=Math.max(this.tailEdge,(column+1)/200);
    }
    const occupied=this.canvasTiles.slice();
    for(let y=0;y<canvasRows;y++)for(let x=0;x<canvasCols;x++){
      if(!occupied[y*canvasCols+x])continue;
      for(let row=Math.max(0,y-1);row<=Math.min(canvasRows-1,y+1);row++)
        this.canvasTiles.fill(1,row*canvasCols+Math.max(0,x-1),row*canvasCols+Math.min(canvasCols,x+2));
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
    this.shoulderShift=0;
    this.shoulderRise=0;
    this.neckPitch=0;
    this.contactLean=0;this.tapAt=-Infinity;this.tapPart='idle';this.tapSide=0;
    this.strokeDeltaX=0;this.strokeDeltaY=0;this.strokeGap=0;
    this.returnLookAt=-Infinity;this.returnTarget=null;this.returnSniff=0;
    this.rubDirection=null;
    this.rubAnchor=null;
    this.rubTurns=0;
    this.lastRub=-Infinity;
    this.nuzzleStart=-Infinity;
    this.nuzzleZone='idle';
    this.nuzzleSide=0;
    this.inputPressure=undefined;
    this.contactForce=0;
    this.pressAge=0;
    this.nearNose=false;
    this.noseDwell=0;
    this.breathPhase=0;
    this.earAngles=[0,0];this.briskTravel=0;this.lookBackAt=-Infinity;
    this.noseLook=0;
    this.gazeX=0;this.gazeY=0;this.earEase=[0,0];
    this.breathRelease=-Infinity;this.exhale=0;this.listen=0;this.listenFar=0;
    this.propLook=null;this.playTarget=null;this.playSniff=0;this.cupDirection=0;this.cupJoy=0;this.cupLean=0;this.ballWaiting=false;
    this.catchBall=this.stage.querySelector('#return-ball');
    if(this.catchBall)this.catchBall.hidden=true;
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
  gesturePoint(zone,phase=0,other=false){
    const firstPaw=this.rig.paws.findIndex(([,v])=>v>.60);
    const paw=this.rig.paws[(Math.max(0,firstPaw)+Number(other))%this.rig.paws.length];
    const part=zone==='paw'?paw:zone==='ear'?(other&&this.rig.secondEar||this.rig.ear):this.rig.touch?.[zone];
    const [centerU,centerV]=part??(zone==='head'&&this.rig.forehead||this.face[zone])??back;
    const horizontal=zone==='tail'?0:part?Math.min(.025,part[2]*.36):zone==='back'?.128:.028;
    const vertical=zone==='tail'?0:part?Math.min(.017,part[3]*.30):.015;
    const u=centerU+Math.sin(phase*4.1)*horizontal,v=centerV+Math.sin(phase*3.1)*vertical;
    if(!this.pose)return this.stageCoords(u,v);
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
    if(!this.pose)return point;
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
  point(x,y,force,initialPress=false){
    if(!this.ready||!this.bounds)return;
    const previous=this.target;
    const wasContact=this.contact;
    const previousCoat=this.contactTexture;
    const previousZone=this.zone,previousEar=this.earIndex;
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
    if(!this.pressed||zone!==previousZone||!this.contact||(zone==='ear'&&previousEar!==this.earIndex)){
      this.rubAnchor=null;this.rubDirection=null;this.rubTurns=0;
    }
    if(this.contact&&this.pressed&&(zone==='ear'||zone==='chin'||zone==='chest'))this.trackRub(at,zone);
    const [noseX,noseY]=this.rig.touch.nose;
    this.nearNose=!this.contact&&u<noseX+.055&&v>.28&&v<.95&&
      Math.hypot(u-noseX,(v-noseY)*.5)<.167;
    if(!this.contact){
      this.tailGrab=false;
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
      if(this.pressed&&!initialPress)this.beginContact(0);
      if(this.handAlpha<.15){
        this.handPosition={...this.petTarget};
      }
      return;
    }
    const widthRatio=this.width/this.bounds.w;
    this.strokeDeltaX+=(x-previous.x)*widthRatio;
    this.strokeDeltaY+=(y-previous.y)*this.height/this.bounds.h;

    const moved=distance*widthRatio;
    this.motionPending+=moved;
    this.travelThisFrame+=moved;
  }
  trackRub(at,zone){
    const now=this.motion.time;
    if(!this.rubAnchor||now-this.lastRub>.60){
      this.rubAnchor=at;this.rubDirection=null;this.rubTurns=0;this.lastRub=now;
      return;
    }
    const dx=at.u-this.rubAnchor.u,dy=(at.v-this.rubAnchor.v)*this.bounds.h/this.bounds.w;
    const travel=Math.hypot(dx,dy);
    if(travel<.009)return;
    const direction={x:dx/travel,y:dy/travel};
    if(this.rubDirection&&direction.x*this.rubDirection.x+direction.y*this.rubDirection.y<-.35){
      this.rubTurns++;
      if(this.rubTurns>=2&&!this.action&&now-this.nuzzleStart>2.0){
        this.nuzzleStart=now;this.nuzzleZone=zone;this.rubTurns=0;
        this.nuzzleSide=zone==='ear'?(this.earIndex?this.rig.secondEar:this.rig.ear)[4]
          :clamp((at.u-this.face.head[0])/.10,-1,1);
      }
    }
    this.rubDirection=direction;this.rubAnchor=at;this.lastRub=now;
  }
  press(x,y,force,tailOverride=0){
    this.pressed=true;
    this.inputPressure=Number.isFinite(force)?clamp(force):undefined;
    this.point(x,y,force,true);
    if(this.contact)this.beginContact(tailOverride);
  }
  beginContact(tailOverride){
    this.stillTime=0;
    this.pressAge=0;
    this.pat=1;
    this.handPosition={...this.target};
    this.faceHand=Number(faceZones.has(this.zone));
    this.handAlpha=Math.max(this.handAlpha,.86);
    this.pendingTap={zone:this.zone,paw:this.pawIndex};
    this.tapAt=this.motion.time;this.tapPart=this.zone;
    this.tapSide=clamp((this.contactTexture.u-this.face.head[0])/.065,-1,1);
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
    if(this.contact&&this.pressed&&!this.action&&this.contactTexture&&
      this.zone===this.nuzzleZone&&this.motion.time-this.nuzzleStart<1.65){
      this.returnLookAt=this.motion.time;
      this.returnTarget={...this.contactTexture};
    }
    if(this.contact&&this.pressed&&!this.action&&this.stillTime>1.25&&
      (this.zone==='chest'||this.zone==='back'))this.breathRelease=this.motion.time;
    if(this.zone==='tail'&&this.pressed&&Math.abs(this.tailTravel)>.09){
      this.tailReleaseTravel=this.tailTravel;
      this.tailReleaseTime=.30;
      this.tailTap=0;
    }
    this.rubAnchor=null;this.rubDirection=null;this.rubTurns=0;
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
  performCare(kind,origin=null){
    if(!this.canPerformCare||!propDuration[kind])return;
    this.ballWaiting=false;
    if(this.catchBall)this.catchBall.hidden=true;
    this.action={kind,time:0,origin};
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
    const origin=this.action?.origin;
    const isBall=kind==='ball',isTreat=kind==='treat';
    const arrive=reduced?1:smooth(.10,isTreat?.66:.80,time);
    let u,v,spin=0,portion=1,scale=1;
    if(isBall){
      // Pause at the paw before the outward stroke sends the ball back.
      const inward=reduced?1:1-(1-clamp(time/1.06))**2;
      const outward=reduced?Number(time>=1.42):1-(1-clamp((time-1.24)/1.02))**2;
      const along=inward*(1-outward);
      u=.84+(pawX+.016-.84)*along;
      v=.93+(Math.min(.94,pawY+.035)-.93)*along;
      if(origin&&time<1.06){
        u=origin.u+(pawX+.016-origin.u)*inward;
        v=origin.v+(Math.min(.94,pawY+.035)-origin.v)*inward;
      }
      spin=reduced?0:-along*420;
    }else{
      const [nx,ny]=this.rig.touch.nose;
      const mouthX=nx+(cx-nx)*.40,mouthY=ny+(cy-ny)*.56+.022;
      u=mouthX+.044*(1-arrive);
      v=Math.min(.94,mouthY+(isTreat?.14:.16))*(1-arrive)+(mouthY+(isTreat?0:.054))*arrive;
      if(origin&&isTreat){
        u=origin.u+(mouthX-origin.u)*arrive;
        v=origin.v+(mouthY-origin.v)*arrive;
      }
      if(isTreat)scale=1-smooth(.66,.96,time);
      else portion=1-(smooth(.70,.91,time)+smooth(1.36,1.57,time)+smooth(1.99,2.22,time))/3;
    }
    this.propLook={u,v};
    const position=this.stageCoords(u,v);
    this.prop.style.left=`${position.x*100}%`;
    this.prop.style.top=`${position.y*100}%`;
    this.prop.style.setProperty('--prop-turn',`${spin}deg`);
    this.prop.style.setProperty('--prop-scale',String(scale));
    this.prop.style.setProperty('--portion',String(portion));
    this.prop.style.opacity=String((origin?1:smooth(0,.16,time))*(isBall?1:1-smooth(duration-.55,duration,time)));
    if(isBall&&this.catchBall){
      this.catchBall.style.left=this.prop.style.left;
      this.catchBall.style.top=this.prop.style.top;
    }
  }
  deform(u,v,pose){
    const {x,y,w,h}=this.bounds,aspect=h/w;
    const {head:[headX,headY],chin:[chinX,chinY]}=this.face;
    const {paws,touch:{nose,chest,side,tail}}=this.rig;
    let dx=0,dy=torso(u)*(v-.47)*(this.thickness-1);
    const ribcage=smooth(.27,.48,u)*(1-smooth(.66,.84,u));
    dy+=ribcage*(v-.47)*pose.breath;

    // Weight transfers through the shoulder, with the rear and planted feet
    // carrying the load. Carry the whole upper silhouette through the shift.
    const planted=1-smooth(Math.max(.44,chinY-.105,nose[1]-.045),Math.max(.96,chinY+.26),v);
    const shoulder=(1-smooth(.34,.88,u))*(.22+.78*planted);
    dx+=shoulder*pose.shoulderShift;
    dy-=shoulder*pose.shoulderRise;
    // Spread the neck tilt over the shoulder. Rotating the muzzle alone can
    // pinch the cheek of profile dogs that rest their face on a front paw.
    if(Math.abs(pose.neckPitch)>.0001){
      const pivotX=Math.max(headX,chinX,nose[0])+.092;
      const [pitchX,pitchY]=turn(u,v,pivotX,Math.min(.79,chinY+.045),pose.neckPitch,aspect);
      dx+=shoulder*pitchX;
      dy+=shoulder*pitchY;
    }
    const headAngle=pose.headTurn+pose.chin*.030+pose.sniff*.015;
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
    if(Math.abs(pose.earLocalA)+Math.abs(pose.earLocalB)+pose.listen+pose.listenFar>.0001){
      const count=this.rig.secondEar?2:1;
      for(let i=0;i<count;i++){
        const ear=i===0?this.rig.ear:this.rig.secondEar;
        const [ex,ey,rx,ry,outward]=ear;
        const rootY=ey+ry*(this.rig.uprightEar?.74:-.78);
        const local=i===0?pose.earLocalA:pose.earLocalB;
        const orient=(i===0?pose.listen:pose.listenFar)*(this.rig.uprightEar?.14:.18);
        const angle=outward*(local+orient);
        if(Math.abs(angle)<.0001)continue;
        const weight=jointWeight(u,v,ear);
        const [exShift,eyShift]=turn(u,v,ex-outward*rx*.40,rootY,angle,aspect);
        dx+=weight*exShift;
        dy+=weight*eyShift;
      }
    }
    if(movingPaws){
      const reach=pose.stretch*(1-muzzle);
      const recoil=1-muzzle*.86;
      for(let index=0;index<paws.length;index++){
        const area=paws[index],strength=index===0?pose.pawA:pose.pawB;
        const [px,py,rx]=area;
        let weight=1-smooth(.70,8,regionRadius(u,v,area));
        if(paws.length>1){
          // At overlapping wrists, divide the pull smoothly between both feet.
          const other=1-smooth(.70,7,regionRadius(u,v,paws[1-index]));
          weight*=weight/(weight+other+.0001);
        }
        const [pxShift,pyShift]=turn(u,v,px+rx*.78,py-area[3]*.38,-strength*.080,aspect);
        const volley=pose.ballReach&&index===this.playPaw;
        const playReach=pose.ballReach?(volley?1:0):1;
        dx+=weight*((pxShift+strength*Math.min(.020,rx*.46))*recoil+reach*(volley?Math.min(.046,rx*.85):-.006)*playReach);
        dy+=weight*((pyShift-strength*Math.min(.030,area[3]*.54))*recoil+reach*(volley?-.018:.005)*playReach);
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
    if(pose.coatDepth>.001){
      const radius=((u-pose.touchX)/.085)**2+((v-pose.touchY)/.14)**2;
      dy+=Math.exp(-radius)*pose.coatDepth*.020;
    }
    if(pose.back>.001){
      const nearby=((u-pose.touchX-.030)/.17)**2+((v-pose.touchY)/.15)**2;
      dy+=Math.exp(-nearby)*pose.back*.0045;
    }

    const root=this.tail,perk=pose.tailPerk??0;
    if(u>root.x-.025&&(Math.abs(pose.wag)+perk+pose.tailStraight+pose.tailCurl)>.001){
      if(root.extended){
        const along=Math.max(0,u-root.x),length=Math.max(.15,this.tailEdge-root.x);
        const axis=root.y+along*root.slope;
        const offset=(v-axis)*aspect;
        const bend=(pose.tailCurl*(root.bend??1.12)-pose.tailStraight*.135+pose.wag*.19+perk*.46)/length;
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
        const [tx,ty]=turn(u,v,root.x,root.y,pose.wag*.28+perk*.24+pose.tailCurl*.34-pose.tailStraight*.12,aspect);
        dx+=along*band*tx;
        dy+=along*band*ty;
      }
    }
    return {x:x+w*(u+dx),y:y+h*(v+dy)};
  }
  followTouch(dt,zone,cue,force){
    const approach=(from,to,rise,fall)=>from+(to-from)*-Math.expm1(-dt/(Math.abs(to)>Math.abs(from)?rise:fall));
    const touching=this.contact&&!this.action;
    const depth=touching?force:0;
    const pace=touching&&this.strokeTime>0?smooth(.10,1.6,this.brushPace):0;
    const ear=this.earIndex&&this.rig.secondEar?this.rig.secondEar:this.rig.ear;
    // Local reflex first, then a slower transfer of weight. A still palm
    // and a moving hand therefore produce different poses on the same spot.
    const forehead=zone==='head'&&touching?depth:0;
    const back=cue.back;
    const backPress=zone==='back'?Math.max(depth,this.pat*.80):0;
    if(zone==='side'&&touching){
      const relative=(this.contactTexture.v-this.rig.touch.side[1])/this.rig.touch.side[3];
      this.contactLean=approach(this.contactLean,clamp(relative,-1,1),.12,.16);
    }
    // Two reversals of the fingertip invite one neck stretch toward the hand.
    // Ignore tiny sensor jitter and let the dog finish the gesture between rubs.
    if(this.action||(touching&&zone!==this.nuzzleZone))this.nuzzleStart=-Infinity;
    const age=this.motion.time-this.nuzzleStart;
    const nuzzle=smooth(0,.32,age)*(1-smooth(.48,1.18,age));
    // Tap responses survive pointer-up. A dog yields to a nose tap, then
    // reaches back to investigate. Under the chin it lifts into the palm.
    const tapAge=this.motion.time-this.tapAt;
    const responds=!this.action&&(!touching||zone===this.tapPart);
    const impulse=responds?smooth(0,.075,tapAge)*(1-smooth(.23,.72,tapAge)):0;
    const after=responds?smooth(.19,.44,tapAge)*(1-smooth(.64,1.12,tapAge)):0;
    const tap=part=>this.tapPart===part?impulse:0;
    const head=Math.max(forehead*.72,tap('head'));
    const chin=Math.max(cue.chin,tap('chin')*.88);
    const earLean=ear[4]*Math.max(cue.earFold*1.16,tap('ear')*.73);
    const noseBack=tap('nose'),noseReach=this.tapPart==='nose'?after:0;
    const brace=cue.paw;
    const flank=Math.max(cue.side,tap('side')*.8);
    const chest=Math.max(cue.chest,tap('chest')*.7);
    const arch=Math.max(back,tap('back')*.82);
    const tailLook=Math.max(tap('tail')*.76,cue.tail*(zone==='tail'?.50:0));
    const slide=nuzzle*this.nuzzleSide*.030+earLean*.032+head*this.tapSide*.016
      +noseBack*.045-noseReach*.024+brace*.020+flank*.032+tailLook*.018;
    const rise=nuzzle*.043+chin*.078+chest*.064+arch*(.050+.020*pace)
      -backPress*.026*(1-arch)-head*.030-brace*.034-flank*this.contactLean*.042
      +noseBack*.032+noseReach*.013+tailLook*.030;
    const pitch=nuzzle*(.067+this.nuzzleSide*.030)+earLean*.128+chin*.117
      +head*(-.080+.028*pace)+arch*.096+flank*.075+tailLook*.115-brace*.054
      -noseBack*.045+noseReach*.055;
    // The neck leads, then the dog's weight arrives through the shoulder.
    this.neckPitch=approach(this.neckPitch,pitch,.070,.33);
    this.shoulderShift=approach(this.shoulderShift,slide,.115,.39);
    this.shoulderRise=approach(this.shoulderRise,rise,.14,.43);
    return nuzzle;
  }
  expression(dt,cue,nuzzle,lookBack){
    const approach=(from,to,seconds)=>from+(to-from)*-Math.expm1(-dt/seconds);
    const paired=this.rig.eyes.length===2;
    const hand=this.contactTexture??(this.nearNose?this.textureCoords(this.target.x,this.target.y):null);
    if(this.action||(this.contact&&this.pressed)){this.returnLookAt=-Infinity;this.returnTarget=null;}
    const releaseAge=this.motion.time-this.returnLookAt;
    const follow=smooth(.12,.36,releaseAge)*(1-smooth(.48,1.04,releaseAge));
    this.returnSniff=approach(this.returnSniff,follow,.08);
    const target=this.action?this.propLook:this.playTarget??hand??(releaseAge<.78?this.returnTarget:null);
    const [first,second=first]=this.rig.eyes;
    const gazeX=paired&&target?clamp((target.u-(first[0]+second[0])*.5)/.20,-1,1):0;
    const gazeY=paired&&target?clamp((target.v-(first[1]+second[1])*.5)/.32,-1,1):0;
    this.gazeX=approach(this.gazeX,gazeX,target ? .09 : .24);
    this.gazeY=approach(this.gazeY,gazeY,target ? .11 : .28);
    const ear=this.earIndex&&this.rig.secondEar?this.rig.secondEar:this.rig.ear;
    const softness=Math.max(cue.chin*.45,nuzzle*.72);
    const lids=[0,0];
    const touched=this.earIndex&&this.rig.secondEar?1:0;
    for(let i=0;i<this.earAngles.length;i++){
      const local=i===touched?cue.ear*.26-cue.earFold*(this.rig.uprightEar?.23:.27):0;
      this.earAngles[i]=approach(this.earAngles[i],local,i===touched?.026:.11);
    }
    for(let i=0;i<this.rig.eyes.length;i++){
      const near=!paired||Math.abs(this.rig.eyes[i][0]-ear[0])<Math.abs(this.rig.eyes[1-i][0]-ear[0]);
      const easedLid=Math.max(softness,cue.earFold*(near?.92:.28),Math.abs(cue.ear)*(near?.98:.22));
      this.earEase[i]=approach(this.earEase[i],easedLid,easedLid>this.earEase[i]?.06:.23);
      lids[i]=Math.max(cue.blink,this.earEase[i]);
    }
    // The ears orient as the ball starts moving, or just after the nose investigates a hand.
    const ballTime=this.action?.kind==='ball'?this.action.time:Infinity;
    const ball=smooth(.06,.22,ballTime)*(1-smooth(.58,.99,ballTime));
    this.listen=approach(this.listen,Math.max(ball,cue.sniff*.84,lookBack*.95,this.playTarget ? .60 : 0),.105);
    this.listenFar=approach(this.listenFar,this.rig.secondEar?this.listen*.72:0,.14);
    if(this.action||(this.contact&&(this.pressed||this.strokeTime>0)))this.breathRelease=-Infinity;
    const age=this.motion.time-this.breathRelease;
    const sigh=smooth(0,.36,age)*(1-smooth(.57,1.62,age));
    this.exhale=approach(this.exhale,sigh,.12);
    return lids;
  }
  frame(now){
    if(!this.ready)return;
    const time=now/1000,dt=Math.min((now-this.last)/1000||.016,.05);this.last=now;
    const approach=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
    const traveled=this.travelThisFrame;
    this.travelThisFrame=0;
    const sampleTime=Math.max(dt,.001);
    this.dx=approach(this.dx,clamp(this.strokeDeltaX/sampleTime,-1,1),traveled?22:6);
    this.dy=approach(this.dy,clamp(this.strokeDeltaY/sampleTime,-1,1),traveled?22:6);
    this.strokeDeltaX=0;this.strokeDeltaY=0;
    this.strokeGap=traveled>0?0:this.strokeGap+dt;
    this.brushPace=approach(this.brushPace,clamp(traveled/Math.max(dt,.010),0,5),9);
    // A quick pass along the flank draws a short glance back at the hand.
    // Require real travel; a jittery pointer or a jump across the room cannot trigger it.
    const onFlank=this.contact&&this.pressed&&(this.zone==='side'||this.zone==='back')&&!this.action;
    if(onFlank&&traveled<.16&&traveled/sampleTime>1.10)this.briskTravel+=traveled;
    else this.briskTravel=onFlank?Math.max(0,this.briskTravel-dt*.9):0;
    if(this.briskTravel>.105&&this.motion.time-this.lookBackAt>3.5){
      this.lookBackAt=this.motion.time;this.briskTravel=0;
    }
    if(this.action||(this.contact&&!onFlank))this.lookBackAt=-Infinity;
    const glanceAge=this.motion.time-this.lookBackAt;
    const lookBack=smooth(0,.17,glanceAge)*(1-smooth(.31,.88,glanceAge));
    const movementThreshold=this.zone==='back'?.006:this.zone==='nose'?.0018:.0033;
    const moved=this.motionPending>movementThreshold;
    if(moved){this.strokeTime=.21;this.stillTime=0;this.motionPending=0;}
    else if(this.strokeGap>.22)this.motionPending=0;
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
        this.ballWaiting=kind==='ball';
        if(this.prop)this.prop.dataset.visible=String(this.ballWaiting);
        if(this.catchBall)this.catchBall.hidden=!this.ballWaiting;
      }
    }
    // A resting palm stays in screen space while the shoulder beneath it
    // moves. Keep the pressed patch under that palm between pointer events.
    if(this.contact&&this.pressed&&this.pose&&coatZones.has(this.zone)&&this.zone!=='tail'){
      const at=this.contactCoords(this.target.x,this.target.y);
      if(this.hit(at.u,at.v)){
        this.furTouch=at;
        if(this.zone==='head')this.headTouch=at;
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
    const pile=this.rig.pile;
    const furRate=(furTarget>this.furPress?18:14)/pile;
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
    this.speed=approach(this.speed,clamp(traveled/Math.max(.001,dt)*.92),traveled>0?24:6);
    this.pat*=Math.exp(-dt*8.5);
    const handRate=32+this.speed*34;
    const follow=this.pressed&&this.contact?1:1-Math.exp(-dt*handRate);
    this.handPosition.x+=(this.petTarget.x-this.handPosition.x)*follow;
    this.handPosition.y+=(this.petTarget.y-this.handPosition.y)*follow;
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
    const contactY=this.handPosition.y*this.height;
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
    this.cupLean=approach(this.cupLean,this.cupDirection,5);
    const lure=this.playTarget;
    const liftToward=lure?clamp((this.rig.touch.nose[1]-lure.v)*.10,-.024,.045):0;
    const turnToward=lure?clamp((lure.u-this.face.head[0])*.18,-.060,.075):0;
    this.headResponse=approach(this.headResponse,lift+liftToward+this.playSniff*.012,5.8);
    this.headTurn=approach(this.headTurn,cue.tilt*.060+this.noseLook+turnToward,5.2);
    this.relax=approach(this.relax,resting?1:0,3);
    const careEnd=this.action?propDuration[this.action.kind]:0;
    const careWeight=this.action?smooth(0,.21,this.action.time)*(1-smooth(careEnd-.30,careEnd,this.action.time)):0;
    const nuzzle=this.followTouch(dt,zone,cue,forceTarget);
    const lids=this.expression(dt,cue,nuzzle,lookBack);
    this.sniffBreath=Math.max(cue.sniff,this.returnSniff*.70,this.playSniff);
    this.breathPhase+=dt*(1.35-this.relax*.22);
    const tailAge=this.motion.time-this.tapAt;
    const tailPerk=!this.action&&this.tapPart==='tail'
      ?smooth(0,.15,tailAge)*(1-smooth(.26,.74,tailAge))*(1-Math.max(this.tailCurl,this.tailStraight)):0;
    const pose={
      tailPerk:tailPerk*motion,
      earLocalA:this.earAngles[0]*motion,earLocalB:this.earAngles[1]*motion,
      listen:this.listen*motion,listenFar:this.listenFar*motion,
      shoulderShift:(this.shoulderShift+this.cupLean*.025)*motion,shoulderRise:(this.shoulderRise-this.exhale*.049)*motion,neckPitch:(this.neckPitch-this.exhale*.021+lookBack*.135)*motion,
      touchX,touchY,pressX,pressY,
      coatDepth:['chest','side','back'].includes(surfaceZone)?pressure*pile*motion:0,
      careWeight:careWeight*motion,ballReach:this.action?.kind==='ball',
      headLift:(this.headResponse+this.returnSniff*.012)*motion,
      headTurn:this.headTurn*motion,
      breath:(Math.sin(this.breathPhase)*(.011+this.relax*.015)-this.exhale*.049)*motion,
      wag:Math.sin(this.tailPhase)*Math.max(this.wag,this.cupJoy*.82)*motion*(1-.8*Math.max(this.tailStraight,this.tailCurl)),
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
      furPress:this.furPress*pile*motion,
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
      gl.uniform4f(this.uniforms.uExpression,lids[0]*motion,lids[1]*motion,this.gazeX*motion,this.gazeY*motion);
      gl.uniform1f(this.uniforms.uFurPress,this.furPress);
      gl.uniform1f(this.uniforms.uCoatTrailActive,coatActive?1:0);
      if(coatActive)gl.uniform4fv(this.uniforms['uCoatTrail[0]'],coat);
      gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
    }else{
      const ctx=this.ctx,dpr=this.canvas.width/this.width;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.width,this.height);
      const texture=this.canvasEyes?.update(lids.map(lid=>lid*motion),this.gazeX*motion,this.gazeY*motion)??this.image;
      this.drawCanvasPose(ctx,pose,dpr,texture);
      if(coatActive)this.drawBrushedCoat(ctx,coat);
      if(pressure>.012||this.furPress>.012)this.drawContactShadow(ctx,touchX,touchY,pressure,pressX,pressY);
    }
    this.stage.dataset.contact=String(this.contact);this.stage.dataset.wagging=String(this.wag>.1);
    this.stage.dataset.reaction=this.action?.kind??(resting?'rest':this.zone);
    if(this.contact||tapped){this.feedbackZone=zone;this.feedbackPaw=pawIndex;this.feedbackTime=.68;}
    else if(motion&&this.exhale>.18)this.feedbackTime=.14;
    else this.feedbackTime=Math.max(0,this.feedbackTime-dt);
    const feedback=this.feedbackTime>0&&!this.action?this.feedbackZone:'idle';
    if(this.stage.dataset.touchZone!==feedback)this.stage.dataset.touchZone=feedback;
    const pawFeedback=feedback==='paw'?String(this.feedbackPaw+1):'';
    if(this.stage.dataset.touchPaw!==pawFeedback)this.stage.dataset.touchPaw=pawFeedback;
    const localFeedback=feedback==='idle'?'idle':this.strokeTime>0&&coatActive?'brush':contactInk>.10?'touch':'idle';
    const behavior=this.action?cue.behavior
      :motion&&lookBack>.37&&(feedback==='side'||feedback==='back')?'look-back'
      :motion&&this.exhale>.18&&(feedback==='chest'||feedback==='back')?'exhale'
      :motion&&feedback===this.nuzzleZone&&nuzzle>.42?'nuzzle'
      :motion&&headContact&&cue.blink>.60?'head-soften'
      :feedback==='head'&&this.furPress>.15?'fur-press'
      :!motion?localFeedback
      :feedback==='tail'&&pose.tailCurl>.16&&pose.tailCurl>pose.tailStraight?'tail-curl'
      :feedback==='tail'&&pose.tailStraight>.15&&tailDirection>.055?'tail-straight'
      :feedback==='ear'&&pose.earFold>.25&&Math.abs(pose.ear)<.12?'ear-fold'
      :(!this.gl&&cue.behavior==='blink')||cue.behavior==='watch'||cue.behavior==='idle'?localFeedback:cue.behavior;
    if(this.stage.dataset.behavior!==behavior)this.stage.dataset.behavior=behavior;
  }
  drawCanvasPose(ctx,pose,dpr,texture){
    // At rest only the ribcage moves. A single strip per column gives the
    // same vertical breathing transform without drawing the joint mesh.
    const activity=Math.abs(pose.shoulderShift)+Math.abs(pose.shoulderRise)+Math.abs(pose.neckPitch)
      +Math.abs(pose.headLift)+Math.abs(pose.headTurn)+Math.abs(pose.ear)+pose.earFold+Math.abs(pose.earLocalA)+Math.abs(pose.earLocalB)+pose.listen+pose.listenFar+pose.chin
      +pose.sniff+pose.paw+pose.stretch+pose.side+pose.chest+pose.back+pose.furPress+pose.coatDepth
      +Math.abs(pose.wag)+pose.tailStraight+pose.tailCurl;
    if(activity<.0005){
      const b=this.bounds,sw=this.image.width/64;
      for(let i=0;i<64;i++){
        const u=i/64,depth=torso(u)*(this.thickness-1)+smooth(.27,.48,u)*(1-smooth(.66,.84,u))*pose.breath;
        ctx.drawImage(texture,i*sw,0,Math.min(sw+1,this.image.width-i*sw),this.image.height,
          b.x+b.w*u,b.y-b.h*.47*depth,b.w/64+1,b.h*(1+depth));
      }
      return;
    }
    // Each patch follows the same joints used for picking and WebGL. One
    // device pixel of overlap keeps adjacent patch edges joined on rotation.
    const cols=canvasCols,rows=canvasRows,stride=cols+1,sw=this.image.width/cols,sh=this.image.height/rows;
    const points=this.canvasMesh??=new Array(stride*(rows+1));
    for(let y=0;y<=rows;y++)for(let x=0;x<=cols;x++)
      points[y*stride+x]=this.deform(x/cols,y/rows,pose);
    for(let y=0;y<rows;y++)for(let x=0;x<cols;x++){
      if(!this.canvasTiles[y*cols+x])continue;
      const index=y*stride+x,a=points[index],b=points[index+1],c=points[index+stride],d=points[index+stride+1];
      const ax=(b.x-a.x+d.x-c.x)/2,ay=(b.y-a.y+d.y-c.y)/2;
      const bx=(c.x-a.x+d.x-b.x)/2,by=(c.y-a.y+d.y-b.y)/2;
      const left=(a.x+b.x+c.x+d.x)/4-(ax+bx)/2,top=(a.y+b.y+c.y+d.y)/4-(ay+by)/2;
      ctx.setTransform(ax*dpr,ay*dpr,bx*dpr,by*dpr,left*dpr,top*dpr);
      const overlapX=x+1<cols?Math.min(.12,1/(Math.hypot(ax,ay)*dpr)):0;
      const overlapY=y+1<rows?Math.min(.12,1/(Math.hypot(bx,by)*dpr)):0;
      ctx.drawImage(texture,x*sw,y*sh,sw*(1+overlapX),sh*(1+overlapY),0,0,1+overlapX,1+overlapY);
    }
    ctx.setTransform(dpr,0,0,dpr,0,0);
  }
  drawContactShadow(ctx,touchX,touchY,pressure,pressX,pressY){
    ctx.save();
    ctx.globalCompositeOperation='source-atop';
    for(const [u,v,strength] of [[touchX,touchY,pressure*.26],[pressX,pressY,this.furPress*.22]]){
      if(strength<.01)continue;
      const {x,y}=this.deform(u,v,this.pose),radius=this.bounds.w*.056;
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
      const {x,y}=this.deform(coat[i],coat[i+1],this.pose);
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
