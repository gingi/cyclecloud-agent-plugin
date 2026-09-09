export type StartupErrorCode =
  | "plugin_environment_invalid"
  | "configuration_missing"
  | "configuration_invalid"
  | "credential_file_insecure";

export type StartupErrorReason =
  | "invalid_plugin_data"
  | "created_example"
  | "example_exists"
  | "example_creation_failed"
  | "invalid_json"
  | "unknown_property"
  | "invalid_url"
  | "invalid_username"
  | "invalid_password"
  | "invalid_boolean"
  | "invalid_timeout"
  | "invalid_ca_path"
  | "invalid_transport"
  | "open_failed"
  | "symlink"
  | "not_regular"
  | "wrong_owner"
  | "unsafe_permissions";

const startupMessages: Readonly<Record<StartupErrorCode, string>> = {
  plugin_environment_invalid: "The plugin data directory is invalid.",
  configuration_missing: "CycleCloud configuration is missing. Complete the generated example and restart the plugin.",
  configuration_invalid: "CycleCloud configuration is invalid.",
  credential_file_insecure: "The CycleCloud credential file does not satisfy the required security checks.",
};

export class StartupError extends Error {
  readonly code: StartupErrorCode;
  readonly reason: StartupErrorReason;

  constructor(code: StartupErrorCode, reason: StartupErrorReason) {
    super(startupMessages[code]);
    this.name = "StartupError";
    this.code = code;
    this.reason = reason;
  }
}
