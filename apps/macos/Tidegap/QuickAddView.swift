import SwiftUI
import TidegapKit

/// Prompt, deadline preset, Add (R3). Sends only `prompt` and `deadline`.
struct QuickAddView: View {
    @Environment(AppModel.self) private var model
    @State private var prompt = ""
    @State private var preset: DeadlinePreset = .day

    private var canAdd: Bool {
        !prompt.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && !model.adding
            && { if case .connected = model.state { return true } else { return false } }()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            TextField("Queue a task…", text: $prompt, axis: .vertical)
                .lineLimit(1...4)
                .textFieldStyle(.roundedBorder)
                .onSubmit(add)
            HStack {
                Picker("Deadline", selection: $preset) {
                    ForEach(DeadlinePreset.allCases) { Text($0.rawValue).tag($0) }
                }
                .pickerStyle(.segmented)
                .labelsHidden()
                .fixedSize()
                Spacer()
                Button("Add", action: add)
                    .keyboardShortcut(.defaultAction)
                    .disabled(!canAdd)
            }
            if let error = model.quickAddError {
                Text(error).font(.caption).foregroundStyle(.red).lineLimit(2)
            }
        }
    }

    private func add() {
        guard canAdd else { return }
        let text = prompt
        Task {
            if await model.quickAdd(prompt: text, preset: preset) { prompt = "" }
        }
    }
}
