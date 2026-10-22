"""Rigid 3D portrait rigs for the private Jobot/Jax Agent Buddy add-ons.
Run with Blender --background --python this_file -- --character jax [--preview].
The model owns all head motion and blink geometry; no generated frame morphing.
"""
import bpy, math, sys, argparse, json, time
from pathlib import Path
from mathutils import Vector, Matrix
from math import sin, cos, pi
ROOT=Path(__file__).resolve().parents[1]
p=argparse.ArgumentParser();p.add_argument('--character',choices=['jax','jobot'],required=True);p.add_argument('--preview',action='store_true');p.add_argument('--samples',type=int,default=16);p.add_argument('--start',type=int,default=0);p.add_argument('--end',type=int,default=13)
a=p.parse_args(sys.argv[sys.argv.index('--')+1:])
OUT=ROOT/'characters'/a.character;OUT.mkdir(parents=True,exist_ok=True)
(OUT/'renders').mkdir(exist_ok=True);(OUT/'preview').mkdir(exist_ok=True)
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
M={}
def material(name,c,metal=0,rough=.3,emission=0):
 m=bpy.data.materials.new(name);m.diffuse_color=(*c,1);m.use_nodes=True;s=m.node_tree.nodes.get('Principled BSDF');s.inputs['Base Color'].default_value=(*c,1);s.inputs['Metallic'].default_value=metal;s.inputs['Roughness'].default_value=rough
 if emission:s.inputs['Emission Color'].default_value=(*c,1);s.inputs['Emission Strength'].default_value=emission
 M[name]=m;return m
material('ceramic',(.86,.91,.94),.18,.24);material('white',(.96,.97,1),.06,.29);material('cyan',(.008,.46,.65),.46,.22);material('dark',(.012,.021,.03),.35,.29);material('visor',(.005,.012,.019),.42,.18);material('silver',(.35,.46,.51),.75,.23);material('blue',(.005,.68,.95),.35,.16,.6);material('amber',(1,.40,.012),.35,.16,.6);material('nose',(.006,.011,.016),.18,.14);material('glint',(.8,.97,1),.05,.1,.45);material('mouth',(.005,.004,.007),0,.55)
def empty(n,loc=(0,0,0),parent=None):
 o=bpy.data.objects.new(n,None);bpy.context.collection.objects.link(o);o.location=loc
 if parent:o.parent=parent
 return o
def reg(o,n,m,parent=None):
 o.name=n;o.data.materials.append(M[m])
 if parent:o.parent=parent
 return o
def smooth(o):
 for f in o.data.polygons:f.use_smooth=True
 return o
def bevel(o,w):
 mod=o.modifiers.new('Soft manufactured edges','BEVEL');mod.width=w;mod.segments=5
 bpy.context.view_layer.objects.active=o;bpy.ops.object.modifier_apply(modifier=mod.name)
 mod=o.modifiers.new('Surface normals','WEIGHTED_NORMAL');bpy.ops.object.modifier_apply(modifier=mod.name)
 return o
def box(n,loc,size,m,parent=None,r=.08):
 bpy.ops.mesh.primitive_cube_add(size=1,location=loc);o=bpy.context.object;o.scale=size;bpy.ops.object.transform_apply(location=False,rotation=False,scale=True);bevel(o,r);return reg(o,n,m,parent)
def sphere(n,loc,size,m,parent=None):
 bpy.ops.mesh.primitive_uv_sphere_add(segments=40,ring_count=24,location=loc);o=bpy.context.object;o.scale=size;return reg(smooth(o),n,m,parent)
def cyl(n,loc,r,d,m,parent=None,axis='Z'):
 bpy.ops.mesh.primitive_cylinder_add(vertices=48,radius=r,depth=d,location=loc,rotation={'Z':(0,0,0),'Y':(pi/2,0,0),'X':(0,pi/2,0)}[axis]);o=bpy.context.object;bevel(o,min(.025,d*.22));return reg(smooth(o),n,m,parent)
