"""Decode ATT traffic for the M-VAVE Tank-G out of an Android btsnoop_hci.log.

Usage:  python btsnoop.py <btsnoop_hci.log | bugreport.zip> [--all]

Prints every ATT write/notification with its handle, so the ae41 (TX) and
ae42 (RX) streams of the proprietary M-VAVE protocol can be read off directly.
"""

import datetime
import io
import struct
import sys
import zipfile

ATT_CID = 0x0004
ATT_OPS = {
    0x0A: "ReadReq", 0x0B: "ReadRsp", 0x12: "WriteReq", 0x13: "WriteRsp",
    0x52: "WriteCmd", 0x1B: "Notify", 0x1D: "Indicate", 0x1E: "Confirm",
    0x08: "ReadByTypeReq", 0x09: "ReadByTypeRsp", 0x10: "ReadByGroupReq",
    0x11: "ReadByGroupRsp", 0x04: "FindInfoReq", 0x05: "FindInfoRsp",
    0x16: "PrepWriteReq", 0x18: "ExecWriteReq", 0x01: "Error",
}
EPOCH_DELTA = 0x00DCDDB30F2F8000  # btsnoop epoch (0000-01-01) -> unix, in microseconds


def load(path):
    if path.lower().endswith(".zip"):
        with zipfile.ZipFile(path) as z:
            hits = [n for n in z.namelist() if "btsnoop" in n.lower()]
            if not hits:
                raise SystemExit(f"no btsnoop file inside {path}; members: {z.namelist()[:20]}")
            print(f"# using {hits[0]} from {path}")
            return io.BytesIO(z.read(hits[0]))
    return open(path, "rb")


def records(fh):
    hdr = fh.read(16)
    if hdr[:8] != b"btsnoop\x00":
        raise SystemExit("not a btsnoop file")
    _ver, link = struct.unpack(">II", hdr[8:16])
    print(f"# btsnoop version={_ver} datalink={link}")
    while True:
        head = fh.read(24)
        if len(head) < 24:
            return
        olen, ilen, flags, _drops, ts = struct.unpack(">IIIIq", head)
        data = fh.read(ilen)
        if len(data) < ilen:
            return
        yield ts, flags, data


def att_stream(fh):
    """Yield (unix_ts, direction, acl_handle, att_payload) reassembling L2CAP."""
    pending = {}
    for ts, flags, data in records(fh):
        if not data:
            continue
        ptype, body = data[0], data[1:]
        if ptype != 0x02 or len(body) < 4:  # ACL only
            continue
        h, total = struct.unpack("<HH", body[:4])
        pb, handle = (h >> 12) & 0x3, h & 0x0FFF
        payload = body[4:4 + total]
        direction = "app->pedal" if (flags & 0x01) == 0 else "pedal->app"

        if pb == 0x1 and handle in pending:  # continuation
            want, buf, d0, t0 = pending[handle]
            buf += payload
            if len(buf) >= want:
                yield t0, d0, handle, buf[4:4 + want]
                del pending[handle]
            else:
                pending[handle] = (want, buf, d0, t0)
            continue

        if len(payload) < 4:
            continue
        l2len, cid = struct.unpack("<HH", payload[:4])
        if cid != ATT_CID:
            continue
        if len(payload) - 4 < l2len:  # fragmented, wait for continuation
            pending[handle] = (l2len, payload, direction, ts)
            continue
        yield ts, direction, handle, payload[4:4 + l2len]


def main():
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    show_all = "--all" in sys.argv
    fh = load(sys.argv[1])

    counts = {}
    t0 = None
    for ts, direction, _acl, att in att_stream(fh):
        if not att:
            continue
        op = att[0]
        name = ATT_OPS.get(op, f"op0x{op:02X}")
        if t0 is None:
            t0 = ts
        rel = (ts - t0) / 1e6
        wall = datetime.datetime.utcfromtimestamp((ts - EPOCH_DELTA) / 1e6)

        if op in (0x52, 0x12, 0x1B, 0x1D):
            att_handle = struct.unpack("<H", att[1:3])[0]
            value = att[3:]
            counts[(name, att_handle)] = counts.get((name, att_handle), 0) + 1
            hexs = " ".join(f"{b:02X}" for b in value)
            printable = "".join(chr(b) if 32 <= b < 127 else "." for b in value)
            print(f"{rel:9.3f}s {wall:%H:%M:%S} {direction:>10}  {name:<9} h=0x{att_handle:04X} "
                  f"len={len(value):<3} {hexs}   |{printable}|")
        elif show_all:
            print(f"{rel:9.3f}s {wall:%H:%M:%S} {direction:>10}  {name:<9} "
                  f"{' '.join(f'{b:02X}' for b in att[1:])}")

    print("\n=== handle summary ===")
    for (name, h), n in sorted(counts.items(), key=lambda kv: -kv[1]):
        print(f"  {name:<9} handle 0x{h:04X}: {n} packets")


if __name__ == "__main__":
    main()
