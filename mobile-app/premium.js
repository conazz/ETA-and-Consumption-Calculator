/* ============================================================================
   PREMIUM / BILLING MODULE — eta-calculator-premium
   ============================================================================
   Everything related to the paid "Consumption Pro" unlock lives in this one
   file, deliberately separate from index.html's own script, so it's easy to
   find every spot that needs real backend wiring later.

   CURRENT STATE: pure mock. Per explicit decision, this does NOT call the
   real Digital Goods API / Play Billing at all right now — every function
   below is a local stub with realistic shapes, so the UI can be fully built
   and tested. Search this file for "FIREBASE:" and "PLAY BILLING:" comments
   for every spot that needs real wiring before this ships.

   Reality check worth keeping in mind when wiring the real thing later: this
   app is a plain PWA (no native Android/Gradle project). Google's native Play
   Billing Library (Java/Kotlin, ProductDetails class) can only be added to an
   actual Android app project. The real path for a PWA is wrapping it in a
   Trusted Web Activity (TWA) and using the browser's Digital Goods API
   (window.getDigitalGoodsService), which only exists inside a Play-Store-
   installed TWA — not in a browser tab or a plain "Add to Home Screen"
   install. That TWA wrapper is a separate project this file doesn't attempt
   to build.
   ========================================================================== */
