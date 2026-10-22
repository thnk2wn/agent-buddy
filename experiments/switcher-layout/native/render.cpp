#include "../../../firmware/AgentCompanion/src/CompactRenderer.h"
#include <fstream>
#include <cstdlib>
#include <iostream>
#include <vector>
int main(int argc,char** argv){
 if(argc!=8)return 2;
 std::vector<uint16_t> source(412*466),out(source.size());
 std::ifstream input(argv[1],std::ios::binary);input.read(reinterpret_cast<char*>(source.data()),source.size()*2);if(!input)return 3;
 copilot::CompactCaption caption;
 std::string packet=std::string(argv[3])+"|"+argv[4]+"|2|4|"+argv[6]+"|"+argv[5];
 if(std::getenv("AGENT_COMPANION_PREVIEW_INDICATORS"))packet+="|1|1:claude:i,2:claude:w,3:codex:w,4:claude:a";
 if(!copilot::parseCompactCaption(packet.c_str(),caption))return 4;
 copilot::CompactRenderer renderer;renderer.render(source.data(),out.data(),caption,0);
 renderer.render(source.data(),out.data(),caption,std::stoul(argv[7])*6500);
 std::ofstream output(argv[2],std::ios::binary);output<<"P6\n466 466\n255\n";
 for(int y=0;y<466;++y)for(int x=0;x<466;++x){
  auto v=(x>=27&&x<439)?copilot::swapBytes(out[y*412+x-27]):0;
  const char rgb[]={char(((v>>11)&31)*255/31),char(((v>>5)&63)*255/63),char((v&31)*255/31)};output.write(rgb,3);
 }
 std::cout<<renderer.pages()<<" title pages\n";
}
