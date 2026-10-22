#!/usr/bin/env python3
"""Export the independent Blender portrait rigs to verified Agent Buddy packs."""
from pathlib import Path
import argparse, hashlib, json, sys, zlib
import numpy as np
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'vendor'))
import character_pack as pack
import sprite_codec
TRACKS=['right','left','up','down','up_right','up_left','down_right','down_left','surprise','working','complete','attention','attention_alternate']
COUNTS=[24,24,12,12]+[24]*9

def sha(data):return hashlib.sha256(data).hexdigest()
def rgb565(rgb,green_bits=5):
 p=np.asarray(rgb,dtype=np.uint16)
 return (((p[:,:,0]>>4)<<1)<<11)|(((p[:,:,1]>>(8-green_bits))<<(6-green_bits))<<5)|((p[:,:,2]>>4)<<1)
def image565(p):
 q=p.astype(np.uint32)
 return Image.fromarray(np.stack([((q>>11)&31)*255//31,((q>>5)&63)*255//63,(q&31)*255//31],axis=-1).astype('uint8'))
def source_pose(character,t,i):
 # Every animation step has a distinct 3D pose; no temporal frame deduplication.
 return i

def levels(folder,t,i):
 i=source_pose(folder.parent.name,t,i)
 stem=f'{t:02d}-{i:02d}'
 base=np.array(Image.open(folder/f'{stem}-0.png').convert('RGB'))
 regions=json.loads((folder/f'{stem}-0.json').read_text())
 green_bits=4 if folder.parent.name=="jax" else 5
 out=[rgb565(base,green_bits)]
 for b in range(1,5):
  blink=np.array(Image.open(folder/f'{stem}-{b}.png').convert('RGB'))
  # Reuse the exact open face outside eye regions: denoiser variation must not
  # make the shell/chest flicker on every blink or inflate the firmware buffers.
  composed=base.copy()
  for x,y,x2,y2 in regions:composed[y:y2,x:x2]=blink[y:y2,x:x2]
  out.append(rgb565(composed,green_bits))
 return out

def bounds(mask):
 y,x=np.nonzero(mask)
 if not len(x):return [0,0,0,0]
 x1,y1,x2,y2=int(x.min()),int(y.min()),int(x.max())+1,int(y.max())+1
 return [x1,y1,x2-x1,y2-y1]
def crop(p,b):
 x,y,w,h=b;return p[y:y+h,x:x+w]
class Store:
 def __init__(self):self.data=bytearray();self.blocks={};self.references=0
 def add(self,p):
  self.references+=1
  if not p.size:return {'offset':0,'size':0}
  raw=p.astype('>u2').tobytes();key=(p.shape,sha(raw))
  if key in self.blocks:return self.blocks[key]
  residual=p.astype(np.uint16).copy();residual[1:]=p[1:]-p[:-1]
  compressed=zlib.compress(residual.astype('>u2').tobytes(),9)
  # Verify with the upstream decoder, not an inverse of our own exporter.
  assert sprite_codec.decode_pixels(compressed,p.shape[1])==raw
  block={'offset':len(self.data),'size':len(compressed)}
  self.data.extend(compressed);self.blocks[key]=block;return block

def build(character,estimate=False):
 folder=ROOT/'characters'/character
 decoded=[];occupied=np.zeros((352,412),bool)
 track_count=1 if estimate else 13
 for t in range(track_count):
  for i in range(COUNTS[t]):
   ll=levels(folder/'renders',t,i);decoded.append((t,i,ll))
   for p in ll:occupied|=p!=0
 base_bounds=bounds(occupied);store=Store();records=[];patchmax=0
 neutral=decoded[0][2]
 for t,i,ll in decoded:
  if i==0 or (t==8 and i==23):
   assert all(np.array_equal(x,y) for x,y in zip(ll,neutral)),f'Neutral discontinuity: {t}/{i}'
  base,*blinks=ll
  pb=bounds(np.logical_or.reduce([b!=base for b in blinks]));patchmax=max(patchmax,pb[2]*pb[3])
  rec={'direction':TRACKS[t],'step':i,'base':store.add(crop(base,base_bounds)),
       'patchX':pb[0],'patchY':pb[1],'patchWidth':pb[2],'patchHeight':pb[3],
       'blinks':[store.add(crop(b,pb)) for b in blinks]}
  records.append(rec)
  # Reconstruct every final frame, including patch placement, byte for byte.
  bb=rec['base'];raw=sprite_codec.decode_pixels(store.data[bb['offset']:bb['offset']+bb['size']],base_bounds[2])
  canvas=np.zeros((352,412),dtype=np.uint16);x,y,w,h=base_bounds
  canvas[y:y+h,x:x+w]=np.frombuffer(raw,dtype='>u2').reshape(h,w)
  assert np.array_equal(canvas,base)
  for b,ref in zip(blinks,rec['blinks']):
   restored=canvas.copy();x,y,w,h=pb
   if w:
    raw=sprite_codec.decode_pixels(store.data[ref['offset']:ref['offset']+ref['size']],w)
    restored[y:y+h,x:x+w]=np.frombuffer(raw,dtype='>u2').reshape(h,w)
   assert np.array_equal(restored,b),f'Round trip: {t}/{i}'
 if estimate:
  print(json.dumps({'character':character,'firstTrackBytes':len(store.data),'roughFullBytes':len(store.data)*12,'maxPatchPixels':patchmax,'bounds':base_bounds}));return
 metadata={'layout':'base-patch','encoding':'zlib-rgb565-word-up-be','width':412,'height':352,'baseBounds':base_bounds,
 'steps':24,'directions':TRACKS,'trackSteps':COUNTS,'trackOffsets':pack.track_offsets(COUNTS),'frameCount':288,
 'blinkLevels':[1,.75,.5,.25,0],'maxPatchPixels':patchmax,'maxPatchBytes':patchmax*2,
 'sourcePoseMap':[[source_pose(character,t,i) for i in range(n)] for t,n in enumerate(COUNTS)],
 'dataBytes':len(store.data),'dataSha256':sha(store.data),'uniqueBlocks':len(store.blocks),'blockReferences':store.references,'frames':records}
 (folder/'frames.bin').write_bytes(store.data);(folder/'frames.json').write_text(json.dumps(metadata,indent=2)+'\n')
 (folder/'character.json').write_text(json.dumps({'id':character,'name':'Jax' if character=='jax' else 'Jobot','layout':'base-patch','frames':'frames.bin','metadata':'frames.json','motionSpeed':.95},indent=2)+'\n')
 output=ROOT/'build'/'characters';output.mkdir(parents=True,exist_ok=True)
 data=pack.build_character(ROOT,folder);info=pack.decode(data,pack.read_assets_partition(ROOT)['size'])
 (output/f'{character}.acpk').write_bytes(data)
 for label,t,i,b in [('idle',0,0,0),('right',0,23,0),('complete',10,23,0),('attention',11,23,0),('sleep',0,0,4)]:
  image565(levels(folder/'renders',t,i)[b]).save(folder/'preview'/f'{label}.png')
 report={**info,'fileSha256':sha(data),'maxPatchPixels':patchmax,'requiresAdaptivePatchRAM':patchmax>7452,'roundTripFrames':1440,'sourcePosesUsed':sum(len(set(source_pose(character,t,i) for i in range(n))) for t,n in enumerate(COUNTS)),'neutralTrackChecks':14,'uniqueDecodedBlocks':len(store.blocks),'partitionBytes':pack.read_assets_partition(ROOT)['size'],'upstreamDecoder':'vendor/sprite_codec.py'}
 (folder/'validation.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2),flush=True)

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('character',choices=['jax','jobot']);p.add_argument('--estimate',action='store_true');a=p.parse_args();build(a.character,a.estimate)
