import sys
import time

import rtmidi

LISTEN = int(sys.argv[1]) if len(sys.argv) > 1 else 45


def decode(msg):
    status = msg[0]
    if status == 0xF0:
        return f"SysEx ({len(msg)} bytes)"
    kind, ch = status & 0xF0, (status & 0x0F) + 1
    if kind == 0xC0:
        return f"ProgramChange ch{ch} program={msg[1]}"
    if kind == 0xB0:
        return f"ControlChange ch{ch} cc={msg[1]} value={msg[2]}"
    if kind == 0x90:
        return f"NoteOn  ch{ch} note={msg[1]} vel={msg[2]}"
    if kind == 0x80:
        return f"NoteOff ch{ch} note={msg[1]} vel={msg[2]}"
    return f"other status=0x{status:02X}"

midi_in, midi_out = rtmidi.MidiIn(), rtmidi.MidiOut()
in_ports, out_ports = midi_in.get_ports(), midi_out.get_ports()
i_in = next((i for i, p in enumerate(in_ports) if "USB-Midi" in p), None)
i_out = next((i for i, p in enumerate(out_ports) if "USB-Midi" in p), None)
print("in :", in_ports, "->", i_in)
print("out:", out_ports, "->", i_out, flush=True)
if i_in is None or i_out is None:
    raise SystemExit("missing port")

midi_in.open_port(i_in)
midi_in.ignore_types(sysex=False, timing=False, active_sense=False)
midi_out.open_port(i_out)

start = time.time()
seen = []


def drain(seconds, tag):
    end = time.time() + seconds
    while time.time() < end:
        item = midi_in.get_message()
        if item is None:
            time.sleep(0.001)
            continue
        msg, _ = item
        line = "{:8.0f}ms  [{}]  {:<28}  {}".format(
            (time.time() - start) * 1000, tag, " ".join(f"{b:02X}" for b in msg), decode(msg)
        )
        seen.append(line)
        print(line, flush=True)


print("\n--- probe 1: universal identity request ---", flush=True)
midi_out.send_message([0xF0, 0x7E, 0x7F, 0x06, 0x01, 0xF7])
drain(3, "ident")

print("--- probe 2: identity request on device id 0 ---", flush=True)
midi_out.send_message([0xF0, 0x7E, 0x00, 0x06, 0x01, 0xF7])
drain(3, "ident0")

print(f"\n>>> PRESS NOW <<<  footswitch A, B, C, then preset up x2 / down x2, then tuner ({LISTEN}s)", flush=True)
drain(LISTEN, "press")

midi_in.close_port()
midi_out.close_port()
print(f"\n=== total {len(seen)} messages ===")
