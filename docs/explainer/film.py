"""CoWrite / The thread — a 72-second, 60 fps vector motion film.

python film.py --stills
python film.py --draft             # quick 960x540 / 24 fps proof
python film.py                     # final 1920x1080 / 60 fps
python film.py --reduced-motion    # opacity-only accessible edit

Requires Pillow, numpy, skia-python, ffmpeg. No network at render time.
All graphics, music, effects and camera animation are generated from this file.
"""
from pathlib import Path
from functools import lru_cache
from contextlib import contextmanager
import argparse
import json
import math
import subprocess
import sys
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT / '.runtime'))
import skia

OUT = ROOT / 'film'
OUT.mkdir(exist_ok=True)
W,H,DURATION = 1920,1080,72
FPS=60
REDUCED=False
BLUE='#2d4ff5'
INK='#151921'
PAPER='#f8f8f5'
MUTED='#69717e'
SOFT='#e8ecff'
LINE='#e3e6ed'
WHITE='#ffffff'
NAVY='#111a3d'
GREEN='#21844c'
PURPLE='#8657a7'
EASE=(.2,.7,.2,1.)       # existing CoWrite --ease-out
MOVE=(.77,0.,.175,1.)    # animate skill: on-screen movement


def clamp(x): return max(0.,min(1.,x))
def lerp(a,b,t): return a+(b-a)*t
def bezier(t,curve=EASE):
    t=clamp(t)
    if t==0 or t==1: return t
    x1,y1,x2,y2=curve;lo,hi=0.,1.
    for _ in range(12):
        u=(lo+hi)/2
        x=3*(1-u)**2*u*x1+3*(1-u)*u*u*x2+u**3
        if x<t: lo=u
        else: hi=u
    return 3*(1-u)**2*u*y1+3*(1-u)*u*u*y2+u**3
def E(t,a,d=.7): return bezier((t-a)/d)
def M(t,a,d=1.): return bezier((t-a)/d,MOVE)
def show(t,a,d=.6,end=None):
    v=E(t,a,.2 if REDUCED else d)
    return v*(1-E(t,end,.3)) if end is not None else v
def key(t,points,curve=MOVE):
    if t<=points[0][0]: return points[0][1]
    for (a,x),(b,y) in zip(points,points[1:]):
        if a<=t<=b:return lerp(x,y,bezier((t-a)/(b-a),curve))
    return points[-1][1]


def color(hex,alpha=1):
    r,g,b=bytes.fromhex(hex.lstrip('#'))
    return skia.ColorSetARGB(round(255*clamp(alpha)),r,g,b)
def paint(col,alpha=1,stroke=0):
    p=skia.Paint(AntiAlias=True,Color=color(col,alpha))
    if stroke:
        p.setStyle(skia.Paint.kStroke_Style);p.setStrokeWidth(stroke)
        p.setStrokeCap(skia.Paint.kRound_Cap);p.setStrokeJoin(skia.Paint.kRound_Join)
    return p
def rr(c,x,y,w,h,r=18,col=WHITE,alpha=1,stroke=0):
    c.drawRoundRect(skia.Rect.MakeXYWH(x,y,w,h),r,r,paint(col,alpha,stroke))
def ln(c,x1,y1,x2,y2,col=LINE,width=2,alpha=1):
    c.drawLine(x1,y1,x2,y2,paint(col,alpha,width))
def dot(c,x,y,r=6,col=BLUE,alpha=1): c.drawCircle(x,y,r,paint(col,alpha))


@contextmanager
def group(c,x=0,y=0,scale=1,angle=0,alpha=1):
    if alpha<.999:
        p=skia.Paint();p.setAlphaf(clamp(alpha));c.saveLayer(None,p)
    else:c.save()
    c.translate(x,y);c.scale(scale,scale)
    if angle:c.rotate(angle)
    yield
    c.restore()


@lru_cache(None)
def font(size,weight=600,serif=False):
    f=ImageFont.truetype(str(ROOT/'assets'/('InstrumentSerif-Italic.ttf' if serif else 'Manrope.ttf')),round(size*2))
    if not serif:f.set_variation_by_axes([weight])
    return f


