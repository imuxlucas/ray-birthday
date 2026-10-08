/* A little sunshine, for Ray — p5.js / Processing-inspired WEBGL.
   Fixed 1000 × 1500 portrait drawing buffer (2:3). World units = pixels, seconds, y up.
   Both rendering and physics use the same two capped cylinders. */
const W=1000,H=1500, CX=604,CY=1235, S=.877268488, C=.48;
const SUN={x:240,y:205,radius:105,angle:-.48,flatten:.60,depth:.8/1120};
const FRIENDS=['charles','dana','ian','jonr','keyi','lucas','minna','queen','riley'];
// Move the emitter toward the viewer in depth while preserving its screen position.
const SOURCE_DEPTH=500;
const SOURCE={x:SUN.x-CX,y:(CY+C*SOURCE_DEPTH-SUN.y)/S,z:SOURCE_DEPTH};
const TIERS=[{r:323,lo:0,hi:133},{r:234,lo:133,hi:293}];
// Restore the smaller light spot; expand its travel instead of its diameter.
// Scale the receiving radius by 1.2 while preserving the 100-unit source aperture.
const CONE={aperture:100,spread:(170*1.2+100*.2)/Math.hypot(SOURCE.x,SOURCE.y-TIERS[0].hi,SOURCE.z)};
const LIGHT_SWEEP_SPEED=.035;
// A fixed tilted aperture plane shares the sun's ellipse; the portrait orbit stays 105.
const BEAM_U={x:Math.cos(SUN.angle),y:-S*Math.sin(SUN.angle),z:C*Math.sin(SUN.angle)};
const BEAM_V={x:-Math.sin(SUN.angle)*SUN.flatten,y:-S*Math.cos(SUN.angle)*SUN.flatten+C*Math.sqrt(1-SUN.flatten**2),z:C*Math.cos(SUN.angle)*SUN.flatten+S*Math.sqrt(1-SUN.flatten**2)};
const PHYSICS={gravity:100,drag:.018,restitution:.22,friction:.08,step:1/120};
let portraits={},back,front,glowTex,sunTex,topTex,lowerTopTex,upperSideTex,lowerTex,program,clockTime=0,accumulator=0,emission=0,particles=[],sparks=[],paused=false,canvasEl,recording=false;
let stats={collisions:0,emitted:0,fallen:0};
let targetPath=[],glowSprites=[],avatarHalo;
const PATH_SAMPLES=256;
const VERT=`precision highp float; attribute vec3 aPosition; void main(){gl_Position=vec4(aPosition.xy,0.,1.);}`;
const FRAG=`precision highp float;
uniform vec2 resolution; uniform float time; uniform vec3 lightPos; uniform vec3 target;
uniform vec3 beamDualU; uniform vec3 beamDualV; uniform vec3 beamDualAxis; uniform vec2 coneShape; uniform vec2 cakeOrigin; uniform vec3 lowerTier; uniform vec3 upperTier; uniform vec4 sunPose;
uniform sampler2D glowLayer; uniform sampler2D sunLayer; uniform sampler2D backLayer; uniform sampler2D frontLayer; uniform sampler2D lowerTopLayer; uniform sampler2D topLayer; uniform sampler2D upperSideLayer; uniform sampler2D lowerLayer;
const float S=.877268488; const float C=.48;
// Five small texture taps soften only defocused icing detail, not the entire scene.
vec4 softDetail(sampler2D layer,vec2 uv,vec2 radius){
 vec4 center=texture2D(layer,uv);
 if(max(radius.x,radius.y)<.0001)return center;
 return center*.40+(texture2D(layer,uv+vec2(radius.x,0.))+texture2D(layer,uv-vec2(radius.x,0.))+texture2D(layer,uv+vec2(0.,radius.y))+texture2D(layer,uv-vec2(0.,radius.y)))*.15;
}
// Coordinates of the same oblique cone used by the CPU's visible filaments.
vec3 coneLocal(vec3 p,vec3 axis){
 return vec3(dot(p,beamDualU),dot(p,beamDualV),dot(p,beamDualAxis));
}
// Analytic intersections: finite cylinder sides and both caps; no mesh approximation.
void cylinder(vec3 o, vec3 d,float r,float low,float high,inout float nearT,inout vec3 normal,inout float tier,float id){
 float a=dot(d.xz,d.xz), b=dot(o.xz,d.xz), cc=dot(o.xz,o.xz)-r*r;
 float delta=b*b-a*cc;
 if(delta>=0.){float sq=sqrt(delta);for(int k=0;k<2;k++){float t=(-b+(k==0?-sq:sq))/a;float y=o.y+t*d.y;if(t>0.&&t<nearT&&y>=low&&y<=high){nearT=t;normal=normalize(vec3(o.x+t*d.x,0.,o.z+t*d.z));tier=id;}}}
 for(int k=0;k<2;k++){float y=k==0?low:high;float t=(y-o.y)/d.y;vec3 p=o+t*d;if(t>0.&&t<nearT&&dot(p.xz,p.xz)<=r*r){nearT=t;normal=vec3(0.,k==0?-1.:1.,0.);tier=id;}}
}
// Soft upper-tier occlusion: a continuous penumbra instead of a binary shadow cut.
float upperDistance(vec3 p){
 vec2 q=vec2(length(p.xz)-upperTier.x,abs(p.y-(upperTier.y+upperTier.z)*.5)-(upperTier.z-upperTier.y)*.5);
 return min(max(q.x,q.y),0.)+length(max(q,0.));
}
float softUpperShadow(vec3 p,vec3 direction,float maxDistance){
 float travel=2.,visibility=1.;
 for(int i=0;i<16;i++){
  if(travel>=maxDistance||p.y+direction.y*travel>upperTier.z+1.)break;
  float h=upperDistance(p+direction*travel);
  visibility=min(visibility,7.*max(h,0.)/travel);
  if(h<.04)break;
  travel+=clamp(h,5.,75.);
 }
 return smoothstep(0.,1.,visibility);
}
float beamVolume(vec3 origin,vec3 direction,float surfaceT){
 vec3 axis=normalize(target-lightPos);float reach=length(target-lightPos)*1.30;
 vec3 o=coneLocal(origin-lightPos,axis),d=coneLocal(direction,axis);
 // Solve the cone boundary analytically before sampling: no empty-space march.
 float r0=coneShape.x+o.z*coneShape.y,kd=d.z*coneShape.y;
 float a=dot(d.xy,d.xy)-kd*kd,b=dot(o.xy,d.xy)-r0*kd,c=dot(o.xy,o.xy)-r0*r0;
 float discriminant=b*b-a*c;if(discriminant<=0.||a<=.000001)return 0.;
 float root=sqrt(discriminant),start=max(0.,(-b-root)/a),finish=min(surfaceT,(-b+root)/a);
 if(abs(d.z)>.000001){float za=-o.z/d.z,zb=(reach-o.z)/d.z;start=max(start,min(za,zb));finish=min(finish,max(za,zb));}
 else if(o.z<=0.||o.z>=reach)return 0.;
 // Let the beam reach the lower wall; terminate only below the cake base.
 finish=min(finish,(lowerTier.y-origin.y)/direction.y);
 if(finish<=start)return 0.;
 float stride=(finish-start)/6.,density=0.;vec3 apex=lightPos-axis*(coneShape.x/coneShape.y);
 for(int i=0;i<6;i++){
  float sampleT=start+(float(i)+.5)*stride;vec3 q=o+d*sampleT;
  float radius=coneShape.x+q.z*coneShape.y,weight=1.-smoothstep(radius*.30,radius,length(q.xy));
  vec3 samplePos=origin+direction*sampleT;
  // Above the upper cap there can be no cake blocking the source.
  if(samplePos.y<upperTier.z){
   vec3 towardLight=normalize(apex-samplePos);float blocker=1.e6;vec3 nn=vec3(0.);float id=0.;
   cylinder(samplePos,towardLight,upperTier.x,upperTier.y,upperTier.z,blocker,nn,id,2.);
   if(samplePos.y<lowerTier.z)cylinder(samplePos,towardLight,lowerTier.x,lowerTier.y,lowerTier.z,blocker,nn,id,1.);
   if(blocker<q.z/max(.001,dot(-towardLight,beamDualAxis)))continue;
  }
  density+=weight*stride;
 }
 return 1.-exp(-density*.00105);
}
void main(){
 vec2 p=vec2(gl_FragCoord.x,resolution.y-gl_FragCoord.y);vec2 uv=p/resolution;
 // Pure black matches the surrounding immersive page.
 vec3 sky=vec3(0.);
 vec3 col=sky;
 vec2 q=p-cakeOrigin;vec3 dir=vec3(0.,-C,-S);vec3 origin=vec3(q.x,-S*q.y,C*q.y)-dir*2200.;
 float t=1.e6;vec3 n=vec3(0.);float tier=0.;
 if(abs(q.x)<=lowerTier.x&&q.y>=-S*upperTier.z-C*upperTier.x&&q.y<=C*lowerTier.x){
  cylinder(origin,dir,lowerTier.x,lowerTier.y,lowerTier.z,t,n,tier,1.);
  cylinder(origin,dir,upperTier.x,upperTier.y,upperTier.z,t,n,tier,2.);
 }
 if(t<1.e5){
 vec3 pos=origin+dir*t;vec3 axis=normalize(target-lightPos);
 vec3 geomN=n;float r=tier>1.5?upperTier.x:lowerTier.x;
 float hi=tier>1.5?upperTier.z:lowerTier.z,low=tier>1.5?upperTier.y:lowerTier.y;
 // Wide, softly rounded rim shading, without the former hard gold outline.
 float rimWidth=11.;
 if(geomN.y>.5){float bevel=1.-smoothstep(0.,rimWidth,r-length(pos.xz));n=normalize(mix(geomN,normalize(vec3(pos.x,0.,pos.z)),bevel*.5));}
 else if(abs(geomN.y)<.5){float topBevel=1.-smoothstep(0.,rimWidth,hi-pos.y),bottomBevel=1.-smoothstep(0.,rimWidth,pos.y-low);n=normalize(mix(geomN,vec3(0.,topBevel>bottomBevel?1.:-1.,0.),max(topBevel,bottomBevel)*.5));}
 // A lens aperture with linear divergence: the drawn rays and illumination
 // share exactly this expanding cone and its virtual apex.
 vec3 apex=lightPos-axis*(coneShape.x/coneShape.y);vec3 L=normalize(apex-pos);
 vec3 localBeam=coneLocal(pos-lightPos,axis);float axial=localBeam.z;float radial=length(localBeam.xy);
 float coneRadius=coneShape.x+max(0.,axial)*coneShape.y;
 float spot=(1.-smoothstep(coneRadius*.93,coneRadius,radial))*step(0.,axial);
 float lambert=max(0.,dot(n,L));
 float apertureDistance=axial/max(.001,coneLocal(-L,axis).z);
 // Convex surfaces self-shadow smoothly through N·L; only the upper tier
 // can cast an additional shadow onto the lower tier. Ambient stays continuous.
 float visibility=(tier<1.5&&spot>.001&&lambert>.001)?softUpperShadow(pos+n*.8,L,apertureDistance):1.;
 float lit=spot*(.34+.66*lambert*visibility);
 // Ivory-white icing under neutral white light, with gentle cool shadows.
 float skyFacing=max(0.,dot(n,normalize(vec3(-.45,.85,.65))));
 vec3 icingBase=tier>1.5?vec3(.98,.98,.97):vec3(.94,.95,.97);
 vec3 topColor=tier>1.5?vec3(1.,.995,.98):vec3(.98,.985,1.);
 vec3 material=mix(icingBase,topColor,smoothstep(.0,.98,n.y));
 vec3 unlit=material*vec3(.79,.88,1.)*(.78+.10*skyFacing+.06*max(0.,n.y));
 if(tier<1.5&&geomN.y>.5)unlit*=1.-.075*exp(-max(0.,length(pos.xz)-upperTier.x)/23.);
 vec3 gold=mix(material,vec3(1.,.955,.86),.75);
 col=mix(unlit,gold,lit);
 float rimDistance=geomN.y>.5?r-length(pos.xz):min(hi-pos.y,pos.y-low);
 float rimGlow=1.-smoothstep(0.,12.,rimDistance);
 col=mix(col,vec3(1.,.975,.91),rimGlow*spot*.22);
 // Depth and spotlight define the focal region: back rim and lower tier soften.
 float backFocus=smoothstep(.05,.85,-pos.z/r);
 float lowFocus=1.-smoothstep(10.,190.,pos.y);
 float sideFocus=pow(abs(pos.x)/r,4.);
 float softFocus=clamp(backFocus*.65+lowFocus*.70+sideFocus*.40,0.,1.)*(1.-spot*.68);
 if(tier>1.5&&geomN.y>.5&&length(pos.xz)<r*.25)softFocus=0.;
 vec4 decal=vec4(0.),lettering=vec4(0.);
 // Cake and Ray stay fixed; only the separate lettering atlas scrolls.
 if(geomN.y>.5){vec2 tuv=vec2(.5)+pos.xz/(r*2.);vec2 blur=vec2(softFocus*1.35/(2.*r));decal=tier>1.5?softDetail(topLayer,tuv,blur):softDetail(lowerTopLayer,tuv,blur);}
 if(abs(geomN.y)<.5){
  vec2 wallUV=vec2(fract(.5+atan(pos.x,pos.z)/6.283185307),(hi-pos.y)/(hi-low));
  vec2 icingUV=vec2(wallUV.x,wallUV.y*.5);
  // Viewed from above: upper tier clockwise, lower tier counterclockwise.
  float textDirection=tier>1.5?1.:-1.;
  vec2 textUV=vec2(fract(wallUV.x+textDirection*time/80.),.5+wallUV.y*.5);
  vec2 blur=vec2(softFocus*1.35/(6.283185307*r),softFocus*1.35/(2.*(hi-low)));
  decal=tier>1.5?softDetail(upperSideLayer,icingUV,blur):softDetail(lowerLayer,icingUV,blur);
  lettering=tier>1.5?texture2D(upperSideLayer,textUV):texture2D(lowerLayer,textUV);
 }
 decal*=1.-softFocus*.13;
 // Normal alpha compositing preserves Ray's own colors, with neutral light shading.
 if(tier>1.5&&geomN.y>.5&&length(pos.xz)<r*(113./512.)){
  vec3 portraitLight=vec3(.82+.18*lit);
  col=col*(1.-decal.a)+decal.rgb*portraitLight;
 }else{
  vec3 icingLight=mix(vec3(.87,.93,1.),vec3(1.,.97,.94),lit);
  col=col*(1.-decal.a)+decal.rgb*icingLight;
 }
 col=1.-(1.-col)*(1.-vec3(.10)*spot*visibility);
 float reflected=max(0.,dot(reflect(-L,n),-dir));
 float spec=pow(reflected,38.);col+=vec3(1.)*(spec*.53+pow(reflected,9.)*.06)*spot*visibility;
 // A restrained icy reflection on the right rim; the white body keeps a clean, luminous appearance.
 vec3 coolDir=normalize(vec3(.92,.28,.48));
 float coolFacing=max(0.,dot(n,coolDir));
 float fresnel=pow(1.-max(0.,dot(n,-dir)),3.);
 float coolSpec=pow(max(0.,dot(reflect(-coolDir,n),-dir)),32.);
 col=mix(col,vec3(.64,.83,1.),fresnel*coolFacing*.42);
 col+=vec3(.30,.62,1.)*coolSpec*.18;
 // A narrow travelling reflection follows the piped rings and rounded lip.
 // Both layers use the same clock as the sugar pearls, in opposite directions.
 float sweepDirection=tier>1.5?1.:-1.;
 float sweepPeriod=tier>1.5?24.:30.;
 float sweepPhase=sweepDirection*time/sweepPeriod+(tier>1.5?.12:.62);
 float surfaceTurn=atan(pos.z,pos.x)/6.283185307;
 float sweepTravel=fract((sweepPhase-surfaceTurn)*sweepDirection);
 float sweepPulse=exp(-sweepTravel*30.)*smoothstep(0.,.012,sweepTravel);
 float pipingReflection=0.;
 if(geomN.y>.5){
  float radialPos=length(pos.xz);
  float pipingDistance=abs(radialPos-r*(482./512.));
  pipingReflection=exp(-pipingDistance*pipingDistance/1.8);
  float innerDistance=abs(radialPos-r*(472./512.));
  pipingReflection+=.30*exp(-innerDistance*innerDistance/.7);
 }else{
  float lipDistance=hi-pos.y-3.;
  pipingReflection=.55*exp(-lipDistance*lipDistance/8.);
 }
 float glidingLight=clamp(pipingReflection*sweepPulse*.90,0.,.85)*(.65+.35*lit);
 col=mix(col,vec3(1.),glidingLight);
 // The unlit cake is an architectural line drawing; only direct light reveals material.
 float reveal=spot*visibility*smoothstep(.015,.22,lambert);
 // A restrained reflected wash reaches the lower wall. It is evaluated only
 // on the cake silhouette and follows the receiving spot down the visible front.
 if(tier<1.5&&abs(geomN.y)<.5){
  float spillX=(pos.x-target.x*1.65)/(r*.76);
  float spillAcross=exp(-spillX*spillX*spillX*spillX*2.);
  float frontSweep=smoothstep(45.,165.,target.z);
  float spillHeight=mix(hi-12.,hi*.40,frontSweep);
  float spillDown=exp(-pow((pos.y-spillHeight)/82.,2.));
  float frontFacing=smoothstep(-.08,.45,geomN.z);
  float spill=spillAcross*spillDown*frontFacing*mix(.28,.46,frontSweep);
  reveal=max(reveal,spill);
 }

 float edgeLine=0.,sectionLine=0.,meridianLine=0.;
 if(geomN.y>.5){
  float rr=length(pos.xz);
  edgeLine=1.-smoothstep(.55,1.9,r-rr);
  // Concentric construction rings follow the actual horizontal top plane.
  float ringDistance=min(abs(rr-r*.72),abs(rr-r*.94));
  sectionLine=(1.-smoothstep(.45,1.55,ringDistance))*.48;
  if(tier<1.5){
   float jointDistance=abs(rr-upperTier.x);
   edgeLine=max(edgeLine,1.-smoothstep(.55,1.9,jointDistance));
  }
 }else{
  float heightDistance=min(hi-pos.y,pos.y-low);
  edgeLine=1.-smoothstep(.55,1.7,heightDistance);
  // Widely spaced meridians describe curvature without a dense mesh.
  float segments=tier>1.5?20.:24.;
  float turn=atan(pos.x,pos.z)/6.283185307;
  float angularDistance=abs(fract(turn*segments+.5)-.5)*6.283185307*r/segments;
  float projectedDistance=angularDistance*max(.14,abs(geomN.z));
  meridianLine=(1.-smoothstep(.35,1.1,projectedDistance))*.34;
  float sectionDistance=min(abs(pos.y-mix(low,hi,.28)),abs(pos.y-mix(low,hi,.72)));
  sectionLine=(1.-smoothstep(.4,1.25,sectionDistance))*.38;
  float silhouetteDistance=r-abs(pos.x);
  edgeLine=max(edgeLine,1.-smoothstep(.18,.9,silhouetteDistance));
 }
 float lineStrength=max(edgeLine,max(sectionLine,meridianLine));
 vec3 wireColor=vec3(.66,.69,.72)*lineStrength;
 col=mix(wireColor,col,reveal);
 // Lettering remains a restrained white trace in darkness, brighter in the light.
 float textBreath=.72+.28*(.5+.5*sin(time*1.15));
 col=mix(col,vec3(1.),lettering.a*textBreath*(.28+.72*reveal));
 }
 // Warm participating light fills the cone, stopping at the actual cake surface.
 float mist=beamVolume(origin,dir,t);
 // Add luminous scattering without replacing blue with an opaque yellow mixture.
 col=1.-(1.-col)*(1.-vec3(1.)*mist*.64);
 // Ray fragments already respect camera occlusion; composite them in front of the cake.
 vec4 bg=texture2D(backLayer,uv);col=col*(1.-bg.a)+bg.rgb;
 // Inverse homography: every sun portrait lies on one tilted perspective plane.
 vec2 sp=p-sunPose.xy;float ca=cos(sunPose.z),sa=sin(sunPose.z);
 vec2 planeCoord=vec2(ca*sp.x+sa*sp.y,-sa*sp.x+ca*sp.y);
 float py=planeCoord.y/(sunPose.w+planeCoord.y*(.8/1120.));
 float scale=1./(1.-py*(.8/1120.));
 vec2 suv=(vec2(planeCoord.x/scale,py)+320.)/640.;
 vec3 bloom=texture2D(glowLayer,uv).rgb;
 col=1.-(1.-col)*(1.-bloom*.65);
 vec4 fg=texture2D(frontLayer,uv);col=col*(1.-fg.a)+fg.rgb;
 // Portraits and names occlude hearts, trails and bloom; the empty centre remains transparent.
 if(all(greaterThanEqual(suv,vec2(0.)))&&all(lessThanEqual(suv,vec2(1.)))){vec4 sun=texture2D(sunLayer,suv);col=col*(1.-sun.a)+sun.rgb;}
 gl_FragColor=vec4(col,1.);
}`;
function preload(){for(const name of [...FRIENDS,'ray'])portraits[name]=loadImage((window.INLINE_ASSETS||{})[name]||'assets/'+name+'.png');}
function setup(){
 pixelDensity(1);setAttributes({alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:true});
 canvasEl=createCanvas(W,H,WEBGL).parent('stage').elt;noStroke();
 back=createGraphics(W,H);front=createGraphics(W,H);glowTex=createGraphics(Math.ceil(W/3),Math.ceil(H/3));sunTex=createGraphics(640,640);topTex=createGraphics(1024,1024);lowerTopTex=createGraphics(1024,1024);upperSideTex=createGraphics(2048,1024);lowerTex=createGraphics(2048,1024);
 for(const g of [back,front,glowTex,sunTex,topTex,lowerTopTex,upperSideTex,lowerTex])g.pixelDensity(1);
 buildCaches();buildHeroCandles();frameRate(60);
 makeTop(topTex,true);makeTop(lowerTopTex,false);makeSide(upperSideTex,TIERS[1],30);makeSide(lowerTex,TIERS[0],32);program=createShader(VERT,FRAG);
 document.getElementById('pause').onclick=togglePause;
 document.addEventListener('visibilitychange',()=>{if(document.hidden)noLoop();else if(!paused)loop();});
 document.getElementById('save').onclick=()=>saveCanvas('sunshine-for-ray','png');
 document.getElementById('full').onclick=()=>document.fullscreenElement?document.exitFullscreen():document.getElementById('stage').requestFullscreen();
 document.getElementById('record').onclick=recordClip;
 window.addEventListener('keydown',e=>{if(e.code==='Space'&&e.target.tagName!=='BUTTON'){e.preventDefault();togglePause();}});
 // Seed a living composition using the same fixed-step solver.
 for(let i=0;i<480;i++){clockTime+=PHYSICS.step;stepPhysics(PHYSICS.step,clockTime);}
 window.rayArt={stats,particles,tiers:TIERS,physics:PHYSICS,get time(){return clockTime;},get paused(){return paused;},project,hitCylinder};
}
function togglePause(){paused=!paused;document.getElementById('pause').textContent=paused?'播放':'暂停';if(paused)noLoop();else loop();}
function project(p){return {x:CX+p.x,y:CY-S*p.y+C*p.z};}
// Sweep toward the visible front and both sides, keeping the upper top in the footprint.
const LIGHT_SURFACE_PATH=[
 {x:-45,y:283,z:35},{x:15,y:275,z:80},{x:75,y:282,z:45},
 {x:45,y:293,z:-30},{x:-45,y:293,z:-35},{x:-75,y:282,z:50}
];
function solveTarget(t){
 const phase=((t*LIGHT_SWEEP_SPEED/(Math.PI*2))%1+1)%1*LIGHT_SURFACE_PATH.length;
 const index=Math.floor(phase),u=phase-index,n=LIGHT_SURFACE_PATH.length;
 const p0=LIGHT_SURFACE_PATH[(index+n-1)%n],p1=LIGHT_SURFACE_PATH[index];
 const p2=LIGHT_SURFACE_PATH[(index+1)%n],p3=LIGHT_SURFACE_PATH[(index+2)%n];
 const target={};
 for(const k of ['x','y','z'])target[k]=.5*((2*p1[k])+(-p0[k]+p2[k])*u+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*u*u+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*u*u*u);
 return target;
}
function buildCaches(){
 // Bake the slow light path once; interpolation replaces thousands of ray solves.
 targetPath=Array.from({length:PATH_SAMPLES},(_,i)=>solveTarget(i/PATH_SAMPLES*Math.PI*2/LIGHT_SWEEP_SPEED));
 glowSprites=[false,true].map(yellow=>{
  const tile=createGraphics(96,96);tile.pixelDensity(1);const c=tile.drawingContext,g=c.createRadialGradient(48,48,0,48,48,48);
  g.addColorStop(0,yellow?'rgba(255,255,255,1)':'rgba(255,255,255,1)');g.addColorStop(.30,yellow?'rgba(245,249,255,.42)':'rgba(225,243,255,.40)');g.addColorStop(1,yellow?'rgba(245,249,255,0)':'rgba(220,242,255,0)');c.fillStyle=g;c.fillRect(0,0,96,96);return tile;
 });
 avatarHalo=createGraphics(128,128);avatarHalo.pixelDensity(1);
 const hc=avatarHalo.drawingContext,hg=hc.createRadialGradient(64,64,0,64,64,64);
 hg.addColorStop(0,'rgba(255,251,226,0)');hg.addColorStop(.57,'rgba(255,251,226,0)');hg.addColorStop(.68,'rgba(255,251,226,.25)');hg.addColorStop(.80,'rgba(255,251,226,.10)');hg.addColorStop(1,'rgba(255,251,226,0)');hc.fillStyle=hg;hc.fillRect(0,0,128,128);
}
function targetAt(t){
 const phase=((t*LIGHT_SWEEP_SPEED/(Math.PI*2))%1+1)%1*PATH_SAMPLES,index=Math.floor(phase),u=phase-index;
 const a=targetPath[index],b=targetPath[(index+1)%PATH_SAMPLES];
 return{x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u,z:a.z+(b.z-a.z)*u};
}
function beamDuals(target){
 const axis=coneFrame(target).axis,cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
 const u=cross(BEAM_V,axis),v=cross(axis,BEAM_U),z=cross(BEAM_U,BEAM_V),det=BEAM_U.x*u.x+BEAM_U.y*u.y+BEAM_U.z*u.z;
 return [u,v,z].map(p=>[p.x/det,p.y/det,p.z/det]);
}
function sunProject(x,y){let k=1/(1-y*SUN.depth),u=x*k,v=y*SUN.flatten*k,ca=Math.cos(SUN.angle),sa=Math.sin(SUN.angle);return{x:SUN.x+u*ca-v*sa,y:SUN.y+u*sa+v*ca};}
function ellipsePoint(a,r=SUN.radius){return sunProject(r*Math.cos(a),r*Math.sin(a));}
function heart(ctx,x,y,r,angle=0,alpha=1,color='#ff3048'){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.scale(r/12,r/12);ctx.globalAlpha=alpha;ctx.beginPath();ctx.moveTo(0,7);ctx.bezierCurveTo(-21,-6,-8,-18,0,-8);ctx.bezierCurveTo(8,-18,21,-6,0,7);ctx.strokeStyle=color==='#ff3048'?'#ff6876':color;ctx.fillStyle=color;ctx.lineWidth=1.15;ctx.fill();ctx.stroke();ctx.restore();}
function circlePortrait(ctx,img,x,y,r,angle=0){ctx.save();ctx.translate(x,y);ctx.rotate(angle);ctx.beginPath();ctx.arc(0,0,r,0,Math.PI*2);ctx.clip();let m=Math.min(img.width,img.height);ctx.drawImage(img.canvas,(img.width-m)/2,(img.height-m)/2,m,m,-r,-r,r*2,r*2);ctx.restore();}
function makeTop(g,upper){let c=g.drawingContext;g.clear();c.save();c.translate(512,512);
 const pink='#ffaccb',blue='#8fcaff';
 const count=upper?28:36,ring=upper?449:461;
 for(let i=0;i<count;i++){
  let a=i/count*Math.PI*2,x=ring*Math.cos(a),y=ring*Math.sin(a);
  // Small piped cream rosettes, with pink and blue sugar pearls.
  c.save();c.translate(x,y);c.rotate(a);
  let cream=c.createRadialGradient(-5,-6,1,0,0,23);cream.addColorStop(0,i%2===0?'#fff0f6':'#edf8ff');cream.addColorStop(.6,i%2===0?pink:blue);cream.addColorStop(1,i%2===0?'#f58fbb':'#72b4ee');c.fillStyle=cream;
  for(let j=0;j<7;j++){
   const petal=j/7*Math.PI*2;c.beginPath();c.ellipse(Math.cos(petal)*10,Math.sin(petal)*10,11,7,petal,0,Math.PI*2);c.fill();
   c.save();c.rotate(petal);c.strokeStyle='rgba(255,255,255,.82)';c.lineWidth=1.6;
   c.beginPath();c.moveTo(3,-2);c.quadraticCurveTo(12,-5,19,-1);c.stroke();c.restore();
  }
  c.fillStyle=i%2===0?pink:blue;c.beginPath();c.arc(0,0,7,0,Math.PI*2);c.fill();c.fillStyle=i%2===0?pink:blue;c.beginPath();c.arc(-2,-2,2.2,0,Math.PI*2);c.fill();c.restore();
  if(i%4===2)heart(c,(ring-45)*Math.cos(a),(ring-45)*Math.sin(a),8,a+.5,1,i%8===2?pink:blue);
 }
 // Pastel piping and a fine pearl border add detail without animation cost.
 c.strokeStyle=upper?pink:blue;c.lineWidth=6;c.beginPath();c.arc(0,0,482,0,Math.PI*2);c.stroke();
 c.strokeStyle=upper?blue:pink;c.lineWidth=2;c.beginPath();c.arc(0,0,472,0,Math.PI*2);c.stroke();
 const pearls=upper?72:96;
 for(let i=0;i<pearls;i++){const a=i/pearls*Math.PI*2;c.fillStyle=i%2===0?pink:blue;c.beginPath();c.arc(Math.cos(a)*488,Math.sin(a)*488,3.8,0,Math.PI*2);c.fill();}
 for(let i=0;i<count;i++){const a=(i+.5)/count*Math.PI*2;c.save();c.translate(Math.cos(a)*ring,Math.sin(a)*ring);c.rotate(a);c.fillStyle=i%2===0?pink:blue;c.beginPath();c.ellipse(0,0,13,8,0,0,Math.PI*2);c.fill();c.restore();}
 // Sugar sprinkles and small piped dots are baked once into the top texture.
 const sugarColors=[pink,blue,'#ffd3e3','#b8e1ff'];
 for(let i=0;i<48;i++){
  const a=i*2.39996323,r=upper?226+((i*73)%159):392+((i*17)%36),x=Math.cos(a)*r,y=Math.sin(a)*r;
  c.save();c.translate(x,y);c.rotate(i*1.73);c.strokeStyle=sugarColors[i%4];c.lineWidth=4;c.lineCap='round';c.beginPath();c.moveTo(-5,0);c.lineTo(5+(i%3)*2,0);c.stroke();
  if(i%3===0){c.fillStyle=i%2===0?pink:blue;c.beginPath();c.arc(9,8,3,0,Math.PI*2);c.fill();}c.restore();
 }
 // Interlaced piped ribbons form a distinct inner border, baked into the texture.
 const braidRadius=upper?409:428,braidCount=upper?14:18;
 c.lineCap='round';c.lineJoin='round';
 for(let strand=0;strand<2;strand++){
  for(let pass=0;pass<2;pass++){
   c.strokeStyle=pass===0?(strand===0?pink:blue):'rgba(255,255,255,.88)';
   c.lineWidth=pass===0?5:1.6;c.beginPath();
   for(let j=0;j<=720;j++){
    const a=j/720*Math.PI*2,rr=braidRadius+Math.sin(a*braidCount+strand*Math.PI)*8-(pass===1?1.8:0);
    const x=Math.cos(a)*rr,y=Math.sin(a)*rr;if(j===0)c.moveTo(x,y);else c.lineTo(x,y);
   }c.stroke();
  }
 }
 for(let i=0;i<braidCount*2;i++){
  const a=i/(braidCount*2)*Math.PI*2,x=Math.cos(a)*braidRadius,y=Math.sin(a)*braidRadius;
  c.fillStyle=i%2?'#c6e8ff':'#ffd4e4';c.beginPath();c.arc(x,y,4.3,0,Math.PI*2);c.fill();
  c.fillStyle='#ffffff';c.beginPath();c.arc(x-1.2,y-1.5,1.5,0,Math.PI*2);c.fill();
 }
 // Fine sugar crystals cluster near the icing border, leaving the central artwork clear.
 for(let i=0;i<132;i++){
  const a=i*2.39996323,rr=(upper?365:388)+(i*17%29)+Math.sin(i*1.71)*11;
  const x=Math.cos(a)*rr,y=Math.sin(a)*rr,sz=1+(i%3)*.45;
  c.fillStyle=i%4===0?'#caeaff':i%4===1?'#ffcfdf':'rgba(255,255,255,.85)';
  c.save();c.translate(x,y);c.rotate(a);c.fillRect(-sz/2,-sz/2,sz,sz*1.8);c.restore();
 }
 // Small sugar pearls, in alternating pink and blue against the white icing.
 for(let i=0;i<66;i++){
  const a=i*2.39996323,rr=upper?245+(i*41)%140:391+(i*19)%37;
  const px=Math.cos(a)*rr,py=Math.sin(a)*rr;
  c.fillStyle=i%2===0?pink:blue;c.beginPath();c.arc(px,py,2+(i%3),0,Math.PI*2);c.fill();
 }
 if(upper){
  // Small round portrait, centered and lying on the cake's top plane.
  c.fillStyle='#ffffff';c.beginPath();c.arc(0,0,120,0,Math.PI*2);c.fill();
  circlePortrait(c,portraits.ray,0,0,112);
  c.strokeStyle='#ffffff';c.lineWidth=3;c.beginPath();c.arc(0,0,118,0,Math.PI*2);c.stroke();
 }
 c.restore();
}
function makeSide(g,tier,fontSize){g.clear();const c=g.drawingContext;c.save();
 const pink='#ffaccb',blue='#8fcaff',upper=tier===TIERS[1];
 const circumference=2*Math.PI*tier.r,h=tier.hi-tier.lo;
 // Upper half: fixed icing. Lower half: independently scrolling luminous text.
 c.translate(g.width/2,g.height/4);c.scale(g.width/circumference,g.height/(2*h));
 // All extra icing detail is cached: no extra animated geometry or draw passes.
 const icing=c.createLinearGradient(0,-h/2,0,-h/2+28);icing.addColorStop(0,upper?'#ffe6ef':'#e3f4ff');icing.addColorStop(.65,upper?pink:blue);icing.addColorStop(1,upper?'#f997c0':'#7bbcf1');c.fillStyle=icing;
 const drips=Math.round(circumference/72),dripSpan=circumference/drips;
 c.beginPath();c.moveTo(-circumference/2,-h/2);c.lineTo(-circumference/2,-h/2+11);
 for(let i=0;i<drips;i++){const x=-circumference/2+i*dripSpan,y=-h/2+11,depth=9+(i%3)*4;c.bezierCurveTo(x+dripSpan*.25,y,x+dripSpan*.22,y+depth,x+dripSpan*.43,y+depth);c.bezierCurveTo(x+dripSpan*.66,y+depth,x+dripSpan*.61,y,x+dripSpan,y);}
 c.lineTo(circumference/2,-h/2);c.closePath();c.fill();
 // Two fine cream layers and a pastel base ribbon.
 const ribbon=c.createLinearGradient(0,h/2-26,0,h/2-6);ribbon.addColorStop(0,upper?blue:pink);ribbon.addColorStop(1,upper?'#b9e1ff':'#ffd3e3');c.fillStyle=ribbon;c.fillRect(-circumference/2,h/2-26,circumference,20);
 c.strokeStyle=upper?blue:pink;c.lineWidth=1.2;for(const y of [h/2-28,h/2-7]){c.beginPath();c.moveTo(-circumference/2,y);c.lineTo(circumference/2,y);c.stroke();}
 // Delicate cream swags leave the central birthday lettering clear.
 const scallops=Math.round(circumference/58),span=circumference/scallops,top=-h/2+23;
 c.strokeStyle=upper?blue:pink;c.lineWidth=4.5;c.lineCap='round';
 for(let i=0;i<scallops;i++){let x=-circumference/2+i*span;c.strokeStyle=i%2===0?pink:blue;c.beginPath();c.moveTo(x,top);c.quadraticCurveTo(x+span/2,top+14,x+span,top);c.stroke();
  // A second, finer swag and small piped stitches give the border depth.
  c.strokeStyle='rgba(255,255,255,.94)';c.lineWidth=1.2;c.beginPath();
  c.moveTo(x,top-1.6);c.quadraticCurveTo(x+span/2,top+11,x+span,top-1.6);c.stroke();
  c.strokeStyle=i%2===0?blue:pink;c.lineWidth=1.3;c.beginPath();
  c.moveTo(x+3,top+5);c.quadraticCurveTo(x+span/2,top+20,x+span-3,top+5);c.stroke();
  for(let j=1;j<8;j++){
   const u=j/8,yy=top+5+30*u*(1-u);
   c.fillStyle='rgba(255,255,255,.9)';c.beginPath();c.arc(x+3+(span-6)*u,yy,1.05,0,Math.PI*2);c.fill();
  }
  c.fillStyle=upper?pink:blue;c.beginPath();c.arc(x+span/2,top+10,3.3,0,Math.PI*2);c.fill();
  c.fillStyle='#ffffff';c.beginPath();c.arc(x+span/2-.8,top+8.8,1.1,0,Math.PI*2);c.fill();
  // Tiny teardrop knots at each join; the moving lettering retains its open band.
  c.fillStyle=i%2===0?'#ffe9f2':'#e5f6ff';c.beginPath();c.ellipse(x,top+3,2.2,4.8,0,0,Math.PI*2);c.fill();
 }
 for(let i=0;i<scallops*2;i++){let x=-circumference/2+i*span/2;c.fillStyle=upper?pink:blue;c.beginPath();c.arc(x,h/2-13,3.1,0,Math.PI*2);c.fill();}
 const shells=Math.round(circumference/24);c.fillStyle=upper?pink:blue;
 for(let i=0;i<shells;i++){
  const x=-circumference/2+i*circumference/shells,y=h/2-12;
  c.save();c.translate(x,y);c.rotate(-.18);
  const shell=c.createLinearGradient(0,-8,0,6);shell.addColorStop(0,'#ffffff');shell.addColorStop(.4,i%2===0?'#ffe1ed':'#dbf0ff');shell.addColorStop(1,i%2===0?pink:blue);
  c.fillStyle=shell;c.beginPath();c.moveTo(-10,4);
  c.bezierCurveTo(-12,-1,-7,-8,0,-8);c.bezierCurveTo(8,-8,10,-3,11,4);c.quadraticCurveTo(0,7,-10,4);c.fill();
  for(let j=-2;j<=2;j++){
   c.strokeStyle=j%2===0?'rgba(255,255,255,.94)':'rgba(136,167,205,.28)';c.lineWidth=.8;
   c.beginPath();c.moveTo(0,4.5);c.quadraticCurveTo(j*2.2,-1,j*3,-6+Math.abs(j));c.stroke();
  }c.restore();
  c.fillStyle='#ffffff';c.beginPath();c.arc(x+12,y+4,1.4,0,Math.PI*2);c.fill();
 }
 // Closely spaced piped dots frame the ribbon without adding another moving layer.
 for(let i=0;i<shells*3;i++){
  const x=-circumference/2+i*circumference/(shells*3);
  c.fillStyle=i%3===0?'#ffffff':upper?'#daefff':'#ffe1eb';
  c.beginPath();c.arc(x,h/2-29,1.15,0,Math.PI*2);c.fill();
 }
 c.restore();c.save();
 c.translate(g.width/2,g.height*.75);c.scale(g.width/circumference,g.height/(2*h));
 c.font='400 '+fontSize+'px Georgia, serif';c.fontKerning='normal';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#ffffff';
 // Blur is generated once at startup; no per-frame Canvas filters or extra sampler.
 c.shadowColor='rgba(255,255,255,.9)';c.shadowBlur=7;
 // Upper tier has three copies; lower tier has four, evenly spaced.
 const textPositions=tier===TIERS[0]?[-circumference*3/8,-circumference/8,circumference/8,circumference*3/8]:[-circumference/3,0,circumference/3];
 for(const x of textPositions)c.fillText('Happy Birthday to Ray ♡',x,3);c.restore();
}
function uprightPortraitAngle(x,y){
 // Invert the local homography so the projected head-to-chin axis is exactly
 // screen-vertical, even as the portrait moves through the tilted orbit.
 const k=1/(1-y*SUN.depth),ca=Math.cos(SUN.angle),sa=Math.sin(SUN.angle);
 const jxx=ca*k,jxy=k*k*(ca*SUN.depth*x-sa*SUN.flatten);
 return Math.atan2(jxy,jxx);
}
function drawSun(t){let c=sunTex.drawingContext;sunTex.clear();c.save();c.translate(320,320);
 // The aperture stays purely geometric: no visible disk, fill or outline.
 // Equal angular spacing and identical discs on the SAME plane preserve uniform
 // spacing relative to portrait size, including the perspective foreshortening.
 const friends=FRIENDS.map((name,i)=>{let a=i/9*Math.PI*2+t*.085;return{name,a,x:SUN.radius*Math.cos(a),y:SUN.radius*Math.sin(a)};}).sort((a,b)=>a.y-b.y);
 // Cached faint halo breathes behind each portrait, with no per-frame blur.
 for(const f of friends){c.save();c.globalAlpha=.46+.17*Math.sin(t*.85+f.a*.3);c.drawImage(avatarHalo.canvas,f.x-57,f.y-57,114,114);c.restore();}
 for(const f of friends){circlePortrait(c,portraits[f.name],f.x,f.y,39,uprightPortraitAngle(f.x,f.y));}
 c.restore();
 // Names follow the same projected orbit, kept upright and outside the overlap.
 c=front.drawingContext;for(const f of friends){let q=ellipsePoint(f.a,160);c.font='400 16px Georgia, serif';c.textAlign='center';c.textBaseline='middle';c.fillStyle='#ffffff';c.fillText(f.name,q.x,q.y+1);}
}
function coneFrame(target){
 const unit=v=>{let l=Math.hypot(v.x,v.y,v.z);return{x:v.x/l,y:v.y/l,z:v.z/l};};
 const cross=(a,b)=>({x:a.y*b.z-a.z*b.y,y:a.z*b.x-a.x*b.z,z:a.x*b.y-a.y*b.x});
 let delta={x:target.x-SOURCE.x,y:target.y-SOURCE.y,z:target.z-SOURCE.z},distance=Math.hypot(delta.x,delta.y,delta.z),axis=unit(delta);
 return{axis,u:BEAM_U,v:BEAM_V,distance};
}
function coneRay(frame,a,fraction){
 const radial={x:(frame.u.x*Math.cos(a)+frame.v.x*Math.sin(a))*fraction,y:(frame.u.y*Math.cos(a)+frame.v.y*Math.sin(a))*fraction,z:(frame.u.z*Math.cos(a)+frame.v.z*Math.sin(a))*fraction};
 const origin={x:SOURCE.x+CONE.aperture*radial.x,y:SOURCE.y+CONE.aperture*radial.y,z:SOURCE.z+CONE.aperture*radial.z};
 const direction={x:frame.axis.x+CONE.spread*radial.x,y:frame.axis.y+CONE.spread*radial.y,z:frame.axis.z+CONE.spread*radial.z};
 let hit=null;for(const tier of TIERS){let h=hitCylinder(origin,direction,tier);if(h&&(!hit||h.t<hit.t))hit=h;}
 const length=hit?Math.max(0,hit.t-.45):frame.distance*1.35;
 return{origin,direction,length,hit,at(u){return{x:origin.x+direction.x*length*u,y:origin.y+direction.y*length*u,z:origin.z+direction.z*length*u};}};
}
// Fixed aperture samples, balanced across the beam as seen by this camera.
// These origins never rotate or shift with the receiving light spot.
const SILK_APERTURE_SAMPLES=(()=>{
 const dx=CX-SUN.x,dy=CY-S*TIERS[1].hi-SUN.y;
 const ux=BEAM_U.x,uy=-S*BEAM_U.y+C*BEAM_U.z;
 const vx=BEAM_V.x,vy=-S*BEAM_V.y+C*BEAM_V.z;
 const angle=Math.atan2(vx*dy-vy*dx,ux*dy-uy*dx),samples=[];
 // Uniform screen-width spacing avoids the dense side of an angularly sampled ellipse.
 for(let i=0;i<20;i++){
  const cross=-.975+1.95*i/19,a=Math.acos(cross);
  samples.push({a:angle+a,f:.97},{a:angle-a,f:.97});
 }
 for(let i=0;i<16;i++){
  const a=i*2.3999632297,f=Math.sqrt((i+.5)/16)*.85;
  samples.push({a:angle+a,f},{a:angle+a+Math.PI,f});
 }
 return samples;
})();
function silkRay(frame,sample){
 const ray=coneRay(frame,sample.a,sample.f);
 if(ray.hit)return ray;
 // A ray missing the solid must not disappear at its source. Keep its fixed
 // origin and stop at the cake's projected silhouette, or fade before the cake.
 const cakeAt=p=>cakeDepthAt(p.x,-S*p.y+C*p.z)!==-Infinity;
 let end=.70,previous=0;
 for(let j=1;j<=32;j++){
  const u=j/32;
  if(cakeAt(ray.at(u))){
   let lo=previous,hi=u;
   for(let k=0;k<7;k++){const mid=(lo+hi)/2;if(cakeAt(ray.at(mid)))hi=mid;else lo=mid;}
   end=lo;break;
  }previous=u;
 }
 return{...ray,at:u=>ray.at(u*end)};
}
let silkGeometryCache=null;
function updateSilkGeometry(t,target){
 // The light path moves a fraction of a pixel per frame. Cache its geometry at
 // 30 Hz; brightness and travelling glints still animate on every rendered frame.
 if(silkGeometryCache&&t-silkGeometryCache.time<1/30)return silkGeometryCache;
 const c=back.drawingContext,frame=coneFrame(target),rays=[];
 let leftEdge=-1,rightEdge=-1,leftAngle=Infinity,rightAngle=-Infinity;
 for(let i=0;i<SILK_APERTURE_SAMPLES.length;i++){
  const boundary=i<40,ray=silkRay(frame,SILK_APERTURE_SAMPLES[i]);
  const start=project(ray.origin),end=project(ray.at(1));
  if(boundary){
   const angle=Math.atan2(end.x-start.x,end.y-start.y);
   if(angle<leftAngle){leftAngle=angle;leftEdge=i;}
   if(angle>rightAngle){rightAngle=angle;rightEdge=i;}
  }
  const opacity=boundary?.27:.19,gradient=c.createLinearGradient(start.x,start.y,end.x,end.y);
  gradient.addColorStop(0,`rgba(255,255,255,${opacity*.58})`);
  gradient.addColorStop(.7,`rgba(255,255,255,${opacity})`);
  gradient.addColorStop(1,`rgba(255,255,255,${ray.hit?opacity:0})`);
  const path=new Path2D();let previous=0,shown=visible(ray.at(0));
  if(shown)path.moveTo(start.x,start.y);
  for(let j=1;j<=12;j++){
   const u=j/12,p=ray.at(u),q=project(p),show=visible(p);
   if(show===shown){if(show)path.lineTo(q.x,q.y);}
   else{
    let lo=previous,hi=u;
    for(let k=0;k<9;k++){const mid=(lo+hi)/2;if(visible(ray.at(mid))===shown)lo=mid;else hi=mid;}
    const edge=project(ray.at((lo+hi)/2));
    if(shown)path.lineTo(edge.x,edge.y);else{path.moveTo(edge.x,edge.y);path.lineTo(q.x,q.y);}
   }
   previous=u;shown=show;
  }
  rays.push({ray,path,gradient});
 }
 return silkGeometryCache={time:t,rays,leftEdge,rightEdge};
}
function drawSilk(t,target){
 const c=back.drawingContext,cache=updateSilkGeometry(t,target);c.save();
 for(let i=0;i<cache.rays.length;i++){
  const {ray,path,gradient}=cache.rays[i];
  c.globalAlpha=.78+.22*(.5+.5*Math.sin(t*.28+Math.floor(i/2)*.67));
  c.strokeStyle=gradient;c.lineWidth=(i===cache.leftEdge||i===cache.rightEdge)?2.1:.65;c.stroke(path);
  c.globalAlpha=1;
  for(let j=0;j<2;j++){
   const u=(j*.5+t*(.040+(i%5)*.002)+i*.137)%1,p=ray.at(u);if(!visible(p))continue;
   const q=project(p);c.fillStyle='rgba(255,255,255,.85)';c.beginPath();c.arc(q.x,q.y,1.25,0,Math.PI*2);c.fill();
   if(i%17===0&&j===1)heart(c,q.x,q.y,3.6,.4,.85);
  }
 }
 c.restore();
}
function drawSurfaceGlints(t,target){const c=front.drawingContext,frame=coneFrame(target);
 for(let i=0;i<148;i++){
  const phase=t*(1.3+(i%7)*.09)+i*2.39996,twinkle=Math.pow(.5+.5*Math.sin(phase),5);if(twinkle<.06)continue;
  const ray=coneRay(frame,i/148*Math.PI*2+t*.018,.92+.035*Math.sin(i*1.7+t*.7));if(!ray.hit)continue;
  const n=ray.hit.n,p={x:ray.origin.x+ray.direction.x*ray.hit.t+n.x*.8,y:ray.origin.y+ray.direction.y*ray.hit.t+n.y*.8,z:ray.origin.z+ray.direction.z*ray.hit.t+n.z*.8};
  if(!visible(p))continue;const q=project(p);softGlow(c,q.x,q.y,9,twinkle*.24);
  const u=n.y>.5?{x:1,y:0,z:0}:{x:n.z,y:0,z:-n.x},v=n.y>.5?{x:0,y:0,z:1}:{x:0,y:-1,z:0};
  c.save();c.transform(u.x,-S*u.y+C*u.z,v.x,-S*v.y+C*v.z,q.x,q.y);
  if(i%5===0)heart(c,0,0,2.2+(i%3)*.5,i*.63,twinkle*.94);
  else{c.globalAlpha=twinkle;c.fillStyle='#ffffff';c.beginPath();c.arc(0,0,.85+(i%3)*.45,0,Math.PI*2);c.arc(3.5,-2,.65,0,Math.PI*2);c.fill();if(i%11===0){c.strokeStyle='#ffffff';c.lineWidth=.7;c.beginPath();c.moveTo(-4,0);c.lineTo(4,0);c.moveTo(0,-4);c.lineTo(0,4);c.stroke();}}
  c.restore();
 }
}
// Swept segment / capped-cylinder intersection. Shared geometry with the fragment shader.
function hitCylinder(o,d,tier,maxT=Infinity){let best=null;const push=(t,n)=>{if(t>1e-6&&t<=maxT&&(!best||t<best.t))best={t,n};};let a=d.x*d.x+d.z*d.z,b=o.x*d.x+o.z*d.z,cc=o.x*o.x+o.z*o.z-tier.r*tier.r,disc=b*b-a*cc;
 if(a>1e-9&&disc>=0){for(let t of [(-b-Math.sqrt(disc))/a,(-b+Math.sqrt(disc))/a]){let y=o.y+t*d.y;if(y>=tier.lo&&y<=tier.hi)push(t,{x:(o.x+t*d.x)/tier.r,y:0,z:(o.z+t*d.z)/tier.r});}}
 if(Math.abs(d.y)>1e-9){for(const y of [tier.lo,tier.hi]){let t=(y-o.y)/d.y,x=o.x+t*d.x,z=o.z+t*d.z;if(x*x+z*z<=tier.r*tier.r)push(t,{x:0,y:y===tier.hi?1:-1,z:0});}}return best;}
