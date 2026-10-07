import LZString from 'lz-string';
import { describe, expect, it } from 'vitest';
import { APP_BASE_PATH, PUBLIC_APP_URL, defaultDoc } from '../constants';
import { buildShareUrl, decodePlan, encodePlan, isLocalPage, shareBase } from './share';

const pack = (payload: unknown) => LZString.compressToEncodedURIComponent(JSON.stringify(payload));

describe('decodePlan', () => {
  it('encodePlan の出力を読み戻せる', () => {
    const doc = defaultDoc();
    doc.floors[1].rooms.push({ id: 'r', name: 'LDK', typeId: 'ldk', cells: ['1,1', '2,1'], z: 1 });
    expect(decodePlan(encodePlan('我が家', doc))).toEqual({ name: '我が家', doc });
  });

  it('旧形式（openings 無し・2階無し・種別無し）の共有リンクも画面が壊れない形に補完して返す', () => {
    const legacy = { n: '旧', d: { version: 1, floors: { 1: { rooms: [{ id: 'r', name: 'A', typeId: 'living', cells: ['2,2'], z: 1 }] } } } };
    const out = decodePlan(pack(legacy))!;
    expect(out.name).toBe('旧');
    expect(out.doc.floors[1].openings).toEqual([]);
    expect(out.doc.floors[1].furniture).toEqual([]);
    expect(out.doc.floors[2]).toEqual({ rooms: [], openings: [], furniture: [] });
    expect(out.doc.roomTypes.length).toBeGreaterThan(0);
    expect(out.doc.settings).toEqual({ cellMm: 455, wallMm: 120 });
  });

  it('移動モードのまま作った（部屋が重なった）共有リンクも、重なりを解消して返す', () => {
    const doc = defaultDoc();
    doc.floors[1].rooms.push(
      { id: 'A', name: 'A', typeId: 'living', cells: ['2,2', '3,2'], z: 1 },
      { id: 'B', name: 'B', typeId: 'ldk', cells: ['3,2', '4,2'], z: 2 },
    );
    const out = decodePlan(encodePlan('重なり', doc))!;
    expect(out.doc.floors[1].rooms.find((r) => r.id === 'A')!.cells).toEqual(['2,2']);
    expect(out.doc.floors[1].rooms.find((r) => r.id === 'B')!.cells).toEqual(['3,2', '4,2']);
  });

  it('名前が無い・文字列でなければ既定の名前', () => {
    expect(decodePlan(pack({ d: defaultDoc() }))!.name).toBe('受信した間取り');
    expect(decodePlan(pack({ n: 5, d: defaultDoc() }))!.name).toBe('受信した間取り');
  });

  it('文書として使えないものは null', () => {
    expect(decodePlan('')).toBeNull();
    expect(decodePlan('not-a-valid-payload')).toBeNull();
    expect(decodePlan(pack({ n: 'x' }))).toBeNull();
    expect(decodePlan(pack({ n: 'x', d: { roomTypes: [] } }))).toBeNull();
    expect(decodePlan(pack(null))).toBeNull();
    expect(decodePlan(pack([1, 2]))).toBeNull();
  });
});

/** A page location as the browser reports it. */
function at(url: string) {
  const u = new URL(url);
  return { protocol: u.protocol, hostname: u.hostname, origin: u.origin, pathname: u.pathname };
}

describe('共有リンクの基底（ローカル起動中は公開版）', () => {
  it('localhost・127.0.0.1・[::1]・file: で開いている時は、公開版のURLを基底にする', () => {
    for (const url of ['http://localhost:5173/', 'http://localhost:4179/MadoriSimulator/', 'http://127.0.0.1:5173/', 'http://[::1]:5173/', 'file:///C:/Claude/51_MadoriSimulator/dist/index.html']) {
      expect(isLocalPage(at(url)), url).toBe(true);
      expect(shareBase(at(url)), url).toBe(PUBLIC_APP_URL);
    }
    expect(PUBLIC_APP_URL).toBe('https://neguracg.github.io/MadoriSimulator/');
    expect(APP_BASE_PATH).toBe('/MadoriSimulator/'); // vite.config.ts の base と同じ（同じ知識は constants の1か所）
  });

  it('公開サイト・LAN の IP・別のドメインでは、そのページ自身を基底にする（他の端末から開ける住所）', () => {
    for (const url of ['https://neguracg.github.io/MadoriSimulator/', 'http://192.168.1.20:5173/', 'https://example.com/madori/']) {
      expect(isLocalPage(at(url)), url).toBe(false);
      expect(shareBase(at(url)), url).toBe(at(url).origin + at(url).pathname);
    }
  });

  it('buildShareUrl は 基底 + #p= で、decodePlan が読み戻せる', () => {
    const doc = defaultDoc();
    doc.floors[1].rooms.push({ id: 'r', name: 'LDK', typeId: 'ldk', cells: ['1,1', '2,1'], z: 1 });
    const local = buildShareUrl('我が家', doc, at('http://localhost:5173/'));
    expect(local.startsWith(`${PUBLIC_APP_URL}#p=`)).toBe(true);
    expect(decodePlan(local.slice(local.indexOf('#p=') + 3))).toEqual({ name: '我が家', doc });
    const published = buildShareUrl('我が家', doc, at('https://neguracg.github.io/MadoriSimulator/'));
    expect(published).toBe(local); // 公開サイトで作っても、ローカルで作っても同じリンクになる
  });
});
