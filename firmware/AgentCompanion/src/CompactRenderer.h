#pragma once
#include "CompactCaption.h"
#include "CompactFont.h"
#include "Rgb565.h"
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstring>
#include <cmath>
namespace copilot {
// Composites into a separate PSRAM framebuffer. Never modifies sprite cache pixels.
// Fixed storage, center-sampled RGB565 resampling; no per-frame heap allocation.
class CompactRenderer {
 public:
  static constexpr int width = 412, height = 466;
  CompactRenderer() {
    for(int x=0;x<288;++x) sourceX_[x]=(x*2+1)*10/14;
  }
  // Display task writes; render task reads. A tap acknowledges receipt, not launch success.
  void acknowledgeTap(uint32_t now) {tapAt_.store(now?now:1,std::memory_order_release);}
  void acknowledgeSelection(uint8_t index,uint32_t now) {selectedTap_.store(index,std::memory_order_relaxed);selectionAt_.store(now?now:1,std::memory_order_release);}
  void holdProgress(uint32_t now) {holdAt_.store(now,std::memory_order_release);}
  unsigned pages() const {return std::max(1u,(lineCount_+2)/3);}
  void render(const uint16_t* source, uint16_t* out, const CompactCaption& receivedCaption, uint64_t now) {
    CompactCaption caption=receivedCaption;
    if(caption.desktopTick!=desktopTick_) {desktopTick_=caption.desktopTick;desktopSeenAt_=now;}
    if(caption.desktopTick && now-desktopSeenAt_>=4000) {caption.desktopIndex=0;caption.desktopState='u';}
    // Secondary idle captions must not restart a long title's paging clock.
    if (std::strcmp(title_,caption.title) ||
        index_!=caption.index || std::strcmp(agent_,caption.agent)) {
      std::strcpy(title_,caption.title); std::strcpy(project_,caption.project);
      std::strcpy(agent_,caption.agent); index_=caption.index; started_=now; wrap();
    }
    const unsigned page=unsigned((now-started_)/6500)%pages();
    if(pinKnown_ && caption.pinned!=lastPinned_)pinChangedAt_=now;
    pinKnown_=true;lastPinned_=caption.pinned;
    const bool pinFeedback=pinChangedAt_ && now-pinChangedAt_<1200;
    Cache* cache=&cache_[0];
    if(cache_[0].output && cache_[0].output!=out)cache=&cache_[1];
    const bool changed=cache->pinFeedback!=pinFeedback || cache->output!=out || cache->page!=page || std::memcmp(&cache->caption,&caption,sizeof(caption));
    if(changed) {
      std::memset(out,0,width*height*2);
      cache->pinFeedback=pinFeedback;cache->output=out;cache->caption=caption;cache->page=page;
    }
    const uint32_t tapped=tapAt_.load(std::memory_order_acquire);
    const uint32_t elapsed=uint32_t(now)-tapped;
    const float press=tapped && elapsed<300 ? std::sin(float(elapsed)*3.14159265f/300)*.06f : 0;
    const int zoom=1024+int(press*1024);
    if(zoom!=1024)for(int x=0;x<288;++x)
      pressedX_[x]=uint16_t(std::clamp(206+(int(sourceX_[x])-206)*zoom/1024,0,width-1));
    const uint16_t* columns=zoom==1024?sourceX_:pressedX_;
    // Source frame includes the original portrait's top margin. Reserve header and title areas.
    for (int y=66; y<276; ++y) {
      const int sourceY=((y-10)*2+1)*10/14;
      const int iy=std::clamp(230+(sourceY-230)*zoom/1024,0,height-1);
      // The art is already antialiased. Center sampling keeps the full animation rate;
      // per-pixel four-tap filtering exceeds this board's render budget.
      std::memcpy(topRow_,source+iy*width,width*2);
      for (int x=0; x<288; ++x) row_[x]=topRow_[columns[x]];
      if(!caption.targetCount)std::memset(out+y*width,0,62*2);
      std::memcpy(out+y*width+62,row_,sizeof(row_));
      if(!caption.targetCount)std::memset(out+y*width+350,0,62*2);
    }
    if(!std::strcmp(caption.state,"working"))workingEffects(out,now);
    indicators(out,caption,now,*cache,changed);
    pinMarker(out,caption,now);
    desktopMarker(out,caption);
    if(!changed)return;
    const auto white=rgb565(238,245,255), muted=rgb565(155,175,191), cyan=rgb565(117,216,226);
    text(out,caption.agent,170,31,20,rgb565(239,179,136));
    const char* status=!std::strcmp(caption.state,"attention")?"needs input":
      !std::strcmp(caption.state,"complete")?"finished":caption.state;
    text(out,pinFeedback?(caption.pinned?"Pinned":"Auto-follow"):status,294,33,18,muted);
    const unsigned start=page*3;
    const unsigned count=std::min(3u,lineCount_-std::min(start,lineCount_));
    for(unsigned i=0;i<count;++i) text(out,lines_[start+i],233,276+int(i)*35+int(3-count)*8,32,white);
    char project[65]; std::strcpy(project,caption.project); fit(project,18,310);
    text(out,project,233,393,18,muted);
    char position[40];
    if(pages()>1) std::snprintf(position,sizeof(position),"< %u/%u >   %u/%u",caption.index,caption.count,page+1,pages());
    else std::snprintf(position,sizeof(position),"<  %u / %u  >",caption.index,caption.count);
    if(caption.desktopTick) {
      const char* cue=caption.desktopState=='c'?"Already open":caption.desktopState=='o'?"Tap to open":"Open session";
      if(pages()>1)std::snprintf(position,sizeof(position),"%s %u/%u  %u/%u",cue,caption.index,caption.count,page+1,pages());
      else std::snprintf(position,sizeof(position),"%s  %u/%u",cue,caption.index,caption.count);
    }
    text(out,position,233,423,18,cyan);
  }
 private:
  uint32_t desktopTick_=0;uint64_t desktopSeenAt_=0;
  void desktopMarker(uint16_t* out,const CompactCaption& caption) {
    if(!caption.desktopTick||!caption.desktopIndex)return;
    for(unsigned i=0;i<caption.targetCount;++i)if(caption.targets[i].index==caption.desktopIndex) {
      const int cx=compactTargetX(i)-27,cy=compactTargetY(i)+36;
      const auto color=swapBytes(rgb565(235,245,255));
      for(int y=-6;y<=6;++y)for(int x=-9;x<=9;++x) {
        const bool screen=(y>=-6&&y<=2&&(x==-9||x==9))||((y==-6||y==2)&&x>=-9&&x<=9);
        const bool stand=(y>2&&y<6&&x==0)||(y==6&&x>=-5&&x<=5);
        out[(cy+y)*width+cx+x]=(screen||stand)?color:0;
      }
    }
  }
  struct Cache {bool pinFeedback=false;uint16_t* output=nullptr; CompactCaption caption; unsigned page=0;uint32_t indicatorVersions[4]={};int8_t dotX[4]={},dotY[4]={};};
  struct IndicatorCache {CompactTarget target;bool selected=false,valid=false;uint32_t version=0;uint16_t pixels[56*56]={};};
  IndicatorCache indicators_[4];
  std::atomic<uint32_t> selectionAt_{0};
  std::atomic<uint8_t> selectedTap_{0};
  void indicators(uint16_t* out,const CompactCaption& caption,uint64_t now,Cache& frame,bool cleared) {
    const auto tapped=selectionAt_.load(std::memory_order_acquire);
    const auto pressed=tapped && uint32_t(now)-tapped<250?selectedTap_.load(std::memory_order_relaxed):0;
    for(unsigned i=0;i<caption.targetCount;++i) {
      const auto& target=caption.targets[i];auto& cache=indicators_[i];
      const bool selected=target.index==caption.index || target.index==pressed;
      const int cx=compactTargetX(i),cy=compactTargetY(i),left=cx-27-28,top=cy-28;
      if(!cache.valid || cache.selected!=selected || std::memcmp(&cache.target,&target,sizeof(target))) {
        for(int y=0;y<56;++y)for(int x=0;x<56;++x) {
          const int dx=x-28,dy=y-28;const int distance=dx*dx+dy*dy;
          uint16_t rgb=0;
          const float radius=std::sqrt(float(distance));
          const float inner=std::clamp(radius-24.5f,0.f,1.f);
          const float outer=std::clamp(27.5f-radius,0.f,1.f);
          const bool attention=target.state=='a',complete=target.state=='c';
          const float alpha=(selected?1.f:(attention||complete)?.82f:.42f)*inner*outer;
          // Antialias BOTH edges of the ring; the old hard inner cutoff created
          // stair steps even when the outer circumference was smooth.
          const float fill=1.f-inner;
          const unsigned red=attention?255:complete?103:selected?154:104;
          const unsigned green=attention?190:complete?239:selected?230:158;
          const unsigned blue=attention?77:complete?160:selected?245:178;
          rgb=rgb565(unsigned(14*fill+red*alpha),unsigned(25*fill+green*alpha),unsigned(35*fill+blue*alpha));
          out[(top+y)*width+left+x]=swapBytes(rgb);
        }
        char number[4];std::snprintf(number,sizeof(number),"%u",target.index);
        text(out,number,cx,cy-23,32,rgb565(236,244,252));
        for(int y=0;y<56;++y)std::memcpy(cache.pixels+y*56,out+(top+y)*width+left,56*2);
        cache.target=target;cache.selected=selected;cache.valid=true;++cache.version;
      } else if(cleared || frame.indicatorVersions[i]!=cache.version) {
        for(int y=0;y<56;++y)std::memcpy(out+(top+y)*width+left,cache.pixels+y*56,56*2);
      } else {
        // Restore only portrait overlap and the last orbit-dot footprint in THIS
        // output buffer. The other buffer can contain a different orbit phase.
        const int start=std::max(62,left),end=std::min(350,left+56);
        if(end>start)for(int y=0;y<56;++y)std::memcpy(out+(top+y)*width+start,cache.pixels+y*56+start-left,(end-start)*2);
        const int x0=std::max(0,28+int(frame.dotX[i])-5),x1=std::min(56,28+int(frame.dotX[i])+6);
        const int y0=std::max(0,28+int(frame.dotY[i])-5),y1=std::min(56,28+int(frame.dotY[i])+6);
        for(int y=y0;y<y1;++y)std::memcpy(out+(top+y)*width+left+x0,cache.pixels+y*56+x0,(x1-x0)*2);
      }
      frame.indicatorVersions[i]=cache.version;
      // Working dots orbit a fixed, numbered touch target. Attention pulses in place.
      const float pulse=target.state=='i'?.32f:.68f+.32f*std::sin(float(now%2000)*3.14159265f/1000);
      const unsigned red=target.state=='a'?255:target.state=='w'?91:target.state=='c'?103:147;
      const unsigned green=target.state=='a'?187:target.state=='w'?221:target.state=='c'?239:164;
      const unsigned blue=target.state=='a'?87:target.state=='w'?223:target.state=='c'?160:180;
      if(target.state=='c')for(int y=0;y<56;++y)for(int x=0;x<56;++x) {
        const int dx=x-28,dy=y-28,dist=dx*dx+dy*dy;
        if(dist<24*24 || dist>=28*28)continue;
        const auto base=swapBytes(cache.pixels[y*56+x]);
        out[(top+y)*width+left+x]=swapBytes(uint16_t((unsigned(((base>>11)&31)*pulse)<<11)|
          (unsigned(((base>>5)&63)*pulse)<<5)|unsigned((base&31)*pulse)));
      }
      const float angle=float(now%2400)*6.2831853f/2400-1.5707963f;
      const float dx=target.state=='w'?23.f*std::cos(angle):19.f;
      const float dy=target.state=='w'?23.f*std::sin(angle):-19.f;
      const int ox=int(std::round(dx)),oy=int(std::round(dy));
      frame.dotX[i]=int8_t(ox);frame.dotY[i]=int8_t(oy);
      for(int y=-5;y<=5;++y)for(int x=-5;x<=5;++x) {
        const int px=ox+x,py=oy+y;
        if(px < -28 || px>=28 || py < -28 || py>=28)continue;
        const float fx=px-dx,fy=py-dy;
        const float alpha=std::clamp(4.5f-std::sqrt(fx*fx+fy*fy),0.f,1.f)*pulse;
        if(alpha>0)out[(cy+py)*width+cx-27+px]=swapBytes(rgb565(unsigned(red*alpha),unsigned(green*alpha),unsigned(blue*alpha)));
      }
    }
  }
  void pinMarker(uint16_t* out,const CompactCaption& caption,uint64_t now) {
    const auto held=holdAt_.load(std::memory_order_acquire);
    const float progress=held?std::min(1.f,float(uint32_t(now)-held)/750):0;
    if(!caption.pinned && !held)return;
    // Larger tilted pushpin with a readable label, away from title and artwork.
    for(int y=-18;y<=18;++y)for(int x=-18;x<=18;++x) {
      float alpha=0;
      if(held) {
        const float distance=std::sqrt(float(x*x+y*y));
        float angle=std::atan2(float(x),float(-y));if(angle<0)angle+=6.2831853f;
        if(angle<=progress*6.2831853f)alpha=std::clamp(1.5f-std::abs(distance-16.f),0.f,1.f);
      }
      if(caption.pinned) {
        // Inverse rotation; 2x2 coverage softens the diagonal edges.
        float coverage=0;
        for(float sy:{-.25f,.25f})for(float sx:{-.25f,.25f}) {
          const float u=(x+sx)*.8192f+(y+sy)*.5736f;
          const float v=-(x+sx)*.5736f+(y+sy)*.8192f;
          if((v>=-10&&v<=-5&&std::abs(u)<=6)||
             (v>=-5&&v<=2&&std::abs(u)<=3)||
             (v>=2&&v<=5&&std::abs(u)<=8)||
             (v>=5&&v<=14&&std::abs(u)<=1.2f))coverage+=.25f;
        }
        alpha=std::max(alpha,coverage);
      }
      if(alpha>0)out[(86+y)*width+318+x]=swapBytes(rgb565(unsigned(128*alpha),unsigned(232*alpha),unsigned(247*alpha)));
    }
    if(caption.pinned)text(out,"PIN",345,106,18,rgb565(128,232,247));
  }

