#!/usr/bin/env python3
"""Scored pixel-diff between an original screenshot and its clone.

Usage:
  python3 pixel_diff.py ORIGINAL.png CLONE.png [--threshold 90.1] [--tolerance 10]
                        [--bands 10] [--out diff-review.png]

Prints the overall match %, PASS/FAIL at --threshold, and a per-band breakdown
of the y-ranges where mismatch concentrates (worst first) to guide fixes.
Optionally writes an annotated review image (mismatches highlighted red,
resized to 640px wide). Exit code: 0 = PASS, 1 = FAIL, 2 = input error.

Only needs Pillow (python3 -m pip install Pillow).
"""
import argparse
import sys

from PIL import Image, ImageChops


def mismatch_mask(img_a: Image.Image, img_b: Image.Image, tolerance: int) -> Image.Image:
    """Binary L-mode mask: 255 where any RGB channel differs by more than tolerance."""
    diff = ImageChops.difference(img_a, img_b)
    chan_masks = [ch.point(lambda v, t=tolerance: 255 if v > t else 0) for ch in diff.split()]
    mask = ImageChops.lighter(chan_masks[0], chan_masks[1])
    return ImageChops.lighter(mask, chan_masks[2])


def main() -> int:
    ap = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    ap.add_argument("original", help="original site screenshot PNG")
    ap.add_argument("clone", help="clone screenshot PNG")
    ap.add_argument("--threshold", type=float, default=90.1,
                    help="minimum match %% to PASS (default 90.1)")
    ap.add_argument("--tolerance", type=int, default=10,
                    help="per-channel difference 0-255 still counted as a match (default 10)")
    ap.add_argument("--bands", type=int, default=10,
                    help="number of vertical bands in the breakdown (default 10)")
    ap.add_argument("--out", help="write annotated diff image to this path")
    args = ap.parse_args()

    try:
        img_a = Image.open(args.original).convert("RGB")
        img_b = Image.open(args.clone).convert("RGB")
    except Exception as exc:  # noqa: BLE001 - report any open/decode failure as input error
        print(f"ERROR: cannot open images: {exc}", file=sys.stderr)
        return 2

    w, h = img_a.size
    if img_b.size != img_a.size:
        print(f"ERROR: image sizes differ: clone {img_b.size}, original {img_a.size}", file=sys.stderr)
        return 2

    mask = mismatch_mask(img_a, img_b, args.tolerance)
    bad = mask.histogram()[255]
    score = 100.0 * (1.0 - bad / (w * h))

    n_bands = max(1, min(args.bands, h))
    band_h = h / n_bands
    bands = []
    for i in range(n_bands):
        top, bot = round(i * band_h), round((i + 1) * band_h)
        b_bad = mask.crop((0, top, w, bot)).histogram()[255]
        b_total = max(1, (bot - top) * w)
        bands.append((100.0 * (1.0 - b_bad / b_total), top, bot))

    verdict = "PASS" if score >= args.threshold else "FAIL"
    print(f"size: {w}x{h}  pixels: {w * h}")
    print(f"match: {score:.2f}%  ->  {verdict} (threshold {args.threshold:.1f}%, "
          f"per-channel tolerance {args.tolerance})")

    weak = sorted(b for b in bands if b[0] < args.threshold)
    if weak:
        print(f"bands below threshold (worst first):")
        for b_score, top, bot in weak[:5]:
            print(f"  y {top}-{bot}: {b_score:.1f}%")
    else:
        print("bands: all bands above threshold")

    if args.out:
        annotated = img_b.copy()
        red = Image.new("RGB", annotated.size, (255, 0, 0))
        annotated.paste(red, (0, 0), mask)
        annotated = annotated.resize((640, max(1, round(h * 640 / w))))
        annotated.save(args.out)
        print(f"annotated diff: {args.out}")

    return 0 if score >= args.threshold else 1


if __name__ == "__main__":
    sys.exit(main())