function spawn(t){
 const frame=coneFrame(targetAt(t));
 // Start inside the transparent portrait ring, then spread across the beam.
 // The inner aperture stays visible from the very first particle frames.
 const sample=stats.emitted+1;
 const beamAngle=sample*2.399963229728653;
 const beamFraction=Math.sqrt((sample*.7548776662466927)%1)*.93;
 const ray=coneRay(frame,beamAngle,beamFraction*.55),p=ray.origin,speed=190+Math.random()*90;
 particles.push({...p,vx:ray.direction.x*speed,vy:ray.direction.y*speed,vz:ray.direction.z*speed,beamAngle,beamFraction,travel:0,speed,age:0,trail:[],trailClock:0,size:4.8+Math.pow(Math.random(),1.7)*5.4,angle:(Math.random()-.5)*.5,spin:(Math.random()-.5)*1.0,hits:0});stats.emitted++;
}
function stepPhysics(dt,t){emission+=dt*(10+2*Math.sin(t*.42));while(emission>=1){spawn(t);emission--;}
 const flow=coneFrame(targetAt(t));
 for(let i=particles.length-1;i>=0;i--){let p=particles[i];p.age+=dt;let d,best=null;
 if(p.hits===0){
  // Before impact, particles are carried by the moving emitter's laminar flow.
  // This shares the light cone's aperture, direction and divergence exactly.
  p.travel+=p.speed*dt;
  let ca=Math.cos(p.beamAngle),sa=Math.sin(p.beamAngle),radius=(CONE.aperture*.55+(CONE.spread+CONE.aperture*.45/flow.distance)*p.travel)*p.beamFraction;
  let next={x:SOURCE.x+flow.axis.x*p.travel+(flow.u.x*ca+flow.v.x*sa)*radius,y:SOURCE.y+flow.axis.y*p.travel+(flow.u.y*ca+flow.v.y*sa)*radius,z:SOURCE.z+flow.axis.z*p.travel+(flow.u.z*ca+flow.v.z*sa)*radius};
  d={x:next.x-p.x,y:next.y-p.y,z:next.z-p.z};p.vx=d.x/dt;p.vy=d.y/dt;p.vz=d.z/dt;
  if(p.travel>flow.distance*1.3){particles.splice(i,1);continue;}
 }else{
  // Collision releases the hearts from the flow; restitution, gravity and drag
  // then carry them naturally out of the illuminated region and off screen.
  const drag=Math.exp(-PHYSICS.drag*dt);p.vx*=drag;p.vz*=drag;p.vy=(p.vy-PHYSICS.gravity*dt)*drag;d={x:p.vx*dt,y:p.vy*dt,z:p.vz*dt};
 }
 for(const tier of TIERS){let h=hitCylinder(p,d,tier,1);if(h&&(!best||h.t<best.t))best=h;}
 if(best){let n=best.n;p.x+=d.x*best.t+n.x*.6;p.y+=d.y*best.t+n.y*.6;p.z+=d.z*best.t+n.z*.6;let vn=p.vx*n.x+p.vy*n.y+p.vz*n.z;
 if(vn<0){
  p.vx=(p.vx-(1+PHYSICS.restitution)*vn*n.x)*(1-PHYSICS.friction);
  p.vy=(p.vy-(1+PHYSICS.restitution)*vn*n.y)*(1-PHYSICS.friction);
  p.vz=(p.vz-(1+PHYSICS.restitution)*vn*n.z)*(1-PHYSICS.friction);
  // A directed outward bounce clears the icing; gravity takes over afterwards.
  // Retain tangential motion, but remove inward drift instead of repeated tiny hops.
  const radialLength=Math.hypot(p.x,p.z);
  const rx=radialLength>1?p.x/radialLength:Math.cos(p.beamAngle);
  const rz=radialLength>1?p.z/radialLength:Math.sin(p.beamAngle);
  const outwardSpeed=p.vx*rx+p.vz*rz;
  const impulse=Math.max(0,(n.y>.5?70:50)-outwardSpeed);
  p.vx+=rx*impulse;p.vz+=rz*impulse;
  if(n.y>.5)p.vy=Math.min(38,Math.max(p.vy,26));
  if(p.hits===0)p.fadeStart=p.age;
  p.spin+=p.vx*.006;p.hits++;stats.collisions++;
  if(p.hits<3)sparks.push({x:p.x,y:p.y,z:p.z,age:0});
 }
 let remaining=dt*(1-best.t);p.x+=p.vx*remaining;p.y+=p.vy*remaining;p.z+=p.vz*remaining;
 }else{p.x+=d.x;p.y+=d.y;p.z+=d.z;}p.angle+=p.spin*dt;
 p.trailClock+=dt;if(p.trailClock>=1/30){p.trailClock-=1/30;p.trail.push({x:p.x,y:p.y,z:p.z});if(p.trail.length>16)p.trail.shift();}
 if(project(p).y>H+80||p.age>20||Math.abs(p.x)>1800||particleOpacity(p)<=0){particles.splice(i,1);stats.fallen++;}}
 for(let i=sparks.length-1;i>=0;i--){sparks[i].age+=dt;if(sparks[i].age>.6)sparks.splice(i,1);}
}
function cakeDepthAt(x,sy){
 if(Math.abs(x)>TIERS[0].r||sy<-S*TIERS[1].hi-C*TIERS[1].r||sy>C*TIERS[0].r)return -Infinity;
 let nearest=-Infinity;
 for(let i=0;i<TIERS.length;i++){
  const tier=TIERS[i],radial=tier.r*tier.r-x*x;if(radial<0)continue;
  const z=Math.sqrt(radial),sideDepth=(z-C*sy)/S,sideY=-S*sy+C*sideDepth;
  if(sideY>=tier.lo&&sideY<=tier.hi)nearest=Math.max(nearest,sideDepth);
  const topDepth=(tier.hi+S*sy)/C,topZ=C*sy+S*topDepth;
  if(topZ*topZ<=radial)nearest=Math.max(nearest,topDepth);
 }
 return nearest;
}
function visible(p){
 const depth=cakeDepthAt(p.x,-S*p.y+C*p.z);
 return C*p.y+S*p.z>=depth-.9;
}
function outsideSun(p){
 const q=project(p),dx=q.x-SUN.x,dy=q.y-SUN.y,ca=Math.cos(SUN.angle),sa=Math.sin(SUN.angle);
 const xp=ca*dx+sa*dy,yp=-sa*dx+ca*dy,y=yp/(SUN.flatten+yp*SUN.depth),k=1/(1-y*SUN.depth),x=xp/k;
 return x*x+y*y>(SUN.radius+40)**2;
}
// First impact starts a shared fade for the heart, filament and soft halo.
function particleOpacity(p){
 if(p.fadeStart===undefined){const birth=Math.min(1,p.age/.22);return birth*birth*(3-2*birth);}
 const u=Math.min(1,Math.max(0,(p.age-p.fadeStart)/2.8));
 return 1-u*u*(3-2*u);
}
function drawParticles(){const c=front.drawingContext;
 for(const p of particles){
  if(!visible(p))continue;
  const opacity=particleOpacity(p);
  c.save();c.globalAlpha=opacity;c.lineCap='round';c.lineJoin='round';
  // Half-second history at 30 Hz; one constant-width white line.
  c.strokeStyle='rgba(255,255,255,.58)';c.lineWidth=1;c.beginPath();
  let connected=false;
  for(const v of p.trail){
   if(!visible(v)){connected=false;continue;}
   const q=project(v);if(connected)c.lineTo(q.x,q.y);else c.moveTo(q.x,q.y);connected=true;
  }
  if(connected){const tip=project(p);c.lineTo(tip.x,tip.y);}c.stroke();
  const q=project(p);heart(c,q.x,q.y,p.size,p.angle,opacity);c.restore();
 }
 for(const s of sparks){if(!visible(s))continue;const p=project(s);c.save();c.globalAlpha=1-s.age/.6;c.strokeStyle='#ffffff';c.lineWidth=1;c.beginPath();for(let i=0;i<5;i++){let a=i/5*Math.PI*2,r=4+s.age*36;c.moveTo(p.x+Math.cos(a)*r,p.y+Math.sin(a)*r*.6);c.lineTo(p.x+Math.cos(a)*(r+5),p.y+Math.sin(a)*(r+5)*.6);}c.stroke();c.restore();}
}
function softGlow(c,x,y,r,alpha,yellow=false){
 const previous=c.globalAlpha;c.globalAlpha=alpha;c.drawImage(glowSprites[yellow?1:0].canvas,x-r,y-r,r*2,r*2);c.globalAlpha=previous;
}
// Light the existing pearls in place; all soft halos reuse the cached sprite.
function drawClockworkPearls(t,c,g){
 const tau=Math.PI*2;
 for(let layer=0;layer<TIERS.length;layer++){
  const tier=TIERS[layer],upper=layer===1,count=upper?72:96;
  const direction=upper?1:-1,period=upper?24:30;
  const phase=direction*t/period+(upper?.12:.62),radius=tier.r*488/512;
  for(let i=0;i<count;i++){
   const travel=((phase-i/count)*direction%1+1)%1;
   if(travel>.16)continue;
   const rise=Math.min(1,travel/.012);
   const pulse=Math.exp(-travel*30)*rise*rise*(3-2*rise);
   if(pulse<.008)continue;
   const angle=i/count*tau,p={x:Math.cos(angle)*radius,y:tier.hi+.7,z:Math.sin(angle)*radius};
   if(!visible(p))continue;
   const q=project(p),beadRadius=tier.r*3.8/512;
   c.save();c.globalAlpha=pulse*.95;c.fillStyle='#ffffff';
   c.beginPath();c.ellipse(q.x,q.y,beadRadius,beadRadius*C,0,0,tau);c.fill();
   // Occasional tiny pinpricks keep the procession delicate, rather than a solid arc.
   if(i%6===0&&pulse>.45){
    const arm=1.5+pulse*2;c.globalAlpha=(pulse-.45)*.7;
    c.strokeStyle='#ffffff';c.lineWidth=.6;c.beginPath();
    c.moveTo(q.x-arm,q.y);c.lineTo(q.x+arm,q.y);
    c.moveTo(q.x,q.y-arm);c.lineTo(q.x,q.y+arm);c.stroke();
   }
   c.restore();softGlow(g,q.x,q.y,7+beadRadius,pulse*.25);
  }
 }
}
function drawDreamGlow(t,target){
 glowTex.clear();const c=front.drawingContext,g=glowTex.drawingContext,frame=coneFrame(target);g.save();g.scale(glowTex.width/W,glowTex.height/H);
 for(let i=0;i<108;i++){
  const ray=coneRay(frame,i*2.39996323,.12+Math.sqrt((i+.5)/109)*.80);if(!ray.hit)continue;
  const u=(i*.173+t*(.028+(i%5)*.004))%1,p=ray.at(u);if(!visible(p)||!outsideSun(p))continue;
  const q=project(p),pulse=Math.pow(.5+.5*Math.sin(t*(1.7+(i%7)*.13)+i*3.17),4),alpha=.12+.80*pulse;
  softGlow(g,q.x,q.y,14+(i%5)*5,alpha*.55,i%4===0);
  c.save();c.globalAlpha=alpha;c.fillStyle='#ffffff';c.beginPath();c.arc(q.x,q.y,.7+(i%3)*.45,0,Math.PI*2);c.fill();
  if(i%8===0){let r=3+pulse*4;c.strokeStyle='#ffffff';c.lineWidth=.75;c.beginPath();c.moveTo(q.x-r,q.y);c.lineTo(q.x+r,q.y);c.moveTo(q.x,q.y-r*1.25);c.lineTo(q.x,q.y+r*1.25);c.stroke();}c.restore();
 }
 // Out-of-focus motes soften the atmosphere near the sun and cake.
 for(let i=0;i<28;i++){
  const nearSun=i<12,angle=i*2.39996+t*.018,r=(nearSun?160:260)+(i%5)*17;
  const x=(nearSun?SUN.x:CX)+Math.cos(angle)*r,y=(nearSun?SUN.y:CY-140)+Math.sin(angle)*r*(nearSun?.63:.48);
  const alpha=.035+.055*(.5+.5*Math.sin(t*.7+i));softGlow(g,x,y,12+(i%4)*8,alpha,i%3===0);
 }
 // Low-resolution soft focus on the lit surface; reuse the preblurred glow sprite.
 for(let i=0;i<18;i++){
  const ray=coneRay(frame,i*2.39996323,Math.sqrt((i+.5)/18)*.89);if(!ray.hit)continue;
  const n=ray.hit.n,p={x:ray.origin.x+ray.direction.x*ray.hit.t+n.x,y:ray.origin.y+ray.direction.y*ray.hit.t+n.y,z:ray.origin.z+ray.direction.z*ray.hit.t+n.z};
  if(!visible(p))continue;const q=project(p);softGlow(g,q.x,q.y,28+(i%3)*7,.15);
 }
 // A few cached, low-opacity halos soften the peripheral contours.
 for(let i=0;i<10;i++){
  const a=i/10*Math.PI*2,r=TIERS[0].r,p={x:Math.cos(a)*r,y:8,z:Math.sin(a)*r};
  if(!visible(p))continue;const q=project(p);softGlow(g,q.x,q.y,24+(i%3)*6,.012);
 }
 drawClockworkPearls(t,c,g);
 for(const p of particles){if(!visible(p))continue;const q=project(p);softGlow(g,q.x,q.y,18,.24*particleOpacity(p));}
 g.restore();
}

