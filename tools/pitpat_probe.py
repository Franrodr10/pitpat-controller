#!/usr/bin/env python3
"""Protocol probe for PitPat treadmills (BLE name "PitPat-T01").

Connects to the treadmill, prints its GATT table, logs the status
notifications and lets you send start / speed / pause / stop commands from the
keyboard. It exists to verify docs/PROTOCOL.md against a real treadmill.

    pip install bleak
    python pitpat_probe.py              # scan, connect, interactive prompt
    python pitpat_probe.py --selftest   # offline check of the packet code

The belt WILL move when you start it: keep the remote at hand.
An empty line (just Enter) sends STOP.
"""

from __future__ import annotations

import argparse
import asyncio
import datetime as dt
import platform
import sys
import threading
import time
from dataclasses import dataclass

# ----------------------------------------------------------------- protocol

SERVICE_UUID = "0000fba0-0000-1000-8000-00805f9b34fb"
WRITE_UUID = "0000fba1-0000-1000-8000-00805f9b34fb"
NOTIFY_UUID = "0000fba2-0000-1000-8000-00805f9b34fb"
# Vendor service 0x1910. Unused by the references for this model; kept for experiments.
AUX_NOTIFY_UUID = "00002b10-0000-1000-8000-00805f9b34fb"
AUX_WRITE_UUID = "00002b11-0000-1000-8000-00805f9b34fb"

END_BYTE = 0x43
COMMAND_START_BYTE = 0x6A
OP_STOP, OP_PAUSE, OP_START = 0x00, 0x02, 0x04
MODE_START, MODE_SPEED = 1, 5
DEFAULT_WEIGHT_KG = 80
DEFAULT_USER_ID = 58965456623
HEARTBEAT = bytes.fromhex("6a05fdf843")

MIN_KMH = 1.0
MAX_KMH = 6.0

STATE_NAMES = {0x18: "cuenta atrás", 0x08: "en marcha", 0x10: "en pausa", 0x00: "parada"}


def checksum(frame: bytes) -> int:
    """XOR of every byte between the start byte and the checksum byte."""
    value = 0
    for b in frame[1:-2]:
        value ^= b
    return value


def is_valid_frame(frame: bytes) -> bool:
    return (len(frame) >= 5 and frame[1] == len(frame)
            and frame[-1] == END_BYTE and frame[-2] == checksum(frame))


def clamp_speed(kmh: float) -> float:
    return round(min(max(kmh, MIN_KMH), MAX_KMH), 1)


def build_command(op: int, kmh: float = 0.0, mode: int = MODE_START,
                  weight_kg: int = DEFAULT_WEIGHT_KG, user_id: int = DEFAULT_USER_ID) -> bytes:
    frame = bytearray(23)
    frame[0] = COMMAND_START_BYTE
    frame[1] = len(frame)
    frame[6:8] = round(kmh * 1000).to_bytes(2, "big")
    frame[8] = mode
    frame[10] = weight_kg
    frame[12] = op  # bit 3 clear = metric units
    frame[13:21] = user_id.to_bytes(8, "big")
    frame[21] = checksum(frame)
    frame[22] = END_BYTE
    return bytes(frame)


def cmd_start(kmh: float) -> bytes:
    return build_command(OP_START, clamp_speed(kmh), MODE_START)


def cmd_speed(kmh: float) -> bytes:
    return build_command(OP_START, clamp_speed(kmh), MODE_SPEED)


def cmd_pause() -> bytes:
    return build_command(OP_PAUSE)


def cmd_stop() -> bytes:
    return build_command(OP_STOP)


@dataclass
class Status:
    speed: float  # km/h
    target_speed: float  # km/h
    distance_km: float
    incline: int
    target_incline: int
    heart_rate: int
    steps: int
    kcal: int
    duration_raw: int
    cycle: int
    firmware: int
    flags: int
    max_speed: float  # km/h
    max_incline: int

    @property
    def state(self) -> str:
        return STATE_NAMES[self.flags & 0x18]

    @property
    def duration_s(self) -> float:
        # Firmware > 19 reports milliseconds, older firmware seconds.
        return self.duration_raw / 1000 if self.firmware > 19 else float(self.duration_raw)

    def summary(self) -> str:
        return (f"{self.state} v={self.speed:.2f} (obj {self.target_speed:.2f}) km/h "
                f"d={self.distance_km:.3f} km t={self.duration_s:.0f} s pasos={self.steps} "
                f"kcal={self.kcal} fw={self.firmware} flags=0x{self.flags:02X} "
                f"máx={self.max_speed:.1f} incl={self.incline}/{self.max_incline}")


