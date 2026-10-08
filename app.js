'use strict';

// URL /exec da implantação do clone TRANSBORDO na conta marxb50.
const SCRIPT_BRIDGE_URL = 'https://script.google.com/macros/s/AKfycbxXOVsfgi81rqb5F_-kQY4CZwrN5XmwUSCr84E7bb3DjfdJDnrSBVkG1-W55q3MRy6n0A/exec';
const BRIDGE_METHODS = new Set([
  'getBootstrap', 'registrarSaida', 'registrarRetorno', 'registrarColetor'
]);

const state = {
  demo: false,
  mode: '',
  step: 'saida',
  openTrips: [],
  options: { carretasPlates: [], collectorPlates: [], neighborhoods: [], fiscals: [] },
  bootstrapLoadedAt: null,
  syncingQueue: false,
  pendingReturnTripIds: new Set()
};

const $ = id => document.getElementById(id);
const kgFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const integerFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
const OFFLINE_DB_NAME = 'selim-transbordo-offline-v1';
const OFFLINE_DB_VERSION = 1;
let offlineDbPromise;

const offlineStore = {
  open() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('Este navegador não permite guardar envios offline.'));
    if (offlineDbPromise) return offlineDbPromise;
    offlineDbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(OFFLINE_DB_NAME, OFFLINE_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains('pending')) db.createObjectStore('pending', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      };
      request.onsuccess = () => {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
      request.onerror = () => reject(request.error || new Error('Não foi possível abrir o armazenamento local.'));
      request.onblocked = () => reject(new Error('Feche outras abas do Transbordo e tente novamente.'));
    });
    offlineDbPromise.catch(() => { offlineDbPromise = null; });
    return offlineDbPromise;
  },
  async transaction(storeName, mode, action) {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      let result;
      try { result = action(tx.objectStore(storeName)); }
      catch (error) { reject(error); return; }
      tx.oncomplete = () => resolve(result?.result);
      tx.onerror = () => reject(tx.error || new Error('Falha ao salvar no aparelho.'));
      tx.onabort = () => reject(tx.error || new Error('O armazenamento local foi interrompido.'));
    });
  },
  put(item) { return this.transaction('pending', 'readwrite', store => store.put(item)); },
  remove(id) { return this.transaction('pending', 'readwrite', store => store.delete(id)); },
  list() {
    return this.transaction('pending', 'readonly', store => store.getAll()).then(items =>
      (items || []).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    );
  },
  async saveBootstrap(value) {
    return this.transaction('meta', 'readwrite', store => store.put({ key: 'bootstrap', value }));
  },
  async loadBootstrap() {
    const record = await this.transaction('meta', 'readonly', store => store.get('bootstrap'));
    return record?.value || null;
  }
};

const bridge = {
  init() { setStatus('Conectando à planilha do Transbordo...'); },
  async call(method, args = []) {
    if (!BRIDGE_METHODS.has(method)) throw new Error('Operação não permitida.');
    let response;
    try {
      const endpoint = new URL(SCRIPT_BRIDGE_URL);
      endpoint.searchParams.set('_request',window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      response = await fetch(endpoint, {
        method: 'POST', mode: 'cors', credentials: 'omit', redirect: 'follow',
        referrerPolicy: 'no-referrer', headers: {'Content-Type':'text/plain;charset=utf-8'},
        body: JSON.stringify({public:true,method,args}), signal: AbortSignal.timeout(90000)
      });
      if (!response.ok) {
        const error = new Error('Conexão indisponível.');
        error.retryable = response.status === 429 || response.status >= 500;
        throw error;
      }
      let result;
      try { result = await response.json(); }
      catch (parseError) {
        const error = new Error('A resposta do servidor não pôde ser confirmada.');
        error.retryable = true;
        throw error;
      }
      if (result?.success !== true) {
        const error = new Error(result?.error || 'Não foi possível concluir.');
        error.retryable = false;
        throw error;
      }
      return result;
    } catch (error) {
      if (error.retryable !== undefined) throw error;
      if (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError) {
        const networkError = new Error('Não foi possível confirmar a conexão. O envio ficará guardado neste aparelho para sincronização.');
        networkError.retryable = true;
        throw networkError;
      }
      throw error;
    }
  }
};

function setStatus(message, kind = '') {
  const node = $('systemStatus');
  node.textContent = message;
  node.className = `system-status${kind ? ` ${kind}` : ''}`;
}

let toastTimer;
function toast(message, kind = '') {
  const node = $('toast');
  node.textContent = message;
  node.className = `toast${kind ? ` ${kind}` : ''}`;
  node.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { node.hidden = true; }, 7000);
}

