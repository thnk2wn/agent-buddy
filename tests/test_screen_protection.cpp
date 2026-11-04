#include "../firmware/AgentCompanion/src/ScreenProtection.h"
#include "../firmware/AgentCompanion/src/DeviceCommands.h"
#include <cassert>
#include <iostream>
using namespace copilot;
int main() {
 ScreenProtection p;
 assert(p.packet("1|900|3600|20|0|i|1|60",0));
 assert(p.level(899999)==100);assert(p.level(900000)==20);assert(p.brightness(200,900000)==40);
 assert(p.level(3600000)==0);assert(p.brightness(200,3600000)==0);
 assert(p.touch(3600000));assert(p.level(3600000)==100);assert(!p.touch(3600001));
 // Repeated idle heartbeats must not prevent dimming/off; text refresh isn't activity.
 ScreenProtection heartbeat;
 for(uint64_t now=0;now<=3600000;now+=10000)assert(heartbeat.packet("1|900|3600|20|0|i|1|60",now));
 assert(heartbeat.level(3600000)==0);
 assert(heartbeat.packet("1|900|3600|20|0|w|1|60",3600001));assert(heartbeat.level(3600001)==100);
 // A disconnected/stale host must not leave a working portrait lit indefinitely.
 assert(heartbeat.level(7200001)==0);
 // Midnight overrides ongoing work; ordinary repeated hooks cannot wake it.
 ScreenProtection night;
 assert(night.packet("1|900|3600|20|21600|w|1|60",0));assert(night.level(0)==0);
 assert(night.packet("1|900|3600|20|21590|w|1|60",10000));assert(night.level(10000)==0);
 assert(night.touch(10000));assert(night.level(69999)==100);assert(night.level(70000)==0);
 assert(night.packet("1|900|3600|20|21520|a|1|60",80000));assert(night.level(80000)==100);
 assert(night.packet("1|900|3600|20|21510|a|1|60",90000));assert(night.level(140000)==0);
 assert(night.packet("1|900|3600|20|0|w|1|60",21600000));assert(night.level(21600000)==100);
 assert(night.packet("1|900|3600|20|21600|i|0|60",21600001));
 assert(night.packet("1|900|3600|20|21600|a|0|60",21600002));assert(night.level(21600002)==0);
 assert(night.brightness(200,21600002,true)==200); // user settings/update approval remain visible
 for(const char* bad:{"", "1|900|60|20|0|i|1|60", "1|900|3600|0|0|i|1|60", "1|900|3600|20|99999|i|1|60", "1|900|3600|20|0|z|1|60", "1|900|3600|20|0|i|1|60junk", "1|4294968196|3600|20|0|i|1|60"})assert(!night.packet(bad,21600003));
 assert(night.packet("0|900|3600|20|21600|i|1|60",21600003));assert(night.level(21600003)==100);
 DeviceCommands parser;DeviceCommand command=DeviceCommand::None;
 for(char c:std::string(">1|900|3600|20|21600|i|1|60\n"))command=parser.feed(c,0);
 assert(command==DeviceCommand::SetScreenProtection);char forwarded[100];assert(parser.badgePacket(command,forwarded,sizeof(forwarded)));
 assert(night.packet(forwarded+1,21600004));
 std::cout<<"PASS idle thresholds, host silence, overnight work, attention wake, touch consumption and protocol bounds\n";
}