def parse_status(frame: bytes) -> Status | None:
    if len(frame) < 31:
        return None

    def u16(offset: int) -> int:
        return int.from_bytes(frame[offset:offset + 2], "big")

    def u32(offset: int) -> int:
        return int.from_bytes(frame[offset:offset + 4], "big")

    return Status(
        speed=u16(3) / 1000, target_speed=u16(5) / 1000, distance_km=u32(7) / 1000,
        incline=frame[11], target_incline=frame[12], heart_rate=frame[13],
        steps=u32(14), kcal=u16(18), duration_raw=u32(20), cycle=frame[24],
        firmware=frame[25], flags=frame[26], max_speed=u16(27) / 1000, max_incline=frame[29])


class Reassembler:
    """Rebuilds frames split across several notifications (small ATT MTU)."""

    GAP_S = 0.3  # continuations arrive within milliseconds; a longer gap starts a new frame

    def __init__(self) -> None:
        self.buf = bytearray()
        self.last = 0.0

    def feed(self, chunk: bytes, now: float) -> tuple[list[bytes], bytes | None]:
        """Returns the complete frames and any stale partial data that was dropped."""
        dropped = None
        if self.buf and now - self.last > self.GAP_S:
            dropped = bytes(self.buf)
            self.buf.clear()
        self.last = now
        self.buf += chunk
        frames = []
        while len(self.buf) >= 2:
            length = self.buf[1]
            if length < 5:  # not a length byte: pass the data through as-is
                frames.append(bytes(self.buf))
                self.buf.clear()
            elif len(self.buf) >= length:
                frames.append(bytes(self.buf[:length]))
                del self.buf[:length]
            else:
                break
        return frames, dropped


# Bytes that change every second while walking (counters) and the checksum.
COUNTER_BYTES = {3, 4, *range(7, 11), *range(14, 24)}


def hexs(data: bytes) -> str:
    return data.hex(" ").upper()


def mask_address(address: str) -> str:
    """Hides most of the MAC (or macOS UUID) so logs can be shared."""
    if ":" in address:
        parts = address.split(":")
        return ":".join(["XX"] * (len(parts) - 2) + parts[-2:])
    return "…" + address[-4:]


# ------------------------------------------------------------------- probe

HELP = """Comandos (Enter sin nada = PARAR):
  a [km/h]      arrancar (por defecto a la velocidad objetivo actual; "a 0" = sin velocidad)
  v <km/h>      fijar velocidad (solo con la cinta en marcha)
  + / -         subir / bajar 0,5 km/h
  p             pausa
  s             PARAR
  hb off|react|1s   heartbeat: nunca / tras cada notificación / cada segundo
  pasiva        prueba sin mover la cinta: compara los modos de heartbeat (80 s)
  raw <hex> [2b11]  envía bytes tal cual a FBA1 (o a 2B11)
  aux           suscribirse también a 2B10 (experimental)
  detalle on|off    registrar todas las tramas
  estado        mostrar el último estado
  soltar        desconectar SIN parar la cinta (prueba de seguridad)
  q             parar y salir"""


