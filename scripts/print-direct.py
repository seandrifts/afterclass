#!/usr/bin/env python3
"""
把抽獎卡直接送給出單機（XP-Q90EC），不經過手機 App。

    python3 scripts/print-direct.py --from 1 --to 5 --device /dev/cu.Printer001
    python3 scripts/print-direct.py --from 1 --to 5 --queue XP58
    python3 scripts/print-direct.py --from 1 --to 1 --preview /tmp/card.png

為什麼需要這支：

iPad 上的列印 App 走的是低功耗藍牙，送點陣圖時沒有流量控制，資料一多
出單機的緩衝區就滿，接著連線中斷。實際狀況是紙走一點點就斷線，而
機器自檢頁可以完整印出來，代表機器與供電都正常，問題在傳輸。

這裡改由電腦直接送 ESC/POS 指令。傳輸走傳統藍牙序列埠或 USB，
兩者都有流量控制；送的時候再分段、每段之間停一下，機器來得及印。

版面直接照印字頭的解析度畫（一行 384 點、每 mm 8 點），不經過 PDF
再轉點陣，所以每一個點都是算好的。內容與後台下載的 PDF 一致
（src/lib/ticket-pdf.ts），改其中一邊的版面記得改另一邊。

需要 Pillow、qrcode；用 --device 時另外需要 pyserial。
"""

import argparse
import json
import os
import subprocess
import sys
import time
import urllib.parse
from datetime import datetime
from zoneinfo import ZoneInfo

import qrcode
from PIL import Image, ImageDraw, ImageFont

# QR 一律指向正式站。刻意不讀 SITE_URL：本機的 .env.local 是 localhost，
# 用它印出來的卡客人掃了打不開（2026-10-10 發生過一次）
SITE = 'https://afterclass.party'

SHOP_TZ = ZoneInfo('Asia/Taipei')

HEAD_DOTS = 384  # 印字頭一行的點數 = 48mm
QR_MAX_DOTS = 272  # QR 邊長上限，實際取「每格整數點」

DEFAULT_FONT = os.path.expanduser('~/Desktop/fonts/jf-openhuninn-2.1.ttf')


def load_env(path='.env.local'):
    env = {}
    with open(path, encoding='utf8') as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith('#') or '=' not in line:
                continue
            key, value = line.split('=', 1)
            env[key.strip()] = value.strip()
    return env


def rest(env, table, query):
    url = f"{env['NEXT_PUBLIC_SUPABASE_URL']}/rest/v1/{table}?{urllib.parse.urlencode(query)}"
    key = env['SUPABASE_SERVICE_ROLE_KEY']
    # 用 curl 而不是 urllib：python.org 安裝的 Python 預設沒有根憑證，
    # urllib 會驗證失敗，而關掉驗證不是選項。curl 用的是系統的憑證
    res = subprocess.run(
        ['curl', '-sS', '--fail', '--max-time', '20', '-H', f'apikey: {key}', '-H', f'authorization: Bearer {key}', url],
        capture_output=True,
        text=True,
    )
    if res.returncode != 0:
        sys.exit(f'讀取 {table} 失敗：{res.stderr.strip()}')
    return json.loads(res.stdout)


def fetch(env, batch_name):
    """回傳（店名, 批次名, 整個批次依固定順序排好的序號）。"""
    shop = rest(env, 'settings', {'select': 'shop_name', 'id': 'eq.1'})[0]['shop_name']

    batches = rest(env, 'token_batches', {'select': 'id,name,created_at', 'order': 'created_at.desc'})
    if batch_name:
        batches = [b for b in batches if b['name'] == batch_name]
    if not batches:
        sys.exit('找不到批次' + (f'「{batch_name}」' if batch_name else ''))
    batch = batches[0]

    # 順序必須跟後台一樣（建立時間、再依序號），編號才對得上
    tokens = rest(
        env,
        'draw_tokens',
        {
            'select': 'code,status,expires_at',
            'batch_id': f"eq.{batch['id']}",
            'order': 'created_at.asc,code.asc',
            'limit': '5000',
        },
    )
    return shop, batch['name'], tokens


