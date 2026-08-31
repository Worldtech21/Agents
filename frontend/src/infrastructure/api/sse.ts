/**
 * SSE over `fetch`.
 *
 * `EventSource` cannot issue a POST, and both streaming endpoints take a JSON
 * body, so the framing is parsed by hand. The parser is deliberately minimal
 * but complete for what `sse_starlette` emits: `event:`, `id:`, `data:` (which
 * may repeat and is joined with newlines), `:` comments used as keep-alive
 * pings, and a blank line terminating a dispatch.
 */

import { ApiError } from '@infrastructure/api/client';
import type { StreamEnvelopeDTO } from '@infrastructure/types/api';

export interface SseFrame {
  readonly event: string;
  readonly id: string | null;
  readonly data: string;
}

export interface StreamRequestOptions<TBody> {
  readonly url: string;
  readonly body: TBody;
  readonly signal?: AbortSignal;
}

/** Parse a raw SSE byte stream into frames. */
export async function* readSseFrames<TBody>(
  options: StreamRequestOptions<TBody>,
): AsyncGenerator<SseFrame, void, undefined> {
  let response: Response;
  try {
    response = await fetch(options.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream' },
      body: JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error;
    throw new ApiError(
      'Could not open a stream to the Access Advisor service. Check that it is running.',
      { code: 'stream_unreachable' },
    );
  }

  if (!response.ok) {
    throw new ApiError(await describeFailure(response), {
      code: 'stream_rejected',
      status: response.status,
    });
  }
  if (!response.body) {
    throw new ApiError('The service returned a stream with no body.', {
      code: 'stream_empty',
      status: response.status,
    });
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let delivered = 0;

  try {
    for (;;) {
      let chunk: ReadableStreamReadResult<Uint8Array>;
      try {
        chunk = await reader.read();
      } catch (error) {
        // A cancelled run must stay a cancellation, not become a failure.
        if (error instanceof DOMException && error.name === 'AbortError') throw error;
        throw truncationError(delivered, response.status);
      }

      const { done, value } = chunk;
      if (done) break;

      buffer += decoder.decode(value, { stream: true });

      // Frames are separated by a blank line; \r\n is tolerated.
      let separator = findSeparator(buffer);
      while (separator !== null) {
        const raw = buffer.slice(0, separator.index);
        buffer = buffer.slice(separator.index + separator.length);
        const frame = parseFrame(raw);
        if (frame) {
          delivered += 1;
          yield frame;
        }
        separator = findSeparator(buffer);
      }
    }

    const trailing = parseFrame(buffer);
    if (trailing) yield trailing;
  } finally {
    // Releasing the lock lets an aborted fetch tear the connection down.
    reader.releaseLock();
  }
}

/** Parse the stream into the backend's `StreamEnvelope` shape. */
export async function* readStreamEnvelopes<TBody>(
  options: StreamRequestOptions<TBody>,
): AsyncGenerator<StreamEnvelopeDTO, void, undefined> {
  for await (const frame of readSseFrames(options)) {
    if (!frame.data) continue;
    const envelope = parseEnvelope(frame.data);
    if (envelope) yield envelope;
  }
}

function parseEnvelope(data: string): StreamEnvelopeDTO | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    // A malformed chunk must not kill a run that is otherwise progressing.
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const candidate = parsed as Partial<StreamEnvelopeDTO>;
  if (typeof candidate.channel !== 'string' || typeof candidate.event !== 'string') {
    return null;
  }
  return {
    seq: typeof candidate.seq === 'number' ? candidate.seq : 0,
    channel: candidate.channel,
    event: candidate.event,
    namespace: Array.isArray(candidate.namespace) ? candidate.namespace : [],
    thread_id: typeof candidate.thread_id === 'string' ? candidate.thread_id : '',
    ts: typeof candidate.ts === 'number' ? candidate.ts : Date.now() / 1000,
    payload: candidate.payload ?? null,
  };
}

function findSeparator(buffer: string): { index: number; length: number } | null {
  const lf = buffer.indexOf('\n\n');
  const crlf = buffer.indexOf('\r\n\r\n');
  if (lf === -1 && crlf === -1) return null;
  if (crlf !== -1 && (lf === -1 || crlf < lf)) return { index: crlf, length: 4 };
  return { index: lf, length: 2 };
}

function parseFrame(raw: string): SseFrame | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let event = 'message';
  let id: string | null = null;
  const dataLines: string[] = [];

  for (const line of trimmed.split(/\r?\n/)) {
    if (line.startsWith(':')) continue; // keep-alive comment
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // A single leading space after the colon is part of the framing, not data.
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') event = value;
    else if (field === 'id') id = value;
    else if (field === 'data') dataLines.push(value);
  }

  if (dataLines.length === 0) return null;
  return { event, id, data: dataLines.join('\n') };
}

/**
 * Classify a connection severed part-way through the response body.
 *
 * The headers had already arrived and frames were flowing, so the service was
 * reachable and willing — something between the browser and uvicorn cut a
 * chunked body short. Reported by the browser as
 * `net::ERR_INCOMPLETE_CHUNKED_ENCODING`, and by curl as exit 18.
 *
 * This is worth its own code because the cause is almost never the service:
 * on GKE it was the Gateway's backend-service `timeoutSec`, a wall-clock budget
 * for the whole response that no keep-alive can extend (see k8s/README.md).
 * Folding it into the generic network-failure branch is what made that take a
 * while to find.
 */
function truncationError(delivered: number, status: number): ApiError {
  if (delivered === 0) {
    return new ApiError('The stream closed before any events arrived.', {
      code: 'stream_empty',
      status,
    });
  }
  return new ApiError(
    'The connection closed part-way through the run. A proxy or load balancer ' +
      'most likely timed the response out before the run finished.',
    { code: 'stream_truncated', status, details: { framesDelivered: delivered } },
  );
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === 'object' &&
      body !== null &&
      typeof (body as { error?: { message?: unknown } }).error?.message === 'string'
    ) {
      return (body as { error: { message: string } }).error.message;
    }
  } catch {
    // Fall through to the generic message.
  }
  return `The service rejected the stream request (HTTP ${response.status}).`;
}
