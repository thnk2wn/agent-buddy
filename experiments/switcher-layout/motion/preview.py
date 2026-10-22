"""Generate a 22-second native-engine preview through the shipping compact compositor."""
from pathlib import Path
import subprocess,sys,tempfile,os
repo=Path(__file__).resolve().parents[3]
pack=Path(sys.argv[1]).resolve();output=Path(sys.argv[2]).resolve()
output.parent.mkdir(parents=True,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='buddy-motion-preview-',dir=Path.home()/'temp') as folder:
 work=Path(folder);(work/'build/characters').mkdir(parents=True)
 (work/'build/characters'/pack.name).symlink_to(pack)
 character=pack.stem
 commands=[]
 for frame in range(660):
  mode={0:0,120:2,240:4,360:3,450:5,570:0}.get(frame,-1)
  commands.append(f'{1/30} {mode} 1 {character} {0 if frame==0 else -1}|\n')
 source=work/'commands.txt';source.write_text(''.join(commands))
 with source.open('rb') as command_input:
  native=subprocess.Popen([str(repo/'build/caption-lab')],cwd=work,stdin=command_input,stdout=subprocess.PIPE,env={**os.environ,"AGENT_COMPANION_COMPACT_PREVIEW":"1"})
  compact=subprocess.Popen([str(repo/'build/compact-stream')],stdin=native.stdout,stdout=subprocess.PIPE)
  native.stdout.close()
  ffmpeg=subprocess.run(['ffmpeg','-hide_banner','-loglevel','error','-y','-f','rawvideo','-pixel_format','rgb24','-video_size','466x466','-framerate','30','-i','pipe:0','-c:v','libx264','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],stdin=compact.stdout)
  compact.stdout.close()
  codes=[native.wait(),compact.wait(),ffmpeg.returncode]
  if any(codes):raise RuntimeError(f'Preview failed: {codes}')
print(output)
