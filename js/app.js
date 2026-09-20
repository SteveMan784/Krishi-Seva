/* Firebase is the source of truth. No localStorage roles, passwords or booking counters. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SHIFTS = {morning: '07:00–10:00', midday: '10:00–13:00', afternoon: '13:30–16:30', evening: '16:30–19:00'};
  const ENDS = {morning: '10:00', midday: '13:00', afternoon: '16:30', evening: '19:00'};
  let sdk, auth, db, functions, profile, centers = [], slots = [], bookings = [];
  let requestedRole, confirmation, verifiedPhone, recaptcha, pendingName = '', selectedSlot = '';
  let sessionVersion = 0, slotReady = false, installPrompt;
  const listeners = new Map();
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  const today = () => new Intl.DateTimeFormat('en-CA', {timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date());
  const value = id => $(id)?.value || '';
  const visible = (id, show) => $(id)?.classList.toggle('hidden', !show);
  function stop(key) { listeners.get(key)?.(); listeners.delete(key); }
  function stopAll() { for (const key of listeners.keys()) stop(key); }
  function showToast(message, type = 'info') {
    const el = document.createElement('div');
    el.className = `p-4 rounded-xl shadow-lg text-sm pointer-events-auto ${type === 'error' ? 'bg-rose-800' : 'bg-emerald-800'} text-white`;
    el.textContent = message;
    $('toast-container').append(el);
    setTimeout(() => el.remove(), 9000);
  }
  function errorMessage(error) {
    const code = error.code || '';
    if (['auth/invalid-credential', 'auth/wrong-password', 'auth/user-not-found', 'auth/invalid-login-credentials'].includes(code)) return 'Employee ID or password is incorrect.';
    if (code === 'auth/user-disabled') return 'This employee account has been removed or disabled. Contact your administrator.';
    if (code === 'auth/too-many-requests') return 'Too many attempts. Please wait before trying again.';
    if (code === 'auth/invalid-verification-code') return 'The verification code is incorrect. Please try again.';
    if (code === 'auth/code-expired') return 'The code has expired. Request a new verification code.';
    if (code === 'auth/operation-not-allowed') return 'The required Firebase authentication provider is not enabled.';
    if (code === 'auth/unauthorized-domain') return 'This domain must be authorized in Firebase Authentication settings.';
    if (code === 'auth/network-request-failed') return 'Network unavailable. Reconnect and try again.';
    if (code === 'permission-denied') return 'Access denied. Check your account and deployed Firestore rules.';
    return error.message || 'The request failed. Please try again.';
  }
  function requireReady() {
    if (!auth) throw new Error('Firebase is not connected. Complete the activation steps above.');
    if (!navigator.onLine) throw new Error('An internet connection is required. Offline bookings are not accepted.');
  }
  async function action(target, callback) {
    if (target?.dataset.busy === 'true') return;
    const buttons = target?.matches('button') ? [target] : [...(target?.querySelectorAll('button') || [])];
    if (target) target.dataset.busy = 'true';
    buttons.forEach(button => button.disabled = true);
    try { requireReady(); await callback(); }
    catch (error) { showToast(errorMessage(error), 'error'); }
    finally {
      if (target) target.dataset.busy = 'false';
      buttons.forEach(button => button.disabled = false);
      updateBookingButton();
    }
  }
  async function call(name, data) { requireReady(); return (await sdk.httpsCallable(functions, name)(data)).data; }
  function screen(name) {
    for (const id of ['public-website-section', 'auth-gateway-section', 'main-app-section', 'access-denied-section']) visible(id, id === name);
  }
  function navigateToWebsite() { screen('public-website-section'); }
  function setAuthTab(role) {
    for (const name of ['farmer', 'staff', 'admin']) {
      visible(`form-login-${name}`, role === name);
      $(`tab-btn-${name}`).classList.toggle('bg-emerald-700', role === name);
      $(`tab-btn-${name}`).classList.toggle('text-white', role === name);
    }
  }
  function navigateToAuth(role) {
    if (profile) { screen('main-app-section'); return; }
    setAuthTab(role); screen('auth-gateway-section');
  }
  function clearSession() {
    sessionVersion++; stopAll(); profile = null; slots = []; centers = []; bookings = [];
    selectedSlot = ''; slotReady = false; confirmation = null; verifiedPhone = null;
    for (const id of ['farmer-bookings', 'employee-bookings', 'staff-account-list', 'capacity-shifts', 'booking-shifts-container']) $(id).replaceChildren();
    for (const id of ['top-active-session-indicator', 'main-app-section', 'capacity-panel', 'employee-bookings-panel']) visible(id, false);
    document.querySelectorAll('input[type=password], #farmer-login-otp').forEach(input => input.value = '');
    updateBookingButton();
  }
  async function handleSignOut() {
    clearSession(); requestedRole = null; pendingName = '';
    screen('auth-gateway-section');
    if (auth) await sdk.signOut(auth).catch(error => showToast(errorMessage(error), 'error'));
  }
  async function employeeLogin(event, role) {
    event.preventDefault();
    await action(event.target, async () => {
      const id = value(`${role}-login-id`).trim().toLowerCase();
      if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(id)) throw new Error('Enter a valid employee ID.');
      requestedRole = role;
      await sdk.signInWithEmailAndPassword(auth, `${id}@employees.krishi-seva.invalid`, value(`${role}-login-password`));
      $(`${role}-login-password`).value = '';
    });
  }
  async function sendFarmerOtp() {
    await action($('send-otp-btn'), async () => {
      const phone = value('farmer-login-mobile').trim();
      if (!/^[6-9][0-9]{9}$/.test(phone)) throw new Error('Enter a valid 10-digit Indian mobile number.');
      if (!value('farmer-login-name').trim()) throw new Error('Enter your full name first.');
      confirmation = null;
      if (!recaptcha) recaptcha = new sdk.RecaptchaVerifier(auth, 'phone-recaptcha', {size: 'normal'});
      try {
        confirmation = await sdk.signInWithPhoneNumber(auth, `+91${phone}`, recaptcha);
        verifiedPhone = phone;
        showToast('Verification code sent. Check your SMS messages.');
      } catch (error) { recaptcha.clear(); recaptcha = null; throw error; }
    });
  }
  async function handleFarmerLogin(event) {
    event.preventDefault();
    await action(event.target, async () => {
      if (!confirmation || verifiedPhone !== value('farmer-login-mobile').trim()) throw new Error('Send a verification code to this phone number first.');
      pendingName = value('farmer-login-name').trim(); requestedRole = 'farmer';
      const user = (await confirmation.confirm(value('farmer-login-otp'))).user;
      await sdk.updateProfile(user, {displayName: pendingName});
      $('farmer-login-otp').value = '';
    });
  }
  function subscribe(key, source, next, onError) {
    stop(key);
    listeners.set(key, sdk.onSnapshot(source, {includeMetadataChanges: true}, next, error => {
      onError?.(); showToast(errorMessage(error), 'error');
    }));
  }
  async function sessionChanged(user) {
    clearSession();
    const version = sessionVersion;
    if (!user) { screen('auth-gateway-section'); return; }
    try {
      const token = await user.getIdTokenResult();
      if (version !== sessionVersion) return;
      if (token.signInProvider === 'phone') {
        profile = {role: 'farmer', name: pendingName || user.displayName || 'Farmer'};
        if (requestedRole && requestedRole !== 'farmer') throw new Error('This session is not an employee account.');
        requestedRole = null; openDashboard();
      } else {
        subscribe('profile', sdk.doc(db, 'employees', user.uid), snapshot => {
          if (snapshot.metadata.fromCache) return;
          const next = snapshot.data();
          if (!next?.active || !['staff', 'admin'].includes(next.role) || (requestedRole && requestedRole !== next.role)) {
            showToast('This account is not authorized for the selected portal or has been removed.', 'error');
            void handleSignOut(); return;
          }
          const changed = !profile || profile.role !== next.role || profile.centerId !== next.centerId;
          profile = next; requestedRole = null;
          if (changed) openDashboard();
        }, () => { void handleSignOut(); });
      }
    } catch (error) { showToast(errorMessage(error), 'error'); await handleSignOut(); }
  }
  function openDashboard() {
    screen('main-app-section'); visible('top-active-session-indicator', true);
    $('top-user-name-display').textContent = profile.name;
    $('top-user-role-badge').textContent = profile.role;
    for (const role of ['farmer', 'staff', 'admin']) visible(`${role}-view-container`, role === profile.role);
    visible('capacity-panel', profile.role !== 'farmer'); visible('employee-bookings-panel', profile.role !== 'farmer');
    $('farmer-profile-name').textContent = profile.name;
    $('book-date-input').value ||= today(); $('capacity-date').value ||= today();
    subscribe('centers', sdk.collection(db, 'centers'), snapshot => {
      centers = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})).sort((a, b) => a.name.localeCompare(b.name));
      populateCenters();
    }, () => {
      centers = []; populateCenters();
    });
    if (profile.role === 'farmer') {
      subscribe('bookings', sdk.query(sdk.collection(db, 'bookings'), sdk.where('farmerUid', '==', auth.currentUser.uid)), snapshot => {
        bookings = snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})); renderBookings('farmer-bookings', bookings);
      }, () => { $('farmer-bookings').textContent = 'Unable to load bookings. Reconnect or sign in again.'; });
    }
    if (profile.role === 'admin') subscribe('staff', sdk.query(sdk.collection(db, 'employees'), sdk.where('role', '==', 'staff')), renderStaff, () => { $('staff-account-list').textContent = 'Unable to load staff accounts.'; });
  }
  function options(element, items, previous = element.value) {
    element.replaceChildren(...items.map(item => new Option(item.label, item.value)));
    if (items.some(item => item.value === previous)) element.value = previous;
    if (!items.length) element.add(new Option('No mandis configured', ''));
  }
  function populateCenters() {
    if (!profile) return;
    options($('staff-create-center'), centers.map(c => ({value: c.id, label: `${c.name} · ${c.district}`})));
    if (profile.role === 'farmer') {
      options($('book-state-select'), [...new Set(centers.map(c => c.state))].map(state => ({value: state, label: state})));
      handleBookingStateChange();
    } else {
      const allowed = centers.filter(c => profile.role === 'admin' || c.id === profile.centerId);
      options($('capacity-center'), allowed.map(c => ({value: c.id, label: `${c.name} · ${c.district}, ${c.state}`})));
      $('capacity-center').disabled = profile.role === 'staff';
      $('staff-station-badge').textContent = allowed[0] ? `${profile.name} · ${allowed[0].name}` : 'No assigned mandi found. Contact your administrator.';
      watchCapacity();
    }
  }
  function handleBookingStateChange() {
    const filtered = centers.filter(c => c.state === value('book-state-select'));
    options($('book-district-select'), [...new Set(filtered.map(c => c.district))].map(district => ({value: district, label: district})));
    handleBookingDistrictChange();
  }
  function handleBookingDistrictChange() {
    options($('book-centre-select'), centers.filter(c => c.state === value('book-state-select') && c.district === value('book-district-select')).map(c => ({value: c.id, label: c.name})));
    watchSlots();
  }
  function watchSlots() {
    stop('slots'); slots = []; selectedSlot = ''; slotReady = false;
    renderBookingShiftCards();
    if (!db || profile?.role !== 'farmer' || !value('book-centre-select') || !value('book-date-input')) return;
    $('booking-shifts-container').textContent = 'Checking live availability…';
    subscribe('slots', sdk.query(sdk.collection(db, 'slots'), sdk.where('centerId', '==', value('book-centre-select')), sdk.where('date', '==', value('book-date-input')), sdk.where('remaining', '>', 0)), snapshot => {
      slotReady = !snapshot.metadata.fromCache;
      slots = slotReady ? snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})).filter(slot => new Date(`${slot.date}T${ENDS[slot.shift]}:00+05:30`) > new Date()) : [];
      if (!slots.some(slot => slot.id === selectedSlot)) selectedSlot = '';
      renderBookingShiftCards();
    }, () => { slotReady = false; slots = []; renderBookingShiftCards(); });
  }
  function updateBookingButton() {
    const button = $('farmer-slot-booking-form').querySelector('button[type=submit]');
    button.disabled = !navigator.onLine || !slotReady || !selectedSlot || $('farmer-slot-booking-form').dataset.busy === 'true';
  }
  function renderBookingShiftCards() {
    const container = $('booking-shifts-container'); container.replaceChildren();
    if (!slots.length) container.textContent = slotReady ? 'No slots available for this mandi and date. Choose another date or mandi.' : 'Select a mandi and date to load live availability. A connection to Firebase is required.';
    for (const shift of Object.keys(SHIFTS)) {
      const slot = slots.find(s => s.shift === shift && s.remaining > 0);
      if (!slot) continue; // Full shifts never appear in the farmer dashboard.
      const label = document.createElement('label'); label.className = 'p-4 rounded-2xl border border-emerald-200 bg-emerald-50 cursor-pointer text-sm';
      const radio = document.createElement('input'); radio.type = 'radio'; radio.name = 'booking-slot'; radio.value = slot.id; radio.checked = selectedSlot === slot.id;
      radio.addEventListener('change', () => {selectedSlot = slot.id; updateBookingButton();});
      const description = document.createElement('span'); description.className = 'ml-2'; description.textContent = `${SHIFTS[shift]} IST — ${slot.remaining} slots left`;
      label.append(radio, description); container.append(label);
    }
    updateBookingButton();
  }
  async function submitBooking(event) {
    event.preventDefault();
    await action(event.target, async () => {
      if (profile?.role !== 'farmer' || !selectedSlot || !slotReady) throw new Error('Select an available shift first.');
      const result = await call('bookSlot', {slotId: selectedSlot, farmerName: profile.name, crop: value('book-crop-select'), quantity: Number(value('book-bags-input')), vehicle: value('book-vehicle-input')});
      showToast(result.alreadyBooked ? 'You already have a confirmed booking for this shift. No extra slot was deducted.' : 'Booking confirmed. One slot has been deducted.');
      selectedSlot = ''; renderBookingShiftCards();
    });
  }
  function watchCapacity() {
    stop('capacity'); stop('bookings'); $('capacity-shifts').replaceChildren(); $('employee-bookings').replaceChildren();
    const centerId = value('capacity-center'), date = value('capacity-date');
    if (!db || !centerId || !date || !['admin', 'staff'].includes(profile?.role)) { $('capacity-shifts').textContent = 'Add or select a mandi to configure capacities.'; return; }
    subscribe('capacity', sdk.query(sdk.collection(db, 'slots'), sdk.where('centerId', '==', centerId), sdk.where('date', '==', date)), snapshot => {
      if (snapshot.metadata.fromCache) { $('capacity-shifts').textContent = 'Connecting to live capacities…'; return; }
      renderCapacity(snapshot.docs.map(doc => doc.data()), centerId, date);
    }, () => { $('capacity-shifts').textContent = 'Unable to load capacity. Please reconnect and try again.'; });
    subscribe('bookings', sdk.query(sdk.collection(db, 'bookings'), sdk.where('centerId', '==', centerId), sdk.where('date', '==', date)), snapshot => {
      renderBookings('employee-bookings', snapshot.docs.map(doc => ({id: doc.id, ...doc.data()})).filter(booking => booking.date === date));
    }, () => { $('employee-bookings').textContent = 'Unable to load bookings.'; });
  }
  function renderCapacity(records, centerId, date) {
    const container = $('capacity-shifts');
    const drafts = new Map([...container.querySelectorAll('input[data-dirty=true]')].map(input => [input.name, input.value]));
    container.replaceChildren();
    for (const [shift, label] of Object.entries(SHIFTS)) {
      const record = records.find(record => record.shift === shift);
      const form = document.createElement('form'); form.className = 'p-4 rounded-2xl bg-slate-50 border border-slate-200 space-y-3';
      const heading = document.createElement('h4'); heading.className = 'font-bold text-sm'; heading.textContent = `${label} IST`;
      const count = document.createElement('p'); count.className = 'text-sm text-slate-600'; count.textContent = record ? `${record.booked} booked · ${record.remaining} remaining` : 'Not published · 0 available';
      const input = document.createElement('input'); input.type = 'number'; input.className = 'field'; input.min = record?.booked || 0; input.max = 10000; input.step = 1; input.required = true; input.name = shift;
      input.value = drafts.get(shift) ?? record?.capacity ?? 0;
      input.dataset.dirty = String(drafts.has(shift)); input.addEventListener('input', () => input.dataset.dirty = 'true');
      const field = document.createElement('label'); field.className = 'field-label'; field.append('Total capacity', input);
      const button = document.createElement('button'); button.type = 'submit'; button.className = 'action w-full'; button.textContent = 'Save capacity';
      const ended = new Date(`${date}T${ENDS[shift]}:00+05:30`) <= new Date();
      input.disabled = button.disabled = ended;
      if (ended) button.textContent = 'Shift ended';
      form.append(heading, count, field, button);
      form.addEventListener('submit', event => {
        event.preventDefault();
        void action(form, async () => {
          await call('saveSlot', {centerId, date, shift, capacity: Number(input.value)});
          input.dataset.dirty = 'false';
          showToast('Capacity saved. Farmer availability updates in real time.');
        });
      });
      container.append(form);
    }
  }
  function renderBookings(target, records) {
    if (!records.length) { $(target).textContent = 'No confirmed bookings yet.'; return; }
    records.sort((a, b) => b.date.localeCompare(a.date));
    $(target).innerHTML = `<table class="data-table"><thead><tr><th>Booking reference</th><th>Farmer</th><th>Mandi</th><th>Date / shift (IST)</th><th>Crop / quantity</th><th>Vehicle</th><th>Status</th></tr></thead><tbody>${records.map(b => `<tr><td class="font-mono break-all">${escape(b.id)}</td><td>${escape(b.farmerName)}</td><td>${escape(b.centerName)}</td><td>${escape(b.date)}<br>${escape(SHIFTS[b.shift])}</td><td>${escape(b.crop)} · ${escape(b.quantity)} q</td><td>${escape(b.vehicle)}</td><td>Confirmed</td></tr>`).join('')}</tbody></table>`;
  }
  function renderStaff(snapshot) {
    const container = $('staff-account-list'); container.replaceChildren();
    if (snapshot.empty) {container.textContent = 'No staff accounts yet. Create an account above.'; return;}
    for (const doc of snapshot.docs) {
      const staff = doc.data();
      const row = document.createElement('div'); row.className = 'flex flex-wrap justify-between gap-3 py-4 border-b border-slate-200 text-sm';
      const text = document.createElement('span'); text.textContent = `${staff.employeeId} · ${staff.name} · ${staff.centerId} · ${staff.active ? 'Active' : 'Access removed'}`;
      const button = document.createElement('button'); button.className = 'px-3 py-2 bg-rose-100 text-rose-800 rounded-xl font-bold'; button.textContent = staff.active ? 'Remove staff' : 'Retry / confirm Auth removal';
      button.addEventListener('click', () => {
        if (!window.confirm(`Remove ${staff.employeeId}? They will lose access immediately. Existing bookings are preserved.`)) return;
        void action(button, async () => {await call('removeStaff', {uid: doc.id}); showToast('Staff account removed.');});
      });
      row.append(text, button); container.append(row);
    }
  }
  function formAction(id, endpoint, success) {
    $(id).addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      void action(form, async () => {
        await call(endpoint, Object.fromEntries(new FormData(form)));
        form.reset(); showToast(success);
      });
    });
  }
  function networkChanged() {
    $('network-status-text').textContent = navigator.onLine ? 'Online' : 'Offline';
    if (!navigator.onLine) { $('backend-status').textContent = 'Offline — booking and administrative changes are unavailable until you reconnect.'; }
    else if (auth) $('backend-status').textContent = 'Firebase connected · Secure employee access · Live slot availability · All times IST';
    updateBookingButton();
  }
  Object.assign(window, {showToast, navigateToWebsite, showHomeScreen: navigateToWebsite, navigateToAuth, setAuthTab, handleSignOut, handleFarmerLogin, sendFarmerOtp,
    handleStaffLogin: event => employeeLogin(event, 'staff'), handleAdminLogin: event => employeeLogin(event, 'admin'),
    handleBookingStateChange, handleBookingDistrictChange, handleBookingCenterChange: watchSlots, handleBookingDateChange: watchSlots, renderBookingShiftCards,
    scrollToWebsiteSection: id => {navigateToWebsite(); $(id)?.scrollIntoView({behavior: 'smooth'});},
    handleWebsiteStateChange: () => showToast('Sign in to view mandis configured in Firebase.'), handleWebsiteDistrictChange: () => showToast('Sign in to view mandis configured in Firebase.')
  });
  $('farmer-slot-booking-form').addEventListener('submit', submitBooking);
  $('capacity-center').addEventListener('change', watchCapacity); $('capacity-date').addEventListener('change', watchCapacity);
  formAction('center-create-form', 'saveCenter', 'Mandi created. You can now assign staff and publish capacities.');
  formAction('staff-create-form', 'createStaff', 'Staff account created. Share the employee ID and password securely.');
  for (const id of ['book-date-input', 'capacity-date']) {$(id).min = today(); $(id).value = today();}
  for (const crop of ['Wheat', 'Paddy', 'Maize', 'Gram / Chana', 'Mustard', 'Soybean', 'Other']) $('book-crop-select').add(new Option(crop, crop));
  window.addEventListener('online', networkChanged); window.addEventListener('offline', networkChanged);
  window.addEventListener('beforeinstallprompt', event => {event.preventDefault(); installPrompt = event;});
  $('btn-install-app').addEventListener('click', async () => {
    if (installPrompt) {await installPrompt.prompt(); installPrompt = null;}
    else showToast('Use your browser menu to install this app. Login and bookings require an internet connection.');
  });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  navigateToWebsite(); updateBookingButton();
  // Recheck shift end times even if no new Firestore updates arrive.
  setInterval(() => {
    if (profile?.role !== 'farmer') return;
    const available = slots.filter(slot => new Date(`${slot.date}T${ENDS[slot.shift]}:00+05:30`) > new Date());
    if (available.length !== slots.length) {slots = available; if (!slots.some(slot => slot.id === selectedSlot)) selectedSlot = ''; renderBookingShiftCards();}
  }, 30000);
  async function boot() {
    const config = window.KRISHI_FIREBASE_CONFIG;
    if (!config?.apiKey || !config?.projectId || !config?.appId || !config?.authDomain) {
      $('backend-status').textContent = 'Firebase setup required — login and bookings are unavailable until your project is connected.';
      visible('firebase-setup', true); return;
    }
    try {
      const base = 'https://www.gstatic.com/firebasejs/11.10.0/';
      const [appSdk, authSdk, dbSdk, functionsSdk] = await Promise.all(['firebase-app.js', 'firebase-auth.js', 'firebase-firestore.js', 'firebase-functions.js'].map(file => import(base + file)));
      sdk = {...appSdk, ...authSdk, ...dbSdk, ...functionsSdk};
      const app = sdk.initializeApp(config); auth = sdk.getAuth(app); db = sdk.getFirestore(app); functions = sdk.getFunctions(app, window.KRISHI_FUNCTIONS_REGION || 'asia-south1');
      if (window.KRISHI_USE_EMULATORS && ['localhost', '127.0.0.1'].includes(location.hostname)) {
        sdk.connectAuthEmulator(auth, 'http://127.0.0.1:9099'); sdk.connectFirestoreEmulator(db, '127.0.0.1', 8080); sdk.connectFunctionsEmulator(functions, '127.0.0.1', 5001);
      }
      await sdk.setPersistence(auth, sdk.browserSessionPersistence);
      sdk.onAuthStateChanged(auth, sessionChanged); networkChanged();
    } catch (error) {
      auth = null; $('backend-status').textContent = 'Firebase connection failed. Check the configuration, network and authorized domain.';
      visible('firebase-setup', true); showToast(errorMessage(error), 'error');
    }
  }
  void boot();
})();
