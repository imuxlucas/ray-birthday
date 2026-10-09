/* Each friend sends their name from just below their own moving portrait. */
const DISTANT_LIGHTS=[[.08,.32],[.14,.47],[.84,.18],[.88,.37],[.76,.27],[.09,.71],[.92,.54]];
const NAME_INTERVAL=2.2,NAME_FLIGHT=6.8;
let nameFlights=[],lastNameLaunch=-1;
const nameLightSprites=new Map();
function nameLightSprite(name){
 if(nameLightSprites.has(name))return nameLightSprites.get(name);
 const mask=document.createElement('canvas');mask.width=112;mask.height=40;
 const m=mask.getContext('2d');m.font='400 17px Georgia, serif';m.textAlign='center';m.textBaseline='middle';m.fillStyle='#fff';m.fillText(name,56,20);
 const pixels=m.getImageData(0,0,112,40).data,points=[];
 for(let y=10;y<31;y+=2)for(let x=12;x<100;x+=2)if(pixels[(y*112+x)*4+3]>90)points.push({x:x-56,y:y-20});
 const sprite=document.createElement('canvas');sprite.width=224;sprite.height=80;
 const c=sprite.getContext('2d');c.scale(2,2);c.font='400 17px Georgia, serif';c.textAlign='center';c.textBaseline='middle';
 c.fillStyle='#ffffff';c.shadowColor='rgba(255,255,255,.75)';c.shadowBlur=6;c.fillText(name,56,20);
 const data={canvas:sprite,points:points.filter((_,i)=>i%Math.max(1,Math.ceil(points.length/64))===0)};
 nameLightSprites.set(name,data);return data;
}
function launchNameLight(sequence){
 const index=sequence%FRIENDS.length,birth=sequence*NAME_INTERVAL,angle=index/FRIENDS.length*Math.PI*2+birth*.085;
 // Use the exact portrait projection at departure, not the shared sun centre.
 const avatar=ellipsePoint(angle),screen={x:avatar.x,y:avatar.y+34};
 const px=SUN.radius*Math.cos(angle),py=SUN.radius*Math.sin(angle);
 const worldY=SOURCE.y+BEAM_U.y*px+BEAM_V.y*py,worldZ=SOURCE.z+BEAM_U.z*px+BEAM_V.z*py;
 const depth=C*worldY+S*worldZ,sy=screen.y-CY;
 const origin={x:screen.x-CX,y:-S*sy+C*depth,z:C*sy+S*depth};
 const aimAngle=index*2.39996323,aim={x:Math.cos(aimAngle)*125,y:TIERS[1].hi,z:Math.sin(aimAngle)*110};
 const d={x:aim.x-origin.x,y:aim.y-origin.y,z:aim.z-origin.z};
 let hit=null;for(const tier of TIERS){const h=hitCylinder(origin,d,tier,1.001);if(h&&(!hit||h.t<hit.t))hit=h;}
 const f=hit?hit.t:1,n=hit?hit.n:{x:0,y:1,z:0};
 const end={x:origin.x+d.x*f+n.x*.8,y:origin.y+d.y*f+n.y*.8,z:origin.z+d.z*f+n.z*.8};
 return{birth,index,origin,end,n,sprite:nameLightSprite(FRIENDS[index])};
}
function nameFlightPoint(f,u){return{x:f.origin.x+(f.end.x-f.origin.x)*u,y:f.origin.y+(f.end.y-f.origin.y)*u,z:f.origin.z+(f.end.z-f.origin.z)*u};}
function drawPoeticLight(t){
 const c=front.drawingContext;
 for(let i=0;i<DISTANT_LIGHTS.length;i++){
  const [x,y]=DISTANT_LIGHTS[i],alpha=.045+.12*Math.pow(.5+.5*Math.sin(t*.24+i*1.7),4);
  c.save();c.fillStyle=`rgba(238,244,255,${alpha})`;c.beginPath();c.arc(x*W,y*H,.65+(i%2)*.25,0,Math.PI*2);c.fill();c.restore();
 }
 const sequence=Math.floor(t/NAME_INTERVAL);
 if(sequence<lastNameLaunch){nameFlights=[];lastNameLaunch=-1;}
 for(let i=Math.max(lastNameLaunch+1,sequence-4);i<=sequence;i++)nameFlights.push(launchNameLight(i));
 lastNameLaunch=sequence;
 nameFlights=nameFlights.filter(f=>t-f.birth<NAME_FLIGHT+1.1);
 for(const f of nameFlights){
  const age=t-f.birth,u=Math.min(1,age/NAME_FLIGHT),p=nameFlightPoint(f,u),q=project(p);
  if(age<NAME_FLIGHT){
   if(!visible(p))continue;
   const entrance=Math.min(1,age/.4),dissolve=Math.max(0,Math.min(1,(u-.45)/.45));
   const fade=1-Math.max(0,(u-.88)/.12),alpha=entrance*fade;
   const tail=project(nameFlightPoint(f,Math.max(0,u-.055))),dx=q.x-tail.x,dy=q.y-tail.y,len=Math.hypot(dx,dy)||1;
   c.save();c.globalAlpha=alpha*(.22+.42*dissolve);c.strokeStyle='#ffffff';c.lineWidth=.7;
   c.beginPath();c.moveTo(tail.x,tail.y);c.lineTo(q.x,q.y);c.stroke();
   // Cached high-resolution lettering stays upright before dissolving into its own pixels.
   c.globalAlpha=alpha*(1-dissolve);c.drawImage(f.sprite.canvas,q.x-56,q.y-20,112,40);
   if(dissolve>0){
    c.globalAlpha=alpha*Math.sin(dissolve*Math.PI*.75);c.fillStyle='#ffffff';c.beginPath();
    for(let j=0;j<f.sprite.points.length;j++){
     const pt=f.sprite.points[j],stretch=dissolve*dissolve*((j*17%43)-21);
     const x=q.x+pt.x*(1-dissolve)+dx/len*stretch,y=q.y+pt.y*(1-dissolve)+dy/len*stretch;
     c.moveTo(x+.65,y);c.arc(x,y,.65+(j%3)*.12,0,Math.PI*2);
    }c.fill();
   }
   c.restore();softGlow(c,q.x,q.y,15,alpha*(.07+.12*dissolve));
   if(age<.65){
    const a=f.index/FRIENDS.length*Math.PI*2+t*.085,portrait=ellipsePoint(a);
    softGlow(c,portrait.x,portrait.y,38,Math.sin(age/.65*Math.PI)*.12);
   }
  }else if(visible(f.end)){
   const k=(age-NAME_FLIGHT)/1.1,alpha=Math.sin(k*Math.PI)*(1-k);
   const tangent=f.n.y>.5?{x:1,y:0,z:0}:{x:f.n.z,y:0,z:-f.n.x};
   const bitangent=f.n.y>.5?{x:0,y:0,z:1}:{x:0,y:-1,z:0};
   softGlow(c,q.x,q.y,18,alpha*.2);c.save();
   c.transform(tangent.x,-S*tangent.y+C*tangent.z,bitangent.x,-S*bitangent.y+C*bitangent.z,q.x,q.y);
   c.strokeStyle=`rgba(255,255,255,${alpha*.4})`;c.lineWidth=.75;c.beginPath();c.arc(0,0,3+k*14,0,Math.PI*2);c.stroke();c.restore();
  }
 }
}
