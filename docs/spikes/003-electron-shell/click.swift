// Real OS-level mouse click at screen point (x, y), only if this process may post events and the
// frontmost app is the spike's Electron. Prints the outcome; never clicks into another app.
import AppKit
import ApplicationServices

let args = CommandLine.arguments
guard args.count >= 3, let x = Double(args[1]), let y = Double(args[2]) else { print("usage"); exit(2) }
if !AXIsProcessTrusted() { print("untrusted"); exit(0) }
let front = NSWorkspace.shared.frontmostApplication?.localizedName ?? "?"
if !front.lowercased().contains("electron") { print("frontmost-is:\(front)"); exit(0) }
let saved = CGEvent(source: nil)?.location ?? CGPoint(x: 0, y: 0)
let p = CGPoint(x: x, y: y)
let src = CGEventSource(stateID: .hidSystemState)
CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(120_000)
CGEvent(mouseEventSource: src, mouseType: .leftMouseDown, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(40_000)
CGEvent(mouseEventSource: src, mouseType: .leftMouseUp, mouseCursorPosition: p, mouseButton: .left)?.post(tap: .cghidEventTap)
usleep(120_000)
CGEvent(mouseEventSource: src, mouseType: .mouseMoved, mouseCursorPosition: saved, mouseButton: .left)?.post(tap: .cghidEventTap)
print("clicked")
