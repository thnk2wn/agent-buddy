"""Rasterize DejaVu Sans for the compact firmware; retain CompactFont-LICENSE.txt."""
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont
font_path, output = sys.argv[1:]
chunks=['// Generated from DejaVu Sans; see CompactFont-LICENSE.txt.\n#pragma once\n#include <cstdint>\nnamespace compactfont {\nstruct Glyph {uint32_t offset;uint16_t width,height,advance;};\n']
for size in [18,20,32]:
 font=ImageFont.truetype(font_path,size)
 glyphs=[];data=[]
 for code in range(32,127):
  ch=chr(code);advance=round(font.getlength(ch));w=max(1,advance+2);h=size+8
  im=Image.new('L',(w,h));ImageDraw.Draw(im).text((0,-2),ch,font=font,fill=255)
  glyphs.append((len(data),w,h,advance));data.extend(im.tobytes())
 chunks.append(f'constexpr uint8_t pixels{size}[]={{'+','.join(map(str,data))+'};\n')
 chunks.append(f'constexpr Glyph glyphs{size}[]={{'+','.join('{'+','.join(map(str,g))+'}' for g in glyphs)+'};\n')
chunks.append('}\n');Path(output).write_text(''.join(chunks))
print(f'{len(data)} raster bytes in largest font; output {output}')
