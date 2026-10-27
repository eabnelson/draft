// macOS dictionaries and the user's preferred spelling language, entirely local.
import AppKit
import Foundation

let checker = NSSpellChecker.shared
let tag = NSSpellChecker.uniqueSpellDocumentTag()
defer { checker.closeSpellDocument(withTag: tag) }
while let line = readLine() {
    autoreleasepool {
        guard let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let id = request["id"] as? Int else { return }
        var response: [String: Any] = ["id": id]
        if let text = request["text"] as? String, text.utf16.count <= 200_000 {
            let source = text as NSString
            var offset = 0
            var words: [[String: Any]] = []
            while offset < source.length && words.count < 1000 {
                let range = checker.checkSpelling(of: text, startingAt: offset, language: nil, wrap: false, inSpellDocumentWithTag: tag, wordCount: nil)
                if range.location == NSNotFound || range.length == 0 { break }
                words.append(["from": range.location, "to": NSMaxRange(range), "word": source.substring(with: range)])
                offset = NSMaxRange(range)
            }
            response["words"] = words
        } else if let word = request["word"] as? String, word.utf16.count <= 100 {
            response["suggestions"] = Array((checker.guesses(forWordRange: NSRange(location: 0, length: word.utf16.count), in: word, language: nil, inSpellDocumentWithTag: tag) ?? []).prefix(5))
        } else {
            response["error"] = "Choose a shorter passage to check."
        }
        if let encoded = try? JSONSerialization.data(withJSONObject: response, options: [.sortedKeys]), let result = String(data: encoded, encoding: .utf8) { print(result); fflush(stdout) }
    }
}
