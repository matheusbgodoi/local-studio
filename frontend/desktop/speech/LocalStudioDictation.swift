// LocalStudioDictation — on-device dictation for Local Studio, as a standalone helper.
//
// WHY A HELPER BINARY AND NOT A NATIVE NODE ADDON
//
// The modern on-device speech API (SpeechAnalyzer / SpeechTranscriber, macOS 26+) is Swift-only
// and async. Reaching it from Electron would normally mean a native Node addon — and this
// repository has no node-gyp, no node-addon-api and no electron-rebuild, so adding one means
// adding a whole native build chain and a rebuild step on every Electron bump.
//
// It is not necessary. This is a plain executable: it captures audio itself, runs the analyzer
// itself, and writes one JSON object per line to stdout. The main process spawns it and reads
// lines. No addon, no ABI coupling, no rebuild when Electron moves.
//
// PROTOCOL — stdout, one JSON object per line:
//   {"type":"ready","locale":"pt-BR","format":"..."}    analyzer is running, speak now
//   {"type":"partial","text":"..."}                      volatile: REPLACE the current span
//   {"type":"final","text":"..."}                        settled: this span will not change
//   {"type":"error","code":"...","message":"..."}        fatal unless code says otherwise
//   {"type":"done"}                                      microphone released, exiting
//
// stdin accepts one word per line: `stop` finalises and keeps the transcript; `cancel` drops it.
// SIGTERM behaves like `cancel`.
//
// THE PARTIAL/FINAL DISTINCTION IS THE WHOLE POINT. `partial` replaces the volatile span
// in the composer; `final` freezes it and starts a new one. A consumer that appends partials
// instead of replacing them produces the stuttering duplicate text this design exists to avoid.

import AVFoundation
import Foundation
import Speech

// MARK: - line protocol

/// stdout is the protocol, so nothing else may ever write to it. Diagnostics go to stderr.
private let stdoutQueue = DispatchQueue(label: "dictation.stdout")

func emit(_ object: [String: Any]) {
    stdoutQueue.sync {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message])
    exit(1)
}

func note(_ message: String) {
    FileHandle.standardError.write(Data(("[dictation] " + message + "\n").utf8))
}

// MARK: - arguments

struct Options {
    var localeIdentifier = "pt-BR"
    /// `probe` reports capability and exits without touching the microphone. It is what the
    /// app calls to decide whether to show the button at all, and what CI can run headless.
    var probeOnly = false
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = Array(CommandLine.arguments.dropFirst())
    while let argument = arguments.first {
        arguments.removeFirst()
        switch argument {
        case "--locale":
            guard let value = arguments.first else { fail("bad_arguments", "--locale needs a value") }
            options.localeIdentifier = value
            arguments.removeFirst()
        case "--probe":
            options.probeOnly = true
        case "--help", "-h":
            note("usage: LocalStudioDictation [--locale pt-BR] [--probe]")
            exit(0)
        default:
            fail("bad_arguments", "unknown argument \(argument)")
        }
    }
    return options
}

// MARK: - locale selection

/// Pick the closest installed locale, and say what happened.
///
/// An exact match is used when present. Otherwise the same LANGUAGE is accepted — pt-PT will
/// transcribe Brazilian Portuguese far better than falling back to English would — and the
/// substitution is REPORTED rather than hidden, because a user who asked for pt-BR and silently
/// got en-US would blame the microphone.
func resolveLocale(requested identifier: String, supported: [Locale], installed: [Locale]) -> (Locale, String)? {
    let wanted = Locale(identifier: identifier)
    let wantedID = wanted.identifier(.bcp47).lowercased()

    func match(_ pool: [Locale]) -> Locale? {
        pool.first { $0.identifier(.bcp47).lowercased() == wantedID }
    }
    if let exact = match(installed) { return (exact, "exact") }
    if let exact = match(supported) { return (exact, "exact-not-installed") }

    let wantedLanguage = wanted.language.languageCode?.identifier.lowercased()
    func sameLanguage(_ pool: [Locale]) -> Locale? {
        pool.first { $0.language.languageCode?.identifier.lowercased() == wantedLanguage }
    }
    if let near = sameLanguage(installed) { return (near, "same-language-installed") }
    if let near = sameLanguage(supported) { return (near, "same-language-not-installed") }
    return nil
}

