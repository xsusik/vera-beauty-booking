(() => {
  'use strict';
  const $ = selector => document.querySelector(selector);
  const esc = text => String(text ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const state = {config:null,category:'Paznokcie',service:null,extras:[],date:'',time:'',month:'',preview:true,request:0,busy:false};
  let submissionId=crypto.randomUUID();
  let pendingBody=null;
  let finished=false;
  const priceLabel = item => (item.from?'od ':'') + item.price + (item.maxPrice?'–'+item.maxPrice:'')+' zł';
  const selectedService = () => state.config.services.find(item=>item.id===state.service);
  function selection() {
    const service=selectedService();
    let price=service?.price||0,maximum=price,duration=service?.duration||0;
    const extras=state.extras.map(item=>({...state.config.extras.find(extra=>extra.id===item.id),quantity:item.quantity}));
    extras.forEach(extra=>{price+=extra.price*extra.quantity;maximum+=(extra.maxPrice||extra.price)*extra.quantity;duration+=extra.duration*extra.quantity});
    return {service,extras,price,maximum,duration};
  }
  function summary() {
    const s=selection();
    $('#summary').innerHTML=`<div class="summary-line"><span>Usługa</span><strong>${esc(s.service?.name||'Wybierz zabieg')}</strong></div>
      ${s.extras.length?'<ul class="summary-extras">'+s.extras.map(e=>'<li>'+esc(e.name)+' × '+e.quantity+'</li>').join('')+'</ul>':''}
      <div class="summary-line"><span>Termin</span><strong>${state.date?new Date(state.date+'T12:00:00').toLocaleDateString('pl-PL',{day:'numeric',month:'long'}):'Wybierz datę'}${state.time?' · '+state.time:''}</strong></div>
      <div class="summary-total"><span>Cena</span><strong>${s.service?(s.service.from?'od ':'')+s.price+(s.maximum>s.price?'–'+s.maximum:'')+' zł':'—'}</strong></div>
      ${s.service?.from||s.maximum>s.price?'<p class="summary-price-note">Ostateczna cena zależy od wybranej stylizacji.</p>':''}`;
    $('#submit').disabled=state.busy||state.preview||!state.time||!state.service;
    $('#submit').innerHTML=(state.busy?'Zapisywanie…':state.preview?'Podgląd — zapisy jeszcze zamknięte':state.time?'Poproś o rezerwację':'Wybierz usługę i termin')+' <span>↗</span>';
  }
  function services() {
    $('.categories').innerHTML=['Paznokcie','Stopy','Brwi'].map(category=>`<button type="button" data-category="${category}" aria-pressed="${state.category===category}">${category}</button>`).join('');
    $('#service-list').innerHTML=state.config.services.filter(s=>s.category===state.category).map(s=>`<label class="service"><input type="radio" name="service" value="${s.id}" ${state.service===s.id?'checked':''}><span class="service-name">${esc(s.name)}</span><span class="service-price">${priceLabel(s)}</span></label>`).join('');
  }
  function extras() {
    const items=state.config.extras.filter(e=>e.services.includes(state.service));
    $('#extras').innerHTML=items.length?'<h3>Dodatki do stylizacji</h3>'+items.map(e=>{
      const selected=state.extras.find(item=>item.id===e.id);
      return `<div class="extra"><label><input type="checkbox" data-extra="${e.id}" ${selected?'checked':''}><span>${esc(e.name)}<br><small>+${priceLabel(e)}</small></span></label>${selected&&e.maxQuantity?`<input type="number" data-quantity="${e.id}" min="1" max="${e.maxQuantity}" value="${selected.quantity}" aria-label="Liczba paznokci ze zdobieniem">`:''}</div>`;
    }).join(''):'';
  }
  function calendar() {
    const month=new Date(state.month+'-01T12:00:00');
    $('#month').textContent=month.toLocaleDateString('pl-PL',{month:'long',year:'numeric'});
    $('#previous').disabled=state.month<=state.config.schedule.from.slice(0,7);
    $('#next').disabled=state.month>=state.config.schedule.to.slice(0,7);
    const offset=(month.getDay()+6)%7;
    const count=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
    const schedule=state.config.schedule;
    const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Warsaw'});
    $('#calendar').innerHTML='<span></span>'.repeat(offset)+Array.from({length:count},(_,i)=>{
      const date=state.month+'-'+String(i+1).padStart(2,'0');
      const day=new Date(date+'T12:00:00');
      const disabled=date<today||date<schedule.from||date>schedule.to||!schedule.weekdays.includes(day.getDay())||schedule.closedDates.includes(date);
      return `<button type="button" data-date="${date}" ${disabled?'disabled':''} aria-pressed="${date===state.date}" aria-label="${day.toLocaleDateString('pl-PL',{weekday:'long',day:'numeric',month:'long'})}">${i+1}</button>`;
    }).join('');
  }
  function previewSlots() {
    const {duration}=selection(),s=state.config.schedule;
    const min=t=>Number(t.slice(0,2))*60+Number(t.slice(3));
    const ranges=[...s.breaks,...(s.blocked[state.date]||[])].map(([a,b])=>[min(a),min(b)]);
    const result=[];
    for(let t=min(s.start);t+duration<=min(s.end);t+=s.step){
      if(!ranges.some(([a,b])=>t<b&&t+duration>a))result.push(String(Math.floor(t/60)).padStart(2,'0')+':'+String(t%60).padStart(2,'0'));
    }
    return result;
  }
  async function loadSlots() {
    state.time='';
    const request=++state.request;
    summary();
    if(!state.service||!state.date){$('#slots').innerHTML='<p class="hint">Najpierw wybierz usługę i datę.</p>';return}
    $('#slot-date').textContent=new Date(state.date+'T12:00:00').toLocaleDateString('pl-PL',{day:'numeric',month:'long'});
    $('#slots').innerHTML='<p class="hint">Sprawdzamy terminy…</p>';
    try {
      let result;
      if(!state.config.bookingEnabled)result={preview:true,slots:previewSlots()};
      else{
        const query=new URLSearchParams({service:state.service,date:state.date,extras:JSON.stringify(state.extras)});
        const response=await fetch('./api/booking?'+query,{cache:'no-store',signal:AbortSignal.timeout(12000)});
        if(!response.ok)throw new Error();
        result=await response.json();
      }
      if(request!==state.request)return;
      state.preview=result.preview;
      $('#notice').textContent=state.preview?'Podgląd zapisów. Terminy są przykładowe — zapisy online uruchomimy po ustaleniu grafiku.':'';
      $('#slots').innerHTML=result.slots.length?result.slots.map(t=>`<button type="button" data-time="${t}" aria-pressed="false">${t}</button>`).join(''):'<p class="hint">Brak wolnych godzin dla tej usługi. Wybierz inny dzień.</p>';
      summary();
    }catch{
      if(request!==state.request)return;
      $('#slots').innerHTML='<p class="hint">Nie udało się pobrać terminów.</p><button type="button" data-retry>Spróbuj ponownie</button>';
    }
  }
  document.addEventListener('click',event=>{
    const target=event.target.closest('button');
    if(!target||!state.config||state.busy||pendingBody||finished)return;
    if(target.dataset.category){state.category=target.dataset.category;services()}
    if(target.dataset.date){state.date=target.dataset.date;calendar();void loadSlots()}
    if(target.dataset.time){state.time=target.dataset.time;document.querySelectorAll('[data-time]').forEach(b=>b.setAttribute('aria-pressed',String(b===target)));summary()}
    if(target.hasAttribute('data-retry'))void loadSlots();
    if(target.id==='previous'||target.id==='next'){
      const month=new Date(state.month+'-01T12:00:00');month.setMonth(month.getMonth()+(target.id==='next'?1:-1));
      state.month=month.getFullYear()+'-'+String(month.getMonth()+1).padStart(2,'0');calendar();
    }
  });
  document.addEventListener('change',event=>{
    const input=event.target;
    if(!state.config||state.busy||pendingBody||finished)return;
    if(input.name==='service'){state.service=input.value;state.extras=[];extras();void loadSlots()}
    if(input.dataset.extra){
      state.extras=state.extras.filter(e=>e.id!==input.dataset.extra);
      if(input.checked)state.extras.push({id:input.dataset.extra,quantity:1});
      extras();void loadSlots();
    }
    if(input.dataset.quantity){
      const value=Math.max(1,Math.min(10,Math.trunc(Number(input.value)||1)));
      input.value=value;state.extras.find(e=>e.id===input.dataset.quantity).quantity=value;void loadSlots();
    }
  });
  $('#booking-form').addEventListener('submit',async event=>{
    event.preventDefault();
    if(state.preview||state.busy||!state.time)return;
    const fd=new FormData(event.target);
    const body=pendingBody||{id:submissionId,service:state.service,extras:state.extras,date:state.date,time:state.time,
      name:fd.get('name'),phone:fd.get('phone'),note:fd.get('note'),website:fd.get('website'),consent:fd.get('consent')==='on'};
    pendingBody=body;
    document.querySelectorAll('#booking-form input,#booking-form textarea,#services input,#services button,#date-section button').forEach(el=>el.disabled=true);
    state.busy=true;summary();$('#form-error').textContent='';
    try{
      const response=await fetch('./api/booking',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
      const result=await response.json();
      if(!response.ok){
        if(response.status>=400&&response.status<500){
          pendingBody=null;
          document.querySelectorAll('#booking-form input,#booking-form textarea,#services input,#services button,#date-section [data-time]').forEach(el=>el.disabled=false);
          calendar();
          if(response.status===409){submissionId=crypto.randomUUID();await loadSlots()}
        }
        throw new Error(result.error||'Nie udało się zapisać prośby.');
      }
      $('#booking-form').hidden=true;$('#success').hidden=false;
      finished=true;
      $('#success-details').textContent=selectedService().name+' · '+body.date+' · '+body.time;
      $('#reference').textContent='Numer zgłoszenia: '+result.id;
      $('#success').scrollIntoView({behavior:'smooth',block:'center'});
      document.querySelectorAll('#services input,#services button,#date-section button').forEach(el=>el.disabled=true);
    }catch(error){$('#form-error').textContent=['TimeoutError','TypeError','SyntaxError'].includes(error.name)?'Nie udało się sprawdzić wyniku. Sprawdź połączenie i naciśnij przycisk ponownie — wyślemy tę samą prośbę.':error.message}
    finally{state.busy=false;summary()}
  });
  async function init() {
    try{
      const response=await fetch('./config.json');
      if(!response.ok)throw new Error();
      state.config=await response.json();state.month=state.config.schedule.from.slice(0,7);
      state.preview=!state.config.bookingEnabled;
      $('#notice').textContent=state.preview?'Podgląd zapisów. Terminy są przykładowe — zapisy online uruchomimy po ustaleniu grafiku.':'Wybierz usługę i termin.';
      const groups = ['Paznokcie','Stopy','Brwi'].map(name => [name,state.config.services.filter(s=>s.category===name)]);
      groups.push(['Dodatki',state.config.extras]);
      $('#price-catalog').innerHTML=groups.map(([name,items])=>'<section><h3>'+esc(name)+'</h3><dl>'+items.map(item=>'<div><dt>'+esc(item.name)+(item.id==='feet-french'?' (pedicure)':'')+'</dt><dd>'+esc(priceLabel(item))+'</dd></div>').join('')+'</dl></section>').join('');
      services();calendar();summary();
    }catch{$('#notice').textContent='Nie udało się załadować strony. Odśwież ją lub napisz do nas na Instagramie.'}
  }
  void init();
})();
