import Foundation

public struct CommandOutput: Equatable, Sendable {
    public var status: Int32
    public var stdout: String
    public var stderr: String

    public init(status: Int32, stdout: String = "", stderr: String = "") {
        self.status = status
        self.stdout = stdout
        self.stderr = stderr
    }
}

/// A child process the app started.
public protocol RunningProcess: AnyObject {
    var pid: Int32 { get }
    var isRunning: Bool { get }
    func terminate()
}

/// Runs argv arrays, never a shell string (KTD12). argv[0] is an absolute path.
public protocol ProcessRunner {
    func run(_ argv: [String], environment: [String: String]) async throws -> CommandOutput
    func spawn(_ argv: [String], environment: [String: String]) throws -> RunningProcess
}

public enum LaunchError: Error, Equatable {
    case tidegapNotFound
    case startTimedOut
    case spawnFailed(String)
}

/// Finds the `tidegap` command, runs it, and owns at most one `tidegap ui`
/// child (R13, KTD12). It terminates only a child it started.
public final class ServerLauncher {
    public static let knownPaths = [
        "/opt/homebrew/bin/tidegap",
        "/usr/local/bin/tidegap",
        "~/.local/bin/tidegap",
        "~/Library/pnpm/tidegap",
        "~/.npm-global/bin/tidegap",
        "~/.volta/bin/tidegap",
    ]

    private let runner: ProcessRunner
    private let discovery: Discovery
    private let loginShell: () async -> (path: String?, tidegap: String?)
    private let isExecutable: (String) -> Bool
    private let baseEnvironment: [String: String]
    private let homeOverride: URL?
    private let startTimeout: TimeInterval
    private let pollInterval: TimeInterval

    /// Settings override: argv such as `["node", "/repo/packages/cli/dist/index.js"]`.
    public var commandOverride: [String]?
    /// Settings override; nil lets `tidegap ui` pick its default port.
    public var port: Int?

    private var shell: (path: String?, tidegap: String?)?
    public private(set) var child: RunningProcess?

    public init(
        runner: ProcessRunner,
        discovery: Discovery,
        loginShell: @escaping () async -> (path: String?, tidegap: String?) = ServerLauncher.queryLoginShell,
        isExecutable: @escaping (String) -> Bool = { FileManager.default.isExecutableFile(atPath: $0) },
        baseEnvironment: [String: String] = ProcessInfo.processInfo.environment,
        homeOverride: URL? = nil,
        startTimeout: TimeInterval = 10,
        pollInterval: TimeInterval = 0.2
    ) {
        self.runner = runner
        self.discovery = discovery
        self.loginShell = loginShell
        self.isExecutable = isExecutable
        self.baseEnvironment = baseEnvironment
        self.homeOverride = homeOverride
        self.startTimeout = startTimeout
        self.pollInterval = pollInterval
    }

    /// Login-shell `PATH` and `command -v tidegap`, captured once.
    private func shellInfo() async -> (path: String?, tidegap: String?) {
        if let shell { return shell }
        let info = await loginShell()
        shell = info
        return info
    }

    private var home: String {
        homeOverride?.path ?? baseEnvironment["HOME"] ?? NSHomeDirectory()
    }

    private func expand(_ path: String) -> String {
        path.hasPrefix("~/") ? home + path.dropFirst(1) : path
    }

    /// The command argv with an absolute argv[0]: override, then the login
    /// shell, then known paths. nil means "tidegap not found".
    public func resolveCommand() async -> [String]? {
        let info = await shellInfo()
        if let override = commandOverride, let first = override.first {
            guard let exe = findExecutable(first, path: info.path) else { return nil }
            return [exe] + override.dropFirst()
        }
        if let found = info.tidegap, found.hasPrefix("/"), isExecutable(found) { return [found] }
        for candidate in Self.knownPaths.map(expand) where isExecutable(candidate) {
            return [candidate]
        }
        return nil
    }

    private func findExecutable(_ name: String, path: String?) -> String? {
        let name = expand(name)
        if name.contains("/") { return isExecutable(name) ? name : nil }
        let dirs = (path ?? "") + ":/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin"
        for dir in dirs.split(separator: ":") where !dir.isEmpty {
            let candidate = "\(dir)/\(name)"
            if isExecutable(candidate) { return candidate }
        }
        return nil
    }

