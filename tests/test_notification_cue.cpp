#include "../firmware/AgentCompanion/src/NotificationCue.h"
#include <cassert>
#include <iostream>
int main() {
 using namespace copilot;
 NotificationCue cues;NotificationSound sound;
 assert(cues.accept("1|complete",sound)&&sound==NotificationSound::Complete);
 assert(cues.accept("2|attention",sound)&&sound==NotificationSound::Attention);
 assert(cues.accept("1|complete",sound)&&sound==NotificationSound::None);
 assert(cues.accept("3|working",sound)&&sound==NotificationSound::Working);
 assert(cues.accept("4|switch",sound)&&sound==NotificationSound::SessionSwitch);
 assert(cues.accept("4|switch",sound)&&sound==NotificationSound::None);
 for(const char* bad:{"","0|working","-1|working","4294967296|working","99999999999999999|complete","1","1|idle","1|attention|extra","1|attention\n"}) {
   assert(!cues.accept(bad,sound));assert(sound==NotificationSound::None);
 }
 assert(cues.accept("4294967295|attention",sound)&&sound==NotificationSound::Attention);
 std::cout<<"PASS sound-only notification validation and cross-route event deduplication\n";
}