function assertResult(result) {
  if (!result || result.success !== true) throw new Error(String(result?.message || result?.error || 'Não foi possível concluir. Tente novamente.'));
  return result;
}

function clean(value) { return String(value ?? '').trim(); }
function plate(value) { return clean(value).toUpperCase().replace(/[^A-Z0-9]/g, ''); }
function number(value) { const result = Number(value); return Number.isFinite(result) && result >= 0 ? result : 0; }
function formatKg(value) { return `${kgFormat.format(number(value))} kg`; }
function requestIdFor(form, payload) {
  const signature = JSON.stringify(payload);
  if (!form.dataset.clientRequestId || form.dataset.requestSignature !== signature) {
    form.dataset.clientRequestId = window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    form.dataset.requestSignature = signature;
  }
  return form.dataset.clientRequestId;
}
function clearRequestId(form) {
  delete form.dataset.clientRequestId;
  delete form.dataset.requestSignature;
}
function formatDateTime(value) {
  if (!value) return 'horário não informado';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? clean(value) : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(date);
}
function humanDay(value) {
  const text = clean(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : text;
}
function humanPeriodLabel(value) {
  return clean(value).replace(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_, year, month, day) => `${day}/${month}/${year}`)
    .replace(/\b(\d{4})-(\d{2})\b/g, (_, year, month) => `${month}/${year}`);
}
function todayLocal() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Fortaleza', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function setBusy(button, busy, label) {
  if (busy) {
    button.dataset.normalLabel = button.textContent;
    button.textContent = label || 'Salvando...';
    button.disabled = true;
  } else {
    button.textContent = button.dataset.normalLabel || button.textContent;
    button.disabled = false;
  }
}
function setFormBusy(form, button, busy, label) {
  setBusy(button, busy, label);
  form.querySelectorAll('input, select, textarea').forEach(control => { control.disabled = busy; });
}

function chooseMode(mode, focus = true) {
  state.mode = mode;
  const carretas = mode === 'carretas';
  $('carretasSection').hidden = !carretas;
  $('coletoresSection').hidden = carretas;
  $('chooseCarretas').classList.toggle('active', carretas);
  $('chooseColetores').classList.toggle('active', !carretas);
  $('chooseCarretas').setAttribute('aria-pressed', String(carretas));
  $('chooseColetores').setAttribute('aria-pressed', String(!carretas));
  if (focus) {
    const section = carretas ? $('carretasSection') : $('coletoresSection');
    section.scrollIntoView({ behavior: 'smooth', block: 'start' });
    section.querySelector('h2').setAttribute('tabindex', '-1');
    section.querySelector('h2').focus({ preventScroll: true });
  }
}

function chooseStep(step) {
  state.step = step;
  const saida = step === 'saida';
  $('saidaPanel').hidden = !saida;
  $('retornoPanel').hidden = saida;
  $('showSaida').classList.toggle('active', saida);
  $('showRetorno').classList.toggle('active', !saida);
  $('showSaida').setAttribute('aria-pressed', String(saida));
  $('showRetorno').setAttribute('aria-pressed', String(!saida));
  if (!saida) refreshBootstrap();
}

function fillSelect(id, values, first, labels = {}) {
  const select = $(id), former = select.value;
  select.replaceChildren(new Option(first, ''));
  [...new Set((values || []).map(clean).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'pt-BR')).forEach(value=>select.add(new Option(labels[value] || value, value)));
  if ([...select.options].some(option=>option.value === former)) select.value = former;
}

function tripLabel(trip) {
  return `${plate(trip.placaCarreta)} · saída ${formatDateTime(trip.saidaEm)}`;
}

