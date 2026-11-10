/* PayBoard v0.2 — Cloudflare Worker API client. No fake fetch, no client-side capture, no secrets. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const money = cents => '$' + ((Number(cents) || 0) / 100).toFixed(2);
  const iconBySku = {latte:'☕',americano:'☕',croissant:'🥐',bagel:'🥯',water:'💧'};
  const translations = {
    zh: {
      eyebrow:'共享工作台 · 真實測試付款', headline:'你說需求，AI 提案。<br><em>付款由你決定。</em>',
      intro:'AI 只會建議購物車。你批准購物車後，還要親自在 PayPal 確認付款。',
      sandbox:'PayPal Sandbox · 非真金錢', stepShop:'挑選',stepReview:'審核',stepPay:'付款',
      shopOverline:'01 / SHOP',products:'商品',directEditHint:'＋／－ 是你直接修改購物車，不需要呼叫 AI。',
      proposalOverline:'02 / AI SUGGESTION',proposalTitle:'AI 提案',reject:'拒絕',approve:'批准提案',proposalSafety:'提案不會直接改購物車或觸發付款。',
      history:'可稽核事件紀錄',cartOverline:'03 / HUMAN CONTROL',cart:'我的購物車',total:'合計',budget:'預算上限（美元）',save:'設定',payment:'付款確認',noCart:'請先挑選商品。',
      askAi:'告訴 AI 你想買什麼', placeholder:'例如：幫我加兩杯拿鐵，不超過 $15',
      examples:['幫我加兩杯拿鐵','我想花不到15美元買早餐'], examplesLabel:['兩杯拿鐵','$15 早餐'],
      loading:'讀取中…',networkError:'無法連線後端，請從已部署的 PayBoard 網站開啟。',
      local:'本機規則備援（非 AI）',gemini:'Gemini 已設定',aiNotSet:'未設定 AI 金鑰',unknownSource:'來源未記錄',
      aiWorking:'正在產生提案…',connected:'服務已連線',disconnected:'後端未連線',
      cartEmpty:'目前沒有商品',editNotice:'手動調整購物車不需 AI 批准。',
      budgetNone:'未設定上限',budgetGood:'在預算內',budgetOver:'超過預算',budgetInvalid:'請輸入有效預算（$0.01～$10,000）',budgetSaved:'預算已更新',
      before:'目前',after:'提案後',changes:'變更內容',proposed:'提案已送達，尚未修改購物車。',approved:'人類已批准，購物車更新。',rejected:'已拒絕提案。',
      lock:'批准結帳（不付款）',lockHint:'確認購物車金額後鎖定。這個按鈕不會建立 PayPal 付款。',
      waitProposal:'請先批准或拒絕 AI 提案。',overBudget:'超過預算，請先修改購物車或預算。',
      locked:'購物車已鎖定',lockedHint:'你已批准購物車。下一步請親自在 PayPal Sandbox 視窗核准，才會執行 Capture。',
      paypalNotSet:'尚未設定 PayPal Sandbox。完成部署與金鑰設定後，這裡才會出現真付款按鈕。',
      loadPaypal:'載入 PayPal Sandbox…',cancelCheckout:'取消這次結帳',cancelled:'結帳已取消。',
      paymentDone:'Sandbox 付款完成',receipt:'真實 Sandbox 回執',newSession:'開始新購物流程',
      paypalCancelled:'你取消了 PayPal 核准，沒有確認成功付款。',paypalError:'PayPal 發生錯誤。請檢查狀態，勿直接重複付款。',
      retry:'重新整理狀態',payId:'訂單',captureId:'Capture',copy:'複製回執',copied:'回執已複製',
      phaseCart:'購物車',phaseProposal:'待批准提案',phaseLocked:'已鎖定',phaseOrder:'已建單',phasePaid:'已收款',
      source:'來源',orderCreated:'PayPal 已建單',actionsLimited:'此階段不允許修改購物車，請取消結帳或開始新流程。',
      confirmReset:'確定開始新的購物流程？之前的交易回執仍應由 PayPal 訂單紀錄保存。',
      limit:'這一小時 AI 額度已用完，仍可手動購物。', requestTimedOut:'網路等待過久，請先重新整理狀態，不要反覆付款。',
      voiceUnsupported:'此瀏覽器不支援語音輸入，請用文字。',
    },
    en: {
      eyebrow:'ONE SHARED WORKSPACE · REAL SANDBOX CHECKOUT', headline:'You ask. AI proposes.<br><em>You approve and pay.</em>',
      intro:'AI suggests cart changes. You approve the cart, then separately approve payment inside PayPal.',
      sandbox:'PayPal Sandbox · no real money',stepShop:'Shop',stepReview:'Review',stepPay:'Pay',
      shopOverline:'01 / SHOP',products:'Products',directEditHint:'＋／－ directly edits your cart without calling AI.',
      proposalOverline:'02 / AI SUGGESTION',proposalTitle:'AI proposal',reject:'Reject',approve:'Approve proposal',proposalSafety:'A proposal never changes your cart or pays automatically.',
      history:'Auditable event history',cartOverline:'03 / HUMAN CONTROL',cart:'Your cart',total:'Total',budget:'Budget limit (USD)',save:'Save',payment:'Checkout',noCart:'Choose a product first.',
      askAi:'Tell AI what you need',placeholder:'Try: two lattes, under $15',
      examples:['Add two lattes','Find a breakfast for under $15'], examplesLabel:['Two lattes','$15 breakfast'],
      loading:'Loading…',networkError:'Backend unreachable. Open the deployed PayBoard URL.',
      local:'Local rules fallback (not AI)',gemini:'Gemini configured',aiNotSet:'AI key not configured',unknownSource:'Source not logged',
      aiWorking:'Preparing suggestion…',connected:'Service connected',disconnected:'Backend offline',
      cartEmpty:'Your cart is empty',editNotice:'Manual cart edits do not need AI approval.',
      budgetNone:'No limit set',budgetGood:'Within budget',budgetOver:'Over budget',budgetInvalid:'Enter a budget between $0.01 and $10,000',budgetSaved:'Budget updated',
      before:'Current',after:'Proposed',changes:'Changes',proposed:'Suggestion ready. No cart change yet.',approved:'You approved; cart updated.',rejected:'Suggestion rejected.',
      lock:'Approve checkout (no payment)',lockHint:'Lock the reviewed amount. This button does not initiate PayPal payment.',
      waitProposal:'Approve or reject the AI proposal first.',overBudget:'Over budget; adjust items or budget.',
      locked:'Cart locked for checkout',lockedHint:'You approved the cart. Next, separately approve in PayPal Sandbox to capture payment.',
      paypalNotSet:'PayPal Sandbox is not configured. A real button appears after credentials are configured.',
      loadPaypal:'Loading PayPal Sandbox…',cancelCheckout:'Cancel this checkout',cancelled:'Checkout canceled.',
      paymentDone:'Sandbox payment completed',receipt:'Real Sandbox receipt',newSession:'Start a new session',
      paypalCancelled:'PayPal approval canceled. No completed payment confirmed.',paypalError:'PayPal error. Check the state before retrying payment.',
      retry:'Refresh status',payId:'Order',captureId:'Capture',copy:'Copy receipt',copied:'Receipt copied',
      phaseCart:'Cart',phaseProposal:'Pending proposal',phaseLocked:'Locked',phaseOrder:'Order created',phasePaid:'Captured',
      source:'Source',orderCreated:'PayPal order created',actionsLimited:'You cannot edit the cart now. Cancel checkout or start a new session.',
      confirmReset:'Start a new session? Your previous payment receipt remains in PayPal order records.',
      limit:'Hourly AI quota reached. You can still edit the cart manually.',requestTimedOut:'Network timeout. Refresh status before considering any payment retry.',
      voiceUnsupported:'Voice input unavailable in this browser. Please type instead.',
    }
  };
  let lang = (navigator.language || 'zh').toLowerCase().startsWith('zh') ? 'zh' : 'en';
  let config = null, board = null, busy = false, latestSource = null, latestAiDiagnostic = null;
  let sdkPromise = null, payRenderGeneration = 0, toastTimer = null, recording = null;
  const t = key => translations[lang][key] ?? key;
  const catalog = () => (config?.catalog ?? []);
  const product = sku => catalog().find(p => p.sku === sku);
  const productName = sku => {const p = product(sku); return p ? (lang === 'zh' ? p.zh : p.name) : String(sku);};
  const totalItems = cart => Object.values(cart || {}).reduce((n,qty) => n + Math.max(0, Number(qty) || 0), 0);
  const cartTotal = cart => Object.entries(cart || {}).reduce((n,[sku,qty]) => n + (product(sku)?.cents || 0) * (Number(qty)||0), 0);
  const isEditable = () => board?.phase === '購物車' || board?.phase === '待批准提案';
  function notice(message, isError=false) {
    const el = $('toast'); if (!message) {el.hidden = true;return;}
    el.textContent = message;el.classList.toggle('is-error',isError);el.hidden = false;
    clearTimeout(toastTimer);toastTimer = setTimeout(() => {el.hidden = true;},6500);
  }
  function setBusy(value, message='') {
    busy = value;
    $('send').disabled = value || !isEditable();
    $('message').disabled = value || !isEditable();
    $('microphone').disabled = value || !isEditable();
    $('prompt-status').textContent = message;
    document.querySelectorAll('[data-action],[data-delta]').forEach(b => b.disabled = value || b.dataset.disabled === 'true');
  }
  async function api(path, method='GET', body=null, timeoutMs=24000) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(path, {
        method,credentials:'same-origin',signal:controller.signal,
        headers: {'content-type':'application/json','accept':'application/json'},
        body: body === null ? undefined : JSON.stringify(body),
      });
      const obj = await response.json().catch(() => null);
      if (!response.ok) {
        const code = obj?.error || `HTTP_${response.status}`;
        const error = new Error(obj?.message || code);
        error.code = code;
        throw error;
      }
      if (!obj) throw new Error('INVALID_JSON_RESPONSE');
      return obj;
    } catch(err) {
      if(err?.name==='AbortError') {const e=new Error(t('requestTimedOut'));e.code='TIMEOUT';throw e;}
      throw err;
    } finally {clearTimeout(timer);}
  }
  const setText = (id,value) => {$(id).textContent = value;};
  function renderStaticText() {
    document.documentElement.lang = lang === 'zh' ? 'zh-Hant' : 'en';
    document.querySelectorAll('[data-i18n]').forEach(node => {node.textContent=t(node.dataset.i18n);});
    setText('eyebrow',window.__PAYBOARD_PREVIEW__ ? (lang==='zh'?'離線展示 · 非真付款':'OFFLINE PREVIEW · NO PAYMENTS') : t('eyebrow'));
    $('hero-title').innerHTML=t('headline');
    setText('hero-caption',t('intro'));
    setText('sandbox-text',t('sandbox'));
    $('message').placeholder=t('placeholder');
    $('language').textContent=lang==='zh'?'EN':'中';
    $('suggestions').innerHTML=t('examples').map((q,i)=>`<button type="button" data-example="${escapeHtml(q)}">${escapeHtml(t('examplesLabel')[i])}</button>`).join('');
  }
  function renderProducts() {
    $('catalog-count').textContent=`${catalog().length} · ${money(board?.total||0)}`;
    const editable = isEditable();
    $('products').innerHTML=catalog().length?catalog().map(p=>{
      const n=board?.cart?.[p.sku]||0;
      return `<div class="product"><div class="product-head"><div class="product-emoji" aria-hidden="true">${iconBySku[p.sku]||'📦'}</div><div><div class="product-name">${escapeHtml(productName(p.sku))}</div><div class="product-sku">${escapeHtml(p.sku)}</div></div></div><div class="product-footer"><span class="product-price">${money(p.cents)}</span><div class="qty-controls"><button type="button" data-delta="-1" data-sku="${escapeHtml(p.sku)}" aria-label="Remove ${escapeHtml(productName(p.sku))}" ${editable&&n>0&&!busy?'':'disabled'}>−</button><span class="qty-count" aria-label="Quantity">${n}</span><button type="button" class="plus" data-delta="1" data-sku="${escapeHtml(p.sku)}" aria-label="Add ${escapeHtml(productName(p.sku))}" ${editable&&n<9&&!busy?'':'disabled'}>+</button></div></div></div>`;
    }).join(''):`<div class="loading-card">${t('loading')}</div>`;
  }
  function renderCart() {
    const entries=Object.entries(board.cart||{}).filter(([,qty])=>qty>0);
    setText('cart-count',String(totalItems(board.cart)));
    $('cart-items').innerHTML=entries.length?entries.map(([sku,qty])=>`<div class="cart-row"><span aria-hidden="true">${iconBySku[sku]||'📦'}</span><span class="cart-name">${escapeHtml(productName(sku))}<small>${escapeHtml(sku)}</small></span><span class="cart-qty">× ${qty}</span><span class="cart-price">${money((product(sku)?.cents||0)*qty)}</span></div>`).join(''):`<div class="empty-cart">🛒<br>${t('cartEmpty')}</div>`;
    setText('cart-total',money(board.total));
    const budget=board.budgetCents;
    const over=budget!==null&&board.total>budget;
    $('budget-input').value=budget===null?'':(budget/100).toFixed(2);
    $('budget-input').disabled=!isEditable()||busy;
    $('save-budget').disabled=!isEditable()||busy;
    $('clear-budget').disabled=!isEditable()||busy||budget===null;
    setText('budget-state',budget===null?t('budgetNone'):over?t('budgetOver'):t('budgetGood'));
    $('budget-state').classList.toggle('over-text',over);
    $('budget-bar').style.width=budget===null?'0%':Math.min(100,Math.round(board.total/budget*100))+'%';
    $('budget-bar').classList.toggle('over',over);
    setText('cart-hint',over?t('overBudget'):t('editNotice'));
    $('cart-hint').classList.toggle('over-text',over);
  }
  function renderProposal() {
    const section=$('proposal-section');const p=board.proposal;
    section.hidden=!p;if(!p)return;
    setText('proposal-note',p.note||'—');
    setText('proposal-source',latestSource==='workers-ai'?'Workers AI · Gemma 4':latestSource==='gemini'?'Gemini':latestSource==='local'?t('local')+(latestAiDiagnostic?' · '+latestAiDiagnostic:''):t('unknownSource'));
    const before=board.total,after=board.proposalTotal??cartTotal(p.cart);
    const skus=new Set([...Object.keys(board.cart||{}),...Object.keys(p.cart||{})]);
    const diffs=[...skus].filter(sku=>(p.cart[sku]||0)!==(board.cart[sku]||0)).map(sku=>`${escapeHtml(productName(sku))}: ${board.cart[sku]||0} → ${p.cart[sku]||0}`);
    $('proposal-comparison').innerHTML=`<div class="compare-row"><span>${t('before')}</span><strong>${money(before)}</strong></div><div class="compare-row after"><span>${t('after')}</span><strong>${money(after)}</strong></div><div class="compare-changes">${t('changes')}: ${diffs.length?diffs.join(' · '):'—'}</div>`;
    $('approve-proposal').disabled=busy;
    $('reject-proposal').disabled=busy;
  }
  function renderHistory() {
    const events=[...(board.events||[])];
    setText('events-count',String(events.length));
    $('events').innerHTML=events.length?events.reverse().map(e=>`<div class="event"><b>#${Number(e.n)||'?'} · ${escapeHtml(e.who)} · ${escapeHtml(e.what)}</b><small>${escapeHtml(new Date(e.at).toLocaleString(lang==='zh'?'zh-TW':'en-US',{dateStyle:'short',timeStyle:'medium'}))}</small></div>`).join(''):`<p class="helper">—</p>`;
  }
  function phaseStep() {
    const phase=board.phase;
    const current=phase==='已鎖定'||phase==='已建單'||phase==='已收款'?3:phase==='待批准提案'||board.total>0?2:1;
    ['shop','review','pay'].forEach((id,i)=>{
      const n=i+1;
      $(`step-${id}`).classList.toggle('is-current',n===current);
      $(`step-${id}`).classList.toggle('is-done',n<current);
    });
  }
  function renderCheckout() {
    const el=$('checkout-body');const phase=board.phase;
    payRenderGeneration++;
    if(phase==='已收款' && board.receipt) {
      const r=board.receipt;
      el.innerHTML=`<div class="receipt-card"><div class="receipt-check">✓</div><h3>${t('paymentDone')}</h3><p class="helper">${t('receipt')} · ${money(r.totalCents)}</p><code>${t('payId')}: ${escapeHtml(r.orderId)}</code><code>${t('captureId')}: ${escapeHtml(r.captureId)}</code><p class="helper">${escapeHtml(new Date(r.at).toLocaleString(lang==='zh'?'zh-TW':'en-US'))}</p><div class="button-pair"><button class="btn btn-outline" data-action="copy" type="button">${t('copy')}</button><button class="btn btn-primary" data-action="reset" type="button">${t('newSession')}</button></div></div>`;
      return;
    }
    if(phase==='待批准提案') {el.innerHTML=`<p class="checkout-message">${t('waitProposal')}</p>`;return;}
    if(phase==='購物車') {
      if(!board.total){el.innerHTML=`<p class="checkout-message">${t('noCart')}</p>`;return;}
      const over=board.budgetCents!==null && board.total>board.budgetCents;
      el.innerHTML=`<p class="checkout-message">${over?t('overBudget'):t('lockHint')}</p><div class="lock-summary"><span class="helper">${t('total')}</span><br><strong>${money(board.total)} USD</strong></div><div class="checkout-actions"><button type="button" class="btn btn-primary" data-action="lock" ${over||busy?'disabled':''}>${t('lock')}</button></div>`;
      return;
    }
    if(phase==='已鎖定'||phase==='已建單') {
      el.innerHTML=`<p class="locked-heading">✓ ${t('locked')}</p><p class="checkout-message">${t('lockedHint')}</p><div class="lock-summary"><span class="helper">${t('total')} · v${board.lock?.version??'—'}</span><br><strong>${money(board.lock?.totalCents??board.total)} USD</strong></div>${board.order?`<p class="pay-order">${t('orderCreated')}: ${escapeHtml(board.order.id)}</p>`:''}<div class="paypal-container" id="paypal-buttons"><p class="helper">${config?.paypalClientId?t('loadPaypal'):t('paypalNotSet')}</p></div><button type="button" class="danger-link" data-action="cancel-checkout">${t('cancelCheckout')}</button>`;
      if(config?.paypalClientId) void mountPayPal(payRenderGeneration);
      return;
    }
    el.innerHTML=`<p class="checkout-message">${t('loading')}</p>`;
  }
  function render() {
    renderStaticText();
    if(!board||!config)return;
    setText('board-rev',`v${board.version}`);
    setText('service-label',window.__PAYBOARD_PREVIEW__ ? (lang==='zh'?'離線預覽':'Offline preview') : t('connected'));
    $('service-status').classList.remove('is-error');
    setText('ai-status',config.ai==='workers-ai'?'Workers AI · Gemma 4':config.ai==='gemini'?t('gemini'):t('aiNotSet'));
    renderProducts();renderCart();renderProposal();renderHistory();renderCheckout();phaseStep();
    $('send').disabled=busy||!isEditable();$('message').disabled=busy||!isEditable();$('microphone').disabled=busy||!isEditable();
    $('prompt-status').textContent=board.phase==='購物車'||board.phase==='待批准提案'?'':t('actionsLimited');
  }
  async function refresh() {
    const b=await api('/api/board');board=b;
    if(!board.proposal)latestSource=null;
    render();
  }
  async function submit(path,body=null,msg='') {
    if(busy)return null;
    setBusy(true,msg);
    try {
      const result=await api(path,'POST',body);
      if(result.phase){board=result;if(!board.proposal)latestSource=null;}
      render();
      return result;
    } catch(err) {
      notice(err.code==='RATE_LIMIT'?t('limit'):err.message||String(err),true);
      if(err.code==='WRONG_PHASE'||err.code==='STATE_CHANGED'||err.code==='TIMEOUT') {try{await refresh();}catch{}}
      return null;
    } finally {setBusy(false);if(board)render();}
  }
  async function editQuantity(sku,delta) {
    if(!isEditable()||busy||!product(sku))return;
    const current=board.cart[sku]||0;
    const nextQty=Math.min(9,Math.max(0,current+delta));
    if(nextQty===current)return;
    const next={...board.cart};if(nextQty)next[sku]=nextQty;else delete next[sku];
    const result=await submit('/api/cart',{cart:next});
    if(result&&board.proposal===null)latestSource=null;
  }
  async function askAi(text) {
    const input=String(text||'').trim();if(!input||busy||!isEditable())return;
    setBusy(true,t('aiWorking'));
    try {
      const result=await api('/api/say','POST',{text:input},90000);
      board=result;latestSource=result.aiSource||null;latestAiDiagnostic=result.aiDiagnostic||null;
      $('message').value='';render();notice(t('proposed'));
      $('proposal-section').scrollIntoView({block:'nearest',behavior:'smooth'});
    } catch(err) {
      notice(err.code==='RATE_LIMIT'?t('limit'):err.message||String(err),true);
      if(err.code==='WRONG_PHASE'||err.code==='TIMEOUT') {try{await refresh();}catch{}}
    } finally {setBusy(false);if(board)render();}
  }
  async function handleAction(action) {
    if(busy||!board)return;
    if(action==='approve') {if(await submit('/api/proposal/accept'))notice(t('approved'));}
    else if(action==='reject') {if(await submit('/api/proposal/reject'))notice(t('rejected'));}
    else if(action==='budget') {
      const val=Number($('budget-input').value);
      if(!Number.isFinite(val)||val<.01||val>10000||!$('budget-input').value.trim()){notice(t('budgetInvalid'),true);return;}
      if(await submit('/api/budget',{cents:Math.round(val*100)}))notice(t('budgetSaved'));
    }
    else if(action==='budget-clear') {if(await submit('/api/budget',{cents:null}))notice(t('budgetSaved'));}
    else if(action==='lock') {if(await submit('/api/checkout/lock'))notice(t('locked'));}
    else if(action==='cancel-checkout') {if(await submit('/api/checkout/cancel'))notice(t('cancelled'));}
    else if(action==='reset') {
      if(!confirm(t('confirmReset')))return;
      const r=await submit('/api/reset');if(r){latestSource=null;notice(t('connected'));}
    }
    else if(action==='copy' && board.receipt) {
      const r=board.receipt;
      try{await navigator.clipboard.writeText(`PayBoard Sandbox | Order ${r.orderId} | Capture ${r.captureId} | ${money(r.totalCents)} USD | ${r.at}`);notice(t('copied'));}
      catch(err){notice('Clipboard unavailable',true);}
    }
    else if(action==='refresh') {await refresh();}
  }
  function ensurePayPal() {
    if(sdkPromise)return sdkPromise;
    sdkPromise=new Promise((resolve,reject)=>{
      if(!config?.paypalClientId){reject(new Error('PAYPAL_NOT_CONFIGURED'));return;}
      const script=document.createElement('script');
      script.src=`https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(config.paypalClientId)}&currency=USD&intent=capture&components=buttons`;
      script.async=true;
      script.onload=()=>window.paypal?.Buttons?resolve(window.paypal):reject(new Error('PAYPAL_BUTTONS_UNAVAILABLE'));
      script.onerror=()=>reject(new Error('PAYPAL_SDK_LOAD_FAILED'));
      document.head.appendChild(script);
    }).catch(err=>{sdkPromise=null;throw err;});
    return sdkPromise;
  }
  async function mountPayPal(generation) {
    try {
      const paypal=await ensurePayPal();
      const node=$('paypal-buttons');
      if(generation!==payRenderGeneration||!node||!board||!['已鎖定','已建單'].includes(board.phase))return;
      node.innerHTML='';
      const buttons=paypal.Buttons({
        style:{shape:'rect',layout:'vertical',label:'paypal',height:43},
        createOrder:async()=>{
          if(busy)throw new Error('PAYBOARD_BUSY');
          try{
            const result=await api('/api/paypal/create-order','POST',{},30000);
            if(!result.orderID)throw new Error('NO_ORDER_ID');
            return result.orderID;
          }catch(err){notice(err.message,true);throw err;}
        },
        onApprove:async(data)=>{
          if(busy)return;
          setBusy(true,t('loadPaypal'));
          try{
            const orderID=String(data.orderID||'');
            const result=await api('/api/paypal/capture','POST',{orderID},30000);
            if(result.phase!=='已收款'||!result.receipt)throw new Error('CAPTURE_RECEIPT_NOT_VERIFIED');
            board=result;latestSource=null;render();notice(t('paymentDone'));
          }catch(err){notice(err.message||t('paypalError'),true);try{await refresh();}catch{}}
          finally{setBusy(false);if(board)render();}
        },
        onCancel:async()=>{notice(t('paypalCancelled'));try{await refresh();}catch{}},
        onError:async()=>{notice(t('paypalError'),true);try{await refresh();}catch{}},
      });
      if(!buttons?.isEligible?.()){node.textContent='PayPal buttons unavailable for this device/account.';return;}
      await buttons.render(node);
    } catch(err) {
      if(generation===payRenderGeneration && $('paypal-buttons'))
        $('paypal-buttons').textContent=t('paypalError')+' ('+String(err.message||err)+')';
    }
  }
  function voice() {
    const Recognition=window.SpeechRecognition||window.webkitSpeechRecognition;
    if(!Recognition){notice(t('voiceUnsupported'),true);return;}
    if(recording){recording.stop();return;}
    const rec=new Recognition();recording=rec;
    rec.lang=lang==='zh'?'zh-TW':'en-US';rec.interimResults=false;rec.maxAlternatives=1;
    $('microphone').classList.add('is-active');
    rec.onresult=event=>{
      const value=event.results?.[0]?.[0]?.transcript??'';
      $('message').value=value; // Speech recognition never spends AI quota without a separate send action.
      notice(value);
    };
    rec.onend=()=>{recording=null;$('microphone').classList.remove('is-active');};
    rec.onerror=err=>notice('Microphone: '+err.error,true);
    rec.start();
  }
  async function boot() {
    renderStaticText();
    $('say-form').addEventListener('submit',event=>{event.preventDefault();void askAi($('message').value);});
    $('language').addEventListener('click',()=>{lang=lang==='zh'?'en':'zh';render();});
    $('microphone').addEventListener('click',voice);
    $('suggestions').addEventListener('click',event=>{const b=event.target.closest('[data-example]');if(b)void askAi(b.dataset.example);});
    $('products').addEventListener('click',event=>{const b=event.target.closest('[data-delta]');if(b)void editQuantity(b.dataset.sku,Number(b.dataset.delta));});
    document.addEventListener('click',event=>{const b=event.target.closest('[data-action]');if(b)void handleAction(b.dataset.action);});
    try {
      // Only real server JSON is accepted here; local file:// preview never fakes a successful PayPal payment.
      [config,board]=await Promise.all([api('/api/config'),api('/api/board')]);
      if(!Array.isArray(config?.catalog)||!board||!Array.isArray(board.events))throw new Error('API_SCHEMA_MISMATCH');
      render();
    } catch(err) {
      setText('service-label',t('disconnected'));
      $('service-status').classList.add('is-error');
      setText('ai-status',t('aiNotSet'));
      $('offline-warning').hidden=false;
      $('offline-warning').textContent=t('networkError')+' '+(err.message||'');
      $('send').disabled=$('message').disabled=$('microphone').disabled=true;
      $('products').innerHTML=`<div class="loading-card">${t('networkError')}</div>`;
    }
  }
  void boot();
})();
