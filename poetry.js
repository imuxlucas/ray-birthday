/* A quiet repeating gesture: each friend sends one small point of light. */
let quietWish=null;
const DISTANT_LIGHTS=[[.08,.32],[.14,.47],[.84,.18],[.88,.37],[.76,.27],[.09,.71],[.92,.54]];
function drawPoeticLight(t){
 const c=front.drawingContext,period=9,cycle=Math.floor(t/period),age=t-cycle*period,index=cycle%FRIENDS.length;
 if(!quietWish||quietWish.cycle!==cycle){
  const birth=cycle*period,angle=index/9*Math.PI*2+birth*.085;
  quietWish={cycle,ray:coneRay(coneFrame(targetAt(birth)),angle,.43)};
 }
 // A barely visible distant point or two gives the black space depth.
 for(let i=0;i<DISTANT_LIGHTS.length;i++){
  const [x,y]=DISTANT_LIGHTS[i],alpha=.045+.12*Math.pow(.5+.5*Math.sin(t*.24+i*1.7),4);
  c.save();c.fillStyle=`rgba(238,244,255,${alpha})`;c.beginPath();c.arc(x*W,y*H,.65+(i%2)*.25,0,Math.PI*2);c.fill();c.restore();
 }
 if(age<1.8){
  const q=ellipsePoint(index/9*Math.PI*2+t*.085,SUN.radius);
  const pulse=Math.sin(age/1.8*Math.PI);
  softGlow(c,q.x,q.y,43,.14*pulse);
 }
 const ray=quietWish.ray;if(!ray.hit)return;
 if(age>=.8&&age<5.2){
  const u=(age-.8)/4.4,p=ray.at(u);
  if(visible(p)&&outsideSun(p)){
   const q=project(p),tail=project(ray.at(Math.max(0,u-.045)));
   const alpha=Math.min(1,u*8,(1-u)*10+.3);
   softGlow(c,q.x,q.y,19,alpha*.36);
   c.save();c.globalAlpha=alpha;c.strokeStyle='rgba(255,252,242,.65)';c.lineWidth=.8;
   c.beginPath();c.moveTo(tail.x,tail.y);c.lineTo(q.x,q.y);c.stroke();
   c.fillStyle='#fffdf6';c.beginPath();c.arc(q.x,q.y,1.6,0,Math.PI*2);c.fill();c.restore();
  }
 }
 if(age>=5.2&&age<7.4){
  const progress=(age-5.2)/2.2,n=ray.hit.n;
  const p={x:ray.origin.x+ray.direction.x*ray.hit.t+n.x,y:ray.origin.y+ray.direction.y*ray.hit.t+n.y,z:ray.origin.z+ray.direction.z*ray.hit.t+n.z};
  if(!visible(p))return;
  const q=project(p),u=n.y>.5?{x:1,y:0,z:0}:{x:n.z,y:0,z:-n.x},v=n.y>.5?{x:0,y:0,z:1}:{x:0,y:-1,z:0};
  const alpha=Math.sin(progress*Math.PI)*(1-progress);
  softGlow(c,q.x,q.y,22,alpha*.16);
  c.save();c.transform(u.x,-S*u.y+C*u.z,v.x,-S*v.y+C*v.z,q.x,q.y);
  c.strokeStyle=`rgba(255,253,244,${alpha*.38})`;c.lineWidth=.8;c.beginPath();c.arc(0,0,5+progress*22,0,Math.PI*2);c.stroke();c.restore();
 }
}
