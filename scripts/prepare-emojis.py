"""Prepare Brian's emoji.gg collection for the Discord application emoji API."""
import base64
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from zipfile import ZipFile

LIMIT = 256 * 1024
CATALOG = Path(__file__).resolve().parents[1] / "src" / "emoji-pack.json"


def prepare(archive):
    catalog = json.loads(CATALOG.read_text(encoding="utf-8"))
    images = {}
    with ZipFile(archive) as source:
        for alias, item in catalog.items():
            entry = source.getinfo(item["file"])
            if entry.file_size > 800_000:
                raise ValueError("Tamaño inesperado")
            data = source.read(entry)
            if hashlib.sha256(data).hexdigest() != item["sha256"]:
                raise ValueError("La imagen no coincide con la colección")
            image_type = Path(entry.filename).suffix[1:].lower()
            if len(data) > LIMIT:
                # Mantiene movimiento y transparencia en el único GIF que excede el límite.
                filters = "fps=10,scale=72:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=80[p];[b][p]paletteuse"
                data = subprocess.run(
                    ["ffmpeg", "-v", "error", "-filter_complex_threads", "1", "-i", "pipe:0",
                     "-filter_complex", filters, "-loop", "0", "-f", "gif", "pipe:1"],
                    input=data, capture_output=True, check=True, timeout=12,
                ).stdout
            if not 0 < len(data) <= LIMIT:
                raise ValueError("La imagen supera el límite de Discord")
            images[alias] = "data:image/" + image_type + ";base64," + base64.b64encode(data).decode("ascii")
    return images


if __name__ == "__main__":
    print(json.dumps(prepare(sys.argv[1])))