def render(font_path, shop, code, expiry, label):
    """畫一張卡，回傳 1-bit 影像（0 = 黑）。"""
    im = Image.new('1', (HEAD_DOTS, 900), 1)
    d = ImageDraw.Draw(im)
    d.fontmode = '1'  # 不做反鋸齒。熱感紙只有黑白，灰階只會變成雜點

    def font(px):
        return ImageFont.truetype(font_path, px)

    def centered(text, px, y, gap=0):
        f = font(px)
        if gap:
            widths = [d.textlength(ch, font=f) for ch in text]
            x = (HEAD_DOTS - sum(widths) - gap * (len(text) - 1)) / 2
            for ch, w in zip(text, widths):
                d.text((x, y), ch, font=f, fill=0)
                x += w + gap
        else:
            d.text(((HEAD_DOTS - d.textlength(text, font=f)) / 2, y), text, font=f, fill=0)
        return y + px

    y = 16

    # 店名太長就縮字，不讓它超出印得到的寬度
    px = 50
    while px > 24 and d.textlength(shop, font=font(px)) > HEAD_DOTS - 16:
        px -= 2
    centered(shop, px, y)
    y += 50 + 10

    y = centered('感謝消費・掃碼抽好禮', 30, y) + 22

    # 容錯等級 M：容錯越高格子越密越細，反而更難掃
    qr = qrcode.QRCode(error_correction=qrcode.constants.ERROR_CORRECT_M, border=0)
    qr.add_data(f'{SITE}/d/{code}')
    qr.make(fit=True)
    matrix = qr.get_matrix()
    n = len(matrix)
    cell = max(1, QR_MAX_DOTS // n)
    left = (HEAD_DOTS - cell * n) // 2
    for r, row in enumerate(matrix):
        for c, dark in enumerate(row):
            if dark:
                d.rectangle(
                    [left + c * cell, y + r * cell, left + (c + 1) * cell - 1, y + (r + 1) * cell - 1],
                    fill=0,
                )
    y += cell * n + 14

    y = centered(f'{code[:4]}-{code[4:]}', 46, y, gap=4) + 16
    y = centered('手機相機掃描 QR Code', 30, y) + 8
    y = centered('馬上抽獎', 30, y) + 18
    y = centered('每張限抽一次', 26, y) + 6
    if expiry:
        y = centered(f'{expiry} 前有效', 26, y) + 14
    else:
        y += 8

    f = font(24)
    d.text((HEAD_DOTS - 8 - d.textlength(label, font=f), y), label, font=f, fill=0)
    y += 24 + 24

    return im.crop((0, 0, HEAD_DOTS, y))


def escpos(image, cut):
    """
    一張卡的 ESC/POS 指令。

    點陣用 GS v 0 送，一次一小段。整張一次送完的話，機器要等全部收完
    才開始印，中間緩衝區最容易滿；分段送它可以邊收邊印。
    送出的速度另外在 main() 裡限制。
    """
    width_bytes = HEAD_DOTS // 8
    # Pillow 的 1-bit 是 1 = 白，印表機要的是 1 = 黑，反過來
    raw = image.point(lambda v: 0 if v else 255, mode='1').tobytes()
    rows = image.height

    out = bytearray(b'\x1b\x40')  # ESC @ 初始化，清掉上一份工作留下的狀態
    band = 48
    chunks = []
    for start in range(0, rows, band):
        count = min(band, rows - start)
        data = raw[start * width_bytes : (start + count) * width_bytes]
        chunks.append(
            bytes([0x1D, 0x76, 0x30, 0x00, width_bytes & 0xFF, width_bytes >> 8, count & 0xFF, count >> 8])
            + data
        )
    # 走紙到裁刀位置再半切；沒有裁刀或不想切就只走紙
    tail = b'\x1d\x56\x42\x00' if cut else b'\x1b\x64\x04'
    return bytes(out), chunks, tail


def encode(text):
    """
    轉成印表機內建字型認得的編碼。

    XP-Q90EC 內建的是 GB18030 字庫，繁體字也在裡面（GBK 的範圍涵蓋
    Big5 的字）。只有雙位元組的字它才畫得出來，四位元組的罕用字會
    印成亂碼，所以遇到就直接擋下，不讓它印出一張有缺字的卡。
    """
    out = bytearray()
    for ch in text:
        b = ch.encode('gb18030')
        if ord(ch) > 0x7F and len(b) != 2:
            sys.exit(f'「{ch}」不在印表機的內建字庫裡，請換一個字')
        out += b
    return bytes(out)


def escpos_text(shop, code, expiry, label, cut):
    """
    用「文字指令」印一張卡，跟 POS 印收據是同一種做法。

    點陣圖一張要送三萬多 bytes，這台機器的藍牙收不下來（iPad 的 App
    與本腳本的圖形模式都在這裡卡死）。改成只送文字與指令：字由印表機
    用內建字型自己畫，QR 也交給機器內建的功能產生，整張卡只有兩三百
    bytes，跟一張收據差不多。

    代價是字型只能用機器內建的點陣字，版面只有置中、放大、加粗可用。
    """
    ESC, GS, FS = b'\x1b', b'\x1d', b'\x1c'

    def size(n):  # 0x00 一般、0x11 寬高各兩倍
        return GS + b'!' + bytes([n])

    def line(text):
        return encode(text) + b'\n'

    url = f'{SITE}/d/{code}'.encode('ascii')

    out = bytearray()
    out += ESC + b'@'  # 初始化，清掉上一份工作留下的狀態
    out += FS + b'&'  # 開啟中文模式
    out += ESC + b'a\x01'  # 置中

    out += ESC + b'E\x01' + size(0x11) + line(shop) + size(0x00) + ESC + b'E\x00'
    # 中間的點用「·」。原本的「・」在內建字庫裡是四位元組，印不出來
    out += line('感謝消費·掃碼抽好禮')
    out += b'\n'

    # QR 交給印表機自己畫：選型號、設每格大小、設容錯、存入資料、印出
    out += GS + b'(k\x04\x00\x31\x41\x32\x00'
    out += GS + b'(k\x03\x00\x31\x43\x05'  # 每格 5 點，29 格約 18mm，跟發票的 QR 差不多
    out += GS + b'(k\x03\x00\x31\x45\x31'  # 容錯 M
    out += GS + b'(k' + bytes([(len(url) + 3) & 0xFF, (len(url) + 3) >> 8]) + b'\x31\x50\x30' + url
    out += GS + b'(k\x03\x00\x31\x51\x30'
    out += b'\n'

    out += ESC + b'E\x01' + size(0x11) + line(f'{code[:4]}-{code[4:]}') + size(0x00) + ESC + b'E\x00'
    out += b'\n'
    out += line('手機相機掃描 QR Code')
    out += line('馬上抽獎')
    out += b'\n'
    out += line('每張限抽一次')
    if expiry:
        out += line(f'{expiry} 前有效')

    out += ESC + b'a\x02' + line(label)  # 編號靠右
    out += ESC + b'a\x01'

    # 走紙到裁刀位置再半切；不切就多走幾行方便撕
    out += GS + b'VB\x00' if cut else ESC + b'd\x04'
    return bytes(out)


def main():
    ap = argparse.ArgumentParser(description='把抽獎卡直接送給出單機')
    ap.add_argument('--from', dest='start', type=int, required=True, help='從第幾張')
    ap.add_argument('--to', dest='end', type=int, required=True, help='到第幾張')
    ap.add_argument('--batch', help='批次名稱，不給就用最新的批次')
    ap.add_argument(
        '--mode',
        choices=['text', 'image'],
        default='text',
        help='text：內建字型加機器自己畫 QR，資料量小（預設）。image：粉圓字型的點陣圖，藍牙多半送不過去',
    )
    ap.add_argument('--font', default=DEFAULT_FONT)
    ap.add_argument('--device', help='序列埠，例如 /dev/cu.Printer001（傳統藍牙配對後出現）')
    ap.add_argument('--queue', help='CUPS 印表機佇列名稱（USB 連接時用）')
    ap.add_argument('--out', help='只把指令寫成檔案，不送出')
    ap.add_argument('--preview', help='把第一張存成 PNG 看版面，不送出')
    ap.add_argument('--no-cut', action='store_true', help='不裁紙，只走紙')
    ap.add_argument('--rate', type=int, default=6000, help='每秒最多送幾 bytes')
    args = ap.parse_args()

    shop, batch, tokens = fetch(load_env(), args.batch)
    total = len(tokens)

    if not (1 <= args.start <= args.end <= total):
        sys.exit(f'範圍不對。批次「{batch}」只有第 1 到第 {total} 張')

    digits = max(3, len(str(total)))
    jobs = []
    skipped = []
    for i in range(args.start, args.end + 1):
        t = tokens[i - 1]
        # 抽過、過期、作廢的不印，編號照樣保留不遞補
        if t['status'] not in ('active', 'inactive'):
            skipped.append(i)
            continue
        expiry = None
        if t['expires_at']:
            local = datetime.fromisoformat(t['expires_at']).astimezone(SHOP_TZ)
            expiry = f'{local.year}/{local.month}/{local.day}'
        label = f'No.{str(i).zfill(digits)}'
        jobs.append(
            {
                'label': label,
                'code': t['code'],
                'expiry': expiry,
                # 文字模式用不到點陣圖，就不必畫，也不需要字型檔
                'image': render(args.font, shop, t['code'], expiry, label) if args.mode == 'image' else None,
            }
        )

    print(f'批次「{batch}」第 {args.start} 到 {args.end} 張：要印 {len(jobs)} 張' + (f'，略過已用過的 {skipped}' if skipped else ''))
    if not jobs:
        return

    def stream_for(job):
        if args.mode == 'text':
            return escpos_text(shop, job['code'], job['expiry'], job['label'], not args.no_cut)
        head, chunks, tail = escpos(job['image'], not args.no_cut)
        return head + b''.join(chunks) + tail

    if args.preview:
        if args.mode != 'image':
            sys.exit('--preview 只有 --mode image 才有圖可以看')
        first = jobs[0]['image']
        first.save(args.preview)
        print(f'第一張已存到 {args.preview}（{first.width}×{first.height} 點）')
        return

    if args.out or args.queue:
        blob = bytearray()
        for job in jobs:
            blob += stream_for(job)
        path = args.out or f'/tmp/afterclass-{os.getpid()}.bin'
        with open(path, 'wb') as f:
            f.write(blob)
        if args.queue:
            subprocess.run(['lp', '-d', args.queue, '-o', 'raw', path], check=True)
            print(f'已送到佇列 {args.queue}')
        else:
            print(f'指令已寫到 {path}（{len(blob)} bytes）')
        return

    if not args.device:
        sys.exit('請指定 --device、--queue、--out 或 --preview 其中一個')

    import serial

    """
    送得比機器印得慢。

    這台機器的藍牙沒有可靠的流量控制：資料來得比它印得快時不會叫
    對方等一下，而是整個卡死，之後連狀態查詢都不回，只能關機重開。
    iPad 的 App 與第一版的這支腳本都是這樣掛掉的（紙走一點就停）。

    所以這裡自己限速：每次只送一小塊，送完就睡到「照這個速率應該
    過了多久」為止。預設每秒 6000 bytes，一張卡大約 5 到 6 秒。
    """
    piece = 128

    with serial.Serial(args.device, 115200, timeout=2, write_timeout=10) as port:
        for job in jobs:
            label = job['label']
            stream = stream_for(job)
            started = time.monotonic()
            for offset in range(0, len(stream), piece):
                port.write(stream[offset : offset + piece])
                port.flush()
                due = started + (offset + piece) / args.rate
                delay = due - time.monotonic()
                if delay > 0:
                    time.sleep(delay)
            print(f'  {label} 已送出（{len(stream)} bytes，{time.monotonic() - started:.1f} 秒）')
            time.sleep(1.0)  # 等裁刀與走紙完成再送下一張


if __name__ == '__main__':
    main()
