import Foundation
import FoundationModels

private let stdoutQueue = DispatchQueue(label: "title.stdout")

func emit(_ object: [String: Any]) {
    stdoutQueue.sync {
        guard let data = try? JSONSerialization.data(withJSONObject: object, options: [.sortedKeys]),
              let line = String(data: data, encoding: .utf8) else { return }
        FileHandle.standardOutput.write(Data((line + "\n").utf8))
    }
}

func finish(_ object: [String: Any]) -> Never {
    emit(object)
    exit(0)
}

func report(_ code: String, _ message: String) -> Never {
    finish(["type": "error", "code": code, "message": message])
}

func fail(_ code: String, _ message: String) -> Never {
    emit(["type": "error", "code": code, "message": message])
    exit(1)
}

func note(_ message: String) {
    FileHandle.standardError.write(Data(("[title] " + message + "\n").utf8))
}

struct Options {
    var probeOnly = false
    var titleMode = false
    var localeIdentifier = Locale.current.identifier(.bcp47)
}

func parseOptions() -> Options {
    var options = Options()
    var arguments = Array(CommandLine.arguments.dropFirst())
    while let argument = arguments.first {
        arguments.removeFirst()
        switch argument {
        case "--probe":
            options.probeOnly = true
        case "--title":
            options.titleMode = true
        case "--locale":
            guard let value = arguments.first else { fail("bad_arguments", "--locale needs a value") }
            options.localeIdentifier = value
            arguments.removeFirst()
        case "--help", "-h":
            note("usage: LocalStudioTitle (--probe | --title) [--locale pt-BR]")
            exit(0)
        default:
            fail("bad_arguments", "unknown argument \(argument)")
        }
    }
    if options.probeOnly == options.titleMode {
        fail("bad_arguments", "pass exactly one of --probe or --title")
    }
    return options
}

let excerptCharacterLimit = 6000

func readExcerpt() -> String {
    let data = FileHandle.standardInput.readDataToEndOfFile()
    let text = String(data: data, encoding: .utf8) ?? ""
    let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.count > excerptCharacterLimit
        ? String(trimmed.prefix(excerptCharacterLimit))
        : trimmed
}

let titleCharacterLimit = 48
private let wrappingQuotes = Set<Character>(["\"", "'", "«", "»", "“", "”", "‘", "’", "`"])

func normalizeTitle(_ raw: String) -> String {
    var text = raw.components(separatedBy: .whitespacesAndNewlines)
        .filter { !$0.isEmpty }
        .joined(separator: " ")

    while text.count > 1, let first = text.first, let last = text.last,
          wrappingQuotes.contains(first), wrappingQuotes.contains(last) {
        text = String(text.dropFirst().dropLast()).trimmingCharacters(in: .whitespaces)
    }
    while let last = text.last, ".!?;:,".contains(last) {
        text = String(text.dropLast()).trimmingCharacters(in: .whitespaces)
    }

    guard text.count > titleCharacterLimit else { return text }
    let clipped = String(text.prefix(titleCharacterLimit))
    if let boundary = clipped.lastIndex(of: " "),
       clipped.distance(from: clipped.startIndex, to: boundary) > 12 {
        return String(clipped[clipped.startIndex..<boundary])
    }
    return clipped
}

@available(macOS 26.0, *)
func unavailableReasonCode(_ reason: SystemLanguageModel.Availability.UnavailableReason) -> String {
    switch reason {
    case .deviceNotEligible: return "device_not_eligible"
    case .appleIntelligenceNotEnabled: return "apple_intelligence_not_enabled"
    case .modelNotReady: return "model_not_ready"
    @unknown default: return "unavailable"
    }
}

@available(macOS 26.0, *)
func titleSchema() throws -> GenerationSchema {
    let root = DynamicGenerationSchema(
        name: "ConversationTitle",
        description: "A short label for a conversation",
        properties: [
            DynamicGenerationSchema.Property(
                name: "title",
                description: "Two to five words naming the subject. No quotes, punctuation, or prefix.",
                schema: DynamicGenerationSchema(type: String.self)
            )
        ]
    )
    return try GenerationSchema(root: root, dependencies: [])
}

@available(macOS 26.0, *)
func instructions(localeIdentifier: String) -> String {
    """
    Name chat conversations from an excerpt. Return one short title in the same language as the \
    conversation. If the excerpt is too short to tell, use \(localeIdentifier). Name the subject, \
    never the greeting. Use two to five words, without quotes, punctuation, or a prefix.
    """
}

@available(macOS 26.0, *)
func generateTitle(excerpt: String, localeIdentifier: String) async -> Never {
    let model = SystemLanguageModel.default
    if case .unavailable(let reason) = model.availability {
        report(unavailableReasonCode(reason), "the on-device model is not available")
    }

    let schema: GenerationSchema
    do {
        schema = try titleSchema()
    } catch {
        report("schema_failed", "\(error)")
    }

    let session = LanguageModelSession(instructions: instructions(localeIdentifier: localeIdentifier))
    let options = GenerationOptions(samplingMode: .greedy, maximumResponseTokens: 32)
    let prompt = "Conversation excerpt:\n\n\(excerpt)"

    do {
        let response = try await session.respond(
            to: prompt,
            schema: schema,
            includeSchemaInPrompt: true,
            options: options
        )
        let raw = try response.content.value(String.self, forProperty: "title")
        let title = normalizeTitle(raw)
        if title.isEmpty { report("empty_title", "the model returned nothing usable") }
        finish(["type": "title", "title": title])
    } catch let error as LanguageModelSession.GenerationError {
        switch error {
        case .guardrailViolation: report("guardrail_violation", "\(error)")
        case .refusal: report("refusal", "\(error)")
        case .exceededContextWindowSize: report("context_exceeded", "\(error)")
        case .assetsUnavailable: report("assets_unavailable", "\(error)")
        case .unsupportedLanguageOrLocale: report("unsupported_language", "\(error)")
        case .unsupportedGuide: report("unsupported_guide", "\(error)")
        case .decodingFailure: report("decoding_failure", "\(error)")
        case .rateLimited: report("rate_limited", "\(error)")
        case .concurrentRequests: report("concurrent_requests", "\(error)")
        @unknown default: report("generation_failed", "\(error)")
        }
    } catch {
        report("generation_failed", "\(error)")
    }
}

@available(macOS 26.0, *)
func probe(localeIdentifier: String) -> Never {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
        finish([
            "type": "probe",
            "available": true,
            "locale": localeIdentifier,
            "localeSupported": model.supportsLocale(Locale(identifier: localeIdentifier)),
        ])
    case .unavailable(let reason):
        finish([
            "type": "probe",
            "available": false,
            "reason": unavailableReasonCode(reason),
        ])
    }
}

let options = parseOptions()

guard #available(macOS 26.0, *) else {
    finish(options.probeOnly
        ? ["type": "probe", "available": false, "reason": "os_too_old"]
        : ["type": "error", "code": "os_too_old", "message": "FoundationModels needs macOS 26 or newer"])
}

if options.probeOnly {
    probe(localeIdentifier: options.localeIdentifier)
}

let excerpt = readExcerpt()
if excerpt.isEmpty {
    report("empty_excerpt", "nothing arrived on stdin")
}

Task.detached { await generateTitle(excerpt: excerpt, localeIdentifier: options.localeIdentifier) }
dispatchMain()
