/* PIN prompt shared by pages that need organiser access. Requires a #pinDlg dialog in the page. */
async function checkPin(pin) {
  const r = await fetch('/api/check-pin', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pin }) });
  return (await r.json()).ok;
}

async function ensurePin() {
  if (T.getPin() && (await checkPin(T.getPin()))) return true;
  const dlg = document.getElementById('pinDlg');
  const input = document.getElementById('pinInput');
  for (;;) {
    input.value = '';
    dlg.showModal();
    const result = await new Promise((res) => dlg.addEventListener('close', () => res(dlg.returnValue), { once: true }));
    if (result !== 'ok') return false;
    if (await checkPin(input.value)) {
      T.setPin(input.value);
      return true;
    }
    T.toast('Wrong PIN');
  }
}
