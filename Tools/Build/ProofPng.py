"""Lossless PNG IDAT recompression for large uncompressed native proof captures."""
import struct
import zlib


def compressed_png(data):
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('Expected PNG evidence, not a replacement image')
    chunks, streams, offset = [], [], 8
    while offset < len(data):
        length = struct.unpack('>I', data[offset:offset+4])[0]
        kind = data[offset+4:offset+8]
        payload = data[offset+8:offset+8+length]
        if kind == b'IDAT': streams.append(payload)
        else: chunks.append((kind, payload))
        offset += length+12
    raw = zlib.decompress(b''.join(streams))
    packed = zlib.compress(raw, 9)
    assert zlib.decompress(packed) == raw
    output = bytearray(data[:8])
    for kind, payload in chunks:
        if kind == b'IEND':
            output.extend(struct.pack('>I',len(packed))+b'IDAT'+packed+struct.pack('>I',zlib.crc32(b'IDAT'+packed)))
        output.extend(struct.pack('>I',len(payload))+kind+payload+struct.pack('>I',zlib.crc32(kind+payload)))
    return bytes(output)