class Probe:
    PASSIVE_PHASES = (("react", 20), ("1s", 20), ("off", 40))  # heartbeat mode, seconds

    def __init__(self, client, log_file, hb_mode: str, verbose: bool) -> None:
        self.client = client
        self.log_file = log_file
        self.hb_mode = hb_mode
        self.verbose = verbose
        self.t0 = time.monotonic()
        self.write_lock = asyncio.Lock()
        self.hb_pending = False
        self.hb_count = 0
        self.frames = 0
        self.fragmented_noted = False
        self.reassembler = Reassembler()
        self.status: Status | None = None
        self.last_logged: tuple[bytes, float, float] | None = None  # frame, time, speed
        self.skipped = 0
        self.target_kmh = 2.0
        self.disconnected = asyncio.Event()

    def log(self, message: str) -> None:
        line = f"+{time.monotonic() - self.t0:9.3f}s  {message}"
        print(line, flush=True)
        if self.log_file:
            self.log_file.write(line + "\n")
            self.log_file.flush()

    # --- incoming data

    def on_notify(self, _char, data: bytearray) -> None:
        now = time.monotonic()
        chunk = bytes(data)
        if len(chunk) < 2 or chunk[1] != len(chunk):
            if self.verbose or not self.fragmented_noted:
                self.log(f"<- fragmento [{len(chunk)}] {hexs(chunk)}")
                self.fragmented_noted = True
        frames, dropped = self.reassembler.feed(chunk, now)
        if dropped:
            self.log(f"!! fragmento incompleto descartado [{len(dropped)}] {hexs(dropped)}")
        for frame in frames:
            self.on_frame(frame, now)

    def on_aux_notify(self, _char, data: bytearray) -> None:
        self.log(f"<- 2B10 [{len(data)}] {hexs(bytes(data))}")

    def on_frame(self, frame: bytes, now: float) -> None:
        self.frames += 1
        valid = is_valid_frame(frame)
        status = parse_status(frame) if valid else None
        if status:
            self.status = status
        if self.should_log(frame, status, valid, now):
            text = f"<- [{len(frame)}] {hexs(frame)} | {'OK' if valid else 'TRAMA NO VÁLIDA'}"
            if status:
                text += f" | {status.summary()}"
            if self.skipped:
                text += f" (+{self.skipped} sin cambios)"
            self.log(text)
            self.last_logged = (frame, now, status.speed if status else 0.0)
            self.skipped = 0
        else:
            self.skipped += 1
        if self.hb_mode == "react":
            self.maybe_heartbeat()

    def should_log(self, frame: bytes, status: Status | None, valid: bool, now: float) -> bool:
        if self.verbose or not valid or self.last_logged is None:
            return True
        last, last_time, last_speed = self.last_logged
        if len(last) != len(frame) or now - last_time >= 5:
            return True
        if status and abs(status.speed - last_speed) >= 0.1:
            return True
        ignored = COUNTER_BYTES | {len(frame) - 2}
        return any(a != b for i, (a, b) in enumerate(zip(frame, last)) if i not in ignored)

    def on_disconnect(self, _client) -> None:
        self.log("!! DESCONECTADO")
        self.disconnected.set()

    # --- outgoing data

    async def write(self, data: bytes, label: str, uuid: str = WRITE_UUID) -> None:
        async with self.write_lock:
            quiet = label == "heartbeat" and not self.verbose
            if not quiet:
                self.log(f"-> {uuid[4:8].upper()} [{len(data)}] {hexs(data)}  ({label})")
            try:
                await self.client.write_gatt_char(uuid, data, response=True)
                if label == "heartbeat":
                    self.hb_count += 1
            except Exception as exc:  # noqa: BLE001 - log whatever the backend raises
                self.log(f"!! error al escribir ({label}): {exc}")

    def maybe_heartbeat(self) -> None:
        if self.hb_pending or self.write_lock.locked() or not self.client.is_connected:
            return
        self.hb_pending = True

        async def send() -> None:
            try:
                await self.write(HEARTBEAT, "heartbeat")
            finally:
                self.hb_pending = False

        asyncio.ensure_future(send())

    async def heartbeat_loop(self) -> None:
        while not self.disconnected.is_set():
            await asyncio.sleep(1.0)
            if self.hb_mode == "1s":
                self.maybe_heartbeat()

    # --- commands

    def is_moving(self) -> bool:
        return self.status is not None and self.status.state in ("en marcha", "cuenta atrás")

    async def stop(self) -> None:
        await self.write(cmd_stop(), "PARAR")

    async def set_speed(self, kmh: float) -> None:
        self.target_kmh = clamp_speed(kmh)
        if not self.is_moving():
            self.log(f"   la cinta no está en marcha: objetivo {self.target_kmh:.1f} km/h guardado para 'a'")
            return
        await self.write(cmd_speed(self.target_kmh), f"velocidad {self.target_kmh:.1f} km/h")

    async def handle(self, line: str) -> bool:
        """Runs one command. Returns False when the probe should exit."""
        words = line.split()
        cmd, args = (words[0].lower(), words[1:]) if words else ("s", [])
        try:
            if cmd in ("s", "parar", "stop"):
                await self.stop()
            elif cmd in ("a", "arrancar") and args and float(args[0].replace(",", ".")) == 0:
                # Variant used by pacekeeper: no speed, the treadmill picks its own.
                await self.write(build_command(OP_START), "arrancar sin velocidad")
            elif cmd in ("a", "arrancar"):
                if args:
                    self.target_kmh = clamp_speed(float(args[0].replace(",", ".")))
                await self.write(cmd_start(self.target_kmh), f"arrancar a {self.target_kmh:.1f} km/h")
            elif cmd in ("v", "vel"):
                await self.set_speed(float(args[0].replace(",", ".")))
            elif cmd in ("+", "-"):
                await self.set_speed(self.target_kmh + (0.5 if cmd == "+" else -0.5))
            elif cmd in ("p", "pausa"):
                await self.write(cmd_pause(), "pausa")
            elif cmd == "hb" and args and args[0] in ("off", "react", "1s"):
                self.hb_mode = args[0]
                self.log(f"   heartbeat: {self.hb_mode}")
            elif cmd == "pasiva":
                await self.passive_test()
            elif cmd == "raw" and args:
                data = bytes.fromhex(args[0])
                uuid = AUX_WRITE_UUID if args[1:] == ["2b11"] else WRITE_UUID
                self.log(f"   checksum {'correcto' if is_valid_frame(data) else 'NO válido'}")
                await self.write(data, "raw", uuid)
            elif cmd == "aux":
                await self.client.start_notify(AUX_NOTIFY_UUID, self.on_aux_notify)
                self.log("   suscrito a 2B10")
            elif cmd == "detalle" and args:
                self.verbose = args[0] == "on"
            elif cmd == "estado":
                self.log(f"   {self.status.summary() if self.status else 'sin datos todavía'}"
                         f" | tramas={self.frames} heartbeats={self.hb_count} hb={self.hb_mode}")
            elif cmd == "soltar":
                self.log("   desconectando SIN parar la cinta")
                await self.client.disconnect()
                return False
            elif cmd in ("q", "salir"):
                return False
            else:
                print(HELP)
        except (ValueError, IndexError) as exc:
            print(f"Comando no válido ({exc}).\n{HELP}")
        return True

    async def passive_test(self) -> None:
        if self.is_moving():
            self.log("   la prueba pasiva es con la cinta parada")
            return
        previous = self.hb_mode
        results = []
        for mode, seconds in self.PASSIVE_PHASES:
            self.hb_mode = mode
            frames0, hb0, start = self.frames, self.hb_count, time.monotonic()
            self.log(f"== prueba pasiva: heartbeat={mode} durante {seconds} s")
            while time.monotonic() - start < seconds and not self.disconnected.is_set():
                await asyncio.sleep(0.2)
            elapsed = max(time.monotonic() - start, 0.001)
            frames = self.frames - frames0
            results.append(f"   hb={mode:5} {frames:4d} tramas en {elapsed:4.1f} s "
                           f"({frames / elapsed:.2f}/s), {self.hb_count - hb0} heartbeats"
                           + ("" if not self.disconnected.is_set() else " — SE DESCONECTÓ"))
            if self.disconnected.is_set():
                break
        self.hb_mode = previous
        self.log("== resultado de la prueba pasiva:\n" + "\n".join(results))

    async def run(self, use_aux: bool) -> None:
        self.log(f"Conectado. MTU={getattr(self.client, 'mtu_size', '?')}")
        for service in self.client.services:
            self.log(f"SERVICIO {service.uuid} ({service.description})")
            for char in service.characteristics:
                self.log(f"   CARACT. {char.uuid} [{','.join(char.properties)}]")
        await self.client.start_notify(NOTIFY_UUID, self.on_notify)
        self.log(f"Suscrito a FBA2. Heartbeat: {self.hb_mode}. Escribe 'ayuda' para ver los comandos.")
        if use_aux:
            await self.handle("aux")

        lines: asyncio.Queue[str | None] = asyncio.Queue()
        loop = asyncio.get_running_loop()

        def read_stdin() -> None:
            for text in sys.stdin:
                loop.call_soon_threadsafe(lines.put_nowait, text)
            loop.call_soon_threadsafe(lines.put_nowait, None)

        threading.Thread(target=read_stdin, daemon=True).start()
        heartbeat = asyncio.ensure_future(self.heartbeat_loop())
        stop_on_exit = True
        try:
            while not self.disconnected.is_set():
                next_line = asyncio.ensure_future(lines.get())
                gone = asyncio.ensure_future(self.disconnected.wait())
                done, _ = await asyncio.wait({next_line, gone}, return_when=asyncio.FIRST_COMPLETED)
                gone.cancel()
                if next_line not in done:
                    next_line.cancel()
                    break
                text = next_line.result()
                if text is not None and text.strip().lower() == "soltar":
                    stop_on_exit = False
                if text is None or not await self.handle(text.strip()):
                    break
        finally:
            heartbeat.cancel()
            # Always stop: the last status may predate a start command we just sent.
            if stop_on_exit and self.client.is_connected:
                await self.stop()
            if self.client.is_connected:
                await self.client.disconnect()


