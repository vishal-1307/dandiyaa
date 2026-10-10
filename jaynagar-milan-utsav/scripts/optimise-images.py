"""Prepare responsive assets without cropping or changing their contents."""
from pathlib import Path
from PIL import Image

project = Path(__file__).resolve().parents[1]
assets = project / 'dist' / 'assets'
generated = Path('C:/Users/thaku/.codex/generated_images/01a120f6-b097-7842-ae94-9e3d752780cb')
jobs = [
    (generated / 'exec-0a80b79a-0801-495d-9263-8cd7eeb70754.png', 'dandiya-hero-desktop.webp', 1672, 85),
    (generated / 'exec-bbf98c50-9241-4077-af2a-cc998422f107.png', 'dandiya-hero-mobile.webp', 864, 84),
    (assets / 'dandiya-evening.png', 'dandiya-evening-compact.webp', 1000, 82),
    (assets / 'jmu-logo.png', 'jmu-logo-small.webp', 128, 88),
    (assets / 'event-poster.png', 'event-poster-display.webp', 768, 86),
]
for source, name, width, quality in jobs:
    with Image.open(source) as opened:
        photo = opened.convert('RGB')
        if photo.width > width:
            height = round(photo.height * width / photo.width)
            photo = photo.resize((width, height), Image.Resampling.LANCZOS)
        output = assets / name
        photo.save(output, 'WEBP', quality=quality, method=6)
        print(f'{name}: {photo.width}x{photo.height}, {output.stat().st_size:,} bytes')
