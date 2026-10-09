/* Each friend sends their name from just below their own moving portrait. */
const DISTANT_LIGHTS=[[.08,.32],[.14,.47],[.84,.18],[.88,.37],[.76,.27],[.09,.71],[.92,.54]];
const NAME_FLIGHT=6.8;
let nameFlights=[],nextNameLaunch=0,lastNameTime=-1,nameBag=[],lastNameIndex=-1;
const nameLightSprites=new Map();
function nameLightSprite(name){
 if(nameLightSprites.has(name))return nameLightSprites.get(name);
 const label=name+' ♡ ray',font='400 17px Georgia, serif';
 const mask=document.createElement('canvas'),m=mask.getContext('2d');m.font=font;
 const width=Math.ceil(m.measureText(label).width)+28,center=width/2;
 mask.width=width;mask.height=40;
 m.font=font;m.textAlign='center';m.textBaseline='middle';m.fillStyle='#fff';m.fillText(label,center,20);
 // Retain the fine strokes on the full message, including the outlined heart.
 m.globalCompositeOperation='destination-out';m.lineWidth=.32;m.strokeText(label,center,20);
 const pixels=m.getImageData(0,0,width,40).data,points=[];
 for(let y=8;y<33;y+=2)for(let x=8;x<width-8;x+=2)if(pixels[(y*width+x)*4+3]>90)points.push({x:x-center,y:y-20});
 const sprite=document.createElement('canvas');sprite.width=width*2;sprite.height=80;
 const c=sprite.getContext('2d');c.scale(2,2);c.font=font;c.textAlign='center';c.textBaseline='middle';
 c.fillStyle='#ffffff';c.shadowColor='rgba(255,255,255,.30)';c.shadowBlur=2.5;c.fillText(label,center,20);
 c.shadowBlur=0;c.shadowColor='transparent';c.globalCompositeOperation='destination-out';c.lineWidth=.32;c.strokeText(label,center,20);
 const data={canvas:sprite,width,points:points.filter((_,i)=>i%Math.max(1,Math.ceil(points.length/64))===0)};
 nameLightSprites.set(name,data);return data;
}
function randomNameIndex(){
 // Shuffle all nine each round, so randomness never leaves a friend out.
 if(nameBag.length===0){
  nameBag=FRIENDS.map((_,i)=>i);
  for(let i=nameBag.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[nameBag[i],nameBag[j]]=[nameBag[j],nameBag[i]];}
  if(nameBag[nameBag.length-1]===lastNameIndex)[nameBag[0],nameBag[nameBag.length-1]]=[nameBag[nameBag.length-1],nameBag[0]];
 }
 lastNameIndex=nameBag.pop();return lastNameIndex;
}
function launchNameLight(index,birth){
 const angle=index/FRIENDS.length*Math.PI*2+birth*.085,avatar=ellipsePoint(angle);
 // Choose an actual rendered filament by its distance to this portrait centre.
 const rays=silkGeometryCache.rays;let best=Infinity,rayIndex=0,startU=0;
 for(let i=0;i<rays.length;i++){
  const ray=rays[i].ray,a=project(ray.at(0)),b=project(ray.at(1));
  const dx=b.x-a.x,dy=b.y-a.y,length2=dx*dx+dy*dy;
  const u=Math.max(0,Math.min(.14,((avatar.x-a.x)*dx+(avatar.y-a.y)*dy)/length2));
  const distance=(avatar.x-a.x-dx*u)**2+(avatar.y-a.y-dy*u)**2;
  if(distance<best){best=distance;rayIndex=i;startU=Math.min(.19,u+34/Math.sqrt(length2));}
 }
 const f={birth,index,rayIndex,startU,sprite:nameLightSprite(FRIENDS[index])};
 updateNameTrack(f);return f;
}
function updateNameTrack(f){
 // Reuse the same cached ray as drawSilk, so names stay on it as the spot moves.
 f.ray=silkGeometryCache.rays[f.rayIndex].ray;
 f.end=f.ray.at(1);f.n=f.ray.hit?f.ray.hit.n:{x:0,y:1,z:0};
 const a=project(f.ray.at(f.startU)),b=project(f.end);
 f.flightAngle=Math.atan2(b.y-a.y,b.x-a.x);
}
function nameFlightPoint(f,u){return f.ray.at(f.startU+(1-f.startU)*u);}
function drawPoeticLight(t){
 const c=front.drawingContext;
 for(let i=0;i<DISTANT_LIGHTS.length;i++){
  const [x,y]=DISTANT_LIGHTS[i],alpha=.045+.12*Math.pow(.5+.5*Math.sin(t*.24+i*1.7),4);
  c.save();c.fillStyle=`rgba(238,244,255,${alpha})`;c.beginPath();c.arc(x*W,y*H,.65+(i%2)*.25,0,Math.PI*2);c.fill();c.restore();
 }
 if(lastNameTime<0||t<lastNameTime){nameFlights=[];nextNameLaunch=t;nameBag=[];}
 if(t-nextNameLaunch>NAME_FLIGHT+1.1)nextNameLaunch=t;
 while(t>=nextNameLaunch){
  // Every burst contains 1–9 different names, launched at the same instant.
  const count=1+Math.floor(Math.random()*FRIENDS.length),batch=new Set();
  while(batch.size<count)batch.add(randomNameIndex());
  for(const index of batch)nameFlights.push(launchNameLight(index,nextNameLaunch));
  nextNameLaunch+=1.15+Math.random()*.85;
 }
 lastNameTime=t;
 nameFlights=nameFlights.filter(f=>t-f.birth<NAME_FLIGHT+1.1);
 for(const f of nameFlights){
  const age=t-f.birth,u=Math.min(1,age/NAME_FLIGHT);
  if(age<NAME_FLIGHT)updateNameTrack(f);
  const p=nameFlightPoint(f,u),q=project(p);
  if(age<NAME_FLIGHT){
   if(!visible(p))continue;
   const entrance=Math.min(1,age/.4),dissolve=Math.max(0,Math.min(1,(u-.45)/.45));
   const fade=1-Math.max(0,(u-.88)/.12),alpha=entrance*fade;
   const tail=project(nameFlightPoint(f,Math.max(0,u-.055)));
   c.save();c.globalAlpha=alpha*(.22+.42*dissolve);c.strokeStyle='#ffffff';c.lineWidth=.7;
   c.beginPath();c.moveTo(tail.x,tail.y);c.lineTo(q.x,q.y);c.stroke();
   // The word's baseline and its dissolving pixels share the exact light-ray angle.
   c.translate(q.x,q.y);c.rotate(f.flightAngle);
   c.globalAlpha=alpha*(1-dissolve);c.drawImage(f.sprite.canvas,-f.sprite.width/2,-20,f.sprite.width,40);
   if(dissolve>0){
    c.globalAlpha=alpha*Math.sin(dissolve*Math.PI*.75);c.fillStyle='#ffffff';c.beginPath();
    for(let j=0;j<f.sprite.points.length;j++){
     const pt=f.sprite.points[j],stretch=dissolve*dissolve*((j*17%43)-21);
     const x=pt.x*(1-dissolve)+stretch,y=pt.y*(1-dissolve);
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