def tube(n,points,r,m,parent=None):
 cu=bpy.data.curves.new(n,'CURVE');cu.dimensions='3D';cu.resolution_u=12;cu.bevel_depth=r;cu.bevel_resolution=4;s=cu.splines.new('BEZIER');s.bezier_points.add(len(points)-1)
 for pt,co in zip(s.bezier_points,points):pt.co=co;pt.handle_left_type='AUTO';pt.handle_right_type='AUTO'
 o=bpy.data.objects.new(n,cu);bpy.context.collection.objects.link(o);return reg(o,n,m,parent)
def prism(n,xz,y,d,m,parent=None,r=.04):
 N=len(xz);v=[(x,y-d/2,z) for x,z in xz]+[(x,y+d/2,z) for x,z in xz];f=[tuple(range(N-1,-1,-1)),tuple(range(N,2*N))]+[(i,(i+1)%N,(i+1)%N+N,i+N) for i in range(N)]
 me=bpy.data.meshes.new(n);me.from_pydata(v,[],f);me.update();o=bpy.data.objects.new(n,me);bpy.context.collection.objects.link(o);bevel(o,r);return reg(smooth(o),n,m,parent)
root=empty('Portrait');body=empty('Shoulders',parent=root);head=empty('Head',(0,0,1.28),root)
eyes=[];happy=[];closed=[];mouth=None;jaw=None
if a.character=='jobot':
 box('Chest',(0,.07,.42),(1.65,.65,.62),'cyan',body,.09)
 for x in [-.54,-.18,.18,.54]:box('Chest recessed panel',(x,-.271,.46),(.31,.018,.38),'cyan',body,.025)
 box('Chest upper rim',(0,-.01,.77),(1.68,.69,.10),'cyan',body,.04)
 for x in [-.98,.98]:sphere('White shoulder',(x,.04,.48),(.24,.29,.29),'white',body)
 cyl('Neck socket',(0,0,.91),.19,.18,'silver',body)
 box('Articulated neck',(0,0,-.20),(.23,.29,.49),'cyan',head,.04)
 cyl('Neck pivot',(0,-.17,-.20),.11,.055,'silver',head,'Y')
 box('Rounded cyan head',(0,0,.29),(1.97,.39,1.03),'cyan',head,.19)
 box('Inset dark gasket',(0,-.207,.29),(1.74,.035,.81),'dark',head,.12)
 box('White inset face',(0,-.231,.29),(1.69,.036,.76),'white',head,.11)
 for x in [-1.02,1.02]:sphere('Rounded side nub',(x,.015,.29),(.13,.15,.19),'cyan',head)
 cyl('Antenna stalk',(0,.015,1.00),.063,.43,'cyan',head)
 sphere('Antenna ball',(0,.015,1.24),(.15,.15,.15),'cyan',head)
 for x in [-.38,.38]:
  eye=empty('Eye',(x,-.264,.30),head);sphere('Cyan lens',(0,0,0),(.155,.027,.155),'cyan',eye);eyes.append(eye)
  pts=[(x+.145*t,-.281,.30+.085*(1-t*t)) for t in [-1,-.66,-.33,0,.33,.66,1]]
  happy.append(tube('Happy eye',pts,.027,'cyan',head))
  pts=[(x+.145*t,-.281,.30-.035*(1-t*t)) for t in [-1,-.66,-.33,0,.33,.66,1]]
  closed.append(tube('Closed eye',pts,.018,'cyan',head))
