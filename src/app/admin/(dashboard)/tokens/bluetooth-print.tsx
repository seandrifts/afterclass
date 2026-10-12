'use client';

import { useRef, useState } from 'react';

/*
  從瀏覽器用藍牙把抽獎卡直接送給出單機（Web Bluetooth）。

  為什麼不靠列印 App：App 印 PDF 是把整頁轉成點陣圖送，這台出單機的
  藍牙收不下來，紙走一點就斷線。這裡送的是伺服器算好的文字指令，
  一張卡兩百多 bytes。

  瀏覽器的限制：Web Bluetooth 只有 Chrome / Edge 有。iPhone 與 iPad 的
  Safari、Chrome 都沒有（iOS 上所有瀏覽器都被迫用同一個核心），要另外
  裝有支援的瀏覽器，例如 Bluefy。
*/

/*
  出單機常見的藍牙序列埠服務。

  各家晶片用的 UUID 不一樣，而瀏覽器規定「事先沒列出來的服務，連上
  之後也不准碰」，所以把常見的都列上，連上再看這台有哪一個。
*/
const SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb',
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2',
  '49535343-fe7d-4ae5-8fa9-9fafd205e455',
  '0000ff00-0000-1000-8000-00805f9b34fb',
  '0000fff0-0000-1000-8000-00805f9b34fb',
  '0000ae30-0000-1000-8000-00805f9b34fb',
];

/** lib.dom 沒有 Web Bluetooth 的型別，只宣告用得到的部分 */
interface BtCharacteristic {
  properties: { write: boolean; writeWithoutResponse: boolean };
  writeValueWithResponse(data: BufferSource): Promise<void>;
  writeValueWithoutResponse(data: BufferSource): Promise<void>;
}
interface BtService {
  getCharacteristics(): Promise<BtCharacteristic[]>;
}
interface BtServer {
  connected: boolean;
  connect(): Promise<BtServer>;
  disconnect(): void;
  getPrimaryServices(): Promise<BtService[]>;
}
interface BtDevice {
  name?: string;
  gatt?: BtServer;
}
interface Bluetooth {
  requestDevice(options: {
    acceptAllDevices?: boolean;
    filters?: { namePrefix: string }[];
    optionalServices: string[];
  }): Promise<BtDevice>;
}

/*
  選擇清單只列名字像出單機的裝置。

  不過濾的話，附近所有藍牙裝置都會出現，而且大多數沒有名字，只顯示
  一長串代碼，店裡隨便就十幾個，根本找不到哪一台是出單機。
  這台的名字是 Printer001，其餘是同類機器常見的開頭。
*/
const NAME_PREFIXES = ['Printer', 'XP', 'Xprinter', 'POS', 'BlueTooth', 'BT'];

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

function decode(base64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(base64);
  const bytes = new Uint8Array(new ArrayBuffer(bin.length));
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working'; text: string }
  | { kind: 'done'; text: string }
  | { kind: 'error'; text: string };

export function BluetoothPrint({
  batchId,
  className,
}: {
  batchId: string;
  className: string;
}) {
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // 出單機被改過名字時，過濾後的清單會是空的，要能退回顯示全部
  const [showAll, setShowAll] = useState(false);
  // 連上之後留著，同一頁再印下一段不必重新選裝置
  const link = useRef<{ server: BtServer; out: BtCharacteristic } | null>(null);

  async function connect() {
    if (link.current?.server.connected) return link.current;

    const bluetooth = (navigator as Navigator & { bluetooth?: Bluetooth })
      .bluetooth;
    if (!bluetooth) {
      throw new Error(
        '這個瀏覽器不支援藍牙列印。電腦請用 Chrome；iPad 請安裝 Bluefy 瀏覽器，用它打開這一頁',
      );
    }

    setStatus({ kind: 'working', text: '請在跳出的清單選擇出單機' });
    const device = await bluetooth.requestDevice(
      showAll
        ? { acceptAllDevices: true, optionalServices: SERVICES }
        : {
            filters: NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
            optionalServices: SERVICES,
          },
    );
    if (!device.gatt) throw new Error('這個裝置不能連線');

    setStatus({ kind: 'working', text: `連線到 ${device.name ?? '出單機'}` });
    const server = await device.gatt.connect();

    // 找第一個可以寫入的通道
    for (const service of await server.getPrimaryServices()) {
      for (const ch of await service.getCharacteristics()) {
        if (ch.properties.write || ch.properties.writeWithoutResponse) {
          link.current = { server, out: ch };
          return link.current;
        }
      }
    }

    server.disconnect();
    throw new Error('連上了，但找不到可以送資料的通道。這台可能不是出單機');
  }

  async function send(out: BtCharacteristic, data: Uint8Array<ArrayBuffer>) {
    /*
      一次送一小塊。

      藍牙一包能帶的資料有限，超過會被直接丟掉。能用「要回覆的寫入」
      就用它：對方收下才會回，等於自帶流量控制。只能用「不回覆」的
      話就自己在每一塊之間停一下。
    */
    const size = 100;
    for (let i = 0; i < data.length; i += size) {
      const piece = data.slice(i, i + size);
      if (out.properties.write) {
        await out.writeValueWithResponse(piece);
      } else {
        await out.writeValueWithoutResponse(piece);
        await pause(40);
      }
    }
  }

  async function print(form: HTMLFormElement) {
    const from = new FormData(form).get('from');
    const to = new FormData(form).get('to');

    try {
      // 先連線再跟伺服器要資料。連線要在使用者按下按鈕的當下發起，
      // 中間插一個網路請求，瀏覽器就不認這次點擊了
      const { out } = await connect();

      setStatus({ kind: 'working', text: '準備列印內容' });
      const res = await fetch(
        `/api/admin/tokens/${batchId}/escpos?from=${from}&to=${to}`,
      );
      const body = (await res.json()) as {
        error?: string;
        tickets?: { label: string; data: string }[];
      };
      if (!res.ok || !body.tickets) {
        throw new Error(body.error ?? '取得列印內容失敗');
      }

      for (const [i, ticket] of body.tickets.entries()) {
        setStatus({
          kind: 'working',
          text: `列印中 ${ticket.label}（${i + 1} / ${body.tickets.length}）`,
        });
        await send(out, decode(ticket.data));
        // 等這張印完、裁完再送下一張
        await pause(1500);
      }

      setStatus({
        kind: 'done',
        text: `已送出 ${body.tickets.length} 張（${body.tickets[0].label} 到 ${body.tickets.at(-1)!.label}）`,
      });
    } catch (e) {
      link.current = null;
      const message = e instanceof Error ? e.message : String(e);
      setStatus({
        kind: 'error',
        // 使用者自己關掉選擇視窗不算錯誤
        text: /cancel/i.test(message) ? '已取消' : message,
      });
    }
  }

  return (
    <>
      <button
        type="button"
        disabled={status.kind === 'working'}
        onClick={(e) => {
          const form = e.currentTarget.form;
          if (form?.reportValidity()) void print(form);
        }}
        className={`${className} disabled:opacity-40`}
      >
        藍牙直接列印
      </button>
      <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-soft">
        <input
          type="checkbox"
          checked={showAll}
          onChange={(e) => setShowAll(e.target.checked)}
        />
        清單裡找不到出單機時勾這個，改成列出附近所有裝置
      </label>
      {status.kind !== 'idle' ? (
        <p
          role="status"
          className={`basis-full text-sm ${
            status.kind === 'error'
              ? 'text-bad'
              : status.kind === 'done'
                ? 'text-good'
                : 'text-ink-soft'
          }`}
        >
          {status.text}
        </p>
      ) : null}
    </>
  );
}
