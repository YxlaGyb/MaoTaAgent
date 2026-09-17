export const SPEC = {
  name: "shell",
  description: "Run a shell command and return its exit code, stdout and stderr.",
  input_schema: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command line to run." },
      cwd: { type: "string", description: "Working directory; defaults to the plugin's own cwd." },
      timeout_ms: { type: "integer", description: "Kill the command after this many milliseconds." },
    },
    required: ["command"],
  },
} as const;