function renderOpenTrips() {
  const options = [
    { id: 'retornoViagem', first: 'Selecione a saída correspondente' },
    { id: 'coletorViagem', first: 'Não sei a viagem / nenhuma viagem aberta' }
  ];
  for (const config of options) {
    const select = $(config.id);
    const former = select.value;
    select.replaceChildren(new Option(config.first, ''));
    const available = config.id === 'retornoViagem'
      ? state.openTrips.filter(trip => !state.pendingReturnTripIds.has(clean(trip.id)))
      : state.openTrips;
    available.forEach(trip => select.add(new Option(tripLabel(trip), clean(trip.id))));
    if ([...select.options].some(option => option.value === former)) select.value = former;
  }
  const availableReturns = state.openTrips.filter(trip => !state.pendingReturnTripIds.has(clean(trip.id))).length;
  $('retornoViagemHint').textContent = availableReturns
    ? `${availableReturns} saída(s) aguardando retorno. Confira placa e horário.`
    : state.pendingReturnTripIds.size
      ? 'O retorno desta saída já está aguardando sincronização neste aparelho.'
      : 'Nenhuma saída em aberto. Registre primeiro a saída da carreta.';
}

function applyBootstrap(data, loadedAt = new Date().toISOString()) {
  state.openTrips = Array.isArray(data.openTrips) ? data.openTrips : [];
  state.options = data.options || state.options;
  state.bootstrapLoadedAt = loadedAt;
  fillSelect('saidaPlaca', state.options.carretasPlates, 'Selecione a carreta');
  fillSelect('coletorCarreta', state.options.carretasPlates, 'Não sei / não informado');
  fillSelect('coletorPlaca', state.options.collectorPlates, 'Selecione o coletor', data.collectorLabels);
  fillSelect('coletorBairro', state.options.neighborhoods, 'Selecione o bairro');
  ['saidaFiscal','retornoFiscal','coletorFiscal'].forEach(id=>fillSelect(id,state.options.fiscals,'Selecione o fiscal'));
  if ($('coletorCadastroHint')) $('coletorCadastroHint').textContent = 'Selecione os dados cadastrados. O horário será automático.';
  renderOpenTrips();
}

function savedBootstrapLabel() {
  return state.bootstrapLoadedAt
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short', timeZone: 'America/Fortaleza' }).format(new Date(state.bootstrapLoadedAt))
    : '';
}

async function refreshBootstrap() {
  if (navigator.onLine === false) {
    setStatus(state.bootstrapLoadedAt
      ? `Sem internet. Usando as opções salvas em ${savedBootstrapLabel()}.`
      : 'Sem internet e sem dados anteriores neste aparelho. Abra o formulário conectado pelo menos uma vez.', state.bootstrapLoadedAt ? 'offline' : 'error');
    return;
  }
  try {
    const result = assertResult(await bridge.call('getBootstrap'));
    const loadedAt = new Date().toISOString();
    applyBootstrap(result, loadedAt);
    await offlineStore.saveBootstrap({
      openTrips: state.openTrips,
      options: state.options,
      collectorLabels: result.collectorLabels || {},
      loadedAt
    }).catch(() => {});
    setStatus('Conectado à planilha do Transbordo. Pronto para registrar.', 'ok');
  } catch (error) {
    if (state.bootstrapLoadedAt) {
      setStatus(`Não foi possível atualizar as opções. Usando os dados salvos em ${savedBootstrapLabel()}.`, 'offline');
    } else {
      setStatus(navigator.onLine
        ? `${error.message} Abra novamente com internet para carregar as opções.`
        : 'Sem internet e sem dados anteriores neste aparelho. Abra o formulário conectado pelo menos uma vez.', 'error');
    }
  }
}

function pendingTitle(item) {
  const payload = item.args?.[0] || {};
  if (item.method === 'registrarSaida') return `Saída da carreta ${payload.placaCarreta || '—'}`;
  if (item.method === 'registrarRetorno') return `Retorno da viagem ${payload.viagemId || '—'} · ${formatKg(payload.pesoKg)}`;
  if (item.method === 'registrarColetor') return `Coletor ${payload.placaColetor || '—'} · ${payload.bairro || 'bairro não informado'}`;
  return 'Registro do Transbordo';
}

