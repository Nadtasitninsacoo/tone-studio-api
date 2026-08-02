import asyncio
import sys
import time

from bleak import BleakClient

ADDR = "5B:5A:54:0F:DC:D3"
MIDI_SVC = "03b80e5a-ede8-4b33-a751-6ce34ec4c700"
MIDI_CHR = "7772e5db-3868-4112-a1a9-f2669d106bf3"
VENDOR_TX = "0000ae41-0000-1000-8000-00805f9b34fb"
VENDOR_RX = "0000ae42-0000-1000-8000-00805f9b34fb"

LISTEN = int(sys.argv[1]) if len(sys.argv) > 1 else 40
start = time.time()
hits = []


def stamp():
    return f"{(time.time() - start) * 1000:8.0f}ms"


def on_midi(_sender, data):
    raw = " ".join(f"{b:02X}" for b in data)
    # BLE MIDI: byte0 = header (0x80|ts_high), byte1 = timestamp (0x80|ts_low), then MIDI bytes
    body = " ".join(f"{b:02X}" for b in data[2:]) if len(data) > 2 else ""
    line = f"{stamp()}  BLE-MIDI  {raw}   -> midi[{body}]"
    hits.append(line)
    print(line, flush=True)


def on_vendor(_sender, data):
    line = f"{stamp()}  ae42      {' '.join(f'{b:02X}' for b in data)}"
    hits.append(line)
    print(line, flush=True)


async def main():
    async with BleakClient(ADDR, timeout=20.0) as client:
        print(f"connected={client.is_connected}", flush=True)
        try:
            name = await client.read_gatt_char("00002a00-0000-1000-8000-00805f9b34fb")
            print("device name char:", name.decode(errors="replace"), flush=True)
        except Exception as exc:
            print("name read failed:", exc, flush=True)

        for uuid, cb, label in ((MIDI_CHR, on_midi, "BLE MIDI"), (VENDOR_RX, on_vendor, "ae42")):
            try:
                await client.start_notify(uuid, cb)
                print(f"subscribed to {label}", flush=True)
            except Exception as exc:
                print(f"subscribe {label} failed: {exc}", flush=True)

        print(f"\n>>> PRESS NOW <<< footswitch A/B/C, preset up-down, tuner ({LISTEN}s)", flush=True)
        await asyncio.sleep(LISTEN)

        for uuid in (MIDI_CHR, VENDOR_RX):
            try:
                await client.stop_notify(uuid)
            except Exception:
                pass

    print(f"\n=== {len(hits)} notifications ===")


asyncio.run(main())
