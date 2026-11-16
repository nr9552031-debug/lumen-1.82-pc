/* Projection Studio renderer: draws every mapped shape with its own animation on one WebGL canvas.
   Used by the editor preview and by the projector window, so both show the same thing.
   Each shape is drawn as its own triangles, so an animation can never spill outside its shape. */
(function (root) {
  'use strict';
  const P = root.LumenProj, EVO = root.LumenEvolve;
  const XF_STYLES = ['fade', 'dissolve', 'bloom', 'sweep', 'morph'], AUTO_CTX = { allowTransition: true };
  const wrapPi = (a) => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
  const HEAD = `#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 u; uniform float T,H,B,O,A,K,ASP,SHIFT; uniform int MODE; uniform vec4 P0,P1,P2,E0,E1,XF; uniform sampler2D PALETTE;
#define FLOW E0.xy
#define PHASE E0.z
#define MORPH E0.w
#define LAYER E1.x
#define DETAIL E1.y
#define DENS E1.z
#define MOOD E1.w
#define WARP P0.x
#define TURB P0.y
#define EMIT P0.z
#define SWELL P0.w
#define SPIN P1.x
#define TINT P1.y
#define SHOCKR P1.z
#define SHOCKA P1.w
#define HIT P2.x
#define CPLX P2.y
#define SHIM P2.z
#define DROP P2.w
float h1(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float n2(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(h1(i),h1(i+vec2(1,0)),f.x),mix(h1(i+vec2(0,1)),h1(i+vec2(1,1)),f.x),f.y);}
float fbm(vec2 p){float a=.5,s=0.;for(int i=0;i<5;i++){s+=a*n2(p);p=mat2(.8,.6,-.6,.8)*p*2.03+7.1;a*=.5;}return s;}
vec3 pal(float t,vec3 d){float q=fract(.5+.5*cos(6.2832*(t+dot(d,vec3(1.7,3.1,5.3)))));return texture2D(PALETTE,vec2(q,.5)).rgb;}
vec3 hue(vec3 c,float a){vec3 k=vec3(.57735);float ca=cos(a),sa=sin(a);return c*ca+cross(k,c)*sa+k*dot(k,c)*(1.-ca);}
`;
  // transition masks (XF.x style, XF.y progress 0..1): 0 fade, 1 dissolve, 2 bloom from the centre, 3 sweep, 4 morph (a fade
  // whose warp is driven from the CPU). The outgoing pass computes the same mask, so both add up to the shape's opacity.
  const TAIL = `
float xfm(vec2 q,float s,float k){if(s<.5||s>3.5)return k*k*(3.-2.*k);
 if(s<1.5){float n=fbm(q*5.+3.7);return mix(smoothstep(n-.18,n+.18,k*1.36-.18),k*k*(3.-2.*k),.3);}
 if(s<2.5){float r=length(q-.5)*1.42+.08*(n2(q*7.)-.5);return mix(smoothstep(r-.36,r,k*1.36),k*k*(3.-2.*k),.3);}
 float x=q.x+.15*(n2(q*6.)-.5);return mix(smoothstep(x-.36,x,k*1.36),k*k*(3.-2.*k),.3);}
void main(){vec2 p=(u*2.-1.)*vec2(ASP,1.);
 float ang=SPIN*.32;p=mat2(cos(ang),-sin(ang),sin(ang),cos(ang))*p;p*=1.-.16*SWELL-.1*DROP;
 p+=(WARP*.15+DROP*.1)*vec2(n2(p*2.1+T*.7)-.5,n2(p*2.1-T*.6+5.3)-.5)*2.;
 float rr=length(p),ring=exp(-pow((rr-SHOCKR*1.9)*6.,2.))*SHOCKA;p*=1.-.11*ring;
 p+=SHIM*.012*vec2(sin(p.y*38.+T*9.),cos(p.x*38.-T*8.));
 p+=DETAIL*.006*vec2(sin(p.y*47.+PHASE*9.),cos(p.x*43.-PHASE*8.));
 vec3 c=hue(fx(p,T),H+TINT*1.2);float rawL=clamp(dot(c,vec3(.299,.587,.114)),0.,1.);c=mix(c,texture2D(PALETTE,vec2(fract(rawL+SHIFT+TINT*.08),.5)).rgb,.32);c=c*B*(1.+A*.45+ring*.35+DROP*.3)+K*.12;c=max(c,0.);c=mix(c,.8+.2*(1.-exp(-(c-.8)*5.)),step(.8,c));c+=(h1(gl_FragCoord.xy+fract(T)*61.)-.5)/200.;c=clamp(c,0.,1.);
 float lum=dot(c,vec3(.299,.587,.114));c=mix(c,clamp(mix(vec3(lum),c,1.3)*(1.+.1*MOOD),0.,1.),max(MOOD,0.)*.55);c=mix(c,mix(vec3(lum),c,.82)*.93,max(-MOOD,0.)*.45);
 float al=O;if(XF.z>.5){float m=xfm(u,XF.x,XF.y);al=XF.z<1.5?(MODE==0?O*(1.-m)/max(1e-4,1.-O*m):O*(1.-m)):O*m;}
 if(MODE==0)gl_FragColor=vec4(c,al);else gl_FragColor=vec4(c*al,1.);}`;
  // p: centred coordinates (y from -1 to 1), u: 0..1 across the shape, t: seconds, A: audio drive 0..1, K: beat flash 0..1
  const FX = {
    galaxy: `vec3 fx(vec2 p,float t){float r=length(p),a=atan(p.y,p.x);float cloud=fbm(p*(1.55+.35*CPLX)+FLOW*.16+vec2(t*.018,-t*.012));float twist=fbm(p*2.4+vec2(t*.025,PHASE*.05));float arm=exp(-abs(sin(a*(2.15+.35*MORPH)-r*(5.4+1.2*CPLX)+twist*2.7-t*.14+PHASE*.12))*(8.+DETAIL*5.));float dust=exp(-r*(1.25-.25*SWELL))*arm*(.42+.5*cloud+.22*EMIT);vec2 cell=floor((p+FLOW*.015)*vec2(38.,29.));float seed=h1(cell);float star=step(.992-.022*EMIT-.012*DENS,seed)*(.75+.25*sin(t*.42+seed*6.28));float core=exp(-r*(4.5+2.*HIT))*(.25+.3*A+.22*SHOCKA);return pal(.12+r*.17+dust*.28+TINT*.04,vec3(0.,.33,.67))*(dust+.12*cloud*exp(-r*.8))+pal(.88,vec3(0.,.33,.67))*star*(.18+.2*EMIT)+pal(.96,vec3(0.,.33,.67))*core;}`,
    stars: `vec3 fx(vec2 p,float t){vec3 c=pal(.12,vec3(0.,.33,.67))*.025;for(int i=0;i<3;i++){float fi=float(i);float scale=12.+fi*10.;vec2 q=(p+FLOW*(.045+.025*fi))*scale+vec2(t*(.012+.009*fi),-t*(.008+.006*fi));vec2 cell=floor(q),f=fract(q)-.5;float seed=h1(cell+vec2(fi*17.,5.));float gate=step(.986-.035*EMIT-.018*DENS,seed);float radius=.012+.018*seed+.008*SWELL;float core=1.-smoothstep(radius,radius+.018,length(f));float spike=exp(-abs(f.x)*115.)*exp(-abs(f.y)*9.)+exp(-abs(f.y)*115.)*exp(-abs(f.x)*9.);float breathe=.9+.1*sin(t*.55+seed*6.28+fi);c+=pal(.78+seed*.14+fi*.035,vec3(0.,.33,.67))*gate*(core+spike*.18)*breathe*(.5+.18*fi+.22*A+.12*SHIM);}return c;}`,
    nebula: `vec3 fx(vec2 p,float t){vec2 q=p*(1.55+.55*CPLX)+FLOW*.18;float low=fbm(q*1.25+vec2(t*.018,-t*.012));vec2 warp=vec2(fbm(q*1.1+vec2(3.2,t*.025)),fbm(q*1.1+vec2(8.1,-t*.021)));float cloud=fbm(q*2.05+(warp-.5)*(1.6+2.*TURB));float veil=smoothstep(.34-.08*SWELL,.7,cloud+.16*(low-.5));float filament=pow(max(0.,fbm(q*4.+warp*2.)-.54),2.)*DETAIL;float pocket=pow(max(0.,fbm(q*1.8-vec2(t*.015,0.)+PHASE*.02)-.55),2.)*(.5+EMIT);return pal(.14+cloud*.47+low*.15+TINT*.04,vec3(0.,.33,.67))*(veil*(.28+.42*SWELL+.2*A)+filament*.9+pocket*.45)*(.75+.25*LAYER);}`,
    aurora: `vec3 fx(vec2 p,float t){vec3 c=vec3(0.);for(int i=0;i<4;i++){float fi=float(i);float crest=.22*sin(p.x*(1.3+.25*fi+MORPH*.3)+t*(.27+.04*fi)+fi*1.7+PHASE*.2);float warp=(fbm(vec2(p.x*(1.4+.2*fi)+FLOW.x*.2,t*.16+fi*4.))-.5)*(.35+.6*TURB);float d=p.y-(-.15+fi*.26+crest+warp);float veil=exp(-d*d*(8.+1.8*fi));float fold=.4+.6*fbm(vec2(p.x*(4.+fi)+fi*5.,t*.24+fi));float edge=clamp((p.y+1.2)*.7,0.,1.);c+=pal(.18+fi*.14+fold*.26+t*.018,vec3(0.,.33,.67))*veil*fold*edge*(.65+.4*EMIT)*(1.+.35*A);}return c;}`,
    warp: `vec3 fx(vec2 p,float t){vec2 q=p+FLOW*.18;float n=fbm(q*1.35+vec2(t*.04,PHASE*.08));vec2 bend=vec2(sin(q.y*2.4+t*.13+n*2.),cos(q.x*1.8-t*.11+n*2.));vec2 w=q+bend*(.2+.38*TURB);float field=fbm(w*(2.1+MORPH)+vec2(SPIN*.2,-t*.035));float ribbons=exp(-abs(sin((w.x*2.3+w.y*1.3+field*3.+t*.12)*3.))*(7.+DETAIL*9.));float fold=.5+.5*sin(w.x*1.8-w.y*2.2+field*5.+PHASE*.3);return pal(.12+field*.55+fold*.12,vec3(0.,.33,.67))*(.18+.56*ribbons+.28*field+.18*A);}`,
    fire: `vec3 fx(vec2 p,float t){float rise=1.-u.y;vec2 q=vec2(p.x*(1.4-.45*rise)+FLOW.x*.35,u.y*1.65+t*.22+PHASE*.08);float n=fbm(q*(2.+TURB))+ .38*fbm(q*4.1+vec2(2.3,-t*.12));float width=mix(.62,.1,rise)+.12*SWELL;float edge=1.-smoothstep(width,width+.16,abs(p.x)+.18*(n-.5)*(1.+TURB));float crown=1.-smoothstep(.62,1.05,rise-.18*(n-.5));float flame=smoothstep(.22,.62,n+.32*(1.-rise)+.24*WARP)*edge*crown;float tongues=pow(max(0.,sin(p.x*(11.+4.*CPLX)+n*8.-t*.18+PHASE)),5.)*EMIT*.18;flame=clamp(flame+tongues*edge,0.,1.);return pal(.06+flame*.62+rise*.05,vec3(0.,.33,.67))*flame*(.85+.45*A+.25*DROP);}`,
    smoke: `vec3 fx(vec2 p,float t){vec2 q=vec2(p.x*1.05+FLOW.x*.28+.22*sin(u.y*3.2+t*.12+PHASE*.2),u.y*1.7+t*.075-FLOW.y*.2);float low=fbm(q*1.7+vec2(0.,t*.025));vec2 warp=vec2(fbm(q*1.2+vec2(3.1,t*.04)),fbm(q*1.35+vec2(8.4,-t*.035)));float n=fbm(q*2.1+(warp-.5)*(1.1+2.*TURB));float plume=smoothstep(.34-.12*SWELL,.72,n+.18*(low-.5));float body=exp(-abs(p.x+FLOW.x*.15)*(.65+.4*u.y))*(.65+.35*low);float wisps=pow(max(0.,fbm(q*3.3+vec2(1.,-t*.02))-.48),2.)*DETAIL;return pal(.2+n*.5+u.y*.06,vec3(0.,.33,.67))*plume*body*(.5+.5*LAYER+.35*A)+pal(.62,vec3(0.,.33,.67))*wisps*.35;}`,
    clouds: `vec3 fx(vec2 p,float t){vec2 q=vec2(p.x*1.15+t*(.035+.025*WARP)+FLOW.x,p.y*1.35+FLOW.y*.2);float broad=fbm(q*1.35+vec2(t*.018,0.));vec2 warp=vec2(fbm(q*1.1+vec2(2.7,t*.025)),fbm(q*1.1+vec2(7.4,-t*.02)));float n=fbm(q*2.05+(warp-.5)*(1.25+2.*TURB));float cloud=smoothstep(.43-.1*SWELL,.69,n+.2*(broad-.5));float light=clamp(.28+.48*cloud+.18*broad+.16*A,0.,1.);float underside=1.-smoothstep(.46,.76,p.y+.18*(n-.5));return pal(.16+light*.52+TINT*.04,vec3(0.,.33,.67))*light*(.58+.42*LAYER)+pal(.82,vec3(0.,.33,.67))*cloud*underside*.22;}`,
    ocean: `vec3 fx(vec2 p,float t){vec2 q=p*(2.5-.35*MORPH)+FLOW*.22;float a=sin(q.x*1.35+sin(q.y*1.1-t*.22)*.42-t*.3+PHASE*.12);float b=sin(q.y*1.55+sin(q.x*.8+t*.17)*.3+t*.23);float swell=.5+.25*a+.25*b;float crossWave=sin(q.x*3.2+b*1.5+t*.16)*sin(q.y*3.4-a*1.4-t*.13);float caustic=pow(max(0.,crossWave),3.+2.*DETAIL);float glint=pow(max(0.,.5+.5*sin(q.x*5.+q.y*4.-t*.22+2.*a)),10.)*SHIM;vec3 water=pal(.27+swell*.25+TINT*.03,vec3(0.,.33,.67))*(.35+.45*swell+.4*A);return water+pal(.72+caustic*.16,vec3(0.,.33,.67))*caustic*(.35+1.2*SHIM)+pal(.9,vec3(0.,.33,.67))*glint*.22+LAYER*.12*pal(.62+u.y*.15,vec3(0.,.33,.67));}`,
    waves: `vec3 fx(vec2 p,float t){float swell=0.;vec3 c=pal(.2+.18*(.5+.5*sin(p.y*1.4+PHASE*.1)),vec3(0.,.33,.67))*(.14+.12*SWELL);for(int i=0;i<4;i++){float fi=float(i);float phase=p.y*(2.05+fi*.62)+p.x*(.72+fi*.16)+.24*sin(p.x*(1.45+fi*.1)+t*.25+fi+FLOW.x)+t*(.28+fi*.045)+PHASE*.035;float crest=exp(-abs(sin(phase))*(17.+4.*fi+SHIM*9.));float foam=exp(-abs(sin(phase+.12*sin(p.x*2.1-t*.2)))*(30.+DETAIL*12.));c+=pal(.14+fi*.16+phase*.035,vec3(0.,.33,.67))*crest*(.22+.08*fi+.28*SWELL+.18*A);c+=pal(.84,vec3(0.,.33,.67))*foam*(.04+.09*LAYER+.05*SHIM);}return c;}`,
    portal: `vec3 fx(vec2 p,float t){vec2 q=p-FLOW*.1;float r=length(q),a=atan(q.y,q.x);float swirl=fbm(vec2(a*2.5+r*4.-t*(.24+.18*TURB),r*4.+t*.08));float wobble=.035*sin(a*4.+PHASE*.2+t*.16)+.035*(swirl-.5);float radius=.62+.07*SWELL+.025*sin(t*.22+PHASE*.1);float ring=exp(-abs(r-radius-wobble)*(34.+DETAIL*18.));float inner=1.-smoothstep(radius-.04,radius+.08,r);float rim=exp(-abs(r-(radius+.09))*18.);float depth=fbm(q*2.1+vec2(t*.025,-t*.04)+swirl*.8);vec3 c=pal(.18+swirl*.42+depth*.12,vec3(0.,.33,.67))*ring*(.42+.38*A+.25*HIT);c+=pal(.22+depth*.28,vec3(0.,.33,.67))*inner*(.18+.24*EMIT+.18*SWELL);c+=pal(.78,vec3(0.,.33,.67))*rim*LAYER*.28;return c;}`,
    energy: `vec3 fx(vec2 p,float t){vec2 q=abs(p)/vec2(ASP,1.);float edge=max(q.x,q.y);float n=fbm(vec2((u.x+u.y)*5.+t*.055+PHASE*.1,(u.x-u.y)*5.-t*.045));float thickness=.018+.012*SWELL;float rail=exp(-abs(edge-(.72+.035*sin(t*.22+PHASE*.1)))* (24.+DETAIL*14.));float pulse=exp(-abs(sin(edge*19.-t*(.42+.12*A)+n*2.))* (8.+TURB*5.));float inner=exp(-edge*3.)*(.18+.16*n);float corner=exp(-abs(q.x-q.y)*22.)*smoothstep(.42,.78,edge);return pal(.16+n*.38+edge*.2,vec3(0.,.33,.67))*(rail*(.5+.3*EMIT)+pulse*thickness+inner)+pal(.8,vec3(0.,.33,.67))*corner*LAYER*.16;}`,
    lightning: `vec3 fx(vec2 p,float t){float y=u.y;float drift=.025*sin(t*.11+PHASE*.08);float jag=(fbm(vec2(y*12.+PHASE*.1,t*.025))-.5)*(.16+.14*TURB);float trunkX=.18*sin(y*5.4+PHASE*.08)+.1*sin(y*12.5-t*.035)+jag+FLOW.x*.06+drift;float trunk=exp(-abs(p.x-trunkX)*(52.+SHIM*22.));float branchX=trunkX+.42*sin(y*7.2+PHASE*.13)*smoothstep(.18,.55,y);float branch=exp(-abs(p.x-branchX)*(36.+DETAIL*14.))*(1.-smoothstep(.48,.78,y));float twigX=branchX-.22*sin(y*14.+PHASE*.2);float twig=exp(-abs(p.x-twigX)*48.)*smoothstep(.35,.62,y)*(1.-smoothstep(.64,.82,y));float trigger=clamp(max(HIT*.7,max(K*.3,DROP*.42)),0.,1.);float flash=trigger*(.34+.2*SHOCKA+.14*DROP);vec3 base=pal(.1+fbm(p*1.5+FLOW*.08)*.12,vec3(0.,.33,.67))*(.035+.035*LAYER);vec3 bolt=pal(.82,vec3(0.,.33,.67))*(trunk*.72+branch*.32+twig*.18);float halo=exp(-abs(p.x-trunkX)*8.)*.12;return base+bolt*flash+pal(.74,vec3(0.,.33,.67))*halo*flash;}`,
    magic: `vec3 fx(vec2 p,float t){float r=length(p-FLOW*.12),a=atan(p.y-FLOW.y*.12,p.x-FLOW.x*.12);float orbit=.5+.5*sin(a*3.+t*.22+PHASE*.18);float ribbon=exp(-abs(r-(.48+.14*orbit))*(25.+DETAIL*16.));float inner=exp(-abs(r-(.24+.05*sin(a*2.-t*.16)))*34.);vec3 c=pal(.18+orbit*.46+t*.012,vec3(0.,.33,.67))*(ribbon*(.17+.22*LAYER)+inner*.13);for(int i=0;i<12;i++){float fi=float(i);float seed=h1(vec2(fi,7.));float direction=mod(fi,2.)<1.?1.:-1.;float ang=fi*.523599+direction*t*(.18+.07*seed)+PHASE*.08;float rad=.34+.13*sin(ang*3.+PHASE*.2)+.09*SWELL;vec2 pos=vec2(cos(ang),sin(ang))*rad+FLOW*.12;float d=length(p-pos);float mote=exp(-d*d/(.0025+.0015*seed));float tail=exp(-abs(atan(sin(a-ang),cos(a-ang)))*18.)*exp(-abs(r-rad)*24.);float glow=.82+.18*sin(t*.48+seed*6.28);c+=pal(.24+fi*.045+TINT*.06,vec3(0.,.33,.67))*(mote*(.45+.45*EMIT+.2*A)+tail*(.035+.04*SHIM))*glow;}return c;}`,
    particles: `vec3 fx(vec2 p,float t){vec3 c=vec3(0.);for(int i=0;i<3;i++){float fi=float(i);float scale=6.+fi*3.2;vec2 q=vec2(p.x*scale+u.y*(1.1+.35*fi)+FLOW.x*.3+t*.11*(fi+1.),u.y*(5.5+fi*2.2)-t*(.42+.16*fi)*(1.+.35*SWELL));vec2 cell=floor(q),f=fract(q)-.5;float seed=h1(cell+vec2(fi*11.,3.));float active=step(.76-.13*EMIT-.07*DENS,seed);float wobble=.13*sin(t*.3+seed*6.28+fi);f.x+=wobble;float radius=.035+.025*seed+.025*SWELL;float head=exp(-dot(f,f*vec2(1.,.45))/(radius*radius));float trail=exp(-abs(f.x+wobble)*24.)*(1.-smoothstep(.0,.48,f.y+.24));float glint=head*(.55+.45*sin(t*.55+seed*9.));c+=pal(.18+seed*.5+fi*.12,vec3(0.,.33,.67))*active*(glint*(.55+.35*EMIT+.18*A)+trail*(.08+.08*SHIM))*(1.-fi*.2);}return c;}`,
    plasma: `vec3 fx(vec2 p,float t){vec2 q=p+FLOW*.22;float a=sin(q.x*(2.1+.5*CPLX)+sin(q.y*.85+t*.12+PHASE*.1)*.7+t*.16);float b=sin(q.y*2.35+sin(q.x*.72-t*.1)*.62-t*.13);float c=sin((q.x+q.y*.8)*1.55+t*.1+WARP);float field=clamp(.5+.2*a+.2*b+.1*c,0.,1.);float vein=exp(-abs(a-b+c*.35)*(5.+DETAIL*3.));float drift=.5+.5*sin(field*6.28+PHASE*.06+t*.035);return pal(.12+field*.58+drift*.08+TINT*.04,vec3(0.,.33,.67))*(.24+.48*field+.22*vein+.2*SWELL+.14*A)*(.88+.12*LAYER);}`,
    fractal: `vec3 fx(vec2 p,float t){vec2 z=(p+FLOW*.08)*(1.08-.12*LAYER),c=vec2(-.73+.07*cos(t*.12+PHASE*.3)+.035*WARP,.18+.07*sin(t*.15)+.035*CPLX);float iter=0.;float trap=2.;for(int i=0;i<28;i++){z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+c;float r2=dot(z,z);trap=min(trap,abs(length(z)-.72));if(r2>16.)break;iter+=1.;}float shade=iter/28.;float edge=exp(-trap*(18.+DETAIL*12.));float exterior=1.-smoothstep(.58,.96,shade);float filigree=pow(max(0.,fbm(p*4.+vec2(t*.025,PHASE*.04))-.52),2.)*LAYER;return pal(.12+shade*.62+edge*.12+TINT*.04,vec3(0.,.33,.67))*(.12+.55*exterior+.48*edge+.28*filigree)*(1.+.18*A);}`,
    kaleido: `vec3 fx(vec2 p,float t){float r=length(p),a=atan(p.y,p.x);float sectors=6.+2.*floor(CPLX*2.5);a=abs(mod(a+3.1416/sectors,6.2832/sectors)-3.1416/sectors);vec2 q=vec2(cos(a),sin(a))*r;q+=FLOW*.22+vec2(.12*sin(t*.16+PHASE*.1),.1*cos(t*.13));float n=fbm(q*3.2+vec2(t*.025,-t*.018));float petals=.5+.5*cos(a*sectors*2.+r*(7.+3.*MORPH)+n*3.);float rings=.5+.5*cos(r*(17.+4.*CPLX)-t*.16+PHASE*.1);float detail=pow(max(0.,fbm(q*6.+vec2(1.7,4.1))-.52),2.)*DETAIL;return pal(.14+n*.35+petals*.23+rings*.12,vec3(0.,.33,.67))*(.22+.3*petals+.28*rings+.35*detail+.2*A);}`,
    tunnel: `vec3 fx(vec2 p,float t){vec2 q=p-FLOW*.22;float r=length(q)+.035;float a=atan(q.y,q.x);float z=.58/r+PHASE*.12+t*(.38+.16*A+.22*SWELL);float ring=1.-smoothstep(.025,.09,abs(fract(z)-.5));float sectors=10.+2.*floor(CPLX*2.);float spoke=1.-smoothstep(.025,.11,abs(sin(a*sectors+z*.72+SPIN*.35)));float wall=ring*.64+spoke*.34;float vignette=1.-smoothstep(1.25,2.1,r);float center=exp(-r*5.);return pal(.12+fract(z*.13)+TINT*.04,vec3(0.,.33,.67))*wall*vignette*(.4+.35*EMIT+.15*A)+pal(.82,vec3(0.,.33,.67))*center*(.18+.18*K);}`,
    gradient: `vec3 fx(vec2 p,float t){float g=u.x*(.6-.4*MORPH)+u.y*(.4+.4*MORPH)+.15*(1.+2.*WARP)*sin(t*.25+u.y*3.)+.1*fbm(p+t*.05+FLOW)+.2*SWELL*exp(-dot(p,p));return pal(g*.6+t*.03,vec3(.0,.18,.4))*(.75+.25*A)+LAYER*.15*pal(fbm(p*2.-FLOW)+PHASE*.1,vec3(.3,.1,.5));}`,
    glow: `vec3 fx(vec2 p,float t){float r=length((p-FLOW*.25)*vec2(.8+.3*MORPH,1.))/(1.+.6*SWELL);float b=.75+.25*sin(t*1.2+PHASE)+.5*A;vec3 c=mix(vec3(1.,.72,.35),vec3(1.,.35,.2),smoothstep(0.,1.2,r));c=mix(c,vec3(.55,.35,1.),LAYER*.45*smoothstep(.2,1.,r));return c*exp(-r*r*1.6)*b*1.3;}`,
    flow: `vec3 fx(vec2 p,float t){vec2 q=p*(1.35+.35*MORPH)+FLOW*.3;vec2 w=vec2(fbm(q*1.25+vec2(t*.055,2.1)),fbm(q*1.2+vec2(7.3,-t*.045)));vec2 r=q+(w-.5)*(2.2+2.2*TURB)+vec2(.24*sin(q.y*2.+t*.12+SPIN),.22*cos(q.x*1.8-t*.1));float broad=fbm(r*1.4+vec2(t*.035,-t*.025));float bands=sin(r.x*2.6+r.y*1.4+broad*4.+PHASE*.2);float stream=exp(-abs(bands)*(.8+DETAIL*1.4));float eddy=pow(max(0.,fbm(r*2.3+vec2(-t*.04,t*.03))-.48),2.);return pal(.12+broad*.58+stream*.08,vec3(0.,.33,.67))*(.28+.6*broad+.62*stream*(.35+.55*SWELL)+.35*eddy+.2*A);}`,
    lava: `vec3 fx(vec2 p,float t){float heat=0.;for(int i=0;i<6;i++){float fi=float(i);float phase=t*(.12+.025*fi)+fi*2.17+PHASE*(.12+.025*fi);vec2 centre=vec2(.76*ASP*sin(phase)+.12*sin(t*.19+fi*3.),.72*cos(phase*.83+fi));float radius=.24+.06*sin(fi*4.1+MORPH)+.045*SWELL+.055*DROP;vec2 d=p-centre;heat+=radius*radius/(dot(d,d)+.018);}float core=smoothstep(.72,1.55,heat);float seam=exp(-abs(heat-.76)*(5.+DETAIL*4.));float glow=clamp(heat*.22,0.,.5);vec3 molten=pal(.08+clamp(heat*.18,0.,.7)+TINT*.03,vec3(0.,.33,.67));vec3 crust=pal(.05+glow*.24,vec3(0.,.33,.67))*.16;return crust+molten*core*(.72+.32*A)+pal(.76,vec3(0.,.33,.67))*seam*(.08+.2*SHIM+.14*LAYER);}`,
    ink: `vec3 fx(vec2 p,float t){vec2 q=p*(1.08-.18*MORPH)+FLOW*.3;vec2 warp=vec2(fbm(q*1.25+vec2(t*.025,3.1)),fbm(q*1.3+vec2(7.2,-t*.02)));vec2 w=q+(warp-.5)*(.7+1.4*TURB);float pigmentA=fbm(w*1.7+vec2(t*.012,PHASE*.025));float pigmentB=fbm(w*1.7+vec2(5.3,-t*.014));float poolA=smoothstep(.39-.08*SWELL,.68,pigmentA);float poolB=smoothstep(.43,.71,pigmentB);float edgeA=exp(-abs(pigmentA-(.48-.05*SWELL))*(24.+DETAIL*12.));float edgeB=exp(-abs(pigmentB-.54)*(22.+DETAIL*10.));float vein=pow(max(0.,fbm(w*3.4+warp)-.55),2.)*(.35+.5*EMIT);float ink=clamp(poolA*.54+poolB*.42+edgeA*.16+edgeB*.14+vein,0.,1.);return pal(.12+ink*.62+pigmentA*.12+TINT*.04,vec3(0.,.33,.67))*(.16+.62*ink+.2*A)*(.82+.18*LAYER);}`,
    bokeh: `vec3 fx(vec2 p,float t){vec3 c=pal(.16,vec3(0.,.33,.67))*.035;for(int i=0;i<10;i++){float fi=float(i);float seed=h1(vec2(fi,3.));float ax=(h1(vec2(fi,7.))*2.-1.)*ASP*.92;float ay=(h1(vec2(fi,11.))*2.-1.)*.9;vec2 centre=vec2(ax+.17*sin(t*(.11+.03*seed)+fi*1.7)+FLOW.x*.22,ay+.14*sin(t*.09+fi*2.3+PHASE*.15)+FLOW.y*.18);float radius=(.15+.2*seed)*(1.+.38*SWELL+.18*MORPH);float d=length(p-centre);float disc=1.-smoothstep(radius*.72,radius*1.14,d);float halo=exp(-abs(d-radius)*22.)*(.12+.12*LAYER);float breathe=.82+.12*sin(t*.33+fi*1.4)+.06*A;c+=pal(.15+seed*.58+fi*.035,vec3(0.,.33,.67))*(disc*(.22+.2*EMIT+.14*DENS)*breathe+halo);}return c;}`,
    fireflies: `vec3 fx(vec2 p,float t){vec3 c=pal(.11+u.y*.08,vec3(0.,.33,.67))*.035+fbm(p*1.6+FLOW*.1)*.025;vec2 swarm=.34*vec2(ASP*sin(t*.12+PHASE*.12),cos(t*.1+PHASE*.08));for(int i=0;i<16;i++){float fi=float(i);float seed=h1(vec2(fi,5.));float a=fi*2.399964+t*(.12+.04*seed)+PHASE*.08;float ring=.28+.48*h1(vec2(fi,9.))+.12*sin(t*.16+fi);vec2 centre=swarm+ring*vec2(ASP*cos(a),sin(a))+.09*vec2(sin(t*.21+fi*1.7),cos(t*.18+fi*2.1))+FLOW*.16;float d=length(p-centre);float pulse=.74+.18*sin(t*(.42+.12*seed)+fi*1.7)+.08*A;float radius=.055+.025*seed+.018*SWELL;float glow=exp(-d*d/(radius*radius));float aura=exp(-d*d/(radius*radius*8.))*.12;c+=pal(.32+seed*.43+LAYER*.08,vec3(0.,.33,.67))*(glow*pulse*(.35+.42*EMIT+.16*DENS)+aura);}return c;}`,
    rays: `vec3 fx(vec2 p,float t){vec2 fromSun=p-vec2(.05*ASP,-1.34);float radius=length(fromSun);float angle=atan(fromSun.x,fromSun.y);float warp=(fbm(vec2(angle*4.+PHASE,t*.07))-.5)*(.45+.6*TURB);float sectors=17.+2.*floor(CPLX*2.);float beam=pow(max(0.,.5+.5*cos(angle*sectors+warp*2.4+t*.045+FLOW.x*.08)),12.);float haze=.35+.65*fbm(p*1.45+vec2(t*.018,0.));float reach=1.-smoothstep(1.25,2.25,radius);float corona=exp(-radius*3.8);return pal(.18+beam*.32+haze*.16,vec3(0.,.33,.67))*(beam*reach*(.18+.35*SWELL+.2*A)+corona*.3)+pal(.72,vec3(0.,.33,.67))*haze*beam*.12*LAYER;}`,
    rain: `vec3 fx(vec2 p,float t){vec3 c=pal(.68+.08*u.y,vec3(0.,.33,.67))*(.035+.045*LAYER)+pal(.48,vec3(0.,.33,.67))*fbm(p*1.1+FLOW*.1)*.045;for(int i=0;i<3;i++){float fi=float(i);float scale=8.+fi*5.;vec2 q=vec2(p.x*scale+u.y*(1.35+SPIN*.45)+t*.12*(fi+1.),u.y*(3.4+fi*2.4)-t*(1.15+fi*.4)*(1.+.28*SWELL));vec2 cell=floor(q),f=fract(q);float seed=h1(cell+vec2(fi*17.,4.));float lane=1.-smoothstep(.012,.045,abs(f.x-.5-.19*(seed-.5)));float tail=smoothstep(.0,.08,f.y)*(1.-smoothstep(.24+.08*MORPH,.52,f.y));float active=step(.7-.22*EMIT-.12*DENS,seed);c+=pal(.56+fi*.09,vec3(0.,.33,.67))*lane*tail*active*(.14+.12/ (fi+1.)+.13*A);}return c;}`,
    snow: `vec3 fx(vec2 p,float t){vec3 c=pal(.13+u.y*.1,vec3(0.,.33,.67))*(.09+.08*LAYER);for(int i=0;i<3;i++){float fi=float(i);float scale=4.2+fi*3.1;vec2 q=vec2(p.x*scale+FLOW.x*.22+t*(.035+SPIN*.025)*(fi+1.),u.y*(4.8+fi*3.)-t*(.12+fi*.055)*(1.+.12*SWELL)+fi*8.3);vec2 cell=floor(q),f=fract(q)-.5;float seed=h1(cell+vec2(7.,fi*13.));float drift=.12*sin(t*.16+seed*6.28+fi);f.x+=drift;f.y+=.1*cos(t*.13+seed*4.);float radius=(.035+.018*seed)*(1.+.35*SWELL+.2*MORPH);float flake=1.-smoothstep(radius*.5,radius*1.5,length(f));float twinkle=.9+.1*sin(t*.55+seed*9.);c+=pal(.72+fi*.045,vec3(0.,.33,.67))*flake*twinkle*(.34+.2/(fi+1.)+.12*A);}return c;}`,
    sunset: `vec3 fx(vec2 p,float t){float y=u.y;vec3 c=mix(mix(vec3(1.,.45,.15),vec3(1.,.3,.4),MORPH),vec3(.25,.1,.45),smoothstep(.25,.75,y));c=mix(c,vec3(.03,.03,.15),smoothstep(.6,1.,y));vec2 sp=vec2(0.,-.2+.06*sin(t*.05)+.1*sin(PHASE*.2));float d=length(p-sp);c+=vec3(1.,.75,.35)*exp(-d*(3.-1.5*SWELL))*(.9+.3*A);c=mix(c,vec3(1.,.95,.7),smoothstep(.2,.18,d));float cl=fbm(vec2(p.x*1.2+t*.03+FLOW.x,p.y*4.));c=mix(c,vec3(.9,.4,.35)*(.5+.5*y),smoothstep(.5,.8,cl)*smoothstep(.3,.6,y)*.7);if(p.y<-.3){float w=sin(p.y*(60.+80.*SHIM)+t*1.5+3.*(1.+TURB)*fbm(vec2(p.x*3.,t*.2)))*.5+.5;vec3 r=mix(vec3(.05,.03,.15),vec3(1.,.5,.2),exp(-abs(p.x)*2.5)*w*.9);c=mix(r,c,.22);}c+=LAYER*step(.995,h1(floor(p*80.)))*smoothstep(.7,1.,y)*.8;return c;}`,
    synth: `vec3 fx(vec2 p,float t){float horizon=.12+.035*(MORPH-.5);float sky=1.-smoothstep(horizon-.035,horizon+.035,p.y);vec3 c=pal(.18+(p.y+1.)*.18+TINT*.04,vec3(0.,.33,.67))*(.25+.3*sky);vec2 sunPos=vec2(.0,horizon-.34);float d=length(p-sunPos);float disc=1.-smoothstep(.36,.39,d);float stripe=1.-smoothstep(.025,.09,abs(fract((p.y-sunPos.y)*17.+t*.05)-.5));float sun=disc*(.55+.45*stripe);c+=pal(.82,vec3(0.,.33,.67))*sun*(.62+.25*SWELL+.12*A);float lower=smoothstep(horizon+.015,horizon+.12,p.y);float depth=max(.08,p.y-horizon);vec2 grid=vec2(p.x*(.7+.36/depth),1./depth);float gx=1.-smoothstep(.018,.055,abs(fract(grid.x*5.)-.5));float gy=1.-smoothstep(.018,.06,abs(fract(grid.y*.55-t*(.06+.035*SWELL))-.5));c+=pal(.52+depth*.06,vec3(0.,.33,.67))*max(gx,gy)*lower*(.12+.1*LAYER+.09*EMIT);float ridge=fbm(vec2(p.x*1.4+FLOW.x*.2,t*.035));c+=pal(.32+ridge*.22,vec3(0.,.33,.67))*lower*exp(-abs(p.y-(horizon+.22+ridge*.18))*18.)*.24;return c;}`,
    rings: `vec3 fx(vec2 p,float t){float r=length(p-FLOW*.1);vec3 c=pal(.16,vec3(0.,.33,.67))*exp(-r*4.)*(.12+.16*SWELL);for(int i=0;i<4;i++){float fi=float(i);float age=fract(t*(.105+.025*SWELL)+fi*.25+PHASE*.015);float radius=age*(1.65+.35*SWELL);float width=.014+.018*age;float ring=exp(-abs(r-radius)/width)*(1.-age);c+=pal(.18+fi*.16+age*.24,vec3(0.,.33,.67))*ring*(.22+.18*A+.12*LAYER);}float shock=exp(-abs(r-SHOCKR*1.75)*24.)*SHOCKA;return c+pal(.88,vec3(0.,.33,.67))*shock*.3;}`,
    laser: `vec3 fx(vec2 p,float t){vec3 c=pal(.12,vec3(0.,.33,.67))*.025;for(int i=0;i<5;i++){float fi=float(i);float x=(fi-2.)*.36*ASP;vec2 origin=vec2(x,-1.25);float angle=.12*sin(t*(.17+.035*fi)+PHASE*.1+fi)+.08*sin(t*.09+fi*1.7)*(1.+TURB);vec2 dir=normalize(vec2(sin(angle),cos(angle)));vec2 d=p-origin;float along=dot(d,dir);float side=abs(d.x*dir.y-d.y*dir.x);float width=.009+.004*EMIT+.004*SWELL;float beam=exp(-side/(width+.003))*(1.-smoothstep(1.8,2.8,along))*smoothstep(-.2,.05,along);float halo=exp(-side*.18)*beam*.11;float haze=fbm(d*2.2+vec2(t*.025,fi*3.));c+=pal(.18+fi*.12+TINT*.04,vec3(0.,.33,.67))*(beam*(.32+.2*A+.16*EMIT)+halo*(.5+.4*LAYER))*(.78+.22*haze);}return c;}`,
    disco: `vec3 fx(vec2 p,float t){vec3 c=pal(.1,vec3(0.,.33,.67))*.035;for(int i=0;i<3;i++){float fi=float(i);float ang=t*(.11+.04*fi)*(mod(fi,2.)<1.?1.:-1.)+PHASE*.08;mat2 rot=mat2(cos(ang),-sin(ang),sin(ang),cos(ang));vec2 q=rot*(p+FLOW*.12)*(4.1+fi*1.8+MORPH)+fi*5.7;vec2 cell=floor(q),f=fract(q)-.5;float diamond=abs(f.x)+abs(f.y);float tile=1.-smoothstep(.29,.39,diamond);float inset=exp(-abs(diamond-.32)*42.)*.2;float seed=h1(cell+fi*7.);float pulse=.82+.12*sin(t*.42+seed*6.28)+.06*A;vec3 color=pal(seed*.58+fi*.19+TINT*.04,vec3(0.,.33,.67));c+=color*(tile*(.18+.22*EMIT+.16*DENS)*pulse+inset*(.08+.08*LAYER));}return c+pal(.84,vec3(0.,.33,.67))*K*.12;}`,
    hex: `vec3 fx(vec2 p,float t){vec2 q=(p+FLOW*.12)*(3.3+1.4*MORPH);vec2 size=vec2(1.,1.7320508);vec2 a=mod(q,size)-size*.5,b=mod(q-size*.5,size)-size*.5;vec2 cell=dot(a,a)<dot(b,b)?a:b;vec2 id=floor(q-cell);float d=max(abs(cell.x)*.8660254+abs(cell.y)*.5,abs(cell.y));float face=1.-smoothstep(.34,.47,d);float edge=exp(-abs(d-.46)*65.);float seed=h1(id+vec2(3.7,8.1));float pulse=.56+.22*sin(t*.62-length(id)*.18+seed*6.28)+.34*HIT*exp(-abs(length(cell)-SHOCKR*2.4)*2.);vec3 fill=pal(.16+seed*.48+TINT*.04,vec3(0.,.33,.67))*face*clamp(pulse,0.,1.);return fill+pal(.79,vec3(0.,.33,.67))*edge*(.1+.18*LAYER+.12*EMIT);}`,
  };
  const FADE = 0.6; // seconds a shape takes to change from one animation to another
  const VS = 'attribute vec2 a_p,a_u;varying vec2 u;void main(){u=a_u;gl_Position=vec4(a_p.x*2.-1.,1.-a_p.y*2.,0.,1.);}';

  class ProjRenderer {
    constructor(canvas) {
      this.cv = canvas; this.progs = {}; this.geo = new Map(); this.beat = 0; this.lastT = 0; this.clock = {}; this.st = {}; this.paletteId = null; this.paletteTex = null;
      this.ctlA = new Float32Array(12); this.ctlB = new Float32Array(12); this.zero8 = new Float32Array(8); this._eoSrc = null; this._eo = EVO ? EVO.DEFAULTS : null;
      const gl = this.gl = canvas.getContext('webgl', { alpha: false, antialias: true, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
      if (!gl) { this.error = 'This computer did not give Lumen a graphics (WebGL) context, so animations cannot be drawn.'; return; }
      this.buf = gl.createBuffer(); this._setPalette('aurora');
      canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.progs = {}; });
      canvas.addEventListener('webglcontextrestored', () => { const key = this.paletteId || 'aurora'; this.buf = this.gl.createBuffer(); this.paletteTex = null; this.paletteId = null; this.progs = {}; this._setPalette(key); });
    }
    _setPalette(id) {
      const gl = this.gl, key = P.paletteId(id);
      if (!gl || gl.isContextLost() || (key === this.paletteId && this.paletteTex)) return;
      if (!this.paletteTex) this.paletteTex = gl.createTexture();
      if (!this.paletteTex) { this.error = 'Lumen could not create a graphics texture for the selected palette.'; return; }
      gl.bindTexture(gl.TEXTURE_2D, this.paletteTex); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 256, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, P.palettePixels(key, 256)); this.paletteId = key;
    }
    _prog(id) {
      if (this.progs[id]) return this.progs[id];
      const gl = this.gl, mk = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(id + ': ' + gl.getShaderInfoLog(s)); return s; };
      const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, VS)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, HEAD + (FX[id] || FX.gradient) + TAIL));
      gl.bindAttribLocation(p, 0, 'a_p'); gl.bindAttribLocation(p, 1, 'a_u'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(id + ': ' + gl.getProgramInfoLog(p));
      const U = {}; for (const n of ['T', 'H', 'B', 'O', 'A', 'K', 'ASP', 'SHIFT', 'MODE', 'P0', 'P1', 'P2', 'E0', 'E1', 'XF', 'PALETTE']) U[n] = gl.getUniformLocation(p, n);
      return (this.progs[id] = { p, U });
    }
    // triangles for a shape, with texture coordinates running 0..1 across its bounding box
    _geometry(r) {
      const key = JSON.stringify(r.pts); let g = this.geo.get(r.id);
      if (g && g.key === key) return g;
      const [x0, y0, x1, y1] = P.bbox(r.pts), w = Math.max(x1 - x0, 1e-4), h = Math.max(y1 - y0, 1e-4), v = [];
      for (const tri of P.triangulate(r.pts)) for (const i of tri) { const [x, y] = r.pts[i]; v.push(x, y, (x - x0) / w, 1 - (y - y0) / h); }
      g = { key, data: new Float32Array(v), n: v.length / 4, asp: w / h };
      this.geo.set(r.id, g); return g;
    }
    // audio: the feature object from av-features.js (or an older { bass, mid, treble, level, beat } frame), or null.
    // styleK multiplies how strongly shapes react. Each shape's animation turns the features into its own controls
    // (LumenProj.controls) - motion, distortion, particles, shockwaves - not just brightness.
    render(project, tSec, audio, styleK = 1) {
      const gl = this.gl; if (!gl || gl.isContextLost()) return;
      if (project) this._setPalette(project.palette);
      if (!this.paletteTex) return;
      const dt = Math.min(0.1, Math.max(0, tSec - this.lastT)); this.lastT = tSec;
      if (audio && audio.beat) this.beat = 1; else this.beat *= Math.pow(0.02, dt);
      gl.viewport(0, 0, this.cv.width, this.cv.height); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
      if (project && project.flash) { gl.clearColor(1, 1, 1, 1); gl.clear(gl.COLOR_BUFFER_BIT); return; } // projector timing calibration
      if (!project || project.blackout) return;
      const outAsp = this.cv.width / this.cv.height, regions = project.regions;
      if (EVO && this._eoSrc !== (project.evolve || null)) { this._eoSrc = project.evolve || null; this._eo = { ...EVO.normSettings(project.evolve), xf: (project.evolve && project.evolve.xf) || 'auto' }; }
      const eo = this._eo || { xf: 'auto' };
      gl.enable(gl.BLEND); gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      for (let ri = 0; ri < regions.length; ri++) {
        const r = regions[ri];
        if (r.hidden || r.opacity <= 0) continue;
        const g = this._geometry(r); if (!g.n) continue;
        let st = this.st[r.id]; const fresh = !st || !(r.id in this.clock); // clearing the clock restarts a shape (thumbnails rely on it)
        if (fresh) st = this.st[r.id] = { preset: r.preset, from: null, k: 1, a: 0, c: P.newControls(), fromC: null, ev: EVO ? EVO.createEvolver(r.preset, r.id) : null, hue: r.hue, bright: r.bright, speed: r.speed, hueOff: 0, xf: 0, fade: FADE };
        // a new animation develops out of the old one: transition style, colour continuity, carried-over evolution state
        if (st.preset !== r.preset) {
          st.from = st.preset; st.preset = r.preset; st.k = 0; const t2 = st.fromC || P.newControls(); st.fromC = st.c; st.c = t2; t2.speedK = st.fromC.speedK;
          const want = r.xf || eo.xf || 'auto', i = XF_STYLES.indexOf(want);
          st.xf = i >= 0 ? i : st.ev ? Math.floor(st.ev.rnd() * XF_STYLES.length) : 0;
          st.fade = r.fade > 0 ? r.fade : FADE;
          const ho = P.HUES ? P.HUES[st.from] : null, hn = P.HUES ? P.HUES[r.preset] : null; // start the new animation in the old one's colours
          st.hueOff = ho != null && hn != null ? wrapPi(ho + (st.hue * Math.PI) / 180 - (hn + (r.hue * Math.PI) / 180)) * 0.85 : 0;
        }
        if (st.from) { st.k += dt / st.fade; if (st.k >= 1) st.from = null; }
        const k = r.react * styleK, inXf = !!st.from;
        // parameters glide instead of jumping (slower while a transition runs)
        const tau = inXf ? st.fade / 2.5 : 0.12, g1 = 1 - Math.exp(-dt / tau);
        st.hue += wrapPi(((r.hue - st.hue) * Math.PI) / 180) * (180 / Math.PI) * g1; st.bright += (r.bright - st.bright) * g1; st.speed += (r.speed - st.speed) * g1;
        st.hueOff *= Math.exp(-dt / (st.fade * 0.7));
        // the music response rises fast and falls slowly, so shapes swell with the sound instead of flickering
        const a = audio ? Math.min(1, (audio[r.band] || 0) * k) : 0;
        st.a += (a - st.a) * (1 - Math.exp(-dt * (a > st.a ? 22 : 4.5)));
        // continuous evolution (always), music controls (when listening), both scaled by the visual intensity
        if (st.ev) EVO.step(st.ev, r.preset, audio, dt, eo, project.mode === 'auto' ? AUTO_CTX : null);
        const ctl = this._mix(this.ctlA, P.controls(r.preset, audio, dt, st.c, k), st.ev, eo);
        // the animation's own clock: music can speed it up, but it never jumps
        this.clock[r.id] = (fresh ? 0 : this.clock[r.id] || 0) + dt * st.speed * st.c.speedK;
        const mode = r.blend === 'add' ? 1 : r.blend === 'screen' ? 2 : 0;
        gl.bufferData(gl.ARRAY_BUFFER, g.data, gl.DYNAMIC_DRAW);
        gl.enableVertexAttribArray(0); gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
        if (mode === 0) gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); else if (mode === 1) gl.blendFunc(gl.ONE, gl.ONE); else gl.blendFunc(gl.ONE_MINUS_DST_COLOR, gl.ONE);
        const E = st.ev ? st.ev.out : this.zero8;
        if (inXf) { // the outgoing animation dissolves away (per-pixel mask) while the incoming one develops on top
          const old = this._mix(this.ctlB, st.fromC ? P.controls(st.from, audio, dt, st.fromC, k) : ctl, st.ev, eo);
          if (st.xf === 4) { old[0] += 1.6 * st.k; ctl[0] += 1.6 * (1 - st.k); } // morph: both melt through a warp
          this._draw(st.from, r, st, g, outAsp, mode, st.a, audio, k, old, E, st.xf, st.k, 1, 0);
          this._draw(r.preset, r, st, g, outAsp, mode, st.a, audio, k, ctl, E, st.xf, st.k, 2, st.hueOff);
        } else this._draw(r.preset, r, st, g, outAsp, mode, st.a, audio, k, ctl, E, 0, 1, 0, st.hueOff);
      }
      if (this.geo.size > regions.length + 20) for (const id of [...this.geo.keys()]) if (!regions.some((r) => r.id === id)) { this.geo.delete(id); delete this.clock[id]; delete this.st[id]; }
    }
    // music controls + evolution, scaled by the visual intensity, into a reused array (no allocation per frame)
    _mix(dst, ctl, ev, eo) {
      const I = eo && eo.intensity != null ? eo.intensity : 1;
      for (let i = 0; i < 12; i++) dst[i] = ctl[i] * (i === 6 ? 1 : I) + (ev ? ev.add[i] : 0);
      return dst;
    }
    _draw(id, r, st, g, outAsp, mode, a, audio, react, ctl, E, xf, xk, role, hueOff) {
      const gl = this.gl; let pr; try { pr = this._prog(id); } catch (err) { if (!this.error) this.error = err.message; return; }
      gl.useProgram(pr.p);
      gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, this.paletteTex); gl.uniform1i(pr.U.PALETTE, 0);
      gl.uniform1f(pr.U.T, this.clock[r.id]); gl.uniform1f(pr.U.H, (st.hue * Math.PI) / 180 + hueOff); gl.uniform1f(pr.U.B, st.bright); gl.uniform1f(pr.U.O, r.opacity);
      gl.uniform1f(pr.U.A, a); gl.uniform1f(pr.U.K, audio ? this.beat * react : 0); gl.uniform1f(pr.U.ASP, g.asp * outAsp); gl.uniform1f(pr.U.SHIFT, st.hue / 360); gl.uniform1i(pr.U.MODE, mode);
      gl.uniform4f(pr.U.P0, ctl[0], ctl[1], ctl[2], ctl[3]); gl.uniform4f(pr.U.P1, ctl[4], ctl[5], ctl[6], ctl[7]); gl.uniform4f(pr.U.P2, ctl[8], ctl[9], ctl[10], ctl[11]);
      gl.uniform4f(pr.U.E0, E[0], E[1], E[2], E[3]); gl.uniform4f(pr.U.E1, E[4], E[5], E[6], E[7]); gl.uniform4f(pr.U.XF, xf, xk, role, 0);
      gl.drawArrays(gl.TRIANGLES, 0, g.n);
    }
    // what a shape is doing right now (for the live status), or '' when evolution is off/unknown
    describe(id) { const st = this.st[id]; return st && st.ev && EVO ? EVO.describe(st.ev) : ''; }
    evolver(id) { const st = this.st[id]; return st ? st.ev : null; }
  }
  root.ProjRenderer = ProjRenderer; root.PROJ_FX = Object.keys(FX);
})(window);
