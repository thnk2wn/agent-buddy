#pragma once
#include <cstdint>
#include <cstring>
namespace copilot {
enum class NotificationSound { None, Working, Attention, Complete, SessionSwitch };
// One event ID across USB/Wi-Fi. Repeated delivery never replays its sound.
class NotificationCue {
 public:
  bool accept(const char* payload,NotificationSound& sound) {
    sound=NotificationSound::None;
    if(!payload)return false;
    uint64_t id=0;unsigned digits=0;
    while(*payload>='0'&&*payload<='9') {
      if(++digits>10)return false;
      id=id*10+unsigned(*payload++-'0');
    }
    if(!digits||!id||id>UINT32_MAX||*payload++!='|')return false;
    const auto candidate=!std::strcmp(payload,"working")?NotificationSound::Working:
      !std::strcmp(payload,"attention")?NotificationSound::Attention:
      !std::strcmp(payload,"complete")?NotificationSound::Complete:
      !std::strcmp(payload,"switch")?NotificationSound::SessionSwitch:NotificationSound::None;
    if(candidate==NotificationSound::None)return false;
    for(const auto seen:seen_)if(seen==id)return true;
    seen_[next_++%32]=uint32_t(id);sound=candidate;return true;
  }
 private:
  uint32_t seen_[32]={},next_=0;
};
}