async function renderQueueStatus() {
  try {
    const items = await offlineStore.list();
    const box = $('queueStatus');
    if (!box) return;
    state.pendingReturnTripIds = new Set(items
      .filter(item => item.method === 'registrarRetorno')
      .map(item => clean(item.args?.[0]?.viagemId))
      .filter(Boolean));
    renderOpenTrips();
    box.hidden = items.length === 0;
    const waiting = items.length;
    const attention = items.filter(item => item.needsAttention).length;
    const message = $('queueMessage');
    if (message && waiting) {
      message.textContent = attention
        ? `${waiting} registro(s) ainda estão somente neste aparelho; ${attention} precisa(m) de conferência porque o servidor recusou o envio. Nada foi apagado.`
        : `${waiting} registro(s) aguardam envio. Ainda não aparecem na planilha nem nos relatórios do Admin.`;
    }
    const button = $('syncPending');
    if (button) {
      button.hidden = !navigator.onLine || waiting === 0;
      button.disabled = state.syncingQueue;
      button.textContent = state.syncingQueue ? 'Enviando...' : 'Sincronizar agora';
    }
    const list = $('pendingList');
    if (list) {
      list.replaceChildren(...items.map(item => {
        const row = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = pendingTitle(item);
        const date = document.createElement('small');
        date.textContent = `Guardado em ${formatDateTime(item.createdAt)}`;
        row.append(title, date);
        if (item.needsAttention) {
          const problem = document.createElement('span');
          problem.className = 'pending-error';
          problem.textContent = `Conferir com a SELIM: ${item.lastError || 'o servidor não aceitou este registro.'}`;
          row.append(problem);
        }
        return row;
      }));
    }
  } catch (error) {
    const box = $('queueStatus');
    if (box) box.hidden = false;
    const message = $('queueMessage');
    if (message) message.textContent = error.message || 'Não foi possível consultar os envios guardados neste aparelho.';
  }
}

async function storePending(method, payload) {
  await offlineStore.put({
    id: payload.clientRequestId,
    method,
    args: [{ ...payload }],
    createdAt: new Date().toISOString(),
    needsAttention: false
  });
  await renderQueueStatus();
}

async function syncPendingQueue({ manual = false } = {}) {
  if (state.syncingQueue || !navigator.onLine) {
    await renderQueueStatus();
    return;
  }
  state.syncingQueue = true;
  await renderQueueStatus();
  let sent = 0;
  let problem = null;
  try {
    const items = await offlineStore.list();
    for (const item of items) {
      if (item.needsAttention && !manual) continue;
      try {
        await bridge.call(item.method, item.args);
        await offlineStore.remove(item.id);
        sent += 1;
      } catch (error) {
        if (!error.retryable) {
          item.needsAttention = true;
          item.lastError = error.message;
          item.lastAttemptAt = new Date().toISOString();
          await offlineStore.put(item);
          problem = { type: 'rejected', error };
        } else {
          problem = { type: 'network', error };
        }
        break;
      }
    }
  } catch (error) {
    problem = { type: 'storage', error };
  } finally {
    state.syncingQueue = false;
    await renderQueueStatus();
  }
  if (sent) toast(`${sent} registro(s) sincronizado(s) com a planilha.`, 'success');
  if (problem?.type === 'rejected') {
    toast('Um registro precisa de conferência: o servidor não o aceitou e ele continua salvo neste aparelho.', 'error');
  } else if (problem?.type === 'network') {
    setStatus('Conexão instável. Os registros pendentes continuam salvos neste aparelho.', 'offline');
  } else if (problem?.type === 'storage') {
    toast(problem.error.message || 'Falha ao acessar os registros pendentes.', 'error');
  }
  if (sent) await refreshBootstrap();
}

async function sendOrQueue({ form, payload, method, button, loadingText, successText, onComplete }) {
  setFormBusy(form, button, true, loadingText);
  try {
    if (navigator.onLine === false) {
      await storePending(method, payload);
      onComplete();
      toast('Sem internet: registro guardado neste aparelho. Ele será enviado quando a conexão voltar.', 'pending');
      return;
    }
    try {
      await bridge.call(method, [payload]);
      await offlineStore.remove(payload.clientRequestId).catch(() => {});
      await renderQueueStatus();
      onComplete();
      toast(successText, 'success');
      await refreshBootstrap();
      syncPendingQueue();
    } catch (error) {
      if (!error.retryable) throw error;
      await storePending(method, payload);
      onComplete();
      toast('Não foi possível confirmar o envio. O registro ficou salvo neste aparelho com o mesmo identificador para evitar duplicidade.', 'pending');
    }
  } catch (error) {
    toast(error.message || 'Não foi possível guardar o registro. Mantenha os dados preenchidos e tente novamente.', 'error');
  } finally {
    setFormBusy(form, button, false);
  }
}