function draw(){if(!program)return;let dt=Math.min(deltaTime/1000,.08);if(!paused){accumulator+=dt;while(accumulator>=PHYSICS.step){clockTime+=PHYSICS.step;stepPhysics(PHYSICS.step,clockTime);accumulator-=PHYSICS.step;}}
 back.clear();front.clear();let target=targetAt(clockTime);drawSilk(clockTime,target);drawSun(clockTime);drawSurfaceGlints(clockTime,target);drawDreamGlow(clockTime,target);drawHeroCandles(target);drawPoeticLight(clockTime);drawParticles();
 shader(program);program.setUniform('resolution',[W,H]);program.setUniform('glowLayer',glowTex);const dual=beamDuals(target);program.setUniform('beamDualU',dual[0]);program.setUniform('beamDualV',dual[1]);program.setUniform('beamDualAxis',dual[2]);program.setUniform('coneShape',[CONE.aperture,CONE.spread]);program.setUniform('cakeOrigin',[CX,CY]);program.setUniform('lowerTier',[TIERS[0].r,TIERS[0].lo,TIERS[0].hi]);program.setUniform('upperTier',[TIERS[1].r,TIERS[1].lo,TIERS[1].hi]);program.setUniform('sunPose',[SUN.x,SUN.y,SUN.angle,SUN.flatten]);program.setUniform('sunLayer',sunTex);program.setUniform('time',clockTime);program.setUniform('lightPos',[SOURCE.x,SOURCE.y,SOURCE.z]);program.setUniform('target',[target.x,target.y,target.z]);program.setUniform('backLayer',back);program.setUniform('frontLayer',front);program.setUniform('topLayer',topTex);program.setUniform('lowerTopLayer',lowerTopTex);program.setUniform('upperSideLayer',upperSideTex);program.setUniform('lowerLayer',lowerTex);
 beginShape(TRIANGLE_STRIP);vertex(-1,-1,0);vertex(1,-1,0);vertex(-1,1,0);vertex(1,1,0);endShape();}
