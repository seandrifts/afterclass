'use client';

import { useRouter } from 'next/navigation';
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
  const router = useRouter();
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  // 出單機被改過名字時，過濾後的清單會是空的，要能退回顯示全部
  const [showAll, setShowAll] = useState(false);
  // 連上之後留著，同一頁再印下一段不必重新選裝置
  const link = useRef<{ server: BtServer; out: BtCharacteristic } | null>(null);
  // 選過的裝置也留著：斷線後重連不必再跳一次選擇清單
  const chosen = useRef<BtDevice | null>(null);

  /** 連上已經選好的裝置，找出可以寫入的通道 */
  async function open(device: BtDevice) {
    if (!device.gatt) throw new Error('這個裝置不能連線');
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

  /*
    確認連線還在，斷了就重連。

    這台出單機印完一張、裁刀動過之後常常自己把藍牙斷掉，下一張就送
    不出去。所以每一張送出前都檢查一次，斷了就接回來。剛斷線的那
    一兩秒它不一定連得上，多試幾次。
  */
  async function ensure() {
    if (link.current?.server.connected) return link.current;
    if (!chosen.current) throw new Error('出單機斷線了，請再按一次列印');

    // 連線本身也可能卡住不回應，每次最多等 8 秒就放棄重來
    const timeout = (ms: number) =>
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('重新連線逾時')), ms),
      );

    let last: unknown;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      setStatus({
        kind: 'working',
        text: `出單機斷線，重新連線中（第 ${attempt + 1} 次）`,
      });
      try {
        return await Promise.race([open(chosen.current), timeout(8000)]);
      } catch (e) {
        last = e;
        await pause(2000);
      }
    }
    throw last;
  }

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
    chosen.current = device;

    setStatus({ kind: 'working', text: `連線到 ${device.name ?? '出單機'}` });
    return open(device);
  }

  /** 回傳已經送出去幾個 bytes，失敗時靠它判斷這張卡有沒有印到一半 */
  async function send(
    out: BtCharacteristic,
    data: Uint8Array<ArrayBuffer>,
    sent: { bytes: number },
  ) {
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
      sent.bytes = i + piece.length;
    }
  }

  async function print(form: HTMLFormElement) {
    const from = new FormData(form).get('from');
    const to = new FormData(form).get('to');

    // 印到第幾張，出錯時告訴使用者從哪裡接下去
    let done = 0;
    let current = '';
    // 最後一張成功送出的是第幾張，印完或中斷後回報給伺服器
    let lastNo = 0;

    try {
      // 先連線再跟伺服器要資料。連線要在使用者按下按鈕的當下發起，
      // 中間插一個網路請求，瀏覽器就不認這次點擊了
      await connect();

      setStatus({ kind: 'working', text: '準備列印內容' });
      const res = await fetch(
        `/api/admin/tokens/${batchId}/escpos?from=${from}&to=${to}`,
      );
      const body = (await res.json()) as {
        error?: string;
        tickets?: { no: number; label: string; data: string }[];
      };
      if (!res.ok || !body.tickets) {
        throw new Error(body.error ?? '取得列印內容失敗');
      }

      for (const [i, ticket] of body.tickets.entries()) {
        setStatus({
          kind: 'working',
          text: `列印中 ${ticket.label}（${i + 1} / ${body.tickets.length}）`,
        });
        current = ticket.label;
        const data = decode(ticket.data);

        /*
          還沒送出任何資料就失敗的話，重連再送一次是安全的。
          送到一半才失敗就不重送：機器已經收到半張，再送一次會印出
          一張殘缺的加一張完整的，兩張同一組序號。
        */
        for (let attempt = 0; ; attempt += 1) {
          const sent = { bytes: 0 };
          try {
            const { out } = await ensure();
            await send(out, data, sent);
            break;
          } catch (e) {
            link.current = null;
            if (sent.bytes > 0 || attempt >= 2) throw e;
            await pause(1000);
          }
        }
        done = i + 1;
        lastNo = ticket.no;

        // 等這張印完、裁完再送下一張。機器還在印的時候送，容易斷線
        if (i < body.tickets.length - 1) await pause(4000);
      }

      // 整段都印完時記到範圍的結尾：結尾那幾張如果是用過被略過的，
      // 下次也不必再從它們開始
      lastNo = Math.max(lastNo, Number(to));

      setStatus({
        kind: 'done',
        text: `已送出 ${body.tickets.length} 張（${body.tickets[0].label} 到 ${body.tickets.at(-1)!.label}）`,
      });
    } catch (e) {
      link.current = null;
      const message = e instanceof Error ? e.message : String(e);
      const where = current
        ? `印到 ${current} 時中斷，前面 ${done} 張已送出。「從第幾張」已經幫你改成接續的那一張，確認出單機正常後再按一次列印。`
        : '';
      setStatus({
        kind: 'error',
        // 使用者自己關掉選擇視窗不算錯誤
        text: /cancel/i.test(message)
          ? '已取消'
          : where
            ? `${where}（${message}）`
            : message,
      });
    } finally {
      if (done > 0) await report(form, Number(from), lastNo, done);
    }
  }

  /*
    回報印到第幾張，並把「從第幾張」改成下一張。

    回報失敗不影響已經印出來的卡，所以錯誤直接吞掉 —— 最壞的情況只是
    後台的「上次印到」沒更新。
  */
  async function report(
    form: HTMLFormElement,
    from: number,
    last: number,
    count: number,
  ) {
    const input = form.elements.namedItem('from');
    if (input instanceof HTMLInputElement && last < Number(input.max)) {
      input.value = String(last + 1);
    }

    try {
      await fetch(`/api/admin/tokens/${batchId}/printed`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from, last, count }),
      });
      router.refresh();
    } catch {
      // 見上方說明
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
