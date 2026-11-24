import {DogMotion} from './motion.js?v=distinct-pets-8';
import {dogRig} from './motion-rig.js?v=distinct-pets-8';
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
  bichon:{x:.795,y:.52}
};
// Coordinates are measured on the transparent cutouts, so the same gestures
// follow the dog's anatomy when the stage or proportions change.
const face={
  sheepdog:{head:[.20625,.34167],chin:[.29125,.77250]},
  cockapoo:{head:[.224,.32],chin:[.325,.784]},
  golden:{head:[.263,.34],chin:[.135,.63]},
  shiba:{head:[.174,.34],chin:[.120,.63]},
  samoyed:{head:[.171,.39],chin:[.127,.67]},
  bichon:{head:[.258,.350],chin:[.282,.681]}
};
const back=[.58,.40];
const pointZones=['nose','paw','tail','ear','chest','side'];
const coatZones=new Set(['head','ear','chin','chest','side','back','tail']);
const restingZones=new Set(['head','chest','back']);
const coatPressure={head:.58,ear:.26,chin:.18,chest:.38,side:.44,back:.75,tail:.22};
const regionRadius=(u,v,[cx,cy,rx,ry])=>((u-cx)/rx)**2+((v-cy)/ry)**2;
const regionWeight=(u,v,region,falloff=.68)=>Math.exp(-regionRadius(u,v,region)*falloff);
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
uniform vec2 uTouch;
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
  vec2 offset=(vUV-uTouch)*vec2(1.,.60);
  float contact=uContact*exp(-dot(offset,offset)*175.);
  float press=uFurPress*exp(-dot(offset,offset)*280.);
  vec3 trail=coatTrail(vUV);
  vec2 brushedUV=coatUV-uDirection*contact*.0019-vec2(0.,press*.0048)-trail.xy*.007;
  vec4 brushed=texture2D(uImage,brushedUV);
  float inside=smoothstep(.85,.99,min(coat.a,brushed.a));
  vec3 fur=mix(coat.rgb,brushed.rgb,inside);
  float rim=press*smoothstep(-.055,.055,-offset.y);
  vec2 grain=normalize(vec2(1.,mix(.37,.16,smoothstep(.34,.57,vUV.x))));
  float lay=inside*(dot(trail.xy,grain)*-.036-trail.z*.012);
  gl_FragColor=vec4(fur*(1.-contact*.055-press*.040-rim*.035+lay),coat.a);
}`;

export class DogScene{
  constructor(canvas,stage,hand){
    this.canvas=canvas;this.stage=stage;this.hand=hand;
    this.size=1;this.thickness=1;this.pet=0;this.wag=0;this.speed=0;this.dx=0;this.dy=0;
    this.target={x:.50,y:.52};this.touch={...this.target};this.handPosition={...this.target};
    this.petTarget={...this.target};
    this.pat=0;
    this.headResponse=0;this.headTurn=0;this.relax=0;
    this.wagStrength=0;
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
    this.coatTrail=new CoatTrail();
    this.contactTexture=null;
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
    this.pawIndex=0;
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
    const horizontal=part?Math.min(.025,part[2]*.36):zone==='back'?.128:.028;
    const vertical=part?Math.min(.017,part[3]*.30):.015;
    const u=centerU+Math.sin(phase*4.1)*horizontal,v=centerV+Math.sin(phase*3.1)*vertical;
    if(!this.gl||!this.pose)return this.stageCoords(u,v);
    const point=this.deform(u,v,this.pose);
    return {x:point.x/this.width,y:point.y/this.height};
  }
  touchZone(u,v){
    let best=null,bestDistance=Infinity;
    for(const zone of pointZones){
      const areas=zone==='paw'?this.rig.paws:zone==='ear'?[this.rig.ear]:[this.rig.touch?.[zone]];
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
    const {w,h}=this.bounds;
    for(let iteration=0;iteration<3;iteration++){
      const surface=this.deform(point.u,point.v,this.pose);
      point.u+=(x*this.width-surface.x)/w;
      point.v+=(y*this.height-surface.y)/h;
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
    const at=this.contactCoords(x,y);
    const {u,v}=at;
    if(this.pressed&&Number.isFinite(force))this.inputPressure=clamp(force);
    this.contact=this.hit(u,v);
    const zone=this.contact?this.touchZone(u,v):'idle';
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
    if(previousCoat&&coatZones.has(previousZone)&&coatZones.has(zone)&&!this.action&&!this.reduce.matches&&
      this.hit((previousCoat.u+u)*.5,(previousCoat.v+v)*.5)){
      this.coatTrail.trace(previousCoat,at,this.pressed ? this.inputPressure??.65 : .38);
    }
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
    this.travelThisFrame+=moved;
  }
  press(x,y,force){
    this.pressed=true;
    this.inputPressure=Number.isFinite(force)?clamp(force):undefined;
    this.point(x,y,force);
    if(!this.contact)return;
    this.stillTime=0;
    this.pressAge=0;
    this.pat=1;
    this.pendingTap={zone:this.zone,paw:this.pawIndex};
    if(this.zone==='head')this.headTap=.32;
    if(this.zone==='tail')this.tailTap=.43;
  }
  leave(){
    this.contact=false;this.speed=0;this.zone='idle';this.pressed=false;
    this.stillTime=0;this.strokeTime=0;this.motionPending=0;this.travelThisFrame=0;
    this.contactTexture=null;this.inputPressure=undefined;this.pressAge=0;this.nearNose=false;
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
    const root=this.tail;
    const alignedY=root.y+(u-root.x)*(root.slope??.49);
    const tailBand=root.extended?Math.exp(-(((v-alignedY)/.117)**2)):smooth(root.y-.10,root.y+.10,v);
    const tail=smooth(root.x,.98,u)*tailBand;
    const chest=smooth(.27,.43,u)*(1-smooth(.64,.81,u));
    const pivot=Math.max(this.face.head[0],this.face.chin[0])+.106;
    const head=(1-smooth(pivot-.025,pivot+.115,u))*(1-.82*smooth(.63,.93,v));
    const shoulder=chest*(1-smooth(.42,.83,v));
    const bodyShape=torso(u)*(v-.47)*(this.thickness-1);
    let ear=0,earFold=0,earDirection=0;
    if(Math.abs(pose.ear)>.001||pose.earFold>.001){
      const [ex,ey,rx,ry,direction]=this.rig.ear;
      const alongEar=(v-ey)/ry;
      const weight=Math.exp(-(((u-ex)/(rx*1.20))**2+(alongEar/1.15)**2));
      ear=weight*pose.ear;
      const tip=direction<0?smooth(-.72,.64,alongEar):1-smooth(-.65,.75,alongEar);
      earFold=weight*tip*pose.earFold;
      earDirection=direction;
    }
    let paw=0;
    if(pose.stretch>.001&&u<.46&&v>.53){
      for(const [px,py,rx,ry] of this.rig.paws){
        const radius=((u-px)/(rx*1.40))**2+((v-py)/(ry*1.45))**2;
        paw=Math.max(paw,Math.exp(-radius));
      }
      paw*=smooth(.53,.65,v)*(1-smooth(.37,.46,u));
    }
    const stretch=pose.stretch;
    const nose=pose.sniff>.001?pose.sniff*regionWeight(u,v,this.rig.touch.nose):0;
    let recoil=0,toes=0;
    if(pose.paw>.001){
      for(let index=0;index<this.rig.paws.length;index++){
        const strength=index===0?pose.pawA:pose.pawB;
        if(!(strength>.001))continue;
        const region=this.rig.paws[index];
        const local=strength*regionWeight(u,v,region,.43);
        recoil=Math.max(recoil,local);
        toes=Math.max(toes,local*(1-smooth(-.70,.12,(u-region[0])/region[2])));
      }
    }
    let chin=0;
    if(pose.chin>.001){
      const [noseX,noseY]=this.rig.touch.nose;
      const [chinX,chinY]=this.face.chin;
      const pivotX=(noseX+chinX)*.5,pivotY=(noseY+chinY)*.5;
      chin=pose.chin*Math.exp(-(((u-pivotX)/.102)**2+((v-pivotY)/.166)**2));
    }
    const chestRegion=this.rig.touch.chest;
    const softChest=pose.chest>.001?pose.chest*regionWeight(u,v,chestRegion,.43):0;
    const inhale=softChest*(-.044+(v-chestRegion[1])*.12);
    const lean=pose.side>.001?pose.side*regionWeight(u,v,this.rig.touch.side,.56):0;
    const headFur=pose.furPress>.001?Math.exp(-distance*154)*pose.furPress:0;
    const backWave=pose.back>.001?pose.back*Math.exp(-(((u-pose.touchX-.035)/.165)**2+((v-pose.touchY)/.148)**2)):0;
    let tailOut=0,tailAlign=0;
    if(pose.tailStraight>.001){
      const [tipX,tipY,,tipRadiusY]=this.rig.touch.tail;
      const along=smooth(root.x-.025,Math.max(tipX,root.x+.044),u);
      const band=root.extended?tailBand:Math.exp(-(((v-(tipY+root.y)*.5)/(tipRadiusY*1.65))**2));
      const straighten=pose.tailStraight*along*band;
      tailOut=pose.tailReach*straighten;
      // Relax the tip toward the direction of the tail's root. Keep the
      // actual fur texture and its contour linked to the base of the tail.
      tailAlign=(alignedY-v)*straighten*.40;
    }
    return {
      x:x+w*(u+underHand*pose.shearX-head*(v-.45)*pose.headTurn*.52
        -tail*(v-root.y)*pose.wag*.034-stretch*(paw*.034+shoulder*.011)
        +(ear*.012-earFold*.032)*earDirection
        -nose*.019+recoil*.036+toes*.008-chin*.015-softChest*.017+lean*.014+tailOut),
      y:y+h*(v+bodyShape+underHand*pose.shearY+chest*(v-.47)*pose.breath
        +head*((u-pivot)*pose.headTurn*1.5-pose.headLift)
        +tail*pose.wag*.063+stretch*(paw*.026-shoulder*.026)-ear*.022+earFold*.037
        +headFur*.049-nose*.012-recoil*.028-toes*.012-chin*.076+inhale
        +lean*.061+backWave*.022+tailAlign)
    };
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
    const forceTarget=!this.contact ? 0 : this.pressed ? heldDepth : .27;
    this.contactForce=approach(this.contactForce,forceTarget,19);
    const cue=this.motion.step(dt,{zone,contact:this.contact,resting,action:this.action,bond:this.bond,
      comfort:this.comfort,rubbing:this.strokeTime>0,tapped:Boolean(tapped),pawIndex,sniffHand:this.noseDwell>.28,
      pressure:this.contactForce});
    const furTarget=this.action ? 0 : headContact ? forceTarget : .43*smooth(0,.32,this.headTap);
    const tailStroke=.15*smooth(.01,.29,this.dx)-.22*smooth(.01,.33,-this.dx);
    const tailTarget=tailContact ? .52+(this.pressed ? .33 : 0)+tailStroke : this.tailTap*1.78;
    // A critically damped return preserves the movement's momentum without
    // making the coat bounce past its rest position.
    const furRate=furTarget>this.furPress?18:14;
    const offset=this.furPress-furTarget;
    const carry=this.furVelocity+furRate*offset;
    const decay=Math.exp(-furRate*dt);
    this.furPress=clamp(furTarget+(offset+carry*dt)*decay);
    this.furVelocity=(this.furVelocity-furRate*carry*dt)*decay;
    this.tailStraight=approach(this.tailStraight,this.action?0:tailTarget,tailTarget>this.tailStraight?9:5.8);
    this.pet=approach(this.pet,this.contact?1:0,this.contact?19:10);
    this.wag=approach(this.wag,Math.max(this.wagStrength,cue.tail),8);
    this.wagStrength*=Math.exp(-dt*1.1);
    this.tailPhase+=dt*(10+this.wag*3);
    this.speed*=Math.exp(-dt*5);
    this.dx*=Math.exp(-dt*5);
    this.dy*=Math.exp(-dt*5);
    this.pat*=Math.exp(-dt*8.5);
    this.touch.x=approach(this.touch.x,this.petTarget.x,27);this.touch.y=approach(this.touch.y,this.petTarget.y,27);
    this.handPosition.x=approach(this.handPosition.x,this.petTarget.x,32);
    this.handPosition.y=approach(this.handPosition.y,this.petTarget.y,32);
    this.handAlpha=approach(this.handAlpha,this.contact||this.pat>.18?1:0,17);
    const b=this.bounds;
    const motion=this.reduce.matches?0:1;
    const {width:handWidth,height:handHeight}=this.handSize;
    const handX=this.handPosition.x*this.width-handWidth*.24;
    const handY=this.handPosition.y*this.height-handHeight*.17+this.furPress*b.h*.027*motion;
    // Extend only the sleeve so the fingers keep their scale and the arm exits the frame.
    const sleeveLength=handHeight*.32;
    const sleeveStretch=Math.max(1,(this.height-handY+8-handHeight*.68)/sleeveLength);
    this.hand.style.setProperty('--sleeve-stretch',sleeveStretch.toFixed(3));
    const handAngle=this.reduce.matches?0:this.dx*2;
    this.hand.style.transform=`translate3d(${handX}px,${handY}px,0) rotate(${handAngle}deg)`;
    this.hand.style.opacity=String(this.handAlpha);
    const touchX=(this.touch.x*this.width-b.x)/b.w;
    const touchY=(this.touch.y*this.height-b.y)/b.h;
    const pressure=this.action?0:Math.max(this.pet,this.pat)*(coatPressure[tapped?.zone??this.feedbackZone]??0);
    const targetNoseX=(this.target.x*this.width-b.x)/b.w-this.rig.touch.nose[0];
    this.noseLook=approach(this.noseLook,this.nearNose&&!this.action?clamp(targetNoseX*.29,-.038,.028):0,4.5);
    const lift=cue.nod*.117*(1-this.furPress*.76);
    this.headResponse=approach(this.headResponse,lift,5.8);
    this.headTurn=approach(this.headTurn,cue.tilt*.087+this.noseLook,5.2);
    this.relax=approach(this.relax,resting?1:0,3);
    const pose={
      touchX,touchY,
      pressure:pressure*motion,
      shearX:this.dx*.009,
      shearY:.008+this.dy*.009+this.pat*.009,
      headLift:this.headResponse*motion,
      headTurn:this.headTurn*motion,
      breath:Math.sin(time*1.35)*(.011+this.relax*.015)*motion,
      wag:Math.sin(this.tailPhase)*this.wag*motion*(1-.8*this.tailStraight),
      stretch:cue.stretch*motion,
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
      tailReach:clamp((this.width*.990-b.x)/b.w-this.tailEdge,0,.078)
    };
    this.pose=pose;
    const coat=this.coatTrail.update(dt);
    const coatActive=Boolean(motion&&this.coatTrail.active);
    if(this.stage.dataset.coatBrushed!==String(coatActive))this.stage.dataset.coatBrushed=String(coatActive);
    if(this.gl){
      const gl=this.gl;
      for(let i=0;i<this.uv.length;i+=2){const p=this.deform(this.uv[i],this.uv[i+1],pose);this.positions[i]=p.x/this.width*2-1;this.positions[i+1]=1-p.y/this.height*2;}
      gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.positions);
      gl.uniform2f(this.uniforms.uTouch,touchX,touchY);gl.uniform2f(this.uniforms.uDirection,this.dx,this.dy);gl.uniform1f(this.uniforms.uContact,pressure);
      gl.uniform1f(this.uniforms.uBlink,cue.blink*motion);
      gl.uniform1f(this.uniforms.uFurPress,pose.furPress);
      gl.uniform1f(this.uniforms.uCoatTrailActive,coatActive?1:0);
      if(coatActive)gl.uniform4fv(this.uniforms['uCoatTrail[0]'],coat);
      gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
    }else{
      const ctx=this.ctx,dpr=this.canvas.width/this.width;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.width,this.height);
      const strips=64,sw=this.image.width/strips;
      for(let x=0;x<strips;x++){
        const u=x/strips;
        const v=u>this.tail.x-.03?this.rig.touch.tail[1]
          :Math.abs(u-pose.touchX)<.16&&this.feedbackZone!=='idle'?pose.touchY:.5;
        const p=this.deform(u,v,pose);
        const next=this.deform((x+1)/strips,v,pose);
        const stripHeight=b.h*(1+torso(u)*(this.thickness-1));
        ctx.drawImage(this.image,x*sw,0,Math.min(sw+1,this.image.width-x*sw),this.image.height,p.x,p.y-v*stripHeight,Math.max(1,next.x-p.x+1),stripHeight);
      }
      if(coatActive)this.drawBrushedCoat(ctx,coat,pose);
    }
    this.stage.dataset.contact=String(this.contact);this.stage.dataset.wagging=String(this.wag>.1);
    this.stage.dataset.reaction=this.action?.kind??(resting?'rest':this.zone);
    if(this.contact||tapped){this.feedbackZone=zone;this.feedbackPaw=pawIndex;this.feedbackTime=.68;}
    else this.feedbackTime=Math.max(0,this.feedbackTime-dt);
    const feedback=this.feedbackTime>0&&!this.action?this.feedbackZone:'idle';
    if(this.stage.dataset.touchZone!==feedback)this.stage.dataset.touchZone=feedback;
    const pawFeedback=feedback==='paw'?String(this.feedbackPaw+1):'';
    if(this.stage.dataset.touchPaw!==pawFeedback)this.stage.dataset.touchPaw=pawFeedback;
    const behavior=!motion?'idle':this.action?cue.behavior
      :feedback==='tail'&&pose.tailStraight>.15?'tail-straight'
      :feedback==='head'&&pose.furPress>.19?'fur-press'
      :feedback==='ear'&&pose.earFold>.25&&Math.abs(pose.ear)<.12?'ear-fold':cue.behavior;
    if(this.stage.dataset.behavior!==behavior)this.stage.dataset.behavior=behavior;
  }
  drawBrushedCoat(ctx,coat,pose){
    const radius=this.bounds.w*.070;
    ctx.save();
    ctx.globalCompositeOperation='source-atop';
    for(let i=0;i<coat.length;i+=4){
      const dx=coat[i+2],dy=coat[i+3],strength=Math.hypot(dx,dy);
      if(strength<.012)continue;
      const p=this.deform(coat[i],coat[i+1],pose);
      const gradient=ctx.createRadialGradient(p.x,p.y,0,p.x,p.y,radius);
      const color=dx+dy*.24<0?'255,247,230':'39,30,24';
      gradient.addColorStop(0,`rgba(${color},${.057*strength})`);
      gradient.addColorStop(1,`rgba(${color},0)`);
      ctx.fillStyle=gradient;
      ctx.fillRect(p.x-radius,p.y-radius,radius*2,radius*2);
    }
    ctx.restore();
  }
  destroy(){this.observer.disconnect();if(this.gl){const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteProgram(this.program);for(const b of [this.positionBuffer,this.uvBuffer,this.indexBuffer])gl.deleteBuffer(b);}}
}
