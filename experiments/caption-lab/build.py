"""Build the lab against the same firmware sources used by the device."""
from pathlib import Path
import subprocess
r=Path(__file__).resolve().parents[2];s=r/'firmware/AgentCompanion/src'
(r/'build').mkdir(exist_ok=True)
files=['CharacterMotion','CharacterFrame','FullFrameRenderer','CharacterPack','AgentBadges','CharacterEffects','SpriteMotion','SpriteRenderer','SpriteStorage']
subprocess.run(['clang++','-std=c++17','-O2','-Wall','-Wextra','-Werror','-I'+str(s),'-I'+str(r/'tools'),str(r/'experiments/caption-lab/native_preview.cpp'),*[str(s/(f+'.cpp')) for f in files],'-lz','-o',str(r/'build/caption-lab')],check=True)
