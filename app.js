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
  options: { carretasPlates: [], collectorPlates: [], neighborhoods: [], fiscals: [] }
};

const $ = id => document.getElementById(id);
const kgFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const integerFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });

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
      if (!response.ok) throw new Error('Conexão indisponível.');
      const result = await response.json();
      if (result?.success !== true) throw new Error(result?.error || 'Não foi possível concluir.');
      return result;
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError' || error instanceof TypeError) throw new Error('Não foi possível confirmar a conexão. Tente novamente sem mudar os campos; o identificador do envio evita duplicidade.');
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
  return `${plate(trip.placaCarreta)} · saída ${formatDateTime(trip.saidaEm)}${trip.manifesto ? ` · manifesto ${clean(trip.manifesto)}` : ''}`;
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
    state.openTrips.forEach(trip => select.add(new Option(tripLabel(trip), clean(trip.id))));
    if ([...select.options].some(option => option.value === former)) select.value = former;
  }
  $('retornoViagemHint').textContent = state.openTrips.length
    ? `${state.openTrips.length} saída(s) aguardando retorno. Confira placa e horário.`
    : 'Nenhuma saída em aberto. Registre primeiro a saída da carreta.';
}

async function refreshBootstrap() {
  try {
    const result = assertResult(await bridge.call('getBootstrap'));
    state.openTrips = Array.isArray(result.openTrips) ? result.openTrips : [];
    state.options = result.options || state.options;
    fillSelect('saidaPlaca', state.options.carretasPlates, 'Selecione a carreta');
    fillSelect('coletorCarreta', state.options.carretasPlates, 'Não sei / não informado');
    fillSelect('coletorPlaca', state.options.collectorPlates, 'Selecione o coletor', result.collectorLabels);
    fillSelect('coletorBairro', state.options.neighborhoods, 'Selecione o bairro');
    ['saidaFiscal','retornoFiscal','coletorFiscal'].forEach(id=>fillSelect(id,state.options.fiscals,'Selecione o fiscal'));
    if ($('coletorCadastroHint')) $('coletorCadastroHint').textContent = 'Selecione os dados cadastrados. O horário será automático.';
    renderOpenTrips();
    setStatus('Conectado à planilha do Transbordo. Pronto para registrar.', 'ok');
  } catch (error) {
    setStatus(error.message, 'error');
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
    manifesto: clean($('saidaManifesto').value),
    fiscal: clean($('saidaFiscal').value),
    observacoes: clean($('saidaObservacoes').value)
  };
  if (!payload.placaCarreta || !payload.fiscal) return toast('Informe a placa e o fiscal.', 'error');
  if (!window.confirm(`Confirmar saída da carreta ${payload.placaCarreta} SEM peso?\nO peso será informado somente no retorno.`)) return;
  payload.clientRequestId = requestIdFor(form, payload);
  const button = $('saveSaida');
  setFormBusy(form, button, true, 'Registrando saída...');
  try {
    assertResult(await bridge.call('registrarSaida', [payload]));
    form.reset();
    clearRequestId(form);
    $('saidaFiscal').value = payload.fiscal;
    toast(`Saída da carreta ${payload.placaCarreta} registrada.`, 'success');
    await refreshBootstrap();
  } catch (error) { toast(error.message, 'error'); }
  finally { setFormBusy(form, button, false); }
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
  const button = $('saveRetorno');
  setFormBusy(form, button, true, 'Registrando retorno...');
  try {
    assertResult(await bridge.call('registrarRetorno', [payload]));
    form.reset();
    clearRequestId(form);
    $('retornoFiscal').value = payload.fiscal;
    updateWeightPreview();
    toast(`Retorno de ${plate(trip.placaCarreta)} registrado com ${formatKg(kg)}.`, 'success');
    await refreshBootstrap();
  } catch (error) { toast(error.message, 'error'); }
  finally { setFormBusy(form, button, false); }
}

function syncCollectorTrip() {
  const trip = state.openTrips.find(item => clean(item.id) === clean($('coletorViagem').value));
  if (trip) $('coletorCarreta').value = plate(trip.placaCarreta);
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
  const button = $('saveColetor');
  setFormBusy(form, button, true, 'Registrando coletor...');
  try {
    assertResult(await bridge.call('registrarColetor', [payload]));
    form.reset();
    clearRequestId(form);
    $('coletorFiscal').value = payload.fiscal;
    toast(`Coletor ${payload.placaColetor} registrado em ${payload.bairro}.`, 'success');
    await refreshBootstrap();
  } catch (error) { toast(error.message, 'error'); }
  finally { setFormBusy(form, button, false); }
}

function init() {
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
  bridge.init();
  refreshBootstrap();
}
document.addEventListener('DOMContentLoaded',init);
