#!/usr/bin/env python3
"""Generate placeholder native status icons and an optional review specimen."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUTPUT_DIR = Path(__file__).resolve().parents[1] / "build" / "status-icons"


def tile_boxes(size: int) -> list[tuple[int, int, int, int]]:
    # Native 16 px geometry: 5 px tiles, a 2 px gap, and a 2 px margin.
    scale = size / 16
    starts = (round(2 * scale), round(9 * scale))
    tile_size = round(5 * scale)
    return [
        (x, y, x + tile_size - 1, y + tile_size - 1)
        for y in starts
        for x in starts
    ]


def draw_tiles(size: int, fill: str, outline: str | None = None) -> Image.Image:
    image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    width = max(1, round(size / 16)) if outline else 0
    for box in tile_boxes(size):
        draw.rectangle(box, fill=fill, outline=outline, width=width)
    return image


def save_ico(name: str, fill: str, outline: str | None = None) -> None:
    sizes = (16, 20, 24, 32)
    frames = [draw_tiles(size, fill, outline) for size in sizes]
    frames[-1].save(
        OUTPUT_DIR / name,
        format="ICO",
        append_images=frames[:-1],
        sizes=[(size, size) for size in sizes],
    )


def recolor_template(image: Image.Image, fill: str) -> Image.Image:
    result = Image.new("RGBA", image.size, fill)
    result.putalpha(image.getchannel("A"))
    return result


def ico_frames(path: Path) -> list[Image.Image]:
    with Image.open(path) as icon:
        return [icon.ico.getimage((size, size)).convert("RGBA") for size in (16, 20, 24, 32)]


def draw_specimen(output_path: Path) -> None:
    font = ImageFont.load_default()
    width, row_height = 1_240, 132
    rows: list[tuple[str, str, list[Image.Image]]] = []

    for filename in ("ImageQueueStatusTemplate.png", "ImageQueueStatusTemplate@2x.png"):
        with Image.open(OUTPUT_DIR / filename) as template_file:
            template = template_file.convert("RGBA")
        rows.extend([
            (f"macOS light\n{filename}", "#f2f2f2", [template]),
            (f"macOS dark (system template preview)\n{filename}", "#242424", [recolor_template(template, "white")]),
        ])

    rows.extend([
        ("Windows light\nImageQueueStatusLight.ico", "#f3f3f3", ico_frames(OUTPUT_DIR / "ImageQueueStatusLight.ico")),
        ("Windows dark\nImageQueueStatusDark.ico", "#202020", ico_frames(OUTPUT_DIR / "ImageQueueStatusDark.ico")),
        ("Windows high contrast\nImageQueueStatusHighContrast.ico", "#000000", ico_frames(OUTPUT_DIR / "ImageQueueStatusHighContrast.ico")),
    ])

    sheet = Image.new("RGB", (width, 54 + row_height * len(rows)), "#ffffff")
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 16), "ImageQueue placeholder status icon specimen - native pixels and nearest-neighbor enlargement", fill="#111111", font=font)

    for row_index, (label, background, frames) in enumerate(rows):
        top = 54 + row_index * row_height
        draw.multiline_text((20, top + 12), label, fill="#111111", font=font, spacing=4)
        draw.rectangle((260, top, width - 20, top + row_height - 12), fill=background)
        draw.text((272, top + 8), "native", fill="#777777" if background != "#202020" and background != "#000000" else "#bbbbbb", font=font)
        draw.text((450, top + 8), "enlarged", fill="#777777" if background != "#202020" and background != "#000000" else "#bbbbbb", font=font)

        native_x = 280
        enlarged_x = 450
        for frame in frames:
            native_y = top + 52
            sheet.paste(frame, (native_x, native_y), frame)
            draw.text((native_x, top + 96), f"{frame.width}px", fill="#777777" if background != "#202020" and background != "#000000" else "#bbbbbb", font=font)
            native_x += 52

            scale = max(1, 80 // frame.width)
            enlarged = frame.resize((frame.width * scale, frame.height * scale), Image.Resampling.NEAREST)
            sheet.paste(enlarged, (enlarged_x, top + 32), enlarged)
            draw.text((enlarged_x, top + 114), f"{frame.width}px source", fill="#777777" if background != "#202020" and background != "#000000" else "#bbbbbb", font=font)
            enlarged_x += 170

    output_path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output_path, format="PNG")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--specimen-output", type=Path)
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    draw_tiles(16, "black").save(OUTPUT_DIR / "ImageQueueStatusTemplate.png", dpi=(72, 72))
    draw_tiles(32, "black").save(OUTPUT_DIR / "ImageQueueStatusTemplate@2x.png", dpi=(144, 144))
    # The appearance names describe the system surface, not the glyph color.
    save_ico("ImageQueueStatusLight.ico", "black")
    save_ico("ImageQueueStatusDark.ico", "white")
    # A white fill with a black keyline remains distinguishable on either
    # extreme used by Windows forced-colors themes.
    save_ico("ImageQueueStatusHighContrast.ico", "white", "black")
    if args.specimen_output:
        draw_specimen(args.specimen_output)


if __name__ == "__main__":
    main()
