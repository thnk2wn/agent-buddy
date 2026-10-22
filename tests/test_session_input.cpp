#include "../firmware/AgentCompanion/src/SessionInput.h"
#include <cassert>
#include <cstring>
#include <iostream>
int main(){
 using namespace copilot;
 CompactCaption c;assert(parseCompactCaption("Claude|idle|1|4|p|t|9|1:claude:i,2:codex:w,3:claude:i,4:claude:w",c));
 CompactTouchSelection touch;
 auto input=touch.tap(c,401,135,100);assert(input.index==2 && input.activate);
 input=touch.tap(c,233,170,200);assert(input.index==2 && input.activate);
 input=touch.tap(c,233,420,300);assert(input.index==3 && !input.activate);
 input=touch.tap(c,233,170,400);assert(input.index==3 && input.activate);
 c.revision=10;input=touch.tap(c,233,170,500);assert(input.index==1);
 SessionInputQueue queue;char json[800];assert(queue.json(json,sizeof(json))&&!std::strcmp(json,"[]"));
 for(unsigned i=1;i<=12;++i)assert(queue.push(uint8_t(i%4+1),9,i%2)==i);
 assert(queue.json(json,sizeof(json)));assert(std::strstr(json,"\"sequence\":5,"));assert(!std::strstr(json,"\"sequence\":4,"));
 assert(std::strstr(json,"\"sequence\":12,"));char small[2];assert(!queue.json(small,sizeof(small)));
 std::cout<<"PASS ordered bounded touch queue, direct activation and rapid pending selection\n";
}
