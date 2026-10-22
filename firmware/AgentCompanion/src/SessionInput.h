#pragma once
#include "CompactCaption.h"
#include <cstdint>
#include <cstdio>
#include <cstring>
namespace copilot {
struct SessionInput {uint32_t sequence=0,revision=0;uint8_t index=0;bool activate=false;};
class SessionInputQueue {
 public:
  uint32_t push(uint8_t index,uint32_t revision,bool activate) {
    if(!++sequence_)++sequence_;
    if(count_==8){for(unsigned i=1;i<8;++i)inputs_[i-1]=inputs_[i];--count_;}
    inputs_[count_++]={sequence_,revision,index,activate};return sequence_;
  }
  bool json(char* out,size_t capacity) const {
    size_t used=0;
    auto append=[&](const char* format,auto... values) {
      const int n=std::snprintf(out+used,capacity-used,format,values...);
      if(n<0||size_t(n)>=capacity-used)return false;
      used+=size_t(n);return true;
    };
    if(!capacity||!append("%s","["))return false;
    for(unsigned i=0;i<count_;++i) {
      const auto& v=inputs_[i];
      if(!append("%s{\"sequence\":%u,\"index\":%u,\"revision\":%u,\"activate\":%s}",i?",":"",unsigned(v.sequence),unsigned(v.index),unsigned(v.revision),v.activate?"true":"false"))return false;
    }
    return append("%s","]");
  }
 private:
  SessionInput inputs_[8];unsigned count_=0;uint32_t sequence_=0;
};
// Keep rapid taps meaningful while the host is still sending the selected title.
class CompactTouchSelection {
 public:
  SessionInput tap(const CompactCaption& caption,int x,int y,uint32_t now) {
    if(revision_!=caption.revision || now-at_>4000 || caption.index==pending_)pending_=0;
    const uint8_t base=pending_?pending_:caption.index;
    const uint8_t indicator=compactTargetAt(caption,x,y);
    const bool activate=indicator || y<276;
    const uint8_t index=indicator?indicator:y>=276?uint8_t(base%caption.count+1):base;
    pending_=index;revision_=caption.revision;at_=now;
    return {0,revision_,index,activate};
  }
 private:
  uint8_t pending_=0;uint32_t revision_=0,at_=0;
};
}
