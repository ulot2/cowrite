"""CoWrite — From thought to done. Deterministic film + original score.

Requires Python 3.12+, Pillow, NumPy and ffmpeg on PATH. No network at render time.
python render.py                 # 1920x1080, 30 fps, 60 seconds
python render.py --stills        # storyboard contact sheet only
python render.py --reduced-motion # gentle dissolves, no spatial animation
"""
from pathlib import Path
from functools import lru_cache
import argparse
import math
import subprocess
import wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'output'
OUT.mkdir(exist_ok=True)
W, H, FPS, SECONDS = 1920, 1080, 30, 60
BLUE = '#2d4ff5'
INK = '#16181d'
MUTED = '#626671'
LINE = '#e3e5ea'
TINT = '#f3f4f7'
SOFT = '#e6eaff'
GREEN = '#1d8348'
NAVY = '#141c43'
WHITE = '#ffffff'
EASE = (.2, .7, .2, 1.)  # app/app.css --ease-out, retained verbatim
MOVE = (.77, 0., .175, 1.)  # animate skill: on-screen movement
REDUCED = False


@lru_cache(None)
def font(size, weight=500, serif=False):
    f = ImageFont.truetype(str(ROOT / 'assets' / ('InstrumentSerif-Italic.ttf' if serif else 'Manrope.ttf')), size)
    if not serif:
        f.set_variation_by_axes([weight])
    return f


def rgb(c):
    return tuple(bytes.fromhex(c.lstrip('#')))


def clamp(v):
    return max(0., min(1., v))


def ease(t, curve=EASE):
    t = clamp(t)
    x1, y1, x2, y2 = curve
    lo, hi = 0., 1.
    for _ in range(15):
        u = (lo + hi) / 2
        x = 3 * (1-u)**2 * u*x1 + 3*(1-u)*u*u*x2 + u**3
        if x < t:
            lo = u
        else:
            hi = u
    return 3*(1-u)**2*u*y1 + 3*(1-u)*u*u*y2 + u**3


def sheet(w, h, bg=None, radius=20, border=None):
    im = Image.new('RGBA', (w, h))
    if bg:
        ImageDraw.Draw(im).rounded_rectangle((0, 0, w-1, h-1), radius, fill=bg, outline=border, width=2)
    return im


def txt(im, text, x, y, size=30, color=INK, weight=500, serif=False):
    ImageDraw.Draw(im).text((x, y), text, font=font(size, weight, serif), fill=color, anchor='lt')


def text_layer(text, size, color=INK, weight=700, serif=False):
    f = font(size, weight, serif)
    b = f.getbbox(text)
    im = sheet(math.ceil(f.getlength(text))+8, b[3]-b[1]+12)
    ImageDraw.Draw(im).text((2, 2-b[1]), text, font=f, fill=color)
    return im


def line(im, a, b, color=LINE, width=2):
    ImageDraw.Draw(im).line([a, b], fill=color, width=width)


def pill(text, color=BLUE, bg=SOFT, size=22):
    f = font(size, 650)
    im = sheet(math.ceil(f.getlength(text))+36, size+30, bg, 14)
    txt(im, text, 18, 12, size, color, 650)
    return im


def put(im, layer, x, y):
    im.alpha_composite(layer, (round(x), round(y)))


def avatar(im, x, y, initial, color=BLUE, r=21):
    d = ImageDraw.Draw(im)
    d.ellipse((x-r, y-r, x+r, y+r), fill=color, outline=WHITE, width=3)
    f = font(r, 750)
    d.text((x, y), initial, font=f, fill=WHITE, anchor='mm')


