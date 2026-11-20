#!/usr/bin/env python3
"""Compare approved T05 PNGs with T35 captures and write the raw scores."""
import argparse
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys

from PIL import Image


BASELINE_HASH = '9bbd164f0c97c0a016fd7cf53801a3c02fa9e9b7fd816ccd578d47e3763838fd'
REPO = Path(__file__).resolve().parent.parent
BASELINES = REPO / 'docs/design/baselines'


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def compare(original, rendered, diff):
    diff.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run([
        sys.executable, str(REPO / 'scripts/pixel_diff.py'), str(original), str(rendered),
        '--threshold', '90.1', '--tolerance', '10', '--bands', '10', '--out', str(diff)
    ], check=False, capture_output=True, text=True)
    match = re.search(r'match: (\d+\.\d+)%', result.stdout)
    return {'score': float(match.group(1)) if match else None,
            'status': {0: 'PASS', 1: 'FAIL', 2: 'SIZE_OR_INPUT_ERROR'}[result.returncode],
            'output': (result.stdout + result.stderr).strip()}


def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('directory', type=Path)
    directory = args.parse_args().directory
    manifest = BASELINES / 'manifest.json'
    if digest(manifest) != BASELINE_HASH:
        raise SystemExit('T05 manifest SHA-256 differs from the approved manifest')
    rows = json.loads(manifest.read_text())
    if len(rows) != 87:
        raise SystemExit('Expected 87 approved baseline images')
    captures = json.loads((directory / 'capture.json').read_text())
    metadata = {(entry['id'], tuple(entry['viewport'])): entry for entry in captures['measurements']}
    expected_views = directory / 'baseline-viewport'
    expected_views.mkdir(exist_ok=True)
    scores = []
    for row in rows:
        name, viewport = row['file'], tuple(row['viewport'])
        original = BASELINES / name
        if digest(original) != row['sha256']:
            raise SystemExit(f'Unapproved baseline bytes for {name}')
        capture = metadata.get((row['scene'], viewport))
        if not capture:
            raise SystemExit(f'Missing capture metadata for {name}')
        with Image.open(original) as image:
            image.crop((0, 0, *viewport)).save(expected_views / name)
        full = directory / 'full' / name
        with Image.open(full) as image:
            size = list(image.size)
        scores.append({
            'file': name, 'fixture': capture['description'], 'sameState': capture['expected'],
            'viewport': viewport, 'baselineSize': row['pixels'], 'actualSize': size,
            'full': compare(original, full, directory / 'diff-full' / name),
            'viewportComparison': compare(expected_views / name, directory / 'viewport' / name, directory / 'diff-viewport' / name)
        })
    (directory / 'scores.json').write_text(json.dumps(scores, ensure_ascii=False, indent=2) + '\n')
    passed = sum(row['full']['status'] == 'PASS' and row['sameState'] for row in scores)
    mismatched = sum(row['baselineSize'] != row['actualSize'] for row in scores)
    preview_pass = sum(row['viewportComparison']['status'] == 'PASS' for row in scores)
    report = [
        '# T35 · So sánh ảnh ứng dụng với T05', '',
        f'Manifest SHA-256 `{BASELINE_HASH}`. Chrome `{captures["chrome"]}` trên `{captures["platform"]}`.', '',
        f'{passed}/87 cặp full-page đạt, {mismatched}/87 cặp lệch kích thước và '
        f'{preview_pass}/87 cặp viewport đạt ngưỡng 90,1%. Tolerance 10, bands 10.', '',
        'Full-page dùng nguyên ảnh. Cột viewport chấm cùng kích thước ở scroll 0 và không thay cho kết quả full-page.', '',
        'Fixture đã duyệt dùng `A11A20262027` cho `VV10A1` ở join-class, `nguyen_an` và `tran_mai` cho '
        '`nguyen.an` và `tran.mai` ở admin-teachers, `an_` cho `an` ở class-members và class-import. '
        'Phép so tính cả các vùng chữ này.', '',
        '| Ảnh | Full-page | Viewport | Kích thước baseline / app | Fixture |', '|---|---:|---:|---|---|'
    ]
    for row in scores:
        full = row['full']['score']
        partial = row['viewportComparison']['score']
        dimensions = ' / '.join('×'.join(map(str, row[field])) for field in ('baselineSize', 'actualSize'))
        report.append(f'| {row["file"]} | {f"{full:.2f}%" if full is not None else "Lệch kích thước"} | '
                      f'{f"{partial:.2f}%" if partial is not None else "Lỗi"} | {dimensions} | {row["fixture"]} |')
    report.extend(['', '## Kiểm tra tương tác', ''])
    for check in captures['checks']:
        report.append(f'- {"Đạt" if check["passed"] else "Chưa đạt"} · {check["name"]}')
    (directory / 'REPORT.md').write_text('\n'.join(report) + '\n')
    print(f'{len(scores)}/87 captured, {passed}/87 accepted full-page, {preview_pass}/87 viewport above threshold')
    return 0 if passed == 87 and all(check['passed'] for check in captures['checks']) else 1


if __name__ == '__main__':
    sys.exit(main())
