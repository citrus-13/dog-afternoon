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
const vertexShader=`attribute vec2 aPosition;attribute vec2 aUV;varying vec2 vUV;void main(){vUV=aUV;gl_Position=vec4(aPosition,0.,1.);}`;
const fragmentShader=`precision mediump float;
uniform sampler2D uImage;
uniform vec2 uTouch;
uniform vec2 uDirection;
uniform float uContact;
varying vec2 vUV;
void main(){
  vec4 coat=texture2D(uImage,vUV);
  vec2 offset=(vUV-uTouch)*vec2(1.,.60);
  float contact=uContact*exp(-dot(offset,offset)*175.);
  vec2 brushedUV=vUV-uDirection*contact*.0024;
  vec4 brushed=texture2D(uImage,brushedUV);
  float inside=smoothstep(.85,.99,min(coat.a,brushed.a));
  vec3 fur=mix(coat.rgb,brushed.rgb,inside);
  gl_FragColor=vec4(fur*(1.-contact*.072),coat.a);
}`;

export class DogScene{
  constructor(canvas,stage,hand){
    this.canvas=canvas;this.stage=stage;this.hand=hand;
    this.size=1;this.thickness=1;this.pet=0;this.wag=0;this.speed=0;this.dx=0;this.dy=0;
    this.target={x:.50,y:.52};this.touch={...this.target};this.handPosition={...this.target};
    this.petTarget={...this.target};
    this.pat=0;
    this.familiarity=0;
    this.headResponse=0;
    this.wagStrength=0;
    this.tailPhase=0;
    this.tail=tailRoot.sheepdog;
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
    this.uniforms=Object.fromEntries(['uTouch','uDirection','uContact','uImage'].map(k=>[k,gl.getUniformLocation(program,k)]));
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
    if(id)this.tail=tailRoot[id]??tailRoot.sheepdog;
    const sample=document.createElement('canvas');sample.width=200;sample.height=100;const ctx=sample.getContext('2d',{willReadFrequently:true});ctx.drawImage(img,0,0,200,100);this.alpha=ctx.getImageData(0,0,200,100).data;
    if(this.gl){this.gl.bindTexture(this.gl.TEXTURE_2D,this.texture);this.gl.texImage2D(this.gl.TEXTURE_2D,0,this.gl.RGBA,this.gl.RGBA,this.gl.UNSIGNED_BYTE,img);}
    this.ready=true;
    this.pet=0;
    this.wag=0;
    this.pat=0;
    this.familiarity=0;
    this.headResponse=0;
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
  }
  hit(x,y){
    if(!this.ready||!this.bounds)return false;
    const {x:bx,y:by,w,h}=this.bounds,u=(x*this.width-bx)/w,v=(y*this.height-by)/h;
    if(u<0||u>=1||v<0||v>=1)return false;
    return this.alpha[4*(Math.floor(v*100)*200+Math.floor(u*200))+3]>35;
  }
  point(x,y){
    const previous=this.target;
    const wasContact=this.contact;
    const distance=Math.hypot(x-previous.x,(y-previous.y)*this.height/this.width);
    this.target={x,y};
    this.contact=this.hit(x,y);
    if(!this.contact)return;
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
    this.accumulateTouch(Math.min(distance*widthRatio,.075));
  }
  press(x,y){
    this.point(x,y);
    if(!this.contact)return;
    this.pat=1;
    this.accumulateTouch(.13);
  }
  accumulateTouch(amount){
    this.familiarity=clamp(this.familiarity+amount);
    this.wagTail(.88*smooth(.20,.62,this.familiarity));
  }
  leave(){this.contact=false;this.speed=0;}
  wagTail(strength=1){this.wagStrength=Math.max(this.wagStrength,strength);}
  deform(u,v,pose){
    const {x,y,w,h}=this.bounds;
    const distance=(u-pose.touchX)**2*1.8+(v-pose.touchY)**2*.65;
    const underHand=Math.exp(-distance*115)*pose.pressure;
    const tail=smooth(this.tail.x,.98,u)*smooth(this.tail.y-.10,this.tail.y+.10,v);
    const chest=smooth(.27,.43,u)*(1-smooth(.64,.81,u));
    const head=(1-smooth(.19,.43,u))*(1-smooth(.65,.88,v))*pose.headLift;
    return {
      x:x+w*(u+underHand*pose.shearX-tail*(v-this.tail.y)*pose.wag*.027),
      y:y+h*(v+underHand*pose.shearY+chest*(v-.47)*pose.breath-head+tail*pose.wag*.049)
    };
  }
  frame(now){
    if(!this.ready)return;
    const time=now/1000,dt=Math.min((now-this.last)/1000||.016,.05);this.last=now;
    const approach=(a,b,rate)=>a+(b-a)*(1-Math.exp(-dt*rate));
    this.pet=approach(this.pet,this.contact?1:0,this.contact?19:10);
    this.wag=approach(this.wag,this.wagStrength,14);
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
    const headTouch=(1-smooth(.19,.40,touchX))*Math.max(this.pet*.55,this.pat);
    this.headResponse=approach(this.headResponse,headTouch,8);
    const pose={
      touchX,touchY,
      pressure:Math.max(this.pet,this.pat)*motion,
      shearX:this.dx*.014,
      shearY:.011+this.dy*.013+this.pat*.015,
      headLift:this.headResponse*.021*motion,
      breath:Math.sin(time*1.35)*.011*motion,
      wag:Math.sin(this.tailPhase)*this.wag*motion
    };
    if(this.gl){
      const gl=this.gl;
      for(let i=0;i<this.uv.length;i+=2){const p=this.deform(this.uv[i],this.uv[i+1],pose);this.positions[i]=p.x/this.width*2-1;this.positions[i+1]=1-p.y/this.height*2;}
      gl.clear(gl.COLOR_BUFFER_BIT);gl.useProgram(this.program);gl.bindBuffer(gl.ARRAY_BUFFER,this.positionBuffer);gl.bufferSubData(gl.ARRAY_BUFFER,0,this.positions);
      gl.uniform2f(this.uniforms.uTouch,touchX,touchY);gl.uniform2f(this.uniforms.uDirection,this.dx,this.dy);gl.uniform1f(this.uniforms.uContact,Math.max(this.pet,this.pat));
      gl.drawElements(gl.TRIANGLES,this.indexCount,gl.UNSIGNED_SHORT,0);
    }else{
      const ctx=this.ctx,dpr=this.canvas.width/this.width;ctx.setTransform(dpr,0,0,dpr,0,0);ctx.clearRect(0,0,this.width,this.height);
      const strips=64,sw=this.image.width/strips;
      for(let x=0;x<strips;x++){
        const u=x/strips;
        const v=u>this.tail.x?this.tail.y+.11:.5;
        const p=this.deform(u,v,pose);
        ctx.drawImage(this.image,x*sw,0,sw+1,this.image.height,p.x,p.y-v*b.h,b.w/strips+1,b.h);
      }
    }
    this.stage.dataset.contact=String(this.contact);this.stage.dataset.wagging=String(this.wag>.1);
  }
  destroy(){this.observer.disconnect();if(this.gl){const gl=this.gl;gl.deleteTexture(this.texture);gl.deleteProgram(this.program);for(const b of [this.positionBuffer,this.uvBuffer,this.indexBuffer])gl.deleteBuffer(b);}}
}
