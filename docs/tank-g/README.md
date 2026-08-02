# M-VAVE Tank-G — device API findings

Research notes for wiring a guitar multi-effects pedal to the recorder client.
Everything below was read off the actual hardware on 2026-07-31 unless marked
otherwise. **Nothing here changes this service** — the pedal talks to the
browser client, which then uses the existing `POST /recordings`.

Device is labelled `TANK-Gv2`. Vendor app is **M-EFCS** (Android/iOS/Win/Mac),
shared with Tank-B, MK300, MK20 and Blackbox.

## Verdict

Audio can only come in over **USB**. Bluetooth carries control and
backing-track playback, never the guitar signal.

| Channel | Verified state | Useful for the recorder? |
| --- | --- | --- |
| USB Audio | `Microphone (USB-Audio)` capture + `Speakers (USB-Audio)` render, stock Windows driver | **Yes — this is the recording path** |
| USB MIDI | ports `USB-Midi 0` (in) / `USB-Midi 1` (out) | Yes, for sending commands |
| BLE MIDI | standard MIDI-over-BLE service, see below | Yes, for sending commands wirelessly |
| BLE vendor `ae40` | present, byte format unknown | Only needed for deep editing |
| Classic BT A2DP | pairs as `Headphones (TANK-Gv2)` | No — audio *into* the pedal only |

## BLE

The pedal advertises **two different Bluetooth addresses**. This cost us an
hour: the address Windows pairs with for audio has no LE endpoint at all
(`BluetoothLEDevice.FromBluetoothAddressAsync` returns null), and the BLE
endpoint only shows up in an active scan.

| | Address | Name |
| --- | --- | --- |
| Classic / A2DP | `5B:5A:54:3E:DE:38` | `TANK-Gv2` |
| **BLE** | `5B:5A:54:0F:DC:D3` | `TANK-Gv2_BLE` |

Advertisement also carries manufacturer data: company id `0x6973`, payload
`6E 63 6F`.

GATT dump (`blescan.py`):

```
SERVICE 00001800-0000-1000-8000-00805f9b34fb   Generic Access
   CHAR 00002a00  read, write                       Device Name -> "TANK-Gv2_BLE"

SERVICE 0000ae40-0000-1000-8000-00805f9b34fb   vendor specific (M-VAVE)
   CHAR 0000ae41  write-without-response            TX, command dispatch
   CHAR 0000ae42  notify (+ CCCD 2902)              RX, state dump

SERVICE 03b80e5a-ede8-4b33-a751-6ce34ec4c700   standard BLE MIDI
   CHAR 7772e5db-3868-4112-a1a9-f2669d106bf3        write-without-response, read, notify
```

None of these UUIDs are on the [Web Bluetooth GATT blocklist][blocklist], so
Chrome can talk to both the MIDI service and the vendor service directly.

The `ae40 / ae41 / ae42` triple matches the reverse-engineered M-Vave Blackbox
protocol documented at [jvsobrinho/mvave-blackbox-ble][blackbox]. Same app, same
vendor, so the framing is *probably* shared — **unverified for Tank-G**. That
repo also notes the USB side wraps the same payloads in MIDI SysEx with
base-128 bit packing.

## USB

Composite device `USB\VID_4C4A&PID_C755`:

| Interface | Class | Exposes |
| --- | --- | --- |
| `MI_00` | USB Audio | `Microphone (USB-Audio)`, `Speakers (USB-Audio)` |
| `MI_03` | USB MIDI | MIDI IN `USB-Midi 0`, MIDI OUT `USB-Midi 1` |

Both bind to in-box Windows drivers; no vendor driver, no ASIO install.

## Client code

```js
// --- audio capture: the three DSP flags MUST be off or the guitar signal is mangled
const devices = await navigator.mediaDevices.enumerateDevices()   // needs a prior permission grant for labels
const pedal = devices.find(d => d.kind === 'audioinput' && /USB-Audio/i.test(d.label))

const stream = await navigator.mediaDevices.getUserMedia({
  audio: {
    deviceId: { exact: pedal.deviceId },
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 2,
    sampleRate: 48000,
  },
})
```

```js
// --- control over USB, Web MIDI
const midi = await navigator.requestMIDIAccess({ sysex: true })
const out = [...midi.outputs.values()].find(p => /USB-Midi/i.test(p.name))
out.send([0xC0, 5])           // Program Change -> preset 6
out.send([0xB0, 0x0B, 100])   // Control Change
```