# -------------------------------------------------------------------- main

async def find_treadmill(prefix: str, timeout: float):
    from bleak import BleakScanner

    print(f"Buscando cintas durante {timeout:.0f} s…")
    found = await BleakScanner.discover(timeout=timeout, return_adv=True)
    candidates = []
    for device, adv in found.values():
        name = adv.local_name or device.name or ""
        if name.startswith(prefix) or SERVICE_UUID in [u.lower() for u in adv.service_uuids]:
            candidates.append((device, name, adv.rssi))
    if not candidates:
        print("No se ha encontrado ninguna cinta. Comprueba que está encendida, que la app PitPat "
              "está cerrada (solo admite una conexión) y que el Bluetooth del PC está activo.")
        return None
    candidates.sort(key=lambda c: -c[2])
    for i, (device, name, rssi) in enumerate(candidates):
        print(f"  [{i}] {name or '(sin nombre)'}  {mask_address(device.address)}  RSSI {rssi} dBm")
    if len(candidates) == 1:
        return candidates[0][0]
    choice = input("Elige el número de la cinta: ")
    return candidates[int(choice)][0]


async def main_async(args: argparse.Namespace) -> None:
    from importlib.metadata import version

    from bleak import BleakClient

    target = args.address or await find_treadmill(args.name, args.scan)
    if target is None:
        return
    log_path = args.log or dt.datetime.now().strftime("pitpat_log_%Y%m%d_%H%M%S.txt")
    with open(log_path, "w", encoding="utf-8") as log_file:
        log_file.write(f"# pitpat_probe {dt.datetime.now().isoformat(timespec='seconds')} "
                       f"{platform.system()} {platform.release()} python {platform.python_version()} "
                       f"bleak {version('bleak')}\n")
        probe: Probe | None = None

        def on_disconnect(client) -> None:
            if probe:
                probe.on_disconnect(client)

        address = target if isinstance(target, str) else target.address
        print(f"Conectando a {mask_address(address)}…")
        async with BleakClient(target, disconnected_callback=on_disconnect, timeout=20) as client:
            probe = Probe(client, log_file, args.hb, args.verbose)
            await probe.run(args.aux)
    print(f"Registro guardado en {log_path}")