def check(im, x, y, color=GREEN, size=24):
    d = ImageDraw.Draw(im)
    d.ellipse((x, y, x+size, y+size), fill=color)
    d.line([(x+size*.25,y+size*.5),(x+size*.44,y+size*.68),(x+size*.77,y+size*.32)], fill=WHITE, width=max(2, size//10))


def sparkle(im, x, y, r=18, color=BLUE):
    pts=[]
    for i in range(8):
        a=i*math.pi/4
        rr=r if i%2==0 else r*.3
        pts.append((x+math.sin(a)*rr,y+math.cos(a)*rr))
    ImageDraw.Draw(im).polygon(pts,fill=color)


def logo(size=72, color=BLUE):
    # The talking C from app/components/logo.tsx, supersampled.
    k=4
    im=sheet(size*k,size*k)
    d=ImageDraw.Draw(im)
    s=size*k/32
    cx=24.3-math.sqrt(11**2-7.7**2)
    d.arc(((cx-11)*s,5*s,(cx+11)*s,27*s),44.427,315.573,fill=color,width=round(5*s))
    for a in [44.427,315.573]:
        x=cx*s+11*s*math.cos(math.radians(a))
        y=16*s+11*s*math.sin(math.radians(a))
        d.ellipse((x-2.5*s,y-2.5*s,x+2.5*s,y+2.5*s),fill=color)
    tail=[]
    def cubic(a,b,c,e):
        for t in np.linspace(0,1,30):
            p=(1-t)**3*np.array(a)+3*(1-t)**2*t*np.array(b)+3*(1-t)*t*t*np.array(c)+t**3*np.array(e)
            tail.append(tuple(p*s))
    cubic((6.6,19.6),(7,24.2),(5.6,27.6),(2.6,30))
    cubic((2.6,30),(7.5,30),(11.6,27.7),(13.7,24.8))
    d.polygon(tail,fill=color)
    return im.resize((size,size),Image.Resampling.LANCZOS)


def wordmark(size=76, color=BLUE):
    rest=text_layer('oWrite',size,color,500,True)
    im=sheet(rest.width+round(size*.77),round(size*1.22))
    put(im,logo(round(size*.87),color),0,5)
    put(im,rest,round(size*.69),8)
    return im


class Scene:
    def __init__(self,start,end,bg=WHITE,chapter=''):
        self.start,self.end,self.bg=start,end,bg
        self.layers=[]
        if chapter:
            self.add(text_layer(chapter.upper(),19,('#c6ceff' if bg in [BLUE,NAVY] else MUTED),650),100,82,.1)
        self.add(wordmark(40,WHITE if bg in [BLUE,NAVY] else BLUE),1640,72,.05)

    def add(self,im,x,y,at=0,dur=.65,dx=0,dy=26,until=None,scale=1.,travel=None,typing=None):
        self.layers.append(dict(im=im,x=x,y=y,at=at,dur=dur,dx=dx,dy=dy,until=until,scale=scale,travel=travel,typing=typing))
        return self

    def text(self,text,x,y,size=70,color=INK,at=.15,weight=750,**kw):
        return self.add(text_layer(text,size,color,weight),x,y,at,**kw)

    def frame(self,t):
        im=Image.new('RGBA',(W,H),self.bg)
        lt=t-self.start
        for l in self.layers:
            if lt<l['at']:
                continue
            p=ease((lt-l['at'])/l['dur'])
            alpha=clamp((lt-l['at'])/.2) if REDUCED else p
            x,y=l['x'],l['y']
            scale=l['scale']+(1-l['scale'])*p
            if not REDUCED:
                x+=l['dx']*(1-p)
                y+=l['dy']*(1-p)
            if l['until'] is not None:
                op=ease((lt-l['until'])/.32)
                alpha*=1-op
                if not REDUCED:
                    y+=l['dy']*op
            if alpha<=0:
                continue
            if l['travel'] and not REDUCED:
                a,b,tx,ty=l['travel']
                q=ease((lt-a)/(b-a),MOVE)
                x+=tx*q
                y+=ty*q
            layer=l['im']
            if l['typing']:
                a,b=l['typing']
                width=max(1,round(layer.width*clamp((lt-a)/(b-a))))
                layer=layer.crop((0,0,width,layer.height))
            if not REDUCED and abs(scale-1)>.002:
                nw,nh=round(layer.width*scale),round(layer.height*scale)
                x+=(layer.width-nw)/2
                y+=(layer.height-nh)/2
                layer=layer.resize((nw,nh),Image.Resampling.BICUBIC)
            if alpha<.998:
                layer=layer.copy()
                layer.putalpha(layer.getchannel('A').point(lambda a:round(a*alpha)))
            put(im,layer,x,y)
        # A quiet, linear timeline; no jumps, no decorative data motion.
        ImageDraw.Draw(im).rectangle((0,H-5,round(W*t/SECONDS),H),fill='#98aaff' if self.bg in [BLUE,NAVY] else BLUE)
        return im.convert('RGB')


def chrome(w,h,title='Launch plan',status='Draft'):
    im=sheet(w,h,WHITE,22,LINE)
    txt(im,'‹  Launch space',28,26,22,MUTED)
    put(im,pill(status, GREEN if status=='Approved' else MUTED,'#e8f4ec' if status=='Approved' else TINT,18),235,15)
    avatar(im,w-205,39,'A',BLUE,18)
    avatar(im,w-175,39,'B','#8b4d94',18)
    put(im,pill('Share',WHITE,BLUE,18),w-132,15)
    line(im,(0,79),(w,79))
    txt(im,title,44,119,42,INK,750)
    return im


def cursor(name,color):
    im=sheet(150,74)
    d=ImageDraw.Draw(im)
    d.rectangle((0,33,3,72),fill=color)
    put(im,pill(name,WHITE,color,18),0,0)
    return im


def make_scenes():
    scenes=[]
    # 01. Scattered tools: purposeful drift converges before the clean brand cut.
    s=Scene(0,5,chapter='A familiar problem')
    s.text('Good ideas.',98,216,110,at=.12)
    s.text('Too many places.',98,346,100,BLUE,at=.3)
    s.text('The draft. The chat. The task list.',103,521,32,MUTED,at=.6,weight=500)
    s.text('Where did we land?',103,577,32,MUTED,at=.68,weight=500)
    cards=[('THE DRAFT','launch_plan_final_v3','Which version is the latest?',1090,210),
           ('THE CHAT','“What did we decide?”','One more scroll. One more thread.',1010,440),
           ('THE TASK LIST','Follow up on the launch','Who is taking this one?',1190,670)]
    for i,(label,title,sub,x,y) in enumerate(cards):
        c=sheet(530,185,TINT,18,LINE)
        txt(c,label,27,25,18,MUTED,650)
        txt(c,title,27,70,28,INK,700)
        txt(c,sub,27,124,22,MUTED)
        s.add(c,x,y,.42+i*.06,dx=80,travel=(3.5,4.8,-110+i*30,-20-i*45))
    scenes.append(s)
    # 02. A continuous idea-to-done chain, our visual motif throughout the film.
    s=Scene(5,10,BLUE,chapter='Meet CoWrite')
    s.add(wordmark(150,WHITE),100,220,.12)
    s.text('One space.',100,430,110,WHITE,at=.25)
    s.text('From idea to done.',100,566,94,WHITE,at=.4)
    labels=['Idea','Discuss','Write','Review','Done']
    rail=sheet(1690,155)
    for i,label in enumerate(labels):
        if i<4: line(rail,(i*338+66,35),((i+1)*338+20,35),'#8097ff',3)
    s.add(rail,103,802,.85,dy=0)
    for i,label in enumerate(labels):
        node=sheet(240,155)
        ImageDraw.Draw(node).ellipse((0,0,64,64),fill=WHITE)
        txt(node,str(i+1),23,19,22,BLUE,750)
        txt(node,label,0,90,26,WHITE,600)
        s.add(node,103+i*338,802,.9+i*.06,dy=35)
    scenes.append(s)
    # 03. An idea becomes a discussion with a person and a decision date.
    s=Scene(10,16,chapter='01 / Start with an idea')
    s.text('Give the idea',100,211,82)
    s.text('somewhere to go.',100,314,82,BLUE,at=.24)
    s.text('Collect it. Talk it through.',104,461,30,MUTED,at=.5,weight=500)
    s.text('Keep the conversation with the work.',104,510,30,MUTED,at=.56,weight=500)
    idea=sheet(720,145,SOFT,18)
    txt(idea,'IDEA',27,22,19,BLUE,750)
    txt(idea,'A simpler first day for new teammates',27,67,29,INK,650)
    s.add(idea,1040,206,.35,dx=70)
    q=sheet(720,400,WHITE,20,LINE)
    txt(q,'DISCUSSION',30,28,19,BLUE,750)
    txt(q,'What should we launch first?',30,78,35,INK,750)
    avatar(q,52,178,'A',BLUE)
    txt(q,'Ada',87,151,22,INK,700)
    txt(q,'Let’s start with the onboarding guide.',87,188,24)
    line(q,(30,240),(690,240))
    txt(q,'Who decides',30,270,20,MUTED)
    txt(q,'Bea',30,307,26,INK,700)
    txt(q,'Decide by',360,270,20,MUTED)
    txt(q,'Friday',360,307,26,INK,700)
    s.add(q,1040,385,1.25,dy=40,scale=.97)
    s.add(pill('Ideas → discussions → documents'),104,717,2.1)
    scenes.append(s)
    # 04. Simultaneous writing, named cursors, a comment grounded in the text.
    s=Scene(16,23,chapter='02 / Write together')
    s.text('Same page.',100,190,82)
    s.text('Same moment.',100,291,82,BLUE,at=.24)
    s.text('Write live. See who is here.',104,445,29,MUTED,at=.5,weight=500)
    s.text('Keep feedback in the text.',104,493,29,MUTED,at=.56,weight=500)
    doc=chrome(1020,640)
    txt(doc,'A smoother start for every teammate.',44,199,30)
    txt(doc,'Our goal',44,285,25,INK,750)
    txt(doc,'Make the first week clear, useful, and welcoming.',44,337,27)
    txt(doc,'The plan',44,441,25,INK,750)
    txt(doc,'One guide. One place for the team to contribute.',44,493,27)
    s.add(doc,800,250,.35,dx=65,scale=.97)
    typed=text_layer('Let’s build it together.',29,BLUE,650)
    s.add(typed,844,803,1.3,dy=0,dur=.2,typing=(1.3,3.2))
    s.add(cursor('Ada',BLUE),844,770,1.3,dy=0,dur=.2,travel=(1.3,3.2,typed.width,0))
    s.add(cursor('Bea','#8b4d94'),1525,548,1.5,dy=0,travel=(2.1,3.7,90,0))
    note=sheet(430,138,SOFT,16)
    txt(note,'Bea · Comment',24,23,20,BLUE,700)
    txt(note,'Can we add a first-day checklist?',24,68,23)
    s.add(note,1330,880,3.1,dy=25)
    s.add(pill('2 people writing',GREEN,'#e8f4ec'),103,700,2)
    scenes.append(s)
    # 05. Review is demonstrated as a replacement, followed by a sign-off.
    s=Scene(23,30,chapter='03 / Reach an agreed yes')
    s.text('Better drafts.',100,190,82)
    s.text('Clear approval.',100,291,82,BLUE,at=.24)
    s.text('Comment. Suggest. Sign off.',104,445,29,MUTED,at=.5,weight=500)
    s.text('Know when the work is ready.',104,493,29,MUTED,at=.56,weight=500)
    doc=chrome(1020,620,status='In review')
    txt(doc,'Our launch promise',44,211,28,INK,750)
    txt(doc,'Every new teammate gets a clear first day.',44,269,29)
    txt(doc,'Section sign-offs',44,435,23,MUTED,650)
    s.add(doc,800,250,.35,dx=65)
    suggestion=sheet(910,112,SOFT,14)
    txt(suggestion,'Suggested by Bea',20,15,18,BLUE,700)
    txt(suggestion,'“a clear first day” → “a confident first week”',20,58,28,INK,650)
    s.add(suggestion,844,585,1,until=3.2)
    bar=sheet(910,70,TINT,14)
    txt(bar,'Bea’s suggestion',20,23,23,INK,650)
    put(bar,pill('Accept',WHITE,GREEN,20),761,9)
    s.add(bar,844,712,1.3,until=3.2)
    accepted=sheet(910,100,'#e8f4ec',14)
    check(accepted,22,33,size=28)
    txt(accepted,'A confident first week.',68,30,30,GREEN,700)
    s.add(accepted,844,585,3.5,dy=8)
    signed=sheet(910,80)
    check(signed,0,16,size=26)
    txt(signed,'Bea signed off this section',45,17,25,GREEN,650)
    s.add(signed,844,747,4.2)
    s.add(pill('Approved',WHITE,GREEN,27),104,700,4.7)
    scenes.append(s)
    # 06. The outcome has an explicit, visual connection to its rationale.
    s=Scene(30,36,NAVY,chapter='04 / Remember the why')
    s.text('A decision. With its story.',100,190,94,WHITE)
    s.text('What was decided. Who decided. And why.',104,328,31,'#c6cceb',at=.4,weight=500)
    decision=sheet(920,280,WHITE,20)
    put(decision,pill('D-12 · Decided',GREEN,'#e8f4ec',22),32,28)
    txt(decision,'Launch the onboarding guide first.',32,107,36,INK,750)
    txt(decision,'Bea · Friday',32,194,24,MUTED)
    s.add(decision,100,490,.7,dx=-50)
    connector=sheet(100,40)
    line(connector,(0,18),(100,18),'#8097ff',3)
    s.add(connector,1020,610,1.5,dy=0)
    why=sheet(700,280,'#25315d',18)
    txt(why,'WHY',32,25,19,'#aabaff',750)
    txt(why,'“It makes the first week',32,87,33,WHITE,650)
    txt(why,'easier for everyone.”',32,137,33,WHITE,650)
    txt(why,'Open the original discussion',32,216,24,'#becaff')
    line(why,(375,235),(391,219),'#becaff',2)
    line(why,(380,219),(391,219),'#becaff',2)
    line(why,(391,219),(391,230),'#becaff',2)
    s.add(why,1120,490,1.7,dx=50,dy=0)
    s.add(pill('The reasoning stays connected.',NAVY,'#dce3ff',24),104,860,2.4)
    scenes.append(s)
    # 07. A sentence becomes an assigned, dated task. One source of truth.
    s=Scene(36,42,chapter='05 / Make the next step happen')
    s.text('Turn words',100,211,84)
    s.text('into next steps.',100,315,84,BLUE,at=.24)
    s.text('Assign the task. Set a date.',104,471,30,MUTED,at=.5,weight=500)
    s.text('Track it right from the work.',104,520,30,MUTED,at=.56,weight=500)
    source=sheet(920,140,TINT,18)
    txt(source,'FROM THE DISCUSSION',30,25,19,MUTED,700)
    txt(source,'“Let’s put the first-day checklist together.”',30,70,30,INK,650)
    s.add(source,900,230,.4,dx=70)
    task=sheet(920,320,WHITE,20,LINE)
    txt(task,'TASK',30,28,19,BLUE,700)
    ImageDraw.Draw(task).rounded_rectangle((30,88,62,120),8,outline=MUTED,width=2)
    txt(task,'Write the first-day checklist',84,85,33,INK,750)
    avatar(task,54,210,'A')
    txt(task,'Ada',90,193,26,INK,700)
    put(task,pill('Due Friday',MUTED,TINT,22),640,180)
    txt(task,'Linked to Launch plan',30,271,22,MUTED)
    s.add(task,900,424,1.3,dy=42)
    done=sheet(920,80,'#e8f4ec',14)
    check(done,24,24,size=30)
    txt(done,'Done here. Updated in the document.',74,26,26,GREEN,700)
    s.add(done,900,779,3.9)
    scenes.append(s)
    # 08. Nib proposes; the author explicitly accepts.
    s=Scene(42,49,'#eef1ff',chapter='06 / Meet Nib')
    s.text('A little help.',100,211,84)
    s.text('You stay in control.',100,315,78,BLUE,at=.24)
    s.text('Shorten a draft. Ask your space.',104,471,29,MUTED,at=.5,weight=500)
    s.text('Check work against your decisions.',104,520,29,MUTED,at=.56,weight=500)
    prompt=sheet(920,155,WHITE,18,LINE)
    sparkle(prompt,47,43,17)
    txt(prompt,'Ask Nib',80,29,24,BLUE,750)
    txt(prompt,'Make this introduction shorter.',31,94,30,INK,650)
    s.add(prompt,900,230,.4,dx=65)
    response=sheet(920,290,WHITE,20,LINE)
    txt(response,'SUGGESTED BY NIB',31,28,19,BLUE,750)
    txt(response,'A clear first week starts here.',31,94,36,INK,750)
    txt(response,'One guide. Everything a new teammate needs.',31,151,28,MUTED)
    put(response,pill('Reject',MUTED,TINT,23),31,214)
    put(response,pill('Accept',WHITE,GREEN,23),748,214)
    s.add(response,900,424,1.6,dy=30,until=4.4)
    ok=sheet(920,290,WHITE,20,LINE)
    txt(ok,'LAUNCH PLAN',31,28,19,BLUE,750)
    txt(ok,'A clear first week starts here.',31,94,36,INK,750)
    txt(ok,'One guide. Everything a new teammate needs.',31,151,28,MUTED)
    check(ok,31,224,size=27)
    txt(ok,'Accepted by you',78,225,24,GREEN,650)
    s.add(ok,900,424,4.7,dy=8)
    s.add(pill('AI suggests. You decide.',WHITE,BLUE,24),104,731,2.5)
    scenes.append(s)
    # 09. Safety net + delivery. Three simple actions, kept readable.
    s=Scene(49,55,chapter='07 / Keep the work moving')
    s.text('Keep the work.',100,200,92)
    s.text('Share the result.',100,312,92,BLUE,at=.24)
    labels=[('01','Version history','Compare and restore','earlier drafts.'),
            ('02','Offline editing','Edits merge when','you reconnect.'),
            ('03','Ready to share','Public page · Slides','Word · PDF')]
    for i,(num,title,sub,sub2) in enumerate(labels):
        c=sheet(548,330,TINT,18)
        txt(c,num,30,31,26,BLUE,750)
        txt(c,title,30,113,38,INK,750)
        txt(c,sub,30,199,28,MUTED)
        txt(c,sub2,30,244,28,MUTED)
        s.add(c,100+i*574,565,.6+i*.35,dy=40)
    scenes.append(s)
    # 10. Hold the end card long enough to read and act.
    s=Scene(55,60,BLUE)
    s.layers=[]
    mark=wordmark(126,WHITE)
    s.add(mark,(W-mark.width)/2,156,.1,dy=16)
    a=text_layer('From first thought',105,WHITE,750)
    b=text_layer('to finished, together.',105,WHITE,750)
    s.add(a,(W-a.width)/2,366,.22,dy=24)
    s.add(b,(W-b.width)/2,500,.3,dy=24)
    c=pill('Try CoWrite',BLUE,WHITE,31)
    s.add(c,(W-c.width)/2,726,.55,dy=18)
    url=text_layer('cowrite.cowrite.workers.dev',30,WHITE,550)
    s.add(url,(W-url.width)/2,835,.65,dy=15)
    scenes.append(s)
    return scenes


def synth_audio():
    """Original 112 BPM score, 28 bars. Deterministic stereo stems.

    Soft electric-piano voicings, syncopated mallets, warm bass, restrained
    percussion. Transition swishes, typing taps and confirmation chimes are a
    separate stem. No sampled recordings, external songs, or synthetic speech.
    """
    sr=48000
    n=sr*SECONDS
    music=np.zeros((n,2),np.float32)
    fx=np.zeros_like(music)
    rng=np.random.default_rng(24017)
    beat=60/112
    def add(bus,start,data,amp=1,pan=0):
        off=round(start*sr)
        if off<0 or off>=n: return
        data=np.asarray(data,dtype=np.float32)[:n-off]*amp
        bus[off:off+len(data),0]+=data*math.sqrt((1-pan)/2)
        bus[off:off+len(data),1]+=data*math.sqrt((1+pan)/2)
    def note(midi,dur,kind='key'):
        t=np.arange(round(dur*sr),dtype=np.float32)/sr
        f=440*2**((midi-69)/12)
        if kind=='bass':
            return (np.sin(2*np.pi*f*t)+.15*np.sin(4*np.pi*f*t))*np.exp(-t*4)*(1-np.exp(-t*60))
        if kind=='pad':
            env=np.minimum(t/.5,1)*np.minimum((dur-t)/.8,1)
            return (np.sin(2*np.pi*f*t)+.25*np.sin(2*np.pi*(f*1.002)*t))*env*.6
        env=(1-np.exp(-t*240))*np.exp(-t*4.8)*np.minimum((dur-t)/.07,1)
        return (np.sin(2*np.pi*f*t+1.1*np.sin(2*np.pi*f*2*t)*np.exp(-t*8))+.15*np.sin(2*np.pi*3*f*t))*env
    # Fmaj9, Am7, Cmaj9, G6. Seven repetitions, evolving gently.
    chords=[([53,57,60,64,67],41),([57,60,64,67,71],45),([48,55,59,62,64],36),([55,59,62,64,69],43)]
    for bar in range(28):
        start=bar*4*beat
        chord,bass=chords[bar%4]
        for j,m in enumerate(chord):
            add(music,start,note(m,4*beat+.6,'pad'),.044,(-.7+j*.35))
            add(music,start+j*.025,note(m+12,1.8),.065,(-.55+j*.25))
        for k in [0,2,3.5]:
            add(music,start+k*beat,note(bass,.7,'bass'),.17)
        pattern=[0,1.5,2.5,3.25] if bar%2==0 else [.5,1.75,2.5,3.5]
        for j,b in enumerate(pattern):
            m=chord[(bar+j*2)%5]+24
            tone=note(m,1.1)
            pan=(-.48 if j%2 else .48)
            add(music,start+b*beat,tone,.075,pan)
            add(music,start+b*beat+beat*.75,tone,.02,-pan)
        # The first four bars leave breathing room; drums enter under the idea.
        if 4<=bar<26:
            for b in [0,2]:
                t=np.arange(round(.24*sr))/sr
                kick=np.sin(2*np.pi*(47*t+1.4*(1-np.exp(-t*28))))*np.exp(-t*20)
                add(music,start+b*beat,kick,.15)
            for b in [1,3]:
                t=np.arange(round(.12*sr))/sr
                noise=rng.normal(0,1,len(t))
                snap=(noise-np.roll(noise,1))*np.exp(-t*55)
                add(music,start+b*beat,snap,.022,.1)
            for b in np.arange(.5,4,.5):
                t=np.arange(round(.055*sr))/sr
                noise=rng.normal(0,1,len(t))
                hat=(noise-np.roll(noise,1))*np.exp(-t*115)
                add(music,start+b*beat,hat,.006,-.25)
    # Soft, band-limited air swishes, aligned to chapter changes.
    for at in [5,10,16,23,30,36,42,49,55]:
        dur=.58
        t=np.arange(round(dur*sr))/sr
        noise=rng.normal(0,1,len(t))
        smooth=np.convolve(noise,np.ones(17)/17,mode='same')
        env=np.sin(np.pi*t/dur)**2
        add(fx,at-.18,smooth*env,.14,0)
    # Gentle interaction sounds: short pencil/key taps and positive resolutions.
    for at in [17.3,17.47,17.62,17.84,18.05,18.2,18.39,18.56,18.81,19.02,19.2]:
        t=np.arange(round(.05*sr))/sr
        tap=(rng.normal(0,1,len(t))*.3+np.sin(2*np.pi*680*t)) * np.exp(-t*120)
        add(fx,at,tap,.075,-.25)
    for at in [11.25,19.1,24.3,31.7,37.3,43.6,50.2,50.9,51.6]:
        add(fx,at,note(84,.23),.1,.2)
    for at in [26.5,27.7,39.9,46.7,55.55]:
        for i,m in enumerate([76,79,84]):
            add(fx,at+i*.075,note(m,.9),.11,(-.3+i*.3))
    # Resolve to the tonic rather than simply cutting a loop.
    for j,m in enumerate([53,60,65,69,72]):
        add(music,57.7+j*.035,note(m,2.3),.09,(-.5+j*.25))
    t=np.arange(n,dtype=np.float32)/sr
    fade=np.minimum(t/.7,1)*np.clip((60-t)/1.7,0,1)
    music*=fade[:,None]
    fx*=np.minimum(t/.1,1)[:,None]*np.clip((60-t)/.6,0,1)[:,None]
    def save(name,data):
        with wave.open(str(OUT/name),'wb') as wav:
            wav.setnchannels(2); wav.setsampwidth(2); wav.setframerate(sr)
            wav.writeframes((np.clip(data,-1,1)*32767).astype('<i2').tobytes())
    save('music-original.wav',music)
    save('sound-effects.wav',fx)
    save('mix.wav',music+fx)
    print('Original score + sound effects generated.',flush=True)


def storyboard(scenes):
    samples=[(0,2.4),(1,7.7),(2,13.5),(3,20.6),(4,28.4),(5,33.7),(6,40.4),(7,47.7),(8,52.8),(9,58.4)]
    grid=Image.new('RGB',(1440,5*438),'#dfe2ea')
    for i,(index,t) in enumerate(samples):
        frame=scenes[index].frame(t)
        frame.save(OUT/f'scene-{index+1:02}.jpg',quality=92)
        thumb=frame.resize((704,396),Image.Resampling.LANCZOS)
        x=8+(i%2)*720; y=8+(i//2)*438
        grid.paste(thumb,(x,y))
        d=ImageDraw.Draw(grid)
        d.text((x+6,y+403),f'{scenes[index].start:02}–{scenes[index].end:02}s',fill=INK,font=font(18,650))
    grid.save(OUT/'storyboard.jpg',quality=91)
    scenes[-1].frame(58.5).save(OUT/'poster.jpg',quality=95)
    print('Storyboard + poster generated.',flush=True)


def render(scenes):
    name='cowrite-explainer-reduced-motion.mp4' if REDUCED else 'cowrite-explainer.mp4'
    # Audio normalized to a predictable listening level with headroom.
    cmd=['ffmpeg','-hide_banner','-loglevel','warning','-y','-f','rawvideo','-vcodec','rawvideo',
         '-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-',
         '-i',str(OUT/'mix.wav'),'-c:v','libx264','-preset','fast','-crf','18',
         '-pix_fmt','yuv420p','-c:a','aac','-b:a','192k',
         '-af','loudnorm=I=-16:TP=-1.7:LRA=9','-ar','48000','-movflags','+faststart',
         '-metadata','title=CoWrite — From thought to done',
         '-metadata','comment=Original motion design, score and sound effects. Product examples are illustrative.',
         '-t',str(SECONDS),str(OUT/name)]
    proc=subprocess.Popen(cmd,stdin=subprocess.PIPE)
    index=0
    for frame in range(FPS*SECONDS):
        t=frame/FPS
        while index<len(scenes)-1 and t>=scenes[index].end:
            index+=1
        im=scenes[index].frame(t)
        # Six-frame branded cross-dissolve bridges each chapter without flashes.
        if index>0 and t<scenes[index].start+.2:
            previous=scenes[index-1].frame(scenes[index].start-1/FPS)
            im=Image.blend(previous,im,clamp((t-scenes[index].start)/.2))
        proc.stdin.write(im.tobytes())
        if frame%(FPS*5)==0:
            print(f'{name}: {t:.0f}/{SECONDS}s',flush=True)
    proc.stdin.close()
    if proc.wait():
        raise RuntimeError('ffmpeg failed')
    print(f'Exported {OUT/name}',flush=True)


if __name__=='__main__':
    p=argparse.ArgumentParser()
    p.add_argument('--stills',action='store_true')
    p.add_argument('--reduced-motion',action='store_true')
    args=p.parse_args()
    REDUCED=args.reduced_motion
    scenes=make_scenes()
    if not REDUCED:
        storyboard(scenes)
    if not args.stills:
        if not (OUT/'mix.wav').exists(): synth_audio()
        render(scenes)
