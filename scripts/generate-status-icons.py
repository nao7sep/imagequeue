#!/usr/bin/env python3
"""Generate the approved T2 rounded-card status icons and review specimen."""

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUTPUT_DIR = Path(__file__).resolve().parents[1] / "build" / "status-icons"


def draw_tiles(size: int, fill: str) -> Image.Image:
    # Approved T2 geometry after packaged-menu optical correction: four 7 px
    # rounded cards, no embedded outer padding, a 2 px central gap, and a 2 px
    # radius in a 16 px logical canvas. The status item / notification area
    # supplies its own spacing; transparent rounded corners keep the glyph from
    # reading as a full-bleed app-icon plate.
    # Supersampling preserves the same optical shape at Windows' fractional
    # 125% and 150% tray sizes instead of snapping them into diamonds.
    supersample = 8
    physical_size = size * supersample
    scale = physical_size / 16
    margin = 0
    tile_size = int(7 * scale + 0.5)
    radius = int(2 * scale + 0.5)
    starts = (margin, physical_size - margin - tile_size)
    image = Image.new("RGBA", (physical_size, physical_size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    for y in starts:
        for x in starts:
            draw.rounded_rectangle(
                (x, y, x + tile_size - 1, y + tile_size - 1),
                radius=radius,
                fill=fill,
            )
    return image.resize((size, size), Image.Resampling.LANCZOS)


def save_ico(name: str, fill: str) -> None:
    sizes = (16, 20, 24, 32)
    frames = [draw_tiles(size, fill) for size in sizes]
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
    width, row_height = 1_360, 132
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
    ])

    sheet = Image.new("RGB", (width, 54 + row_height * len(rows)), "#ffffff")
    draw = ImageDraw.Draw(sheet)
    draw.text((20, 16), "ImageQueue T2 rounded-card status icon specimen - native pixels and nearest-neighbor enlargement", fill="#111111", font=font)

    for row_index, (label, background, frames) in enumerate(rows):
        top = 54 + row_index * row_height
        draw.multiline_text((20, top + 12), label, fill="#111111", font=font, spacing=4)
        draw.rectangle((260, top, width - 20, top + row_height - 12), fill=background)
        draw.text((272, top + 8), "native", fill="#777777" if background != "#202020" and background != "#000000" else "#bbbbbb", font=font)
        draw.text((500, top + 8), "enlarged", fill="#777777" if background != "#202020" and background != "#000000" else "#bbbbbb", font=font)

        native_x = 280
        enlarged_x = 500
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
    if args.specimen_output:
        draw_specimen(args.specimen_output)


if __name__ == "__main__":
    main()
