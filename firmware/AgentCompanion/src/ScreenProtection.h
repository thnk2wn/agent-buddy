#pragma once
#include <algorithm>
#include <cstdint>
#include <cstdio>
#include <cstring>
namespace copilot {
// Host sends aggregate activity and time-zone-aware quiet time. Touch/idle clocks
// stay on device; caption paging and transport heartbeats never count as activity.
class ScreenProtection {
 public:
  bool packet(const char* text,uint64_t now) {
    if(!text || std::strlen(text)>90)return false;
    for(const char* p=text;*p;++p)if((*p<'0'||*p>'9')&&*p!='|'&&*p!='i'&&*p!='w'&&*p!='a')return false;
    unsigned digits=0;
    for(const char* p=text;*p;++p) {
      digits=(*p>='0'&&*p<='9')?digits+1:0;if(digits>5)return false;
    }
    unsigned enabled,dim,off,percent,quiet,wake,seconds;char state;int end=0;
    if(std::sscanf(text,"%u|%u|%u|%u|%u|%c|%u|%u%n",&enabled,&dim,&off,&percent,&quiet,&state,&wake,&seconds,&end)!=8 || text[end])return false;
    if(enabled>1||dim<60||dim>86400||off<dim||off>86400||percent<1||percent>100||quiet>86400||wake>1||seconds<5||seconds>600||
       (state!='i'&&state!='w'&&state!='a'))return false;
    const bool newAttention=state=='a'&&(!hostSeen_||hostState_!='a');
    enabled_=enabled;dimMs_=uint64_t(dim)*1000;offMs_=uint64_t(off)*1000;percent_=percent;
    quietUntil_=quiet?now+uint64_t(quiet)*1000:0;wakeMs_=uint64_t(seconds)*1000;
    if(newAttention && wake && quiet)awakeUntil_=now+wakeMs_;
    if(state!='i' || (hostSeen_&&hostState_!='i'))lastActivity_=now;
    hostState_=state;hostAt_=now;hostSeen_=true;
    return true;
  }
  // Consume the wake gesture so it cannot activate a terminal underneath a dark screen.
  bool touch(uint64_t now) {
    const bool consume=level(now)!=100;
    lastActivity_=now;awakeUntil_=now+wakeMs_;return consume;
  }
  unsigned level(uint64_t now) const {
    if(!enabled_)return 100;
    if(quietUntil_>now)return awakeUntil_>now?100:0;
    const bool active=hostSeen_ && now-hostAt_<=90000 && hostState_!='i';
    const uint64_t idle=active?0:now-lastActivity_;
    return idle>=offMs_?0:idle>=dimMs_?percent_:100;
  }
  uint8_t brightness(uint8_t user,uint64_t now,bool override=false) const {
    const unsigned percent=override?100:level(now);
    return percent?uint8_t(std::max(1u,unsigned(user)*percent/100)):0;
  }
 private:
  bool enabled_=true,hostSeen_=false;char hostState_='i';unsigned percent_=20;
  uint64_t dimMs_=900000,offMs_=3600000,wakeMs_=60000,lastActivity_=0,hostAt_=0,quietUntil_=0,awakeUntil_=0;
};
}
