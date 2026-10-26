"""Regenerate the checked-in sharing assets with Pillow and FFmpeg."""

import argparse
import math
from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--font', default='/System/Library/Fonts/HelveticaNeue.ttc')
    parser.add_argument('--font-index', type=int, default=10)
    args = parser.parse_args()
    if not Path(args.font).is_file():
        parser.error('Choose an installed font with --font and --font-index.')
    ffmpeg = shutil.which('ffmpeg')
    if not ffmpeg:
        parser.error('Install FFmpeg to encode the sharing video.')

    assets = Path(__file__).resolve().parent / 'assets'
    scale, width, height = 3, 1200, 630
    font = ImageFont.truetype(args.font, 144 * scale, index=args.font_index)
    phrases = ['Draft', 'your writing', 'your app']
    bounds = [font.getbbox(phrase, anchor='ls') for phrase in phrases]
    top = min(box[1] for box in bounds)
    bottom = max(box[3] for box in bounds)
    padding_x, padding_y = 18 * scale, 12 * scale
    box_height = bottom - top + 2 * padding_y
    wave_gap, amplitude = 18 * scale, 3 * scale
    box_y = (height * scale - box_height - wave_gap - amplitude) / 2

    with tempfile.TemporaryDirectory(prefix='draft-social-') as temporary:
        frames = Path(temporary)
        for index, phrase in enumerate(phrases):
            image = Image.new('RGB', (width * scale, height * scale), 'white')
            draw = ImageDraw.Draw(image)
            tracking = -4 * scale
            text_width = font.getlength(phrase) + tracking * (len(phrase) - 1)
            text_x = (width * scale - text_width) / 2
            draw.rounded_rectangle(
                (text_x - padding_x, box_y, text_x + text_width + padding_x, box_y + box_height),
                radius=8 * scale, fill='#f0f0f0',
            )
            baseline = box_y + box_height / 2 - (bounds[index][1] + bounds[index][3]) / 2
            for i, character in enumerate(phrase):
                advance = font.getlength(phrase[:i + 1]) - font.getlength(character)
                draw.text(
                    (text_x + advance + tracking * i, baseline),
                    character, font=font, anchor='ls', fill='#101010',
                )
            wave_y = box_y + box_height + wave_gap
            cycles = max(1, round(text_width / (40 * scale)))
            points = [
                (text_x + text_width * t / 1000, wave_y + amplitude * math.sin(t / 1000 * cycles * math.tau))
                for t in range(1001)
            ]
            draw.line(points, fill='#a3a3a3', width=3 * scale, joint='curve')
            image = image.resize((width, height), Image.Resampling.LANCZOS)
            image.save(frames / f'frame-{index}.png', optimize=True)
            if index == 0:
                image.save(assets / 'og-image.png', optimize=True)

        subprocess.run([
            ffmpeg, '-hide_banner', '-loglevel', 'error', '-y',
            '-framerate', '1/2', '-i', str(frames / 'frame-%d.png'),
            '-vf', 'fps=30', '-frames:v', '180', '-an',
            '-c:v', 'libx264', '-profile:v', 'baseline', '-level:v', '3.1',
            '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow',
            '-movflags', '+faststart', str(assets / 'og-video.mp4'),
        ], check=True)
    print('Created the 1200 × 630 poster and six-second word rotation.')


if __name__ == '__main__':
    main()
