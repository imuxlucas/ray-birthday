/* Sculpted candle crowns taken from the visible SVG artwork in
   https://ray-heart.pages.woa.com/ — not substituted with font glyphs.
   Original layout: R above; H E A R T below; three short vertical blocks. */
const HERO_CANDLE_PATHS = {
 R:'M127.721 177.531L211.188 309.897H159.827L82.3487 180.518H54.0887V309.897H13V11H98.586C171.343 11 201.354 38.7552 201.354 95.9659C201.354 147.272 176.525 169.398 127.744 177.531H127.721ZM158.123 95.9659C158.123 131.832 143.106 142.079 98.586 142.079H54.1116V49.4162H98.586C143.106 49.4162 158.123 60.1001 158.123 95.9659Z',
 H:'M13 11H54.089V138.675H170.099V11H211.188V309.897H170.099V177.091H54.089V309.897H13Z',
 E:'M19 11H206V49.416H60.089V138.675H190V177.091H60.089V271.481H206V309.897H19Z',
 A:'M146.68 11L225.863 309.897H180.053L156.929 216.821H66.6212L43.935 309.897H-1L77.331 11H146.68ZM111.579 32.7816L147.969 180.518H75.6266L111.579 32.7816Z',
 T:'M0 11H225V49.416H133.044V309.897H91.956V49.416H0Z'
};
const HERO_CANDLES = [
 ['R',0,-3],['H',-2,1],['E',-1,2],['A',0,3],['R',1,2],['T',2,1],
 ['I',-2,-1],['I',0,1],['I',2,-1]
].map(([letter,x,z])=>({letter,scale:.82,x:x*78*.82,z:(z*54+30)*.82})).sort((a,b)=>a.z-b.z);
let heroCandleTiles=[];

// Flat original vector artwork, cached with the same perspective as the cake top.
function buildHeroCandles(){
 const paths=Object.fromEntries(Object.entries(HERO_CANDLE_PATHS).map(([letter,d])=>[letter,new Path2D(d)]));
 heroCandleTiles=HERO_CANDLES.map(letter=>{
  const block=letter.letter==='I',width=(block?7.2:26)*letter.scale,height=(block?14.4:39)*letter.scale;
  const variants=[false,true].map(lit=>{
   const tile=createGraphics(128,96);tile.pixelDensity(1);const c=tile.drawingContext;
   c.scale(2,2);c.translate(32-width/2,32-height*C/2);c.scale(1,C);
   c.fillStyle='#ff1c1c'; // Original website red, unchanged by the light sweep.
   if(block)c.fillRect(0,0,width,height);
   else{c.scale(width/225,height/321);c.fill(paths[letter.letter],'evenodd');}
   return tile;
  });
  return {...letter,depth:0,variants};
 });
}
function drawHeroCandles(target){
 const c=front.drawingContext,dual=beamDuals(target);
 for(const letter of heroCandleTiles){
  const world={x:letter.x,y:TIERS[1].hi+.15,z:letter.z},q=project(world);
  const delta=[world.x-SOURCE.x,world.y+letter.depth/2-SOURCE.y,world.z-SOURCE.z];
  const local=dual.map(axis=>axis[0]*delta[0]+axis[1]*delta[1]+axis[2]*delta[2]);
  const radius=CONE.aperture+Math.max(0,local[2])*CONE.spread;
  const edge=Math.max(0,Math.min(1,(Math.hypot(local[0],local[1])/radius-.93)/.07));
  const illumination=local[2]>0?1-edge*edge*(3-2*edge):0;
  // The original red artwork is revealed with the illuminated cake surface.
  c.save();c.globalAlpha=illumination;
  c.drawImage(letter.variants[0].canvas,q.x-32,q.y-32,64,48);c.restore();
 }
}