// MARK: - main

@available(macOS 26.0, *)
final class Dictation: @unchecked Sendable {
    private let options: Options
    private var engine: AVAudioEngine?
    private var analyzer: SpeechAnalyzer?
    private var inputContinuation: AsyncStream<AnalyzerInput>.Continuation?
    private var cancelled = false

    init(options: Options) { self.options = options }

    func run() async {
        let supported = await SpeechTranscriber.supportedLocales
        let installed = await SpeechTranscriber.installedLocales

        guard let (locale, how) = resolveLocale(requested: options.localeIdentifier,
                                                supported: supported, installed: installed) else {
            fail("locale_unsupported",
                 "\(options.localeIdentifier) is not among \(supported.count) supported locales")
        }

        // progressiveTranscription is the preset that emits volatile results while the user is
        // still speaking. The non-progressive presets only produce text once a phrase settles,
        // which is a different product.
        let transcriber = SpeechTranscriber(locale: locale, preset: .progressiveTranscription)

        if options.probeOnly {
            let status = await AssetInventory.status(forModules: [transcriber])
            emit([
                "type": "probe",
                "available": true,
                "locale": locale.identifier(.bcp47),
                "match": how,
                "assetStatus": String(describing: status),
                "supportedLocales": supported.map { $0.identifier(.bcp47) },
                "installedLocales": installed.map { $0.identifier(.bcp47) },
            ])
            exit(0)
        }

        // The system owns the model files. Reserving tells it we intend to use this locale so it
        // can install or keep the assets; downloading them by hand is not our business.
        do {
            _ = try await AssetInventory.reserve(locale: locale)
        } catch {
            note("could not reserve \(locale.identifier(.bcp47)): \(error)")
        }

        let (stream, continuation) = AsyncStream<AnalyzerInput>.makeStream()
        inputContinuation = continuation

        let analyzer = SpeechAnalyzer(modules: [transcriber])
        self.analyzer = analyzer

        // Let the analyzer choose the format, then convert the microphone into it. Guessing a
        // format and hoping the analyzer accepts it is how this class of code fails silently.
        let analyzerFormat = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber])

        // Results are consumed on their own task so the audio tap is never blocked by a consumer.
        let resultsTask = Task { [weak self] in
            do {
                for try await result in transcriber.results {
                    if self?.cancelled == true { return }
                    let text = String(result.text.characters)
                    guard !text.isEmpty else { continue }
                    emit(["type": result.isFinal ? "final" : "partial", "text": text])
                }
            } catch {
                emit(["type": "error", "code": "transcriber_failed", "message": "\(error)"])
            }
        }

        do {
            try await startCapture(into: continuation, analyzerFormat: analyzerFormat)
            try await analyzer.start(inputSequence: stream)
        } catch {
            fail("capture_failed", "\(error)")
        }

        emit([
            "type": "ready",
            "locale": locale.identifier(.bcp47),
            "match": how,
            "format": analyzerFormat.map { "\($0.sampleRate)Hz ch\($0.channelCount)" } ?? "analyzer-default",
        ])

        await waitForCommand()

        // Stop the microphone FIRST. Finalising can take a moment, and holding the input node
        // open through it means the orange recording indicator outlives the dictation — which
        // users read, correctly, as "it is still listening".
        stopCapture()
        continuation.finish()

        if cancelled {
            await analyzer.cancelAndFinishNow()
        } else {
            try? await analyzer.finalizeAndFinishThroughEndOfInput()
        }
        resultsTask.cancel()
        _ = await AssetInventory.release(reservedLocale: locale)
        emit(["type": "done"])
    }

    private func startCapture(into continuation: AsyncStream<AnalyzerInput>.Continuation,
                             analyzerFormat: AVAudioFormat?) async throws {
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let inputFormat = input.outputFormat(forBus: 0)

        guard inputFormat.sampleRate > 0 else {
            fail("no_microphone", "the input node reports a zero sample rate — no usable microphone")
        }

        let converter: AVAudioConverter?
        if let target = analyzerFormat, target != inputFormat {
            guard let made = AVAudioConverter(from: inputFormat, to: target) else {
                fail("format_unsupported",
                     "cannot convert \(inputFormat) to the analyzer's \(target)")
            }
            converter = made
        } else {
            converter = nil
        }

        let tap: @Sendable (AVAudioPCMBuffer, AVAudioTime) -> Void = { buffer, _ in
            guard let target = analyzerFormat, let converter else {
                continuation.yield(AnalyzerInput(buffer: buffer))
                return
            }
            let ratio = target.sampleRate / inputFormat.sampleRate
            let capacity = AVAudioFrameCount(Double(buffer.frameLength) * ratio) + 1024
            guard let out = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { return }
            var consumed = false
            var conversionError: NSError?
            converter.convert(to: out, error: &conversionError) { _, status in
                if consumed { status.pointee = .noDataNow; return nil }
                consumed = true
                status.pointee = .haveData
                return buffer
            }
            if conversionError == nil, out.frameLength > 0 {
                continuation.yield(AnalyzerInput(buffer: out))
            }
        }

        // macOS 27 deprecates this in favour of an `error:`-returning variant, but that one is
        // NS_REFINED_FOR_SWIFT and this SDK does not surface it as throwing — the compiler
        // rejects `try` on it as an unnecessary effect marker. So the deprecated call stays, and
        // the failure it cannot report is covered by the sample-rate guard above plus the fact
        // that no `ready` is emitted if the engine will not start.
        input.installTap(onBus: 0, bufferSize: 4096, format: inputFormat, block: tap)

        engine.prepare()
        try engine.start()
    }

    private func stopCapture() {
        guard let engine else { return }
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        self.engine = nil
    }

    /// Block until the parent says stop/cancel, stdin closes, or a signal arrives.
    private func waitForCommand() async {
        let done = DispatchSemaphore(value: 0)

        let term = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .global())
        let int = DispatchSource.makeSignalSource(signal: SIGINT, queue: .global())
        for source in [term, int] {
            source.setEventHandler { [weak self] in self?.cancelled = true; done.signal() }
            source.resume()
        }
        signal(SIGTERM, SIG_IGN)
        signal(SIGINT, SIG_IGN)

        DispatchQueue.global().async { [weak self] in
            while let line = readLine(strippingNewline: true) {
                switch line.trimmingCharacters(in: .whitespaces).lowercased() {
                case "stop":   self?.cancelled = false; done.signal(); return
                case "cancel": self?.cancelled = true;  done.signal(); return
                default:       continue
                }
            }
            // stdin closed: the parent is gone. Treat it as cancel — nobody is left to receive
            // a transcript, and a helper that keeps the microphone open after its parent dies
            // is the worst possible failure mode here.
            self?.cancelled = true
            done.signal()
        }

        await withCheckedContinuation { (continuation: CheckedContinuation<Void, Never>) in
            DispatchQueue.global().async { done.wait(); continuation.resume() }
        }
    }
}

// MARK: - entry

let options = parseOptions()

guard #available(macOS 26.0, *) else {
    fail("os_too_old", "on-device SpeechAnalyzer needs macOS 26 or newer")
}

// TWO THINGS HERE ARE DELIBERATE, AND BOTH WERE BUGS FIRST.
//
// 1. The instance is held in a `let`. Constructing it inline inside the Task made it a temporary
//    that was deallocated immediately, so every `weak self` inside run() was nil — the signal
//    handler's `self?.cancelled = true` became a no-op, CANCEL SILENTLY DID NOTHING, and SIGTERM
//    finalised the transcript instead of dropping it. The compiler warned about exactly this.
//
// 2. `Task.detached` + `dispatchMain()`, NOT `Task { }` + `semaphore.wait()`. Top-level Swift
//    code is @MainActor, so a bare `Task { }` inherits the main actor — and blocking the main
//    thread on a semaphore starves it before its first line runs. Measured: the process hung
//    with no output at all, not even the first stderr marker. It is not a slow API; the task
//    never started.
let dictation = Dictation(options: options)
Task.detached { await dictation.run(); exit(0) }
dispatchMain()
