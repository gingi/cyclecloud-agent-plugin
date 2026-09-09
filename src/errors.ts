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
    configuration_missing:
        "CycleCloud configuration is missing. Complete the generated example and restart the plugin.",
    configuration_invalid: "CycleCloud configuration is invalid.",
    credential_file_insecure:
        "The CycleCloud credential file does not satisfy the required security checks.",
};

export class StartupError extends Error {
    readonly code: StartupErrorCode;
    readonly reason: StartupErrorReason;
    readonly path?: string;

    constructor(
        code: StartupErrorCode,
        reason: StartupErrorReason,
        path?: string,
    ) {
        super(startupMessages[code]);
        this.name = "StartupError";
        this.code = code;
        this.reason = reason;
        if (path !== undefined) this.path = sanitizeLocalPath(path);
    }
}

function sanitizeLocalPath(path: string): string {
    const withoutControls = [...path]
        .filter((character) => {
            const codePoint = character.codePointAt(0);
            return (
                codePoint === undefined ||
                (codePoint > 0x1f && (codePoint < 0x7f || codePoint > 0x9f))
            );
        })
        .join("");
    const scalars = [...withoutControls];
    return scalars.length <= 512
        ? withoutControls
        : `${scalars.slice(0, 511).join("")}…`;
}

export type ToolErrorCategory =
    | "authentication_failed"
    | "permission_denied"
    | "cluster_not_found"
    | "cyclecloud_rejected_request"
    | "cyclecloud_unavailable"
    | "unexpected_redirect"
    | "tls_error"
    | "busy"
    | "timeout"
    | "network_error"
    | "cancelled"
    | "invalid_response";

export const toolErrorMessages: Readonly<Record<ToolErrorCategory, string>> = {
    authentication_failed:
        "CycleCloud authentication failed. Update the configured credentials and try again.",
    permission_denied: "CycleCloud denied this operation.",
    cluster_not_found: "CycleCloud did not return the requested cluster.",
    cyclecloud_rejected_request: "CycleCloud rejected the request.",
    cyclecloud_unavailable: "CycleCloud is unavailable.",
    unexpected_redirect:
        "CycleCloud returned an unexpected redirect. Check the configured URL.",
    tls_error:
        "CycleCloud TLS certificate validation failed. Check the configured host and trust settings.",
    busy: "The CycleCloud plugin is busy. Try the request again later.",
    timeout: "The CycleCloud request timed out.",
    network_error: "The CycleCloud request failed because of a network error.",
    cancelled: "The CycleCloud request was cancelled.",
    invalid_response:
        "CycleCloud returned a response the plugin could not safely use.",
};

export class CycleCloudRequestError extends Error {
    readonly category: ToolErrorCategory;
    readonly retryable: boolean;

    constructor(category: ToolErrorCategory, retryable: boolean) {
        super(toolErrorMessages[category]);
        this.name = "CycleCloudRequestError";
        this.category = category;
        this.retryable = retryable;
    }
}