(function(window){
  "use strict";

  // ---- Storage keys (localStorage) ----
  var LS_PREMIUM = "eta-premium-status-v1";       // cached {premium:boolean, checkedAt:number}
  var LS_TRIAL = "eta-premium-trial-v1";          // cached {status:"none"|"active"|"expired", startedAt:number, daysRemaining:number}

  // The one product this app sells.
  var PRODUCT_ID = "consumption_pro_unlock";

  // Discount ratio for the struck-through "original" price — Play Billing
  // only ever returns your current active price, not a separate "was"
  // price, so the "original" is always derived as currentPrice / (1 - OFF).
  var DISCOUNT_OFF = 0.5; // 50% off

  // Flip to false once real billing is wired up — everything in this file
  // checks this flag before touching localStorage-only mock state.
  var MOCK_MODE = true;

  function readJSON(key){
    try{ return JSON.parse(localStorage.getItem(key)); }catch(e){ return null; }
  }
  function writeJSON(key, val){
    try{ localStorage.setItem(key, JSON.stringify(val)); }catch(e){}
  }

  /* --------------------------------------------------------------------
     PLAY BILLING: product details / pricing
     -------------------------------------------------------------------- */

  // PLAY BILLING: replace with a real call to the Digital Goods API, e.g.
  //   const service = await window.getDigitalGoodsService('https://play.google.com/billing');
  //   const [details] = await service.getDetails([PRODUCT_ID]);
  //   return { currency: details.price.currency, value: parseFloat(details.price.value), formatted: <format currency+value> };
  // The mock below returns a plausible localized price so the paywall UI has
  // something real to render and compute the struck-through price from.
  function getProductDetails(){
    return Promise.resolve({
      productId: PRODUCT_ID,
      currency: "USD",
      value: 9.99,
      formatted: "$9.99"
    });
  }

  // Pure calculation, not hardcoded — works off whatever getProductDetails()
  // actually returns, so it's correct regardless of the user's local
  // currency once the real Digital Goods API is wired in.
  function computeOriginalPrice(details){
    var original = details.value / (1 - DISCOUNT_OFF);
    return {
      currency: details.currency,
      value: original,
      formatted: formatCurrencyLike(details.formatted, details.value, original)
    };
  }

  // Best-effort: reuses whatever currency symbol/format Play Billing handed
  // us in `formatted` (e.g. "$9.99") and substitutes the computed original
  // value, rather than inventing our own currency formatting.
  function formatCurrencyLike(sampleFormatted, sampleValue, newValue){
    var sampleValueStr = sampleValue.toFixed(2);
    if(sampleFormatted && sampleFormatted.indexOf(sampleValueStr) !== -1){
      return sampleFormatted.replace(sampleValueStr, newValue.toFixed(2));
    }
    return newValue.toFixed(2);
  }

  /* --------------------------------------------------------------------
     PLAY BILLING: purchase flow + status
     -------------------------------------------------------------------- */

  // PLAY BILLING: replace with the real purchase flow (Digital Goods API +
  // the standard web Payment Request API using the
  // "https://play.google.com/billing" payment method), then FIREBASE:
  // verify the returned purchase token server-side before trusting it —
  // never trust a client-reported "success" alone for a real release.
  function purchasePremium(){
    return new Promise(function(resolve){
      setTimeout(function(){
        setPremium(true);
        resolve({ success: true, productId: PRODUCT_ID });
      }, 600); // simulated round-trip
    });
  }

  function setPremium(isPremium){
    writeJSON(LS_PREMIUM, { premium: !!isPremium, checkedAt: Date.now() });
  }

  // Cached locally so the app doesn't need to re-verify every launch — see
  // refreshPremiumStatus() for the on-launch check that populates this cache.
  function checkPremiumStatus(){
    var cached = readJSON(LS_PREMIUM);
    return !!(cached && cached.premium);
  }

  // PLAY BILLING: replace the mock branch with service.listPurchases() (or
  // equivalent) to verify the purchase is still valid, then FIREBASE:
  // cross-check the purchase token against your backend before trusting it.
  // Called once on app launch (see index.html's init) so normal usage reads
  // the cheap local cache via checkPremiumStatus() instead of re-verifying
  // every time.
  function refreshPremiumStatus(){
    if(MOCK_MODE){
      // Nothing to "re-verify" in mock mode — whatever's cached locally
      // (set by purchasePremium()/redeemVoucher()) is authoritative.
      return Promise.resolve(checkPremiumStatus());
    }
    return Promise.resolve(checkPremiumStatus());
  }

  /* --------------------------------------------------------------------
     FIREBASE: free trial (server-checked, not the device clock — abuse-
     resistant against clock changes/reinstalls only once this actually
     calls a real backend that tracks trial start per account/device id)
     -------------------------------------------------------------------- */

  // Change this to "active" / "expired" / "none" to explore each UI state
  // while there's no real backend yet.
  var MOCK_TRIAL_RESPONSE = "none"; // "none" | "active" | "expired"
  var MOCK_TRIAL_DAYS_TOTAL = 3;

  // FIREBASE: replace this whole function body with a fetch() to a real
  // Cloud Function endpoint that looks up (or starts) this user/device's
  // trial server-side and returns its actual status — deliberately not
  // trusting the phone's local clock, so it can't be reset by changing the
  // device date or reinstalling the app.
  function checkTrialStatus(){
    return new Promise(function(resolve){
      setTimeout(function(){
        var cached = readJSON(LS_TRIAL);
        if(cached && cached.status){
          resolve(cached);
          return;
        }
        // First check ever (no cache): synthesize a result from the mock
        // response above, exactly as a real endpoint's first response would.
        var result;
        if(MOCK_TRIAL_RESPONSE === "active"){
          result = { status: "active", startedAt: Date.now(), daysRemaining: MOCK_TRIAL_DAYS_TOTAL };
        } else if(MOCK_TRIAL_RESPONSE === "expired"){
          result = { status: "expired", startedAt: Date.now() - (MOCK_TRIAL_DAYS_TOTAL+1)*86400000, daysRemaining: 0 };
        } else {
          result = { status: "none", startedAt: null, daysRemaining: 0 };
        }
        writeJSON(LS_TRIAL, result);
        resolve(result);
      }, 150); // simulated network round-trip
    });
  }

  // FIREBASE: replace with a real call that registers this user/device's
  // trial start server-side (the same endpoint checkTrialStatus() would then
  // read back) — the local write below is only a stand-in so the "Start
  // Trial" button has something to do before that backend exists. Doing
  // this purely client-side is exactly the kind of thing that makes a trial
  // trivially resettable (clear storage, start again), which is why the
  // real version has to be server-checked, not just locally written.
  function startTrial(){
    var result = { status: "active", startedAt: Date.now(), daysRemaining: MOCK_TRIAL_DAYS_TOTAL };
    writeJSON(LS_TRIAL, result);
    return Promise.resolve(result);
  }

  /* --------------------------------------------------------------------
     TESTING ONLY — lets you flip between locked/premium/trial states from
     inside the app (Settings > Testing) instead of clearing browser storage
     by hand. Remove the "Testing" section in index.html's settingsInfoHtml()
     (search for "TESTING ONLY") before shipping to Play Store — these
     functions themselves are harmless to leave (they only ever touch this
     app's own local mock state), but the button is dev-only chrome.
     -------------------------------------------------------------------- */
  function resetToFree(){
    try{ localStorage.removeItem(LS_PREMIUM); }catch(e){}
    try{ localStorage.removeItem(LS_TRIAL); }catch(e){}
  }
  function simulateTrial(status){
    var result;
    if(status === "active"){
      result = { status: "active", startedAt: Date.now(), daysRemaining: MOCK_TRIAL_DAYS_TOTAL };
    } else if(status === "expired"){
      result = { status: "expired", startedAt: Date.now() - (MOCK_TRIAL_DAYS_TOTAL+1)*86400000, daysRemaining: 0 };
    } else {
      result = { status: "none", startedAt: null, daysRemaining: 0 };
    }
    writeJSON(LS_TRIAL, result);
    return result;
  }

  /* --------------------------------------------------------------------
     FIREBASE: redeem code
     -------------------------------------------------------------------- */

  // FIREBASE: replace with a real call to a Cloud Function that validates
  // the code against your voucher database (single-use, expiry, etc.) and
  // returns whether it was accepted. The mock below only recognizes the
  // literal string "TESTCODE" (case-insensitive) for local UI testing.
  function redeemVoucher(code){
    return new Promise(function(resolve){
      setTimeout(function(){
        var normalized = (code || "").trim().toUpperCase();
        if(normalized === "TESTCODE"){
          setPremium(true);
          resolve({ success: true });
        } else {
          resolve({ success: false, message: "Invalid or already used code" });
        }
      }, 400);
    });
  }

  /* --------------------------------------------------------------------
     FIREBASE: desktop app download link
     -------------------------------------------------------------------- */

  // FIREBASE: replace with a real call that requests a signed download URL
  // from Firebase Storage for the desktop build. Static test URL for now so
  // the UI has something to open.
  //
  // Expiry: use a GENEROUS window — 24 hours, not the 10-15 minutes you'd
  // default to for a typical web app. This app's audience is seafarers with
  // slow/intermittent onboard connectivity; the UI already calls this fresh
  // every time "Download Desktop App" is tapped (never caches/reuses a
  // link), so there's no downside to someone tapping it, giving up on a weak
  // signal, and trying again once they've got a strong connection — but a
  // short expiry WOULD hurt someone whose download drops mid-transfer and
  // whose browser tries to resume from the same (by-then-expired) URL later.
  // 24h comfortably covers "started it, connection dropped, resumed a few
  // hours later" without meaningfully weakening the point of expiry at all
  // (stopping a link from being shared/reused indefinitely by non-buyers).
  function getDesktopDownloadLink(){
    return Promise.resolve("https://example.com/downloads/ETACalculator-Portable-test.exe");
  }

  /* --------------------------------------------------------------------
     Combined "is this feature unlocked right now" helper — premium OR an
     active trial both unlock the same gated features.
     -------------------------------------------------------------------- */
  function isUnlocked(trialStatus){
    if(checkPremiumStatus()) return true;
    return !!(trialStatus && trialStatus.status === "active");
  }

  window.Premium = {
    PRODUCT_ID: PRODUCT_ID,
    getProductDetails: getProductDetails,
    computeOriginalPrice: computeOriginalPrice,
    purchasePremium: purchasePremium,
    checkPremiumStatus: checkPremiumStatus,
    refreshPremiumStatus: refreshPremiumStatus,
    checkTrialStatus: checkTrialStatus,
    startTrial: startTrial,
    redeemVoucher: redeemVoucher,
    getDesktopDownloadLink: getDesktopDownloadLink,
    isUnlocked: isUnlocked,
    // Testing-only helpers — see the comment above their definitions.
    resetToFree: resetToFree,
    simulateTrial: simulateTrial
  };
})(window);