@lru_cache(maxsize=1500)
def text_image(text,size,col=INK,weight=600,serif=False):
    f=font(size,weight,serif)
    b=f.getbbox(text)
    w=math.ceil(max(f.getlength(text),b[2])-min(0,b[0]))+8
    h=b[3]-b[1]+8
    im=Image.new('RGBA',(max(1,w),max(1,h)))
    ImageDraw.Draw(im).text((4-min(0,b[0]),4-b[1]),text,font=f,fill=col)
    # Match Skia's native Windows surface format once, when the glyph is cached.
    # Leaving textures unpremultiplied forces an expensive per-pixel conversion
    # on every frame, without improving the image.
    arr=np.array(im)
    arr[:,:,:3]=((arr[:,:,:3].astype(np.uint16)*arr[:,:,3:4]+127)//255).astype(np.uint8)
    arr=arr[:,:,[2,1,0,3]].copy()
    return skia.Image.fromarray(arr,colorType=skia.ColorType.kBGRA_8888_ColorType,alphaType=skia.AlphaType.kPremul_AlphaType)


def measure(text,size,weight=600,serif=False):
    im=text_image(text,size,INK,weight,serif);return im.width()/2,im.height()/2


def text(c,s,x,y,size=32,col=INK,weight=600,alpha=1,align='left',serif=False):
    if alpha<=.001:return
    im=text_image(s,size,col,weight,serif);w,h=im.width()/2,im.height()/2
    if align=='center':x-=w/2
    if align=='right':x-=w
    p=skia.Paint();p.setAlphaf(clamp(alpha))
    c.drawImageRect(im,skia.Rect.MakeXYWH(x,y,w,h),skia.SamplingOptions(skia.FilterMode.kLinear),p)
    return w,h


def reveal(c,s,x,y,size,t,at=0,col=INK,weight=750,align='left',serif=False):
    p=E(t,at,.75)
    if p<=0:return
    w,h=measure(s,size,weight,serif)
    left=x-w/2 if align=='center' else x-w if align=='right' else x
    c.save();c.clipRect(skia.Rect.MakeXYWH(left-4,y-3,w+8,h+8))
    text(c,s,x,y+(0 if REDUCED else h*(1-p)),size,col,weight,p,align,serif)
    c.restore()


def typing(c,s,x,y,size,t,a,d,col=INK,weight=600):
    count=round(len(s)*clamp((t-a)/d))
    if REDUCED:count=len(s) if t>=a else 0
    sub=s[:count]
    if sub:text(c,sub,x,y,size,col,weight)
    return measure(sub,size,weight)[0] if sub else 0


@lru_cache(None)
def shell(w,h,r=22,col=WHITE):
    pad=60;s=skia.Surface(w+pad*2,h+pad*2);c=s.getCanvas();c.clear(skia.ColorTRANSPARENT)
    p=paint(col);p.setImageFilter(skia.ImageFilters.DropShadow(0,15,20,20,color('#1a2850',.13)))
    c.drawRoundRect(skia.Rect.MakeXYWH(pad,pad,w,h),r,r,p)
    return s.makeImageSnapshot()


def panel(c,x,y,w,h,col=WHITE,r=22,border=True,shadow=True):
    if shadow:c.drawImage(shell(round(w),round(h),r,col),x-60,y-60)
    else:rr(c,x,y,w,h,r,col)
    if border:rr(c,x,y,w,h,r,LINE,1,1)


def pill(c,s,x,y,col=BLUE,bg=SOFT,size=22,pad=17):
    w,h=measure(s,size,650);rr(c,x,y,w+pad*2,h+23,12,bg)
    text(c,s,x+pad,y+10,size,col,650)
    return w+pad*2,h+23


def avatar(c,x,y,name,col=BLUE,r=24):
    dot(c,x,y,r+3,WHITE);dot(c,x,y,r,col)
    text(c,name,x,y-r*.48,r*.9,WHITE,750,align='center')


def check(c,x,y,size=26,col=GREEN,p=1):
    dot(c,x+size/2,y+size/2,size/2,col)
    path=skia.Path();path.moveTo(x+size*.25,y+size*.51);path.lineTo(x+size*.44,y+size*.68);path.lineTo(x+size*.77,y+size*.32)
    draw_path(c,path,p,WHITE,max(2,size*.085))


def sparkle(c,x,y,r,col=BLUE,angle=0):
    with group(c,x,y,angle=angle):
        p=skia.Path();p.moveTo(0,-r)
        p.cubicTo(r*.19,-r*.19,r*.19,-r*.19,r,0)
        p.cubicTo(r*.19,r*.19,r*.19,r*.19,0,r)
        p.cubicTo(-r*.19,r*.19,-r*.19,r*.19,-r,0)
        p.cubicTo(-r*.19,-r*.19,-r*.19,-r*.19,0,-r)
        c.drawPath(p,paint(col))


def logo(c,x,y,size,col=BLUE):
    with group(c,x,y,size/32):
        cx=24.3-math.sqrt(121-7.7**2)
        c.drawArc(skia.Rect.MakeLTRB(cx-11,5,cx+11,27),44.427,271.146,False,paint(col,1,5))
        p=skia.Path();p.moveTo(6.6,19.6);p.cubicTo(7,24.2,5.6,27.6,2.6,30);p.cubicTo(7.5,30,11.6,27.7,13.7,24.8);p.close()
        c.drawPath(p,paint(col))


def wordmark(c,x,y,size=100,col=BLUE,align='left'):
    w=measure('oWrite',size,500,True)[0]+size*.7
    if align=='center':x-=w/2
    logo(c,x,y,size*.9,col)
    text(c,'oWrite',x+size*.69,y+size*.04,size,col,500,serif=True)
    return w


def cursor(c,x,y,name,col=BLUE):
    ln(c,x,y,x,y+40,col,3)
    pill(c,name,x,y-44,WHITE,col,18,12)


def pointer(c,x,y,p=0):
    if REDUCED:return
    with group(c,x,y,scale=1-.08*p):
        path=skia.Path();path.moveTo(0,0);path.lineTo(0,35);path.lineTo(9,27);path.lineTo(16,42);path.lineTo(23,39);path.lineTo(16,24);path.lineTo(29,24);path.close()
        c.drawPath(path,paint(WHITE,1,5));c.drawPath(path,paint(INK))


def draw_path(c,path,p=1,col=BLUE,width=4,head=False,under=False):
    if under:c.drawPath(path,paint(col,.10,width))
    pm=skia.PathMeasure(path,False);length=pm.getLength();part=skia.Path()
    pm.getSegment(0,length*clamp(p),part,True);c.drawPath(part,paint(col,1,width))
    if head and p>0:
        pt,_=pm.getPosTan(length*clamp(p));dot(c,pt.x(),pt.y(),width*1.7,col)


@lru_cache(None)
def backdrop(kind='paper'):
    rng=np.random.default_rng(17)
    yy,xx=np.mgrid[0:H,0:W]
    if kind=='blue':
        base=np.array([45,79,245]);v=-9*((xx/W-.3)**2+(yy/H-.3)**2)
    elif kind=='dark':
        base=np.array([17,26,61]);v=8*np.exp(-((xx/W-.65)**2+(yy/H-.35)**2)*4)
    else:
        base=np.array([248,248,245]);v=4*np.exp(-((xx/W-.5)**2+(yy/H-.45)**2)*4)
    grain=rng.normal(0,.42,(H,W))
    arr=np.clip(base[None,None,:]+v[:,:,None]+grain[:,:,None],0,255).astype(np.uint8)
    arr=np.dstack((arr,np.full((H,W),255,np.uint8)))
    arr=arr[:,:,[2,1,0,3]].copy()
    return skia.Image.fromarray(arr,colorType=skia.ColorType.kBGRA_8888_ColorType,alphaType=skia.AlphaType.kOpaque_AlphaType)


def bg(c,kind='paper'):
    c.drawImage(backdrop(kind),0,0)


def footer(c,n,label,dark=False):
    col='#a9b7e5' if dark else '#858c98'
    text(c,f'{n:02} / {label}',84,1004,18,col,600)


def doc_top(c,w=1400,title='The first-week guide',status='Draft'):
    panel(c,0,0,w,740)
    logo(c,28,22,36)
    text(c,'Launch space',78,29,20,MUTED)
    text(c,'/',230,29,20,'#a7adba')
    pill(c,status,255,20,MUTED,'#f0f2f6',18)
    avatar(c,w-240,44,'A',BLUE,19);avatar(c,w-205,44,'B',PURPLE,19);avatar(c,w-170,44,'T','#b06b36',19)
    pill(c,'Share',w-117,20,WHITE,BLUE,18)
    ln(c,0,86,w,86)
    text(c,title,64,135,53,INK,750)


def chapter_intro(c,t):
    bg(c)
    # A cursor carries the first idea, then its fragments scatter around it.
    a=show(t,.12,.7,end=3.2)
    with group(c,alpha=a):
        text(c,'It starts with',960,261,103,INK,650,align='center')
        reveal(c,'a good idea.',960,390,143,t,.55,BLUE,750,'center')
        dot(c,960,635,8,BLUE)
        p=skia.Path();p.moveTo(960,635);p.cubicTo(960,735,750,700,750,808)
        draw_path(c,p,E(t,1.4,1),BLUE,3,True)
    # Beautifully staggered paper artifacts, not just boxes around a heading.
    spread=1 if REDUCED else M(t,3,1.4);gather=M(t,6.55,1.45)
    fragments=[(-600,-350,-8,'DRAFT','first_week_final_v4','“Is this the latest one?”'),
               (540,-350,7,'CHAT','One more thread…','“What did we decide?”'),
               (-550,280,-5,'TASKS','Follow up on the guide','“Who is taking this?”'),
               (575,280,8,'REVIEW','A few comments later','“Are we ready to go?”')]
    for i,(dx,dy,angle,label,title,copy) in enumerate(fragments):
        q=E(t,2.8+i*.06,.8)
        x=960+dx*spread*(1-(0 if REDUCED else gather));y=570+dy*spread*(1-(0 if REDUCED else gather))
        with group(c,x,y,scale=1 if REDUCED else lerp(.95,1,q)*(1-.18*gather),angle=0 if REDUCED else angle*spread*(1-gather),alpha=q*(1-gather)):
            panel(c,-225,-104,450,208,r=14)
            text(c,label,-195,-76,17,BLUE,750)
            text(c,title,-195,-27,25,INK,700)
            text(c,copy,-195,43,21,MUTED,500)
    with group(c,alpha=show(t,3.5,.65,end=6.55)):
        reveal(c,'Then the work',960,375,103,t,3.5,INK,750,'center')
        reveal(c,'goes everywhere.',960,502,103,t,3.56,INK,750,'center')
    # Thread pulls the pieces into the same place.
    if t>6.35:
        for dx,dy,*_ in fragments:
            path=skia.Path();path.moveTo(960+dx,570+dy);path.cubicTo(960+dx*.8,570,960,570+dy*.3,960,570)
            draw_path(c,path,E(t,6.35,.9),BLUE,2)
        dot(c,960,570,12,BLUE)
    footer(c,1,'THE IDEA')


def chapter_brand(c,t):
    bg(c,'blue')
    # One traveling line becomes the framework for the next scene.
    path=skia.Path();path.moveTo(-60,860);path.cubicTo(500,860,325,260,960,260);path.cubicTo(1580,260,1400,860,1980,860)
    draw_path(c,path,E(t,.1,1.3),'#9db0ff',2,False)
    with group(c,alpha=show(t,.12,.6,end=2.2)):
        reveal(c,'Bring it',960,321,128,t,.1,WHITE,750,'center')
        reveal(c,'together.',960,472,128,t,.16,WHITE,750,'center')
    with group(c,alpha=show(t,2.4,.6)):
        wordmark(c,960,336,194,WHITE,'center')
        reveal(c,'A shared space for ideas to become work.',960,610,42,t,2.65,WHITE,550,'center')
    # The blue background opens like a sheet, leading into the document.
    footer(c,2,'MEET COWRITE',True)


def live_document(c,t):
    bg(c)
    reveal(c,'One draft.',80,112,99,t,.05,INK)
    reveal(c,'Many minds.',690,112,99,t,.11,BLUE)
    text(c,'Write together, live.',85,247,30,MUTED,500,show(t,.5))
    # Camera moves into the writing, then makes room for the contextual comment.
    scale=key(t,[(0,.91),(1.1,1),(4,1),(6.4,.94),(10,.94)]) if not REDUCED else .94
    x=key(t,[(0,260),(1.1,260),(4,260),(6.4,135),(10,135)]) if not REDUCED else 135
    y=key(t,[(0,407),(1.1,345),(10,345)]) if not REDUCED else 345
    with group(c,x,y,scale,alpha=show(t,.2,.75)):
        doc_top(c)
        text(c,'A clear first day changes everything.',64,238,36,INK,600)
        text(c,'THE GOAL',64,326,18,BLUE,750)
        text(c,'Help every new teammate find their feet.',64,372,31,INK,550)
        text(c,'THE PLAN',64,460,18,BLUE,750)
        tw=typing(c,'One guide, built by the whole team.',64,508,34,t,1.7,2.1,INK,600)
        if 1.7<t<6.5:cursor(c,64+tw,505,'Ada',BLUE)
        tw2=typing(c,'Start with the first-day checklist.',64,574,31,t,3.3,2.2,INK,500)
        if t>3.3:cursor(c,64+tw2,572,'Bea',PURPLE)
        pill(c,'Saved',64,660,GREEN,'#e8f4ed',18)
    # Comment arrives attached to exactly the sentence being discussed.
    note=show(t,6,.7)
    nx=lerp(1350,1300,note) if not REDUCED else 1300
    with group(c,nx,570,alpha=note):
        panel(c,0,0,520,250,r=18)
        avatar(c,43,47,'T','#b06b36',20)
        text(c,'Tomi',79,28,23,INK,750)
        text(c,'on “first day”',79,65,19,MUTED,500)
        text(c,'Could we cover the whole first week?',28,126,24,INK,550)
        text(c,'Reply in context',28,193,20,BLUE,650)
    footer(c,3,'WRITE TOGETHER')


def review(c,t):
    bg(c)
    reveal(c,'Make good work better.',960,105,93,t,.1,INK,750,'center')
    text(c,'Feedback stays in the text. Everyone can see what changed.',960,245,29,MUTED,500,show(t,.4),align='center')
    # A close-up of the same sentence becomes an actual suggested edit.
    with group(c,210,359+ (0 if REDUCED else 45*(1-E(t,.2))),alpha=show(t,.2)):
        panel(c,0,0,1500,437,r=24)
        text(c,'THE FIRST-WEEK GUIDE',48,36,20,BLUE,750)
        pill(c,'In review',1260,25,'#9a6512','#fbf1dc',20)
        text(c,'A clear',48,129,63,INK,600)
        oldAlpha=1-E(t,1.5,.5)
        text(c,'first day',293,129,63,INK,600,oldAlpha)
        text(c,'changes everything.',730,129,63,INK,600)
        if t>1.4:
            with group(c,alpha=show(t,1.4)):
                rr(c,290,112,405,103,11,SOFT)
                reveal(c,'first week',307,130,63,t,1.5,BLUE,650)
                ln(c,308,206,667,206,BLUE,3)
        text(c,'Suggested by Tomi',49,280,23,MUTED,600)
        accepted=E(t,4.8,.4)
        with group(c,alpha=1-accepted):
            pill(c,'Reject',1112,268,MUTED,'#f0f2f6',24)
            pill(c,'Accept',1278,268,WHITE,GREEN,24)
        with group(c,alpha=accepted):
            check(c,1185,279,31,GREEN,E(t,4.85,.35))
            text(c,'Accepted',1234,279,25,GREEN,700)
        px=key(t,[(0,1420),(3.4,1420),(4.55,1350),(5.1,1350),(5.7,1480)])
        py=key(t,[(0,430),(3.4,430),(4.55,299),(5.1,299),(5.7,470)])
        with group(c,alpha=show(t,3.3,.3,end=5.5)):
            pointer(c,px,py,E(t,4.7,.1)*(1-E(t,4.85,.16)))
    with group(c,alpha=show(t,5.55)):
        avatar(c,700,880,'B',PURPLE,27)
        check(c,748,864,30)
        text(c,'Bea signed off. Ready to approve.',798,863,29,GREEN,650)
    footer(c,4,'REVIEW WITH CLARITY')


def nib(c,t):
    bg(c,'dark')
    # A single oversized Nib sparkle is a brand object, not ambient decoration.
    appear=E(t,.15,.9)
    with group(c,340,435,scale=1 if REDUCED else .95+.05*appear,angle=0 if REDUCED else -28*(1-appear),alpha=appear):
        sparkle(c,0,0,145,'#9bb0ff')
        sparkle(c,173,-136,30,WHITE)
    reveal(c,'Meet Nib.',680,122,105,t,.12,WHITE)
    text(c,'Your writing assistant, inside the work.',686,265,30,'#b9c6ed',500,show(t,.45))
    with group(c,680,365,alpha=show(t,.7)):
        panel(c,0,0,1135,140,'#222f59',18,False,False)
        sparkle(c,43,43,17,'#a9baff')
        text(c,'ASK NIB',80,30,18,'#afbef0',750)
        typing(c,'Make this introduction clearer.',32,81,34,t,.9,1.15,WHITE,600)
    with group(c,680,548+(0 if REDUCED else 35*(1-E(t,2.3))),alpha=show(t,2.3)):
        panel(c,0,0,1135,260,WHITE,18,False,False)
        text(c,'SUGGESTED BY NIB',30,28,18,BLUE,750)
        reveal(c,'A confident first week starts here.',30,83,43,t,2.45,INK,700)
        text(c,'One guide. Everything a new teammate needs.',32,150,29,MUTED,500)
        text(c,'Reject',852,213,22,MUTED,650,1-E(t,5.25,.3))
        with group(c,alpha=1-E(t,5.25,.3)):
            pill(c,'Accept',972,198,WHITE,GREEN,21)
        with group(c,alpha=show(t,5.4,.35)):
            check(c,850,211,28)
            text(c,'Accepted by you',895,212,23,GREEN,650)
    px=key(t,[(0,1800),(4,1800),(5.1,1710),(5.6,1710)])
    py=key(t,[(0,950),(4,950),(5.1,783),(5.6,783)])
    with group(c,alpha=show(t,4,.3,end=5.55)):pointer(c,px,py)
    reveal(c,'AI suggests.',90,796,61,t,3.25,'#afbef0',650)
    reveal(c,'You decide.',90,875,61,t,3.31,WHITE,750)
    footer(c,5,'HELP, WITH YOU IN CONTROL',True)


def conversation(c):
    panel(c,0,0,880,430)
    text(c,'THE DISCUSSION',36,30,19,BLUE,750)
    text(c,'What should we ship first?',36,83,45,INK,750)
    avatar(c,59,215,'A',BLUE,23)
    text(c,'Ada',100,185,23,INK,750)
    text(c,'The guide or the welcome video?',100,229,29,INK,500)
    avatar(c,59,328,'B',PURPLE,23)
    text(c,'Bea',100,297,23,INK,750)
    text(c,'The guide. It helps every new teammate.',100,342,28,INK,550)


def decision(c):
    panel(c,0,0,880,430)
    pill(c,'D-12',36,31,BLUE,SOFT,24)
    pill(c,'Decided',702,31,GREEN,'#e8f4ed',21)
    text(c,'Start with the',36,123,53,INK,750)
    text(c,'onboarding guide.',36,190,53,INK,750)
    text(c,'Decided by Bea',36,302,25,MUTED,550)
    ln(c,36,351,844,351)
    text(c,'Why? See the original discussion.',36,379,23,BLUE,650)


def task(c,t):
    panel(c,0,0,880,430)
    text(c,'THE NEXT STEP',36,30,19,BLUE,750)
    done=E(t,8.2,.45)
    rr(c,37,123,43,43,10,LINE,1,2)
    with group(c,alpha=done):check(c,34,120,49,GREEN,E(t,8.25,.3))
    text(c,'Write the first-day',108,113,46,INK,750)
    text(c,'checklist.',108,175,46,INK,750)
    avatar(c,61,299,'A',BLUE,24)
    text(c,'Ada',104,278,27,INK,700)
    pill(c,'Due Friday',650,273,MUTED,'#f1f3f7',23)
    ln(c,36,351,844,351)
    text(c,'Linked to the guide. Updated everywhere.',36,379,23,MUTED,550)


def context(c,t):
    bg(c)
    # A traveling camera literally follows the source-to-outcome connection.
    cam=key(t,[(0,0),(2.35,0),(3.45,1030),(5.45,1030),(6.55,2060),(10,2060)]) if not REDUCED else (0 if t<3 else 1030 if t<6 else 2060)
    phases=[('A conversation.',0,2.75),('A decision.',3.15,5.85),('A next step.',6.25,None)]
    for title,a,end in phases:
        with group(c,alpha=show(t,a,.45,end)):
            reveal(c,title,960,104,107,t,a,INK,750,'center')
    with group(c,520-cam,400):
        p=skia.Path();p.moveTo(-600,215);p.lineTo(0,215)
        p.moveTo(880,215);p.cubicTo(930,215,980,215,1030,215)
        p.moveTo(1910,215);p.cubicTo(1960,215,2010,215,2060,215)
        p.moveTo(2940,215);p.lineTo(3600,215)
        c.drawPath(p,paint('#adbcff',1,4))
        with group(c,alpha=show(t,.2)):conversation(c)
        with group(c,1030,0,alpha=show(t,2.8)):decision(c)
        with group(c,2060,0,alpha=show(t,5.9)):task(c,t)
        # Trace the connecting thread as each new artifact comes into focus.
        for a,x0 in [(2.5,880),(5.6,1910)]:
            p=skia.Path();p.moveTo(x0,215);p.lineTo(x0+150,215)
            draw_path(c,p,E(t,a,1),BLUE,5,True)
    text(c,'The reasoning stays connected.',960,895,35,BLUE,650,show(t,.8),align='center')
    footer(c,6,'FROM TALK TO ACTION')


def tiny_doc(c,x,y,title,lines=5):
    panel(c,x,y,340,335,r=13)
    text(c,title,x+25,y+31,22,INK,750)
    for i in range(lines):
        rr(c,x+25,y+93+i*34,[265,230,278,195,248][i],8,4,'#dfe4ef')
    ln(c,x+25,y+290,x+315,y+290,BLUE,2)


def safety(c,t):
    bg(c)
    reveal(c,'Keep the work. Keep moving.',960,108,93,t,.08,INK,750,'center')
    # Two deliberately composed proofs: retained drafts and reconciling edits.
    divider=skia.Path();divider.moveTo(960,360);divider.lineTo(960,875)
    draw_path(c,divider,E(t,.6,.8),LINE,2)
    text(c,'Every version, still here.',460,300,36,BLUE,700,show(t,.45),align='center')
    for i,(title,tx,ty,ang) in enumerate([('First draft',257,450,-8),('Reviewed',327,420,-3),('Ready to go',397,455,3)]):
        p=E(t,.8+i*.07,.8)
        with group(c,tx,ty+(0 if REDUCED else 50*(1-p)),angle=0 if REDUCED else ang,alpha=p):
            tiny_doc(c,0,0,title)
    with group(c,alpha=show(t,2.5)):
        pill(c,'Compare · Restore',355,855,MUTED,'#e9ecf3',24)
    text(c,'Offline? Keep writing.',1440,300,36,BLUE,700,show(t,1.5),align='center')
    with group(c,1080,424,alpha=show(t,1.8)):
        panel(c,0,0,720,352,r=19)
        text(c,'The first-week guide',30,29,29,INK,750)
        offline=1-E(t,5.25,.4)
        with group(c,alpha=offline):pill(c,'Offline',536,23,'#9a6512','#fbf1dc',19)
        with group(c,alpha=1-offline):pill(c,'Synced',536,23,GREEN,'#e8f4ed',19)
        ln(c,0,92,720,92)
        text(c,'Everyone gets a welcome.',30,131,29,INK,550)
        typing(c,'And a clear place to start.',30,195,29,t,2.6,1.35,BLUE,600)
        typing(c,'All edits are back together.',30,257,29,t,5.55,.8,GREEN,600)
    with group(c,alpha=show(t,5.65)):
        check(c,1225,854,31)
        text(c,'Reconnect. Edits merge.',1275,853,27,GREEN,650)
    footer(c,7,'ROOM TO KEEP GOING')


def published_page(c,w=670,h=530):
    panel(c,0,0,w,h,r=18)
    rr(c,0,0,w,55,18,'#f0f2f6')
    for i in range(3):dot(c,24+i*20,27,5,'#bbc2cf')
    text(c,'cowrite / published',w/2,17,17,MUTED,550,align='center')
    wordmark(c,42,97,41)
    text(c,'Your first week,',42,176,45,INK,750)
    text(c,'made simple.',42,232,45,INK,750)
    text(c,'A confident start begins here.',42,316,26,MUTED,500)
    for i,v in enumerate([556,490,526,347]):rr(c,42,379+i*27,v,7,3,'#e1e5ef')


def publish(c,t):
    bg(c,'blue')
    reveal(c,'Ready for the world.',960,109,100,t,.08,WHITE,750,'center')
    text(c,'Publish it. Present it. Take it with you.',960,250,32,'#d9e1ff',500,show(t,.45),align='center')
    # One document fans out into distinct useful formats, on the musical lift.
    spread=1 if REDUCED else M(t,1,1.25)
    exports=[(-600,50,-10,'PDF'),(-310,0,-5,'Word'),(750,75,7,'Slides')]
    for i,(dx,dy,ang,label) in enumerate(exports):
        with group(c,960+dx*spread,585+dy*spread,scale=(.85 if label=='Slides' else 1)*(.95+.05*spread),angle=0 if REDUCED else ang*spread,alpha=show(t,.65+i*.06)):
            panel(c,-180,-205,360,410,r=16)
            pill(c,label,-147,-174,BLUE,SOFT,23)
            text(c,'The first-week',-147,-89,27,INK,750)
            text(c,'guide',-147,-48,27,INK,750)
            for j in range(5):rr(c,-147,28+j*30,270-(j%2)*40,7,3,'#dee4f1')
    px=key(t,[(0,625),(1,625),(2.6,875),(7,875)]) if not REDUCED else 875
    with group(c,px,360,scale=1 if REDUCED else .94+.06*E(t,.5),angle=0 if REDUCED else -2*(1-E(t,1.5)),alpha=show(t,.5)):
        published_page(c)
    with group(c,alpha=show(t,3.2)):
        pill(c,'Public link · No account needed to read',975,929,BLUE,WHITE,22)
    footer(c,8,'SHARE THE RESULT',True)


def finale(c,t):
    bg(c,'blue')
    # The journey becomes one unbroken thread, then resolves into the wordmark.
    labels=['Idea','Draft','Review','Decision','Done']
    with group(c,alpha=show(t,.05,.4,end=3.5)):
        path=skia.Path();path.moveTo(0,575);path.cubicTo(350,575,300,470,540,470);path.cubicTo(850,470,1000,650,1260,650);path.cubicTo(1510,650,1590,500,1920,500)
        draw_path(c,path,E(t,.1,2.1),'#abc0ff',4,True)
        coords=[(235,556),(590,473),(960,560),(1320,646),(1700,530)]
        for i,(label,(x,y)) in enumerate(zip(labels,coords)):
            p=E(t,.35+i*.3,.65)
            with group(c,alpha=p):
                dot(c,x,y,10,WHITE)
                text(c,label,x,y+53,29,WHITE,650,align='center')
        reveal(c,'One idea. All the way through.',960,214,86,t,.15,WHITE,750,'center')
    # Six deliberate seconds to land the brand and the invitation.
    with group(c,alpha=show(t,3.75,.6)):
        wordmark(c,960,194,142,WHITE,'center')
        reveal(c,'From idea to done.',960,434,116,t,3.85,WHITE,750,'center')
        reveal(c,'Together.',960,580,116,t,3.91,WHITE,750,'center')
        with group(c,alpha=show(t,4.4)):
            pillWidth=measure('Try CoWrite',29,650)[0]+44
            pill(c,'Try CoWrite',(W-pillWidth)/2,792,BLUE,WHITE,29,22)
            text(c,'cowrite.cowrite.workers.dev',960,894,28,'#e0e7ff',550,align='center')


CHAPTERS=[(0,8,chapter_intro,'The idea'),(8,13,chapter_brand,'Bring it together'),
          (13,23,live_document,'Write together'),(23,31,review,'Review with clarity'),
          (31,39,nib,'Meet Nib'),(39,49,context,'Keep the why'),
          (49,57,safety,'Keep moving'),(57,64,publish,'Share the result'),
          (64,72,finale,'From idea to done')]


def render_frame(t,width=W,height=H):
    s=skia.Surface(width,height);c=s.getCanvas();c.scale(width/W,height/H)
    index=next((i for i,(a,b,_,_) in enumerate(CHAPTERS) if a<=t<b),len(CHAPTERS)-1)
    start,end,fn,_=CHAPTERS[index]
    local=t-start
    # Matched movement for related product scenes; geometric iris at brand reveal.
    if index==1 and local<.65 and not REDUCED:
        chapter_intro(c,7.99)
        c.save();p=skia.Path();p.addCircle(960,570,lerp(16,1250,E(local,0,.65)));c.clipPath(p,True)
        fn(c,local);c.restore()
    elif index in [3,4,7] and local<.45 and not REDUCED:
        pa,pb,pfn,_=CHAPTERS[index-1]
        q=M(local,0,.45)
        with group(c,y=-1080*q):pfn(c,pb-pa-.001)
        with group(c,y=1080*(1-q)):fn(c,local)
    elif index>0 and local<.25:
        pa,pb,pfn,_=CHAPTERS[index-1];pfn(c,pb-pa-.001)
        with group(c,alpha=clamp(local/.25)):fn(c,local)
    else:fn(c,local)
    return s.makeImageSnapshot()


def audio():
    """Original score: 120 BPM, 36 bars, composed arrangement and separate SFX."""
    sr=48000;n=sr*DURATION;rng=np.random.default_rng(71023)
    music=np.zeros((n,2),np.float32);fx=np.zeros_like(music)
    def put(bus,start,v,level=1,pan=0):
        i=round(start*sr)
        if i>=n:return
        v=np.asarray(v,np.float32)
        if i<0:v=v[-i:];i=0
        v=v[:n-i]*level
        bus[i:i+len(v),0]+=v*math.sqrt((1-pan)/2)
        bus[i:i+len(v),1]+=v*math.sqrt((1+pan)/2)
    def tone(m,dur,kind='piano'):
        t=np.arange(round(sr*dur),dtype=np.float32)/sr;f=440*2**((m-69)/12)
        if kind=='piano':
            out=np.zeros_like(t)
            for h,amp in enumerate([1,.46,.2,.13,.07,.04],1):
                out+=amp*np.sin(2*np.pi*f*h*(1+h*h*.000018)*t)*np.exp(-t*(1.55+h*.61))
            out*=1-np.exp(-t*480)
        elif kind=='pad':
            out=(np.sin(2*np.pi*f*t)+.35*np.sin(2*np.pi*(f+.42)*t)+.15*np.sin(4*np.pi*f*t))
            out*=np.minimum(t/.6,1)*np.minimum((dur-t)/1.15,1)*.65
        elif kind=='bass':
            out=(np.sin(2*np.pi*f*t)+.18*np.sin(4*np.pi*f*t)+.07*np.sin(6*np.pi*f*t))*np.exp(-t*3.3)*(1-np.exp(-t*90))
        elif kind=='bell':
            out=(np.sin(2*np.pi*f*t)+.25*np.sin(2*np.pi*f*2.76*t)*np.exp(-t*5))*np.exp(-t*4)*(1-np.exp(-t*240))
        out*=np.clip((dur-t)/.08,0,1)
        return out
    # 8-bar harmonic phrase, and deliberate re-voicings between sections.
    chords=[([53,57,60,64,67],41),([50,57,60,64,69],38),
            ([57,60,64,67,71],45),([48,55,60,62,67],36),
            ([53,60,64,67,69],41),([50,57,60,65,69],38),
            ([55,59,62,64,69],43),([48,55,59,62,64],36)]
    melody=[(0,77),(.75,81),(1.5,79),(2.75,76),(3.5,72)]
    for bar in range(36):
        at=bar*2;ch,bass=chords[bar%8]
        lift=1 if 6<=bar<31 else .65
        for j,m in enumerate(ch):
            pad=tone(m,2.9,'pad')
            put(music,at,pad,.032*lift,-.75+j*.36)
            if bar<32:put(music,at+j*.027,tone(m+12,2.1),.052*lift,(-.6+j*.3))
        if bar>=4 and bar<32:
            for b in [0,1,1.75]:put(music,at+b,tone(bass,.9,'bass'),.18)
        if 6<=bar<32:
            for k,b in enumerate([.25,.75,1.25,1.625]):
                midi=ch[(bar+k*2)%5]+24
                v=tone(midi,1.4,'piano')
                vel=.057*(.85+rng.random()*.3)
                put(music,at+b,v,vel,.55 if k%2 else -.55)
                put(music,at+b+.375,v,vel*.23,-.55 if k%2 else .55)
        if bar%4==0 and 8<=bar<31:
            for off,m in melody:
                v=tone(m,1.8,'bell')
                put(music,at+off,v,.067,.2)
                put(music,at+off+.375,v,.019,-.4)
        # Drums enter at the reveal; a breakdown makes room for the rationale.
        if 4<=bar<32:
            halftime=19<=bar<24
            for b in ([0] if halftime else [0,1]):
                tt=np.arange(round(sr*.35))/sr
                kick=np.sin(2*np.pi*(45*tt+2.0*(1-np.exp(-tt*25))))*np.exp(-tt*16)
                put(music,at+b,kick,.20)
            for b in ([1] if halftime else [.5,1.5]):
                tt=np.arange(round(sr*.16))/sr
                no=rng.normal(size=len(tt));no=no-np.roll(no,1)
                clap=no*np.exp(-tt*36)*(.55+.45*np.cos(2*np.pi*29*tt)**2)
                put(music,at+b,clap,.024,.12)
            for k,b in enumerate(np.arange(.25,2,.25)):
                tt=np.arange(round(sr*.07))/sr;no=rng.normal(size=len(tt));no=no-np.roll(no,1)
                put(music,at+b+(rng.random()-.5)*.008,no*np.exp(-tt*88),.006 if k%2 else .009,(-.4 if k%2 else .4))
        if bar>=31:
            for j,m in enumerate([53,60,65,69,72]):
                put(music,at+j*.035,tone(m,3,'piano'),.063,-.4+j*.2)
    # Short room reflections add space without obscuring words or UI sounds.
    dry=music.copy()
    for delay,gain in [(.071,.14),(.137,.09),(.211,.055)]:
        shift=round(sr*delay);music[shift:]+=dry[:-shift,::-1]*gain
    # Restrained air transitions, with stereo motion and low-frequency body.
    for at in [3.4,8,10.4,13,23,31,39,42,45,49,57,64,67.7]:
        dur=.75;tt=np.arange(round(dur*sr))/sr
        no=rng.normal(size=len(tt));air=np.convolve(no,np.ones(19)/19,mode='same')
        env=np.sin(np.pi*tt/dur)**2
        put(fx,at-.32,air*env,.16,-.25)
        put(fx,at-.23,air*env,.08,.55)
        th=np.arange(round(.5*sr))/sr
        put(fx,at,np.sin(2*np.pi*58*th)*np.exp(-th*13),.10)
    # Paper shifts, typing, click, accepted chord: each event has its own timbre.
    for at in [3,3.08,3.16,3.24,49.8,49.87,49.94,58.0,58.1,58.2]:
        tt=np.arange(round(.19*sr))/sr;no=rng.normal(size=len(tt))
        v=np.convolve(no,np.ones(9)/9,mode='same')*np.sin(np.pi*tt/.19)**2
        put(fx,at,v,.065, rng.uniform(-.65,.65))
    for a,b in [(14.7,17.0),(16.3,18.5),(31.9,33.05),(51.6,52.95),(54.55,55.35)]:
        for at in np.arange(a,b,.135):
            tt=np.arange(round(.045*sr))/sr
            v=(rng.normal(size=len(tt))*.2+np.sin(2*np.pi*710*tt))*np.exp(-tt*145)
            put(fx,at,v,.04,-.2)
    for at in [27.8,36.25,47.2,54.25,60.2]:
        for j,m in enumerate([76,79,84]):
            put(fx,at+j*.06,tone(m,1.2,'bell'),.083,-.3+j*.3)
    for at in [19.0,25.0,33.3,42.3,45.5]:
        put(fx,at,tone(79,.35,'bell'),.066,.25)
    # Three-note brand resolution under the last wordmark.
    for at,m in [(67.75,77),(68.0,81),(68.5,84)]:put(fx,at,tone(m,2.5,'bell'),.08)
    tt=np.arange(n,dtype=np.float32)/sr
    fade=np.minimum(tt/.8,1)*np.clip((72-tt)/2.1,0,1)
    music*=fade[:,None];fx*=np.clip((72-tt)/1.2,0,1)[:,None]
    def save(name,v):
        with wave.open(str(OUT/name),'wb') as f:
            f.setnchannels(2);f.setsampwidth(2);f.setframerate(sr)
            f.writeframes((np.clip(v,-1,1)*32767).astype('<i2').tobytes())
    save('music.wav',music);save('effects.wav',fx);save('mix.wav',music+fx)
    print('Composed 36-bar score and separate synchronized effects.',flush=True)


def stills():
    times=[1.8,4.9,9.1,11.9,17.7,21.5,26.4,29.5,34.7,37.5,40.8,43.8,47.7,54.8,61.5,65.9,69.7]
    thumbw,thumbh=640,360
    cols=3;rows=math.ceil(len(times)/cols)
    board=Image.new('RGB',(cols*thumbw,rows*398),'#d8dce5')
    d=ImageDraw.Draw(board)
    for i,t in enumerate(times):
        frame=render_frame(t)
        arr=frame.toarray(colorType=skia.ColorType.kRGBA_8888_ColorType)
        im=Image.fromarray(arr).convert('RGB')
        im.save(OUT/f'frame-{t:04.1f}.jpg',quality=94)
        x=(i%cols)*thumbw;y=(i//cols)*398
        board.paste(im.resize((thumbw,thumbh),Image.Resampling.LANCZOS),(x,y))
        d.text((x+14,y+369),f'{t:04.1f}s',fill=INK,font=ImageFont.truetype(str(ROOT/'assets'/'Manrope.ttf'),19))
    board.save(OUT/'storyboard.jpg',quality=94)
    im=Image.fromarray(render_frame(69.7).toarray(colorType=skia.ColorType.kRGBA_8888_ColorType)).convert('RGB')
    im.save(OUT/'poster.jpg',quality=95)
    print('17 frames and contact sheet rendered.',flush=True)


def movie(draft=False):
    width,height,fps=(960,540,24) if draft else (1920,1080,60)
    name='cowrite-the-thread'+('-draft' if draft else '-gentle' if REDUCED else '')+'.mp4'
    cmd=['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','rawvideo','-vcodec','rawvideo','-pix_fmt','bgra',
         '-s',f'{width}x{height}','-r',str(fps),'-i','-','-i',str(OUT/'mix.wav'),
         '-c:v','libx264','-preset','fast','-crf','19' if draft else '17','-pix_fmt','yuv420p',
         '-c:a','aac','-b:a','256k','-af','loudnorm=I=-16:TP=-1.7:LRA=9','-ar','48000',
         '-movflags','+faststart','-t',str(DURATION),'-metadata','title=CoWrite — The thread',
         '-metadata','comment=Original motion design, composition and sound effects. Illustrative product examples.',str(OUT/name)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    try:
        for i in range(fps*DURATION):
            t=i/fps;im=render_frame(t,width,height)
            proc.stdin.write(im.tobytes())
            if i%(fps*4)==0:print(f'{name}: {t:.0f}/{DURATION}s',flush=True)
    finally:proc.stdin.close()
    if proc.wait():raise RuntimeError('FFmpeg export failed')
    print(f'Finished {OUT/name}',flush=True)


if __name__=='__main__':
    ap=argparse.ArgumentParser();ap.add_argument('--stills',action='store_true');ap.add_argument('--draft',action='store_true');ap.add_argument('--reduced-motion',action='store_true');ap.add_argument('--audio',action='store_true')
    args=ap.parse_args();REDUCED=args.reduced_motion
    if args.stills:stills()
    elif args.audio:audio()
    else:
        if not (OUT/'mix.wav').exists():audio()
        movie(args.draft)
