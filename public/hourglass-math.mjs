// Presentation-only helpers for the Web study; these do not evaluate native rules.
export const HOUR = 3600000;
export const MINUTE = 60000;

// The exact same softly curved outline is used by the SVG and the area model.
export const UPPER_BOWL_PATH = 'M63 30H137C149 30 153 36 148 50C140 71 121 91 108 107C104 112 96 112 92 107C79 91 60 71 52 50C47 36 51 30 63 30Z';
export const LOWER_BOWL_PATH = 'M63 210H137C149 210 153 204 148 190C140 169 121 149 108 133C104 128 96 128 92 133C79 149 60 169 52 190C47 204 51 210 63 210Z';
const curves = [
  [[137,30],[149,30],[153,36],[148,50]],
  [[148,50],[140,71],[121,91],[108,107]],
  [[108,107],[104,112],[96,112],[92,107]],
  [[92,107],[79,91],[60,71],[52,50]],
  [[52,50],[47,36],[51,30],[63,30]],
];
const outline = [[63,30],[137,30]];
for (const points of curves) for (let step=1;step<=64;step++) {
  const t=step/64,u=1-t;
  outline.push([0,1].map(axis=>u**3*points[0][axis]+3*u*u*t*points[1][axis]+3*u*t*t*points[2][axis]+t**3*points[3][axis]));
}
const minY=30,maxY=Math.max(...outline.map(point=>point[1]));
function area(points) {
  let sum=0;
  for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];sum+=a[0]*b[1]-b[0]*a[1];}
  return Math.abs(sum)/2;
}
export const BOWL_AREA=area(outline);
export function bowlAreaBelow(y) {
  const clipped=[];
  for(let i=0;i<outline.length;i++){
    const a=outline[i],b=outline[(i+1)%outline.length],insideA=a[1]>=y,insideB=b[1]>=y;
    if(insideA)clipped.push(a);
    if(insideA!==insideB){const t=(y-a[1])/(b[1]-a[1]);clipped.push([a[0]+t*(b[0]-a[0]),y]);}
  }
  return area(clipped);
}

export function sandLevels(fraction) {
  const remaining = Number.isFinite(fraction) ? Math.max(0, Math.min(1, fraction)) : 0;
  let low=minY,high=maxY;
  for(let step=0;step<24;step++){
    const mid=(low+high)/2;
    if(bowlAreaBelow(mid)>BOWL_AREA*remaining)low=mid;else high=mid;
  }
  const upperY=remaining===1?minY:remaining===0?maxY:(low+high)/2;
  return { remaining, upperY, lowerY:240-upperY };
}

export function remainingTime(expiresAt, now) { return Math.max(0, expiresAt - now); }

export function humanTime(milliseconds) {
  if (milliseconds <= 0) return '終了';
  if (milliseconds < MINUTE) return '1分未満';
  const minutes = Math.ceil(milliseconds / MINUTE), hours = Math.floor(minutes / 60), rest = minutes % 60;
  return hours ? `${hours}時間${rest ? rest + '分' : ''}` : `${rest}分`;
}

export function clockTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}
