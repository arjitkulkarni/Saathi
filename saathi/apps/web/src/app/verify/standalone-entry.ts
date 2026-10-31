// Standalone offline verifier (build.md Ph15.6). Bundled by scripts/build-verifier.mjs into a
// single script and inlined, with pinned public keys, into a downloadable HTML file. It has
// no network access: it verifies hashes, links, signatures, retained checkpoint and batch
// membership locally, and reports the Bitcoin timestamp as not checked offline unless the
// user supplies a block header from a source they trust.
import { verifyBundle, type TrustedKey } from '@saathi/evidence';
import { en } from '@saathi/i18n/en';

declare global {
  interface Window {
    SAATHI_TRUSTED_KEYS?: TrustedKey[];
  }
}

const v = en.verify;
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

async function readFile(input: HTMLInputElement): Promise<unknown> {
  const f = input.files?.[0];
  if (!f) return undefined;
  return JSON.parse(await f.text());
}

function render() {
  const keys = window.SAATHI_TRUSTED_KEYS ?? [];
  document.body.innerHTML = `
  <main>
    <h1>${v.title}</h1>
    <p class="muted">${v.intro} ${v.standaloneNote}</p>
    <form id="f">
      <label for="bundle">${v.bundle}</label><input id="bundle" type="file" accept=".json,application/json" required>
      <label for="retained">${v.retained}</label><input id="retained" type="file" accept=".json,application/json">
      <fieldset><legend>${v.chain}</legend>
        <label for="height">${v.chainHeight}</label><input id="height" inputmode="numeric">
        <label for="merkle">${v.chainMerkle}</label><input id="merkle" spellcheck="false">
        <p class="muted">${v.timestampHelp}</p>
      </fieldset>
      <button type="submit">${v.run}</button>
    </form>
    <div id="out" aria-live="polite"></div>
    <section><h2>${v.keys}</h2><p class="muted">${v.keysNote}</p><ul id="keys"></ul></section>
  </main>`;
  const ul = $('keys');
  for (const k of keys) {
    const li = document.createElement('li');
    li.innerHTML = `<strong></strong><code></code>`;
    li.querySelector('strong')!.textContent = k.keyId;
    li.querySelector('code')!.textContent = k.publicKeyHex;
    ul.appendChild(li);
  }
  $('f').addEventListener('submit', async (e) => {
    e.preventDefault();
    const out = $('out');
    out.innerHTML = '';
    try {
      const bundle = await readFile($<HTMLInputElement>('bundle'));
      const retained = await readFile($<HTMLInputElement>('retained'));
      const height = Number(($<HTMLInputElement>('height')).value || 0);
      const merkle = $<HTMLInputElement>('merkle').value.trim().toLowerCase();
      const chainContext = height > 0 && /^[0-9a-f]{64}$/.test(merkle) ? { height, blockHash: '', merkleRootHex: merkle, time: 0 } : null;
      const res = verifyBundle({ bundle, retained, trustedKeys: keys, chainContext });
      const head = document.createElement('p');
      head.className = res.integrityOk ? 'ok banner' : 'bad banner';
      head.textContent = res.integrityOk ? v.integrityPassed : v.integrityFailed;
      out.appendChild(head);
      const bc = res.rows.find((r) => r.id === 'blockchain');
      if (bc && bc.status !== 'pass') {
        const p = document.createElement('p');
        p.className = 'muted banner';
        p.textContent = v.offline;
        out.appendChild(p);
      }
      const ol = document.createElement('ol');
      for (const r of res.rows) {
        const li = document.createElement('li');
        li.dataset.check = r.id;
        li.dataset.status = r.status;
        const title = document.createElement('strong');
        title.textContent = `${v.rows[r.id]} — ${v.result[r.status]}`;
        title.className = r.status === 'pass' ? 'ok' : r.status === 'fail' ? 'bad' : 'muted';
        const msg = document.createElement('p');
        msg.textContent = r.message;
        li.append(title, msg);
        if (r.details?.length) {
          const d = document.createElement('ul');
          for (const x of r.details) {
            const di = document.createElement('li');
            di.textContent = x;
            d.appendChild(di);
          }
          li.appendChild(d);
        }
        ol.appendChild(li);
      }
      out.appendChild(ol);
    } catch (err) {
      const p = document.createElement('p');
      p.className = 'bad banner';
      p.textContent = `Could not read the files: ${(err as Error).message}`;
      out.appendChild(p);
    }
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', render);
else render();
