"""Wire/decompression bounds independent of the installed urllib3 version."""
import gzip
import sys
import tracemalloc
import unittest
import zlib
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "python"))
from cyclecloud_agent_inspect.body_reader import read_body
from cyclecloud_agent_inspect.errors import InspectionError
from cyclecloud_agent_inspect.process import Deadline


class Raw:
    def __init__(self, chunks):
        self.chunks = chunks
        self.calls = []

    def stream(self, amount, decode_content):
        self.calls.append((amount, decode_content))
        if decode_content:
            raise AssertionError("urllib3 must never decompress")
        yield from self.chunks


def response(data, encoding=None, chunk_size=65536):
    raw = Raw([data[index:index + chunk_size] for index in range(0, len(data), chunk_size)])
    return SimpleNamespace(raw=raw, headers={} if encoding is None else {"Content-Encoding": encoding},
                           iter_content=Mock(side_effect=AssertionError("Unsafe implicit decoder")))


def compressed_bomb():
    compressor = zlib.compressobj(wbits=zlib.MAX_WBITS | 16)
    chunks = [compressor.compress(b"x" * 65536) for _ in range(512)]
    return b"".join(chunks) + compressor.flush()


class BodyReaderTests(unittest.TestCase):
    def read(self, data, encoding=None, limit=65536, chunk_size=65536):
        value = response(data, encoding, chunk_size)
        result = read_body(value, Deadline(5), limit)
        value.iter_content.assert_not_called()
        self.assertTrue(all(not decode for _, decode in value.raw.calls))
        return result

    def test_identity_gzip_and_both_deflate_forms(self):
        expected = b'{"ok":true}' * 20
        raw_deflate = zlib.compressobj(wbits=-zlib.MAX_WBITS)
        raw_payload = raw_deflate.compress(expected) + raw_deflate.flush()
        for encoding, data in ((None, expected), ("identity", expected), ("gzip", gzip.compress(expected)),
                               ("deflate", zlib.compress(expected)), ("deflate", raw_payload)):
            for chunk_size in (1, 7, 65536):
                with self.subTest(encoding=encoding, chunk_size=chunk_size):
                    self.assertEqual(self.read(data, encoding, chunk_size=chunk_size), expected)

    def test_wire_and_decoded_limits_are_both_enforced(self):
        for encoding, data in ((None, b"x" * 129), ("gzip", gzip.compress(b"x" * 129)),
                               ("deflate", zlib.compress(b"x" * 129))):
            with self.subTest(encoding=encoding), self.assertRaises(InspectionError) as raised:
                self.read(data, encoding, limit=128)
            self.assertEqual(raised.exception.code, "invalid_response")
        self.assertEqual(self.read(gzip.compress(b"x" * 128), "gzip", limit=128, chunk_size=1), b"x" * 128)
        # Decoding to very little data does not excuse an oversized wire body.
        value = response(b"x" * 129, "gzip")
        with self.assertRaises(InspectionError) as raised:
            read_body(value, Deadline(5), 128)
        self.assertEqual(raised.exception.code, "invalid_response")

    def test_large_expansion_is_bounded_inside_the_decoder(self):
        data = compressed_bomb()  # 32MiB logical body, created incrementally.
        self.assertLess(len(data), 65536)
        value = response(data, "gzip")
        tracemalloc.start()
        try:
            with self.assertRaises(InspectionError) as raised:
                read_body(value, Deadline(5), 65536)
            _, peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()
        self.assertEqual(raised.exception.code, "invalid_response")
        self.assertLess(peak, 512 * 1024, "Decoder allocated the expanded gzip chunk before enforcing the cap")
        value.iter_content.assert_not_called()
        self.assertEqual(value.raw.calls, [(65536, False)])

    def test_concatenated_gzip_members_share_one_output_budget(self):
        data = gzip.compress(b"first") + gzip.compress(b"second")
        for chunk_size in (1, 7, 65536):
            self.assertEqual(self.read(data, "gzip", chunk_size=chunk_size), b"firstsecond")
        data = gzip.compress(b"x" * 100) + gzip.compress(b"y" * 100)
        with self.assertRaises(InspectionError) as raised:
            self.read(data, "gzip", limit=128)
        self.assertEqual(raised.exception.code, "invalid_response")

    def test_truncated_malformed_or_trailing_data_is_rejected(self):
        gzip_data = gzip.compress(b"safe")
        deflate_data = zlib.compress(b"safe")
        cases = [("gzip", b""), ("gzip", gzip_data[:-1]), ("gzip", gzip_data[:12]),
                 ("gzip", b"not gzip secret-canary"), ("gzip", gzip_data + b"junk"),
                 ("gzip", gzip_data + b"\x1f"), ("gzip", gzip_data[:-4] + b"xxxx"),
                 ("deflate", deflate_data[:-1]), ("deflate", deflate_data + b"junk"),
                 ("deflate", deflate_data + deflate_data)]
        for encoding, data in cases:
            with self.subTest(encoding=encoding, data=data), self.assertRaises(InspectionError) as raised:
                self.read(data, encoding, chunk_size=1)
            self.assertEqual(raised.exception.code, "invalid_response")
            self.assertNotIn("secret-canary", str(raised.exception))

    def test_unsupported_or_chained_encoding_rejected_before_body_read(self):
        for encoding in ("br", "zstd", "gzip, gzip", "gzip, deflate", "identity, gzip", ""):
            value = response(b"secret-canary", encoding)
            with self.subTest(encoding=encoding), self.assertRaises(InspectionError) as raised:
                read_body(value, Deadline(5), 128)
            self.assertEqual(raised.exception.code, "invalid_response")
            self.assertEqual(value.raw.calls, [])
            value.iter_content.assert_not_called()

    def test_stream_deadline_is_preserved(self):
        value = response(gzip.compress(b"safe"), "gzip")
        deadline = Mock()
        deadline.remaining.side_effect = InspectionError("timeout", "safe")
        with self.assertRaises(InspectionError) as raised:
            read_body(value, deadline, 65536)
        self.assertEqual(raised.exception.code, "timeout")


if __name__ == "__main__":
    unittest.main()