```js
// --- control over BLE, Web Bluetooth
const MIDI_SVC = '03b80e5a-ede8-4b33-a751-6ce34ec4c700'
const MIDI_CHR = '7772e5db-3868-4112-a1a9-f2669d106bf3'

const dev = await navigator.bluetooth.requestDevice({
  filters: [{ namePrefix: 'TANK-G' }],
  optionalServices: [MIDI_SVC, '0000ae40-0000-1000-8000-00805f9b34fb'],
})
const chr = await (await (await dev.gatt.connect()).getPrimaryService(MIDI_SVC))
  .getCharacteristic(MIDI_CHR)

await chr.startNotifications()
chr.addEventListener('characteristicvaluechanged', e => {
  const b = new Uint8Array(e.target.value.buffer)
  console.log('midi', [...b.slice(2)])     // first two bytes are the BLE MIDI header + timestamp
})

const ts = performance.now() & 0x1fff      // send: [0x80|ts>>7, 0x80|ts&0x7F, ...midi]
await chr.writeValueWithoutResponse(
  new Uint8Array([0x80 | (ts >> 7), 0x80 | (ts & 0x7f), 0xC0, 5]))
```

Web MIDI and Web Bluetooth are Chrome/Edge only, need HTTPS or localhost, and
require a user gesture. `sysex: true` triggers its own permission prompt.

## What we could not establish

**The pedal never sent us anything.** Three listening windows, ~145 s total,
zero inbound messages:

- USB MIDI IN, 60 s — nothing
- USB MIDI IN, 45 s, after universal identity requests `F0 7E 7F 06 01 F7` and
  `F0 7E 00 06 01 F7` — no reply to either
- BLE, 40 s, subscribed to both the MIDI characteristic and `ae42` — nothing

Two readings we cannot separate yet: the pedal only receives and never reports
state, or no footswitch was pressed inside a listening window. Resolve this
before designing anything that depends on reading pedal state.

We also never sent a Program Change to the pedal — deliberately, to avoid
changing device state.

## Next session

Goal is the `ae40` byte format, which needs a capture of the M-EFCS app talking
to the pedal.

1. Android → Developer options → **Bluetooth HCI snoop log = Enabled**, then
   toggle Bluetooth off and on (the log does not start otherwise).
2. In M-EFCS: connect, idle 5 s, preset 1→2→3, toggle one effect off/on, sweep
   gain slowly, open the IR list. ~3 s between steps, write down the order.
3. Developer options → **Take bug report → Full report**. The log lands at
   `FS/data/misc/bluetooth/logs/btsnoop_hci.log` inside the zip.
4. Get the zip onto the PC — sharing it to yourself over LINE/email/Drive is far
   easier than USB, which we never got working (see below).
5. `python btsnoop.py <bugreport.zip>` — prints every ATT write/notify by handle
   and reassembles fragmented packets. Blackbox uses handles `0x0062` (ae41) and
   `0x0064` (ae42); expect something similar.
6. Turn the snoop log back off afterwards.

A shortcut worth trying first: press footswitches during another BLE listening
window. If the pedal does report state, the `ae40` work may be unnecessary.

## Tools in this folder

Written and used during this session. They need `python-rtmidi` and `bleak`:

```
python -m venv venv && venv/Scripts/pip install python-rtmidi bleak
```

| Script | Purpose |
| --- | --- |
| `blescan.py` | BLE scan, then connect and dump every service/characteristic |
| `ble-listen.py` | subscribe to the MIDI characteristic and `ae42`, print notifications |
| `sniff.py` | log everything arriving on USB MIDI IN, decoded |
| `probe.py` | send identity requests over USB MIDI, then listen |
| `btsnoop.py` | decode ATT traffic out of an Android `btsnoop_hci.log` or bugreport zip |

Environment gotchas, both cost real time:

- **PowerShell 5.1 cannot subscribe to WinRT events**, so `BluetoothLEAdvertisementWatcher`
  is unusable from PowerShell. Async WinRT calls do work via `AsTask`.
- **`midiInOpen` returns `MMSYSERR_BADDEVICEID` whenever a callback is supplied**
  on this machine — raw function pointer, delegate, any flags. Passing null
  succeeds, which makes it useless. Use `python-rtmidi` instead of P/Invoke.
- Getting `adb` onto the phone never worked: USB debugging did not produce an
  ADB interface (`MI_01` enumerated as CDC Serial), and MTP showed the device
  but no storage. Skip USB next time.

## If pedal state ends up in a recording

Storing the active patch name per take means touching `RecordingMetadata` in
[`src/recordings/recording.types.ts`](../../src/recordings/recording.types.ts),
which is **a breaking change for every client** — they all mirror that file.

[blocklist]: https://github.com/WebBluetoothCG/registries/blob/master/gatt_blocklist.txt
[blackbox]: https://github.com/jvsobrinho/mvave-blackbox-ble
