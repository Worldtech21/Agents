"""A local stand-in for the GKE Gateway's backend-service timeout.

The deployed stack sits behind a `gke-l7-global-external-managed` Gateway, and
the backend service it generated for `access-advisor-middleware-svc` carries the
GCP default `timeoutSec: 30`.  That is a *wall-clock budget for the whole
response*, not an idle timeout — so a supervisor run that takes longer than 30s
has its connection cut mid-chunk no matter how much traffic is flowing.  The
browser reports the severed chunked response as
`net::ERR_INCOMPLETE_CHUNKED_ENCODING`; curl calls it
`(18) transfer closed with outstanding read data remaining`.

Nothing about that is reproducible against `uvicorn` on localhost, which is why
the run only ever fails once deployed.  This proxy puts the missing hop back:
it relays TCP to an upstream and destroys the connection `--timeout` seconds
after the request starts, exactly as the load balancer does.

    # reproduce the bug (30s, the GCP default)
    python mocks/gclb_timeout_proxy.py --listen 9090 --upstream 127.0.0.1:8000 --timeout 30

    # prove the fix (what GCPBackendPolicy raises it to)
    python mocks/gclb_timeout_proxy.py --listen 9090 --upstream 127.0.0.1:8000 --timeout 3600

It relays bytes without parsing them, so the truncation lands mid-frame the way
a real cut does, rather than at a tidy message boundary.
"""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import sys
import time

#: Matches the GCP backend-service default, and the value measured in the cluster.
DEFAULT_TIMEOUT_SEC = 30.0


async def _pump(
    reader: asyncio.StreamReader,
    writer: asyncio.StreamWriter,
    counter: list[int],
) -> None:
    """Copy one direction until EOF, recording how many bytes went through."""
    try:
        while True:
            chunk = await reader.read(65536)
            if not chunk:
                break
            counter[0] += len(chunk)
            writer.write(chunk)
            await writer.drain()
    except (ConnectionResetError, BrokenPipeError, asyncio.CancelledError):
        raise
    finally:
        # Half-close so a peer that is still talking learns this side is done.
        with contextlib.suppress(OSError, RuntimeError):
            if writer.can_write_eof():
                writer.write_eof()


async def _handle(
    client_reader: asyncio.StreamReader,
    client_writer: asyncio.StreamWriter,
    upstream_host: str,
    upstream_port: int,
    timeout: float,
) -> None:
    peer = client_writer.get_extra_info("peername")
    started = time.monotonic()

    try:
        upstream_reader, upstream_writer = await asyncio.open_connection(
            upstream_host, upstream_port
        )
    except OSError as exc:
        _log(f"upstream {upstream_host}:{upstream_port} unreachable: {exc}")
        client_writer.close()
        with contextlib.suppress(OSError):
            await client_writer.wait_closed()
        return

    # Counted so the log can show how much of the response the client had
    # received at the moment the connection was severed.
    to_client = [0]
    to_upstream = [0]

    pumps = [
        asyncio.create_task(_pump(client_reader, upstream_writer, to_upstream)),
        asyncio.create_task(_pump(upstream_reader, client_writer, to_client)),
    ]

    # The load balancer's budget runs from the start of the request, so the
    # clock starts here rather than at the first response byte.
    done, pending = await asyncio.wait(pumps, timeout=timeout)

    elapsed = time.monotonic() - started
    severed = bool(pending)

    if severed:
        for task in pending:
            task.cancel()
        _log(
            f"{peer} SEVERED after {elapsed:.1f}s "
            f"({to_client[0]} bytes delivered) — this is the GCLB timeoutSec cut"
        )
    else:
        _log(f"{peer} completed in {elapsed:.1f}s ({to_client[0]} bytes delivered)")

    for task in pumps:
        with contextlib.suppress(asyncio.CancelledError):
            await task

    # An abortive close is what makes the client see a truncated chunked body:
    # closing cleanly here would let it read a well-formed end of stream.
    for writer in (client_writer, upstream_writer):
        with contextlib.suppress(OSError):
            if severed:
                writer.transport.abort()
            else:
                writer.close()


def _log(message: str) -> None:
    print(f"[gclb-mock] {message}", file=sys.stderr, flush=True)


async def _serve(listen_port: int, upstream: str, timeout: float) -> None:
    host, _, port = upstream.rpartition(":")
    if not host or not port.isdigit():
        raise SystemExit(f"--upstream must look like HOST:PORT, got {upstream!r}")

    server = await asyncio.start_server(
        lambda r, w: _handle(r, w, host, int(port), timeout),
        host="127.0.0.1",
        port=listen_port,
    )
    _log(
        f"listening on 127.0.0.1:{listen_port} -> {upstream}, "
        f"severing connections after {timeout:g}s"
    )
    async with server:
        await server.serve_forever()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--listen", type=int, default=9090, help="local port to bind")
    parser.add_argument(
        "--upstream", default="127.0.0.1:8000", help="HOST:PORT of the real service"
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SEC,
        help="seconds before the connection is cut (GCP default: 30)",
    )
    args = parser.parse_args()

    with contextlib.suppress(KeyboardInterrupt):
        asyncio.run(_serve(args.listen, args.upstream, args.timeout))


if __name__ == "__main__":
    main()
