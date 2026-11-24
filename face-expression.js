// Both renderers sample the dog's own eye texture. The iris moves inside the
// eyelids; closing an eye progressively hides that movement.
export const eyeShader=`
uniform vec4 uExpression; // left lid, right lid, horizontal and vertical gaze
vec2 expressEye(vec2 uv,vec4 eye,vec2 axis,float lid){
  if(eye.z<=0.)return uv;
  vec2 normal=vec2(-axis.y,axis.x);
  vec2 local=(uv-eye.xy)*vec2(1.,.5);
  float across=dot(local,axis);
  float height=dot(local,normal);
  float fraction=clamp(abs(height)/(eye.w*1.20),0.,1.);
  float side=1.-smoothstep(.48,1.,abs(across)/(eye.z*1.70));
  float fold=eye.w*1.20*side*(1.-fraction)*fraction/(.105+fraction);
  vec2 iris=vec2(across/(eye.z*.93),height/(eye.w*.52));
  float follow=(1.-smoothstep(.12,1.,dot(iris,iris)))*(1.-lid);
  return uv+normal*vec2(1.,2.)*sign(height)*fold*lid
    -uExpression.zw*eye.zw*vec2(.28,.18)*follow;
}`;

const smooth=(a,b,n)=>{const t=Math.max(0,Math.min(1,(n-a)/(b-a)));return t*t*(3-2*t);};

export class CanvasEyeTexture{
  constructor(image,eyes){
    this.canvas=document.createElement('canvas');
    const w=this.canvas.width=image.width,h=this.canvas.height=image.height;
    this.ctx=this.canvas.getContext('2d',{willReadFrequently:true});
    this.ctx.drawImage(image,0,0);
    this.patches=eyes.map(([u,v,rx,ry,angle])=>{
      // The full rotating lid influence, plus a texel border for sampling.
      const cx=u*w,cy=v*h,half=Math.ceil(w*Math.hypot(1.7*rx,1.2*ry))+2;
      const x=Math.max(0,Math.floor(cx)-half),y=Math.max(0,Math.floor(cy)-half);
      const width=Math.min(w-x,2*half+1),height=Math.min(h-y,2*half+1);
      const original=this.ctx.getImageData(x,y,width,height);
      const changed=this.ctx.createImageData(width,height);
      changed.data.set(original.data);
      const samples=[];
      const cos=Math.cos(angle),sin=Math.sin(angle);
      for(let row=1;row<height-1;row++)for(let col=1;col<width-1;col++){
        const dx=(x+col+.5-cx)/w,dy=(y+row+.5-cy)/w;
        const across=dx*cos+dy*sin,vertical=dy*cos-dx*sin;
        const frac=Math.min(1,Math.abs(vertical)/(ry*1.20));
        const fold=w*ry*1.20*(1-smooth(.48,1,Math.abs(across)/(rx*1.70)))*
          (1-frac)*frac/(.105+frac)*Math.sign(vertical);
        const iris=1-smooth(.12,1,(across/(rx*.93))**2+(vertical/(ry*.52))**2);
        if(fold||iris)samples.push({col,row,i:(row*width+col)*4,
          lx:-sin*fold,ly:cos*fold,gx:rx*w*.28*iris,gy:ry*h*.18*iris});
      }
      const left=Math.min(...samples.map(s=>s.col)),right=Math.max(...samples.map(s=>s.col));
      const top=Math.min(...samples.map(s=>s.row)),bottom=Math.max(...samples.map(s=>s.row));
      return {x,y,width,height,original,changed,samples,dirty:[left,top,right-left+1,bottom-top+1],key:'0:0:0'};
    });
  }
  update(lids,gazeX,gazeY){
    for(const [index,p] of this.patches.entries()){
      const lid=Math.round(lids[index]*48)/48,gx=Math.round(gazeX*32)/32,gy=Math.round(gazeY*32)/32;
      const key=[lid,gx,gy].join(':');
      if(p.key===key)continue;
      p.key=key;
      const source=p.original.data,target=p.changed.data;
      for(const s of p.samples){
        const x=Math.max(0,Math.min(p.width-2,s.col+s.lx*lid-s.gx*gx*(1-lid)));
        const y=Math.max(0,Math.min(p.height-2,s.row+s.ly*lid-s.gy*gy*(1-lid)));
        const col=Math.floor(x),row=Math.floor(y),fx=x-col,fy=y-row;
        const i=(row*p.width+col)*4,j=i+p.width*4;
        for(let c=0;c<4;c++)target[s.i+c]=(source[i+c]*(1-fx)+source[i+4+c]*fx)*(1-fy)
          +(source[j+c]*(1-fx)+source[j+4+c]*fx)*fy;
      }
      this.ctx.putImageData(p.changed,p.x,p.y,...p.dirty);
    }
    return this.canvas;
  }
}
