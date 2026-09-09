import { execFile } from "node:child_process";
import {
    createServer as createHttpServer,
    type IncomingMessage,
    type ServerResponse,
} from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { chmod, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

export interface QueuedResponse {
    readonly status: number;
    readonly body?: string | Buffer;
    readonly headers?: Readonly<Record<string, string>>;
    readonly delayMs?: number;
}

export interface RecordedRequest {
    readonly method: string;
    readonly url: string;
    readonly authorization?: string;
}

export interface FakeCycleCloudServer {
    readonly origin: string;
    readonly requests: readonly RecordedRequest[];
    enqueue(response: QueuedResponse): void;
    close(): Promise<void>;
}

export interface TestPki {
    readonly caPath: string;
    readonly ca: string;
    readonly certificate: string;
    readonly privateKey: string;
}

export async function startFakeCycleCloudServer(
    options: {
        readonly tls?: {
            readonly certificate: string;
            readonly privateKey: string;
        };
        readonly originHost?: string;
    } = {},
): Promise<FakeCycleCloudServer> {
    const responses: QueuedResponse[] = [];
    const requests: RecordedRequest[] = [];
    const handler = (
        request: IncomingMessage,
        response: ServerResponse,
    ): void => {
        requests.push({
            method: request.method ?? "",
            url: request.url ?? "",
            ...(request.headers.authorization === undefined
                ? {}
                : { authorization: request.headers.authorization }),
        });
        const queued = responses.shift() ?? {
            status: 500,
            body: "No queued response",
        };
        const send = (): void => {
            if (response.destroyed) return;
            response.writeHead(queued.status, queued.headers);
            response.end(queued.body);
        };
        if (queued.delayMs === undefined) send();
        else setTimeout(send, queued.delayMs).unref();
    };
    const server =
        options.tls === undefined
            ? createHttpServer(handler)
            : createHttpsServer(
                  {
                      cert: options.tls.certificate,
                      key: options.tls.privateKey,
                  },
                  handler,
              );

    await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => {
            server.removeListener("error", reject);
            resolve();
        });
    });
    const address = server.address();
    if (address === null || typeof address === "string")
        throw new Error("Fake server did not bind to a TCP port");
    const scheme = options.tls === undefined ? "http" : "https";
    const host = options.originHost ?? "127.0.0.1";

    return {
        origin: `${scheme}://${host}:${address.port}`,
        requests,
        enqueue: (queued) => responses.push(queued),
        close: async () => {
            server.closeAllConnections();
            await new Promise<void>((resolve, reject) => {
                server.close((error) => {
                    if (error === undefined) resolve();
                    else reject(error);
                });
            });
        },
    };
}

export async function createTestPki(
    directory: string,
    commonName = "localhost",
): Promise<TestPki> {
    const caPath = join(directory, "ca.pem");
    const caKeyPath = join(directory, "ca.key");
    const requestPath = join(directory, "server.csr");
    const certificatePath = join(directory, "server.pem");
    const privateKeyPath = join(directory, "server.key");
    const extensionsPath = join(directory, "server.ext");

    await run("openssl", [
        "req",
        "-x509",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        caKeyPath,
        "-out",
        caPath,
        "-subj",
        "/CN=CycleCloud MCP Test CA",
        "-days",
        "1",
    ]);
    await run("openssl", [
        "req",
        "-newkey",
        "rsa:2048",
        "-nodes",
        "-keyout",
        privateKeyPath,
        "-out",
        requestPath,
        "-subj",
        `/CN=${commonName}`,
    ]);
    await writeFile(
        extensionsPath,
        `subjectAltName=DNS:${commonName}\nextendedKeyUsage=serverAuth\n`,
    );
    await run("openssl", [
        "x509",
        "-req",
        "-in",
        requestPath,
        "-CA",
        caPath,
        "-CAkey",
        caKeyPath,
        "-CAcreateserial",
        "-out",
        certificatePath,
        "-days",
        "1",
        "-extfile",
        extensionsPath,
    ]);
    await chmod(caPath, 0o644);

    return {
        caPath,
        ca: await readFile(caPath, "utf8"),
        certificate: await readFile(certificatePath, "utf8"),
        privateKey: await readFile(privateKeyPath, "utf8"),
    };
}
