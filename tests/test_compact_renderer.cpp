#include "../firmware/AgentCompanion/src/CompactRenderer.h"
#include <cassert>
#include <vector>
#include <string>
#include <iostream>
int main(){
 using namespace copilot;
 CompactCaption c;
 assert(parseCompactCaption("Claude|idle|2|4|jax-api|Jobot tracker priority candidates",c));
 const auto original=c;
 for(const char* bad:{"Claude","Claude|idle|0|4|p|t","Claude|idle|5|4|p|t","Claude|evil|1|4|p|t","Claude|idle|1|4|p|t|extra","Claude|idle|1|4|p|"}) {
   assert(!parseCompactCaption(bad,c));assert(!std::memcmp(&c,&original,sizeof(c)));
 }
 std::vector<uint16_t> source(412*466,swapBytes(rgb565(200,100,50))),out(source.size()+2,0xabba);
 const auto saved=source; CompactRenderer renderer;
 renderer.render(source.data(),out.data()+1,c,0);
 assert(out.front()==0xabba && out.back()==0xabba && source==saved && renderer.pages()==1);
 auto first=out;
 renderer.render(source.data(),out.data()+1,c,7000);assert(out==first);
 std::string packet="Codex|working|1|4|game|"+std::string(256,'W');
 assert(parseCompactCaption(packet.c_str(),c));renderer.render(source.data(),out.data()+1,c,8000);
 assert(renderer.pages()>1);first=out;
 renderer.render(source.data(),out.data()+1,c,15000);assert(out!=first);const auto secondPage=out;
 // Alternating an idle phrase in the project line must not restart title paging.
 std::strcpy(c.project,"Ready when you are");renderer.render(source.data(),out.data()+1,c,15000);
 for(int y=276;y<381;++y)for(int x=0;x<412;++x)assert(out[1+y*412+x]==secondPage[1+y*412+x]);
 std::strcpy(c.project,"game");renderer.render(source.data(),out.data()+1,c,15000);
 auto unchangedPage=out;renderer.render(source.data(),out.data()+1,c,15000);assert(out==unchangedPage);
 // New session resets the page; the source/cache and surrounding memory remain unchanged.
 c.index=3;renderer.render(source.data(),out.data()+1,c,16000);first=out;
 renderer.render(source.data(),out.data()+1,c,16000);assert(out==first);
 assert(source==saved && out.front()==0xabba && out.back()==0xabba);
 // Working particles animate on blank space, preserve title text and clear on idle.
 std::fill(source.begin(),source.end(),0);
 assert(parseCompactCaption("Claude|working|1|2|jax-api|Jobot tracker",c));
 renderer.render(source.data(),out.data()+1,c,20000);first=out;
 renderer.render(source.data(),out.data()+1,c,20600);assert(out!=first);
 for(int y=276;y<466;++y)for(int x=0;x<412;++x)assert(out[1+y*412+x]==first[1+y*412+x]);
 std::strcpy(c.state,"idle");renderer.render(source.data(),out.data()+1,c,21000);
 for(int y=66;y<276;++y)for(int x=62;x<350;++x)assert(out[1+y*412+x]==0);
 assert(out.front()==0xabba && out.back()==0xabba);
 // A portrait tap visibly depresses/rebounds without altering text, state or source.
 for(int y=0;y<466;++y)for(int x=0;x<412;++x)source[y*412+x]=uint16_t((x+3*y)%65535);
 renderer.render(source.data(),out.data()+1,c,22000);first=out;const auto beforeTap=source;
 renderer.acknowledgeTap(22000);renderer.render(source.data(),out.data()+1,c,22150);assert(out!=first);
 for(int y=276;y<466;++y)for(int x=0;x<412;++x)assert(out[1+y*412+x]==first[1+y*412+x]);
 renderer.render(source.data(),out.data()+1,c,22300);assert(out==first);
 assert(source==beforeTap && out.front()==0xabba && out.back()==0xabba);
 assert(parseCompactCaption("Claude|idle|1|4|jax-api|Jobot tracker|4294967295|1:claude:i,2:codex:w,3:claude:a,4:claude:i",c));
 assert(c.targetCount==4 && c.revision==UINT32_MAX);
 for(unsigned i=0;i<4;++i)assert(compactTargetAt(c,compactTargetX(i),compactTargetY(i))==i+1);
 assert(compactTargetAt(c,233,170)==0 && compactTargetAt(c,233,400)==0);
 const auto targets=c;
 for(const char* bad:{"Claude|idle|1|4|p|t|0|1:claude:i","Claude|idle|1|4|p|t|4294967296|1:claude:i", "Claude|idle|1|4|p|t|1|1:claude:i,1:codex:w", "Claude|idle|1|4|p|t|1|5:claude:i", "Claude|idle|1|4|p|t|1|1:claude:z", "Claude|idle|1|4|p|t|1|1:claude:i,"}) {
  assert(!parseCompactCaption(bad,c));assert(!std::memcmp(&c,&targets,sizeof(c)));
 }
 renderer.render(source.data(),out.data()+1,c,23000);first=out;
 renderer.render(source.data(),out.data()+1,c,23500);assert(out!=first); // background work pulses even on idle portrait
 for(int y=276;y<466;++y)for(int x=0;x<412;++x)assert(out[1+y*412+x]==first[1+y*412+x]);
 renderer.acknowledgeSelection(2,24000);renderer.render(source.data(),out.data()+1,c,24020);
 assert(out.front()==0xabba && out.back()==0xabba && source==beforeTap);
 // Both display buffers must match a fresh render after cached button updates.
 std::vector<uint16_t> second(source.size());
 for(unsigned step=0;step<12;++step) {
   c.index=step<4?1:2;
   c.targets[1].state=step<6?'w':step<8?'c':'i';
   if(step==8)c.targetCount=0;
   const uint64_t now=25000+step*100;
   auto* output=step%2?out.data()+1:second.data();
   renderer.render(source.data(),output,c,now);
   CompactRenderer fresh;std::vector<uint16_t> expected(source.size());
   fresh.render(source.data(),expected.data(),c,now);
   assert(std::equal(expected.begin(),expected.end(),output));
 }
 assert(parseCompactCaption("Claude|idle|1|2|demo|Roadmap|1|1:claude:i,2:codex:w|1",c));assert(c.pinned);
 assert(!parseCompactCaption("Claude|idle|1|2|demo|Roadmap|1|1:claude:i|2",c));assert(c.pinned);
 std::fill(source.begin(),source.end(),0);CompactRenderer pinRenderer;
 pinRenderer.render(source.data(),out.data()+1,c,30000);auto pinnedImage=out;
 c.pinned=false;pinRenderer.render(source.data(),out.data()+1,c,30001);
 assert(out!=pinnedImage);
 pinRenderer.render(source.data(),out.data()+1,c,32000);
 for(int y=66;y<100;++y)for(int x=300;x<338;++x)assert(out[1+y*412+x]==0); // no stale pin
 pinRenderer.holdProgress(32000);pinRenderer.render(source.data(),out.data()+1,c,32500);
 bool ring=false;for(int y=66;y<100;++y)for(int x=300;x<338;++x)ring|=out[1+y*412+x]!=0;assert(ring);
 pinRenderer.holdProgress(0);pinRenderer.render(source.data(),out.data()+1,c,33000);
 for(int y=66;y<100;++y)for(int x=300;x<338;++x)assert(out[1+y*412+x]==0);
 assert(out.front()==0xabba && out.back()==0xabba);
 // Attention has a distinct amber border even while a different session is pinned.
 assert(parseCompactCaption("Claude|idle|1|2|demo|Roadmap|1|1:claude:i,2:codex:a|1",c));
 CompactRenderer attentionRenderer;attentionRenderer.render(source.data(),out.data()+1,c,34000);
 const auto amber=swapBytes(out[1+135*412+(401-27+26)]);
 assert(((amber>>11)&31)>(amber&31)*3); // amber red component, not the cyan working ring
 // Inner and outer circle edges both have partial coverage, not hard steps.
 assert(parseCompactCaption("Claude|idle|1|1|demo|Roadmap|1|1:claude:i",c));
 CompactRenderer ringRenderer;ringRenderer.render(source.data(),out.data()+1,c,35000);
 const int ringX=compactTargetX(0)-27,ringY=compactTargetY(0);
 auto redAt=[&](int dy){return (swapBytes(out[1+(ringY+dy)*412+ringX])>>11)&31;};
 assert(redAt(24)<redAt(25) && redAt(25)<redAt(26));
 assert(redAt(27)>0 && redAt(27)<redAt(26));
 assert(parseCompactCaption("",c) && !c.enabled);
 std::cout<<"PASS compact metadata validation, frame isolation, title paging, bounds and reset\n";

 // Verified foreground marker is independent of selection, expires without fresh
 // evidence, and never changes title pixels, source art, or touch targets.
 assert(parseCompactCaption("Claude|idle|2|3|demo|Roadmap|1|1:claude:w,2:claude:i,3:codex:i|1|1:o:123",c));
 assert(c.desktopIndex==1&&c.desktopState=='o'&&c.desktopTick==123&&c.pinned);
 const auto verified=c;
 for(const char* bad:{"Claude|idle|2|3|p|t|1|1:claude:i|0|1:c:1", "Claude|idle|2|3|p|t|1|1:claude:i|0|2:o:1",
 "Claude|idle|2|3|p|t|1|1:claude:i|0|0:u:0", "Claude|idle|2|3|p|t|1|1:claude:i|0|0:u:4294967296"}) {
   assert(!parseCompactCaption(bad,c));assert(!std::memcmp(&c,&verified,sizeof(c)));
 }
 CompactRenderer desktopRenderer;std::fill(source.begin(),source.end(),0);
 desktopRenderer.render(source.data(),out.data()+1,c,40000);const auto withDesktop=out;
 unsigned whitePixels=0;
 for(int y=165;y<=177;++y)for(int x=29;x<=47;++x)if(out[1+y*412+x])++whitePixels;
 assert(whitePixels>30);
 desktopRenderer.render(source.data(),out.data()+1,c,44001);
 for(int y=165;y<=177;++y)for(int x=29;x<=47;++x)assert(out[1+y*412+x]==0);
 for(int y=276;y<381;++y)for(int x=0;x<412;++x)assert(out[1+y*412+x]==withDesktop[1+y*412+x]);
 ++c.desktopTick;desktopRenderer.render(source.data(),out.data()+1,c,44002);
 assert(out[1+165*412+38]!=0);
 c.desktopIndex=2;c.desktopState='c';++c.desktopTick;desktopRenderer.render(source.data(),out.data()+1,c,44003);
 for(int y=165;y<=177;++y)for(int x=29;x<=47;++x)assert(out[1+y*412+x]==0);
 assert(compactTargetAt(c,401,135)==2 && out.front()==0xabba && out.back()==0xabba);
}
