import { CycleCloudRequestError } from "./errors.js";
import { consumedFields, requiredWireString } from "./normalize.js";

export type ImagePlatform =
    | { available: false; warning: string }
    | {
          available: true;
          source: "CycleCloud Package metadata";
          os: string;
          jetpackPlatform: string;
          label?: string;
          distribution?: string;
          release?: string;
          matchingRecords: number;
          runtimeVerified: false;
      };

function invalid(): never {
    throw new CycleCloudRequestError("invalid_response", false);
}
function optionalText(value: unknown, limit: number): string | undefined {
    return value == null || value === ""
        ? undefined
        : requiredWireString(value, limit);
}

export function normalizeImagePlatform(
    value: unknown,
    image: string,
): ImagePlatform {
    if (!Array.isArray(value)) invalid();
    if (!value.length)
        return {
            available: false,
            warning:
                "No image-package metadata was returned for the configured image. Do not infer an OS release from its name.",
        };
    const records = value.map((raw: unknown) => {
        const fields = consumedFields(raw, [
            "name",
            "packagetype",
            "label",
            "os",
            "jetpackplatform",
        ]);
        if (
            requiredWireString(fields.get("name"), 256) !== image ||
            requiredWireString(fields.get("packagetype"), 32).toLowerCase() !==
                "image"
        )
            invalid();
        return {
            os: optionalText(fields.get("os"), 32)?.toLowerCase(),
            jetpackPlatform: optionalText(fields.get("jetpackplatform"), 128),
            label: optionalText(fields.get("label"), 256),
        };
    });
    const first = records[0];
    if (
        first?.os === undefined ||
        first.jetpackPlatform === undefined ||
        records.some(
            (record) =>
                record.os === undefined || record.jetpackPlatform === undefined,
        )
    )
        return {
            available: false,
            warning:
                "Image-package metadata does not specify a complete OS and Jetpack platform. Keep the release unresolved.",
        };
    // Image names may identify several package revisions; do not invent which one is selected.
    if (
        records.some(
            (record) =>
                record.os !== first.os ||
                record.jetpackPlatform !== first.jetpackPlatform,
        )
    )
        return {
            available: false,
            warning:
                "Matching image-package records disagree about the platform. Confirm the selected image revision before choosing an OS release.",
        };
    const label = records.every((record) => record.label === first.label)
        ? first.label
        : undefined;
    // These are declared Jetpack platform identifiers, never guesses from image aliases or labels.
    const linuxRelease =
        first.os === "linux"
            ? /^(ubuntu|almalinux|centos|sles)-(\d+(?:\.\d+)*)$/u.exec(
                  first.jetpackPlatform,
              )
            : null;
    const distribution = linuxRelease?.[1];
    const release = linuxRelease?.[2];
    return {
        available: true,
        source: "CycleCloud Package metadata",
        os: first.os,
        jetpackPlatform: first.jetpackPlatform,
        ...(label === undefined ? {} : { label }),
        ...(distribution === undefined || release === undefined
            ? {}
            : { distribution, release }),
        matchingRecords: records.length,
        runtimeVerified: false,
    };
}
