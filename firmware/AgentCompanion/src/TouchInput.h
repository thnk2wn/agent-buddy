#pragma once
#include "Config.h"
#include <cstdint>
#include <cstdlib>

namespace copilot {
enum class TouchGestureKind : uint8_t { None, Press, CancelHold, LongPress, Release, Tap, SwipeUp, SwipeDown };
struct TouchGesture {
  TouchGestureKind kind = TouchGestureKind::None;
  int16_t startX = 0, startY = 0, endX = 0, endY = 0;
};

// Keep navigation gestures distinct from the character tap. Coordinates are already
// transformed into the shared 466px content space, including on smaller boards.
enum class SessionTouchAction : uint8_t { None, Pin, Next };
inline SessionTouchAction sessionTouchAction(const TouchGesture& gesture, bool activeCaptions, bool compact = false) {
  if (!activeCaptions || gesture.kind != TouchGestureKind::Tap) return SessionTouchAction::None;
  return gesture.endY >= (compact ? 276 : 385) ? SessionTouchAction::Next : SessionTouchAction::Pin;
}

constexpr uint32_t kTouchHoldMs = 750;
class TouchGestureTracker {
 public:
  bool sample(bool pressed, int16_t x, int16_t y, uint64_t milliseconds,
              TouchGesture& gesture) {
    gesture = {};
    if (pressed) {
      if (!active_) {
        if (completed_ && milliseconds - completedAt_ < kTouchDebounceMs) return false;
        active_ = true;
        startedAt_ = milliseconds;
        startX_ = lastX_ = x;
        startY_ = lastY_ = y;
        moved_ = held_ = false;
        gesture = {TouchGestureKind::Press,x,y,x,y};
        return true;
      } else {
        lastX_ = x;
        lastY_ = y;
      }
      const int dx=lastX_-startX_,dy=lastY_-startY_;
      if(!moved_ && (std::abs(dx)>kTouchTapTravelPixels || std::abs(dy)>kTouchTapTravelPixels)) {
        moved_=true;gesture={TouchGestureKind::CancelHold,startX_,startY_,lastX_,lastY_};return true;
      }
      if(!moved_ && !held_ && milliseconds-startedAt_>=kTouchHoldMs) {
        held_=true;gesture={TouchGestureKind::LongPress,startX_,startY_,lastX_,lastY_};return true;
      }
      return false;
    }
    if (!active_) return false;
    active_ = false;
    completed_ = true;
    completedAt_ = milliseconds;
    const int dx = lastX_ - startX_;
    const int dy = lastY_ - startY_;
    const int horizontal = dx < 0 ? -dx : dx;
    const int vertical = dy < 0 ? -dy : dy;
    const uint64_t duration = milliseconds - startedAt_;
    TouchGestureKind kind = TouchGestureKind::None;
    if (!held_ && duration <= kTouchSwipeMaxMs && vertical >= kTouchSwipePixels
        && vertical * 4 >= horizontal * 5) {
      kind = dy < 0 ? TouchGestureKind::SwipeUp : TouchGestureKind::SwipeDown;
    } else if (!held_ && !moved_ && duration <= kTouchTapMaxMs
               && horizontal <= kTouchTapTravelPixels
               && vertical <= kTouchTapTravelPixels) {
      kind = TouchGestureKind::Tap;
    }
    if (kind == TouchGestureKind::None) kind=TouchGestureKind::Release;
    gesture = {kind, startX_, startY_, lastX_, lastY_};
    return true;
  }

  bool active() const { return active_; }

 private:
  int16_t startX_ = 0, startY_ = 0, lastX_ = 0, lastY_ = 0;
  uint64_t startedAt_ = 0, completedAt_ = 0;
  bool active_ = false, completed_ = false, moved_ = false, held_ = false;
};

bool initializeTouchInput();
bool pollTouchGesture(TouchGesture& gesture);
void setTouchRotation(float radians);
const char* touchInputError();
}
