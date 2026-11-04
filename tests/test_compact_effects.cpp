#include "../firmware/AgentCompanion/src/CharacterEffects.h"
#include "../firmware/AgentCompanion/src/CompactRenderer.h"
#include <algorithm>
#include <cassert>
#include <iostream>
#include <vector>
using namespace copilot;
int main() {
 constexpr size_t size=412*466;
 std::vector<uint16_t> first(size+2,0),second(size+2,0),out(size+2,0),plain(size);
 first.front()=first.back()=second.front()=second.back()=out.front()=out.back()=0xabcd;
 // Opaque art must survive both the effects and the subsequent restoration.
 for(int y=160;y<300;++y)for(int x=135;x<270;++x)first[1+y*412+x]=second[1+y*412+x]=0x2456;
 const auto original=first;
 AgentBadges badges;assert(badges.setUsagePacket("Legacy text"));
 CharacterEffects effects(first.data()+1,second.data()+1,&badges);
 CompactCaption caption;
 assert(parseCompactCaption("Claude|idle|1|4|demo|A title that stays readable|1|1:claude:i,2:codex:w,3:claude:i,4:claude:a",caption));
 CompactRenderer compositor;
 for(const auto mode:{CharacterMode::Attention,CharacterMode::Complete,CharacterMode::Sleep,CharacterMode::Surprise}) {
  unsigned animated=0;
  for(unsigned n=0;n<90;++n) {
   auto* source=n%2 ? first.data()+1 : second.data()+1;
   assert(effects.restore(source));
   assert(std::equal(original.begin()+1,original.end()-1,source));
   CompactRenderer clean;clean.render(source,plain.data(),caption,n*33);
   CharacterState state{{0,0,0},mode,mode,n/30.f,42};
   assert(effects.render(state,source,true));
   compositor.render(source,out.data()+1,caption,n*33);
   unsigned pixels=0;
   for(int y=0;y<466;++y)for(int x=0;x<412;++x) {
    const auto i=y*412+x;
    if(y<66 || y>=276)assert(out[1+i]==plain[i]);
    else pixels+=out[1+i]!=plain[i];
   }
   animated+=pixels>0;
   // Every fixed target keeps the exact same pixels and touch geometry.
   for(unsigned slot=0;slot<4;++slot) {
    const int cx=compactTargetX(slot)-27,cy=compactTargetY(slot);
    for(int y=cy-28;y<cy+28;++y)for(int x=cx-28;x<cx+28;++x)assert(out[1+y*412+x]==plain[y*412+x]);
   }
   assert(effects.restore(source));
   assert(std::equal(original.begin()+1,original.end()-1,source));
  }
  assert(animated>2);
 }
 // Working has one compositor-owned trail; legacy text/badges never leak into compact mode.
 assert(effects.render({{0,0,0},CharacterMode::Working,CharacterMode::Working,1.f,43},first.data()+1,true));
 assert(first==original);
 assert(first.front()==0xabcd && first.back()==0xabcd && second.front()==0xabcd && second.back()==0xabcd && out.front()==0xabcd && out.back()==0xabcd);
 std::cout<<"PASS compact effects: visible animations, protected text/targets, both buffers restored, no duplicate working effects\n";
}