def selftest() -> None:
    checks = 0

    def check(condition: bool, what: str) -> None:
        nonlocal checks
        if not condition:
            raise AssertionError(what)
        checks += 1

    # Frames published by other projects, to validate the checksum independently.
    for known in ("6A05FDF843", "6A05D7D243", "6B059D9843",
                  "6A1700000000000005008A0002000000000012"
                  "2E0CAA43"):
        check(is_valid_frame(bytes.fromhex(known)), f"checksum de {known}")

    expected = {
        "arrancar 2,0": (cmd_start(2.0), "6A 17 00 00 00 00 07 D0 01 00 50 00 04 00 00 00 0D BA 9D 76 EF 26 43"),
        "velocidad 3,0": (cmd_speed(3.0), "6A 17 00 00 00 00 0B B8 05 00 50 00 04 00 00 00 0D BA 9D 76 EF 46 43"),
        "pausa": (cmd_pause(), "6A 17 00 00 00 00 00 00 01 00 50 00 02 00 00 00 0D BA 9D 76 EF F7 43"),
        "parar": (cmd_stop(), "6A 17 00 00 00 00 00 00 01 00 50 00 00 00 00 00 0D BA 9D 76 EF F5 43"),
    }
    for name, (frame, hex_text) in expected.items():
        check(hexs(frame) == hex_text, f"trama '{name}': {hexs(frame)}")
    check(cmd_speed(9.9) == cmd_speed(6.0) and cmd_start(0.2) == cmd_start(1.0), "límites de velocidad")

    frame = example_status_frame()
    check(is_valid_frame(frame), "trama de estado de ejemplo")
    status = parse_status(frame)
    check(status is not None and status.state == "en marcha", "estado")
    check((status.speed, status.target_speed, status.distance_km) == (3.5, 3.5, 1.234), "velocidad/distancia")
    check((status.steps, status.kcal, status.duration_s) == (1520, 56, 754.0), "pasos/kcal/duración")
    check((status.max_speed, status.max_incline, status.firmware) == (6.0, 0, 27), "límites/firmware")

    reassembler = Reassembler()
    out = []
    for i in range(0, len(frame), 20):  # default ATT MTU of 23 leaves 20 bytes per notification
        out += reassembler.feed(frame[i:i + 20], 0.0)[0]
    check(out == [frame], "reensamblado de fragmentos")
    partial, _ = reassembler.feed(frame[:20], 0.0)
    _, dropped = reassembler.feed(frame, 1.0)
    check(partial == [] and dropped == frame[:20], "descarte de fragmentos huérfanos")

    print(f"Autotest OK ({checks} comprobaciones)")


