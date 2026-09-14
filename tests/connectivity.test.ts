import { afterEach, expect, test, vi } from "vitest";
import { fetch } from "undici";
import { createCycleCloudClient } from "../src/cyclecloud-client.js";
import { createFileCredentialProvider } from "../src/credentials.js";

vi.mock("undici", async (importOriginal) => ({
    ...(await importOriginal<typeof import("undici")>()),
    fetch: vi.fn(),
}));

afterEach(() => vi.resetAllMocks());

async function createClient() {
    return createCycleCloudClient(
        {
            url: "https://cyclecloud.example.test",
            verifyTls: true,
            allowInsecureHttp: false,
            enableMutations: true,
            requestTimeoutMs: 1_000,
            actionTimeoutMs: 1_000,
            debug: false,
        },
        createFileCredentialProvider({
            username: "test-user",
            password: "test-password",
        }),
    );
}

const unreachableCodes = [
    "ECONNREFUSED",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
    "UND_ERR_CONNECT_TIMEOUT",
];

test.each(unreachableCodes)(
    "Identifies %s as an unreachable instance",
    async (code) => {
        vi.mocked(fetch).mockRejectedValue(
            new TypeError("fetch failed", { cause: { code } }),
        );
        const client = await createClient();
        try {
            await expect(client.listClusters()).rejects.toMatchObject({
                category: "cyclecloud_unreachable",
                retryable: true,
            });
            await expect(
                client.startCluster("cluster-1", false),
            ).rejects.toMatchObject({
                category: "cyclecloud_unreachable",
                retryable: true,
            });
            expect(fetch).toHaveBeenCalledTimes(2);
        } finally {
            await client.close();
        }
    },
);

test("Recognizes failed IPv4/IPv6 connection attempts wrapped in an aggregate", async () => {
    vi.mocked(fetch).mockRejectedValue(
        new TypeError("fetch failed", {
            cause: new AggregateError([
                { code: "ECONNREFUSED" },
                { code: "ENETUNREACH" },
            ]),
        }),
    );
    const client = await createClient();
    try {
        await expect(client.listClusters()).rejects.toMatchObject({
            category: "cyclecloud_unreachable",
        });
    } finally {
        await client.close();
    }
});

test.each([
    { code: "ECONNRESET" },
    { code: "UND_ERR_SOCKET" },
    new AggregateError([{ code: "ECONNREFUSED" }, { code: "ECONNRESET" }]),
])(
    "Does not mislabel an ambiguous connection failure as unreachable: %j",
    async (cause) => {
        vi.mocked(fetch).mockRejectedValue(
            new TypeError("fetch failed", { cause }),
        );
        const client = await createClient();
        try {
            await expect(client.listClusters()).rejects.toMatchObject({
                category: "network_error",
            });
            await expect(
                client.startCluster("cluster-1", false),
            ).resolves.toEqual({
                outcome: "unknown",
            });
        } finally {
            await client.close();
        }
    },
);
