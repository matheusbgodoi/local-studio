import ApplicationServices
import CoreGraphics
import Foundation

struct Accelerator {
    let keyCode: CGKeyCode
    let flags: CGEventFlags
}

let keyCodes: [String: CGKeyCode] = [
    "A": 0, "S": 1, "D": 2, "F": 3, "H": 4, "G": 5, "Z": 6, "X": 7,
    "C": 8, "V": 9, "B": 11, "Q": 12, "W": 13, "E": 14, "R": 15,
    "Y": 16, "T": 17, "1": 18, "2": 19, "3": 20, "4": 21, "6": 22,
    "5": 23, "=": 24, "9": 25, "7": 26, "-": 27, "8": 28, "0": 29,
    "]": 30, "O": 31, "U": 32, "[": 33, "I": 34, "P": 35, "ENTER": 36,
    "L": 37, "J": 38, "'": 39, "K": 40, ";": 41, "\\": 42, ",": 43,
    "/": 44, "N": 45, "M": 46, ".": 47, "TAB": 48, "SPACE": 49,
    "BACKSPACE": 51, "ESCAPE": 53, "F17": 64, "F18": 79, "F19": 80,
    "F20": 90, "F5": 96, "F6": 97, "F7": 98, "F3": 99, "F8": 100,
    "F9": 101, "F11": 103, "F13": 105, "F16": 106, "F14": 107,
    "F10": 109, "F12": 111, "F15": 113, "HOME": 115, "PAGEUP": 116,
    "DELETE": 117, "F4": 118, "END": 119, "F2": 120, "PAGEDOWN": 121,
    "F1": 122, "LEFT": 123, "RIGHT": 124, "DOWN": 125, "UP": 126,
]

func emit(_ payload: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8) else { return }
    FileHandle.standardOutput.write(Data((line + "\n").utf8))
}

func permissions() -> (Bool, Bool) {
    (CGPreflightListenEventAccess(), AXIsProcessTrusted())
}

func parse(_ raw: String) -> Accelerator? {
    var flags: CGEventFlags = []
    var key: String?
    for part in raw.split(separator: "+").map({ String($0).uppercased() }) {
        switch part {
        case "COMMAND", "COMMANDORCONTROL", "SUPER": flags.insert(.maskCommand)
        case "CONTROL": flags.insert(.maskControl)
        case "ALT", "OPTION": flags.insert(.maskAlternate)
        case "SHIFT": flags.insert(.maskShift)
        default: key = part
        }
    }
    guard let key, let keyCode = keyCodes[key] else { return nil }
    return Accelerator(keyCode: keyCode, flags: flags)
}

final class Monitor {
    let accelerator: Accelerator
    var pressed = false

    init(accelerator: Accelerator) {
        self.accelerator = accelerator
    }

    func handle(type: CGEventType, event: CGEvent) {
        let code = CGKeyCode(event.getIntegerValueField(.keyboardEventKeycode))
        if type == .keyDown {
            let relevant = event.flags.intersection([.maskCommand, .maskControl, .maskAlternate, .maskShift])
            if code == accelerator.keyCode && relevant == accelerator.flags && !pressed {
                pressed = true
                emit(["type": "down"])
            }
        } else if type == .keyUp && code == accelerator.keyCode && pressed {
            pressed = false
            emit(["type": "up"])
        }
    }
}

let callback: CGEventTapCallBack = { _, type, event, refcon in
    guard let refcon else { return Unmanaged.passUnretained(event) }
    Unmanaged<Monitor>.fromOpaque(refcon).takeUnretainedValue().handle(type: type, event: event)
    return Unmanaged.passUnretained(event)
}

let args = CommandLine.arguments
let (inputMonitoring, accessibility) = permissions()
if args.contains("--probe") {
    emit([
        "type": "probe",
        "ready": inputMonitoring || accessibility,
        "inputMonitoring": inputMonitoring,
        "accessibility": accessibility,
        "reason": inputMonitoring || accessibility ? "ready" : "permission_required",
    ])
    exit(0)
}

guard let index = args.firstIndex(of: "--accelerator"), index + 1 < args.count,
      let accelerator = parse(args[index + 1]) else {
    emit(["type": "error", "ready": false, "reason": "invalid_accelerator"])
    exit(2)
}

let monitor = Monitor(accelerator: accelerator)
let mask = (1 << CGEventType.keyDown.rawValue) | (1 << CGEventType.keyUp.rawValue)
guard let tap = CGEvent.tapCreate(
    tap: .cgSessionEventTap,
    place: .headInsertEventTap,
    options: .listenOnly,
    eventsOfInterest: CGEventMask(mask),
    callback: callback,
    userInfo: Unmanaged.passUnretained(monitor).toOpaque()
) else {
    emit([
        "type": "error",
        "ready": false,
        "inputMonitoring": inputMonitoring,
        "accessibility": accessibility,
        "reason": "permission_required",
    ])
    exit(3)
}

let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
CFRunLoopAddSource(CFRunLoopGetCurrent(), source, .commonModes)
CGEvent.tapEnable(tap: tap, enable: true)
emit([
    "type": "ready",
    "ready": true,
    "inputMonitoring": inputMonitoring,
    "accessibility": accessibility,
])
CFRunLoopRun()