  std::atomic<uint32_t> holdAt_{0};
  bool pinKnown_=false,lastPinned_=false;
  uint64_t pinChangedAt_=0;
  // Keep the original working effect's twelve-second cyan comet trail, fitted
  // around the compact portrait. Controls remain separate from decoration.
  static void workingEffects(uint16_t* out,uint64_t now) {
    const float seconds=float(now%12000)/1000;
    for(int i=0;i<7;++i) {
      const float angle=seconds*3.14159265f/6+i*.16f;
      const float cx=206+134*std::cos(angle),cy=171+86*std::sin(angle);
      const float radius=i==6?4.5f:1.8f, reach=radius+2;
      for(int y=int(cy-reach);y<=int(cy+reach);++y)for(int x=int(cx-reach);x<=int(cx+reach);++x) {
        if(x<0||x>=width||y<66||y>=276)continue;
        auto& pixel=out[y*width+x];if(pixel)continue;
        const float dx=x-cx,dy=y-cy,distance=std::sqrt(dx*dx+dy*dy);
        const float coverage=std::clamp(radius+.5f-distance,0.f,1.f);
        const float halo=std::clamp(1.f-distance/reach,0.f,1.f)*.16f;
        const float alpha=std::max(coverage,halo)*(.30f+i*.108f);
        pixel=swapBytes(rgb565(unsigned(80*alpha),unsigned(215*alpha),unsigned(239*alpha)));
      }
    }
    // Antialiased font masks and fractional vertical sampling avoid chunky digits
    // and one-pixel stepping. Sparse lanes leave the character's face clear.
    for(int lane=0;lane<4;++lane) {
      const float phase=std::fmod(seconds/6+lane*.25f,1.f);
      const float fade=std::clamp(std::min(phase,1-phase)/.18f,0.f,1.f);
      const float top=82+(lane<2?phase:1-phase)*164;
      const auto& g=glyph(lane%2?'1':'0',18);
      const int left=lane<2?87+lane*18:296+(lane-2)*18;
      const int base=int(top);const float fraction=top-base;
      for(int y=0;y<=g.height;++y)for(int x=0;x<g.width;++x) {
        const float a0=y<g.height?compactfont::pixels18[g.offset+y*g.width+x]:0;
        const float a1=y>0?compactfont::pixels18[g.offset+(y-1)*g.width+x]:0;
        const float alpha=(a0*(1-fraction)+a1*fraction)/255*.80f*fade;
        auto& pixel=out[(base+y)*width+left+x];
        if(!pixel)pixel=swapBytes(rgb565(unsigned(124*alpha),unsigned(222*alpha),unsigned(242*alpha)));
      }
    }
  }
  Cache cache_[2];
  std::atomic<uint32_t> tapAt_{0};
  uint16_t sourceX_[288], pressedX_[288], topRow_[412], row_[288];
  char title_[257]={},project_[65]={},agent_[17]={},lines_[64][80]={};
  uint8_t index_=0; unsigned lineCount_=0; uint64_t started_=0;
  static const compactfont::Glyph& glyph(unsigned char c,int size) {
    const auto* glyphs=size==32?compactfont::glyphs32:size==20?compactfont::glyphs20:compactfont::glyphs18;
    return glyphs[(c>=32&&c<127?c:'?')-32];
  }
  static int textWidth(const char* s,int size) {int result=0;for(;*s;++s)result+=glyph(*s,size).advance;return result;}
  static void fit(char* s,int size,int maxWidth) {
    if(textWidth(s,size)<=maxWidth)return;
    size_t n=std::strlen(s);
    while(n && textWidth(s,size)>maxWidth-3*glyph('.',size).advance)s[--n]=0;
    std::strcat(s,"...");
  }
  static void text(uint16_t* out,const char* s,int center,int top,int size,uint16_t color) {
    int x=center-textWidth(s,size)/2;
    const uint8_t* pixels=size==32?compactfont::pixels32:size==20?compactfont::pixels20:compactfont::pixels18;
    for(;*s;++s) {
      const auto& g=glyph(*s,size);
      for(int y=0;y<g.height;++y) for(int dx=0;dx<g.width;++dx) {
        const int xx=x+dx,yy=top+y;
        if(xx<27 || xx>=439 || yy<0 || yy>=height || (xx-233)*(xx-233)+(yy-233)*(yy-233)>232*232)continue;
        const unsigned a=pixels[g.offset+y*g.width+dx];
        if(a)out[yy*width+xx-27]=swapBytes(uint16_t(((((color>>11)&31)*a/255)<<11)|
          ((((color>>5)&63)*a/255)<<5)|((color&31)*a/255)));
      }
      x+=g.advance;
    }
  }
  void wrap() {
    std::memset(lines_,0,sizeof(lines_)); lineCount_=0;
    const char* p=title_;
    while(*p && lineCount_<64) {
      while(*p==' ')++p;
      if(!*p)break;
      unsigned n=0,lastSpace=0;int w=0;
      while(p[n] && n<79 && w+glyph(p[n],32).advance<=350) {
        w+=glyph(p[n],32).advance; if(p[n]==' ')lastSpace=n; ++n;
      }
      if(p[n] && lastSpace)n=lastSpace;
      if(!n)n=1;
      std::memcpy(lines_[lineCount_++],p,n);p+=n;
    }
  }
};
}
