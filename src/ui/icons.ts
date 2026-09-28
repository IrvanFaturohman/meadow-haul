// Original inline SVG icon set (consistent chunky strokes, palette colours).

const S = (body: string, vb = '0 0 48 48') =>
  `<svg class="ico" viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  coin: S(
    `<circle cx="24" cy="25" r="17" fill="#B98E37"/><circle cx="24" cy="23" r="17" fill="#F2C94C"/><circle cx="24" cy="23" r="12" fill="none" stroke="#DDA93A" stroke-width="3"/><path d="M24 15v16M20 19h6a3 3 0 010 6h-4a3 3 0 000 6h6" fill="none" stroke="#9A6E1F" stroke-width="3" stroke-linecap="round"/>`,
  ),
  bale: S(
    `<rect x="6" y="14" width="36" height="24" rx="6" fill="#B08A3E"/><rect x="6" y="11" width="36" height="24" rx="6" fill="#E6C265"/><path d="M16 11v24M32 11v24" stroke="#B5552F" stroke-width="3.5"/><path d="M10 18h4M20 22h6M36 17h3M11 28h3M27 29h3" stroke="#C9A04A" stroke-width="2" stroke-linecap="round"/>`,
  ),
  blade: S(
    `<circle cx="24" cy="24" r="17" fill="#B7C4BC"/><g fill="#EEF3EE">${Array.from({ length: 12 }, (_, i) => {
      const a = (i / 12) * Math.PI * 2;
      const x = 24 + Math.cos(a) * 19;
      const y = 24 + Math.sin(a) * 19;
      const x2 = 24 + Math.cos(a + 0.28) * 15;
      const y2 = 24 + Math.sin(a + 0.28) * 15;
      const x3 = 24 + Math.cos(a - 0.2) * 15;
      const y3 = 24 + Math.sin(a - 0.2) * 15;
      return `<path d="M${x.toFixed(1)} ${y.toFixed(1)}L${x2.toFixed(1)} ${y2.toFixed(1)}L${x3.toFixed(1)} ${y3.toFixed(1)}Z"/>`;
    }).join('')}</g><circle cx="24" cy="24" r="12" fill="#DCE5DC"/><path d="M24 24L34 20M24 24L18 32M24 24L20 14" stroke="#344A46" stroke-width="4" stroke-linecap="round"/><circle cx="24" cy="24" r="5" fill="#DF7654"/>`,
  ),
  vacuum: S(
    `<path d="M20 6h8v10h-8z" fill="#4A9692"/><path d="M19 16h10l11 20H8z" fill="#FFF1D2" stroke="#344A46" stroke-width="2.5" stroke-linejoin="round"/><path d="M13 27h22" stroke="#DF7654" stroke-width="3.5"/><ellipse cx="24" cy="37" rx="17" ry="4.5" fill="#344A46"/><path d="M12 43c3-2 6-2 8 0M28 43c3-2 6-2 8 0" stroke="#A4C760" stroke-width="2.5" fill="none" stroke-linecap="round"/>`,
  ),
  barn: S(
    `<path d="M6 22L24 8l18 14v18H6z" fill="#C9573F"/><path d="M10 24h28v16H10z" fill="#F4E3BF"/><path d="M19 40V29h10v11" fill="#C98E5B"/><path d="M19 29l10 11M29 29L19 40" stroke="#8F5E3C" stroke-width="2"/><path d="M4 23L24 7l20 16" fill="none" stroke="#A4432F" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  gear: S(
    `<path d="M24 6l4 5 6-2 1 6 6 2-2 6 5 4-5 4 2 6-6 2-1 6-6-2-4 5-4-5-6 2-1-6-6-2 2-6-5-4 5-4-2-6 6-2 1-6 6 2z" fill="#4A9692"/><circle cx="24" cy="24" r="7" fill="#FFF1D2"/>`,
  ),
  settings: S(
    `<path d="M24 8l3.5 4.2 5.4-1.6.8 5.5 5.2 2-2 5.1 4.1 3.8-4.1 3.8 2 5.1-5.2 2-.8 5.5-5.4-1.6L24 46l-3.5-4.2-5.4 1.6-.8-5.5-5.2-2 2-5.1L7 27l4.1-3.8-2-5.1 5.2-2 .8-5.5 5.4 1.6z" fill="#263C33" transform="translate(0 -3)"/><circle cx="24" cy="24" r="6" fill="#FFF1D2"/>`,
  ),
  sprout: S(
    `<path d="M24 42V24" stroke="#4E8A33" stroke-width="4" stroke-linecap="round"/><path d="M24 26c-2-9-10-12-16-11 0 7 6 12 16 11z" fill="#69AA43"/><path d="M24 22c1-8 8-12 15-11 0 7-6 12-15 11z" fill="#A4C760"/><path d="M12 42h24" stroke="#925D42" stroke-width="5" stroke-linecap="round"/>`,
  ),
  worker: S(
    `<circle cx="24" cy="15" r="8" fill="#F0C29A"/><path d="M15 12c1-6 17-6 18 0z" fill="#F09A3E"/><path d="M10 42c0-10 6-15 14-15s14 5 14 15z" fill="#7FB35A"/><rect x="28" y="28" width="14" height="10" rx="3" fill="#E6C265" stroke="#B5552F" stroke-width="2"/>`,
  ),
  storage: S(
    `<path d="M6 38h36v4H6z" fill="#8F5E3C"/><rect x="8" y="26" width="15" height="11" rx="3" fill="#9BC45E"/><rect x="25" y="26" width="15" height="11" rx="3" fill="#E6C265"/><rect x="16" y="14" width="15" height="11" rx="3" fill="#5E9048"/><path d="M13 26v11M33 26v11M23 14v11" stroke="#C9A56A" stroke-width="2"/>`,
  ),
  hose: S(
    `<path d="M8 38c10 0 8-14 18-14s10-14 16-14" fill="none" stroke="#4A9692" stroke-width="7" stroke-linecap="round"/><path d="M8 38c10 0 8-14 18-14s10-14 16-14" fill="none" stroke="#7CC3BD" stroke-width="2" stroke-dasharray="3 5" stroke-linecap="round"/><rect x="36" y="4" width="10" height="10" rx="3" fill="#DF7654"/>`,
  ),
  carry: S(
    `<rect x="12" y="30" width="24" height="10" rx="3" fill="#9BC45E"/><rect x="12" y="19" width="24" height="10" rx="3" fill="#E6C265"/><rect x="12" y="8" width="24" height="10" rx="3" fill="#5E9048"/><path d="M20 8v32M28 8v32" stroke="#C9A56A" stroke-width="2"/><path d="M40 16v18M36 20l4-4 4 4" stroke="#263C33" stroke-width="3" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  ),
  star: S(`<path d="M24 5l5.6 11.9 13 1.6-9.6 9 2.5 12.9L24 33.9 12.5 40.4 15 27.5l-9.6-9 13-1.6z" fill="#F2C94C" stroke="#B98E37" stroke-width="2.5" stroke-linejoin="round"/>`),
  flag: S(`<path d="M12 6v38" stroke="#8F5E3C" stroke-width="4" stroke-linecap="round"/><path d="M14 8h24l-6 8 6 8H14z" fill="#DF7654"/>`),
  check: S(`<circle cx="24" cy="24" r="18" fill="#69AA43"/><path d="M15 25l6 6 12-13" fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`),
  truck: S(
    `<rect x="4" y="16" width="24" height="16" rx="3" fill="#C98E5B"/><path d="M28 20h9l6 7v5H28z" fill="#5E8DB0"/><circle cx="13" cy="35" r="5" fill="#344A46"/><circle cx="35" cy="35" r="5" fill="#344A46"/>`,
  ),
  arrowUp: `<svg viewBox="0 0 24 24"><path d="M12 4l7 8h-4v8H9v-8H5z" fill="#fff"/></svg>`,
  lock: S(`<rect x="11" y="21" width="26" height="20" rx="4" fill="#8F7D5E"/><path d="M16 21v-5a8 8 0 0116 0v5" fill="none" stroke="#8F7D5E" stroke-width="4"/>`),
  sound: S(`<path d="M8 19h8l10-8v26l-10-8H8z" fill="#263C33"/><path d="M32 17c3 4 3 10 0 14M36 13c5 6 5 16 0 22" stroke="#263C33" stroke-width="3" fill="none" stroke-linecap="round"/>`),
  leaf: S(`<path d="M10 38C8 20 22 8 40 8c0 18-12 32-30 30z" fill="#69AA43"/><path d="M12 36L32 16" stroke="#3E7843" stroke-width="3" stroke-linecap="round"/>`),
};

export type IconName = keyof typeof ICONS;
