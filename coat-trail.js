const SLOTS=6,SPACING=.030,LIFETIME=1.85;
const clamp=n=>Math.max(0,Math.min(1,n));
const valid=p=>p&&Number.isFinite(p.u)&&Number.isFinite(p.v)&&p.u>=0&&p.u<=1&&p.v>=0&&p.v<=1;
// Lengths use image-width units: the transparent cutouts have a 2:1 aspect.
const distance=(du,dv)=>Math.hypot(du,dv*.5);

export class CoatTrail{
  constructor(){
    this.active=false;
    this._values=new Float32Array(SLOTS*4);
    this._marks=Array.from({length:SLOTS},()=>({u:0,v:0,du:0,dv:0,power:0,age:LIFETIME}));
    this._cursor=0;this._remaining=SPACING/3;
    this._lastU=0;this._lastV=0;this._gap=Infinity;
  }
  trace(from,to,pressure=.5){
    pressure=Number.isFinite(pressure)?clamp(pressure):.5;
    if(!valid(from)||!valid(to)||pressure<=0){this._gap=Infinity;return;}
    const du=to.u-from.u,dv=to.v-from.v,length=distance(du,dv);
    // A re-entry or pointer teleport must not brush across unvisited fur.
    if(length>.18){this._gap=Infinity;return;}
    if(length<.000001)return;
    const continuous=this._gap<.22&&distance(from.u-this._lastU,from.v-this._lastV)<.006;
    if(!continuous)this._remaining=SPACING/3;
    const magnitude=Math.hypot(du,dv),dx=du/magnitude,dy=dv/magnitude;
    let next=this._remaining;
    while(next<=length){
      const fraction=next/length,mark=this._marks[this._cursor];
      mark.u=from.u+du*fraction;mark.v=from.v+dv*fraction;
      mark.du=dx;mark.dv=dy;mark.power=.78*Math.sqrt(pressure);mark.age=0;
      this._cursor=(this._cursor+1)%SLOTS;
      this.active=true;next+=SPACING;
    }
    this._remaining=next-length;
    this._lastU=to.u;this._lastV=to.v;this._gap=0;
  }
  update(dt){
    dt=Number.isFinite(dt)?Math.max(0,dt):0;
    this._gap+=dt;this.active=false;
    for(let i=0;i<SLOTS;i++){
      const mark=this._marks[i],offset=i*4;
      mark.age=Math.min(LIFETIME,mark.age+dt);
      if(mark.age>=LIFETIME){this._values.fill(0,offset,offset+4);continue;}
      const t=mark.age/LIFETIME;
      const strength=mark.power*(1-t*t*(3-2*t));
      this._values[offset]=mark.u;this._values[offset+1]=mark.v;
      this._values[offset+2]=mark.du*strength;this._values[offset+3]=mark.dv*strength;
      this.active=true;
    }
    return this._values;
  }
}

// Seven fragment uniform vectors including the idle switch. Combined with the
// scene's nine existing declarations this fits WebGL 1's minimum budget of 16.
// zw stores signed UV direction multiplied by pressure and the lifetime fade.
export const coatTrailGLSL=`
uniform vec4 uCoatTrail[6];
uniform float uCoatTrailActive;

vec3 coatTrail(vec2 uv){
  if(uCoatTrailActive<.5)return vec3(0.);
  vec2 direction=vec2(0.);
  float intensity=0.;
  for(int i=0;i<6;i++){
    vec4 mark=uCoatTrail[i];
    float strength=length(mark.zw);
    if(strength>.0001){
      vec2 axis=normalize(mark.zw*vec2(1.,.5));
      vec2 delta=(uv-mark.xy)*vec2(1.,.5);
      vec2 local=vec2(dot(delta,axis)/.052,dot(delta,vec2(-axis.y,axis.x))/.022);
      float footprint=1.-smoothstep(0.,1.,length(local));
      direction+=mark.zw*footprint;
      intensity+=strength*footprint;
    }
  }
  direction/=max(1.,length(direction));
  return vec3(direction,clamp(intensity,0.,1.));
}
`;
