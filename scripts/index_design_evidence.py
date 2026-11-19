#!/usr/bin/env python3
"""Index the captured reference evidence; never accesses credentials or live APIs."""
import hashlib
import json
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HOST = 'vuon-van-ca-nhan.pages.dev'
EVIDENCE = ROOT / 'docs/research' / HOST
SHOTS = ROOT / 'docs/design-references' / HOST
SOURCE = EVIDENCE / 'source'

def save_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

assets = []
for path in sorted(SOURCE.rglob('*')):
    if not path.is_file():
        continue
    item = {'file': str(path.relative_to(EVIDENCE)), 'bytes': path.stat().st_size, 'sha256': digest(path)}
    if path.suffix == '.webp':
        with Image.open(path) as image:
            item['width'], item['height'] = image.size
    assets.append(item)
save_json(EVIDENCE / 'assets.json', {'origin': 'https://' + HOST + '/', 'surveyDate': '2026-11-19', 'files': assets})

rows = []
for shot in sorted(SHOTS.glob('*.png')):
    if shot.stem.endswith('-review'):
        continue
    record = EVIDENCE / (shot.stem + '.json')
    dom = EVIDENCE / (shot.stem + '.html')
    assert record.exists() and dom.exists(), f'Missing paired evidence: {shot.name}'
    data = json.loads(record.read_text())
    with Image.open(shot) as im:
        width, height = im.size
        assert width == data['viewport']['width'], f'Viewport mismatch: {shot.name}'
        review_width = min(640, width)
        im.resize((review_width, round(height * review_width / width))).save(shot.with_stem(shot.stem + '-review'))
    scope = 'Demo' if shot.stem.startswith('demo-') else 'Live'
    if 'local-draft' in shot.stem:
        scope += ' · nháp thử local'
    if 'import-validation' in shot.stem:
        scope += ' · CSV preview local'
    rows.append({'name': shot.stem, 'scope': scope, 'viewport': data['viewport'], 'size': [width, height], 'overflow': data['scrollWidth'] > data['viewport']['width'], 'sha256': digest(shot)})
save_json(EVIDENCE / 'screenshots.json', rows)

expected = {
    '--ink': '#29493b', '--muted': '#738174', '--green': '#39745b',
    '--blue': '#567bba', '--cream': '#faf9f1', '--line': '#e2e8da', '--pink': '#f7e9e7',
}
raw = json.loads((EVIDENCE / 'global-extraction.json').read_text())
checks = [{'property': key, 'expected': value, 'actual': raw['tokens'][key].strip(), 'pass': raw['tokens'][key].strip() == value, 'evidence': 'global-extraction.json'} for key, value in expected.items()]
for screen, cls, prop, value in [
    ('teacher-home-1440', 'sidebar', 'width', '235px'),
    ('teacher-home-768', 'sidebar', 'width', '205px'),
    ('teacher-home-390', 'topbar', 'height', '66px'),
    ('teacher-home-1440', 'content', 'padding', '28px 38px 45px'),
    ('teacher-home-390', 'content', 'padding', '18px 16px 85px'),
    ('teacher-home-1440', 'garden-slogan', 'font-size', '30.5539px'),
    ('teacher-home-768', 'garden-slogan', 'font-size', '16px'),
    ('teacher-home-390', 'garden-slogan', 'font-size', '16.416px'),
    ('student-write-1440', 'essay-editor rich-editor', 'min-height', '300px'),
    ('student-write-1440', 'essay-editor rich-editor', 'padding', '16px'),
]:
    data = json.loads((EVIDENCE / (screen + '.json')).read_text())
    element = next(e for e in data['elements'] if e['cls'] == cls)
    actual = element['css'][prop]
    checks.append({'selector': '.' + cls.replace(' ', '.'), 'property': prop, 'expected': value, 'actual': actual, 'pass': actual == value, 'evidence': screen + '.json'})
save_json(EVIDENCE / 'token-verification.json', {'checks': checks, 'allPassed': all(c['pass'] for c in checks)})
assert all(c['pass'] for c in checks), 'A documented token differs from its evidence'

lines = [
    '# Danh mục bằng chứng khảo sát Vườn Văn', '',
    'Nguồn: <https://' + HOST + '/> và `/demo.html`, ngày **19/11/2026**. Chrome 157.0.8103.79/macOS, DPR 1, locale vi-VN, timezone Asia/Ho_Chi_Minh. Ba viewport 1440×900, 768×1024, 390×844.', '',
    '## Cách đọc', '',
    '- Mỗi screenshot có DOM và JSON chứa text, rect, computed CSS, assets, font status. Không lưu cookie/token/mật khẩu.',
    '- Các screenshot chính home/garden/write/review được chuẩn hóa scroll0 và pointer ngoài component; metadata `capture` ghi rõ lần chuẩn hóa. Ảnh state/dialog cũ giữ tương tác thực tế lúc mở; rect y của chúng có thể tính tại vị trí cuộn hiện tại.',
    '- Full-page giữ thanh fixed ở vị trí của viewport khi chụp. File `-review.png` chỉ để xem nhanh, không chấm pixel.',
    '- Các file `demo-*` là bản trải nghiệm; `local-draft` và `import-validation` dùng nội dung thử cục bộ, không gửi nghiệp vụ lên server.',
    '- Không có clone được triển khai trong đợt này; số token kiểm chứng không phải điểm visual fidelity.', '',
    '## Các tệp kiểm chứng chung', '',
    '- [Source HTML/CSS/JS](source/) · [Assets và SHA-256](assets.json) · [Manifest screenshot](screenshots.json).',
    '- [Root tokens/layers/images](global-extraction.json) · [Before/after states](interaction-states.json) · [Token verification](token-verification.json).',
    '- [API method/path/status](network-summary.json) · [Xuất CSV/DOCX](export-verification.json).',
    '- [FEATURES](../../../FEATURES.MD) · [DESGIN](../../../DESGIN.MD) · [Chi tiết màn hình](../../design/SCREENS.md) · [Tương tác](../../design/INTERACTIONS.md).', '',
    f'## Screenshot: {len(rows)} trạng thái/viewport', '',
    '| Tên / phạm vi | Viewport | PNG full-page | Review | DOM | Số đo/text |',
    '|---|---|---|---|---|---|',
]
for row in rows:
    name = row['name']
    shotpath = '../../design-references/' + HOST + '/' + name
    vp = row['viewport']
    lines.append(f"| {name} ({row['scope']}) | {vp['width']}×{vp['height']} | [{row['size'][0]}×{row['size'][1]}]({shotpath}.png) | [Xem]({shotpath}-review.png) | [HTML]({name}.html) | [JSON]({name}.json) |")
lines += ['', '## Kiểm tra', '', f'- {len(checks)} giá trị token/layout đã đối chiếu với JSON đo; tất cả khớp.', f'- {len(rows)} ảnh có đầy đủ DOM/JSON và preview.', '- Asset manifest ghi kích thước ảnh và SHA-256, gồm source và font để audit.', '- Không gửi POST nghiệp vụ tạo/sửa/xóa/nộp/chấm/upload/AI trong khảo sát. POST đăng nhập/đăng xuất là thao tác xác thực được thực hiện.', '- Các khoảng trống dữ liệu/nhánh chưa xác nhận được liệt kê trong FEATURES và INTERACTIONS.', '']
(EVIDENCE / 'INDEX.md').write_text('\n'.join(lines))
print(f'Indexed {len(rows)} screenshots, {len(assets)} source/assets; verified {len(checks)} tokens.')
