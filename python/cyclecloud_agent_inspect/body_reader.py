"""Bound wire bytes and decompression before allocating decoded response bodies.

Do not use requests.iter_content/urllib3 decoding here: older supported urllib3
versions inflate an entire compressed chunk before applying their read bound.
Every zlib output allocation below has an explicit, nonzero max_length.
"""
import zlib

from .command import fail

CHUNK_SIZE = 65536


class _Decoder:
    def __init__(self, encoding, output, limit, deadline):
        self.encoding = encoding
        self.output = output
        self.limit = limit
        self.deadline = deadline
        self.decoder = zlib.decompressobj(zlib.MAX_WBITS | 16) if encoding == "gzip" else None
        self.prefix = b""

    def feed(self, data):
        if self.decoder is None:
            # HTTP deflate is zlib-wrapped, but raw deflate is also common.
            # Inspect at most a two-byte header; never retry an unbounded decode.
            self.prefix += data
            if len(self.prefix) < 2:
                return
            first, second = self.prefix[:2]
            wrapped = (first & 15) == 8 and (first >> 4) <= 7 and ((first << 8) + second) % 31 == 0
            self.decoder = zlib.decompressobj(zlib.MAX_WBITS if wrapped else -zlib.MAX_WBITS)
            data, self.prefix = self.prefix, b""
        if self.decoder.eof:
            if self.encoding != "gzip":
                fail("invalid_response")
            # RFC1952 permits consecutive gzip members, but they must share the
            # same response budget. Trailing non-gzip bytes are never ignored.
            self.decoder = zlib.decompressobj(zlib.MAX_WBITS | 16)
        while True:
            self.deadline.remaining()
            remaining = self.limit - len(self.output)
            maximum = min(CHUNK_SIZE, remaining + 1)  # zero would mean unlimited
            decoded = self.decoder.decompress(data, maximum)
            if len(decoded) > remaining:
                fail("invalid_response")
            self.output.extend(decoded)
            if self.decoder.eof:
                data = self.decoder.unused_data
                if not data:
                    return
                if self.encoding != "gzip":
                    fail("invalid_response")
                self.decoder = zlib.decompressobj(zlib.MAX_WBITS | 16)
                continue
            data = self.decoder.unconsumed_tail
            if data:
                continue
            if len(decoded) == maximum:
                # Drain any pending decoded bytes, still with max_length, even
                # if zlib consumed the complete input chunk at this boundary.
                data = b""
                continue
            return

    def finish(self):
        # Never flush(): its length argument is not a maximum output bound.
        # eof also checks the gzip trailer/CRC or zlib checksum was complete.
        if self.decoder is None or not self.decoder.eof:
            fail("invalid_response")


def read_body(response, deadline, byte_limit):
    encoding = response.headers.get("Content-Encoding", "identity").strip().lower()
    if encoding not in ("identity", "gzip", "deflate"):
        fail("invalid_response")  # Reject chains/unknown codecs before body IO.
    output = bytearray()
    wire_bytes = 0
    decoder = None if encoding == "identity" else _Decoder(encoding, output, byte_limit, deadline)
    try:
        for block in response.raw.stream(CHUNK_SIZE, decode_content=False):
            deadline.remaining()
            wire_bytes += len(block)
            if wire_bytes > byte_limit:
                fail("invalid_response")
            if not block:
                continue
            if decoder is None:
                output.extend(block)  # Identity output equals bounded wire input.
            else:
                decoder.feed(block)
        deadline.remaining()
        if decoder is not None:
            decoder.finish()
    except zlib.error:
        fail("invalid_response")
    return bytes(output)
