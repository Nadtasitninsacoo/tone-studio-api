import asyncio
import sys

from bleak import BleakClient, BleakScanner

SECONDS = int(sys.argv[1]) if len(sys.argv) > 1 else 20


async def main():
    print(f"scanning {SECONDS}s ...", flush=True)
    found = await BleakScanner.discover(timeout=SECONDS, return_adv=True)

    target = None
    for addr, (dev, adv) in sorted(found.items(), key=lambda kv: -(kv[1][1].rssi or -999)):
        name = adv.local_name or dev.name or "-"
        uuids = ", ".join(adv.service_uuids) if adv.service_uuids else "-"
        mfr = {k: v.hex() for k, v in (adv.manufacturer_data or {}).items()}
        print(f"{addr}  rssi={adv.rssi:>4}  name={name!r}  uuids=[{uuids}]  mfr={mfr}", flush=True)
        if "TANK" in name.upper() or "MVAVE" in name.upper() or "CUVAVE" in name.upper():
            target = dev

    if target is None:
        print("\nno TANK/M-VAVE device advertising over BLE")
        return

    print(f"\nconnecting to {target.address} ...", flush=True)
    async with BleakClient(target) as client:
        for svc in client.services:
            print(f"SERVICE {svc.uuid}  ({svc.description})")
            for ch in svc.characteristics:
                print(f"   CHAR {ch.uuid}  props={ch.properties}  desc={ch.description}")
                for d in ch.descriptors:
                    print(f"      DESC {d.uuid}")


asyncio.run(main())
