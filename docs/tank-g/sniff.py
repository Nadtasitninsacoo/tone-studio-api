import sys
import time

import rtmidi

DURATION = int(sys.argv[1]) if len(sys.argv) > 1 else 60

midi_in = rtmidi.MidiIn()
ports = midi_in.get_ports()
idx = next((i for i, p in enumerate(ports) if "USB-Midi" in p), None)
if idx is None:
    print("no USB-Midi port; ports =", ports)
    raise SystemExit(1)

midi_in.open_port(idx)
midi_in.ignore_types(sysex=False, timing=False, active_sense=False)
print(f"listening on '{ports[idx]}' for {DURATION}s", flush=True)


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
    if kind == 0xE0:
        return f"PitchBend ch{ch} value={(msg[2] << 7) | msg[1]}"
    if kind == 0xA0:
        return f"Aftertouch ch{ch} note={msg[1]} pressure={msg[2]}"
    if kind == 0xD0:
        return f"ChannelPressure ch{ch} value={msg[1]}"
    return f"other status=0x{status:02X}"


start = time.time()
captured = []
while time.time() - start < DURATION:
    item = midi_in.get_message()
    if item is None:
        time.sleep(0.001)
        continue
    msg, _delta = item
    t = (time.time() - start) * 1000
    hexs = " ".join(f"{b:02X}" for b in msg)
    line = f"{t:8.0f}ms  {hexs:<24}  {decode(msg)}"
    captured.append(line)
    print(line, flush=True)

midi_in.close_port()
print(f"\n=== total {len(captured)} messages ===")