def example_status_frame() -> bytes:
    """Synthetic 52-byte status frame: walking at 3.5 km/h, fake serial number."""
    frame = bytearray(52)
    frame[0], frame[1] = 0x68, len(frame)
    frame[3:5] = (3500).to_bytes(2, "big")  # current speed
    frame[5:7] = (3500).to_bytes(2, "big")  # target speed
    frame[7:11] = (1234).to_bytes(4, "big")  # distance (m)
    frame[14:18] = (1520).to_bytes(4, "big")  # steps
    frame[18:20] = (56).to_bytes(2, "big")  # kcal
    frame[20:24] = (754_000).to_bytes(4, "big")  # duration (ms)
    frame[24], frame[25], frame[26] = 0x2A, 27, 0x08  # cycle, firmware, flags = running
    frame[27:29] = (6000).to_bytes(2, "big")  # max speed
    frame[30] = 5  # device type
    frame[32:48] = b"EXAMPLE-SERIAL00"
    frame[50] = checksum(frame)
    frame[51] = END_BYTE
    return bytes(frame)


def main() -> None:
    parser = argparse.ArgumentParser(description="Prueba del protocolo BLE de cintas PitPat.")
    parser.add_argument("--selftest", action="store_true", help="comprobar el código de tramas sin Bluetooth")
    parser.add_argument("--address", help="dirección BLE de la cinta (si no, se escanea)")
    parser.add_argument("--name", default="PitPat", help="prefijo del nombre BLE (por defecto PitPat)")
    parser.add_argument("--scan", type=float, default=8.0, help="segundos de escaneo")
    parser.add_argument("--hb", choices=("off", "react", "1s"), default="off", help="modo de heartbeat inicial")
    parser.add_argument("--aux", action="store_true", help="suscribirse también a 2B10")
    parser.add_argument("--verbose", action="store_true", help="registrar todas las tramas")
    parser.add_argument("--log", help="fichero de registro")
    args = parser.parse_args()
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(errors="replace")  # never crash on a console without UTF-8
    if args.selftest:
        selftest()
        return
    try:
        asyncio.run(main_async(args))
    except KeyboardInterrupt:
        print("\nInterrumpido.")
    except Exception as exc:  # each bleak backend raises its own errors
        if not (type(exc).__module__.startswith("bleak")
                or isinstance(exc, (OSError, asyncio.TimeoutError))):
            raise
        sys.exit(f"Error de Bluetooth ({type(exc).__name__}): {exc}\n"
                 "Comprueba que el Bluetooth del PC está activado, la cinta encendida "
                 "y la app PitPat cerrada.")


if __name__ == "__main__":
    main()
