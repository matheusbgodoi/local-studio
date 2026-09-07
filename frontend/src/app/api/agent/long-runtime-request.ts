import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable } from "node:stream";
import { Effect } from "effect";

export function longRuntimeRequest(
  target: string,
  input: { method: string; headers: Headers; body?: ArrayBuffer; signal: AbortSignal },
  timeoutMs: number,
): Promise<Response> {
  return Effect.runPromise(
    Effect.tryPromise({
      try: () =>
        new Promise<Response>((resolve, reject) => {
          const url = new URL(target);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            reject(new Error("Agent runtime URL must use HTTP or HTTPS."));
            return;
          }
          const send = url.protocol === "https:" ? httpsRequest : httpRequest;
          const upstream = send(
            url,
            {
              method: input.method,
              headers: Object.fromEntries(input.headers.entries()),
              signal: AbortSignal.any([input.signal, AbortSignal.timeout(timeoutMs)]),
            },
            (incoming) => {
              try {
                const headers = new Headers();
                for (let index = 0; index < incoming.rawHeaders.length; index += 2) {
                  headers.append(incoming.rawHeaders[index]!, incoming.rawHeaders[index + 1]!);
                }
                const status = incoming.statusCode ?? 502;
                const empty = [204, 205, 304].includes(status) || input.method === "HEAD";
                if (empty) incoming.resume();
                resolve(
                  new Response(
                    empty ? null : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>),
                    {
                      status,
                      headers,
                    },
                  ),
                );
              } catch (error) {
                incoming.destroy();
                reject(error);
              }
            },
          );
          upstream.once("error", reject);
          upstream.end(input.body ? Buffer.from(input.body) : undefined);
        }),
      catch: (error) => error,
    }),
  );
}