    /// The child's environment: the login-shell `PATH` (GUI apps get only
    /// /usr/bin:/bin:/usr/sbin:/sbin, and `tidegap` is a `#!/usr/bin/env
    /// node` script), plus the command's own folder, where node usually is.
    public func environment(for command: [String]) async -> [String: String] {
        var env = baseEnvironment
        var parts: [String] = []
        if let first = command.first {
            parts.append((first as NSString).deletingLastPathComponent)
        }
        parts.append((await shellInfo().path) ?? env["PATH"] ?? "")
        parts.append("/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
        env["PATH"] = parts.filter { !$0.isEmpty }.joined(separator: ":")
        if let homeOverride { env["HOME"] = homeOverride.path }
        return env
    }

    /// `<tidegap> <args…>` to completion.
    public func run(_ args: [String]) async throws -> CommandOutput {
        guard let command = await resolveCommand() else { throw LaunchError.tidegapNotFound }
        return try await runner.run(command + args, environment: await environment(for: command))
    }

    /// Spawns `tidegap ui --no-open` and waits for a `ui.json` naming the
    /// child's pid. A running child is reused.
    public func start() async throws -> DiscoveredServer {
        if let child, child.isRunning, let found = discovery.find(), found.pid == child.pid {
            return found
        }
        stop()
        guard let command = await resolveCommand() else { throw LaunchError.tidegapNotFound }
        var argv = command + ["ui", "--no-open"]
        if let port { argv += ["--port", String(port)] }
        let process: RunningProcess
        do {
            process = try runner.spawn(argv, environment: await environment(for: command))
        } catch {
            throw LaunchError.spawnFailed(String(describing: error))
        }
        child = process
        let deadline = Date().addingTimeInterval(startTimeout)
        while Date() < deadline {
            if let found = discovery.find(), found.pid == process.pid { return found }
            if !process.isRunning { break }
            try? await Task.sleep(nanoseconds: UInt64(pollInterval * 1_000_000_000))
        }
        stop()
        throw LaunchError.startTimedOut
    }

    /// Terminates the child this launcher started, and nothing else.
    public func stop() {
        if let child, child.isRunning { child.terminate() }
        child = nil
    }

    /// `/bin/zsh -lc` once: the login `PATH` and `command -v tidegap`.
    public static let queryLoginShell: () async -> (path: String?, tidegap: String?) = {
        let runner = SystemProcessRunner()
        let script = "printf '%s\\n' \"$PATH\"; command -v tidegap || true"
        guard let out = try? await runner.run(["/bin/zsh", "-lc", script], environment: ProcessInfo.processInfo.environment),
              out.status == 0
        else { return (nil, nil) }
        let lines = out.stdout.split(separator: "\n").map(String.init)
        return (lines.first, lines.count > 1 ? lines[1] : nil)
    }
}

/// Splits a Settings command line into argv: spaces separate, single or
/// double quotes group, a backslash escapes the next character.
public enum CommandLineSplitter {
    public static func split(_ line: String) -> [String] {
        var args: [String] = []
        var current = ""
        var inToken = false
        var quote: Character?
        var escaped = false
        for ch in line {
            if escaped {
                current.append(ch)
                escaped = false
                inToken = true
            } else if ch == "\\" && quote != "'" {
                escaped = true
            } else if let q = quote {
                if ch == q { quote = nil } else { current.append(ch) }
            } else if ch == "\"" || ch == "'" {
                quote = ch
                inToken = true
            } else if ch == " " || ch == "\t" {
                if inToken { args.append(current) }
                current = ""
                inToken = false
            } else {
                current.append(ch)
                inToken = true
            }
        }
        if inToken { args.append(current) }
        return args
    }
}

/// Foundation `Process` runner. The child's output goes to `logURL` when given.
public final class SystemProcessRunner: ProcessRunner {
    private let logURL: URL?

    public init(logURL: URL? = nil) {
        self.logURL = logURL
    }

    public func run(_ argv: [String], environment: [String: String]) async throws -> CommandOutput {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: argv[0])
        process.arguments = Array(argv.dropFirst())
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        let out = Pipe()
        let err = Pipe()
        process.standardOutput = out
        process.standardError = err
        return try await withCheckedThrowingContinuation { continuation in
            do {
                try process.run()
            } catch {
                continuation.resume(throwing: error)
                return
            }
            DispatchQueue.global().async {
                let stdout = out.fileHandleForReading.readDataToEndOfFile()
                let stderr = err.fileHandleForReading.readDataToEndOfFile()
                process.waitUntilExit()
                continuation.resume(returning: CommandOutput(
                    status: process.terminationStatus,
                    stdout: String(decoding: stdout, as: UTF8.self),
                    stderr: String(decoding: stderr, as: UTF8.self)
                ))
            }
        }
    }

    public func spawn(_ argv: [String], environment: [String: String]) throws -> RunningProcess {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: argv[0])
        process.arguments = Array(argv.dropFirst())
        process.environment = environment
        process.standardInput = FileHandle.nullDevice
        var output: Any = FileHandle.nullDevice
        if let logURL {
            try? FileManager.default.createDirectory(at: logURL.deletingLastPathComponent(), withIntermediateDirectories: true)
            FileManager.default.createFile(atPath: logURL.path, contents: nil, attributes: [.posixPermissions: 0o600])
            if let handle = try? FileHandle(forWritingTo: logURL) { output = handle }
        }
        process.standardOutput = output
        process.standardError = output
        try process.run()
        return SystemProcess(process)
    }
}

final class SystemProcess: RunningProcess {
    private let process: Process

    init(_ process: Process) {
        self.process = process
    }

    var pid: Int32 { process.processIdentifier }
    var isRunning: Bool { process.isRunning }

    /// SIGTERM: `tidegap ui` removes its ui.json and exits cleanly on it.
    func terminate() {
        process.terminate()
    }
}
