#include "../../../firmware/AgentCompanion/src/CompactRenderer.h"
#include <iostream>
#include <cstdlib>
#include <sstream>
#include <string>
#include <vector>
int main() {
  std::vector<uint16_t> source(412*466),out(source.size());
  std::vector<char> rgb(466*466*3);
  copilot::CompactRenderer renderer; copilot::CompactCaption caption;
  copilot::parseCompactCaption("Claude|idle|1|3|kitchen-frame|Project roadmap and next steps",caption);
  const char* states[]={"idle","surprise","working","complete","attention","sleep"};
  unsigned frame=0;
  for(std::string line;std::getline(std::cin,line);++frame) {
    std::istringstream header(line);std::string ok;unsigned bytes,direction,index,blink,mode;
    if(!(header>>ok>>bytes>>direction>>index>>blink>>mode)||ok!="OK"||bytes!=source.size()*2||mode>5)return 2;
    std::cin.read(reinterpret_cast<char*>(source.data()),bytes);if(!std::cin)return 3;
    if(std::getenv("AGENT_COMPANION_PREVIEW_TAP") && frame==45)renderer.acknowledgeTap(frame*1000/30);
    std::strcpy(caption.state,states[mode]);renderer.render(source.data(),out.data(),caption,frame*1000/30);
    for(int y=0;y<466;++y)for(int x=0;x<466;++x) {
      auto v=x>=27&&x<439?copilot::swapBytes(out[y*412+x-27]):0;const int p=(y*466+x)*3;
      rgb[p]=char(((v>>11)&31)*255/31);rgb[p+1]=char(((v>>5)&63)*255/63);rgb[p+2]=char((v&31)*255/31);
    }
    std::cout.write(rgb.data(),rgb.size());if(!std::cout)return 4;
  }
}
