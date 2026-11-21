// Bibix Chat AI — popup: quick switches for the current chat.
const $ = (s) => document.querySelector(s);
const bg = (msg) => chrome.runtime.sendMessage(msg).then(r => { if (!r?.ok) throw new Error(r?.error || 'No response'); return r.data; });
let S, tab, chat = null;

async function currentChat() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url || !/web\.whatsapp\.com|web\.telegram\.org/.test(tab.url)) return null;
  try { return await chrome.tabs.sendMessage(tab.id, { type: 'GET_CHAT' }); } catch (_) { return null; }
}
function pref() { return (chat && S.perChat?.[chat.chatKey]) || {}; }

async function init() {
  S = await bg({ type: 'GET_SETTINGS' });
  chat = await currentChat();
  $('#langs').innerHTML = BX_LANGUAGES.map(l => `<option value="${l}">`).join('');
  $('#provider').innerHTML = Object.entries(BX_PROVIDERS).map(([id, p]) => `<option value="${id}">${p.name}</option>`).join('');
  $('#provider').value = S.provider;
  $('#enabled').checked = S.enabled;
  $('#myLanguage').value = S.myLanguage;
  if (chat?.title) { $('#chat').textContent = `Chat: ${chat.title}`; $('#targetLabel').textContent = 'Send to this chat in'; }
  else if (!chat) { $('#notchat').style.display = 'block'; $('#translateVisible').disabled = true; }
  $('#targetLanguage').value = pref().targetLanguage || S.targetLanguage;
  $('#autoIncoming').checked = pref().autoIncoming ?? S.autoIncoming;

  const saveGlobal = (patch) => bg({ type: 'SET_SETTINGS', patch }).then(s => { S = s; });
  const savePerChat = async (patch) => {
    if (!chat?.chatKey) return saveGlobal(patch);
    const perChat = { ...(S.perChat || {}) };
    perChat[chat.chatKey] = { ...(perChat[chat.chatKey] || {}), ...patch };
    return saveGlobal({ perChat });
  };
  $('#enabled').addEventListener('change', e => saveGlobal({ enabled: e.target.checked }));
  $('#provider').addEventListener('change', e => saveGlobal({ provider: e.target.value }));
  $('#myLanguage').addEventListener('change', e => saveGlobal({ myLanguage: e.target.value.trim() || 'English' }));
  $('#targetLanguage').addEventListener('change', e => savePerChat({ targetLanguage: e.target.value.trim() || S.targetLanguage }));
  $('#autoIncoming').addEventListener('change', e => savePerChat({ autoIncoming: e.target.checked }));
  $('#translateVisible').addEventListener('click', () => chrome.tabs.sendMessage(tab.id, { type: 'TRANSLATE_VISIBLE' }).then(() => window.close()).catch(e => $('#status').textContent = e.message));
  $('#options').addEventListener('click', () => chrome.runtime.openOptionsPage());

  const cfg = bxProviderConfig(S, S.provider);
  if (!cfg.apiKey && !cfg.noKey) $('#status').innerHTML = `⚠ No API key for ${BX_PROVIDERS[S.provider].name} — set it in <a href="#" id="go">settings</a>.`, $('#go').onclick = () => chrome.runtime.openOptionsPage();
}
init().catch(e => { $('#status').textContent = e.message; });