// Peso: separador decimal brasileiro e separador de milhares. Valor com unidade
// visível é convertido para kg antes de enviar. Ambiguidade é evitada na confirmação.
function parseLocaleWeight(raw, unit) {
  let value = clean(raw).replace(/\s/g, '');
  if (!/^\d[\d.,]*$/.test(value)) return NaN;
  const comma = value.lastIndexOf(',');
  const dot = value.lastIndexOf('.');
  if (comma >= 0 && dot >= 0) {
    const decimal = comma > dot ? ',' : '.';
    const grouping = decimal === ',' ? '.' : ',';
    const valid = decimal === ','
      ? /^\d{1,3}(?:\.\d{3})+,\d+$/.test(value)
      : /^\d{1,3}(?:,\d{3})+\.\d+$/.test(value);
    if (!valid) return NaN;
    value = value.replaceAll(grouping, '').replace(decimal, '.');
  } else if (comma >= 0) {
    if (/^\d+,\d+$/.test(value)) value = value.replace(',', '.');
    else if (/^\d{1,3}(?:,\d{3})+$/.test(value)) value = value.replaceAll(',', '');
    else return NaN;
  } else if (dot >= 0) {
    if (/^\d+\.\d+$/.test(value) && value.indexOf('.') === dot) {
      if (unit === 'kg' && /^\d{1,3}\.\d{3}$/.test(value)) value = value.replace('.', '');
    } else if (/^\d{1,3}(?:\.\d{3})+$/.test(value)) value = value.replaceAll('.', '');
    else return NaN;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return NaN;
  const kg = unit === 't' ? parsed * 1000 : parsed;
  return Math.round(kg * 1000) / 1000;
}

function updateWeightPreview() {
  const raw = $('retornoPeso').value;
  const unit = $('retornoUnidade').value;
  const kg = parseLocaleWeight(raw, unit);
  $('weightPreview').textContent = Number.isFinite(kg)
    ? `Peso a registrar: ${formatKg(kg)}${kg < 1000 ? ' · Confira se a unidade do comprovante é kg ou t.' : ''}`
    : 'Peso a registrar: —';
}

async function saveSaida(event) {
  event.preventDefault();
  const form = $('saidaForm');
  if (!form.reportValidity()) return;
  const payload = {
    placaCarreta: plate($('saidaPlaca').value),
    fiscal: clean($('saidaFiscal').value),
    observacoes: clean($('saidaObservacoes').value)
  };
  if (!payload.placaCarreta || !payload.fiscal) return toast('Informe a placa e o fiscal.', 'error');
  if (!window.confirm(`Confirmar saída da carreta ${payload.placaCarreta} SEM peso?\nO peso será informado somente no retorno.`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  await sendOrQueue({
    form, payload, method: 'registrarSaida', button: $('saveSaida'), loadingText: 'Registrando saída...',
    successText: `Saída da carreta ${payload.placaCarreta} registrada.`,
    onComplete: () => {
    form.reset();
    clearRequestId(form);
    $('saidaFiscal').value = payload.fiscal;
    }
  });
}

async function saveRetorno(event) {
  event.preventDefault();
  const form = $('retornoForm');
  if (!form.reportValidity()) return;
  const viagemId = clean($('retornoViagem').value);
  const trip = state.openTrips.find(item => clean(item.id) === viagemId);
  if (!trip) return toast('Selecione uma saída em aberto e confira a placa.', 'error');
  const kg = parseLocaleWeight($('retornoPeso').value, $('retornoUnidade').value);
  if (!Number.isFinite(kg) || kg <= 0) return toast('Informe um peso válido e a unidade do comprovante.', 'error');
  const payload = {
    viagemId,
    pesoKg: kg,
    ticket: clean($('retornoTicket').value),
    fiscal: clean($('retornoFiscal').value),
    observacoes: clean($('retornoObservacoes').value)
  };
  if (!payload.fiscal) return toast('Informe o fiscal responsável.', 'error');
  const originalWeight = `${clean($('retornoPeso').value)} ${$('retornoUnidade').value}`;
  if (!window.confirm(`Confirmar retorno da carreta ${plate(trip.placaCarreta)}?\nPeso digitado: ${originalWeight}\nPeso gravado: ${formatKg(kg)}\nConfira o comprovante antes de continuar.`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  await sendOrQueue({
    form, payload, method: 'registrarRetorno', button: $('saveRetorno'), loadingText: 'Registrando retorno...',
    successText: `Retorno de ${plate(trip.placaCarreta)} registrado com ${formatKg(kg)}.`,
    onComplete: () => {
    form.reset();
    clearRequestId(form);
    $('retornoFiscal').value = payload.fiscal;
    updateWeightPreview();
    }
  });
}

function syncCollectorTrip() {
  const trip = state.openTrips.find(item => clean(item.id) === clean($('coletorViagem').value));
  if (trip) $('coletorCarreta').value = plate(trip.placaCarreta);
}

async function restoreCachedBootstrap() {
  try {
    const cached = await offlineStore.loadBootstrap();
    if (!cached) return false;
    applyBootstrap(cached, cached.loadedAt);
    setStatus(navigator.onLine
      ? `Opções salvas neste aparelho em ${savedBootstrapLabel()}. Atualizando...`
      : `Sem internet. Usando as opções salvas em ${savedBootstrapLabel()}.`, navigator.onLine ? 'pending' : 'offline');
    return true;
  } catch (error) {
    return false;
  }
}

function registerOfflineShell() {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('./sw.js', { scope: './' }).catch(() => {});
}

async function saveColetor(event) {
  event.preventDefault();
  const form = $('coletorForm');
  if (!form.reportValidity()) return;
  const payload = {
    placaColetor: plate($('coletorPlaca').value),
    bairro: clean($('coletorBairro').value),
    fiscal: clean($('coletorFiscal').value),
    placaCarreta: plate($('coletorCarreta').value),
    viagemId: clean($('coletorViagem').value),
    observacoes: clean($('coletorObservacoes').value)
  };
  if (!payload.placaColetor || !payload.bairro || !payload.fiscal) return toast('Informe placa do coletor, bairro e fiscal.', 'error');
  const trip = state.openTrips.find(item => clean(item.id) === payload.viagemId);
  if (payload.viagemId && !trip) return toast('A viagem selecionada não está mais aberta. Atualize e confira.', 'error');
  if (trip && payload.placaCarreta && payload.placaCarreta !== plate(trip.placaCarreta)) {
    return toast('A placa da carreta não corresponde à viagem selecionada. Corrija antes de salvar.', 'error');
  }
  if (trip) payload.placaCarreta = plate(trip.placaCarreta);
  const relation = payload.placaCarreta ? `Carreta relacionada: ${payload.placaCarreta}${trip ? ' (viagem identificada)' : ' (somente placa)'}.` : 'Sem carreta relacionada.';
  if (!window.confirm(`Registrar coletor ${payload.placaColetor} no bairro ${payload.bairro}?\n${relation}`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  await sendOrQueue({
    form, payload, method: 'registrarColetor', button: $('saveColetor'), loadingText: 'Registrando coletor...',
    successText: `Coletor ${payload.placaColetor} registrado em ${payload.bairro}.`,
    onComplete: () => {
    form.reset();
    clearRequestId(form);
    $('coletorFiscal').value = payload.fiscal;
    }
  });
}

async function init() {
  $('chooseCarretas').addEventListener('click',()=>chooseMode('carretas'));
  $('chooseColetores').addEventListener('click',()=>chooseMode('coletores'));
  $('showSaida').addEventListener('click',()=>chooseStep('saida'));
  $('showRetorno').addEventListener('click',()=>chooseStep('retorno'));
  $('saidaForm').addEventListener('submit',saveSaida);
  $('retornoForm').addEventListener('submit',saveRetorno);
  $('coletorForm').addEventListener('submit',saveColetor);
  $('retornoPeso').addEventListener('input',updateWeightPreview);
  $('retornoUnidade').addEventListener('change',updateWeightPreview);
  $('coletorViagem').addEventListener('change',syncCollectorTrip);
  $('syncPending').addEventListener('click',()=>syncPendingQueue({ manual: true }));
  window.addEventListener('offline',()=>{
    setStatus(state.bootstrapLoadedAt
      ? `Sem internet. Usando as opções salvas em ${savedBootstrapLabel()}. Envios serão guardados neste aparelho.`
      : 'Sem internet e sem dados anteriores neste aparelho. Abra conectado ao menos uma vez para carregar as opções.', state.bootstrapLoadedAt ? 'offline' : 'error');
    renderQueueStatus();
  });
  window.addEventListener('online',()=>{
    setStatus('Conexão voltou. Atualizando opções e enviando registros pendentes...', 'pending');
    refreshBootstrap();
    syncPendingQueue();
  });
  registerOfflineShell();
  bridge.init();
  await restoreCachedBootstrap();
  if (navigator.onLine) {
    refreshBootstrap();
    syncPendingQueue();
  } else {
    refreshBootstrap();
  }
  renderQueueStatus();
}
document.addEventListener('DOMContentLoaded',init);
