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
    galaxy: `vec3 fx(vec2 p,float t){float r=length(p),a=atan(p.y,p.x);float s=mix(sin(a*2.+r*6.-t*.6-PHASE+fbm(p*3.+FLOW*.2)*3.),sin(a*3.+r*(4.+3.*MORPH)-t*.6-PHASE*1.3+fbm(p*2.5-FLOW*.2)*3.),smoothstep(.3,.7,MORPH));float arm=smoothstep(0.,1.,s)*exp(-r*(1.5-.6*SWELL))*(1.+.8*EMIT);vec3 c=mix(vec3(.04,.02,.12),vec3(.5,.3,1.),arm)+vec3(1.,.8,.6)*exp(-r*(5.-2.5*HIT))*(1.+A);vec2 g=floor(p*70.);c+=step(.992-.02*EMIT-.01*DENS,h1(g))*(.5+.5*sin(t*3.+h1(g)*40.));c+=LAYER*.4*vec3(.5,.3,.8)*smoothstep(.55,.8,fbm(p*4.+vec2(PHASE*.3,0.)))*exp(-r*1.2);return c;}`,
    stars: `vec3 fx(vec2 p,float t){vec3 c=vec3(.01,.01,.04);for(int i=1;i<4;i++){float fi=float(i);vec2 q=(p+FLOW*(.15*fi))*(18.*fi)+vec2(t*.02*fi,0.);vec2 g=floor(q),f=fract(q)-.5;float s=h1(g+fi*9.);float tw=.6+.4*sin(t*(1.+s*4.)*(1.+3.*SHIM)+s*30.);c+=step(.93-.09*EMIT-.04*DENS,s)*smoothstep(.22,0.,length(f))*tw*vec3(.8+.2*s,.85,1.)*(1.+A);}c+=LAYER*.5*vec3(.6,.7,1.)*pow(fbm(p*1.5+FLOW*.05+PHASE*.1),3.);return c;}`,
    nebula: `vec3 fx(vec2 p,float t){float n=fbm(p*(1.6+1.2*CPLX)+vec2(t*.05,-t*.03)+FLOW),m=fbm(p*2.4-vec2(t*.04,t*.02)+n*(2.+1.5*MORPH));vec3 c=pal(n*.9+m*.4+TINT*.5,vec3(.6,.3,.0))*m*(1.5+1.2*SWELL);c+=step(.996-.012*EMIT-.006*DENS,h1(floor(p*60.)))*vec3(1.,.9,1.);c+=vec3(.9,.5,1.)*pow(m,4.)*(1.+2.*A);c+=LAYER*pal(m+PHASE*.1,vec3(.2,.5,.8))*pow(fbm(p*3.5-FLOW*.5),2.)*.6;return c*.9;}`,
    aurora: `vec3 fx(vec2 p,float t){vec3 c=vec3(0.);for(int i=0;i<4;i++){float fi=float(i);float crest=.22*sin(p.x*(1.3+.25*fi+MORPH*.3)+t*(.27+.04*fi)+fi*1.7+PHASE*.2);float warp=(fbm(vec2(p.x*(1.4+.2*fi)+FLOW.x*.2,t*.16+fi*4.))-.5)*(.35+.6*TURB);float d=p.y-(-.15+fi*.26+crest+warp);float veil=exp(-d*d*(8.+1.8*fi));float fold=.4+.6*fbm(vec2(p.x*(4.+fi)+fi*5.,t*.24+fi));float edge=clamp((p.y+1.2)*.7,0.,1.);c+=pal(.18+fi*.14+fold*.26+t*.018,vec3(0.,.33,.67))*veil*fold*edge*(.65+.4*EMIT)*(1.+.35*A);}return c;}`,
    warp: `vec3 fx(vec2 p,float t){vec2 pc=p-FLOW*.25;float r=length(pc)+1e-3,a=atan(pc.y,pc.x);float id=floor(a*(28.+20.*EMIT+10.*DENS));float s=h1(vec2(id,1.));float z=fract(s+(t+PHASE*.5)*(.25+s*.6)*(1.+A+1.5*SWELL));float d=abs(r-z*1.8);float st=smoothstep(.06*z+.004,0.,d)*z*smoothstep(.5,.0,abs(fract(a*28.)-.5));return vec3(.7,.85,1.)*st*2.+vec3(.0,.0,.03);}`,
    fire: `vec3 fx(vec2 p,float t){float rise=1.-u.y;vec2 q=vec2(p.x*(1.4-.45*rise)+FLOW.x*.35,u.y*1.65+t*.22+PHASE*.08);float n=fbm(q*(2.+TURB))+ .38*fbm(q*4.1+vec2(2.3,-t*.12));float width=mix(.62,.1,rise)+.12*SWELL;float edge=1.-smoothstep(width,width+.16,abs(p.x)+.18*(n-.5)*(1.+TURB));float crown=1.-smoothstep(.62,1.05,rise-.18*(n-.5));float flame=smoothstep(.22,.62,n+.32*(1.-rise)+.24*WARP)*edge*crown;float tongues=pow(max(0.,sin(p.x*(11.+4.*CPLX)+n*8.-t*.18+PHASE)),5.)*EMIT*.18;flame=clamp(flame+tongues*edge,0.,1.);return pal(.06+flame*.62+rise*.05,vec3(0.,.33,.67))*flame*(.85+.45*A+.25*DROP);}`,
    smoke: `vec3 fx(vec2 p,float t){vec2 q=vec2(p.x*1.05+FLOW.x*.28+.22*sin(u.y*3.2+t*.12+PHASE*.2),u.y*1.7+t*.075-FLOW.y*.2);float low=fbm(q*1.7+vec2(0.,t*.025));vec2 warp=vec2(fbm(q*1.2+vec2(3.1,t*.04)),fbm(q*1.35+vec2(8.4,-t*.035)));float n=fbm(q*2.1+(warp-.5)*(1.1+2.*TURB));float plume=smoothstep(.34-.12*SWELL,.72,n+.18*(low-.5));float body=exp(-abs(p.x+FLOW.x*.15)*(.65+.4*u.y))*(.65+.35*low);float wisps=pow(max(0.,fbm(q*3.3+vec2(1.,-t*.02))-.48),2.)*DETAIL;return pal(.2+n*.5+u.y*.06,vec3(0.,.33,.67))*plume*body*(.5+.5*LAYER+.35*A)+pal(.62,vec3(0.,.33,.67))*wisps*.35;}`,
    clouds: `vec3 fx(vec2 p,float t){vec2 q=vec2(p.x*1.15+t*(.035+.025*WARP)+FLOW.x,p.y*1.35+FLOW.y*.2);float broad=fbm(q*1.35+vec2(t*.018,0.));vec2 warp=vec2(fbm(q*1.1+vec2(2.7,t*.025)),fbm(q*1.1+vec2(7.4,-t*.02)));float n=fbm(q*2.05+(warp-.5)*(1.25+2.*TURB));float cloud=smoothstep(.43-.1*SWELL,.69,n+.2*(broad-.5));float light=clamp(.28+.48*cloud+.18*broad+.16*A,0.,1.);float underside=1.-smoothstep(.46,.76,p.y+.18*(n-.5));return pal(.16+light*.52+TINT*.04,vec3(0.,.33,.67))*light*(.58+.42*LAYER)+pal(.82,vec3(0.,.33,.67))*cloud*underside*.22;}`,
    ocean: `vec3 fx(vec2 p,float t){vec2 q=p*(2.5-.35*MORPH)+FLOW*.22;float a=sin(q.x*1.35+sin(q.y*1.1-t*.22)*.42-t*.3+PHASE*.12);float b=sin(q.y*1.55+sin(q.x*.8+t*.17)*.3+t*.23);float swell=.5+.25*a+.25*b;float crossWave=sin(q.x*3.2+b*1.5+t*.16)*sin(q.y*3.4-a*1.4-t*.13);float caustic=pow(max(0.,crossWave),3.+2.*DETAIL);float glint=pow(max(0.,.5+.5*sin(q.x*5.+q.y*4.-t*.22+2.*a)),10.)*SHIM;vec3 water=pal(.27+swell*.25+TINT*.03,vec3(0.,.33,.67))*(.35+.45*swell+.4*A);return water+pal(.72+caustic*.16,vec3(0.,.33,.67))*caustic*(.35+1.2*SHIM)+pal(.9,vec3(0.,.33,.67))*glint*.22+LAYER*.12*pal(.62+u.y*.15,vec3(0.,.33,.67));}`,
    waves: `vec3 fx(vec2 p,float t){float swell=0.;vec3 c=pal(.2+.18*(.5+.5*sin(p.y*1.4+PHASE*.1)),vec3(0.,.33,.67))*(.14+.12*SWELL);for(int i=0;i<4;i++){float fi=float(i);float phase=p.y*(2.05+fi*.62)+p.x*(.72+fi*.16)+.24*sin(p.x*(1.45+fi*.1)+t*.25+fi+FLOW.x)+t*(.28+fi*.045)+PHASE*.035;float crest=exp(-abs(sin(phase))*(17.+4.*fi+SHIM*9.));float foam=exp(-abs(sin(phase+.12*sin(p.x*2.1-t*.2)))*(30.+DETAIL*12.));c+=pal(.14+fi*.16+phase*.035,vec3(0.,.33,.67))*crest*(.22+.08*fi+.28*SWELL+.18*A);c+=pal(.84,vec3(0.,.33,.67))*foam*(.04+.09*LAYER+.05*SHIM);}return c;}`,
    portal: `vec3 fx(vec2 p,float t){vec2 pc=p-FLOW*.15;float r=length(pc),a=atan(pc.y,pc.x);float sw=fbm(vec2(a*(2.5+2.*CPLX+1.5*MORPH)+r*5.-t*1.6*(1.+TURB),r*3.-t*.4));float ring=exp(-pow((r-.72-.14*SWELL-.08*sin(PHASE)-.05*sin(a*5.+t*2.))*7.,2.));float core=smoothstep(.75,0.,r)*sw;vec3 c=vec3(.1,.5,1.)*ring*(1.6+A*2.)+vec3(.5,.1,.9)*core*(1.3+EMIT)+vec3(1.)*pow(sw,5.)*smoothstep(.7,.1,r);c+=LAYER*vec3(.8,.3,1.)*exp(-pow((r-.45-.1*sin(a*3.-PHASE*2.))*9.,2.))*1.2;return c;}`,
    energy: `vec3 fx(vec2 p,float t){vec2 q=abs(u*2.-1.);float d=1.-max(q.x,q.y);float n=fbm(vec2((u.x+u.y)*9.+t*1.4+PHASE,(u.x-u.y)*9.-t*1.1));float e=smoothstep(.22+.1*A+.14*SWELL,0.,abs(d-.09-.08*MORPH-n*.08*(1.+TURB)))+.35*smoothstep(.3,0.,d)*n;float arc=smoothstep(.03,0.,abs(d-.05-.1*fbm(vec2(atan(p.y,p.x)*4.,t*3.))));return LAYER*vec3(.7,.3,1.)*smoothstep(.04,0.,abs(d-.28-.06*n))+vec3(.2,.7,1.)*e*1.6+vec3(.8,.95,1.)*arc*(1.+EMIT+2.*SHIM);}`,
    lightning: `vec3 fx(vec2 p,float t){float seg=floor(t*(5.-2.*MORPH));float life=fract(t*(5.-2.*MORPH));vec3 c=vec3(.02,.02,.07)+.06*fbm(p*2.+t*.1)+LAYER*.15*vec3(.5,.5,.9)*fbm(p*1.5+PHASE)*(1.-life);for(int i=0;i<2;i++){float fi=float(i);float sx=(h1(vec2(seg,fi))-.5)*1.4+.3*sin(FLOW.x);float x=sx+(fbm(vec2(u.y*5.*(1.+TURB)+seg*3.,fi*7.))-.5)*.9*u.y*(1.+SWELL);float on=step(.45-.3*A-.4*EMIT-.2*DENS,h1(vec2(seg+9.,fi)));float b=smoothstep(.035,0.,abs(p.x-x))*on*(1.-life);c+=vec3(.75,.8,1.)*b*2.5+vec3(.3,.35,.6)*on*(1.-life)*.25;}return c;}`,
    magic: `vec3 fx(vec2 p,float t){float r=length(p),a=atan(p.y,p.x);vec3 c=vec3(.25,.05,.4)*exp(-r*1.5);for(int i=0;i<24;i++){float fi=float(i);float ang=fi*2.4+(t+PHASE)*(.3+h1(vec2(fi,1.))*.5);float rad=(.15+.75*fract(h1(vec2(fi,2.))+t*.07))*(1.+.35*SWELL+.25*MORPH);vec2 s=vec2(cos(ang),sin(ang))*rad*(1.+LAYER*.3*sin(fi+PHASE))+FLOW*.2;float d=length(p-s);c+=pal(fi*.07+t*.1,vec3(.0,.33,.67))*(.004+.003*A+.006*EMIT+.003*DENS)/(d*d+.0015)*(.6+.4*sin(t*4.+fi));}return c;}`,
    particles: `vec3 fx(vec2 p,float t){vec3 c=vec3(0.);for(int i=0;i<3;i++){float fi=float(i)+1.;vec2 q=vec2((p.x+FLOW.x*.2)*6.*fi+TURB*sin(u.y*4.+t+fi),u.y*6.*fi-t*(.5+.25*fi)*(1.+A+1.5*SWELL));vec2 g=floor(q),f=fract(q)-.5;float s=h1(g+fi*3.);f.x+=.3*sin(t+s*20.);c+=step(.6-.3*EMIT-.15*DENS,s)*smoothstep(.16,0.,length(f*vec2(1.,1.+2.*MORPH)))*pal(s+fi*.2+LAYER*.3*fi,vec3(.1,.4,.7))/fi*1.6;}return c;}`,
    plasma: `vec3 fx(vec2 p,float t){float cf=1.+CPLX*1.2;vec2 pp=p+FLOW*.3;float v=sin(pp.x*4.*cf+t)+sin(pp.y*5.*cf-t*1.2)+sin((pp.x+pp.y)*3.+t*.7)+sin(length(pp)*8.-t*2.*(1.+A))*(1.+WARP)+MORPH*sin(pp.x*pp.y*6.+PHASE);return mix(pal(v*.18+t*.05+TINT*.4,vec3(.0,.33,.67)),pal(v*.3+PHASE*.1,vec3(.3,.2,.2)),LAYER*.5)*(1.-.55*SWELL+.9*SWELL*smoothstep(-.5,1.5,v));}`,
    fractal: `vec3 fx(vec2 p,float t){vec2 z=(p+FLOW*.1)*(1.25-.25*LAYER),c=vec2(-.78+.08*cos(t*.2+PHASE*.5)+.05*WARP+.06*(MORPH-.5),.16+.1*sin(t*.27)+.04*CPLX);float m=0.;for(int i=0;i<40;i++){z=vec2(z.x*z.x-z.y*z.y,2.*z.x*z.y)+c;if(dot(z,z)>16.)break;m+=1.;}float s=m/40.;return pal(s*2.+t*.05+TINT*.6,vec3(.0,.2,.45))*smoothstep(0.,.08,s)*(1.+A*.6);}`,
    kaleido: `vec3 fx(vec2 p,float t){float r=length(p),a=atan(p.y,p.x);float n=6.+2.*floor(CPLX*2.5);a=abs(mod(a,6.2832/n)-3.1416/n);vec2 q=vec2(cos(a),sin(a))*r;q+=vec2(t*.12,sin(t*.2)*.3)*(1.+SWELL)+FLOW*.5+vec2(0.,MORPH);float v=fbm(q*4.)+LAYER*.4*sin(length(q)*20.-PHASE*3.)+.5*sin(q.x*10.+t)*sin(q.y*10.-t);return pal(v*.8+r*.4-t*.08,vec3(.0,.33,.67))*(.6+.6*smoothstep(.2,.9,v)+A*.4);}`,
    tunnel: `vec3 fx(vec2 p,float t){vec2 pc=p-FLOW*.3;float r=mix(length(pc),max(abs(pc.x),abs(pc.y)),smoothstep(.2,.8,MORPH))+1e-3,a=atan(pc.y,pc.x)/3.1416;float z=.4/r+PHASE*.3+t*.9*(1.+A*.5+SWELL);float tw=SPIN*.6/r;float sq=step(.5,fract(z*2.))*step(.5,fract(a*(6.+4.*floor(CPLX*2.))+z*.25+tw))+step(fract(z*2.),.5)*step(fract(a*(6.+4.*floor(CPLX*2.))+z*.25+tw),.5);vec3 c=mix(pal(z*.1+LAYER*.3*sin(a*3.),vec3(.55,.75,.95)),vec3(.03),sq);return c*smoothstep(0.,.5,r)*1.2;}`,
    gradient: `vec3 fx(vec2 p,float t){float g=u.x*(.6-.4*MORPH)+u.y*(.4+.4*MORPH)+.15*(1.+2.*WARP)*sin(t*.25+u.y*3.)+.1*fbm(p+t*.05+FLOW)+.2*SWELL*exp(-dot(p,p));return pal(g*.6+t*.03,vec3(.0,.18,.4))*(.75+.25*A)+LAYER*.15*pal(fbm(p*2.-FLOW)+PHASE*.1,vec3(.3,.1,.5));}`,
    glow: `vec3 fx(vec2 p,float t){float r=length((p-FLOW*.25)*vec2(.8+.3*MORPH,1.))/(1.+.6*SWELL);float b=.75+.25*sin(t*1.2+PHASE)+.5*A;vec3 c=mix(vec3(1.,.72,.35),vec3(1.,.35,.2),smoothstep(0.,1.2,r));c=mix(c,vec3(.55,.35,1.),LAYER*.45*smoothstep(.2,1.,r));return c*exp(-r*r*1.6)*b*1.3;}`,
    flow: `vec3 fx(vec2 p,float t){vec2 q=p*(1.35+.35*MORPH)+FLOW*.3;vec2 w=vec2(fbm(q*1.25+vec2(t*.055,2.1)),fbm(q*1.2+vec2(7.3,-t*.045)));vec2 r=q+(w-.5)*(2.2+2.2*TURB)+vec2(.24*sin(q.y*2.+t*.12+SPIN),.22*cos(q.x*1.8-t*.1));float broad=fbm(r*1.4+vec2(t*.035,-t*.025));float bands=sin(r.x*2.6+r.y*1.4+broad*4.+PHASE*.2);float stream=exp(-abs(bands)*(.8+DETAIL*1.4));float eddy=pow(max(0.,fbm(r*2.3+vec2(-t*.04,t*.03))-.48),2.);return pal(.12+broad*.58+stream*.08,vec3(0.,.33,.67))*(.28+.6*broad+.62*stream*(.35+.55*SWELL)+.35*eddy+.2*A);}`,
    lava: `vec3 fx(vec2 p,float t){float heat=0.;for(int i=0;i<6;i++){float fi=float(i);float phase=t*(.12+.025*fi)+fi*2.17+PHASE*(.12+.025*fi);vec2 centre=vec2(.76*ASP*sin(phase)+.12*sin(t*.19+fi*3.),.72*cos(phase*.83+fi));float radius=.24+.06*sin(fi*4.1+MORPH)+.045*SWELL+.055*DROP;vec2 d=p-centre;heat+=radius*radius/(dot(d,d)+.018);}float core=smoothstep(.72,1.55,heat);float seam=exp(-abs(heat-.76)*(5.+DETAIL*4.));float glow=clamp(heat*.22,0.,.5);vec3 molten=pal(.08+clamp(heat*.18,0.,.7)+TINT*.03,vec3(0.,.33,.67));vec3 crust=pal(.05+glow*.24,vec3(0.,.33,.67))*.16;return crust+molten*core*(.72+.32*A)+pal(.76,vec3(0.,.33,.67))*seam*(.08+.2*SHIM+.14*LAYER);}`,
    ink: `vec3 fx(vec2 p,float t){vec2 q=p*(1.1-.3*MORPH)+FLOW*.6;for(int i=1;i<5;i++){float fi=float(i);q+=vec2(sin(q.y*1.7*fi+t*.25+fi),cos(q.x*1.5*fi-t*.2+fi*1.7))*.42*(1.+1.2*TURB)/fi;}float a=fbm(q*1.5+t*.03),b=fbm(q*1.5+7.3-t*.02);vec3 c=vec3(.01,.02,.06);c=mix(c,vec3(.9,.1,.5),smoothstep(.45-.2*SWELL-.1*sin(PHASE*.4),.8,a));c=mix(c,vec3(.1,.5,1.),smoothstep(.5,.85,b)*.85);c+=vec3(1.,.8,.5)*pow(a*b*2.,3.)*(.6+1.5*A);c+=step(.985-.03*EMIT-.02*DENS-.015*DETAIL,h1(floor(p*50.+t*.5)))*vec3(1.,.85,.6)*.8;c=mix(c,vec3(.95,.75,.1),LAYER*smoothstep(.55,.9,fbm(q*2.3-PHASE*.05))*.8);return c;}`,
    bokeh: `vec3 fx(vec2 p,float t){vec3 c=vec3(.02,.015,.05);for(int i=0;i<18;i++){float fi=float(i);float s=h1(vec2(fi,3.));vec2 o=vec2((h1(vec2(fi,7.))*2.-1.)*ASP+.15*sin(t*.2+fi)+FLOW.x*.3*(.5+s),fract(h1(vec2(fi,11.))+t*(.012+.02*s)*(1.+2.*TURB)+FLOW.y*.05*s)*2.6-1.3);float r=(.1+.16*s)*(1.+.5*SWELL+.4*MORPH*s);float d=length(p-o);float disc=smoothstep(r,r*.82,d)*(.55+.45*smoothstep(r*.6,r,d));c+=pal(s+fi*.11+LAYER*.25,vec3(.0,.25,.55))*disc*(.42+.2*sin(t*.7+fi*2.)+.4*A+.5*EMIT+.3*DENS);}return c;}`,
    fireflies: `vec3 fx(vec2 p,float t){vec3 c=mix(vec3(.0,.02,.04),vec3(.02,.08,.06),u.y)+.03*fbm(p*3.);for(int i=0;i<22;i++){float fi=float(i);float s=h1(vec2(fi,5.));vec2 o=vec2(sin(t*(.13+.2*s)+fi*1.7)*ASP*.9,sin(t*(.11+.17*h1(vec2(fi,9.)))+fi*2.9)*.9)+.06*vec2(sin(t*1.3+fi),cos(t*1.7+fi*2.))+FLOW*.25;o=mix(o,.7*vec2(sin(t*.5+PHASE)*ASP,cos(t*.37+PHASE*.7))+.25*vec2(cos(fi*2.4),sin(fi*2.4)),clamp(.55*SWELL+.6*smoothstep(.5,1.,MORPH),0.,.9));float bl=max(pow(.5+.5*sin(t*(.8+s+DENS*.5)+fi*4.),3.)*(1.+EMIT),HIT);float d=length(p-o);c+=mix(vec3(.75,1.,.3),vec3(.3,.8,1.),LAYER*step(.5,s))*(.0014/(d*d+.0007))*(bl+.6*A);}return c;}`,
    rays: `vec3 fx(vec2 p,float t){vec2 fromSun=p-vec2(.05*ASP,-1.34);float radius=length(fromSun);float angle=atan(fromSun.x,fromSun.y);float warp=(fbm(vec2(angle*4.+PHASE,t*.07))-.5)*(.45+.6*TURB);float sectors=17.+2.*floor(CPLX*2.);float beam=pow(max(0.,.5+.5*cos(angle*sectors+warp*2.4+t*.045+FLOW.x*.08)),12.);float haze=.35+.65*fbm(p*1.45+vec2(t*.018,0.));float reach=1.-smoothstep(1.25,2.25,radius);float corona=exp(-radius*3.8);return pal(.18+beam*.32+haze*.16,vec3(0.,.33,.67))*(beam*reach*(.18+.35*SWELL+.2*A)+corona*.3)+pal(.72,vec3(0.,.33,.67))*haze*beam*.12*LAYER;}`,
    rain: `vec3 fx(vec2 p,float t){vec3 c=pal(.68+.08*u.y,vec3(0.,.33,.67))*(.035+.045*LAYER)+pal(.48,vec3(0.,.33,.67))*fbm(p*1.1+FLOW*.1)*.045;for(int i=0;i<3;i++){float fi=float(i);float scale=8.+fi*5.;vec2 q=vec2(p.x*scale+u.y*(1.35+SPIN*.45)+t*.12*(fi+1.),u.y*(3.4+fi*2.4)-t*(1.15+fi*.4)*(1.+.28*SWELL));vec2 cell=floor(q),f=fract(q);float seed=h1(cell+vec2(fi*17.,4.));float lane=1.-smoothstep(.012,.045,abs(f.x-.5-.19*(seed-.5)));float tail=smoothstep(.0,.08,f.y)*(1.-smoothstep(.24+.08*MORPH,.52,f.y));float active=step(.7-.22*EMIT-.12*DENS,seed);c+=pal(.56+fi*.09,vec3(0.,.33,.67))*lane*tail*active*(.14+.12/ (fi+1.)+.13*A);}return c;}`,
    snow: `vec3 fx(vec2 p,float t){vec3 c=pal(.13+u.y*.1,vec3(0.,.33,.67))*(.09+.08*LAYER);for(int i=0;i<3;i++){float fi=float(i);float scale=4.2+fi*3.1;vec2 q=vec2(p.x*scale+FLOW.x*.22+t*(.035+SPIN*.025)*(fi+1.),u.y*(4.8+fi*3.)-t*(.12+fi*.055)*(1.+.12*SWELL)+fi*8.3);vec2 cell=floor(q),f=fract(q)-.5;float seed=h1(cell+vec2(7.,fi*13.));float drift=.12*sin(t*.16+seed*6.28+fi);f.x+=drift;f.y+=.1*cos(t*.13+seed*4.);float radius=(.035+.018*seed)*(1.+.35*SWELL+.2*MORPH);float flake=1.-smoothstep(radius*.5,radius*1.5,length(f));float twinkle=.9+.1*sin(t*.55+seed*9.);c+=pal(.72+fi*.045,vec3(0.,.33,.67))*flake*twinkle*(.34+.2/(fi+1.)+.12*A);}return c;}`,
    sunset: `vec3 fx(vec2 p,float t){float y=u.y;vec3 c=mix(mix(vec3(1.,.45,.15),vec3(1.,.3,.4),MORPH),vec3(.25,.1,.45),smoothstep(.25,.75,y));c=mix(c,vec3(.03,.03,.15),smoothstep(.6,1.,y));vec2 sp=vec2(0.,-.2+.06*sin(t*.05)+.1*sin(PHASE*.2));float d=length(p-sp);c+=vec3(1.,.75,.35)*exp(-d*(3.-1.5*SWELL))*(.9+.3*A);c=mix(c,vec3(1.,.95,.7),smoothstep(.2,.18,d));float cl=fbm(vec2(p.x*1.2+t*.03+FLOW.x,p.y*4.));c=mix(c,vec3(.9,.4,.35)*(.5+.5*y),smoothstep(.5,.8,cl)*smoothstep(.3,.6,y)*.7);if(p.y<-.3){float w=sin(p.y*(60.+80.*SHIM)+t*1.5+3.*(1.+TURB)*fbm(vec2(p.x*3.,t*.2)))*.5+.5;vec3 r=mix(vec3(.05,.03,.15),vec3(1.,.5,.2),exp(-abs(p.x)*2.5)*w*.9);c=mix(r,c,.22);}c+=LAYER*step(.995,h1(floor(p*80.)))*smoothstep(.7,1.,y)*.8;return c;}`,
    synth: `vec3 fx(vec2 p,float t){float hz=.05+.1*(MORPH-.5);vec3 c;if(p.y>hz){c=mix(vec3(.9,.15,.5),vec3(.05,.0,.2),smoothstep(hz,1.,p.y));float d=length(p-vec2(0.,hz+.32));float sun=smoothstep(.36,.35,d);float cut=min(1.,step(.5,fract((p.y-hz)*(14.+10.*CPLX)-t*.2))+step(hz+.32,p.y));c=mix(c,mix(vec3(1.,.2,.5),vec3(1.,.9,.2),(p.y-hz)/.68),sun*cut);vec2 g=floor(p*40.);c+=step(.985-.02*EMIT-.01*DENS,h1(g))*smoothstep(.3,.9,p.y)*.8;}else{float dep=hz-p.y;float z=.35/(dep+.02);float x=p.x*z;float gx=smoothstep(.05,0.,abs(fract(x*1.5)-.5))*smoothstep(.0,.12,dep);float gy=smoothstep(.1,0.,abs(fract(z*1.2+(t+PHASE)*(1.+A+SWELL))-.5))*smoothstep(.0,.08,dep);c=vec3(.06,.0,.14)+mix(vec3(1.,.2,.8),vec3(.2,.9,1.),LAYER)*max(gx,gy)*(.4+.6*smoothstep(0.,.6,dep));}return c;}`,
    rings: `vec3 fx(vec2 p,float t){float r=length(p-FLOW*.4);float T2=t+PHASE*.5;vec3 c=vec3(.02,.01,.05);for(int i=0;i<5;i++){float fi=float(i);float ph=fract(T2*.22+fi*.2);vec2 cc=.35*LAYER*vec2(h1(vec2(fi,floor(T2*.22+fi*.2)))-.5,h1(vec2(fi+3.,floor(T2*.22+fi*.2)))-.5);vec2 dq=p-FLOW*.4-cc;float rr=mix(length(dq),max(abs(dq.x),abs(dq.y))*1.15,smoothstep(.3,.8,MORPH));float rad=ph*(1.9+.6*SWELL);float w=.02+.05*ph;float ring=smoothstep(w,0.,abs(rr-rad))*(1.-ph);c+=pal(fi*.17+t*.04+TINT*.5,vec3(.0,.33,.67))*ring*(1.1+1.5*A+1.5*DROP);float r2=fract(t*.9+fi*.37)*1.2;c+=pal(fi*.3+.5,vec3(.0,.33,.67))*smoothstep(.012,0.,abs(rr-r2))*EMIT*.8;}c+=pal(t*.04,vec3(.0,.33,.67))*exp(-r*7.)*(.5+2.*K+A);return c;}`,
    laser: `vec3 fx(vec2 p,float t){vec3 c=vec3(.01,.0,.03);vec2 o=vec2(.4*sin(FLOW.x*.5)*ASP,-1.05);for(int i=0;i<8;i++){float fi=float(i);float ang=sin((t+PHASE)*(.35+.11*fi)*(1.+TURB)+fi*1.9)*(1.15+.3*SWELL-.5*MORPH);vec2 d=vec2(sin(ang),cos(ang));vec2 q=p-o;float along=dot(q,d);float dist=abs(q.x*d.y-q.y*d.x);float beam=(.009+.005*A+.01*EMIT)/(dist+.005)*step(0.,along)*(fi<4.+4.*EMIT+4.*HIT?1.:.25);float fog=.6+(.6+.6*LAYER)*fbm(q*3.+vec2(t*.2,fi));c+=pal(fi*.125+t*.03,vec3(.0,.33,.67))*beam*fog*.5;}return c;}`,
    disco: `vec3 fx(vec2 p,float t){vec3 c=vec3(.02,.01,.04);for(int i=0;i<3;i++){float fi=float(i);float a=(t+PHASE)*(.25+.1*fi)*(1.-2.*mod(fi,2.))*(1.+1.5*abs(SPIN))+fi*2.;mat2 m=mat2(cos(a),-sin(a),sin(a),cos(a));vec2 q=m*(p+FLOW*.2)*(3.5+fi*1.5+2.*MORPH)+fi*7.;vec2 g=floor(q),f=fract(q)-.5;float s=h1(g+fi*5.);float tw=.5+.5*sin(t*(1.5+3.*s)+s*40.);c+=step(.45-.15*DENS,s)*smoothstep(.34,.12,length(f))*pal(s*3.+t*.05+LAYER*fi*.3,vec3(.0,.33,.67))*tw*(.55+.9*A+.8*EMIT)/(1.+fi*.4);}return c+vec3(.9,.9,1.)*K*.15;}`,
    hex: `vec3 fx(vec2 p,float t){vec2 q=(p+FLOW*.3)*(4.+2.*MORPH);vec2 s=vec2(1.,1.7320508);vec2 a=mod(q,s)-s*.5,b=mod(q-s*.5,s)-s*.5;vec2 g=dot(a,a)<dot(b,b)?a:b;vec2 id=q-g;float d=max(abs(g.x),dot(abs(g),s*.5));float n=h1(floor(id*10.+.5));float w=.5+.5*sin(t*1.2+PHASE-length(id)*(.9-.4*SWELL)+n*2.);w=max(w,HIT*exp(-abs(length(id)-SHOCKR*9.)*.8));vec3 c=pal(length(id)*.06-t*.05+n*.1+TINT*.5,vec3(.0,.33,.67))*pow(w,3.)*(.6+A)*smoothstep(.5,.46,d);c+=vec3(.5,.8,1.)*smoothstep(.46,.5,d)*(.12+.35*LAYER);return c;}`,
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
