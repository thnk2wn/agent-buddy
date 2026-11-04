import AppKit

// A nonactivating, click-through panel. Never changes the frontmost app or key window.
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let message = CommandLine.arguments.dropFirst().first ?? "Session opened"
let screen = NSScreen.screens.first { NSMouseInRect(NSEvent.mouseLocation, $0.frame, false) } ?? NSScreen.main!
let area = screen.visibleFrame
let width = min(CGFloat(540), area.width - 48)
let frame = NSRect(x: area.midX-width/2, y: area.maxY-106, width: width, height: 74)
let panel = NSPanel(contentRect: frame, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: false)
panel.level = .floating
panel.isOpaque = false
panel.backgroundColor = .clear
panel.hasShadow = true
panel.ignoresMouseEvents = true
panel.hidesOnDeactivate = false
panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .ignoresCycle]
let glass = NSVisualEffectView(frame: NSRect(origin: .zero, size: frame.size))
glass.material = .hudWindow
glass.blendingMode = .behindWindow
glass.state = .active
glass.wantsLayer = true
glass.layer?.cornerRadius = 18
glass.layer?.masksToBounds = true
let caption = NSTextField(labelWithString: "AGENT BUDDY")
caption.font = NSFont.systemFont(ofSize: 10, weight: .semibold)
caption.textColor = .secondaryLabelColor
caption.frame = NSRect(x: 22, y: 46, width: width-44, height: 14)
let label = NSTextField(labelWithString: message)
label.font = NSFont.systemFont(ofSize: 18, weight: .medium)
label.textColor = .labelColor
label.lineBreakMode = .byTruncatingTail
label.frame = NSRect(x: 22, y: 16, width: width-44, height: 25)
glass.addSubview(caption)
glass.addSubview(label)
panel.contentView = glass
panel.alphaValue = 0
panel.orderFrontRegardless()
NSAnimationContext.runAnimationGroup { context in
    context.duration = 0.12
    panel.animator().alphaValue = 1
}
DispatchQueue.main.asyncAfter(deadline: .now()+1.8) {
    NSAnimationContext.runAnimationGroup({ context in
        context.duration = 0.2
        panel.animator().alphaValue = 0
    }, completionHandler: { app.terminate(nil) })
}
app.run()
