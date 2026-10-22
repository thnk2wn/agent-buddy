#pragma once
#include <cstdint>
#include <cstring>
#include <cstdlib>
#include <cstdio>
#include <initializer_list>
namespace copilot {
struct CompactTarget {char agent[17]={};uint8_t index=0;char state='i';};
// Bounded metadata; revision binds a numbered touch to the roster that was shown.
struct CompactCaption {
  char agent[17] = {}, state[17] = {}, project[65] = {}, title[257] = {};
  uint8_t index = 0, count = 0;
  bool enabled = false;
  uint32_t revision=0;
  CompactTarget targets[4]={};
  uint8_t targetCount=0;
};
inline bool parseCompactCaption(const char* packet, CompactCaption& result) {
  CompactCaption next;
  if (!packet || std::strlen(packet) >= 512) return false;
  if (!*packet) {result = next; return true;}
  char index[3]={},count[3]={},revision[11]={},targets[101]={};
  char* fields[]={next.agent,next.state,index,count,next.project,next.title,revision,targets};
  const unsigned capacities[]={17,17,3,3,65,257,11,101};
  unsigned fieldCount=0;
  for(unsigned f=0;f<8;++f) {
    unsigned n=0;
    while(*packet && *packet!='|') {
      if(*packet<32 || *packet>126 || n+1>=capacities[f])return false;
      fields[f][n++]=*packet++;
    }
    fieldCount=f+1;
    if(!*packet)break;
    if(f==7)return false;
    ++packet;
  }
  if(fieldCount!=6 && fieldCount!=8)return false;
  for(const char* number:{index,count}) {
    if(!*number)return false;
    for(const char* c=number;*c;++c)if(*c<'0'||*c>'9')return false;
  }
  next.index=std::atoi(index);next.count=std::atoi(count);
  if(!next.agent[0]||!next.title[0]||!next.index||next.index>next.count)return false;
  if(std::strcmp(next.state,"idle")&&std::strcmp(next.state,"working")&&std::strcmp(next.state,"attention")&&
     std::strcmp(next.state,"complete")&&std::strcmp(next.state,"sleep")&&std::strcmp(next.state,"surprise"))return false;
  if(fieldCount==8) {
    if(!revision[0]||!targets[0])return false;
    uint64_t value=0;
    for(const char* c=revision;*c;++c) {if(*c<'0'||*c>'9')return false;value=value*10+unsigned(*c-'0');}
    if(!value||value>UINT32_MAX)return false;
    next.revision=uint32_t(value);
    char* cursor=targets;
    while(*cursor) {
      if(next.targetCount==4)return false;
      char* end=std::strchr(cursor,',');if(end)*end=0;
      auto& target=next.targets[next.targetCount];unsigned i=0;int consumed=0;
      if(std::sscanf(cursor,"%2u:%16[a-z0-9-]:%c%n",&i,target.agent,&target.state,&consumed)!=3 ||
         cursor[consumed] || i<1 || i>next.count || (target.state!='i'&&target.state!='w'&&target.state!='a'))return false;
      for(unsigned j=0;j<next.targetCount;++j)if(next.targets[j].index==i)return false;
      target.index=uint8_t(i);++next.targetCount;
      if(!end)break;
      cursor=end+1;if(!*cursor)return false;
    }
  }
  next.enabled=true;result=next;return true;
}
// Coordinates in the full 466px touch space. Same geometry is used by the renderer.
inline int compactTargetX(unsigned slot) {return slot%2?401:65;}
inline int compactTargetY(unsigned slot) {return slot/2?215:135;}
inline uint8_t compactTargetAt(const CompactCaption& caption,int x,int y) {
  if(!caption.enabled||!caption.revision)return 0;
  for(unsigned i=0;i<caption.targetCount;++i) {
    const int dx=x-compactTargetX(i),dy=y-compactTargetY(i);
    if(dx*dx+dy*dy<=29*29)return caption.targets[i].index;
  }
  return 0;
}
}