async function recordClip(){if(recording)return;const status=document.getElementById('status');if(!canvasEl.captureStream||!window.MediaRecorder){status.textContent='此浏览器不支持录制，请使用 Chrome。';return;}if(paused)togglePause();recording=true;const button=document.getElementById('record');button.disabled=true;
 let mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4'].find(m=>MediaRecorder.isTypeSupported(m));let stream=canvasEl.captureStream(30);const musicTrack=window.rayMusic?.recordingTrack();if(musicTrack)stream.addTrack(musicTrack);let rec=new MediaRecorder(stream,{mimeType:mime,videoBitsPerSecond:10000000}),chunks=[];
 rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};rec.onstop=()=>{let blob=new Blob(chunks,{type:rec.mimeType}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='Happy-Birthday-Ray.'+(rec.mimeType.includes('mp4')?'mp4':'webm');a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);stream.getTracks().forEach(t=>t.stop());recording=false;button.disabled=false;status.textContent='录制完成 · 1000 × 1500';};rec.start();let remaining=12;status.textContent='正在录制 · '+remaining+' 秒';let interval=setInterval(()=>{remaining--;status.textContent='正在录制 · '+remaining+' 秒';if(remaining<=0){clearInterval(interval);rec.stop();}},1000);}
window.addEventListener('error',e=>{let el=document.getElementById('error');el.style.display='block';el.textContent='动画未能载入：'+e.message;});