else:
 sphere('White chest',(0,.12,.47),(.76,.46,.51),'ceramic',body)
 sphere('Chest plate',(0,-.28,.42),(.51,.18,.37),'white',body)
 for x in [-.69,.69]:sphere('Shoulder ceramic',(x,.08,.40),(.21,.31,.32),'ceramic',body)
 for z,r in [(.82,.39),(.91,.39),(1.0,.37)]:cyl('Collar ring',(0,.01,z),r,.075,'dark',body)
 # Rounded canine cross-sections with a true projecting snout.
 sections=[(1.12,.05,.10,.06),(1.10,.31,.08,.23),(1.00,.58,.06,.36),(.84,.70,.035,.43),(.59,.91,.01,.47),(.36,.84,-.07,.55),(.11,.67,-.18,.61),(-.08,.44,-.25,.60),(-.20,.19,-.21,.40),(-.22,.03,-.16,.19)]
 v=[];f=[];N=64
 for z,w,cy,depth in sections:
  for i in range(N):t=2*pi*i/N;v.append((w*cos(t),cy+depth*sin(t),z))
 for j in range(len(sections)-1):
  for i in range(N):u=j*N+i;vn=j*N+(i+1)%N;f.append((u,vn,vn+N,u+N))
 f.extend([tuple(range(N-1,-1,-1)),tuple((len(sections)-1)*N+i for i in range(N))])
 me=bpy.data.meshes.new('Sculpted muzzle');me.from_pydata(v,[],f);me.update();o=bpy.data.objects.new('White husky shell',me);bpy.context.collection.objects.link(o);reg(smooth(o),o.name,'white',head);sub=o.modifiers.new('Rounded canine face','SUBSURF');sub.levels=2;sub.render_levels=2
 def front(x,z):
  for j in range(len(sections)-1):
   z1,w1,y1,d1=sections[j];z2,w2,y2,d2=sections[j+1]
   if z>=z2:
    t=max(0,min(1,(z1-z)/(z1-z2)));w=w1+(w2-w1)*t;cy=y1+(y2-y1)*t;d=d1+(d2-d1)*t
    return cy-d*math.sqrt(max(.05,1-(x/w)**2))
  return -.68
 # A rounded connected visor, sampled on the curved face.
 # Smooth radially sampled visor follows the curved ceramic shell.
 vv=[(0,front(0,.64)-.025,.64)];ff=[];N=96;R=16
 for j in range(1,R+1):
  r=j/R
  for k in range(N):
   t=2*pi*k/N;x=r*.65*cos(t);z=.64+r*.23*sin(t)*(.66+.65*abs(cos(t)))
   vv.append((x,front(x,z)-.025,z))
 for k in range(N):ff.append((0,1+k,1+(k+1)%N))
 for j in range(R-1):
  for k in range(N):
   q=1+j*N+k;qn=1+j*N+(k+1)%N;ff.append((q,q+N,qn+N,qn))
 me=bpy.data.meshes.new('Smooth visor');me.from_pydata(vv,[],ff);me.update();vis=bpy.data.objects.new('Continuous dark visor',me);bpy.context.collection.objects.link(vis);reg(smooth(vis),vis.name,'visor',head)
 for s in [-1,1]:
  prism('White husky ear',[(s*.44,.95),(s*.57,1.12),(s*.86,1.47),(s*.98,1.54),(s*.96,1.33),(s*.77,.87)],.10,.18,'white',head,.055)
  prism('Dark ear inset',[(s*.59,1.08),(s*.87,1.41),(s*.88,1.27),(s*.75,.99)],-.007,.016,'dark',head,.022)
 for x,color in [(-.39,'amber'),(.39,'blue')]:
  yy=front(x,.64)-.043;eye=empty('Eye',(x,yy,.64),head)
  sphere('Glowing glass lens',(0,0,0),(.15,.046,.15),color,eye)
  cyl('Lens rim',(0,.014,0),.164,.024,'dark',eye,'Y')
  sphere('Lens depth',(0,-.040,0),(.111,.014,.111),'visor',eye)
  bpy.ops.mesh.primitive_torus_add(major_radius=.130,minor_radius=.014,major_segments=48,minor_segments=12,location=(0,-.044,0),rotation=(pi/2,0,0));reg(smooth(bpy.context.object),'Luminous eye ring',color,eye)
  sphere('Lens reflection',(-.048,-.049,.066),(.028,.007,.023),'glint',eye)
  eyes.append(eye)
  happy.append(tube('Happy eye',[(x+.14*t,yy-.024,.64+.08*(1-t*t)) for t in [-1,-.66,-.33,0,.33,.66,1]],.023,color,head))
  closed.append(tube('Closed eye',[(x+.14*t,yy-.024,.64-.03*(1-t*t)) for t in [-1,-.66,-.33,0,.33,.66,1]],.013,color,head))
 sphere('Black canine nose',(0,-.805,.13),(.125,.077,.167),'nose',head)
 for x in [-.04,.04]:sphere('Nostril',(x,-.866,.15),(.021,.009,.031),'dark',head)
 mouth=tube('Gentle smile seam',[(-.43,-.64,-.035),(-.24,-.775,-.13),(0,-.82,-.17),(.24,-.775,-.13),(.43,-.64,-.035)],.010,'dark',head)
 jaw=sphere('Happy mouth opening',(0,-.813,-.12),(.25,.016,.065),'mouth',head);jaw.hide_render=True

scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=a.samples;scene.cycles.use_denoising=True;scene.cycles.device='CPU';scene.cycles.seed=17
scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(0,0,0,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=0
for name,loc,power,color,size in [('Key',(-3,-4,5),500,(1,.91,.83),4),('Fill',(3,-2,3),350,(.70,.89,1),3),('Rim',(1,2,4),650,(.55,.84,1),3),('Softbox',(-3,1,3),400,(1,.7,.4),2)]:
 bpy.ops.object.light_add(type='AREA',location=loc);o=bpy.context.object;o.name=name;o.data.energy=power;o.data.color=color;o.data.shape='DISK';o.data.size=size;o.rotation_euler=(Vector((0,0,1.4))-o.location).to_track_quat('-Z','Y').to_euler()
bpy.ops.object.camera_add(location=(0,-9,1.60));camera=bpy.context.object;camera.rotation_euler=(Vector((0,0,1.47))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.65;scene.camera=camera
if a.character=='jax':
 camera.location.z=1.82;camera.rotation_euler=(Vector((0,0,1.69))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=3.2
scene.render.resolution_x=412;scene.render.resolution_y=352;scene.render.resolution_percentage=100;scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGB';scene.render.film_transparent=False;scene.view_settings.view_transform='AgX';scene.render.threads_mode='FIXED';scene.render.threads=6
tracks=['right','left','up','down','up_right','up_left','down_right','down_left','surprise','working','complete','attention','attention_alternate']
counts=[24,24,12,12]+[24]*9
origin=head.location.copy()
def pose(track,i,n,blink):
 t=i/(n-1);yaw=pitch=roll=bob=joy=0;eye_scale=[1,1]
 if track<8:
  yaw=([1,-1,0,0,1,-1,1,-1][track])*math.radians(33)*t
  pitch=([0,0,-1,1,-1,-1,1,1][track])*math.radians(17)*t
 elif track==8:
  amt=sin(pi*t)**2;pitch=-.08*amt;bob=.045*amt;eye_scale=[1+.10*amt]*2
 elif track==9:
  # Posed track: concentrated gentle nod, with animation supplied by native engine.
  pitch=.13*t;yaw=.10*t;roll=-.035*t;bob=.025*t
 elif track==10:
  roll=-.12*t;joy=t;bob=.08*t
 elif track in [11,12]:
  sign=1 if track==11 else -1;roll=sign*.24*t;yaw=-sign*.12*t;eye_scale=[1-.15*t,1+.05*t] if sign==1 else [1+.05*t,1-.15*t]
 # Turn from the torso: the neck leads while the shoulders follow the same gesture.
 root.rotation_euler=(pitch*.20,roll*.25,yaw*.38)
 root.location=(0,0,bob*.30)
 head.rotation_euler=(pitch*.80,roll*.75,yaw*.62)
 head.location=origin+Vector((0,-.025*sin(pi*t/2),bob*.70))
 openness=[1,.75,.5,.25,0][blink]
 for k,eye in enumerate(eyes):
  visible=max(0.001,openness*(1-joy));eye.scale=(eye_scale[k],1,visible*eye_scale[k]);eye.hide_render=visible<.015
  for child in eye.children:child.hide_render=visible<.015
  happy[k].hide_render=joy<.08 or openness<.05
  happy[k].scale=(1,1,1)
  # Arcs gradually emerge as the round eye closes during Complete.
  happy[k].data.bevel_depth=(.027 if a.character=='jobot' else .023)*joy*openness if joy else .001
  closed[k].hide_render=blink!=4
 if jaw:jaw.hide_render=joy<.01;jaw.scale.z=.065*max(.001,joy)
 # Identical reset for every track's neutral frame and Surprise endpoint.
 if i==0 or (track==8 and i==n-1):
  root.rotation_euler=(0,0,0);root.location=(0,0,0)
  head.rotation_euler=(0,0,0);head.location=origin
  for k,eye in enumerate(eyes):
   eye.scale=(1,1,max(.001,openness));eye.hide_render=blink==4
   for child in eye.children:child.hide_render=blink==4
   happy[k].hide_render=True;closed[k].hide_render=blink!=4
  if jaw:jaw.hide_render=True

def render(path):
 scene.render.filepath=str(path);bpy.ops.render.render(write_still=True)
 if path.parent.name=='renders' and path.stem.endswith('-0'):
  from bpy_extras.object_utils import world_to_camera_view
  bpy.context.view_layer.update()
  regions=[]
  # Restrict blink replacement to the eye regions. Fixed shoulders/face stay
  # identical to the open render instead of inheriting denoiser noise.
  for eye in eyes:
   center=eye.location;pts=[]
   for dx in [-.21,.21]:
    for dy in [-.07,.07]:
     for dz in [-.21,.21]:
      q=world_to_camera_view(scene,camera,head.matrix_world @ (center+Vector((dx,dy,dz))))
      pts.append((q.x*412,(1-q.y)*352))
   x=max(0,math.floor(min(q[0] for q in pts))-3);y=max(0,math.floor(min(q[1] for q in pts))-3)
   x2=min(412,math.ceil(max(q[0] for q in pts))+3);y2=min(352,math.ceil(max(q[1] for q in pts))+3)
   regions.append([x,y,x2,y2])
  path.with_suffix('.json').write_text(json.dumps(regions))
if a.preview:
 for name,tr,i,blink in [('idle',0,0,0),('right',0,23,0),('complete',10,23,0),('attention',11,23,0),('sleep',0,0,4)]:
  pose(tr,i,counts[tr],blink);render(OUT/'preview'/f'{name}.png')
else:
 start=time.time()
 for tr in range(a.start,a.end):
  for i in range(counts[tr]):
   for b in range(5):
    dest=OUT/'renders'/f'{tr:02d}-{i:02d}-{b}.png'
    if dest.exists():continue
    # Neutral has identical geometry/lighting; copy it rather than rerender.
    if (i==0 or (tr==8 and i==23)) and (OUT/'renders'/f'00-00-{b}.png').exists():
     import shutil;shutil.copy2(OUT/'renders'/f'00-00-{b}.png',dest)
     if b==0:shutil.copy2(OUT/'renders'/'00-00-0.json',dest.with_suffix('.json'))
     continue
    pose(tr,i,counts[tr],b);render(dest)
  print('TRACK_DONE',a.character,tracks[tr],round(time.time()-start,1),flush=True)
if a.preview or a.end==13:
 pose(0,0,24,0);bpy.ops.wm.save_as_mainfile(filepath=str(OUT/f'{a.character}.blend'))
 (OUT/'rig.json').write_text(json.dumps({'tracks':tracks,'trackSteps':counts,'width':412,'height':352,'blinkLevels':[1,.75,.5,.25,0],'renderer':'Blender Cycles','samples':a.samples},indent=2))
